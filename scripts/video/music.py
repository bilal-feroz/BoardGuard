"""Generate the demo's background music in code (no samples, nothing to license): a 112 BPM
minimal electronic bed in A minor (Am-F-C-G) with an intro, a pumping main section and an ending.

    python -I scripts/video/music.py <seconds> <out.wav>
"""

import sys

import numpy as np
import soundfile as sf

SR = 44100
BPM = 112
BEAT = 60 / BPM
BAR = 4 * BEAT
CHORD = 2 * BAR
PROG = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]  # Am F C G (MIDI)

dur = float(sys.argv[1])
N = int(dur * SR)
music = np.zeros((N, 2), np.float32)
drums = np.zeros((N, 2), np.float32)
rng = np.random.default_rng(7)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def add(buf, x, start, gain=1.0, pan=0.0):
    i = int(start * SR)
    if i >= N:
        return
    x = x[: N - i] * gain
    buf[i : i + len(x), 0] += np.cos((pan + 1) * np.pi / 4) * x
    buf[i : i + len(x), 1] += np.sin((pan + 1) * np.pi / 4) * x


def tone(f, n, harmonics, roll):
    t = np.arange(n) / SR
    y = np.zeros(n, np.float32)
    for k in range(1, harmonics + 1):
        if f * k > 14000:
            break
        y += (np.sin(2 * np.pi * f * k * t + k) / k * np.exp(-(k - 1) / roll)).astype(np.float32)
    return y


def pluck(f, length, decay, harm=(1.0, 0.3, 0.12)):
    n = int(length * SR)
    t = np.arange(n) / SR
    y = sum(a * np.sin(2 * np.pi * f * (k + 1) * t) for k, a in enumerate(harm))
    return (y * np.minimum(1, t / 0.004) * np.exp(-t / decay)).astype(np.float32)


def kick():
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    f = 44 + 80 * np.exp(-t / 0.035)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.17)).astype(np.float32)


def hat():
    n = int(0.09 * SR)
    x = np.diff(rng.standard_normal(n + 1)).astype(np.float32)
    return x * np.exp(-np.arange(n) / SR / 0.016).astype(np.float32)


INTRO, OUTRO = 2 * BAR, dur - 4.0

# Pad: detuned, softly filtered chords that cross-fade every two bars.
seg, fade = int(CHORD * SR), int(0.9 * SR)
for i in range(int(dur / CHORD) + 1):
    n = seg + fade
    y = np.zeros(n, np.float32)
    for m in PROG[i % 4]:
        for det in (-0.0045, 0.004):
            y += tone(hz(m) * (1 + det), n, 7, 1.8)
    w = np.ones(n, np.float32)
    w[:fade] = np.linspace(0, 1, fade)
    w[-fade:] = np.linspace(1, 0, fade)
    add(music, y * w, i * CHORD, 0.030, pan=0.25 if i % 2 else -0.25)

K, HATS = kick(), [hat() for _ in range(8)]
for b in range(int(dur / BEAT) + 1):
    tb = b * BEAT
    chord = PROG[int(tb // CHORD) % 4]
    main = INTRO <= tb < OUTRO
    # Arpeggio: chord tones over two octaves in sixteenths, quieter in the intro and ending.
    seq = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 24]
    for j, m in enumerate(seq):
        add(music, pluck(hz(m), 0.35, 0.085), tb + j * BEAT / 4, 0.055 if main else 0.035, pan=-0.35 if j % 2 else 0.35)
    if main:
        add(drums, K, tb, 0.62)
        add(drums, HATS[b % 8], tb + BEAT / 2, 0.07, pan=0.3)
        if b % 2:
            add(drums, HATS[(b + 3) % 8], tb + 3 * BEAT / 4, 0.035, pan=-0.3)
        add(music, pluck(hz(chord[0] - 12), BEAT / 2, 0.16, (1.0, 0.45, 0.2, 0.08)), tb + BEAT / 2, 0.30)

# Side-chain pump: everything but the drums dips on each kick.
t = np.arange(N) / SR
phase = np.mod(t, BEAT)
duck = 1 - 0.55 * np.exp(-phase / 0.11) * ((t >= INTRO) & (t < OUTRO))
mix = music * duck[:, None].astype(np.float32) + drums
mix *= np.minimum(1, t / 1.5)[:, None].astype(np.float32)
mix *= np.clip((dur - t) / 4.0, 0, 1)[:, None].astype(np.float32)
mix *= 0.89 / max(1e-6, float(np.abs(mix).max()))
sf.write(sys.argv[2], mix, SR, subtype="PCM_16")
print(f"wrote {sys.argv[2]} ({dur:.1f} s)")
