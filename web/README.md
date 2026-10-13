# Website UI prototype

A clickable design prototype of the AI College Counselor website. It is UI only: nothing talks to the agents yet, and every number on screen belongs to one fictional sample student.

Open `web/index.html` in a browser. No build step and no install are needed; the only network requests are for Google Fonts.

## Pages

| Tab | What it shows |
|---|---|
| Home | Landing page for new students: hero, the 2026–27 deadline timeline, a tour of every tab and the product's principles |
| Chat | ChatGPT-style chat. Searchable chat history on the left, starter suggestions and the message bar in the middle. Click a past chat to see a conversation |
| Activities | Activity log: IB grades and core at the top, then Common App activities (150-character descriptions, grade levels, hours) and honors. "Add activity" and the pencil icons open the edit drawer |
| Chances | Every university on the list with a chance range and Reach / Target / Likely label. Select one for the gauge, the factors behind it and UpChance's comments. Add with "Add university", remove with the × on a row (with Undo) |
| Essays | Essay grader in the style of GPTZero. Pick a check on the right (AI detection, grammar, clarity, admissions read) and the essay highlights in that check's color. Click a finding to jump to it |
| Interview | Mock interview setup, interviewer preview and progress report. "Start mock interview" opens the live room; "End" returns to setup |

## Files

- `index.html`: markup for all six pages, the top bar, the overlays (activity drawer, add-university modal, command palette) and the toast. Icons come from the Lucide sprite in `fx/icons.js` (ISC license).
- `styles.css`: design tokens (light and dark themes), base styles, the type scale, shared primitives and components, overlays, the command palette and the app shell.
- `data.js`: the sample student, activities, universities, chats and essay findings. When the UI is wired up, this is what the agents' responses replace.
- `fx/kit.css` and `fx/kit.js`: the shared motion kit. Motion tokens, `UC.motion` (tweens, springs, FLIP, stagger, reveal, pointer effects, streamed text), `data-tip` tooltips, `data-press` feedback and `UC.menu`. The API is documented at the top of `fx/kit.js`.
- `app.js`: theme (with a circular reveal), tab switching (View Transitions with a fallback and a spring indicator), shared controls, overlays and toast with enter and exit motion, the Cmd-K / Ctrl-K command palette and the `window.UC` helper API.
- `fx/PAGE.css` and `fx/PAGE.js` (home, chat, activities, chances, essays, interview): each page's own styles, including its responsive rules, and its own rendering and interactions. They load after the shared files, in tab order.
- `fx/icons.js` is the generated icon sprite (`node web/tools/build-icons.mjs <lucide icons dir>`).

## Design notes

- **Name.** The product is "UpChance AI"; in running copy the assistant is simply "UpChance". The mark is a white U on a cobalt tile, its right arm rising.
- **Palette.** Paper and cobalt: white and cool gray surfaces, near-black ink, and one cobalt accent used sparingly (primary buttons, focus, selection bars, links, rings, Likely data). Amber marks deadlines and AI-like highlights. Reach, target and likely are data colors used only as fills. There is no green.
- **Type.** Geist for the interface and headings, Geist Mono for percentages and counters, Newsreader only on the essay paper. Sentence case throughout; numbers use tabular figures.
- **Motion.** Short and quiet: 150ms for color, 200-250ms for panels, a spring on the tab indicator. With reduced motion, nothing moves.
- **Responsive.** Works from phone width up. Below 760px the tabs move to a bottom bar, the chat list becomes a slide-out panel, and the drawer and modal become bottom sheets.
- **Themes.** Follows the system light or dark setting. The sun/moon button in the top bar switches manually.
- **Sample data.** Everything shown belongs to one fictional student; the badge next to the logo says so on wide screens.

## Before wiring it to the agents

Two screens go further than the agents in `src/` currently allow, so they need a product decision:

- **Chances.** Agent 13 (admissions uncertainty) deliberately never gives personal odds. This UI shows a personal range per university. Either the range comes from a new, reviewed model, or this screen shows selectivity and fit instead of a percentage.
- **Essay corrections.** The authorship policy forbids essay text. The grader keeps to comments, highlights and small spelling and grammar fixes; it never rewrites sentences. Check that the grammar "Accept" button fits the assistance policy for each destination.

University names, deadlines and admit rates in the sample data are illustrative and approximate.
