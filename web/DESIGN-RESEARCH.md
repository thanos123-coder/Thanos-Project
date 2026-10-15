# UpChance AI design playbook

**Purpose.** Rules for restyling all six tabs (Home, Chat, Activities, Chances, Essays, Interview) so the site feels soft, rich and calm instead of stark, sharp-cornered and crowded, and so it reads as designed rather than generated. Every rule is something a front-end developer can implement: values, tokens and CSS. Each section cites what it rests on.

**Stack note.** The site is vanilla HTML, CSS and JS: `web/index.html`, `web/styles.css` and `web/fx/*`, with no React. Where a source names a React library, this playbook names the vanilla equivalent.

**Evidence note.** The "AI tells" catalogs record what developers and designers on Reddit and Show HN call AI-made. They don't measure teens or parents. funboy322 calls its numbers "relative commonness in a slop-prone corner of the web, not ground truth" and estimates 5–10% false positives ([catalog](https://raw.githubusercontent.com/funboy322/avoid-ai-design/main/references/ai-tells-catalog.md), [tells.md](https://raw.githubusercontent.com/JCarterJohnson/vibecoded-design-tells/main/skill/references/tells.md)). Treat them as hypotheses and confirm with real users (§11). Several sites were unreachable from the research sandbox (nngroup.com, linear.app, stripe.com, m3.material.io, collegevine.com, gptzero.me), so claims sourced to them are search-snippet level and marked *(snippet)*.

Contrast figures below were computed with WCAG 2 relative luminance and APCA 0.0.98G using `web/tools/colorcheck.py`.

---

## 0. Decisions this playbook makes where the sources disagree

| Question | Decision | Why |
|---|---|---|
| Button shape | **Capsule (`--r-full`) for every button**, decided once. Inputs, menu items and rows use 10–14px. | taste-skill: "square or fully round, decided once". tells.md flags pills only "as the only rounded thing". The owner asked for softness. Direction B below is the exception and uses 10px buttons. |
| Card radius | Repeated rows and cards 14px. Panels 20px. Overlays, sheets and the composer 28px. | Impeccable caps cards at 12–16px. Apple and M3 Expressive go rounder for large containers. The ladder resolves both. |
| Pure tone vs border vs shadow | A resting card gets **one tone step + one 6–8%-alpha ring**. Shadows only on things that float. | A white card on a tinted canvas is only 1.05:1, so tone alone fails on many screens. Vercel says to combine borders and shadows, and Impeccable calls grey hairline + big blur a "ghost card". |
| Brand blue | **Harbor blue `oklch(50% .135 252)` = `#1965AD`** (HSL 209). It replaces `#2448E5`, which is ≈ Tailwind blue-700 at chroma .238. | The current blue is a stock default and reads neon. The new hue sits between Tailwind sky-700 and blue-700, at about half the chroma. |
| Neutral temperature | Cool, low-chroma tint (C ≤ .012 on large areas) by default. Direction B shows the warm alternative. | Radix pairs a tinted grey with its accent. Linear's 2026 refresh went warmer *(snippet)*. Everyone agrees chroma should be low. |
| Display face | **One sans for UI and headings.** Newsreader only on the essay paper and in essay quotes. | A serif display face on a pale ground is the rising 2026 tell. Newsreader is on no tell list. |
| Font weights | 400 / 500 / 600 (700 only for display numerals) | Rauno and Apple advise against weights under 400. Contrast comes from size, not extreme weights. |
| Easing | **One ease-out token: `cubic-bezier(0.23, 1, 0.32, 1)`** | Three different "expo-out" curves showed up across the sources; standardise on Emil Kowalski's. |
| Entrance motion | Home only, once per session. Tool tabs have **no** entrance stagger. | Emil's frequency rule plus Anthropic's "one orchestrated moment". |
| Tab switch | Opacity-only crossfade ≤ 150ms (or none) | Students hop tabs dozens of times a day. Material's 450ms fade-through is too slow for that. |
| Number rolls | ≤ 600ms, only when a value changes | NumberFlow's 900ms default is tuned for marketing counters. |
| Chances tiers | 3 labelled tiers (Reach / Target / Likely). Hues are not the brand, not red, not green. Cutoffs are a disclosed product decision. | See §8. |
| Pattern-detector score in Essays | **Removed.** Replaced by a "Generic phrasing" category with reasons. | Detectors misclassify non-native writing (Liang et al.). |

---

## 1. Point of view, and how to avoid looking generated

