"""Build English subtitle files (SRT + styled ASS) from the narration timing.

Cue text comes from timeline.json; cue timing comes from Whisper word
timestamps of the synthesized narration (word_timings.json) offset by each
line's start time on the master timeline. The script checks that the cues of
each line reproduce the narration script exactly, word for word.

Usage: python3 -I build/subtitles.py <narration_dir> <out_dir>
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TL = json.loads((ROOT / "timeline.json").read_text())
LINES = {l["id"]: l["text"] for l in json.loads((ROOT / "audio" / "narration_lines.json").read_text())}

MAX_LINE = 50  # characters per subtitle line
# never break a line inside these terms
KEEP = ["hydrogen bonds", "root hair", "water potential", "carbon dioxide", "selectively permeable",
        "water vapour", "air spaces", "mesophyll cells", "xylem walls", "transpiration stream",
        "negative pressure", "water column", "liquid water", "water molecules"]


def words(s: str) -> list[str]:
    return re.findall(r"[A-Za-z']+", s.lower())


def wrap(text: str) -> list[str]:
    if len(text) <= MAX_LINE:
        return [text]
    # split into two balanced lines at a space
    best, cut = None, None
    for i, ch in enumerate(text):
        if ch == " ":
            a, b = text[:i], text[i + 1:]
            if any(a.endswith(k.split()[0]) and b.startswith(k.split()[1]) for k in KEEP):
                continue
            score = max(len(a), len(b)) + (0 if a.endswith(",") else 2)
            if best is None or score < best:
                best, cut = score, i
    return [text[:cut], text[cut + 1:]]


def ts_srt(t: float) -> str:
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def ts_ass(t: float) -> str:
    cs = int(round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def build(nar: Path) -> list[dict]:
    timing = {l["id"]: l["words"] for l in json.loads((nar / "word_timings.json").read_text())}
    cues = []
    for line_id, script in LINES.items():
        line_cues = [c for c in TL["subtitle_cues"] if c["line"] == line_id]
        joined = " ".join(c["text"] for c in line_cues)
        assert words(joined) == words(script), f"{line_id}: cue text differs from script"
        w = timing[line_id]
        assert len(w) == len(words(script)), f"{line_id}: word count mismatch with timings"
        t0 = TL["narration"][line_id]
        for c in line_cues:
            i, j = c["words"]
            assert words(c["text"]) == words(script)[i:j + 1], f"{line_id}: word range mismatch for {c['text']!r}"
            cues.append({"start": t0 + w[i]["start"] - 0.08, "end": t0 + w[j]["end"] + 0.30, "text": c["text"]})
    cues.sort(key=lambda c: c["start"])
    for a, b in zip(cues, cues[1:]):  # no overlaps, keep a small gap
        a["end"] = min(a["end"], b["start"] - 0.04)
    for c in cues:
        c["end"] = max(c["end"], c["start"] + 1.0)
    return cues


def main(nar: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    cues = build(nar)
    srt = []
    for n, c in enumerate(cues, 1):
        srt.append(f"{n}\n{ts_srt(c['start'])} --> {ts_srt(c['end'])}\n" + "\n".join(wrap(c["text"])) + "\n")
    (out / "transpiration_stream.en.srt").write_text("\n".join(srt), encoding="utf-8")

    W, H = TL["width"], TL["height"]
    ass = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {W}", f"PlayResY: {H}",
        "WrapStyle: 2", "ScaledBorderAndShadow: yes", "YCbCr Matrix: TV.709", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding",
        # white text, soft dark outline + shadow; bottom-centre, clear of the label area
        "Style: Sub,Inter Medium,84,&H00FFFFFF,&H00FFFFFF,&H90000000,&H78000000,"
        "0,0,0,0,100,100,0.6,0,1,3.2,2.4,2,320,320,120,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for c in cues:
        text = r"\N".join(wrap(c["text"]))
        ass.append(f"Dialogue: 0,{ts_ass(c['start'])},{ts_ass(c['end'])},Sub,,0,0,0,,{{\\fad(120,160)}}{text}")
    (out / "transpiration_stream.en.ass").write_text("\n".join(ass) + "\n", encoding="utf-8")
    (out / "subtitle_cues.json").write_text(json.dumps(cues, indent=1))
    for c in cues:
        print(f"{c['start']:6.2f}-{c['end']:6.2f}  {' / '.join(wrap(c['text']))}")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
