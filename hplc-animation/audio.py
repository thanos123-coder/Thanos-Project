"""Soundtrack for the HPLC explainer: narration + a quiet synthesized pad + a few cues.

Reads build/narration.wav and build/anchors.json (timing exported from the animation)
and writes build/soundtrack.wav (48 kHz stereo, -16 LUFS integrated, peaks below -1.5 dBFS).
Everything here is synthesized, so there is nothing to license.
"""

import json
import os
import wave

import numpy as np
import pyloudnorm

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
SR = 48000
rng = np.random.default_rng(42)


def read_wav(path):
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getsampwidth() == 2
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float64) / 32768
        return x.reshape(-1, w.getnchannels())


def write_wav(path, x):
    x = np.clip(x, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(x.shape[1])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def fft_lowpass(x, fc, order=2):
    X = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= (1 / np.sqrt(1 + (f / fc) ** (2 * order)))[:, None]
    return np.fft.irfft(X, n=len(x), axis=0)


def reverb(x, seconds=2.6, mix=0.35):
    n = int(seconds * SR)
    env = np.exp(-6.9 * np.arange(n) / n)
    ir = np.stack([rng.standard_normal(n) * env, rng.standard_normal(n) * env], axis=1)
    ir = fft_lowpass(ir, 5000)
    ir /= np.sqrt(np.sum(ir ** 2, axis=0))
    m = len(x) + n
    size = 1 << (m - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(x, size, axis=0) * np.fft.rfft(ir, size, axis=0), size, axis=0)[: len(x)]
    return (1 - mix) * x + mix * wet * (np.sqrt(np.mean(x ** 2)) / (np.sqrt(np.mean(wet ** 2)) + 1e-12))


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def pad(duration):
    """Slow I-vi-IV-V progression in D major, soft and warm, with a gentle sub bass."""
    chords = [
        [50, 57, 62, 66, 69, 76],  # D  (add9)
        [47, 54, 59, 62, 66, 73],  # Bm7 (add9)
        [43, 55, 59, 62, 66, 71],  # Gmaj7
        [45, 57, 61, 64, 69, 71],  # A  (add9)
    ]
    step, attack, release = 4.0, 1.6, 2.4
    n = int(duration * SR)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    for ci in range(int(np.ceil(duration / step)) + 1):
        notes = chords[ci % 4]
        t0 = ci * step - 0.6
        env = np.clip((t - t0) / attack, 0, 1) * np.clip(1 - (t - (t0 + step + 0.6)) / release, 0, 1)
        env = np.sin(env * np.pi / 2) ** 2
        live = env > 0
        if not live.any():
            continue
        tt = t[live]
        for j, m in enumerate(notes):
            f = midi(m)
            voice = np.zeros_like(tt)
            for det in (-0.004, 0.0, 0.0045):  # gentle chorus
                ph = rng.uniform(0, 2 * np.pi)
                ff = f * (1 + det)
                voice += np.sin(2 * np.pi * ff * tt + ph) + 0.22 * np.sin(4 * np.pi * ff * tt + ph) + 0.06 * np.sin(6 * np.pi * ff * tt + ph)
            amp = 0.11 if j else 0.13
            pan = 0.5 + 0.32 * np.sin(j * 2.1 + ci)
            out[live, 0] += voice * env[live] * amp * np.sqrt(1 - pan)
            out[live, 1] += voice * env[live] * amp * np.sqrt(pan)
        sub = 0.18 * np.sin(2 * np.pi * midi(notes[0] - 12) * tt) * env[live]
        out[live] += sub[:, None]
    # slow shimmer of the brightness, then soften and add space
    out *= (0.85 + 0.15 * np.sin(2 * np.pi * t / 9.0))[:, None]
    out = fft_lowpass(out, 1600)
    out = reverb(out, 3.0, 0.45)
    fade = np.clip(t / 2.0, 0, 1) * np.clip((duration - t) / 2.5, 0, 1)
    return out * fade[:, None]


def place(track, sig, at, gain_db, pan=0.5):
    i = int(at * SR)
    if i >= len(track):
        return
    sig = sig[: len(track) - i]
    g = 10 ** (gain_db / 20)
    track[i : i + len(sig), 0] += sig * g * np.sqrt(1 - pan)
    track[i : i + len(sig), 1] += sig * g * np.sqrt(pan)


def whoosh(d=0.8, rising=True):
    n = int(d * SR)
    x = rng.standard_normal(n)
    y = np.zeros(n)
    lo = hi = 0.0
    for i in range(n):  # band-pass whose centre sweeps
        p = i / n if rising else 1 - i / n
        fc = 250 * (1 - p) + 3200 * p
        a = np.exp(-2 * np.pi * fc / SR)
        b = np.exp(-2 * np.pi * fc * 0.45 / SR)
        lo = (1 - a) * x[i] + a * lo
        hi = (1 - b) * lo + b * hi
        y[i] = lo - hi
    env = np.sin(np.pi * np.linspace(0, 1, n)) ** 1.6
    y *= env
    return y / (np.max(np.abs(y)) + 1e-12)


def ping(f, d=1.2):
    t = np.arange(int(d * SR)) / SR
    y = (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 6) + 0.12 * np.sin(2 * np.pi * 3.01 * f * t) * np.exp(-t * 9))
    y *= np.exp(-t * 4.2) * np.clip(t / 0.004, 0, 1)
    return y / np.max(np.abs(y))


