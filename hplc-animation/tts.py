"""Greek narration for the HPLC explainer.

Synthesises each segment in narration.json with a Microsoft neural Greek voice
(edge-tts), keeps the per-word timings, lays the segments out on one timeline
with the pauses given in the script, and writes:

  build/narration.wav   the full voice track (48 kHz mono)
  build/timeline.json   segment and word start/end times, in seconds

Usage:  python tts.py [--voice el-GR-AthinaNeural] [--rate +0%]
"""

import argparse
import asyncio
import json
import os
import ssl
import subprocess
import wave

import aiohttp
import edge_tts
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
SR = 48000


def connector():
    # edge-tts pins certifi's CA list; honour SSL_CERT_FILE (e.g. a TLS-inspecting proxy) when set.
    cafile = os.environ.get("SSL_CERT_FILE")
    if not cafile:
        return None
    return aiohttp.TCPConnector(ssl=ssl.create_default_context(cafile=cafile))


async def synth(text, voice, rate, mp3_path):
    comm = edge_tts.Communicate(
        text, voice, rate=rate, boundary="WordBoundary",
        connector=connector(), proxy=os.environ.get("HTTPS_PROXY"),
    )
    words, audio = [], bytearray()
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            audio += chunk["data"]
        elif chunk["type"] == "WordBoundary":
            t0 = chunk["offset"] / 1e7
            words.append({"w": chunk["text"], "t0": t0, "t1": t0 + chunk["duration"] / 1e7})
    with open(mp3_path, "wb") as f:
        f.write(audio)
    return words


def decode(mp3_path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", mp3_path, "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice")
    ap.add_argument("--rate")
    args = ap.parse_args()

    script = json.load(open(os.path.join(HERE, "narration.json"), encoding="utf-8"))
    voice = args.voice or script["voice"]
    rate = args.rate or script["rate"]
    os.makedirs(os.path.join(BUILD, "tts"), exist_ok=True)

    clips, segs, t = [], [], 0.0
    for i, seg in enumerate(script["segments"]):
        mp3 = os.path.join(BUILD, "tts", f"{i:02d}_{seg['id']}.mp3")
        words = asyncio.run(synth(seg.get("speech", seg["text"]), voice, rate, mp3))
        pcm = decode(mp3)
        # Trim the encoder's leading/trailing silence so the pauses are the script's.
        nz = np.flatnonzero(np.abs(pcm) > 0.004)
        head = max(0, nz[0] - int(0.03 * SR))
        tail = min(len(pcm), nz[-1] + int(0.08 * SR))
        pcm = pcm[head:tail]
        shift = head / SR
        t += seg.get("gap", 0.5)
        dur = len(pcm) / SR
        segs.append({
            "id": seg["id"],
            "start": round(t, 3),
            "end": round(t + dur, 3),
            "text": seg["text"],
            "words": [{"w": w["w"], "t0": round(t + w["t0"] - shift, 3), "t1": round(t + w["t1"] - shift, 3)} for w in words],
        })
        clips.append((t, pcm))
        t += dur

    total = t
    track = np.zeros(int((total + 0.05) * SR), dtype=np.float32)
    for start, pcm in clips:
        i = int(round(start * SR))
        track[i:i + len(pcm)] += pcm
    peak = np.max(np.abs(track))
    track *= 0.89 / peak  # about -1 dBFS; loudness is set in the final mix
    with wave.open(os.path.join(BUILD, "narration.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((track * 32767).astype(np.int16).tobytes())

    timeline = {"voice": voice, "rate": rate, "speechEnd": round(total, 3), "segments": segs}
    with open(os.path.join(BUILD, "timeline.json"), "w", encoding="utf-8") as f:
        json.dump(timeline, f, ensure_ascii=False, indent=1)
    for s in segs:
        print(f"{s['id']:<9} {s['start']:6.2f} -> {s['end']:6.2f}  ({s['end'] - s['start']:.2f}s, {len(s['words'])} words)")
    print(f"speech ends at {total:.2f}s  voice={voice} rate={rate}")


if __name__ == "__main__":
    main()
