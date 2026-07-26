# Peak Foliage — agent instructions

Shared brain for any AI agent working in this repo (Codex, Claude Code, etc.).
Read `README.md` first for the architecture — this file adds the rules an agent
needs. Stephen is non-technical — explain consequential changes in plain
language.

## What this is

Btown's Reversi: green summer leaves vs. peak-red leaves in a Green Mountains
canopy, thermometers racing to peak. Plain static site, **no build step**:
`index.html` + `style.css` + ES modules in `js/`. Deployed by GitHub Pages via
`.github/workflows/deploy.yml` on push. No backend, no accounts, no analytics.

## The one non-negotiable

Every game rule lives in `js/engine.js` as pure functions over a plain
JSON-serializable state object. `engine.js` imports nothing and never touches
the DOM, timers, `Date`, or `Math.random`. `applyMove` returns a **new** state.
Online multiplayer will later sync this exact state object between phones —
rule logic anywhere else (main.js, bot.js) breaks that plan. `js/bot.js` may
only call the engine's public API; `js/main.js` is UI only, and animates flips
from `flipsFor()` rather than diffing grids or re-deriving brackets.

## Before you finish

Run `node scripts/test-engine.mjs` — it must pass. If you touched the bots,
keep the Forester's move comfortably under half a second midgame (the test
prints its slowest move). If you touched the UI, playtest a full game at a
phone-sized viewport — including a forced pass and the endgame — or clearly
say you couldn't and what you inspected instead. Say what you verified.
