---
name: lenis
description: Add Lenis smooth scrolling (npm `lenis`, by darkroom.engineering) to a site or a React or Vue app, including syncing it with GSAP ScrollTrigger, WebGL scenes or parallax. Use when the user asks for Lenis, smooth or inertial scrolling, or scroll-synced animation that needs a smoothed scroll position.
---

# Lenis

Version 1.3.27 (npm `lenis`, MIT). Lenis runs on the browser's native scroll, so `position: sticky`, anchor links and accessibility keep working.

## Install

```bash
npm i lenis
```

Or from a CDN: `<script src="https://unpkg.com/lenis@1.3.27/dist/lenis.min.js"></script>`.

Always include the recommended CSS: `import 'lenis/dist/lenis.css'`, or link `https://unpkg.com/lenis@1.3.27/dist/lenis.css`.

## Set up

```js
import Lenis from 'lenis'

const lenis = new Lenis({ autoRaf: true })
```

With GSAP ScrollTrigger, let GSAP's ticker drive Lenis instead of `autoRaf`:

```js
const lenis = new Lenis()
lenis.on('scroll', ScrollTrigger.update)
gsap.ticker.add((time) => {
  lenis.raf(time * 1000)
})
gsap.ticker.lagSmoothing(0)
```

In React, render `<ReactLenis root />` once (`import { ReactLenis, useLenis } from 'lenis/react'`) and read the instance anywhere with `useLenis()`. See `references/react-README.md`.

## Before shipping

- Lenis honours `prefers-reduced-motion` by default: smoothing turns off and programmatic scrolls jump. Keep that default.
- CSS scroll-snap isn't supported; use `lenis/snap`.
- Nested scroll containers need configuring (the README's "Nested scroll" section), and smooth scrolling stops over iframes.
- Safari caps it at 60fps, and at 30fps in low power mode.

## Reference

- `references/README.md`: the full Lenis README, with every option, property, method and event, plus nested scroll, anchor links and troubleshooting.
- `references/react-README.md`: the `lenis/react` adapter.
