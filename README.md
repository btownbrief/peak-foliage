# PEAK FOLIAGE 🍁🍃

Reversi, Burlington style: land your leaves in the Green Mountains canopy,
bracket a straight line of your rival's, and the whole line flips — every
flip is the season turning. Two thermometers race toward **peak**. A game
for [Btown Games](https://play.btownbrief.com/), the browser arcade of the
[BTown Brief](https://www.btownbrief.com).

**Play it live:** https://play.btownbrief.com/peak-foliage/

## How to play

Standard Reversi rules. 8×8 board, four leaves in the middle to start. On
your turn, place a leaf so it traps a straight line of enemy leaves (any of
the 8 directions) between the new leaf and one of yours — everything trapped
flips to your color. If you have a legal move you must play one; with none,
you pass. When neither player can move (or the board is full), the most
leaves wins. Ties happen — that's stick season.

## Modes

- **Pass & play** — two leaf peepers, one phone (the default).
- **Leaf Peeper** 📷 — grabs the biggest flip it can see, with enough whimsy
  that a kid can beat it. Has never heard of a corner.
- **The Forester** 🌲 — minimax with alpha–beta pruning, at least 6 plies
  deep, with corners and edges weighted the way they deserve. With 10 or
  fewer empty squares it attempts an exact endgame solve — every line read
  to the last leaf — within a time budget, keeping its deep-search answer
  if the clock runs out on a slow phone.

## How it works

Plain static site — no build step, no frameworks, no npm. `index.html` +
`style.css` + ES modules in `js/`:

| file | what it does |
| --- | --- |
| `js/engine.js` | **all** the Reversi rules, as pure functions over a plain JSON state object — see the rule below |
| `js/bot.js` | the Leaf Peeper and the Forester; only ever calls the engine's public API |
| `js/main.js` | UI only: renders state, ripples the flip animation down each line, legal-move dots, hold-to-preview flip counts, the thermometers |
| `js/audio.js` | procedural WebAudio rustles and flips, no audio files |

Every push to `main` deploys to GitHub Pages via `.github/workflows/deploy.yml`.

## The engine rule (the one non-negotiable)

Online multiplayer gets bolted on later by syncing the engine's state object
between phones. That only works if **every** rule lives in `js/engine.js`:

- `createInitialState()`, `legalMoves(state)`, `applyMove(state, move)`
  (returns a NEW state, never mutates), `getStatus(state)`, plus
  `flipsFor(state, move)` so the UI can preview and animate without
  re-deriving rules.
- `engine.js` imports nothing and never touches the DOM, timers, `Date`, or
  `Math.random`.
- The whole game survives `JSON.stringify` → `JSON.parse` → resume.

If you add a rule anywhere else, you've broken the multiplayer plan.

## Testing

```bash
node scripts/test-engine.mjs
```

Plain Node, no test framework. Covers flips in all 8 directions (including
multi-line placements), illegal-move rejection, forced passes, the
double-pass and full-board endings with exact counts, state immutability,
the JSON round trip, the Forester preferring a corner over a bigger greedy
flip, and its endgame play checked move-for-move against a brute-force
perfect solver.

## Regenerating the app icon

`icon-180.png` is rendered from `icon.svg`:

```bash
chrome --headless --screenshot=icon-180.png --window-size=180,180 --default-background-color=00000000 "file://$(pwd)/icon.svg"
```
