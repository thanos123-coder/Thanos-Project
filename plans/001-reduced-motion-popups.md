# 001 — Reduced motion for the phone sheet, menus and tooltips

- Commit: 5519b66
- Severity: MEDIUM (Accessibility)
- Scope: `web/src/app/globals.css` only

## Problem
`.dialog-pop` slides the phone sheet a full screen height (`transform: translateY(100%)`, 340ms
`var(--ease-drawer)`), and `.menu-pop` / `.tip-pop` scale in. None of them has a
`prefers-reduced-motion: reduce` variant, so people who asked for less motion still get vestibular travel.

## Change
Append inside the existing `@media (prefers-reduced-motion: reduce)` block at the end of the
"Shell" section (the block that already holds `.press:active { transform: none; }`):

```css
.dialog-pop,
.menu-pop,
.tip-pop {
  transition: opacity 200ms ease;
}
.dialog-pop[data-starting-style],
.dialog-pop[data-ending-style],
.menu-pop[data-starting-style],
.menu-pop[data-ending-style],
.tip-pop[data-starting-style],
.tip-pop[data-ending-style] {
  transform: none;
}
```
Keep opacity (it aids comprehension); drop movement and scale. Do not touch the default (motion) rules.

## Verify
DevTools > Rendering > Emulate `prefers-reduced-motion: reduce`. On a 390px viewport open
Plans > "Fill out the form": the sheet fades in place, no slide. Open the account menu and a tooltip:
fade only. With no emulation, everything animates as before.
