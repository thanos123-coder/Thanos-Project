#!/usr/bin/env python3
"""Download each university's emblem (seal, coat of arms or logo) from Wikipedia.

For every row of data/universities.csv this finds the emblem shown in the
university's English Wikipedia infobox, falling back to the seal, coat of arms
or logo recorded on Wikidata, and saves it into emblems/<continent>/:

  <slug>.svg / .png / .jpg   the original file, at full resolution
  <slug>.render.png          a high-resolution PNG rendering of SVG originals

emblems/manifest.json records the chosen file, where it came from and its
licence; build_pdf.py reads it.

Needs network access to en.wikipedia.org, upload.wikimedia.org,
commons.wikimedia.org and www.wikidata.org.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
WIKI_API = "https://en.wikipedia.org/w/api.php"
WIKIDATA_API = "https://www.wikidata.org/w/api.php"
USER_AGENT = ("UniversityEmblemAtlas/1.0 "
              "(https://github.com/thanos123-coder/Thanos-Project; one-off emblem collection)")

# Infobox parameters, most emblem-like first. "image" is where Infobox university
# puts the seal or coat of arms; "logo" holds the wordmark.
EMBLEM_PARAMS = ("seal", "seal_image", "coat_of_arms", "arms", "crest", "emblem", "shield",
                 "image", "image_name", "image_file")
LOGO_PARAMS = ("logo", "logo_image", "wordmark", "logo2")
# Wikidata statements: seal image, coat of arms image, logo image.
WIKIDATA_PROPS = (("P158", "emblem"), ("P94", "emblem"), ("P154", "logo"))

# Words that mark a JPEG as an emblem rather than a campus photograph.
EMBLEM_WORDS = re.compile(
    r"seal|coat|arms|crest|emblem|shield|insignia|logo|badge|escudo|wappen|siegel|sello|"
    r"bras[aã]o|stemma|sigillo|herb|blason|logotip|marca|symbol|mark", re.I)
IMAGE_EXT = r"svg|png|jpe?g|gif|tiff?|webp"
FILE_LINK = re.compile(r"\[\[\s*(?:File|Image)\s*:\s*([^|\]]+)", re.I)
BARE_FILE = re.compile(rf"(?:(?:File|Image)\s*:\s*)?([^\[\]|{{}}<>=\n]+?\.(?:{IMAGE_EXT}))\b", re.I)
# Raster originals larger than this are fetched as a thumbnail instead.
MAX_RASTER_SIDE = 4000


def slugify(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "-", ascii_text).strip("-").lower()


@dataclass
class University:
    continent: str
    country: str
    name: str
    title: str
    group: str

    @property
    def slug(self) -> str:
        return slugify(self.name)

    @property
    def folder(self) -> str:
        return slugify(self.continent)


@dataclass
class Candidate:
    file: str
    kind: str      # "emblem" or "logo"
    source: str    # e.g. "infobox:image", "wikidata:P158", "override"
    order: int = 0
    info: dict | None = None

    def tier(self, prefer: str) -> int:
        """Rank for choosing between candidates; lower is better."""
        svg = self.info["mime"] == "image/svg+xml"
        side = min(self.info.get("width", 0), self.info.get("height", 0))
        if not svg and self.info["mime"] == "image/jpeg" and not EMBLEM_WORDS.search(self.file):
            return 9  # probably a photograph of the campus
        if self.kind == prefer:
            if svg:
                return 0
            if side >= 800:
                return 1
            return 3 if side >= 300 else 5
        if svg:
            return 2
        return 4 if side >= 300 else 6

    def sort_key(self, prefer: str) -> tuple:
        pixels = 0 if self.info["mime"] == "image/svg+xml" else self.info.get("width", 0) * self.info.get("height", 0)
        return (self.tier(prefer), -pixels, self.order)


class Wiki:
    def __init__(self, pause: float):
        self.http = requests.Session()
        self.http.headers["User-Agent"] = USER_AGENT
        self.pause = pause

    def get(self, url: str, params: dict, retries: int = 6) -> dict:
        params = {**params, "format": "json", "formatversion": "2", "maxlag": "5"}
        delay, error = 2.0, ""
        for _ in range(retries):
            time.sleep(self.pause)
            try:
                resp = self.http.get(url, params=params, timeout=60)
            except requests.RequestException as exc:
                error = str(exc)
            else:
                if resp.status_code == 200:
                    data = resp.json()
                    code = data.get("error", {}).get("code")
                    if code is None:
                        return data
                    if code != "maxlag":
                        raise RuntimeError(f"API error from {url}: {data['error']}")
                    error = "maxlag"
                elif resp.status_code in (429, 500, 502, 503, 504):
                    error = f"HTTP {resp.status_code}"
                else:
                    resp.raise_for_status()
            time.sleep(delay)
            delay *= 2
        raise RuntimeError(f"giving up on {url} ({error})")

    def download(self, url: str, dest: Path, retries: int = 6) -> None:
        delay, error = 2.0, ""
        for _ in range(retries):
            time.sleep(self.pause)
            try:
                resp = self.http.get(url, timeout=120)
            except requests.RequestException as exc:
                error = str(exc)
            else:
                if resp.status_code == 200 and resp.content:
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    tmp = dest.with_suffix(dest.suffix + ".part")
                    tmp.write_bytes(resp.content)
                    tmp.replace(dest)
                    return
                if resp.status_code not in (429, 500, 502, 503, 504):
                    resp.raise_for_status()
                error = f"HTTP {resp.status_code}"
            time.sleep(delay)
            delay *= 2
        raise RuntimeError(f"giving up on {url} ({error})")

    def page(self, title: str) -> dict | None:
        """Lead-section wikitext and Wikidata id of an article, following redirects."""
        data = self.get(WIKI_API, {
            "action": "query", "titles": title, "redirects": "1",
            "prop": "revisions|pageprops", "rvprop": "content", "rvslots": "main",
            "rvsection": "0", "ppprop": "wikibase_item|disambiguation",
        })
        pages = data.get("query", {}).get("pages", [])
        if not pages:
            return None
        page = pages[0]
        props = page.get("pageprops", {})
        if page.get("missing") or page.get("invalid") or "disambiguation" in props:
            return None
        revisions = page.get("revisions") or [{}]
        wikitext = revisions[0].get("slots", {}).get("main", {}).get("content", "")
        return {"title": page["title"], "wikitext": wikitext, "wikidata": props.get("wikibase_item")}

    def search(self, query: str) -> str | None:
        data = self.get(WIKI_API, {"action": "query", "list": "search", "srsearch": query,
                                   "srlimit": "1", "srnamespace": "0"})
        hits = data.get("query", {}).get("search", [])
        return hits[0]["title"] if hits else None

    def wikidata_candidates(self, qids: list[str]) -> dict[str, list[Candidate]]:
        found: dict[str, list[Candidate]] = {}
        qids = sorted(set(qids))
        for i in range(0, len(qids), 50):
            data = self.get(WIKIDATA_API, {"action": "wbgetentities", "props": "claims",
                                           "ids": "|".join(qids[i:i + 50])})
            for qid, entity in data.get("entities", {}).items():
                claims = entity.get("claims", {})
                cands = []
                for prop, kind in WIKIDATA_PROPS:
                    statements = [s for s in claims.get(prop, []) if s.get("rank") != "deprecated"]
                    statements.sort(key=lambda s: s.get("rank") != "preferred")
                    for statement in statements:
                        value = statement.get("mainsnak", {}).get("datavalue", {}).get("value")
                        if isinstance(value, str):
                            cands.append(Candidate(value, kind, f"wikidata:{prop}"))
                found[qid] = cands
        return found

    def file_info(self, names: list[str], width: int) -> dict[str, dict]:
        """imageinfo for files on English Wikipedia or Commons, keyed by requested name."""
        info: dict[str, dict] = {}
        names = sorted(set(names))
        for i in range(0, len(names), 40):
            chunk = names[i:i + 40]
            data = self.get(WIKI_API, {
                "action": "query", "redirects": "1", "prop": "imageinfo",
                "titles": "|".join("File:" + n for n in chunk),
                "iiprop": "url|size|mime|extmetadata", "iiurlwidth": str(width),
                "iiextmetadatafilter": "LicenseShortName|Artist|Credit|NonFree|AttributionRequired",
            })
            query = data.get("query", {})
            requested = {"File:" + n: n for n in chunk}
            for step in ("normalized", "redirects"):
                for move in query.get(step, []):
                    if move["from"] in requested:
                        requested[move["to"]] = requested.pop(move["from"])
            for page in query.get("pages", []):
                if page.get("imageinfo") and page["title"] in requested:
                    info[requested[page["title"]]] = page["imageinfo"][0]
        return info


def first_infobox(wikitext: str) -> str | None:
    text = re.sub(r"<!--.*?-->", "", wikitext, flags=re.S)
    match = re.search(r"\{\{\s*Infobox", text, flags=re.I)
    if not match:
        return None
    depth, i = 0, match.start()
    while i < len(text):
        if text.startswith("{{", i):
            depth += 1
            i += 2
        elif text.startswith("}}", i):
            depth -= 1
            i += 2
            if depth == 0:
                return text[match.start():i]
        else:
            i += 1
    return text[match.start():]


def template_params(template: str) -> dict[str, str]:
    """Named parameters of a template, splitting only on top-level pipes."""
    body = template[2:-2]
    parts, current = [], []
    braces = brackets = 0
    i = 0
    while i < len(body):
        pair = body[i:i + 2]
        if pair in ("{{", "}}", "[[", "]]"):
            braces += {"{{": 1, "}}": -1}.get(pair, 0)
            brackets += {"[[": 1, "]]": -1}.get(pair, 0)
            current.append(pair)
            i += 2
            continue
        if body[i] == "|" and braces == 0 and brackets == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(body[i])
        i += 1
    parts.append("".join(current))
    params = {}
    for part in parts[1:]:
        if "=" in part:
            key, value = part.split("=", 1)
            params[key.strip().lower().replace(" ", "_")] = value.strip()
    return params


def file_from_value(value: str) -> str | None:
    value = re.sub(r"<ref[^>]*/>|<ref.*?</ref>", "", value, flags=re.S | re.I)
    match = FILE_LINK.search(value) or BARE_FILE.search(value)
    if not match:
        return None
    name = match.group(1).strip().replace("_", " ")
    return name or None


def infobox_candidates(wikitext: str) -> list[Candidate]:
    infobox = first_infobox(wikitext)
    if not infobox:
        return []
    params = template_params(infobox)
    cands = []
    for kind, keys in (("emblem", EMBLEM_PARAMS), ("logo", LOGO_PARAMS)):
        for key in keys:
            name = file_from_value(params.get(key, ""))
            if name and all(c.file != name for c in cands):
                cands.append(Candidate(name, kind, f"infobox:{key}"))
    return cands


def plain(html: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", html or "")).strip()


def read_universities(path: Path) -> list[University]:
    with path.open(encoding="utf-8", newline="") as f:
        return [University(r["continent"], r["country"], r["name"], r["wikipedia_title"], r["list"])
                for r in csv.DictReader(f)]


def read_overrides(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8", newline="") as f:
        return {r["name"]: r["file"].removeprefix("File:").strip() for r in csv.DictReader(f) if r.get("file")}


def related(name: str, title: str) -> bool:
    """Whether a search hit plausibly is the university we asked for."""
    words = {w for w in re.findall(r"\w+", name.lower()) if len(w) > 3}
    words -= {"university", "université", "universiti", "universitas", "college", "institute",
              "technology", "science", "sciences", "national", "state"}
    return not words or any(w in title.lower() for w in words)


def render_urls(thumburl: str, width: int) -> list[str]:
    """The requested PNG rendering of an SVG, then smaller standard widths."""
    urls = [thumburl] + [thumburl.replace(f"/{width}px-", f"/{w}px-") for w in (1280, 960) if w < width]
    return list(dict.fromkeys(urls))


def rel(path: Path) -> str:
    return path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path)


def is_done(entry: dict | None) -> bool:
    return bool(entry and entry.get("status") == "ok" and (ROOT / entry["original"]).exists())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", type=Path, default=ROOT / "data" / "universities.csv")
    parser.add_argument("--overrides", type=Path, default=ROOT / "data" / "overrides.csv",
                        help="CSV of name,file pairs that force a particular Wikimedia file")
    parser.add_argument("--out", type=Path, default=ROOT / "emblems")
    parser.add_argument("--render-width", type=int, default=1920,
                        help="width in px of the PNG rendered from SVG originals")
    parser.add_argument("--prefer", choices=("emblem", "logo"), default="emblem",
                        help="prefer seals and coats of arms (default) or logos")
    parser.add_argument("--only", help="process only universities whose name contains this text")
    parser.add_argument("--refresh", action="store_true", help="re-download even if already present")
    parser.add_argument("--pause", type=float, default=0.25, help="seconds between requests")
    args = parser.parse_args()

    universities = read_universities(args.csv)
    overrides = read_overrides(args.overrides)
    manifest_path = args.out / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    todo = [u for u in universities
            if (args.refresh or not is_done(manifest.get(u.slug)))
            and (not args.only or args.only.lower() in u.name.lower())]
    print(f"{len(universities)} universities, {len(todo)} to fetch")
    wiki = Wiki(args.pause)

    def save_manifest() -> None:
        args.out.mkdir(parents=True, exist_ok=True)
        ordered = {u.slug: manifest[u.slug] for u in universities if u.slug in manifest}
        manifest_path.write_text(json.dumps(ordered, indent=1, ensure_ascii=False), encoding="utf-8")

    # 1. Find each article and the files named in its infobox.
    pages: dict[str, dict] = {}
    cands: dict[str, list[Candidate]] = {}
    for n, uni in enumerate(todo, 1):
        page = wiki.page(uni.title)
        if page is None:
            hit = wiki.search(uni.name)
            page = wiki.page(hit) if hit and related(uni.name, hit) else None
        if page is None:
            print(f"  [{n}/{len(todo)}] {uni.name}: no Wikipedia article found")
            manifest[uni.slug] = {"name": uni.name, "country": uni.country, "continent": uni.continent,
                                  "list": uni.group, "status": "no article"}
            continue
        pages[uni.slug] = page
        cands[uni.slug] = infobox_candidates(page["wikitext"])
        if n % 25 == 0:
            print(f"  [{n}/{len(todo)}] articles read")

    # 2. Add the seal / coat of arms / logo statements from Wikidata.
    qids = [p["wikidata"] for p in pages.values() if p.get("wikidata")]
    from_wikidata = wiki.wikidata_candidates(qids) if qids else {}
    for slug, page in pages.items():
        for cand in from_wikidata.get(page.get("wikidata"), []):
            if all(c.file != cand.file for c in cands[slug]):
                cands[slug].append(cand)

    # 3. Overrides replace everything else.
    for uni in todo:
        if uni.name in overrides:
            cands[uni.slug] = [Candidate(overrides[uni.name], "emblem", "override")]

    # Tie-break order: infobox before Wikidata, preferred kind first.
    for found in cands.values():
        for cand in found:
            cand.order = (0 if cand.kind == args.prefer else 2) + (1 if cand.source.startswith("wikidata") else 0)

    # 4. Look up every candidate file, pick the best one and download it.
    info = wiki.file_info([c.file for found in cands.values() for c in found], args.render_width)
    for n, uni in enumerate(todo, 1):
        if uni.slug not in pages:
            continue
        page = pages[uni.slug]
        entry = {
            "name": uni.name, "country": uni.country, "continent": uni.continent, "list": uni.group,
            "wikipedia_title": page["title"],
            "wikipedia_url": "https://en.wikipedia.org/wiki/" + page["title"].replace(" ", "_"),
        }
        usable = [c for c in cands.get(uni.slug, []) if c.file in info]
        for c in usable:
            c.info = info[c.file]
        if not usable:
            manifest[uni.slug] = {**entry, "status": "no emblem found"}
            print(f"  [{n}/{len(todo)}] {uni.name}: no emblem found")
            continue
        best = min(usable, key=lambda c: c.sort_key(args.prefer))
        ii = best.info
        svg = ii["mime"] == "image/svg+xml"
        folder = args.out / uni.folder
        url = ii["url"]
        if not svg and max(ii.get("width", 0), ii.get("height", 0)) > MAX_RASTER_SIDE and ii.get("thumburl"):
            url = ii["thumburl"]
        original = folder / (uni.slug + (Path(url).suffix.lower() or ".img"))
        try:
            wiki.download(url, original)
        except (requests.RequestException, RuntimeError) as exc:
            manifest[uni.slug] = {**entry, "status": f"download failed: {exc}"}
            print(f"  [{n}/{len(todo)}] {uni.name}: download failed ({exc})")
            continue
        render = None
        if svg and ii.get("thumburl"):
            # Wikimedia may only serve standard thumbnail widths, so step down if refused.
            for thumb in render_urls(ii["thumburl"], args.render_width):
                try:
                    wiki.download(thumb, folder / (uni.slug + ".render.png"), retries=3)
                except (requests.RequestException, RuntimeError):
                    continue
                render = folder / (uni.slug + ".render.png")
                break
        meta = ii.get("extmetadata", {})
        manifest[uni.slug] = {
            **entry,
            "status": "ok",
            "file": "File:" + best.file,
            "file_page": ii.get("descriptionurl"),
            "kind": best.kind,
            "source": best.source,
            "mime": ii["mime"],
            "width": ii.get("width"),
            "height": ii.get("height"),
            "original": rel(original),
            "render": rel(render) if render else None,
            "license": plain(meta.get("LicenseShortName", {}).get("value", "")),
            "artist": plain(meta.get("Artist", {}).get("value", "")),
            "non_free": "NonFree" in meta and str(meta["NonFree"].get("value", "")).lower() in ("true", "1"),
        }
        kind = "SVG" if svg else f"{ii.get('width')}x{ii.get('height')} {ii['mime'].split('/')[-1]}"
        print(f"  [{n}/{len(todo)}] {uni.name}: {best.file} ({best.source}, {kind})")
        if n % 10 == 0:
            save_manifest()
    save_manifest()

    entries = [manifest.get(u.slug, {}) for u in universities]
    ok = [e for e in entries if e.get("status") == "ok"]
    print(f"\n{len(ok)}/{len(universities)} emblems available "
          f"({sum(e['mime'] == 'image/svg+xml' for e in ok)} SVG, "
          f"{sum(e['kind'] == 'emblem' for e in ok)} seals/arms, {sum(e['kind'] == 'logo' for e in ok)} logos)")
    missing = [u.name for u, e in zip(universities, entries) if e.get("status") != "ok"]
    if missing:
        print("Missing: " + "; ".join(missing))
    return 0


if __name__ == "__main__":
    sys.exit(main())
