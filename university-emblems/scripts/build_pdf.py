#!/usr/bin/env python3
"""Lay out the downloaded emblems as a PDF atlas: by continent, alphabetical within each.

Reads data/universities.csv and emblems/manifest.json (written by
fetch_emblems.py) and writes output/University_Emblems_Atlas.pdf. With --split
it also writes one PDF per continent next to it.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from PIL import Image, ImageChops
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parent.parent
TITLE = "University Emblems of the World"

CONTINENT_LABELS = {"Oceania": "Australia & Oceania"}
LIST_NOTES = {
    "US top 150": "United States: 150 leading national universities, chosen with reference to "
                  "the U.S. News & World Report Best National Universities ranking.",
    "UK top 50": "United Kingdom: 50 leading universities, chosen with reference to the QS World "
                 "University Rankings and the UK league tables.",
    "Europe top 100 (excl. UK)": "Continental Europe: 100 leading universities outside the UK, chosen "
                                 "with reference to the QS World University Rankings.",
    "Asia top 100": "Asia, including the Middle East and Central Asia: 100 leading universities, chosen "
                    "with reference to the QS World University Rankings.",
    "Australia & Oceania 50": "Australia & Oceania: all 41 Australian universities, the eight New Zealand "
                              "universities and the University of the South Pacific.",
    "Africa top 50": "Africa: 50 leading universities, chosen with reference to the THE and QS World "
                     "University Rankings.",
}

INK = colors.HexColor("#1B2333")
MUTED = colors.HexColor("#5F6B7A")
RULE = colors.HexColor("#D5DBE3")
ACCENT = colors.HexColor("#1F3A5F")
TINT = colors.HexColor("#EEF2F7")

PAGE_W, PAGE_H = A4
MARGIN_X = 15 * mm
GRID_TOP = PAGE_H - 24 * mm
GRID_BOTTOM = 16 * mm
COLS, ROWS = 3, 4
PER_PAGE = COLS * ROWS
GUTTER_X, GUTTER_Y = 5 * mm, 4.5 * mm
CELL_W = (PAGE_W - 2 * MARGIN_X - (COLS - 1) * GUTTER_X) / COLS
CELL_H = (GRID_TOP - GRID_BOTTOM - (ROWS - 1) * GUTTER_Y) / ROWS
PAD = 3.5 * mm
BOX_H = 40 * mm

FONT_FILES = {
    "Sans": ("liberation/LiberationSans-Regular.ttf", "dejavu/DejaVuSans.ttf"),
    "Sans-Bold": ("liberation/LiberationSans-Bold.ttf", "dejavu/DejaVuSans-Bold.ttf"),
    "Serif-Bold": ("liberation/LiberationSerif-Bold.ttf", "dejavu/DejaVuSerif-Bold.ttf"),
}
FONT_DIRS = (Path("/usr/share/fonts/truetype"), Path("/usr/share/fonts"))
BUILTIN_FONTS = {"Sans": "Helvetica", "Sans-Bold": "Helvetica-Bold", "Serif-Bold": "Times-Bold"}


@dataclass
class Entry:
    continent: str
    country: str
    name: str
    group: str
    slug: str
    emblem: dict | None = None    # manifest record, when an emblem was downloaded
    image: Path | None = None     # prepared JPEG for the page
    size: tuple[int, int] = (0, 0)
    page: int = 0


@dataclass
class Section:
    label: str
    entries: list[Entry] = field(default_factory=list)

    @property
    def key(self) -> str:
        return "section-" + slugify(self.label)


@dataclass
class Line:
    text: str
    font: str
    size: float
    color: colors.Color = INK
    right: str = ""          # right-aligned text, joined to `text` by a dotted leader
    indent: float = 0
    link: str = ""           # bookmark key the line jumps to


@dataclass
class Block:
    lines: list[Line]
    keep_with_next: bool = False
    gap_before: float = 0

    @property
    def height(self) -> float:
        return self.gap_before + sum(line.size * 1.25 for line in self.lines)


def slugify(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "-", ascii_text).strip("-").lower()


def sort_key(name: str) -> str:
    text = unicodedata.normalize("NFKD", name)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"^the\s+", "", text, flags=re.I).casefold()


def register_fonts() -> dict[str, str]:
    fonts = dict(BUILTIN_FONTS)
    for alias, files in FONT_FILES.items():
        path = next((base / f for f in files for base in FONT_DIRS if (base / f).exists()), None)
        if path:
            pdfmetrics.registerFont(TTFont(alias, str(path)))
            fonts[alias] = alias
    return fonts


def rasterize_svg(src: Path, dest: Path, px: int) -> Path:
    """Fallback for SVGs without a Wikimedia rendering: CairoSVG, else rsvg-convert."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        import cairosvg
    except (ImportError, OSError):  # OSError: the cairo library itself is missing
        cairosvg = None
    if cairosvg:
        cairosvg.svg2png(url=str(src), write_to=str(dest), output_width=px)
        return dest
    if shutil.which("rsvg-convert"):
        subprocess.run(["rsvg-convert", "-w", str(px), "-o", str(dest), str(src)],
                       check=True, capture_output=True, timeout=180)
        return dest
    raise OSError("no SVG renderer found; pip install cairosvg, or install librsvg")


