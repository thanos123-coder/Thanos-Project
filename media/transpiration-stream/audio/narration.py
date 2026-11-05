"""Synthesize the English narration, one clip per narration line.

Uses the Kokoro-82M neural TTS (ONNX build) with the `af_heart` voice.
Each line is phonemized with espeak-ng, then known mispronunciations are
corrected at the phoneme level before synthesis, so the spoken words can be
checked against the script (see verify_narration.py).

Usage: python3 -I narration.py <models_dir> <out_dir>
"""
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = Path(__file__).resolve().parent
LINES = json.loads((HERE / "narration_lines.json").read_text())

# espeak-ng drops the second syllable of "permeable" (PER-mə-bəl).
PHONEME_FIXES = {
    "pˈɜːməbəl": "pˈɜːmiəbəl",
}

VOICE = "af_heart"
SPEED = 1.0  # Kokoro natural rate (~150 words per minute): unhurried documentary pace


def main(models: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    k = Kokoro(str(models / "kokoro-v1.0.onnx"), str(models / "voices-v1.0.bin"))
    report = []
    for line in LINES:
        ph = k.tokenizer.phonemize(line["text"], "en-us")
        for bad, good in PHONEME_FIXES.items():
            ph = ph.replace(bad, good)
        audio, sr = k.create(ph, voice=VOICE, speed=SPEED, lang="en-us", is_phonemes=True)
        audio = np.asarray(audio, dtype=np.float32)
        # trim leading/trailing near-silence so timings are exact
        thr = 10 ** (-50 / 20)
        idx = np.where(np.abs(audio) > thr)[0]
        audio = audio[max(idx[0] - int(0.02 * sr), 0): idx[-1] + int(0.06 * sr)]
        path = out / f"{line['id']}.wav"
        sf.write(path, audio, sr, subtype="FLOAT")
        report.append({"id": line["id"], "seconds": round(len(audio) / sr, 3), "phonemes": ph})
        print(f"{line['id']}: {len(audio) / sr:6.2f}s  {line['text'][:60]}")
    (out / "narration_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print("total speech:", round(sum(r["seconds"] for r in report), 2), "s")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
