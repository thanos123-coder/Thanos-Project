---
name: react-bits
description: Find and add React Bits components (animated text, backgrounds, animations, UI components and micro-interactions for React, each in JS or TS with CSS or Tailwind). Use when building or polishing a React UI and the user asks for React Bits, an animated text effect, an animated background, a showy hover or scroll effect, or a ready-made animated component.
---

# React Bits

React Bits ([reactbits.dev](https://reactbits.dev), source at [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits)) is a copy-in library, not an npm dependency: each component's source file is added to the project in one of four flavours.

## Find a component

`references/llms.txt` in this skill's folder is the library's own agent index: one line per component, grouped into Text Animations, Animations, Components, Backgrounds and Micro, with a one-line description and the component's CLI name (PascalCase, such as `SplitText`). It is about 90 KB, so search it instead of reading it whole:

```bash
grep -n -i "scroll" <this skill's folder>/references/llms.txt
```

## Add a component

Pick the flavour that matches the project: `JS` or `TS`, then `CSS` or `TW` (Tailwind).

```bash
npx shadcn@latest add https://reactbits.dev/r/SplitText-TS-TW
# or
npx jsrepo@latest add https://reactbits.dev/r/SplitText-TS-TW
```

Then install the npm packages the added file imports. Dependencies vary by component (gsap, motion, three and ogl among them).

When reactbits.dev can't be reached (this repository's cloud environment blocks it unless it is added to the allowed domains), take the source from GitHub, which cloud sessions can read:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/DavidHDev/react-bits /tmp/react-bits
git -C /tmp/react-bits sparse-checkout set src/ts-tailwind/TextAnimations/SplitText
```

Flavour folders: `src/content` (JS + CSS), `src/tailwind` (JS + Tailwind), `src/ts-default` (TS + CSS), `src/ts-tailwind` (TS + Tailwind). Category folders: `Animations`, `Backgrounds`, `Components`, `Micro`, `TextAnimations`.

## Licence

MIT + Commons Clause (`LICENSE.md`): components may be used in any app, site or product, commercial ones included, but the components themselves may not be sold or redistributed. React Bits Pro is a separate, licence-gated registry; only suggest Pro install commands to someone who has a Pro licence.
