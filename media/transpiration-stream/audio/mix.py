"""Mix narration, music and sound effects into the film soundtrack.

Narration lines are placed at their timeline.json start times; music and effects
are ducked under speech (sidechain-style envelope). The result is written as a
pre-master; build/encode.sh then loudness-normalises it (EBU R128, -16 LUFS).

Usage: python3 -I mix.py <narration_dir> <stems_dir> <out_wav>
"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, resample_poly, sosfilt

HERE = Path(__file__).resolve().parent
TL = json.loads((HERE.parent / "timeline.json").read_text())
SR = 48000
MAKEUP_DB = 5.4  # measured: the unlimited mix integrates at about -21.2 LUFS


def db(x):
    return 20 * np.log10(np.sqrt(np.mean(np.square(x))) + 1e-12)


def main(nar_dir: Path, stems: Path, out: Path) -> None:
    music, sr1 = sf.read(stems / "music.wav", dtype="float32")
    sfx, sr2 = sf.read(stems / "sfx.wav", dtype="float32")
    assert sr1 == sr2 == SR
    n = int(TL["duration"] * SR)
    music, sfx = music[:n], sfx[:n]
    voice = np.zeros(n, dtype=np.float64)
    hp = butter(2, 70, "high", fs=SR, output="sos")
    for line_id, start in TL["narration"].items():
        x, sr = sf.read(nar_dir / f"{line_id}.wav", dtype="float32")
        x = resample_poly(x, SR, sr).astype(np.float64)
        x = sosfilt(hp, x)
        x *= 10 ** ((-20.0 - db(x[np.abs(x) > 0.01])) / 20)  # each line at the same speech level
        i = int(start * SR)
        voice[i:i + len(x)] += x[: n - i]
    # gentle voice compression (threshold -26 dBFS, 2.5:1, 8 ms / 160 ms): steadier level, lower crest factor
    blk = 96
    lvl = np.sqrt(np.convolve(voice ** 2, np.ones(blk) / blk, mode="same") + 1e-12)
    over = np.maximum(0.0, 20 * np.log10(lvl) + 26.0)
    gr_target = -over * (1 - 1 / 2.5)
    gr = np.zeros(n)
    g = 0.0
    att, rel = 1 - np.exp(-blk / (0.008 * SR)), 1 - np.exp(-blk / (0.16 * SR))
    for i in range(0, n, blk):
        tg = gr_target[i]
        g += (tg - g) * (att if tg < g else rel)
        gr[i:i + blk] = g
    voice = voice * 10 ** (gr / 20) * 10 ** (3.0 / 20)
    voice = np.tanh(voice * 1.6) / 1.6  # soft safety clip for stray peaks
    # ducking envelope from speech activity (attack 120 ms, release 650 ms)
    win = int(0.03 * SR)
    act = np.sqrt(np.convolve(voice ** 2, np.ones(win) / win, mode="same")) > 10 ** (-42 / 20)
    env = np.zeros(n)
    a_att, a_rel = 1 - np.exp(-1 / (0.12 * SR)), 1 - np.exp(-1 / (0.65 * SR))
    v = 0.0
    for i in range(0, n, 64):  # control-rate envelope
        target = 1.0 if act[i] else 0.0
        k = a_att if target > v else a_rel
        v += (target - v) * (1 - (1 - k) ** 64)
        env[i:i + 64] = v
    music_gain = (0.75 * (1 - 0.5 * env))[:, None]   # -2.5 dB overall, -8.5 dB under speech
    sfx_gain = (1 - 0.3 * env)[:, None]
    mix = voice[:, None] * np.array([[1.0, 1.0]]) + music * music_gain * 1.0 + sfx * sfx_gain * 1.0
    # make-up gain toward -16 LUFS, then a look-ahead peak limiter (ceiling -2 dBFS):
    # gain dips start 3 ms before a peak and recover over ~90 ms, so speech stays clean
    mix *= 10 ** (MAKEUP_DB / 20)
    ceiling = 10 ** (-2.0 / 20)
    need = np.minimum(1.0, ceiling / (np.abs(mix).max(axis=1) + 1e-9))
    from scipy.ndimage import minimum_filter1d
    need = minimum_filter1d(need, size=int(0.006 * SR), origin=0)
    rel = np.exp(-1 / (0.09 * SR))
    g = np.empty_like(need); acc = 1.0
    for i in range(len(need)):  # instant attack (already look-ahead), smooth release
        acc = need[i] if need[i] < acc else need[i] + (acc - need[i]) * rel
        g[i] = acc
    mix *= g[:, None]
    sf.write(out, mix.astype(np.float32), SR, subtype="FLOAT")
    speech = env > 0.5
    print("voice dBFS (speech)", round(db(voice[speech]), 1),
          "| music under speech", round(db((music * music_gain)[speech]), 1),
          "| music in gaps", round(db((music * music_gain)[~speech]), 1),
          "| sfx", round(db(sfx * sfx_gain), 1), "| peak", round(float(np.abs(mix).max()), 3))


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
