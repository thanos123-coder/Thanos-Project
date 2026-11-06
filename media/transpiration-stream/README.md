# The Transpiration Stream — From Soil to Atmosphere

A 64-second, 4K (3840 × 2160, 30 fps) scientific 3D educational film for Grade 10
biology, with English narration, burned-in English subtitles (plus an `.srt`
sidecar), on-screen labels, music and sound design.
It follows the reference slide *“Transpiration: Plant Water Transport Stream”*:
**absorption by osmosis → transpiration pull (tension) → cohesion & adhesion.**

| Deliverable | File |
|---|---|
| Film (H.264 High, 4K, AAC stereo, −16 LUFS) | `output/transpiration_stream_4k.mp4` |
| Subtitles (sidecar) | `output/transpiration_stream.en.srt` |
| Styled subtitles used for burn-in | `output/transpiration_stream.en.ass` |

## How it was made

No GPU or AI video model was available for this production, so every frame is
procedural 3D rendered on the CPU:

- **3D** — three.js (WebGL 2) in headless Chromium (SwiftShader), driven frame by
  frame by `render/render.mjs`. Nine procedurally modelled “worlds” in
  `film/worlds/`, sequenced as 16 shots in `film/shots.js`.
- **Look** — physically based materials with fresnel rim and subsurface-style glow,
  photo-scanned CC0 textures and a real sky HDRI for the outdoor shots, custom depth
  of field, bloom, AgX filmic tone mapping, colour grade, vignette and fine grain
  (`film/engine/post.js`).
- **Typography** — labels, leader lines, gauges and captions are drawn per frame at
  native 4K with the Inter typeface; 3D labels track their anchors through camera
  moves (`film/engine/overlay.js`).
- **Narration** — Kokoro-82M neural TTS (voice `af_heart`), one clip per line, with a
  phoneme-level fix for “permeable”. Every clip, and the final mix, was transcribed
  with Whisper and matches the script word for word (`audio/verify_narration.py`).
- **Music & sound** — synthesised from scratch (`audio/score.py`): an evolving pad that
  follows a chord plan per scene, sparse piano-like plucks, low drone, and restrained
  effects (wind and leaf rustle, soil drips, xylem flow, evaporation sparkle, stomatal
  airflow, scale-change whooshes). `audio/mix.py` compresses the voice, ducks music
  ~8.5 dB under speech and limits peaks: −15.8 LUFS integrated, −2.0 dBTP.
- **Subtitles** — cue text from `timeline.json`, timed from Whisper word timestamps of
  the narration (`build/subtitles.py`); technical terms are never split across lines.

## Narration (final)

Delivered at a natural ~150 words per minute. One wording change from the brief:
“Adhesion **helps water interact with** the xylem walls” became “Adhesion
**attracts water molecules to** the xylem walls”, which is clearer for students and
still makes no claim that adhesion lifts water.

1. Water enters a plant through its root hair cells by osmosis, moving across selectively permeable membranes from higher to lower water potential.
2. It then travels through the root into the xylem, where a continuous column of liquid water extends upward toward the leaves.
3. Inside the leaf, water evaporates from the moist walls of mesophyll cells into tiny air spaces. The resulting water vapour diffuses through open stomata into the atmosphere.
4. Evaporation creates tension, or negative pressure, which pulls the remaining water upward through the xylem, against gravity.
5. Cohesion, caused largely by hydrogen bonds between water molecules, helps maintain the continuous water column. Adhesion attracts water molecules to the xylem walls.
6. Guard cells regulate the stomata, balancing carbon dioxide uptake for photosynthesis against water loss. Together, these processes produce the transpiration stream, carrying water from roots to leaves.

**Runtime:** 64 s rather than 60 s. The script is 137 words (57 s of speech at a
natural pace); fitting it into 60 s would have meant rushing, which the brief ruled out.

## Shot list

| Time (s) | Scene | Shot |
|---|---|---|
| 0.0–4.2 | 1 Absorption | Young broad-leaved tree in sunlight; camera cranes down into a soil cutaway, to fine roots with root hairs |
| 3.7–5.9 | 1 | Soil at root-hair scale: mineral grains with water films and capillary bridges; a root hair cell between them |
| 5.4–11.2 | 1 | Cutaway of the root hair cell edge: soil water → cell wall → membrane with aquaporins → cytoplasm → vacuole; osmosis down the water-potential gradient |
| 10.7–14.1 | 2 The xylem | Root transverse section: cortex, endodermis with Casparian strip, tetrarch xylem; water converging on the xylem |
| 13.6–16.4 | 2 | Inside xylem vessels: dead, hollow, lignified, pitted; a continuous column of liquid water moving up |
| 15.9–18.7 | 2 | X-ray of the tree: water rising from roots to leaves; tension gauge |
| 18.2–22.2 | 3 Evaporation | 3D leaf cross-section with full anatomy; water leaves the vein xylem for mesophyll cell walls |
| 21.7–25.2 | 3 | Nanoscale wet cell wall: molecules leave the liquid surface as vapour (evaporation) |
| 24.7–30.4 | 3 | Vapour diffuses through air spaces and out of an open stoma into the drier atmosphere |
| 29.9–34.4 | 4 Transpiration pull | Menisci between cellulose microfibrils retreat and curve more; pressure in the water falls below zero |
| 33.9–36.3 | 4 | Tension transmitted back through cell-wall water to the leaf xylem |
| 35.8–38.7 | 4 | Transpiration pull up the xylem, against gravity |
| 38.2–45.9 | 5 Cohesion & adhesion | H₂O molecules with dynamic hydrogen bonds; the column moves up as one |
| 45.4–49.8 | 5 | Water–wall hydrogen bonds at the cellulose of the xylem wall (adhesion) |
| 49.3–56.9 | 6 Stomatal control | Guard cells take up K⁺, water follows by osmosis, pore opens (CO₂ in, vapour out); then ions and water leave, pore narrows |
| 56.4–64.0 | Recap | Pull back to the tree; pathway Soil → Root hairs → Xylem → Mesophyll cell walls → Air spaces → Stomata → Atmosphere; summary card |

