"""Synthesise the demo narration with Kokoro-82M (open-weight, Apache-2.0), one WAV per segment.

    python -I scripts/video/tts.py <models_dir> <narration.json> <out_dir> [segment_id ...]

Writes <out_dir>/<id>.wav and <out_dir>/durations.json (seconds per segment).
"""

import json
import sys
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

models, script, out = (Path(a) for a in sys.argv[1:4])
only = set(sys.argv[4:])
spec = json.loads(script.read_text(encoding="utf-8"))
kokoro = Kokoro(str(models / "kokoro-v1.0.onnx"), str(models / "voices-v1.0.bin"))
out.mkdir(parents=True, exist_ok=True)

dur_file = out / "durations.json"
durations = json.loads(dur_file.read_text()) if dur_file.exists() else {}
for seg in spec["segments"]:
    if only and seg["id"] not in only:
        continue
    samples, rate = kokoro.create(seg.get("say", seg["text"]), voice=spec["voice"], speed=spec["speed"], lang="en-us")
    sf.write(out / f"{seg['id']}.wav", samples, rate)
    durations[seg["id"]] = round(len(samples) / rate, 3)
    print(f"{seg['id']:16s} {durations[seg['id']]:6.2f} s")
dur_file.write_text(json.dumps(durations, indent=2))
print(f"total narration {sum(durations.values()):.1f} s")
