---
name: gsap
description: Animate with GSAP (GreenSock Animation Platform, npm `gsap`), covering timelines, scroll-driven animation with ScrollTrigger, text splitting with SplitText, SVG morphing, FLIP layout transitions and draggable interactions, in plain JS, React, Vue or any other framework. Use when the user asks for GSAP, or for animation that CSS transitions handle badly, such as multi-step sequences, scroll-linked effects, staggered text reveals or physics-like interactions.
---

# GSAP

Current version: 3.15 (npm `gsap`). GSAP is free, commercial use included, under GreenSock's standard no-charge licence (https://gsap.com/standard-license). Every plugin ships in the public `gsap` package, including the formerly members-only ones such as SplitText and MorphSVG.

## Install

```bash
npm install gsap
npm install @gsap/react   # React projects
```

From a CDN (static pages, artifacts):

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.15/dist/ScrollTrigger.min.js"></script>
```

Each plugin has its own file in `dist/` (`SplitText.min.js`, `Flip.min.js`, `ScrollSmoother.min.js`, `MorphSVGPlugin.min.js` and so on).

## Import and register

```js
import gsap from "gsap";
import ScrollTrigger from "gsap/ScrollTrigger";
import SplitText from "gsap/SplitText";

gsap.registerPlugin(ScrollTrigger, SplitText);
```

`gsap/all` exports every tool at once. Register each plugin before using it.

## React

Use `useGSAP()` from `@gsap/react` in place of `useEffect()` or `useLayoutEffect()`. It reverts the component's animations and ScrollTriggers on unmount through `gsap.context()`:

```js
import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

const container = useRef(null);
useGSAP(() => {
  gsap.to(".box", { x: 200 });
}, { scope: container });
```

Wrap event handlers that create animations after the hook has run in `contextSafe()` so they are cleaned up too. The full guide is `references/gsap-react-README.md`.

## Reduced motion and smooth scroll

- Gate motion on the user's preference with `gsap.matchMedia()`, for example `mm.add("(prefers-reduced-motion: no-preference)", () => { ... })`; animations created inside are reverted when the query stops matching.
- With Lenis smooth scrolling, drive Lenis from GSAP's ticker and call `ScrollTrigger.update` on Lenis scroll events. The `lenis` skill has the snippet.

## Reference

- `references/README.md`: GSAP's own README (install, imports, the plugin list).
- `references/gsap-react-README.md`: the `@gsap/react` README.
- After `npm install gsap`, `node_modules/gsap/types/` documents every method and option with examples (`gsap-core.d.ts`, `timeline.d.ts`, `scroll-trigger.d.ts`, `split-text.d.ts`, `flip.d.ts` and others). Read the relevant file for exact signatures; gsap.com can be unreachable from this repository's cloud environment.
