"""Assemble the demo video: motion-graphics cards + live-app recordings + narration + music + captions.

    python -I scripts/video/build.py <workDir> <narration.json> <out.mp4> [narrationDir] [systemRecDir] [cardsDir]

<workDir> holds narration/ (tts.py), cards/ (render-cards.mjs) and rec-main/, rec-system/
(record-app.mjs); the optional arguments pick other narration / System recording / card sets in it.
The music is generated here (music.py) for the exact running time.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

FPS = 30
FAST = 3.0  # speed of the fast-forwarded (unnarrated) navigation spans
ORDER = ["hook", "title", "loop", "@main", "arch", "@system", "results", "limits", "team"]

work, script, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]), Path(sys.argv[3]).resolve()
segs = {s["id"]: s for s in json.loads(script.read_text(encoding="utf-8"))["segments"]}
nar = work / (sys.argv[4] if len(sys.argv) > 4 else "narration")
REC_DIRS = {"main": "rec-main", "system": sys.argv[5] if len(sys.argv) > 5 else "rec-system"}
durations = json.loads((nar / "durations.json").read_text())
CARDS = work / (sys.argv[6] if len(sys.argv) > 6 else "cards")
cards = json.loads((CARDS / "cards.json").read_text())


def run(*cmd, cwd=None):
    subprocess.run([str(c) for c in cmd], check=True, cwd=cwd)


def encode_recording(name):
    """Constant-frame-rate clip from screencast frames, trimmed to its narration."""
    rec = work / REC_DIRS[name]
    meta = json.loads((rec / "frames.json").read_text())
    cues = json.loads((rec / "cues.json").read_text())
    fast = json.loads((rec / "fast.json").read_text()) if (rec / "fast.json").exists() else []
    frames = meta["frames"]
    start, stop = cues[0]["t"] - 0.8, meta["end"]  # the first frame is held back to `start` if it came later

    def warp(x):  # recording time -> edit time, with fast-forwarded spans compressed
        v = x - start
        for a, b in fast:
            if x > a:
                v -= (min(x, b) - a) * (1 - 1 / FAST)
        return v

    sel = [f for f in frames if f["t"] < stop]
    first = max((i for i, f in enumerate(sel) if f["t"] <= start), default=0)
    sel = sel[first:]
    lines = ["ffconcat version 1.0"]
    for i, f in enumerate(sel):
        t0, t1 = (start if i == 0 else f["t"]), (sel[i + 1]["t"] if i + 1 < len(sel) else stop)
        if warp(t1) - warp(t0) > 0.0005:
            lines += [f"file 'frames/{f['f']}'", f"duration {warp(t1) - warp(t0):.4f}"]
    lines.append(f"file 'frames/{sel[-1]['f']}'")
    (rec / "list.ffconcat").write_text("\n".join(lines) + "\n")
    length = warp(stop)
    clip = work / f"app-{name}.mp4"
    run("ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", rec / "list.ffconcat",
        "-vf", f"fps={FPS},format=yuv420p,fade=t=in:st=0:d=0.3,fade=t=out:st={length - 0.35:.3f}:d=0.35",
        "-t", f"{length:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "15", clip)
    return clip, length, [(c["id"], warp(c["t"])) for c in cues]


# ---------------------------------------------------------------- timeline
timeline, events, t = [], [], 0.0
for item in ORDER:
    if item.startswith("@"):
        clip, length, cues = encode_recording(item[1:])
        timeline.append((clip, length))
        events += [(cid, t + off) for cid, off in cues]
    else:
        c = cards[item]
        timeline.append((CARDS / f"{item}.mp4", c["d"]))
        events.append((item, t + c["lead"]))
    t += timeline[-1][1]
total = t
print(f"running time {total:.1f} s ({int(total // 60)}:{total % 60:04.1f})")
if total > 299:
    sys.exit("video exceeds the 5-minute limit")

# ---------------------------------------------------------------- narration track
SR = 24000
voice = np.zeros(int(total * SR) + SR, np.float32)
for cid, t0 in events:
    x, rate = sf.read(nar / f"{cid}.wav", dtype="float32")
    assert rate == SR, rate
    i = int(t0 * SR)
    voice[i : i + len(x)] += x
sf.write(work / "voice.wav", voice[: int(total * SR)], SR)
run(sys.executable, "-I", Path(__file__).with_name("music.py"), f"{total:.3f}", work / "music.wav")

# ---------------------------------------------------------------- captions (ASS, burned in)
def chunks(text, limit=80):
    out_ = []
    for p in re.split(r"(?<=[.!?:])\s+", text):
        while len(p) > limit:
            cut = p.rfind(", ", 0, limit)
            cut = cut + 1 if cut > 30 else p.rfind(" ", 0, limit)
            out_.append(p[:cut].strip())
            p = p[cut:].strip()
        if p:
            out_.append(p)
    return out_


def ts(s):
    return f"{int(s // 3600)}:{int(s // 60) % 60:02d}:{s % 60:05.2f}"


ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
       "[V4+ Styles]",
       "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
       "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
       "Style: Cap,Segoe UI Semibold,40,&H00EBF0F0,&H00EBF0F0,&H33191411,&H33191411,0,0,0,0,100,100,0,0,3,13,0,2,220,220,44,1", "",
       "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
srt = []
for cid, t0 in events:
    seg = segs[cid]
    parts = chunks(seg["text"])
    n_chars = sum(len(p) for p in parts)
    tt = t0
    for p in parts:
        d = durations[cid] * len(p) / n_chars
        if seg.get("captions") is not False:  # cards that show their own words are not captioned on screen
            ass.append(f"Dialogue: 0,{ts(tt)},{ts(tt + d)},Cap,,0,0,0,,{p}")
        ms = lambda s: f"{int(s // 3600):02d}:{int(s // 60) % 60:02d}:{int(s) % 60:02d},{int(s * 1000) % 1000:03d}"
        srt.append(f"{len(srt) + 1}\n{ms(tt)} --> {ms(tt + d)}\n{p}\n")
        tt += d
(work / "captions.ass").write_text("\n".join(ass) + "\n", encoding="utf-8")
out.with_suffix(".srt").write_text("\n".join(srt), encoding="utf-8")  # full transcript for YouTube

# ---------------------------------------------------------------- final encode
(work / "timeline.ffconcat").write_text("ffconcat version 1.0\n" + "".join(f"file '{c.as_posix()}'\n" for c, _ in timeline))
graph = ("[0:v]subtitles=captions.ass[v];"
         "[1:a]aresample=48000,aformat=channel_layouts=stereo,asplit=2[vo][key];"
         "[2:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.30[mu];"
         "[mu][key]sidechaincompress=threshold=0.012:ratio=8:attack=25:release=450[duck];"
         "[vo][duck]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-15:TP=-1.5:LRA=11[a]")
run("ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "timeline.ffconcat", "-i", "voice.wav", "-i", "music.wav",
    "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
    "-pix_fmt", "yuv420p", "-r", str(FPS), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out, cwd=work)
print(f"wrote {out}")
