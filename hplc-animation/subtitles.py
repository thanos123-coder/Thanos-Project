"""Writes the Greek subtitles as an .srt file, using the same sentence timings the
animation burns into the picture (exported to build/anchors.json by render.cjs)."""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def stamp(t):
    ms = max(0, round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "hplc_explainer_el.srt")
    subs = json.load(open(os.path.join(HERE, "build", "anchors.json"), encoding="utf-8"))["subs"]
    with open(out, "w", encoding="utf-8") as f:
        for i, s in enumerate(subs, 1):
            f.write(f"{i}\n{stamp(s['t0'])} --> {stamp(s['t1'])}\n{s['text']}\n\n")
    print(f"wrote {len(subs)} subtitles to {out}")


if __name__ == "__main__":
    main()
