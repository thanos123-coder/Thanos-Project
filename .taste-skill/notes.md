# Upchance redesign — working notes

## Reading of the brief
Upchance is an AI university counsellor for students (13+) and their parents, run from Greece, covering
100 universities with chance estimates in 9 countries. The one thing the site must get a visitor to do:
take the free assessment ("See my chances"). Stack: Next.js + Tailwind in `web/`. Fresh direction, new logo
mark, every feature name and plan benefit kept word for word.

## Inventory (only Upchance has these)
1. The name: "Up" + "chance"; the promise "Know your chances. Then raise them."
2. The range: chances shown as an honest band on a track with a marker, never one number ("ranges, not promises").
3. Its numbers: 100 universities with estimates in 9 countries; 1,600 with admissions facts; 9 school systems
   (IB, A-levels, US high school, Panhellenic, Gaokao, Abitur, Baccalauréat, CBSE, ISC); 0 ads; 250-country
   volunteering directory; about 2 minutes for the assessment; 3 / 20 / 40 / unlimited messages a day.
4. Greece: ΔΟΑΤΑΠ degree recognition, Panhellenic points and the Μηχανογραφικό, military service deferment.
5. The admissions reader's margin notes ("Great first line. Now show the moment.").
6. Eleni, the example student: IB predicted 40, Engineering, applying from Greece.
7. The interview orb and the interviewer's voice, Zira; "Tell me about a problem you couldn't solve at first."
8. The brag sheet: "Captain, robotics team", "Silver, chemistry olympiad".
9. The constraint: you write every word; coaching only, under each university's AI policy.
10. Printed things of its world: the offer letter ("Offer chance 83%, meeting the offer 50%"), results day, the
    personal statement draft, the brag sheet.
11. Memory: "Wants to study engineering in the UK", "Predicted 38 in the IB".

## Direction
`one-motif`, seed 1098377529 (sector education). Chosen because Upchance owns one shape that no competitor
shows: the honest chance range (a rounded band on a track with a marker dot). A toggle switch is the same
shape, and the dealt features section is built from switches.

## The idea
On this page, **Upchance's honest chance range — a rounded band with a marker, never a single number —**
becomes **the one shape that runs the whole system**: the giant hero band, every button and switch, the
bullets, the masks for the interface fragments, the loader and the band that splits the page.

Competitor test: CollegeVine and similar tools show a single percentage or a donut; the range is Upchance's
claim ("ranges, not promises"), so the sentence fails for them.

## The live thing
Pick a dream university (Oxford, Cambridge, Imperial, UCL, LSE, Edinburgh, Harvard, MIT, Stanford, NYU) and
the band slides to Eleni's example range for it, with "what would move it" shown as a ghost extension of the
band. Labelled "Example" (illustrative, as on the old site). Works with keyboard and thumb; without script the
chips are plain links into the assessment.

## Palette (ui-ux-pro-max: "Monochrome + blue accent"; exact blue from the dealt sheet)
ground #eef0f3 · surface #e2e5ea · mid #cdd2da · ink #0c1030 (fountain-pen ink, not a default near-black) ·
soft ink #5d6470 · cobalt #1f2de6 · on cobalt #ffffff · paper #fbfcfd (interface fragments only).

## Type (ui-ux-pro-max Google Fonts search; Roundo is unreachable from this environment)
M PLUS Rounded 1c — the only rounded geometric sans in the results that carries Greek (ΔΟΑΤΑΠ, Μηχανογραφικό).
Display 500, tracking -0.025em, leading 1.05; text 400, emphasis 500/700.

## Redraws
None. Deviations: fonts and the ink hue (see above), and the stats blueprint holds three figures so "0 ads"
moved into the trust board, where it belongs.

## Home argument (claim → proof)
- Hero: know your chances, then raise them → the live range for your dream university.
- Stats: Upchance knows the ground → 100 / 1,600 / 9.
- Features: one counsellor for the whole journey → six sentences with switches, each revealing its interface.
- How it works: three moves → assessment, where you stand, raise it (tiles that grow).
- List: made for students everywhere → 9 school systems and 9 countries.
- Proof: honest, safe and private → ranges not promises, 13+, data stays yours, 0 ads, you write every word.
- Pricing: start free, upgrade when ready → Free vs paid as two fields.
- FAQ: seven real questions → tabbed index cards.
- CTA: a sentence with a blank → "I'd love to study at [ ] See my chances".
- Footer: the mark built large.

## Sample content to confirm before launch
Example ranges for Oxford, Cambridge, LSE, Harvard, MIT, Stanford (Eleni's set on the old site only covered
Imperial, UCL, Edinburgh, NYU, TU Delft); the sample chat conversation; essay grader sample results; the live
interview transcript; the assessment's question wording.
