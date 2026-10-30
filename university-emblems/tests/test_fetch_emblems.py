"""Offline test of fetch_emblems.py against a fake MediaWiki API.

Run with:  python3 tests/test_fetch_emblems.py
"""
import csv
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_emblems as fe  # noqa: E402

HARVARD = """{{Short description|Private university in Cambridge, Massachusetts, US}}
{{Infobox university
| name = Harvard University
| image = Harvard University coat of arms.svg
| image_size = 150px
| motto = ''[[Veritas]]''<ref>{{cite web |url=http://x.org |title=Y |date=2020}}</ref>
| established = {{start date and age|1636|09|08}}
| logo = Harvard University logo.svg
| website = {{URL|harvard.edu}}
}}
'''Harvard University''' is a private [[Ivy League]] research university."""
OXFORD = """{{Infobox university
|name = University of Oxford
|image = [[File:Oxford-University-Circlet.svg|180px|alt=Arms of the University]]
|motto = {{lang|la|Dominus illuminatio mea}}
}}"""
COMMENTED = """{{Infobox university
| image = <!-- use the seal --> {{Infobox university/image|Foo_seal.png|200px}}
| logo =
}}"""
PHOTO = """{{Infobox university
| image = Campus view 2019.jpg
| logo = [[File:Photo Uni logo.svg|250px]]
}}"""

PAGES = {
    "Harvard University": ("Harvard University", HARVARD, "Q13371"),
    "University of Oxford": ("University of Oxford", OXFORD, "Q34433"),
    "Commented University": ("Commented University", COMMENTED, "Q1"),
    "Photo University": ("Photo University", PHOTO, "Q2"),
    "Wikidata Only University": ("Wikidata Only University", "No infobox here.", "Q3"),
    "Renamed University": ("Renamed University", OXFORD.replace("Oxford-University-Circlet", "Renamed arms"), "Q4"),
}
FILES = {
    "Harvard University coat of arms.svg": ("image/svg+xml", 600, 700),
    "Harvard University logo.svg": ("image/svg+xml", 800, 200),
    "Oxford-University-Circlet.svg": ("image/svg+xml", 500, 600),
    "Foo seal.png": ("image/png", 250, 250),
    "Campus view 2019.jpg": ("image/jpeg", 4000, 3000),
    "Photo Uni logo.svg": ("image/svg+xml", 300, 100),
    "WD seal.png": ("image/png", 2400, 2400),
    "WD logo.svg": ("image/svg+xml", 100, 100),
    "Renamed arms.svg": ("image/svg+xml", 100, 100),
}
WIKIDATA = {"Q3": {"P158": ["WD seal.png"], "P154": ["WD logo.svg"]}, "Q1": {"P154": ["WD logo.svg"]}}
REFUSED = "/1920px-Oxford-University-Circlet.svg.png"   # a thumbnail width the fake server refuses


class FakeWiki(fe.Wiki):
    downloads: list[str] = []

    def __init__(self, pause):
        self.pause = 0

    def get(self, url, params, retries=6):
        if params.get("action") == "wbgetentities":
            return {"entities": {q: {"claims": {p: [{"rank": "normal", "mainsnak": {"datavalue": {"value": f}}}
                                                    for f in files]
                                                for p, files in WIKIDATA.get(q, {}).items()}}
                                 for q in params["ids"].split("|")}}
        if params.get("list") == "search":
            hits = [{"title": "Renamed University"}] if "Renamed" in params["srsearch"] else []
            return {"query": {"search": hits}}
        if params.get("prop") == "imageinfo":
            pages, normalized = [], []
            for title in params["titles"].split("|"):
                name = title.removeprefix("File:").replace("_", " ")
                if "File:" + name != title:
                    normalized.append({"from": title, "to": "File:" + name})
                if name not in FILES:
                    pages.append({"title": "File:" + name, "missing": True})
                    continue
                mime, w, h = FILES[name]
                under = name.replace(" ", "_")
                pages.append({"title": "File:" + name, "imageinfo": [{
                    "url": f"https://upload.example/a/ab/{under}", "descriptionurl": f"https://desc/{under}",
                    "width": w, "height": h, "mime": mime,
                    "thumburl": f"https://upload.example/thumb/a/ab/{under}/1920px-{under}.png",
                    "extmetadata": {"LicenseShortName": {"value": "Public domain"},
                                    "Artist": {"value": "<a href='x'>Someone</a>"}}}]})
            return {"query": {"normalized": normalized, "pages": pages}}
        if params.get("prop") == "revisions|pageprops":
            if params["titles"] not in PAGES:
                return {"query": {"pages": [{"title": params["titles"], "missing": True}]}}
            title, text, qid = PAGES[params["titles"]]
            return {"query": {"pages": [{"title": title, "pageprops": {"wikibase_item": qid},
                                         "revisions": [{"slots": {"main": {"content": text}}}]}]}}
        raise AssertionError(params)

    def download(self, url, dest, retries=6):
        FakeWiki.downloads.append(url)
        if url.endswith(REFUSED):
            raise RuntimeError("HTTP 429")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"x")