def prepare_image(src: Path, dest: Path, max_px: int, quality: int) -> tuple[int, int]:
    """Flatten onto white, trim the empty margin, cap the size and save as JPEG (or PNG)."""
    if dest.exists() and dest.stat().st_mtime >= src.stat().st_mtime:
        with Image.open(dest) as im:
            return im.size
    if src.suffix.lower() == ".svg":
        src = rasterize_svg(src, dest.with_suffix(".svg.png"), max_px * 2)
    with Image.open(src) as im:
        im.seek(0)
        if im.mode in ("I", "I;16", "F"):
            im = im.point(lambda v: v / 256).convert("L")
        rgba = im.convert("RGBA")
    flat = Image.alpha_composite(Image.new("RGBA", rgba.size, "white"), rgba).convert("RGB")
    ink = ImageChops.difference(flat, Image.new("RGB", flat.size, "white")).convert("L")
    bbox = ink.point(lambda v: 255 if v > 10 else 0).getbbox()
    if bbox:
        pad = round(max(bbox[2] - bbox[0], bbox[3] - bbox[1]) * 0.02)
        flat = flat.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad),
                          min(flat.width, bbox[2] + pad), min(flat.height, bbox[3] + pad)))
    flat.thumbnail((max_px, max_px), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.suffix == ".png":
        flat.save(dest, "PNG", optimize=True)
    else:
        flat.save(dest, "JPEG", quality=quality, subsampling=0, optimize=True)
    return flat.size


def load_entries(csv_path: Path, manifest: dict) -> list[Entry]:
    with csv_path.open(encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    entries = []
    for row in rows:
        slug = slugify(row["name"])
        record = manifest.get(slug)
        entries.append(Entry(row["continent"], row["country"], row["name"], row["list"], slug,
                             emblem=record if record and record.get("status") == "ok" else None))
    return entries


def make_sections(entries: list[Entry]) -> list[Section]:
    by_label: dict[str, Section] = {}
    for entry in entries:
        label = CONTINENT_LABELS.get(entry.continent, entry.continent)
        by_label.setdefault(label, Section(label)).entries.append(entry)
    sections = sorted(by_label.values(), key=lambda s: sort_key(s.label))
    for section in sections:
        section.entries.sort(key=lambda e: sort_key(e.name))
    return sections


def ordered_groups(sections: list[Section]) -> list[str]:
    """The source lists behind these sections, in section order and then LIST_NOTES order."""
    order = list(LIST_NOTES)
    present = {(i, e.group) for i, s in enumerate(sections) for e in s.entries}
    ranked = sorted(present, key=lambda p: (p[0], order.index(p[1]) if p[1] in order else len(order), p[1]))
    return list(dict.fromkeys(group for _, group in ranked))


def column_width(columns: int) -> float:
    return (PAGE_W - 2 * MARGIN_X - (columns - 1) * 7 * mm) / columns


class Atlas:
    """Draws the atlas onto one canvas. Page numbers for the contents come from a first pass."""

    def __init__(self, target, fonts: dict[str, str], title: str, known_pages: dict[str, int],
                 draw_images: bool):
        self.c = canvas.Canvas(target, pagesize=A4, pageCompression=1)
        self.c.setTitle(title)
        self.c.setAuthor("Compiled from Wikipedia and Wikimedia Commons")
        self.c.setSubject("Seals, coats of arms and logos of leading universities, by continent")
        self.f = fonts
        self.title = title
        self.known = known_pages
        self.pages: dict[str, int] = {}
        self.draw_images = draw_images
        self.page = 1

    # -- page furniture ---------------------------------------------------

    def end_page(self) -> None:
        self.c.showPage()
        self.page += 1

    def running_header(self, label: str) -> None:
        c = self.c
        c.setFont(self.f["Sans-Bold"], 8.5)
        c.setFillColor(ACCENT)
        self.spaced(label.upper(), MARGIN_X, PAGE_H - 15 * mm, 8.5, 1.2, bold=True)
        c.setFont(self.f["Sans"], 8)
        c.setFillColor(MUTED)
        c.drawRightString(PAGE_W - MARGIN_X, PAGE_H - 15 * mm, self.title)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.6)
        c.line(MARGIN_X, PAGE_H - 18 * mm, PAGE_W - MARGIN_X, PAGE_H - 18 * mm)

    def footer(self) -> None:
        self.c.setFont(self.f["Sans"], 8)
        self.c.setFillColor(MUTED)
        self.c.drawCentredString(PAGE_W / 2, 9 * mm, str(self.page))

    def spaced(self, text: str, x: float, y: float, size: float, spacing: float,
               bold: bool = False, centre: bool = False) -> None:
        font = self.f["Sans-Bold" if bold else "Sans"]
        if centre:
            width = pdfmetrics.stringWidth(text, font, size) + spacing * max(len(text) - 1, 0)
            x -= width / 2
        # Character spacing is part of the PDF graphics state, so confine it.
        self.c.saveState()
        t = self.c.beginText(x, y)
        t.setFont(font, size)
        t.setCharSpace(spacing)
        t.textOut(text)
        self.c.drawText(t)
        self.c.restoreState()

    def paragraph(self, text: str, x: float, y: float, width: float, font: str, size: float,
                  color=INK, leading: float = 1.35) -> float:
        self.c.setFont(font, size)
        self.c.setFillColor(color)
        for line in simpleSplit(text, font, size, width):
            self.c.drawString(x, y, line)
            y -= size * leading
        return y

    # -- front matter -----------------------------------------------------

    def cover(self, sections: list[Section], subtitle: str) -> None:
        c = self.c
        c.setFillColor(ACCENT)
        c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        x = MARGIN_X + 6 * mm
        width = PAGE_W - 2 * x
        c.setFillColor(colors.white)
        self.spaced("ATLAS", x, PAGE_H - 70 * mm, 10, 4, bold=True)
        y = PAGE_H - 88 * mm
        c.setFont(self.f["Serif-Bold"], 34)
        for line in simpleSplit(self.title, self.f["Serif-Bold"], 34, width):
            c.drawString(x, y, line)
            y -= 40
        y = self.paragraph(subtitle, x, y - 4 * mm, width, self.f["Sans"], 13, colors.white)
        y -= 14 * mm
        c.setStrokeColor(colors.Color(1, 1, 1, alpha=0.35))
        c.setLineWidth(0.8)
        for section in sections:
            c.line(x, y + 5.5 * mm, x + width, y + 5.5 * mm)
            c.setFont(self.f["Sans-Bold"], 12)
            c.setFillColor(colors.white)
            c.drawString(x, y, section.label)
            c.setFont(self.f["Sans"], 12)
            c.drawRightString(x + width, y, f"{len(section.entries)} universities")
            y -= 11 * mm
        c.line(x, y + 5.5 * mm, x + width, y + 5.5 * mm)
        c.setFillColor(colors.Color(1, 1, 1, alpha=0.8))
        self.paragraph("Arranged by continent and alphabetically within each continent. Emblems from "
                       "Wikipedia and Wikimedia Commons.", x, 32 * mm, width, self.f["Sans"], 9.5,
                       colors.Color(1, 1, 1, alpha=0.8))
        c.setFont(self.f["Sans"], 9.5)
        c.drawString(x, 20 * mm, date.today().strftime("%B %Y"))
        self.end_page()

    def contents(self, sections: list[Section]) -> None:
        c = self.c
        x, width = MARGIN_X, PAGE_W - 2 * MARGIN_X
        c.setFont(self.f["Serif-Bold"], 26)
        c.setFillColor(INK)
        c.drawString(x, PAGE_H - 35 * mm, "Contents")
        y = PAGE_H - 52 * mm
        rows = [(s.label, f"{len(s.entries)} universities", s.key) for s in sections]
        rows += [("Index by country", "", "index"), ("Image sources and licences", "", "sources")]
        for label, note, key in rows:
            page = str(self.known.get(key, ""))
            c.setFont(self.f["Sans-Bold"], 12)
            c.setFillColor(INK)
            c.drawString(x, y, label)
            end = x + pdfmetrics.stringWidth(label, self.f["Sans-Bold"], 12)
            if note:
                c.setFont(self.f["Sans"], 10)
                c.setFillColor(MUTED)
                c.drawString(end + 3 * mm, y, note)
                end += 3 * mm + pdfmetrics.stringWidth(note, self.f["Sans"], 10)
            c.setFont(self.f["Sans"], 12)
            c.setFillColor(INK)
            c.drawRightString(x + width, y, page)
            self.leader(end + 2 * mm, x + width - pdfmetrics.stringWidth(page, self.f["Sans"], 12) - 2 * mm, y)
            c.linkRect("", key, (x, y - 2 * mm, x + width, y + 5 * mm), relative=0, thickness=0)
            y -= 10 * mm

        y -= 8 * mm
        c.setFont(self.f["Serif-Bold"], 15)
        c.setFillColor(INK)
        c.drawString(x, y, "About this atlas")
        y -= 8 * mm
        for group in ordered_groups(sections):
            y = self.paragraph(LIST_NOTES.get(group, group), x, y, width, self.f["Sans"], 9.5) - 2 * mm
        notes = (
            "Positions near the end of each list differ between ranking systems, so the selection is "
            "a reasoned compilation rather than one league table; within each continent the "
            "universities are listed alphabetically.",
            "Each emblem is the seal, coat of arms or crest shown on the university's English "
            "Wikipedia article, or its logo where no emblem is published, at the highest resolution "
            "available. Selecting an emblem opens its source file; selecting a name opens the "
            "Wikipedia article.",
            "Emblems, seals, coats of arms and logos are the property of their institutions and are "
            "reproduced for identification and reference only. The licence of every image is listed "
            "under Image sources and licences.",
        )
        for note in notes:
            y = self.paragraph(note, x, y, width, self.f["Sans"], 9.5, MUTED) - 2 * mm
        self.footer()
        self.end_page()

    def leader(self, x1: float, x2: float, y: float) -> None:
        if x2 - x1 < 4:
            return
        self.c.saveState()
        self.c.setStrokeColor(RULE)
        self.c.setLineWidth(0.8)
        self.c.setDash(0.8, 2.2)
        self.c.line(x1, y + 0.6 * mm, x2, y + 0.6 * mm)
        self.c.restoreState()

    # -- continent sections -----------------------------------------------

    def divider(self, section: Section) -> None:
        c = self.c
        self.pages[section.key] = self.page
        c.bookmarkPage(section.key)
        c.addOutlineEntry(section.label, section.key, level=0, closed=True)
        c.setFillColor(TINT)
        c.rect(0, PAGE_H * 0.42, PAGE_W, PAGE_H * 0.58, fill=1, stroke=0)
        x, width = MARGIN_X + 6 * mm, PAGE_W - 2 * MARGIN_X - 12 * mm
        c.setFillColor(ACCENT)
        self.spaced("CONTINENT", x, PAGE_H - 80 * mm, 10, 4, bold=True)
        c.setFont(self.f["Serif-Bold"], 44)
        c.setFillColor(INK)
        y = PAGE_H - 102 * mm
        for line in simpleSplit(section.label, self.f["Serif-Bold"], 44, width):
            c.drawString(x, y, line)
            y -= 50
        c.setFont(self.f["Sans"], 14)
        c.setFillColor(MUTED)
        c.drawString(x, y - 2 * mm, f"{len(section.entries)} universities, in alphabetical order")
        y = PAGE_H * 0.42 - 16 * mm
        countries = sorted({e.country for e in section.entries}, key=sort_key)
        c.setFont(self.f["Sans-Bold"], 10)
        c.setFillColor(INK)
        c.drawString(x, y, "Countries and territories")
        y = self.paragraph(", ".join(countries), x, y - 6 * mm, width, self.f["Sans"], 10) - 6 * mm
        c.setFont(self.f["Sans-Bold"], 10)
        c.setFillColor(INK)
        c.drawString(x, y, "Selection")
        y -= 6 * mm
        for group in ordered_groups([section]):
            y = self.paragraph(LIST_NOTES.get(group, group), x, y, width, self.f["Sans"], 10, MUTED) - 2 * mm
        self.footer()
        self.end_page()

    def grid(self, section: Section) -> None:
        for start in range(0, len(section.entries), PER_PAGE):
            self.running_header(section.label)
            for i, entry in enumerate(section.entries[start:start + PER_PAGE]):
                col, row = i % COLS, i // COLS
                self.card(entry, MARGIN_X + col * (CELL_W + GUTTER_X), GRID_TOP - row * (CELL_H + GUTTER_Y))
            self.footer()
            self.end_page()

    def card(self, entry: Entry, x: float, top: float) -> None:
        c = self.c
        entry.page = self.page
        self.pages[entry.slug] = self.page
        c.bookmarkHorizontal(entry.slug, x, top + 2 * mm)
        c.addOutlineEntry(entry.name, entry.slug, level=1)
        c.setStrokeColor(RULE)
        c.setLineWidth(0.6)
        c.roundRect(x, top - CELL_H, CELL_W, CELL_H, 2.2 * mm, stroke=1, fill=0)

        box_x, box_w = x + PAD, CELL_W - 2 * PAD
        box_y = top - PAD - BOX_H
        if entry.image:
            iw, ih = entry.size
            scale = min(box_w / iw, BOX_H / ih)
            w, h = iw * scale, ih * scale
            ix, iy = box_x + (box_w - w) / 2, box_y + (BOX_H - h) / 2
            if self.draw_images:
                c.drawImage(str(entry.image), ix, iy, w, h)
            if entry.emblem.get("file_page"):
                c.linkURL(entry.emblem["file_page"], (ix, iy, ix + w, iy + h), relative=0, thickness=0)
        else:
            c.saveState()
            c.setDash(2, 2)
            c.setStrokeColor(RULE)
            side = min(box_w, BOX_H) * 0.8
            c.roundRect(box_x + (box_w - side) / 2, box_y + (BOX_H - side) / 2, side, side, 3 * mm)
            c.restoreState()
            c.setFont(self.f["Sans"], 7.5)
            c.setFillColor(MUTED)
            c.drawCentredString(x + CELL_W / 2, box_y + BOX_H / 2 - 1 * mm, "Emblem not available")

        size = 8.8
        lines = simpleSplit(entry.name, self.f["Sans-Bold"], size, box_w)
        while len(lines) > 3 and size > 6.4:
            size -= 0.3
            lines = simpleSplit(entry.name, self.f["Sans-Bold"], size, box_w)
        c.setFont(self.f["Sans-Bold"], size)
        c.setFillColor(INK)
        y = box_y - 4.6 * mm
        for line in lines[:3]:
            c.drawCentredString(x + CELL_W / 2, y, line)
            y -= size * 1.2
        if entry.emblem and entry.emblem.get("wikipedia_url"):
            c.linkURL(entry.emblem["wikipedia_url"], (box_x, y + size * 0.6, box_x + box_w, box_y - 1 * mm),
                      relative=0, thickness=0)
        c.setFillColor(MUTED)
        self.spaced(entry.country.upper(), x + CELL_W / 2, top - CELL_H + PAD + 0.5 * mm, 6.6, 0.6, centre=True)

    # -- back matter ------------------------------------------------------

    def flow(self, key: str, heading: str, blocks: list[Block], columns: int) -> None:
        """Pour blocks of lines into columns, page after page."""
        self.pages[key] = self.page
        self.c.bookmarkPage(key)
        self.c.addOutlineEntry(heading, key, level=0, closed=True)
        col_w = column_width(columns)
        first_top = PAGE_H - 40 * mm
        page_top = PAGE_H - 26 * mm

        def start_page(first: bool) -> float:
            self.running_header(heading)
            if first:
                self.c.setFont(self.f["Serif-Bold"], 22)
                self.c.setFillColor(INK)
                self.c.drawString(MARGIN_X, PAGE_H - 32 * mm, heading)
                return first_top
            return page_top

        top = start_page(True)
        col, y = 0, top
        for i, block in enumerate(blocks):
            need = block.height
            if block.keep_with_next and i + 1 < len(blocks):
                need += blocks[i + 1].height
            if y - need < GRID_BOTTOM:
                col += 1
                if col == columns:
                    self.footer()
                    self.end_page()
                    top = start_page(False)
                    col = 0
                y = top
            elif y != top:
                y -= block.gap_before
            x = MARGIN_X + col * (col_w + 7 * mm)
            for line in block.lines:
                y -= line.size * 1.25
                self.c.setFont(line.font, line.size)
                self.c.setFillColor(line.color)
                self.c.drawString(x + line.indent, y, line.text)
                if line.right:
                    self.c.drawRightString(x + col_w, y, line.right)
                    end = x + line.indent + pdfmetrics.stringWidth(line.text, line.font, line.size)
                    self.leader(end + 1.5 * mm,
                                x + col_w - pdfmetrics.stringWidth(line.right, line.font, line.size) - 1.5 * mm,
                                y - 0.5 * mm)
                if line.link:
                    self.c.linkRect("", line.link, (x, y - 1, x + col_w, y + line.size), relative=0, thickness=0)
        self.footer()
        self.end_page()

    def country_index(self, sections: list[Section]) -> None:
        col_w = column_width(2)
        blocks = []
        for section in sections:
            blocks.append(Block([Line(section.label.upper(), self.f["Sans-Bold"], 9, ACCENT)],
                                keep_with_next=True, gap_before=4 * mm))
            by_country: dict[str, list[Entry]] = defaultdict(list)
            for entry in section.entries:
                by_country[entry.country].append(entry)
            for country in sorted(by_country, key=sort_key):
                blocks.append(Block([Line(country, self.f["Sans-Bold"], 8, INK)],
                                    keep_with_next=True, gap_before=1.5 * mm))
                for entry in by_country[country]:
                    page = str(self.known.get(entry.slug, ""))
                    room = col_w - 3 * mm - pdfmetrics.stringWidth("0000", self.f["Sans"], 7.6)
                    parts = simpleSplit(entry.name, self.f["Sans"], 7.6, room)
                    lines = [Line(p, self.f["Sans"], 7.6, indent=3 * mm, link=entry.slug) for p in parts]
                    lines[-1].right = page
                    blocks.append(Block(lines))
        self.flow("index", "Index by country", blocks, columns=2)

    def sources(self, sections: list[Section]) -> None:
        col_w = column_width(2)
        blocks = []
        for section in sections:
            blocks.append(Block([Line(section.label.upper(), self.f["Sans-Bold"], 8.5, ACCENT)],
                                keep_with_next=True, gap_before=3 * mm))
            for entry in section.entries:
                lines = [Line(p, self.f["Sans-Bold"], 6.6, INK, link=entry.slug)
                         for p in simpleSplit(entry.name, self.f["Sans-Bold"], 6.6, col_w)]
                record = entry.emblem
                if record:
                    detail = record.get("file", "").removeprefix("File:")
                    licence = record.get("license") or ("non-free (fair use on Wikipedia)" if record.get("non_free") else "")
                    for part in (licence, record.get("artist", "")[:160]):
                        if part:
                            detail += "  ·  " + part
                else:
                    detail = "No emblem was found on Wikipedia or Wikidata."
                lines += [Line(p, self.f["Sans"], 6.3, MUTED, indent=2 * mm)
                          for p in simpleSplit(detail, self.f["Sans"], 6.3, col_w - 2 * mm)]
                blocks.append(Block(lines, gap_before=1 * mm))
        self.flow("sources", "Image sources and licences", blocks, columns=2)

    def save(self) -> None:
        self.c.save()


def render(path: Path, sections: list[Section], title: str, subtitle: str, fonts: dict[str, str]) -> None:
    def draw(target, known: dict[str, int], draw_images: bool) -> dict[str, int]:
        atlas = Atlas(target, fonts, title, known, draw_images)
        atlas.cover(sections, subtitle)
        atlas.contents(sections)
        for section in sections:
            atlas.divider(section)
            atlas.grid(section)
        atlas.country_index(sections)
        atlas.sources(sections)
        atlas.save()
        return atlas.pages

    pages = draw(io.BytesIO(), {}, draw_images=False)
    path.parent.mkdir(parents=True, exist_ok=True)
    draw(str(path), pages, draw_images=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", type=Path, default=ROOT / "data" / "universities.csv")
    parser.add_argument("--manifest", type=Path, default=ROOT / "emblems" / "manifest.json")
    parser.add_argument("--out", type=Path, default=ROOT / "output" / "University_Emblems_Atlas.pdf")
    parser.add_argument("--cache", type=Path, default=ROOT / "build" / "images",
                        help="where the page-ready JPEGs are kept between runs")
    parser.add_argument("--max-px", type=int, default=1200,
                        help="longest side of each embedded emblem (1200 px prints at over 600 dpi)")
    parser.add_argument("--quality", type=int, default=90, help="JPEG quality of embedded emblems")
    parser.add_argument("--lossless", action="store_true",
                        help="embed emblems losslessly instead of as JPEG (a much larger file)")
    parser.add_argument("--split", action="store_true", help="also write one PDF per continent")
    args = parser.parse_args()

    if not args.manifest.exists():
        print(f"{args.manifest} not found: run scripts/fetch_emblems.py first", file=sys.stderr)
        return 1
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    entries = load_entries(args.csv, manifest)
    for entry in entries:
        if not entry.emblem:
            continue
        src = entry.emblem.get("render") or entry.emblem["original"]
        src_path = Path(src) if Path(src).is_absolute() else args.manifest.parent.parent / src
        page_image = args.cache / f"{entry.slug}.{'png' if args.lossless else 'jpg'}"
        try:
            entry.size = prepare_image(src_path, page_image, args.max_px, args.quality)
            entry.image = page_image
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            print(f"  cannot use the emblem of {entry.name}: {exc}", file=sys.stderr)
            entry.emblem = None

    fonts = register_fonts()
    sections = make_sections(entries)
    total = sum(len(s.entries) for s in sections)
    subtitle = f"Seals, coats of arms and logos of {total} leading universities across {len(sections)} continents"
    render(args.out, sections, TITLE, subtitle, fonts)
    print(f"wrote {args.out} ({args.out.stat().st_size / 1e6:.1f} MB)")
    if args.split:
        for section in sections:
            path = args.out.with_name(f"{args.out.stem}_{slugify(section.label)}.pdf")
            render(path, [section], f"{TITLE}: {section.label}",
                   f"Seals, coats of arms and logos of {len(section.entries)} leading universities", fonts)
            print(f"wrote {path} ({path.stat().st_size / 1e6:.1f} MB)")

    missing = [e.name for e in entries if not e.image]
    if missing:
        print(f"{len(missing)} without an emblem: " + "; ".join(missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