**The cause.** Sites read as AI-made because their defaults went unchosen. In 3,033 on-topic Reddit comments, the top complaints were general ones: "screams AI / soulless" (6.4%) and "all looks the same / template" (6.1%). Each concrete feature scored 2.5% or less ([comment counts](https://raw.githubusercontent.com/JCarterJohnson/vibecoded-design-tells/main/unslop-ai-ui/comment_tell_counts.csv), [repo](https://github.com/JCarterJohnson/vibecoded-design-tells)). Anthropic calls this "distributional convergence" ([blog](https://claude.com/blog/improving-frontend-design-through-skills)).

**Rules**

1. **Write `web/DESIGN.md` before restyling.** Follow the Google Labs format: 4–6 named colors with roles, type roles, radius scale, spacing scale, elevation rules, **one signature detail**, and a Do/Don't list. Treat the format as a template, not a dependency, since its CLI is alpha ([design.md](https://github.com/google-labs-code/design.md)). Build all six tabs from it.
2. **Name a direction, not "modern and clean".** For example: Harbor (calm, airy), Study desk (warm, tactile) or Pennant (expressive). Ground it in the student's world: transcripts, highlighters, pennants, interview rooms, campus paper ([aesthetic directions](https://raw.githubusercontent.com/funboy322/avoid-ai-design/main/references/aesthetic-directions.md), [Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)).
3. **Run two tests on every decision.**
   - *Default test:* "Would I have done this for any similar page?" If yes, it's a default, so revise it.
   - *Silhouette test:* shrink the Home screenshot and those of CollegeVine, Crimson and Common App to 200px black-on-white silhouettes. If you can't pick yours out, the structure is still a template ([funboy SKILL / catalog L9](https://raw.githubusercontent.com/funboy322/avoid-ai-design/main/references/ai-tells-catalog.md)).
4. **Spend boldness in one place per page.** Home can be expressive. Chat, Activities and Chances stay quiet and exact ([Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)).
5. **Judge combinations of tells, not single hits.** Cream ground, serif display and sage accent are a tell only together: any two of the three ([tells.md](https://raw.githubusercontent.com/JCarterJohnson/vibecoded-design-tells/main/skill/references/tells.md)).

**Tells present in this repo today, to remove** (from [Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md), [tells.md](https://raw.githubusercontent.com/JCarterJohnson/vibecoded-design-tells/main/skill/references/tells.md), [Impeccable craft floor](https://raw.githubusercontent.com/pbakaus/impeccable/main/skill/reference/craft-floor.md)):

- Tailwind values copied by hand: `--border #E5E7EB` is gray-200, `--bg-rail #F9FAFB` is gray-50, and `--accent #2448E5` is about blue-700.
- Geist plus Geist Mono, with monospace used for small data labels.
- The "broadsheet": hairline rules plus `border-radius: 0`. There are 20 `0` and 21 `2px` radius declarations.
- Middle-dot meta strings ("Preview · sample data", "UCAS · Jan 14", "4 sessions · average 6.8").
- An arrow appended to CTAs and links: 11 `arrow-right` uses in `index.html`.
- A 2px coloured side stripe for selection (`inset 2px 0 0 var(--accent)` on `.row`, `.uni-row`, `.scan`) and `border-left: 2px` on `.prompt-box`.
- Tinted rounded-square icon tiles beside every activity title.
- Five identical feature columns, each with an icon, a label and an arrow.

**Keep these.** The hero already shows a real product moment (a chances list) instead of a centred hero with three cards. The copy is plain, sentence case and specific. Sample data is labelled. These are the site's best anti-template assets.

---

## 2. Color system: soft, rich, not stark

**Why it looks stark now.** Text `#0B0D12` on `#FFFFFF` measures 19.4:1 (APCA Lc 105.7), effectively black on white. The border `#E5E7EB` is 1.24:1 (Lc 11.8), below APCA's "invisible" floor. So the page reads as a white void plus saturated blue blobs ([APCA in a Nutshell](https://raw.githubusercontent.com/Myndex/SAPC-APCA/master/documentation/APCA_in_a_Nutshell.md)). Material never uses pure white and black for page and text: background is neutral98 and text is neutral10 ([M3 Color](https://raw.githubusercontent.com/material-components/material-components-android/master/docs/theming/Color.md)). Adam Argyle: "reserve black and white exclusively for brightest highlights and darkest shadows" ([web.dev color scheme](https://github.com/GoogleChrome/web.dev/blob/main/src/site/content/en/blog/building-a-color-scheme/index.md)).

### 2.1 Structure

- **One ground, one ink, one action accent, one warm second color, three data tiers, one danger.** That is the whole palette.
- **Accent budget per viewport:**
  - 70–80% tinted neutrals.
  - 15–25% soft tints: washes, soft badges, highlight fills.
  - ≤ 5–8% saturated fills: one brand-9 button per view, plus data marks.

  Apple: "reserve it for elements that truly benefit from emphasis… refrain from adding color to the background of multiple controls" ([HIG Color](https://developer.apple.com/design/human-interface-guidelines/color)).
- **One meaning per color.** The brand blue never encodes data. The warm second color has exactly one job. Never colour headings or non-interactive text with the link blue (Apple HIG, same page).
- **Give every step a job (Radix 12-step model):**
  - 1–2: backgrounds.
  - 3 / 4 / 5: component rest, hover, pressed.
  - 6: subtle borders.
  - 7: interactive borders.
  - 8: focus ring and strong borders.
  - 9: solid fill.
  - 10: solid hover.
  - 11: low-contrast text.
  - 12: high-contrast text.

  Don't make tints by mechanically lightening step 9 ([Radix scale](https://raw.githubusercontent.com/radix-ui/website/main/data/colors/docs/palette-composition/understanding-the-scale.mdx), [Stripe](https://stripe.com/blog/accessible-color-systems) *(snippet)*).

### 2.2 Default tokens (Direction A "Harbor": the recommended direction, §12)

Light:

```css
:root {
  color-scheme: light;
  /* surfaces: about 2 L% apart (M3 tone ladder 98 / 100 / 96 / 94) */
  --canvas:   #F6F9FD; /* oklch(98.2% .006 250) page */
  --surface:  #FFFFFF; /* raised cards and panels only */
  --sunken:   #EDF2F8; /* oklch(96% .010 250) wells, input fills, composer field */
  --wash:     #E3F1FD; /* oklch(95.2% .022 245) alternating Home bands, featured group */
  --line:     #D6DDE6; /* oklch(89.5% .014 250) decorative dividers (Lc 18 on white) */
  --ring:     rgb(24 36 55 / .08);  /* 1px card ring, ink-tinted */
  --input-border: #7C8B9B; /* oklch(63% .03 252) 3.49:1 on white, WCAG 1.4.11 */
  /* ink */
  --ink:         #182437; /* oklch(26% .04 258) 14.8:1, Lc 99 on canvas: body */
  --ink-display: #1D3559; /* oklch(33% .07 258) 11.7:1, Lc 94: headings at 36px and up */
  --ink-2:       #414E60; /* oklch(42% .035 256) 8.0:1, Lc 85.5: secondary, and all 12–14px meta */
  --ink-3:       #5D6A7A; /* oklch(52% .03 254) 5.2:1, Lc 74: 15px and up only, placeholder */
  /* brand: harbor blue */
  --brand:        #1965AD; /* oklch(50% .135 252) white text 6.0:1 */
  --brand-hover:  #13559B; /* oklch(45% .13 254) 7.5:1, so hover raises contrast */
  --brand-text:   #15508F; /* oklch(43% .12 254) links: 7.75:1 on canvas, 6.98:1 on brand-soft */
  --brand-soft:   #E2EFFD; /* oklch(94.6% .024 250) tonal button and selected row */
  --brand-soft-2: #D5E8FC; /* oklch(92.2% .034 250) tonal hover */
  --focus:        #397DC4; /* oklch(58% .13 252) 4.3:1 on white */
  /* warm second color: one job, "time and attention" (deadline soon, today marker, needs action) */
  --apricot:      #F1AD71; /* oklch(80% .11 62) fills and markers only, never text */
  --apricot-soft: #FEF0E1; /* oklch(96.3% .025 70) */
  --apricot-text: #925019; /* oklch(50% .11 55) 5.9:1 on canvas */
  /* data tiers: matched lightness, not brand, not red or green */
  --reach:  #C26C96; --reach-soft:  #FCE9F1; --reach-text:  #90355E; /* h350 rose-plum */
  --target: #957EC0; --target-soft: #F1ECFC; --target-text: #644994; /* h300 lilac */
  --likely: #3296B4; --likely-soft: #E0F3FA; --likely-text: #0F617D; /* h222 lagoon */
  --danger: #C53732; --danger-soft: #FFEBE8;  /* errors and destructive actions only */
}
```

Each tier's text-on-soft pair measures 6.1–6.3:1 (Lc ~75). Each mark fill on white is 3.4–3.6:1, so it clears the 3:1 non-text floor.

Dark mode: dim navy, elevation by lightness, desaturated brand ([Apple Dark Mode](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/dark-mode.json), [M3 Dark](https://github.com/material-components/material-components-android/blob/master/docs/theming/Dark.md)):

```css
:root[data-theme="dark"] { /* mirror under @media (prefers-color-scheme: dark) :root:not([data-theme="light"]) */
  color-scheme: dark;
  --canvas:  #0D131C; /* oklch(18.5% .02 255), never #000; the current #0B0C0F is L15.5 */
  --surface: #131A24; /* 21.5%: card */
  --raised:  #1A222D; /* 25%: hover, raised, popover */
  --sunken:  #090F16; /* 16.5% */
  --line:    #252F3A; /* 30% */
  --ring:    rgb(231 236 242 / .07);
  --input-border: #637080; /* 54%: 3.5:1 on surface */
  --ink:     #E7ECF2;  /* 94%: Lc -94 */
  --ink-2:   #C4CBD5;  /* 84%: Lc -73 */
  --ink-3:   #A3ACB8;  /* 74%: 16px and up, placeholder */
  --brand:   #2F74BB;  /* oklch(55% .13 252): white 4.86:1; hover goes DARKER to #2268AE, oklch(51% .13 252), 5.8:1 */
  --brand-text: #8EC3F9; /* oklch(80% .095 250) 10:1 */
  --brand-soft: #152A41;
  --apricot: #ECAF79; --apricot-soft: #3E2815;
  --reach: #D887AE; --reach-soft: #412331; --reach-text: #EFB8D1;
  --target: #AD98D5; --target-soft: #322843; --target-text: #D0C2ED;
  --likely: #5EB1CD; --likely-soft: #0F333E; --likely-text: #A0D4E7;
}
```

### 2.3 Rules

- **Contrast floors.** WCAG 2.2 AA is the conformance bar: 4.5:1 for text, 3:1 for large text and for any boundary that identifies a control ([1.4.3](https://raw.githubusercontent.com/w3c/wcag/main/understanding/20/contrast-minimum.html), [1.4.11](https://raw.githubusercontent.com/w3c/wcag/main/understanding/21/non-text-contrast.html)). Then tune with APCA:
  - Body text: Lc ≥ 90 preferred, Lc 75 minimum, and only at 16px/500 or 18px/400.
  - 12–14px text: Lc ≥ 85–90. That means `--ink-2`, never `--ink-3`.
  - Headlines of 36px and up: about Lc 90–95. Don't push higher; APCA gives Lc 90 as the suggested maximum for large bold text and large colour areas.
  - Card borders are decorative and exempt from 3:1.

  Source: [APCA](https://raw.githubusercontent.com/Myndex/SAPC-APCA/master/documentation/APCA_in_a_Nutshell.md).
- **Soften surfaces, not text.** The softness comes from tinted canvas, tonal bands and navy ink, never from greyed-out body text ([Refactoring UI notes](https://gist.github.com/ynotdraw/9351627d7509cc35813eeac4245cab3b)).
- **Tint borders, shadows and rings toward the ink hue** ([Vercel guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/README.md)).
- **Derive in CSS.** Use `oklch()`, relative colour (`oklch(from var(--brand) calc(l - .05) c h)`) and `color-mix(in oklab, …)`, with hex fallbacks. Relative colour syntax needs Chrome 122, Firefox 128 or Safari 18. Gamut limits for blue near h250: C ≤ .003 at L ≥ 99, ≤ .017 at L 96, ≤ .028 at L 93 ([MDN relative colors](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/css/guides/colors/using_relative_colors/index.md), [Chrome HD color](https://developer.chrome.com/docs/css-ui/high-definition-css-color-guide)). Add `@media (prefers-contrast: more)`: there, ink-2 and ink-3 become ink and lines become `--input-border`.
- **Avoid these two clichés.** AI purple: no indigo or violet as the brand, no blue→violet gradients. The 2026 cream + serif display + sage/terracotta set ([tells.md](https://raw.githubusercontent.com/JCarterJohnson/vibecoded-design-tells/main/skill/references/tells.md), [Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)). Lilac appears only as a data tier, never as a brand or "AI" signal.
- **Gradients.** At most one per page: the Home hero product moment and the Interview stage. Write each as stacked `radial-gradient(… in oklab, oklch(90% .05 250 / .5), transparent 70%)` layers, with a hue span ≤ 30–60° and an L change ≤ 8. **No gradient text, no zero-offset coloured glows, no WebGL mesh** ([Chrome HD color](https://developer.chrome.com/docs/css-ui/high-definition-css-color-guide), [tells examples](https://raw.githubusercontent.com/JCarterJohnson/vibecoded-design-tells/main/unslop-ai-ui/comment_tell_examples.md)).
- **Glass only on floating chrome:** the desktop top bar, the chat composer dock and the Interview toolbar. Use `background: color-mix(in oklab, var(--surface) 72%, transparent); backdrop-filter: blur(14px) saturate(150%)`. Add `@supports not (backdrop-filter: blur(1px))` and `@media (prefers-reduced-transparency: reduce)` solid fallbacks. Keep it off on phones, because `backdrop-filter` makes the bar the containing block of the fixed bottom tab bar; `styles.css` already notes this ([Apple Materials](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/materials.json), [MDN backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter)).
- **At most one deep band per page, never the Home hero.** Deep bands use `#111727`–`#192B5C` navy, never `#000`. Secondary text on them is `#C9D2EE` (Lc -77). The Interview stage is the main use ([Apple Dark Mode](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/dark-mode.json)).
- **Theme the browser surfaces:** `::selection { background: var(--brand-soft) }`, `caret-color: var(--brand)`, `accent-color: var(--brand)`, `scrollbar-color: var(--line) transparent`, `<meta name="theme-color">` per theme, and `text-underline-offset: 3px` on links ([Impeccable craft floor](https://raw.githubusercontent.com/pbakaus/impeccable/main/skill/reference/craft-floor.md)).

---

## 3. Shape: soft corners with hierarchy

The owner's "too many sharp corners" comes from two things: the broadsheet treatment, where panels are flattened to hairlines with `border-radius: 0`, and square 2px-radius data bars. Uniform big radii won't fix it. "One border-radius on everything regardless of hierarchy" is its own tell ([Anthropic skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md)).

### 3.1 Radius scale: one table, assigned by role

| Token | Value | Use |
|---|---|---|
| `--r-xs` | 6px | tags, kbd, checkboxes (a checkbox never goes round, so it can't be read as a radio, per [Radix](https://raw.githubusercontent.com/radix-ui/website/main/data/themes/docs/theme/radius.mdx)), tooltips. Inline essay highlights use 4px. |
| `--r-sm` | 10px | inputs, selects, menu items, square icon buttons, university monograms |
| `--r-md` | 14px | repeated rows and cards (activity entry, university row, honors list), popovers, callouts |
| `--r-lg` | 20px | panels (Academics, chance detail, essay paper, interview cards), Home hero product card |
| `--r-xl` | 28px | chat composer, modals, bottom sheets, Interview stage, Home feature bands |
| `--r-full` | 9999px | **all buttons**, chips, filter pills, segmented controls, toggles, avatars, **every progress track and bar fill** |

Sources: [M3 Shape](https://raw.githubusercontent.com/material-components/material-components-android/master/docs/theming/Shape.md) (0/4/8/12/16/20/28/32/48/full), [Radix radius tokens](https://raw.githubusercontent.com/radix-ui/themes/main/packages/radix-ui-themes/src/styles/tokens/radius.css), [Apple WWDC25 356](https://developer.apple.com/videos/play/wwdc2025/356/). The 6/10/14 steps are not on M3's ladder; this is a product scale.

- **No filled or boxed container below 6px.** Hairline section dividers may stay square, but only as dividers, never as a way to flatten panels.
- **Don't box every section.** Page-level bands go full-bleed and change tone between them. "Every section inside a rounded rectangle" is a tell ([21st.dev](https://21st.dev/blog/website-not-look-ai-generated) *(snippet)*).
- **Don't flare.** A non-pill element must not get a radius of half its height or more. Large containers must not sit at 0–4px, which reads pinched (Apple WWDC25 356).

### 3.2 Concentric nesting

Rule: inner radius = outer radius − padding − border, and the child radius is always ≤ the parent radius ([Vercel](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/README.md), [Apple Liquid Glass](https://developer.apple.com/tutorials/data/documentation/TechnologyOverviews/adopting-liquid-glass.json)).

```css
.nest { --r: var(--r-lg); --pad: 8px; border-radius: var(--r); padding: var(--pad); }
.nest > * { border-radius: max(6px, calc(var(--r) - var(--pad) - var(--bw, 0px))); }
```

Worked examples:

- **Chat composer:** 28px radius, 10px inset, so the inner radius is 18px. That makes the send button a perfect 36px circle. This is why the composer is `--r-xl`.
- **Popover and menu items:** 14px popover with a 6px inset gives 8px items.
- **Segmented control:** a capsule with a 4px inset gives capsule segments.
- **Score card:** 20px card with a 4px inset highlight gives 16px.
- **Large padding:** when the padding is about as large as the outer radius (24px inside a 20px card), the curves no longer read as linked. Take the child's radius from the scale (`--r-sm` or `--r-md`) instead.

### 3.3 Squircle (optional, ship last)

```css
@supports (corner-shape: squircle) {
  .panel, .card, .composer, .sheet { corner-shape: squircle; }
  :root { --r-md: 18px; --r-lg: 26px; --r-xl: 36px; } /* a squircle reads tighter at the same radius: retune by eye */
}
```

Support: Chrome/Edge 139+ only, marked experimental. Other browsers keep normal round corners. It has no effect at radius 0. Never use `bevel`, `notch` or `scoop` ([MDN corner-shape](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/css/reference/properties/corner-shape/index.md), [BCD 8.1.5](https://registry.npmjs.org/@mdn/browser-compat-data)).

### 3.4 Softness beyond corners

- **Icons:** one outline set (Lucide is already in place) with `stroke-linecap: round; stroke-linejoin: round`. Use one stroke weight, 1.75px at 20px, chosen to match 500-weight text.
- **Charts:** use round-ended tracks. Bars get a 4–6px top radius. Use circles for single stat readouts (profile strength, essay score).

Sources: [Duolingo shape language](https://blog.duolingo.com/shape-language-duolingos-art-style/), [Apple icons](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/icons.json). The finding that people prefer curved objects ([Bar & Neta](https://www.nmr.mgh.harvard.edu/publications/journal_articles/882)) is an extrapolation when applied to UI.

---

## 4. Spacing and density: make crowded screens calm

### 4.1 Scale and rhythm

```css
:root {
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 32px;
  --s-7: 48px; --s-8: 64px; --s-9: 96px; --s-10: 128px;
  --space-inline: var(--s-2);   /* label → input, icon → text */
  --space-stack: var(--s-4);    /* field → field, row → row */
  --space-group: var(--s-7);    /* group → group inside a tab (48–64px) */
  --space-section: var(--s-9);  /* Home sections: 96px tablet, 128px desktop */
  --card-pad: var(--s-5);       /* 24px desktop, 16px phone */
}
```

Allow no one-off values ([Carbon spacing](https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/elements/spacing/overview.mdx), [Radix space](https://raw.githubusercontent.com/radix-ui/themes/main/packages/radix-ui-themes/src/styles/tokens/space.css)).

- **Gaps between groups are at least 2× the gaps within a group.** Equal gaps everywhere are what make a screen feel crowded and flat ([Impeccable layout](https://raw.githubusercontent.com/pbakaus/impeccable/main/skill/reference/layout.md)). This ratio is a synthesis, not a spec value.
- **Headings get more space above than below:** 48 above, 12–16 below.
- **Group in this order:** whitespace first, then a tone change, then a 6–8% ring, and a hard divider last. Use at most two container levels (page > card > content), and never put cards inside cards. Inside a card, group with spacing and a `--sunken` well ([Apple Layout](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/layout.json), [M3 Card](https://raw.githubusercontent.com/material-components/material-components-android/master/docs/components/Card.md)).
- **Use cards only for repeated, equivalent items:** university rows, activity entries, saved essays. Group everything else with proximity and bands ([Impeccable layout](https://raw.githubusercontent.com/pbakaus/impeccable/main/skill/reference/layout.md)).

### 4.2 Density rules per view

- **One primary action per view:**
  - Home: Start your profile
  - Chat: Send
  - Activities: Add activity
  - Chances: Add university
  - Essays: Grade essay
  - Interview: Start mock interview

  Everything else is tonal (brand-soft background with brand-text), outline or ghost ([Primer button](https://raw.githubusercontent.com/primer/design/main/content/components/button.mdx), [Polaris](https://raw.githubusercontent.com/Shopify/polaris/main/polaris.shopify.com/content/components/actions/button.mdx)).
- **Summary first, detail on demand.** One disclosure level per row, one open per group ([Apple Layout](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/layout.json), [Carbon disclosures](https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/patterns/disclosures-pattern/index.mdx)). Implement with `<details>`, animate `::details-content` (Chrome 131, Firefox 143, Safari 18.4), and add `interpolate-size: allow-keywords` as progressive enhancement.
  - **Chances row:** school, tier label, one track with the band, a one-line reason. The single expansion holds contributors and completeness. Methodology is one page-level sheet.
  - **Activities entry:** role, org, a one-line description and hours. Grade chips, character count and tips move into the "Edit details" drawer. Show a tip only when there is an action ("Add hours").
  - **Essays:** score + top 3 things to fix. The full list is on demand. The legend collapses into a "Highlights" toggle.
  - **Interview:** setup shows school, style and Start. Length, format, focus and coaching sit under "Session options".
- **First viewport heuristic:** one primary task and about 3 groups or fewer above the fold. Hero emphasis moments are capped at 1–2 per screen ([Google M3 Expressive research](https://design.google/library/expressive-material-design-google-research) *(snippet)*).
- **Squint test.** Blur the screenshot; primary, secondary and the groups should still read in order. Don't overcorrect into empty screens ([taste-skill](https://raw.githubusercontent.com/Leonxlnx/taste-skill/main/skills/taste-skill/SKILL.md)).
- **Measure.** `max-inline-size: 66ch` for prose, chat messages and the essay body, 60ch for landing paragraphs, 45ch for card descriptions. Use `ch` or `rem`, never `px`. On wide screens, a two-thirds main column plus a one-third rail ([web.dev typography](https://raw.githubusercontent.com/GoogleChrome/web.dev/main/src/site/content/en/learn/design/typography/index.md), [GOV.UK layout](https://raw.githubusercontent.com/alphagov/govuk-design-system/main/src/styles/layout/index.md)).
- **Density knob.** Give each tab one `--scaling` variable (Radix pattern) so a crowded view can be loosened in one place.

---

## 5. Type

- **Replace Geist and Geist Mono.** Geist is flagged as the "I didn't pick a font" default, and Anthropic flags monospace for small data labels ([tells.md](https://raw.githubusercontent.com/JCarterJohnson/vibecoded-design-tells/main/skill/references/tells.md), [funboy T2](https://raw.githubusercontent.com/funboy322/avoid-ai-design/main/references/ai-tells-catalog.md)).
  - Avoid also: Inter, Space Grotesk, Syne, Sora, Cal Sans, Instrument Serif, Fraunces, Playfair.
  - The shortlist is all in google/fonts and on no tell list. Features below were checked in the font files:

  | Face | Weights | Figures | Notes |
  |---|---|---|---|
  | **Onest** | 100–900 | `tnum` | `ss01`/`ss02`. Friendly, distinctive. Recommended for Harbor. |
  | Schibsted Grotesk | 400–900 | `tnum` | Sturdy newsroom grotesk. |
  | Atkinson Hyperlegible Next | 200–800 | `tnum` | Designed for legibility, which is a reason a student product can state. |
  | Hanken Grotesk | 100–900 | Tabular by default | No `tnum` needed. |

  Sources: [Onest](https://raw.githubusercontent.com/google/fonts/main/ofl/onest/METADATA.pb), [Schibsted](https://raw.githubusercontent.com/google/fonts/main/ofl/schibstedgrotesk/METADATA.pb), [Atkinson Next](https://raw.githubusercontent.com/google/fonts/main/ofl/atkinsonhyperlegiblenext/METADATA.pb), [Hanken](https://raw.githubusercontent.com/google/fonts/main/ofl/hankengrotesk/METADATA.pb).

  Choose by setting a real Chances row and an essay paragraph in each, side by side. **Keep Newsreader** for the essay paper ([cookbook](https://platform.claude.com/cookbook/coding-prompting-for-frontend-aesthetics) lists it as distinctive).
- **Scale.** Use 2–3 visible sizes per view, 5 at most.

  | Role | Size and leading |
  |---|---|
  | Body | 16px / 1.55 |
  | Chat | 16px / 1.6 |
  | Essay paper | 18px / 1.7 |
  | UI labels | 14px |
  | Meta | 13px minimum, in `--ink-2` |
  | Mobile tab labels | 12px minimum (now 11px) |
  | H2 | 28–32px |
  | Display | `clamp(2.5rem, 1.6rem + 3vw, 4rem)` |

  The display-to-body ratio is about 3–4× ([Radix typography](https://raw.githubusercontent.com/radix-ui/themes/main/packages/radix-ui-themes/src/styles/tokens/typography.css), [Rauno](https://raw.githubusercontent.com/raunofreiberg/interfaces/main/README.md)).
- **Weights:** 400 body, 500 UI emphasis, 600 headings, 700 only for big numerals. Never change weight on hover or selection.
- **Tracking:** display −0.02 to −0.025em (today −0.04em, at the limit). 0 for body and UI text ([Primer](https://raw.githubusercontent.com/primer/design/main/content/foundations/typography.mdx)).
- **Details:**
  - `text-wrap: balance` on headings, `pretty` on paragraphs.
  - `font-variant-numeric: tabular-nums` on every %, GPA, IB score, SAT, word count and date column. Put a non-breaking space between number and unit.
  - Curly quotes and `…`.
  - Sentence case.
  - Headlines of 2 lines max ([Vercel](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/README.md)).
- **Loading:**
  - Self-host one variable woff2 and preload it.
  - Load Newsreader only when Essays opens.
  - Declare a metric-matched fallback (`@font-face { font-family: "UI-fallback"; src: local("Arial"); size-adjust; ascent-override; descent-override; line-gap-override }`) so `display=swap` doesn't shift layout.
  - Targets: CLS ≤ 0.1, LCP ≤ 2.5s ([web.dev size-adjust](https://raw.githubusercontent.com/GoogleChrome/web.dev/main/src/site/content/en/blog/css-size-adjust/index.md)).

---

## 6. Elevation

- **Declare elevation once per surface:** a tone step, a ring or a shadow. Resting cards on the canvas get `--shadow-rest`. Static blocks inside a panel get none.
- **Real shadows only on things that float:** menus, popovers, the sticky composer, modals, sheets, and a dragged row.
- **Ink-tinted, layered shadows** ([Vercel](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/README.md), [Radix shadows](https://raw.githubusercontent.com/radix-ui/themes/main/packages/radix-ui-themes/src/styles/tokens/shadow.css)):

```css
:root {
  --ink-rgb: 24 36 55;
  --shadow-rest:    0 0 0 1px rgb(var(--ink-rgb) / .07), 0 1px 2px rgb(var(--ink-rgb) / .05);
  --shadow-raised:  0 0 0 1px rgb(var(--ink-rgb) / .06), 0 2px 4px -2px rgb(var(--ink-rgb) / .08), 0 8px 20px -6px rgb(var(--ink-rgb) / .10);
  --shadow-overlay: 0 0 0 1px rgb(var(--ink-rgb) / .06), 0 12px 32px -12px rgb(var(--ink-rgb) / .18), 0 24px 60px -12px rgb(var(--ink-rgb) / .12);
  --shadow-cta:     0 1px 2px rgb(25 101 173 / .20), 0 6px 14px -6px rgb(25 101 173 / .25); /* alpha ≤ .25, never a glow */
}
:root[data-theme="dark"] { --shadow-raised: inset 0 1px 0 rgb(255 255 255 / .05), 0 8px 24px -8px rgb(4 8 16 / .6); }
```

- One light source: every y offset is positive and x = 0.
- In dark mode, elevate with lighter surfaces (`--surface` → `--raised`) plus an inner top highlight ([M3 Dark](https://github.com/material-components/material-components-android/blob/master/docs/theming/Dark.md)).
- **Never:** the ghost card (grey hairline plus a wide soft blur), the same shadow under every card, or a hover lift on every card ([Impeccable craft floor](https://raw.githubusercontent.com/pbakaus/impeccable/main/skill/reference/craft-floor.md)).
- **Selected state.** Replace the 2px side stripes with a tone step (brand-soft, and brand-soft-2 on hover) plus brand-text on the label or icon, at the same font weight. Render the essay prompt as a `--sunken` 14px well.

---

## 7. Motion and interaction

### 7.1 Gate: should it move at all?

| How often it's seen | Motion |
|---|---|
| 100+ times a day (tab hop, typing, sending a message) | none |
| Tens of times a day (hover, toggles, list navigation) | ≤ 150ms, colour or opacity only |
| Occasional (drawer, modal, toast, a results reveal) | standard motion |
| Rare (first essay graded, profile complete, interview done) | the only place for delight |

Every animation must name its job: feedback, spatial continuity, state change, avoiding a jarring jump, or explanation. Delight is allowed only in the rare tier ([Emil design-eng](https://raw.githubusercontent.com/emilkowalski/skills/main/skills/emil-design-eng/SKILL.md), [Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion)).

### 7.2 Tokens (replace the `fx/kit.css` set)

```css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);      /* entering, responding */
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);  /* moving or morphing on screen: tab pill, reorder */
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);   /* sheets */
  --dur-press: 120ms; --dur-hover: 150ms; --dur-menu: 180ms; --dur-modal: 250ms;
  --dur-drawer: 360ms; --dur-hero: 600ms;          /* --dur-hero: Home only */
  /* spring baked into linear(), bounce 0 (keep the current sampler, but with no overshoot) */
}
```

- Duration grows with the area that moves. Exits are the same length as entrances or shorter (≈150ms).
- Never use `ease-in` for responses. Use `linear` only for spinners, progress fills and shimmer ([Emil](https://raw.githubusercontent.com/emilkowalski/skills/main/skills/emil-design-eng/SKILL.md), [M3 Motion](https://raw.githubusercontent.com/material-components/material-components-android/master/docs/theming/Motion.md)).
- **Springs.** Default bounce 0, duration 0.35–0.45s. Use bounce 0.1–0.2 only after a gesture with momentum, never above 0.4. Never overshoot opacity or colour ([WWDC23 springs](https://developer.apple.com/videos/play/wwdc2023/10158/), [WWDC18 fluid](https://developer.apple.com/videos/play/wwdc2018/803/)).
- **Interruptible.** Use CSS transitions, not `@keyframes`, for anything that can fire twice a second. Never disable input during motion, and never wait for `animationend` ([Vercel](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/README.md)).
- **Performance:**
  - Animate `transform` and `opacity` only, and never write `transition: all`.
  - Write per-frame values (mic meter, drag) to `el.style`.
  - Pause loops when off screen.
  - Use `will-change` only as a last resort.
  - Keep INP ≤ 200ms under 4× CPU throttle.

  Sources: [Emil perf](https://raw.githubusercontent.com/emilkowalski/skills/main/skills/animation-performance/SKILL.md), [web.dev INP](https://raw.githubusercontent.com/GoogleChrome/web.dev/main/src/site/content/en/blog/optimize-inp/index.md).

### 7.3 Micro-interactions (all tabs)

- **Press:** `.btn:active { transform: scale(.97) }` over 120ms `--ease-out`.
- **Hover:** background or colour change over 150ms `ease`, always raising contrast (brand → brand-hover, tonal step 3 → 4 → 5). Gate it in `@media (hover: hover) and (pointer: fine)`.
- **Focus:** `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }`. It follows the radius, appears instantly, and is never hidden under a sticky header.
- **Popovers and menus:** start from `opacity: 0; scale(.97)` with the origin at the trigger, 180ms. Use `@starting-style` (Chrome 117, Firefox 129, Safari 17.5). Never scale from 0.
- **Modals:** scale .96 → 1 with the backdrop fading over the same 250ms.
- **Toasts:** translateY(100%) → 0 over 400ms `ease`; they leave through the same edge.
- **Tooltips:** delay the first in a group, then open neighbours instantly. Menus open on `pointerdown`.
- **Theme switch:** turn transitions off briefly. The current circular reveal may stay because it's a rare action, but keep it under 400ms.
- **Signature (Harbor and Pennant):** the selected segmented tab and filter pill morph from `--r-full` to `--r-md` over 200ms `--ease-in-out` (M3 Expressive [buttons](https://raw.githubusercontent.com/material-components/material-components-android/master/docs/components/CommonButton.md)). Use at most one morph per view.

Sources: [Rauno](https://raw.githubusercontent.com/raunofreiberg/interfaces/main/README.md), [Emil recipes](https://raw.githubusercontent.com/emilkowalski/skills/main/skills/animate/RECIPES.md).

### 7.4 Per-page budget

| Page | Allowed | Forbidden |
|---|---|---|
| Shell / tab switch | Opacity crossfade ≤ 150ms via View Transitions (no translate). Today it's 120ms out + 260ms in with a 6px rise: cut it. The active-tab indicator moves in CSS, 200ms `--ease-in-out`. | Horizontal slides between tabs; JS layout animation for the indicator |
| Home | One staggered page-load **once per session**: ≤ 6 items, 50ms step, 450–600ms each, translateY 12–16px, `--ease-out`. The hero product moment (§12 signature). | Fade-up on every section, count-up stats, marquee, typing headline, parallax |
| Chat | Shimmer "Thinking…" after a 300ms delay. Per-word fade of 150ms `ease` while streaming; remove the spans when done. Stick to the bottom unless the user scrolls up, then show a "Jump to latest" capsule. Suggestion chips get a 40ms stagger on first visit only. | Animation on Send, bouncing dots, per-character animation |
| Activities | Drawer 360ms `--ease-drawer`. Reorder with FLIP over 200ms. Optimistic save with inline Undo. The profile ring rolls only on change. | Entrance stagger, hover lift on cards |
| Chances | The band settles on a non-bouncy spring when an input changes. Numbers roll old → new in ≤ 600ms, `tabular-nums`. The first-ever reveal may stagger 40ms, once. Row expand ≤ 200ms. The what-if slider updates directly, with no tween lag. | Count-up from 0 on every mount, gauge sweep |
| Essays | First grade: highlights paint sentence by sentence at a 40ms step, capped at 400ms total, never blocking editing. Category switch: 150ms colour crossfade. Clicking a finding scrolls to it plus one soft 600ms pulse. Optional scroll-driven reading-progress bar (`animation-timeline: scroll()`). | Re-painting on every keystroke |
| Interview | Entering the room: 300ms fade-through. Question stepper: shared-axis X over 250ms. The mic meter writes directly to `el.style`. A soft speaking ring. A completion delight once per session. | Countdown timers by default, a breathing glow loop of 5s or longer without a pause control |

Sources: [M3 Motion](https://raw.githubusercontent.com/material-components/material-components-android/master/docs/theming/Motion.md), [Streamdown animation](https://raw.githubusercontent.com/vercel/streamdown/main/apps/website/content/docs/animation.mdx), [use-stick-to-bottom](https://raw.githubusercontent.com/stackblitz-labs/use-stick-to-bottom/main/README.md), [NumberFlow](https://raw.githubusercontent.com/barvian/number-flow/main/packages/number-flow/src/lite.ts), [Chrome scroll-driven](https://raw.githubusercontent.com/GoogleChrome/developer.chrome.com/main/site/en/articles/scroll-driven-animations/index.md), [WCAG 2.3.3](https://raw.githubusercontent.com/w3c/wcag/main/understanding/21/animation-from-interactions.html).

**Vanilla equivalents for React-only libraries:**

| Instead of | Use |
|---|---|
| `@number-flow/react` | the `number-flow` custom element, or the existing `UC.motion.countUp` with a `from` |
| Streamdown | small span wrappers removed on completion |
| use-stick-to-bottom | a hand-written IntersectionObserver sentinel |
| Motion `layout` | the existing `UC.motion.flip` |

### 7.5 Loading, pending, empty

- **Spinners and skeletons:** show only if the wait exceeds 150–300ms, then keep them for at least 300–500ms. Skeletons mirror the final layout and radii.
- **Loading buttons** keep their label plus "…" ("Grading…").
- **Every data view has empty, sparse, dense and error states.** Empty-state anatomy: a positive title ("Add your first university"), one benefit sentence, one primary action, and starter chips. It sits in place, not in a modal.

Sources: [Vercel](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/README.md), [Carbon empty states](https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/patterns/empty-states-pattern/index.mdx).

### 7.6 Delight and reduced motion

- **Delight:** one moment per major flow (first essay graded, list balanced, profile 100%, mock interview finished). Keep it under 1s, skippable, with a settings toggle. Use canvas-confetti with `disableForReducedMotion: true`. Never celebrate routine actions. No leaderboards or streak guilt ([canvas-confetti](https://raw.githubusercontent.com/catdad/canvas-confetti/master/README.md), [Duolingo UX writing](https://raw.githubusercontent.com/virgiliojr94/duolingo-ux-reference/master/references/ux-writing.md), [Asana](https://zapier.com/blog/asana-celebrations/) *(snippet)*).
- **`prefers-reduced-motion: reduce`:** tone down rather than switch off. Replace translate, scale and spring with ≤ 200ms crossfades. Override `::view-transition-group(*)` to a plain fade. Make the shimmer static. Anything auto-playing for more than 5s gets a pause control ([MDN](https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/css/reference/at-rules/@media/prefers-reduced-motion/index.md), [web.dev](https://raw.githubusercontent.com/GoogleChrome/web.dev/main/src/site/content/en/blog/prefers-reduced-motion/index.md)). Note: the current kit stops all motion under reduced motion, which is acceptable but blunt.

---

## 8. Data: chances, essays and interview, shown responsibly

### 8.1 Chances

- **Encode with length and position, not gauges.** Each row gets:
  - one shared 0–100% track, 8–10px tall, fully rounded;
  - a shaded band for the range;
  - a 12px dot at the midpoint;
  - a thin tick for the school's overall admit rate.

  All rows share the scale. **Remove the semicircle gauge** in the detail panel ([NN/g dashboards](https://www.nngroup.com/articles/dashboards-preattentive/) *(snippet)*, [Apple Charts](https://developer.apple.com/design/human-interface-guidelines/charts)).
- **Honest ranges.**
  - Round to the nearest 5% and never show decimals.
  - Pair each range with a frequency phrase: "About 4 in 10 students with profiles like yours are admitted".
  - Make the band visibly wider when inputs are missing.
  - An optional 20-dot icon array may sit in the expansion.

  Sources: [College Transitions](https://www.collegetransitions.com/college-admissions-calculator/) *(snippet)*, [Kay et al.](https://idl.uw.edu/papers/when-ish-is-my-bus), [Fernandes et al.](https://mucollective.northwestern.edu/project/uncertainty-bus).
- **Tiers.** Use labels "Reach / Target / Likely" (not "Safety") and the calm tier hues from §2. Every tier has a text label, so meaning never relies on colour alone. A summary headline above the list: "Your list is balanced: 3 reach, 3 target, 4 likely".
  - *Proposed cutoffs, a product decision to disclose in the method sheet:* Reach when the midpoint is under 25% **or** the admit rate is under 15%; Target 25–60%; Likely over 60%. Sources vary from 10% to 25% for the reach line ([CollegeVine](https://blog.collegevine.com/the-college-list-decoded-safeties-targets-and-reaches/) *(snippet)*, [Collegewise](https://go.collegewise.com/what-is-a-safety-school-college-admissions) *(snippet)*).
- **Explain, don't just score.** The single row expansion holds:
  - a one-sentence summary;
  - 3–5 contributors phrased as questions ("Is your GPA in this school's typical range?"), each with a pill (Strong / On track / Room to grow) in tier-neutral styling, the actual value, and one action;
  - a completeness line: "Based on 9 of 14 factors. Add test scores to sharpen this."

  Sources: [Oura readiness](https://ouraring.com/blog/readiness-score/) *(snippet)*, [Apple ML](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/machine-learning.json).
- **Methodology** is one "How we estimate" sheet: inputs, limits ("less reliable at the most selective schools"), cutoffs and a last-updated date. When a scattergram would have fewer than 3 points, hide it and say so ([Cialfo](https://help.cialfo.co/en/articles/3733046-scattergrams-explained) *(snippet)*).
- **What-if interactivity** where it teaches: "If my SAT were 1450" moves the band live (INP ≤ 200ms). Touch targets are 44px or larger, with no drag-only controls ([NN/g teens](https://www.nngroup.com/articles/usability-of-websites-for-teenagers/) *(snippet)*).

### 8.2 Essays

- **Remove the "% human / AI-like" score and AI-detection-first default.** GPT detectors misclassified more than half of non-native TOEFL essays ([Liang et al.](https://raw.githubusercontent.com/Weixin-Liang/ChatGPT-Detector-Bias/main/README.md)). Rename the category "Generic phrasing", give each highlight its reason, and add one limits line: "Pattern checks can misread plain or non-native writing." ([Apple gen-AI](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/generative-ai.json)).
- **Four categories maximum, at matched lightness.** The ink measures 12.7–13:1 on every fill. Each category also has an underline style, so colour is never the only cue. Strengths are marked too, so feedback isn't only red marks.

  | Category | Fill | Underline |
  |---|---|---|
  | Grammar | rose `#FEE1E5` | wavy |
  | Clarity | highlighter `#F8EBBA` | solid |
  | Generic phrasing | lilac `#EAE6FC` | dotted |
  | Strengths ("What a reader remembers") | sky `#D3F0F7` | dashed, plus a check icon |

  Implementation:
  - Underlines in step-9 tones: `#C6495B`, `#A77F19`, `#7761B0`, `#1988A3`.
  - Intensity in 2–3 steps: `color-mix(in oklch, var(--hl) 60% | 100%, transparent)`.
  - `border-radius: 4px; box-decoration-break: clone`.

  Sources: [GPTZero deep analysis](https://gptzero.me/news/understanding-ai-detection-results-with-deep-analysis/) *(snippet)*, [Grammarly](https://www.grammarly.com/blog/product/better-writing-with-grammarly/) *(snippet)*.
- **Layout:** the score up top and a "Top sentences to revisit" list. Clicking a highlight opens one side card. The essay paper sits on `--surface` at `--r-lg` on the `--canvas`, so it reads as a page.

### 8.3 Interview

- **Give insights, not grades.** Show talking points covered, filler words with counts, and terms used. The two main actions are "Try this question again" and "Next question". Replace the "7.4/10" headline and skill bars with "Since Sep 22: you think aloud more often" plus a small trend ([Google Interview Warmup](https://9to5google.com/2022/05/17/google-interview-warmup/) *(snippet)*).
- **Consent.** Show a short explainer before the browser's microphone prompt. Say whether audio and transcripts are kept, default to not keeping them, and offer download ([Apple gen-AI](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/generative-ai.json)).

---

## 9. Copy density

- **Cut cliché verbs:** "Transform", "Supercharge", "Unleash", "Elevate", "Seamless", "Effortlessly", "Your journey". Also cut em-dash cadence and arrow glyphs in labels.
- **Length:** headlines ≤ 2 lines (about 32 characters is safe), statements ≤ 25 words, one idea per block.
- **Labels and messages:** buttons name the outcome ("Grade my essay", "Estimate my chances", "Start mock interview"), and the toast reuses the noun ("Essay graded"). Errors name the problem and the fix. Tone works for a 16-year-old and a parent alike. Use energetic copy for wins and gentle, factual copy for odds; never "You won't get in".
- **Proof:** no invented metrics, testimonials, generated avatars or logo walls. Label every sample "Example" ([funboy catalog](https://raw.githubusercontent.com/funboy322/avoid-ai-design/main/references/ai-tells-catalog.md), [design-anti-slop](https://github.com/prathameshagrawal/design-anti-slop)).
- **Separators:** replace middle-dot meta strings with layout (two lines, or label + value) or commas. Keep "Preview" as a single small badge with no dot.

---

## 10. Craft details and navigation

- **Mobile navigation:** at most 5 bottom-bar destinations (Chat, Activities, Chances, Essays, Interview). The logo goes to Home. Labels are 12px or larger, targets 44px or larger, and there is no "More" tab ([M3 bottom nav](https://raw.githubusercontent.com/material-components/material-components-android/master/docs/components/BottomNavigation.md), [Apple tab bars](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/tab-bars.json)).
- **Top bar (desktop):**
  - Logo, then a "Preview" badge.
  - Tabs.
  - The deadline chip as one apricot-soft capsule ("Cambridge in 2 days").
  - Search (⌘K), the theme toggle and the avatar. Fold notifications into the avatar menu: 10 controls become 8.
- **Icons:** no emoji. Don't use the sparkles icon for "AI". No tinted icon tiles above headings or titles. Every status icon gets a text label. Optically nudge send and play glyphs by 1px ([Apple icons](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/icons.json)).
- **Alignment:** 2–3 shared left edges per page. Numbers are right-aligned with tabular figures. Capsule buttons use `padding-inline` of 1.5–2× `padding-block`.
- **Interaction details:**
  - Hit targets 24px or larger (44px on touch).
  - Inputs at 16px or larger on mobile.
  - `touch-action: manipulation`.
  - `overscroll-behavior: contain` in sheets.
  - Tab and filter state in the URL (already done via hash).

  Source: [Vercel](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/README.md).

---

## 11. Validate with people, not only lists

Before and after the redesign, show Home and Chances for 5 seconds each to about 5 students and 3 parents. Ask three things:

1. What does it do?
2. Would you trust it with your data?
3. Which of two versions do you prefer?

Fix what they notice first. "Design look" was the most-cited credibility cue in Stanford's study (46.1% of comments; [Consumer Reports / Fogg 2002](https://advocacy.consumerreports.org/research/how-do-people-evaluate-a-web-sites-credibility) *(snippet)*).

---

## 12. Three candidate directions

All three share §§3–11. They differ in palette temperature, shape language, typeface and signature. **Harbor is recommended**: it is the smallest step from the current product and fixes every owner complaint. Study desk is the warmest. Pennant is the most expressive.

### A. Harbor: calm, cool, airy (recommended)

**Palette.** Tokens as in §2.2.
- Light: canvas `#F6F9FD`, surface `#FFFFFF`, sunken `#EDF2F8`, wash `#E3F1FD`, ink `#182437`, display ink `#1D3559`, ink-2 `#414E60`, brand harbor blue `#1965AD` = oklch(50% .135 252) (white 6.0:1), brand-soft `#E2EFFD`.
- Second color: apricot `#F1AD71` = oklch(80% .11 62). Its one job is time and attention: the deadline chip, the today marker, "needs action".
- Tiers: rose `#C26C96`, lilac `#957EC0`, lagoon `#3296B4`.
- Dark: canvas `#0D131C`, surface `#131A24`, raised `#1A222D`, ink `#E7ECF2`, brand `#2F74BB` (white 4.86:1), brand-text `#8EC3F9`.

**Shape.** 6 / 10 / 14 / 20 / 28 / full. Capsule buttons. Composer 28px with a 36px round send button.

**Surfaces.**
- Tinted canvas with white cards (6–8% ring + `--shadow-rest`).
- Home alternates canvas and wash bands.
- The only deep surface is the Interview stage: `#111727` with one radial glow `oklch(45% .12 252 / .4)`.

**Type.** Onest 400/500/600. Display 600 at `clamp(2.5rem, 1.6rem + 3vw, 4rem)`, −0.025em. Body 16/1.55. Newsreader 18/1.7 on the essay paper.

**Signature.** *The band settles.*
- On the Home hero, an "Example profile" card adds one activity. The student's chance bands glide along a shared 0–100 track to their new positions on a bounce-0 spring of about 400ms, and the numbers roll from old to new.
- The same motion runs on Chances whenever an input changes. It plays once per change and never on remount.
- An apricot "today" marker anchors the timeline.

### B. Study desk: warm, tactile, editorial

**Palette.**
- Light: paper canvas `#FCF9F4` = oklch(98.3% .007 85), card `#FFFEFC`, sunken `#F5F1EA`, one cool band per page `#E9F1FB`, line `#E7E2DA`, input `#90887C` (3.47:1).
- Ink: fountain-pen navy `#182232` (15.3:1), ink-2 `#454E5B`, ink-3 `#626975`.
- Brand: ink blue `#235193` = oklch(44% .12 258) (white 7.85:1), hover `#1A447F`, brand-text `#1E4B8D`, brand-soft `#E4EFFD`.
- Second color: marigold highlighter `#F5DE87` = oklch(90% .11 95) (ink on it 11.9:1), with marigold-text `#7E5403` on `#FAF1CB` (5.85:1).
- Dark ("desk lamp"): canvas `#17130E`, surface `#1F1A14`, raised `#27221C`, ink `#EDE9E1`, ink-2 `#CFCAC1`, brand `#4574BA` (white 4.68:1), brand-text `#9BC1F1`, marigold `#E6C873` on soft `#3F3112`.

**Constraint.** No serif display face and no sage or terracotta, so the warm paper never becomes the cream cliché.

**Shape.** An "index card" scale: 4 / 8 / 12 / 16 / 24 / full. Buttons are 10px rounded rectangles; capsules are only for chips, filters, segmented controls and tracks. This is the least round option.

**Surfaces.** Flat paper with tone steps. Cards are white on paper with a warm 1px ring and no resting shadow.

**Type.** Schibsted Grotesk 400/500/700 for UI and headings. Display 700 at −0.02em. Newsreader for the essay paper and for quoted essay lines in feedback.

**Signature.** *Highlighter sweep.*
- On the first grade, essay highlights paint left to right per sentence via a `clip-path: inset(0 100% 0 0)` → `inset(0)` transition: 180ms each, 40ms stagger, 400ms cap.
- The same marigold sweep marks the next deadline on the Home timeline.
- Nothing else animates on entry.

### C. Pennant: expressive, richer color

**Palette.**
- Light: canvas `#F3F7FE` = oklch(97.6% .010 258), surface `#FFFFFF`, sunken `#E9F0F9`, sky wash `#DDEEFC` for featured containers and alternating bands, ink `#162137`, ink-2 `#404E63`.
- Brand: pennant royal `#2060B9` = oklch(50% .155 258) (white 6.1:1), hover `#1851A6`, brand-text `#184EA1`, brand-soft `#E1ECFD`.
- Deep dusk band `#162849`, used once per page (Home closing CTA or the Interview stage). Text on it: `#EAEFF5` (12.7:1) and `#B9C9DE` (8.7:1).
- Second color: coral `#E7816D` = oklch(71% .13 32), for celebration, the today marker and attention. Coral-soft `#FFECE6`, coral-text `#A04034` (5.6:1).
- Tiers: mauve `#AE6AA8` / `#F9E9F7` / `#7F387A`, marigold `#DCA744` / `#FDF1D8` / `#83560D`, lagoon `#3296B4` / `#E0F3FA` / `#0F617D`.
- Dark: canvas `#0C1421`, surface `#131C2C`, raised `#1B2538`, ink `#E6ECF3`, ink-2 `#C1CCD9`, brand `#396FC8` (white 4.93:1), brand-text `#9AC0F8`, coral `#EE9781`.

**Shape.** M3-Expressive mix: 8 / 12 / 16 / 24 / 32 / full. Capsule buttons. Circular stat badges for profile strength, essay score and session count. The selected segment morphs from full to 16px. Hero panels are 32px.

**Surfaces.** Tonal containment: the featured group on each screen sits in a sky-wash container with no shadow, and the rest sits on plain surface.

**Type.** Atkinson Hyperlegible Next 400/500/700. Big 48–56px numerals at −0.02em. Body 16/1.55. Newsreader on the essay paper.

**Signature.** *Pennant raise and shape morph.*
- The first-ever Chances reveal raises each band from the track's left edge with a 40ms stagger, once (400ms cap).
- Segmented tabs and filter pills morph shape over 200ms.
- Milestones fire a small coral confetti burst from the triggering element, once each, honouring reduced motion.

---

## 13. One-page checklist

**System**
- [ ] `web/DESIGN.md` written: named colors and roles, type roles, radius, spacing, elevation, one signature, Do/Don't.
- [ ] No Tailwind-default values (`#E5E7EB`, `#F9FAFB`, `#2448E5`, slate/zinc/indigo); brand is harbor blue (or the chosen direction's).
- [ ] Canvas is a tinted off-white, white is used only for raised cards, text is navy ink, and there is no `#000` or `#0B0D12` anywhere.
- [ ] Body text ≥ 4.5:1 and Lc ≥ 75 at 16px. 12–14px meta uses `--ink-2` (Lc ≥ 85). `--ink-3` only at 15px or above. Control boundaries ≥ 3:1.
- [ ] Accent ≤ 5–8% of each viewport, one solid primary button per view, brand blue never used for data, apricot has one job.
- [ ] Geist and Geist Mono replaced. Newsreader only on the essay paper. Body 16px, mobile tab labels ≥ 12px, weights 400/500/600, `tabular-nums` on all figures.

**Shape and space**
- [ ] Radius tokens 6/10/14/20/28/full assigned by role. No `border-radius: 0` or `2px` on any filled container or bar. All tracks are round-ended.
- [ ] Nested radii are concentric (`max(6px, calc(R − pad))`). No cards inside cards. No section boxed just to be boxed.
- [ ] Spacing uses tokens only. Gaps between groups ≥ 2× gaps within. Home sections 96–128px apart, tool tabs 48–64px between groups.
- [ ] Summary first: one disclosure level per row, one open per group, methodology in one sheet.
- [ ] Prose ≤ 66ch, landing copy ≤ 60ch.

**Elevation and chrome**
- [ ] Resting card = tone step + one ring. Shadows only on floating layers, ink-tinted and layered. No ghost cards.
- [ ] Selection = brand-soft tone + brand-text, with no 2px side stripes and no weight change.
- [ ] Glass only on floating chrome, with a solid fallback, and off on phones.
- [ ] At most one gradient region and one deep band per page. No gradient text, no coloured glows.

**Motion**
- [ ] No fade-up on every section, no hover lift on every card, no count-up from 0 on mount, no `transition: all`.
- [ ] Tab switch ≤ 150ms opacity. Home entrance once per session. No entrance stagger on tool tabs.
- [ ] One easing token, durations from tokens, springs at bounce 0 unless a gesture carries momentum.
- [ ] Interruptible, transform/opacity only, INP ≤ 200ms, reduced-motion swaps to crossfades.
- [ ] One signature moment per tab and one delight per flow, with a toggle.

**Content**
- [ ] No arrows on labels, no middle-dot meta strings, no eyebrows, no tinted icon tiles, no emoji, no sparkles icon for "AI".
- [ ] Buttons name their outcome. Headlines ≤ 2 lines, statements ≤ 25 words.
- [ ] Every sample labelled "Example". No invented proof.
- [ ] Chances: shared 0–100 track, rounded ranges plus a frequency phrase, labelled tiers, no gauge, no red, completeness shown.
- [ ] Essays: no "% human" score. At most 4 categories, each with a non-colour cue. Strengths shown. Limits line present.
- [ ] Interview: insights, not grades. Mic consent and storage explained.
- [ ] Mobile: ≤ 5 tabs, 44px targets, every hover-only reveal and drag has a tap alternative.
- [ ] States designed: empty, sparse, dense, loading (skeleton matches layout), error, long content.
- [ ] Silhouette test passed against CollegeVine, Crimson and Common App, and the 5-second test run with students and parents.