def test_parsing():
    assert fe.file_from_value("Harvard University coat of arms.svg") == "Harvard University coat of arms.svg"
    assert fe.file_from_value("[[File:Oxford-University-Circlet.svg|180px|alt=Arms]]") == "Oxford-University-Circlet.svg"
    assert fe.file_from_value("{{Infobox university/image|Foo_seal.png|200px}}") == "Foo seal.png"
    assert fe.file_from_value("File:Bar Arms.PNG") == "Bar Arms.PNG"
    assert fe.file_from_value("") is None
    params = fe.template_params(fe.first_infobox(HARVARD))
    assert params["image"] == "Harvard University coat of arms.svg"
    assert params["logo"] == "Harvard University logo.svg"
    assert params["motto"].startswith("''[[Veritas]]''")
    assert [c.file for c in fe.infobox_candidates(COMMENTED)] == ["Foo seal.png"]
    assert fe.related("UCLouvain (Université catholique de Louvain)", "Université catholique de Louvain")
    assert not fe.related("University of Somewhere", "Completely Different Page")
    assert fe.render_urls("https://u/thumb/a/ab/X.svg/1920px-X.svg.png", 1920) == [
        "https://u/thumb/a/ab/X.svg/1920px-X.svg.png",
        "https://u/thumb/a/ab/X.svg/1280px-X.svg.png",
        "https://u/thumb/a/ab/X.svg/960px-X.svg.png"]


def test_end_to_end():
    tmp = Path(tempfile.mkdtemp())
    csv_path = tmp / "universities.csv"
    rows = [("North America", "United States", "Harvard University", "Harvard University"),
            ("Europe", "United Kingdom", "University of Oxford", "University of Oxford"),
            ("Asia", "Nowhere", "Commented University", "Commented University"),
            ("Africa", "Nowhere", "Photo University", "Photo University"),
            ("Oceania", "Nowhere", "Wikidata Only University", "Wikidata Only University"),
            ("Oceania", "Nowhere", "Renamed University", "Renamed University (old title)"),
            ("Oceania", "Nowhere", "Ghost University", "Ghost University")]
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["continent", "country", "name", "wikipedia_title", "list"])
        writer.writerows([*row, "test"] for row in rows)

    fe.Wiki = FakeWiki
    out = tmp / "emblems"
    sys.argv = ["fetch_emblems.py", "--csv", str(csv_path), "--out", str(out), "--overrides", str(tmp / "none.csv")]
    fe.main()
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    got = {v["name"]: (v["status"], v.get("file"), v.get("kind"), v.get("source")) for v in manifest.values()}
    assert got["Harvard University"] == ("ok", "File:Harvard University coat of arms.svg", "emblem", "infobox:image")
    # A low-resolution infobox seal loses to an SVG logo from Wikidata.
    assert got["Commented University"][1] == "File:WD logo.svg"
    # A campus photograph is passed over for the logo.
    assert got["Photo University"][1] == "File:Photo Uni logo.svg"
    # Without an infobox, the Wikidata seal beats the Wikidata logo.
    assert got["Wikidata Only University"][1:3] == ("File:WD seal.png", "emblem")
    # A missing article is found by search.
    assert got["Renamed University"][1] == "File:Renamed arms.svg"
    assert got["Ghost University"][0] == "no article"
    harvard = manifest["harvard-university"]
    assert harvard["render"].endswith("harvard-university.render.png")
    assert harvard["artist"] == "Someone" and harvard["license"] == "Public domain"
    # A refused 1920 px rendering falls back to 1280 px.
    oxford = manifest["university-of-oxford"]
    assert oxford["status"] == "ok" and oxford["render"]
    assert any("/1280px-Oxford-University-Circlet" in u for u in FakeWiki.downloads)

    # A second run skips everything already downloaded.
    FakeWiki.downloads.clear()
    fe.main()
    assert FakeWiki.downloads == []


if __name__ == "__main__":
    test_parsing()
    test_end_to_end()
    print("all fetch_emblems tests passed")
