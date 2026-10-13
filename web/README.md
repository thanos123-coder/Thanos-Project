# Website UI prototype

A clickable design prototype of the AI College Counselor website. It is UI only: nothing talks to the agents yet, and every number on screen belongs to one fictional sample student.

Open `web/index.html` in a browser. No build step and no install are needed; the only network requests are for Google Fonts.

## Pages

| Tab | What it shows |
|---|---|
| Home | Landing page for new students: hero, the 2026–27 deadline timeline, a tour of every tab, how it works, and the product's principles |
| Chat | ChatGPT-style chat. Searchable chat history on the left, starter suggestions and the message bar in the middle. Click a past chat to see a conversation |
| Activities | Activity log: IB grades and core at the top, then Common App activities (150-character descriptions, grade levels, hours) and honors. "Add activity" and the pencil icons open the edit drawer |
| Chances | Every university on the list with a chance range and Reach / Target / Likely label. Select one for the gauge, the factors behind it and Alma's comments. Add with "Add university", remove with the × on a row (with Undo) |
| Essays | Essay grader in the style of GPTZero. Pick a check on the right (AI detection, grammar, clarity, admissions read) and the essay highlights in that check's color. Click a finding to jump to it |
| Interview | Mock interview setup, interviewer preview and progress report. "Start mock interview" opens the live room; "End" returns to setup |

## Files

- `index.html`: markup for all six pages, plus an inline icon sprite (Lucide icons, ISC license).
- `styles.css`: design tokens (light and dark themes) and all component styles.
- `data.js`: the sample student, activities, universities, chats and essay findings. When the UI is wired up, this is what the agents' responses replace.
- `app.js`: tab switching and the small interactions that show how each control behaves.

## Design notes

- **Name.** "Alma" (from *alma mater*) is a placeholder product name. The logo is an arched university gate with a star.
- **Palette.** Ivy green as the brand color, marigold for highlights and deadlines. Reach, target and likely use their own colors so they never compete with the brand.
- **Type.** Newsreader for headings and essay text, Geist for the interface, Geist Mono for numbers and counters.
- **Responsive.** Works from phone width up. Below 760px the tabs move to a bottom bar and the chat list becomes a slide-out panel.
- **Themes.** Follows the system light or dark setting. The sun/moon button in the top bar switches manually.

## Before wiring it to the agents

Two screens go further than the agents in `src/` currently allow, so they need a product decision:

- **Chances.** Agent 13 (admissions uncertainty) deliberately never gives personal odds. This UI shows a personal range per university. Either the range comes from a new, reviewed model, or this screen shows selectivity and fit instead of a percentage.
- **Essay corrections.** The authorship policy forbids essay text. The grader keeps to comments, highlights and small spelling and grammar fixes; it never rewrites sentences. Check that the grammar "Accept" button fits the assistance policy for each destination.

University names, deadlines and admit rates in the sample data are illustrative and approximate.
