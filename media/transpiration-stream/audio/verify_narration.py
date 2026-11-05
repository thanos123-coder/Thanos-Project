"""Transcribe each narration clip with Whisper and diff it against the script.

Also records word-level timestamps, which are used to split the narration
into subtitle cues at natural phrase boundaries.

Usage: python3 -I verify_narration.py <whisper_model_dir> <narration_dir>
"""
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel
from scipy.signal import resample_poly

HERE = Path(__file__).resolve().parent
LINES = json.loads((HERE / "narration_lines.json").read_text())


def norm(s: str) -> list[str]:
    s = s.lower().replace("vapor", "vapour")
    return re.findall(r"[a-z]+", s)


def main(model_dir: str, nar: Path) -> None:
    model = WhisperModel(model_dir, device="cpu", compute_type="int8")
    out, all_ok = [], True
    for line in LINES:
        audio, sr = sf.read(nar / f"{line['id']}.wav", dtype="float32")
        audio = resample_poly(audio, 16000, sr).astype(np.float32)  # Whisper expects 16 kHz
        segs, _ = model.transcribe(audio, language="en",
                                   word_timestamps=True, beam_size=5)
        words = [{"w": w.word.strip(), "start": round(w.start, 3), "end": round(w.end, 3)}
                 for s in segs for w in s.words]
        heard = " ".join(w["w"] for w in words)
        a, b = norm(line["text"]), norm(heard)
        ratio = SequenceMatcher(None, a, b).ratio()
        ok = a == b
        all_ok &= ok
        print(f"{line['id']:4s} {'OK ' if ok else 'DIFF'} {ratio:.3f} | {heard}")
        if not ok:
            for op, i1, i2, j1, j2 in SequenceMatcher(None, a, b).get_opcodes():
                if op != "equal":
                    print(f"      {op}: script={a[i1:i2]} heard={b[j1:j2]}")
        out.append({"id": line["id"], "match": ok, "words": words})
    (nar / "word_timings.json").write_text(json.dumps(out, indent=1))
    print("ALL MATCH" if all_ok else "MISMATCHES FOUND")


if __name__ == "__main__":
    main(sys.argv[1], Path(sys.argv[2]))
