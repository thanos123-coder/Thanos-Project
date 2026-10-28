# Claude Code setup

Design and frontend tooling for Claude Code sessions on this repository. Cloud sessions load the skills and MCP servers below when they start on a branch that contains these files.

## Skills (`.claude/skills/`)

| Skills | Source | Licence |
| --- | --- | --- |
| ui-ux-pro-max, uipro-design, design-system, brand, banner-design, uipro-slides, ui-styling | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) @ 28b3b8d, `.claude/skills/` | MIT; ui-styling also Apache-2.0 |
| impeccable | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) @ 8409a56, `.claude/skills/impeccable` | Apache-2.0 |
| design-taste-frontend | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) @ 12af471, `skills/taste-skill` | MIT |
| animate, animate-expo, animation-performance, animation-vocabulary, apple-design, ask-sonner, break-ui, emil-design-eng, find-animation-opportunities, improve-animations, mobile-native, pick-ui-library, prototype, review-animations, write-swift | [emilkowalski/skills](https://github.com/emilkowalski/skills) @ 2d22863, `skills/` (the root `performance-cheatsheet.md` is in animation-performance) | MIT |
| transitions-dev, transitions-polish, transitions-ui-generation, transitions-agent | [Jakubantalik/transitions.dev](https://github.com/Jakubantalik/transitions.dev) @ 6a7d682, `skills/` and `agent/skill` | Transitions.dev License; transitions-agent MIT |
| getlayers | [textura-agency/getlayers-plugin](https://github.com/textura-agency/getlayers-plugin) @ a5224e2, `plugins/getlayers/skills/getlayers` | No licence file upstream |
| react-bits | Written for this repo around `public/llms.txt` from [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits) @ e12c221 | MIT + Commons Clause |
| gsap, lenis | Written for this repo around the upstream READMEs: [greensock/GSAP](https://github.com/greensock/GSAP) @ 13e2b79 with `@gsap/react` 2.1.2, and [darkroomengineering/lenis](https://github.com/darkroomengineering/lenis) @ e01eefb | GSAP standard no-charge licence; Lenis MIT |

Local changes to upstream files:

- UI/UX Pro Max's `design` and `slides` skills are renamed `uipro-design` and `uipro-slides` (folder, frontmatter `name`, and the three lines that name them). A project skill called `design` or `slides` would replace Claude Code's bundled `/design` and `/slides`.
- The `description` in `transitions-ui-generation/SKILL.md` is a YAML block scalar. Upstream it is a plain scalar containing `: `, which isn't valid YAML.

To update a pack, copy its folder again from the source path above and reapply these changes.

Transitions.dev and React Bits forbid redistributing their libraries, so keep this repository private while those folders are in it.

With this many skills, the skill listing can exceed its budget. Claude Code then drops the descriptions of the least-used skills first. If a skill stops triggering on its own, raise `skillListingBudgetFraction` in `settings.json` or invoke the skill by name.

## MCP servers (`.mcp.json`)

- `playwright`: Microsoft's Playwright MCP (`npx @playwright/mcp@latest`). Where `/opt/pw-browsers/chromium` exists (the cloud container), it runs headless against that browser with the Chromium sandbox off, which the container needs. Anywhere else it runs the plain command. Snapshots go to `.playwright-mcp/`, which is ignored by git.
- `21st`: the 21st.dev component generator. In cloud sessions, store the key as a network secret for `21st.dev` (the default Authorization header with the Bearer prefix). The agent proxy then attaches the key and serves the connection with a certificate Claude Code trusts; without the secret, cloud sessions reject 21st.dev's certificate. Elsewhere, set `API_KEY_21ST`. The `x-api-key` header is sent empty when the variable isn't set, since a wrong value there overrides the key the proxy attaches.
- `getlayers`: GetLayers, which needs a paid plan and a sign-in on the first tool call. Needs `mcp.getlayers.ai` reachable.

`settings.json` approves these three servers in folders Claude Code trusts.

## Kept outside this repository

- Security Guidance, claude-code-setup and Figma are plugins on the claude.ai account, because cloud sessions don't install plugins that a repository's settings declare.
- Figma's MCP tools come from the claude.ai Figma connector.
- frontend-design is already on the account.
