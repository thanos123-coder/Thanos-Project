# Πώς λειτουργεί το HPLC: a 59-second Greek explainer

**Video:** [`hplc_explainer_el.mp4`](hplc_explainer_el.mp4), 1920×1080, 30 fps, 58.9 s, with Greek narration and burned-in Greek subtitles. The subtitles are also in [`hplc_explainer_el.srt`](hplc_explainer_el.srt).

It walks once through a High Performance Liquid Chromatography system in the order the liquid travels. A step bar at the top shows where you are:

| Time | Part | What the picture shows |
|---|---|---|
| 0–7 s | What HPLC is for | A mixture goes in and comes out as separate substances, answering "what is in it?" and "how much?" |
| 7–13 s | Mobile phase and degasser | The solvent leaves the bottle; air bubbles are removed in the degasser |
| 13–17 s | Pump | A piston pump; the gauge climbs to ~400 bar (about 400 times atmospheric pressure) at a constant flow |
| 17–20 s | Injector | The syringe pushes a small plug of the sample into the flowing solvent |
| 20–35 s | Column (stationary phase) | A magnified view of the packed grains: weakly held molecules move fast, strongly held ones lag, and the mixture splits into bands 1, 2 and 3 |
| 35–43 s | UV detector | Each band crosses a UV beam, absorbs light, and the signal rises |
| 43–52 s | Chromatogram | One peak per substance. Retention time identifies the substance; peak area gives the amount |
| 52–59 s | Recap | Pump pushes, column separates, detector measures |

## Narration (Greek)

> Πώς λειτουργεί το HPLC; Χωρίζει ένα μείγμα στα συστατικά του, για να δούμε τι περιέχει και πόσο.
> Ο διαλύτης, η κινητή φάση, περνά πρώτα από τον απαεριωτή, που αφαιρεί τις φυσαλίδες.
> Η αντλία σπρώχνει τον διαλύτη με σταθερή ροή και πολύ υψηλή πίεση.
> Ο εισαγωγέας προσθέτει στη ροή μια μικρή ποσότητα δείγματος.
> Η καρδιά του συστήματος είναι η στήλη, γεμάτη με μικροσκοπικούς κόκκους: τη στατική φάση.
> Οι κόκκοι κρατούν κάθε ουσία με διαφορετική δύναμη. Όσες κρατιούνται λίγο, βγαίνουν γρήγορα, ενώ όσες κρατιούνται πολύ, αργούν. Έτσι οι ουσίες χωρίζονται.
> Στην έξοδο, ο ανιχνευτής στέλνει υπεριώδες φως μέσα από το υγρό. Όταν περνά μια ουσία, απορροφά φως και το σήμα ανεβαίνει.
> Το αποτέλεσμα είναι το χρωματογράφημα: κάθε κορυφή είναι μία ουσία.
> Ο χρόνος κατακράτησης δείχνει ποια ουσία είναι, και το εμβαδόν της κορυφής, πόση ποσότητα υπάρχει.
> Με λίγα λόγια: η αντλία σπρώχνει, η στήλη χωρίζει, ο ανιχνευτής μετρά.

The voice is Microsoft's neural Greek voice *el-GR-NestorasNeural*. "HPLC" is spelled for the voice as «Έιτς Πι Ελ Σι», the way it is said in Greek labs. The background pad and the sound cues are synthesized in `audio.py`, so there is no third-party music.

## How it is made

| File | Role |
|---|---|
| `narration.json` | The script, split into segments, with the pause before each one |
| `tts.py` | Synthesizes each segment and records per-word timings (`build/timeline.json`) |
| `index.html`, `hplc.js` | The animation: one canvas, where `renderAt(t)` draws the frame at time *t*. Every event is anchored to a spoken word, so the picture follows the voice |
| `render.cjs` | Steps through the frames in headless Chromium (Playwright) and exports the timing anchors |
| `audio.py` | Mixes narration, pad and cues, with the pad ducked under the voice, to −16 LUFS |
| `subtitles.py` | Writes the `.srt` from the same subtitle timings that are drawn on screen |
| `build.sh` | Runs the whole pipeline and encodes the MP4 (H.264 + AAC) |

To rebuild: `./build.sh`. To preview the animation in a browser, serve this folder (`python3 -m http.server`) and open `index.html?play`.

To change the wording, edit `narration.json` and rebuild. The animation re-anchors itself to the new timings. Keep the total under 60 s: `tts.py` prints when the speech ends, and the video runs 2.6 s longer.
