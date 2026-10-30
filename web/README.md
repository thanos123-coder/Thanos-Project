# Upchance website (redesign)

The Upchance site as a front end only: every page, state and flow is designed and clickable, but nothing is wired
to the agents backend in the repository root. Built for desktop.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. For a production build: `npm run build && npm start`.

Checks: `npx tsc --noEmit` and `npm run lint`.

## Pages

| Route | What it shows |
| --- | --- |
| `/` | Home: hero with a live chance card, features, how it works, coverage, trust, pricing, FAQ |
| `/ask` | Ask Upchance: chats, streamed answers, search (Ctrl K), memory drawer (`?panel=memory`) |
| `/chances` | Example results and how the estimates work |
| `/assessment` | The free assessment, six questions to results (`?uni=Edinburgh` pre-fills a university) |
| `/essays` | Essay grader: writing feedback and the AI scan |
| `/interviews` | Live mock interview with the voice orb |
| `/log` | Grades, tests, activities, with add and edit dialogs |
| `/plans` | Plans, billing periods, local prices, comparison, schools form |

## Where things live

- `src/app/globals.css`: design tokens (colours, type, radius) and the motion-token scale.
- `src/components/`: one folder per page, plus `ui/` (buttons, chips, range bar, fields) and `motion/` (Lenis,
  GSAP ScrollTrigger scenes, generation reveals).
- `src/content/`: all copy and sample data. Sample values (Eleni's example ranges, price conversion rates, the
  company details in the footer) are marked there and need confirming before launch.
- `src/components/vendor/` and `src/lib/generation/`: third-party code (React Bits, 21st.dev, transitions.dev).

## Worst-case data (development only)

Add `?data=worst` to any URL to swap the demo content for realistic extremes (the longest university names, pasted
links, Greek text, long log entries), or `?data=empty` for empty lists. A small switch at the bottom of the page
flips between them. It never ships in a production build.

## Not part of this redesign

The legal and help pages linked from the footer (Terms, Privacy, Contact and so on) aren't built here; those links
land on the branded 404 page.
