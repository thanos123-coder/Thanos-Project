# 003 — Three state changes that teleport today

- Commit: 5519b66
- Severity: LOW (Missed opportunities)
- Scope: `web/src/components/plans/plans-view.tsx`, `web/src/components/log/log-board.tsx`,
  `web/src/components/ask/answer-view.tsx`

## 1. Plans: the savings line swaps text when the billing period changes
`PlanCard` renders `{save ?? ""}` in `<p className="mt-3 min-h-[1.5em] …">`. Prices roll (NumberFlow) but
this line jumps. Wrap the text in the existing `Swap` component from `@/components/ui/range-bar`
(`<Swap value={save ?? ""} />` when `save`), which plays the house text swap (150ms, 4px, 2px blur).
Do the same for the billed note line under "Billed today".

## 2. Log: a new entry appears with no arrival
Entries are rendered in a list; a saved entry is prepended and simply appears. Add the existing
`block-in` class (400ms `var(--ease-out)`, 8px rise) to each entry card so the newest one arrives; it
plays once per mount, so existing entries do not replay on filter changes only if keys are stable
(they are: `key={e.id}`).

## 3. Ask: Copy gives feedback only as a toast
The Copy button keeps its icon after copying. Swap the icon to a check for 1.2s after a successful copy
(icon swap: 250ms ease-in-out, 2px blur, scale 0.5 → 1, matching `.send-marker` in globals.css), and keep
the toast. Use component state (`copied`), reset with a timeout cleared on unmount.

## Verify
Plans: toggle Monthly → Yearly → 4 years; the savings line swaps instead of jumping. Log: add an entry;
it rises in. Ask: Copy an answer; the icon becomes a check, then returns.