def drop():
    t = np.arange(int(0.35 * SR)) / SR
    f = 900 * np.exp(-t * 9) + 260
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 14) * np.clip(t / 0.003, 0, 1)
    return y / np.max(np.abs(y))


def main():
    a = json.load(open(os.path.join(BUILD, "anchors.json")))
    dur = a["end"]
    n = int(np.ceil(dur * SR))

    voice = read_wav(os.path.join(BUILD, "narration.wav"))[:, 0]
    voice = np.pad(voice, (0, max(0, n - len(voice))))[:n]
    meter = pyloudnorm.Meter(SR)
    voice *= 10 ** ((-16.0 - meter.integrated_loudness(voice)) / 20)

    music = pad(dur)[:n]
    music *= 10 ** ((-33.0 - meter.integrated_loudness(music)) / 20)
    # duck the pad by ~4 dB while the narrator speaks
    env = np.sqrt(np.convolve(voice ** 2, np.ones(int(0.25 * SR)) / int(0.25 * SR), mode="same"))
    duck = 1 - 0.37 * np.clip(env / (np.percentile(env, 95) + 1e-9), 0, 1)
    duck = np.convolve(duck, np.ones(int(0.12 * SR)) / int(0.12 * SR), mode="same")
    music *= duck[:, None]

    sfx = np.zeros((n, 2))
    place(sfx, whoosh(0.9), 0.15, -30)                    # title
    place(sfx, whoosh(0.9), a["reveal"] - 0.25, -29)      # the instrument appears
    place(sfx, drop(), a["injFlow"] - 0.15, -27, 0.45)    # sample injected
    place(sfx, whoosh(0.8), a["full"] - 0.15, -28)        # zoom into the column
    place(sfx, whoosh(0.8, rising=False), a["sepEnd"] - 0.1, -31)
    for f, p in zip((midi(81), midi(85), midi(88)), a["peaks"]):  # one note per peak: A5, C#6, E6
        place(sfx, ping(f), p - 0.35, -29, 0.6)
    for f, tv in zip((midi(74), midi(78), midi(81)), (a["v1"], a["v2"], a["v3"])):  # recap: D5, F#5, A5
        place(sfx, ping(f, 1.6), tv - 0.1, -31)

    mix = voice[:, None] * np.ones((1, 2)) + music + sfx
    mix *= 10 ** ((-16.0 - meter.integrated_loudness(mix)) / 20)
    peak = np.max(np.abs(mix))
    ceiling = 10 ** (-1.5 / 20)
    if peak > ceiling:  # gentle soft-knee limiting of the rare peaks above the ceiling
        over = np.abs(mix) > ceiling * 0.9
        mix[over] = np.sign(mix[over]) * (ceiling * 0.9 + (ceiling * 0.1) * np.tanh((np.abs(mix[over]) - ceiling * 0.9) / (ceiling * 0.1)))
    fade = np.clip((dur - np.arange(n) / SR) / 0.5, 0, 1)
    mix *= fade[:, None]
    write_wav(os.path.join(BUILD, "soundtrack.wav"), mix)
    print(f"soundtrack: {dur:.2f}s  integrated {meter.integrated_loudness(mix):.1f} LUFS  peak {20 * np.log10(np.max(np.abs(mix))):.1f} dBFS")
    print(f"  music bed {meter.integrated_loudness(music):.1f} LUFS, voice {meter.integrated_loudness(voice):.1f} LUFS")


if __name__ == "__main__":
    main()
