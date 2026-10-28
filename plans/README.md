# Animation plans

Written by the improve-animations audit (commit 5519b66), after the review-animations and
transitions-polish passes had already brought durations, origins and the nav/tab indicators into line.

| Plan | Severity | Status |
| --- | --- | --- |
| [001 Reduced motion for the phone sheet, menus and tooltips](001-reduced-motion-popups.md) | MEDIUM | DONE |
| [002 Faster, asymmetric step change in the free assessment](002-assessment-step-timing.md) | MEDIUM | DONE |
| [003 Three state changes that teleport today](003-missed-opportunities.md) | LOW | DONE |

Execution order: 001, 002, 003 (independent; no shared files except none).

Also checked and left as is: the Ask composer's one-off layout glide (JS, once per new chat; feel-check on
a phone), the FAQ accordion's height animation (accordion exemption), and the long hero and scroll
moments (marketing, explanatory).
