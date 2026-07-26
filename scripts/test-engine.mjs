// PEAK FOLIAGE — engine + bot checks. Plain Node, no test framework.
// Run with:  node scripts/test-engine.mjs

import {
  SIZE, EMPTY, GREEN, RED, PASS,
  createInitialState, legalMoves, applyMove, getStatus, flipsFor, opponent,
} from '../js/engine.js';
import { chooseMove } from '../js/bot.js';

let passed = 0;

function assert(condition, label) {
  if (!condition) {
    console.error(`✗ FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${label}`);
}

/**
 * Build a state from an 8-line picture: '.' empty, 'G' green, 'R' red.
 * Row 0 is the top line, same as the engine draws it.
 */
function board(lines, turn) {
  const grid = lines.map((line) =>
    [...line].map((ch) => (ch === 'G' ? GREEN : ch === 'R' ? RED : EMPTY))
  );
  return { grid, turn };
}

function totalFlips(state, move) {
  return flipsFor(state, move).reduce((n, line) => n + line.length, 0);
}

function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

/* ---------------------------------------------------------- fresh board */

{
  const s = createInitialState();
  const st = getStatus(s);
  assert(!st.over && st.turn === GREEN && !st.mustPass, 'fresh board: green to move, game on');
  assert(st.counts.green === 2 && st.counts.red === 2, 'fresh board: two leaves each');
  const moves = legalMoves(s).map((m) => `${m.row},${m.col}`).sort().join(' ');
  assert(moves === '2,3 3,2 4,5 5,4', 'fresh board: exactly the four classic openings');
}

{
  // State must survive a JSON round trip — that's the multiplayer plan.
  let s = createInitialState();
  s = applyMove(s, { row: 2, col: 3 });
  s = JSON.parse(JSON.stringify(s));
  s = applyMove(s, { row: 2, col: 2 });
  const st = getStatus(s);
  assert(st.turn === GREEN && st.counts.red === 3, 'state survives JSON.stringify → parse → resume');
}

{
  // applyMove must never mutate its input.
  const before = createInitialState();
  const snapshot = JSON.stringify(before);
  applyMove(before, { row: 2, col: 3 });
  assert(JSON.stringify(before) === snapshot, 'applyMove returns a new state, never mutates');
}

/* ------------------------------------------- flips in all 8 directions */

{
  // One placement at (3,3) brackets a line in every compass direction —
  // three of them two leaves long. The red at (7,0) is bracketed by nobody.
  const s = board([
    '...G....',
    '.G.R.G..',
    '..RRR...',
    'GRR.RG..',
    '..RRR...',
    '.G.R.RR.',
    '...G..G.',
    'R.......',
  ], GREEN);
  const lines = flipsFor(s, { row: 3, col: 3 });
  assert(lines.length === 8, 'one placement brackets lines in all 8 directions');
  assert(totalFlips(s, { row: 3, col: 3 }) === 12, 'multi-line placement flips all 12 bracketed leaves');
  const after = applyMove(s, { row: 3, col: 3 });
  const st = getStatus(after);
  assert(st.counts.green === 21 && st.counts.red === 2, 'every bracketed leaf turned green, the loose reds did not');
  assert(after.grid[7][0] === RED, 'unbracketed leaf is left alone');
  assert(after.turn === RED, 'turn switches after a placement');
}

/* --------------------------------------------------- illegal placements */

{
  const s = createInitialState();
  assert(throws(() => applyMove(s, { row: 3, col: 3 })), 'occupied square is rejected');
  assert(throws(() => applyMove(s, { row: 0, col: 0 })), 'placement that brackets nothing is rejected');
  assert(throws(() => applyMove(s, { row: 2, col: 2 })), 'diagonal touch without a bracket is rejected');
  assert(throws(() => applyMove(s, { row: -1, col: 8 })), 'off-board placement is rejected');
  assert(flipsFor(s, { row: 0, col: 0 }).length === 0, 'flipsFor is empty for an illegal square');
  assert(throws(() => applyMove(s, PASS)), 'passing is rejected while a placement exists');
}

/* ---------------------------------------------------------- forced pass */

{
  // Red has no bracket anywhere; green does. Red's only move is to pass.
  const s = board([
    'GR......',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ], RED);
  assert(legalMoves(s).length === 0, 'no legal placements when nothing brackets');
  const st = getStatus(s);
  assert(!st.over && st.mustPass && st.turn === RED, 'forced pass reported, game not over');
  const after = applyMove(s, PASS);
  assert(after.turn === GREEN, 'pass hands the turn over');
  assert(JSON.stringify(after.grid) === JSON.stringify(s.grid), 'pass leaves the forest untouched');
  const green = applyMove(after, { row: 0, col: 2 });
  assert(green.grid[0][1] === GREEN, 'play resumes after the pass');
}

/* ------------------------------------------------------ double-pass end */

{
  // Only green leaves remain: neither side can bracket anywhere, board far
  // from full. Red would pass, green would pass right back — so the engine
  // calls the game the moment neither player has a placement. Green 3–0.
  const s = board([
    'GGG.....',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
    '........',
  ], RED);
  const st = getStatus(s);
  assert(st.over && !st.mustPass, 'game ends when both players would pass, board not full');
  assert(st.winner === GREEN && st.counts.green === 3 && st.counts.red === 0, 'double-pass ending counts the leaves correctly');
  assert(throws(() => applyMove(s, PASS)), 'no moves of any kind once the game is over');
  assert(legalMoves(s).length === 0, 'no legal moves once the game is over');
}

/* ------------------------------------------------------- full-board end */

{
  // Full board, green 40 – red 24.
  const s = board([
    'GGGGGGGG',
    'GGGGGGGG',
    'GGGGGGGG',
    'GGGGGGGG',
    'GGGGGGGG',
    'RRRRRRRR',
    'RRRRRRRR',
    'RRRRRRRR',
  ], GREEN);
  const st = getStatus(s);
  assert(st.over && st.winner === GREEN, 'full board ends the game');
  assert(st.counts.green === 40 && st.counts.red === 24, 'full-board counts are exact');
}

{
  // Full board, dead even 32–32: a tie, no winner.
  const s = board([
    'GGGGGGGG',
    'GGGGGGGG',
    'GGGGGGGG',
    'GGGGGGGG',
    'RRRRRRRR',
    'RRRRRRRR',
    'RRRRRRRR',
    'RRRRRRRR',
  ], GREEN);
  const st = getStatus(s);
  assert(st.over && st.tie && st.winner === null && st.counts.green === 32, 'a full even board is a tie');
}

/* ------------------------------------- Forester: corner over greedy flip */

{
  // Green to move. Placing at (0,3) flips six reds down the column — the
  // biggest flip on the board, and the Leaf Peeper's kind of move. Placing
  // in the corner at (0,0) flips just one. The Forester must take the
  // corner: it can never be flipped back.
  const s = board([
    '.RG.....',
    '...R....',
    '..GRG...',
    '..GRG...',
    '..GRG...',
    '..GRG...',
    '..GRG...',
    '...G....',
  ], GREEN);
  const corner = { row: 0, col: 0 };
  const greedy = { row: 0, col: 3 };
  assert(totalFlips(s, greedy) > totalFlips(s, corner), 'the greedy move really does flip more leaves');
  const choice = chooseMove(s, 'forester');
  assert(choice.row === corner.row && choice.col === corner.col, 'Forester prefers the corner over a bigger greedy flip');
}

/* --------------------------------- Forester: exact endgame (≤10 empties) */

{
  // Walk a deterministic game down to 8 empty squares, then check the
  // Forester's endgame choice against a brute-force perfect solver.
  function solve(state) {
    // Final leaf difference for the side to move, under perfect play.
    const moves = legalMoves(state);
    if (moves.length === 0) {
      const flip = { grid: state.grid, turn: opponent(state.turn) };
      if (legalMoves(flip).length === 0) {
        const { counts } = getStatus(state);
        const mine = state.turn === GREEN ? counts.green : counts.red;
        return mine - (state.turn === GREEN ? counts.red : counts.green);
      }
      return -solve(flip);
    }
    let best = -Infinity;
    for (const m of moves) best = Math.max(best, -solve(applyMove(state, m)));
    return best;
  }

  let s = createInitialState();
  const empties = () => {
    let n = 0;
    for (const row of s.grid) for (const v of row) if (v === EMPTY) n++;
    return n;
  };
  while (!getStatus(s).over && empties() > 8) {
    const moves = legalMoves(s);
    s = moves.length > 0 ? applyMove(s, moves[0]) : applyMove(s, PASS);
  }
  assert(!getStatus(s).over && empties() === 8, 'deterministic playout reaches an 8-empty midposition');

  const t0 = Date.now();
  const choice = chooseMove(s, 'forester');
  const ms = Date.now() - t0;
  const perfect = solve(s);
  const achieved = -solve(applyMove(s, choice));
  assert(achieved === perfect, `Forester's endgame move is perfect (secures ${perfect >= 0 ? '+' : ''}${perfect} under best play)`);
  console.log(`  (endgame solve took ${ms}ms)`);
}

/* -------------------------------------------- bots play full legal games */

{
  for (const level of ['peeper', 'forester']) {
    let s = createInitialState();
    let plies = 0;
    let slowest = 0;
    while (!getStatus(s).over && plies < 200) {
      const moves = legalMoves(s);
      if (moves.length === 0) {
        s = applyMove(s, PASS);
      } else {
        const t0 = Date.now();
        const move = chooseMove(s, level);
        slowest = Math.max(slowest, Date.now() - t0);
        if (!moves.some((m) => m.row === move.row && m.col === move.col)) {
          assert(false, `${level} played an illegal move at ply ${plies}`);
        }
        s = applyMove(s, move);
      }
      plies++;
    }
    const st = getStatus(s);
    assert(st.over, `${level} vs ${level} reaches a finished game`);
    assert(st.counts.green + st.counts.red <= SIZE * SIZE, `${level} game ends with a sane leaf count`);
    console.log(`  (${level}: ${plies} plies, final ${st.counts.green}–${st.counts.red}, slowest move ${slowest}ms)`);
  }
}

console.log(`\nAll ${passed} checks passed. The season may turn. 🍁`);
