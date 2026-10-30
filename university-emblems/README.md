# University Emblems of the World

A PDF atlas of the emblems of 500 leading universities: the seal, coat of arms or crest, or the logo where no emblem is published. Universities are grouped by continent and listed alphabetically within each continent, each with its name and country.

| Continent | Universities | Selection |
|---|---|---|
| Africa | 50 | Top 50, with reference to the THE and QS World University Rankings |
| Asia | 100 | Top 100, including the Middle East and Central Asia, with reference to the QS World University Rankings |
| Australia & Oceania | 50 | All 41 Australian universities, the 8 New Zealand universities and the University of the South Pacific |
| Europe | 150 | United Kingdom top 50 (QS and the UK league tables) and continental Europe top 100 (QS) |
| North America | 150 | United States top 150 national universities (U.S. News & World Report) |

The list is [`data/universities.csv`](data/universities.csv). Add or remove rows and rebuild to change it.

Notes on the selection:

- "Top 50 in London" is read as the top 50 in the United Kingdom, since London itself has about 40 universities. Ten of the 50 are in London.
- The continental Europe list leaves out the UK so the two lists do not overlap.
- Australia has 41 universities: Adelaide University replaced the University of Adelaide and the University of South Australia in 2026. To reach 50, the section adds New Zealand and the University of the South Pacific.
- Positions near each cut-off differ between ranking systems, so the lists are compiled with reference to the rankings named above rather than copied from one table.

## Building the PDF

This needs Python 3.10 or later and network access to `en.wikipedia.org`, `upload.wikimedia.org`, `commons.wikimedia.org` and `www.wikidata.org`.

```bash
pip install -r requirements.txt
python3 scripts/fetch_emblems.py
python3 scripts/build_pdf.py --split
```

**`scripts/fetch_emblems.py`** reads each university's English Wikipedia infobox and its Wikidata seal, coat of arms and logo statements. It picks the emblem, preferring an SVG, then the largest raster, and skipping campus photographs. It saves the original file, plus a 1920 px PNG rendering of SVG originals, to `emblems/<continent>/`, and records the source and licence of each file in `emblems/manifest.json`.

A re-run fetches only what is still missing. Use `--only "Oxford" --refresh` to redo one university, or `--prefer logo` to collect logos instead of seals.

**`scripts/build_pdf.py`** writes `output/University_Emblems_Atlas.pdf`, plus one PDF per continent with `--split`. Each PDF has:

- a cover and a contents page
- a divider page for each continent
- 12 emblems per A4 page, each with its name and country
- an index by country
- the source and licence of every image

The PDF outline is clickable. Selecting an emblem opens its source file, and selecting a name opens the Wikipedia article. Embedded emblems are 1200 px on the longest side (`--max-px`), which prints at over 600 dpi. They are stored as JPEG at quality 90 (`--quality`); `--lossless` stores them losslessly instead, at a larger file size.

If an emblem is wrong, add a row to [`data/overrides.csv`](data/overrides.csv) naming the Wikimedia file to use, for example `University of Oxford,Oxford-University-Circlet.svg`. Then run `python3 scripts/fetch_emblems.py --only "University of Oxford" --refresh`.

The downloader has an offline test: `python3 tests/test_fetch_emblems.py`.

## Licensing

Emblems, seals, coats of arms and logos are the property of their institutions and are reproduced for identification and reference. The image files come from Wikipedia and Wikimedia Commons. The licence and author of each file are listed at the back of the PDF and in `emblems/manifest.json`.
