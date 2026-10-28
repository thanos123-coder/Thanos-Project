# 002 — Faster, asymmetric step change in the free assessment

- Commit: 5519b66
- Severity: MEDIUM (Easing & duration)
- Scope: `web/src/components/assessment/assessment.tsx`

## Problem
Steps change with `AnimatePresence mode="wait"` and one transition for both phases:
`transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}`. In `wait` mode the exit finishes before the
enter starts, so every "Continue" costs ~640ms of motion, six times per assessment.

## Change
Give the exit its own, shorter transition (system response snaps; the arriving question carries the
motion). In the `slide` variants object:

```ts
const slide = {
  initial: (d: number) => (reduce ? { opacity: 0 } : { opacity: 0, transform: `translateX(${d * 48}px)` }),
  animate: { opacity: 1, transform: "translateX(0px)", transition: { duration: 0.25, ease: [0.23, 1, 0.32, 1] } },
  exit: (d: number) =>
    reduce
      ? { opacity: 0, transition: { duration: 0.12 } }
      : { opacity: 0, transform: `translateX(${d * -24}px)`, transition: { duration: 0.15, ease: [0.23, 1, 0.32, 1] } },
};
```
and remove the `transition={{ duration: 0.32, … }}` prop from the `motion.div` (the variants now carry it).
Keep the full `transform` strings (hardware-accelerated); do not switch to `x`.

## Verify
Click Continue through all six steps: the old question leaves in ~150ms and the next arrives in ~250ms
(~400ms total instead of ~640ms). Back goes the other way. With reduced motion: quick fades only.
