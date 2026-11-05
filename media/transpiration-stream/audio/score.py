"""Procedural documentary score and sound design, timed to timeline.json.

Writes two stereo 48 kHz float WAVs: music.wav (pad, plucks, drone, shimmer;
reverberated) and sfx.wav (wind, rustle, drips, flow, sparkle, breath, whooshes).
Everything is synthesized here (no samples), deterministic (fixed seed).

Usage: python3 -I score.py <out_dir>
"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve

HERE = Path(__file__).resolve().parent
TL = json.loads((HERE.parent / "timeline.json").read_text())
SR = 48000
DUR = TL["duration"] + 1.5
N = int(DUR * SR)
t = np.arange(N) / SR
rng = np.random.default_rng(2024)


def hz(note: str) -> float:
    names = {"C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4, "F#": -3, "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2}
    name, octave = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((names[name] + 12 * (octave - 4)) / 12)


def env_adsr(n, a, r):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.sin(np.linspace(0, np.pi / 2, na)) ** 2
    if nr:
        e[-nr:] *= np.cos(np.linspace(0, np.pi / 2, nr)) ** 2
    return e


def lp(x, fc, order=2):
    return sosfilt(butter(order, fc, "low", fs=SR, output="sos"), x)


def hp(x, fc, order=2):
    return sosfilt(butter(order, fc, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def place(buf, sig, start, gain=1.0, pan=0.0):
    i = int(start * SR)
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    lg, rg = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    if sig.ndim == 1:
        buf[i:i + len(sig), 0] += sig * gain * lg * 1.414
        buf[i:i + len(sig), 1] += sig * gain * rg * 1.414
    else:
        buf[i:i + len(sig)] += sig * gain


def reverb_ir(seconds=3.6, damp=4500):
    n = int(seconds * SR)
    tt = np.arange(n) / SR
    ir = np.zeros((n, 2))
    for c in range(2):
        noise = rng.standard_normal(n)
        noise = lp(noise, damp)
        ir[:, c] = noise * np.exp(-6.9 * tt / seconds)
    ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))[:, None]
    return ir / np.sqrt((ir ** 2).sum(axis=0))


# --- music ---------------------------------------------------------------------
CHORDS = [  # (start, end, notes)
    (0.0, 11.4, ["D3", "A3", "C#4", "E4", "F#4"]),          # Dmaj9: open, natural
    (10.6, 18.6, ["B2", "F#3", "B3", "C#4", "D4", "F#4"]),   # Bm(add9): going inside
    (18.0, 30.4, ["G2", "D3", "B3", "F#4", "A4"]),           # Gmaj9: the leaf, light
    (29.6, 34.6, ["E2", "B2", "G3", "D4", "F#4"]),           # Em9: evaporation → tension
    (33.8, 38.8, ["A2", "E3", "A3", "D4", "E4"]),            # Asus4: pull, suspended
    (38.0, 45.9, ["F#2", "C#3", "A3", "E4", "G#4"]),          # F#m9-ish: molecular
    (45.2, 49.8, ["B2", "F#3", "A3", "D4", "C#5"]),          # Bm9: adhesion
    (49.0, 57.0, ["G2", "D3", "B3", "F#4", "A4"]),           # Gmaj7: stomata
    (56.2, DUR, ["D2", "A2", "D3", "A3", "F#4", "E5", "A4"]), # Dmaj9: resolution
]


def pad_voice(f, n):
    tt = np.arange(n) / SR
    out = np.zeros(n)
    for det in (-0.004, 0.0, 0.0045):
        ff = f * (1 + det)
        ph = rng.uniform(0, 2 * np.pi)
        for k in range(1, 14):
            if ff * k > 9000:
                break
            out += np.sin(2 * np.pi * ff * k * tt + ph * k) * (1 / k) * np.exp(-k / 4.5)
    vib = 1 + 0.12 * np.sin(2 * np.pi * rng.uniform(0.05, 0.12) * tt + rng.uniform(0, 6))
    return out * vib / 3


def build_music():
    mus = np.zeros((N, 2))
    for i, (a, b, notes) in enumerate(CHORDS):
        n = int((min(b, DUR) - a) * SR)
        chord = np.zeros(n)
        for j, nt in enumerate(notes):
            chord += pad_voice(hz(nt), n) * (0.9 if j == 0 else 0.55)
        chord = lp(chord, 1500 if i < len(CHORDS) - 1 else 2200)
        chord *= env_adsr(n, 2.2, 2.0)
        place(mus, chord, a, 0.05, pan=0.15 * np.sin(i))
    # sub drone on D
    drone = (np.sin(2 * np.pi * hz("D2") * t) + 0.5 * np.sin(2 * np.pi * hz("A1") * t)) * 0.03
    drone *= np.clip(np.minimum(t / 4, (DUR - t) / 3), 0, 1)
    mus += drone[:, None]
    # plucks: a sparse pentatonic motif, soft (piano/celesta-like additive tones)
    motif = [(1.6, "F#5"), (3.4, "A5"), (5.2, "E5"), (8.6, "D5"), (11.6, "B4"), (13.4, "F#5"), (15.4, "D5"),
             (19.0, "B5"), (20.8, "A5"), (23.6, "F#5"), (27.2, "D6"), (31.0, "G5"), (34.2, "E5"), (36.6, "A5"),
             (39.2, "C#6"), (41.4, "A5"), (43.6, "E6"), (46.8, "F#5"), (50.2, "B5"), (52.6, "A5"), (55.0, "F#5"),
             (57.4, "A5"), (58.6, "D6"), (59.8, "E6"), (61.0, "F#6"), (62.4, "A5")]
    for k, (st, nt) in enumerate(motif):
        f = hz(nt)
        n = int(4.0 * SR)
        tt = np.arange(n) / SR
        tone = np.zeros(n)
        for m, inh in enumerate([1, 2.0, 3.002, 4.01, 5.03, 6.05]):
            tone += np.sin(2 * np.pi * f * inh * tt) * np.exp(-tt * (1.6 + 1.3 * m)) / (m + 1) ** 1.4
        tone *= np.minimum(1, tt / 0.004)
        place(mus, tone, st, 0.05 if st < 57 else 0.065, pan=0.35 * np.sin(k * 1.7))
    # shimmer for the microscopic/molecular scenes
    for (a, b) in [(21.7, 25.2), (38.2, 49.8)]:
        n = int((b - a) * SR)
        tt = np.arange(n) / SR
        sh = np.zeros(n)
        for nt in ["D6", "A6", "F#6", "E7"]:
            sh += np.sin(2 * np.pi * hz(nt) * tt * (1 + 0.002 * np.sin(2 * np.pi * 4.5 * tt))) * (0.5 + 0.5 * np.sin(2 * np.pi * rng.uniform(0.2, 0.5) * tt + rng.uniform(0, 6)))
        sh *= env_adsr(n, 1.5, 1.5)
        place(mus, sh, a, 0.005)
    wet = np.stack([fftconvolve(mus[:, c], IR[:, c])[:N] for c in range(2)], axis=1)
    mus = 0.72 * mus + 0.55 * wet
    return np.tanh(mus * 1.4) / 1.4


# --- sound design -------------------------------------------------------------------
def noise(n, color="pink"):
    w = rng.standard_normal(n)
    if color == "brown":
        return lp(np.cumsum(w) / 50, 1200)
    if color == "pink":
        f = np.fft.rfft(w)
        f /= np.maximum(1, np.sqrt(np.arange(len(f))))
        return np.fft.irfft(f, n) * 40
    return w


def slow(n, rate, seed=0):
    k = max(4, int(n / SR * rate) + 4)
    pts = np.random.default_rng(seed).uniform(0, 1, k)
    return np.interp(np.linspace(0, k - 3, n), np.arange(k), pts)


def whoosh(dur=1.1, up=True):
    n = int(dur * SR)
    x = noise(n, "white")
    tt = np.linspace(0, 1, n)
    out = np.zeros(n)
    centers = np.geomspace(350, 2600, 24) if up else np.geomspace(2600, 350, 24)
    seg = n // 24
    for i, c in enumerate(centers):
        s = slice(i * seg, (i + 1) * seg + seg)
        out[s] += bp(x[s], c * 0.7, min(c * 1.4, 20000))[: len(out[s])] * np.hanning(len(out[s]))
    return out * np.sin(np.pi * tt) ** 1.5


def build_sfx():
    fx = np.zeros((N, 2))
    # outdoors: wind + leaf rustle (opening, X-ray tree, recap)
    for (a, b, g) in [(0.0, 3.9, 1.0), (15.9, 18.6, 0.6), (56.4, DUR, 0.9)]:
        n = int((b - a) * SR)
        e = env_adsr(n, 1.0, 1.4)
        for c in range(2):
            w = bp(noise(n, "pink"), 160, 900) * (0.5 + 0.8 * slow(n, 0.6, seed=c + int(a)))
            r = hp(noise(n, "white"), 3500) * slow(n, 1.2, seed=7 + c + int(a)) ** 3 * 0.35
            fx[int(a * SR):int(a * SR) + n, c] += (w * 0.022 + r * 0.012) * e * g
    # soil: low rumble and sparse drips
    n = int(3.2 * SR)
    rum = lp(noise(n, "brown"), 180) * env_adsr(n, 0.8, 1.2) * 0.05
    place(fx, rum, 2.6, 1.0)
    for st in [3.3, 3.95, 4.6, 5.05, 5.7, 6.4]:
        nn = int(0.25 * SR)
        tt = np.arange(nn) / SR
        f0 = rng.uniform(1300, 2000)
        drip = np.sin(2 * np.pi * (f0 * tt - 0.5 * f0 * 9 * tt ** 2)) * np.exp(-tt * 38)
        place(fx, drip, st, 0.02, pan=rng.uniform(-0.6, 0.6))
    # molecular ticks during osmosis and the molecular scenes
    for (a, b, dens) in [(5.6, 11.0, 7), (38.4, 49.6, 9)]:
        for st in np.sort(rng.uniform(a, b, int((b - a) * dens))):
            nn = int(0.03 * SR)
            tt = np.arange(nn) / SR
            tick = np.sin(2 * np.pi * rng.uniform(2500, 6000) * tt) * np.exp(-tt * 260)
            place(fx, tick, st, 0.006, pan=rng.uniform(-0.8, 0.8))
    # xylem flow (and the transpiration pull)
    for (a, b, g) in [(13.6, 16.5, 1.0), (35.8, 38.8, 1.2)]:
        n = int((b - a) * SR)
        for c in range(2):
            fl = bp(noise(n, "pink"), 250, 1400) * (0.6 + 0.6 * slow(n, 3.0, seed=11 + c))
            fx[int(a * SR):int(a * SR) + n, c] += fl * 0.016 * env_adsr(n, 0.6, 0.8) * g
    # evaporation sparkle
    for st in np.sort(rng.uniform(22.0, 25.0, 26)):
        nn = int(0.12 * SR)
        tt = np.arange(nn) / SR
        sp = np.sin(2 * np.pi * rng.uniform(5000, 9000) * tt) * np.exp(-tt * 45)
        place(fx, sp, st, 0.006, pan=rng.uniform(-0.7, 0.7))
    # stoma: airflow following the opening state
    a, b = 49.6, 56.8
    n = int((b - a) * SR)
    tt = a + np.arange(n) / SR
    o1 = np.clip((tt - 49.9) / 1.4, 0, 1)
    c1 = np.clip((tt - 54.0) / 1.6, 0, 1)
    openness = 0.12 + 0.88 * (o1 * o1 * (3 - 2 * o1)) - 0.78 * (c1 * c1 * (3 - 2 * c1))
    for c in range(2):
        br = bp(noise(n, "pink"), 400, 2600) * openness * 0.02
        fx[int(a * SR):int(a * SR) + n, c] += br * env_adsr(n, 0.4, 0.6)
    # transitions between scales/worlds
    for s0, up in [(3.7, False), (5.4, False), (10.7, True), (13.6, True), (15.9, True), (18.2, False), (21.7, False),
                   (24.7, True), (29.9, False), (33.9, True), (35.8, True), (38.2, False), (45.4, True), (49.3, True), (56.4, True)]:
        place(fx, whoosh(1.1, up), s0 - 0.25, 0.018, pan=rng.uniform(-0.3, 0.3))
    wet = np.stack([fftconvolve(fx[:, c], IR[:, c] * 0.6)[:N] for c in range(2)], axis=1)
    return fx * 0.85 + wet * 0.35


IR = reverb_ir()

if __name__ == "__main__":
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    music = build_music()
    sfx = build_sfx()
    sf.write(out / "music.wav", music.astype(np.float32), SR, subtype="FLOAT")
    sf.write(out / "sfx.wav", sfx.astype(np.float32), SR, subtype="FLOAT")
    for name, x in (("music", music), ("sfx", sfx)):
        print(name, "peak", round(float(np.abs(x).max()), 3), "rms dBFS", round(20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9), 1))