## Scientific accuracy review

| # | Requirement | How the film meets it |
|---|---|---|
| 1 | Osmosis across a selectively permeable membrane, not just through a wall | The wall is labelled *freely permeable*; water crosses the lipid-bilayer membrane (via aquaporins), labelled *selectively permeable*; solutes cannot cross; caption “Osmosis: net movement of water across the membrane”. A minority of molecules cross outward: it is a *net*, passive movement, never pumping. |
| 2 | Xylem conducts liquid water | “Liquid water — a continuous column” in the vessel; vapour appears only in leaf air spaces and outside the stoma. |
| 3 | Evaporation mainly from moist mesophyll cell walls into air spaces | Wet spongy-mesophyll walls; nanoscale shot shows molecules leaving the wall’s water film into the air space. |
| 4 | Vapour diffuses out through stomata, mostly on the lower surface | Stomata are modelled only in the lower epidermis; vapour drifts by random motion out of an open stoma. |
| 5 | Pull originates from evaporation and the resulting tension | Scene 4: “Evaporation creates tension”; tension then transmitted to the xylem. |
| 6 | Cohesion distinguished from adhesion | Separate shots and colours: water–water hydrogen bonds (blue, cohesion) vs water–wall hydrogen bonds (amber, adhesion). |
| 7 | Hydrogen bonds dynamic | Recomputed every frame from geometry (H···O distance and O–H···O angle), fading in and out as molecules jostle; caption “constantly forming and breaking”. |
| 8 | Adhesion alone does not lift water | Adhesion is shown only as attraction to the wall; lifting is attributed to tension plus cohesion. |
| 9 | Stomatal opening is not simply plant water abundance | Opening shown as K⁺ uptake then water by osmosis; closing as K⁺ loss (e.g. ABA in water stress); note: “Stomata respond to light, CO₂ concentration and hormones such as abscisic acid (ABA)”. |
| 10 | Correct direction of the water-potential gradient | Arrow “Higher → Lower water potential” from dilute soil water to concentrated cell sap; tension gauge: less negative (roots) → more negative (leaves). |
| 11 | Xylem not confused with phloem | Vein: xylem (water-filled, upper side) labelled; phloem (lower side) modelled but not involved in the water path. |
| 12 | Sunlight need not strike stomata | Stomata are on the shaded lower surface; nothing implies direct light is needed. |
| 13 | Observable anatomy vs conceptual molecular models | Molecular shots carry “Conceptual model · molecules enlarged, not to scale” (and “motion greatly slowed”); anatomy shots carry live scale bars (100 µm, 20 µm, 10 µm). |
| 14 | Correct anything uncertain before rendering | E.g. root hairs appear behind the root tip, not on it; epidermal cells lack chloroplasts but guard cells have them; the Casparian strip sits in the radial walls; meniscus radius follows R = a / cos φ for a wetting contact. |

## Reproduce

```bash
npm install
```

```bash
bash build/fetch_assets.sh
```

```bash
pip install kokoro-onnx onnxruntime soundfile scipy faster-whisper
```

Then synthesise the narration (`audio/narration.py`), build subtitles
(`build/subtitles.py`), the score (`audio/score.py`) and mix (`audio/mix.py`),
render frames with `node render/render.mjs --out <frames>` and assemble with
`build/encode.sh <frames> <mix.wav> output`. Preview any moment quickly with
`node render/render.mjs --times 12.5,40 --w 1280 --h 720 --out /tmp/preview`.

## Credits and licences

- Textures and sky HDRI: ambientCG (Ground048, Bark003, LeafSet024, Grass004, DaySkyHDRI069A), CC0 1.0
- Typeface: Inter by Rasmus Andersson, SIL Open Font License 1.1
- Narration voice: Kokoro-82M (Apache 2.0) via kokoro-onnx; QC transcription: faster-whisper (MIT)
- three.js (MIT), d3-delaunay (ISC)
