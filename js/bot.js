// PEAK FOLIAGE — the two computer opponents.
//
// This module only talks to the engine through its public API (legalMoves,
// applyMove, getStatus, flipsFor, and the exported constants) plus reading
// the plain state object. No rule logic lives here — if the engine says a
// move is legal, it's legal.
//
//   LEAF PEEPER — greedy: usually grabs whichever placement flips the most
//                 leaves, with enough randomness (random tie-breaks and the
//                 occasional pure whim) that a kid can beat it. Never looks
//                 past the flip in front of its camera.
//   FORESTER    — negamax with alpha-beta pruning and a positional
//                 evaluation (corners and edges heavily weighted, plus
//                 mobility), iteratively deepened from 6 plies under a time
//                 budget. With 10 or fewer empty squares it switches to an
//                 exact end-of-game solve on final leaf count, falling back
//                 to the search result if the solve runs long on a slow
//                 phone.

import {
  SIZE, EMPTY, GREEN, RED, opponent, legalMoves, applyMove, getStatus, flipsFor,
} from './engine.js';

const WIN_SCORE = 1_000_000;
const MIN_DEPTH = 6; // this pass always runs to completion
const MAX_DEPTH = 10;
const TIME_BUDGET_MS = 300;
const EXACT_EMPTIES = 10; // at or below this, solve the endgame exactly
const EXACT_BUDGET_MS = 1200;

// Classic positional weights: corners are gold, the squares beside a corner
// hand the corner to your opponent, edges are sturdy, the middle is mush.
const W = [
  [120, -20, 20, 5, 5, 20, -20, 120],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [120, -20, 20, 5, 5, 20, -20, 120],
];

/** Pick a placement for the side to move. level: 'peeper' | 'forester'. */
export function chooseMove(state, level) {
  const moves = legalMoves(state);
  if (moves.length === 0) throw new Error('No legal placements — pass or game over.');
  if (moves.length === 1) return moves[0];
  return level === 'forester' ? foresterMove(state, moves) : peeperMove(state, moves);
}

/* --------------------------------------------------------- Leaf Peeper */

function peeperMove(state, moves) {
  // One move in five is pure whim — pulled over at a scenic overlook.
  if (Math.random() < 0.2) return moves[Math.floor(Math.random() * moves.length)];

  // Otherwise: whichever placement flips the most leaves, ties broken at
  // random. Corners? Edges? The Peeper has never heard of them.
  let best = [];
  let bestFlips = -1;
  for (const move of moves) {
    const flips = flipsFor(state, move).reduce((n, line) => n + line.length, 0);
    if (flips > bestFlips) {
      bestFlips = flips;
      best = [move];
    } else if (flips === bestFlips) {
      best.push(move);
    }
  }
  return best[Math.floor(Math.random() * best.length)];
}

/* ------------------------------------------------------------ Forester */

// Search bookkeeping for the time budget. The clock lives here in bot.js —
// the engine itself stays clock-free and pure.
let deadline = 0;
let abortable = false;
let aborted = false;
let nodeCount = 0;

function now() {
  return (typeof performance !== 'undefined' ? performance : Date).now();
}

function outOfTime() {
  if (abortable && (++nodeCount & 1023) === 0 && now() >= deadline) aborted = true;
  return aborted;
}

function foresterMove(state, moves) {
  const empties = countEmpties(state.grid);
  const ordered = orderMoves(moves);

  // Heuristic search first: depth 6 always completes, deeper passes run
  // only while the clock allows.
  deadline = now() + TIME_BUDGET_MS;
  let bestMove = ordered[0];
  for (let depth = MIN_DEPTH; depth <= Math.min(MAX_DEPTH, empties); depth++) {
    abortable = depth > MIN_DEPTH;
    aborted = false;
    nodeCount = 0;
    const move = rootSearch(state, ordered, depth, evaluate);
    if (aborted) break; // out of time mid-pass: keep the previous depth's answer
    bestMove = move;
    if (now() >= deadline) break;
  }

  // Endgame: few enough empties to read the season to its last leaf. The
  // exact solve maximizes final leaf count; if it can't finish inside its
  // budget (it essentially always does), the heuristic answer above stands.
  if (empties <= EXACT_EMPTIES) {
    deadline = now() + EXACT_BUDGET_MS;
    abortable = true;
    aborted = false;
    nodeCount = 0;
    const move = rootSearch(state, ordered, empties + 2, exactLeafDiff);
    if (!aborted) return move;
  }
  return bestMove;
}

function countEmpties(grid) {
  let n = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) if (grid[r][c] === EMPTY) n++;
  }
  return n;
}

// Corners first, poison squares last — good ordering is what makes
// alpha-beta pruning fast.
function orderMoves(moves) {
  return moves.slice().sort((a, b) => W[b.row][b.col] - W[a.row][a.col]);
}

function rootSearch(state, ordered, depth, leafEval) {
  let bestMove = ordered[0];
  let alpha = -Infinity;
  for (const move of ordered) {
    const score = -negamax(applyMove(state, move), depth - 1, -Infinity, -alpha, leafEval);
    if (aborted) break;
    if (score > alpha) {
      alpha = score;
      bestMove = move;
    }
  }
  return bestMove;
}

// Score from the perspective of the side to move in `state`.
function negamax(state, depth, alpha, beta, leafEval) {
  if (outOfTime()) return 0; // value is discarded once aborted

  const moves = legalMoves(state);
  if (moves.length === 0) {
    const reply = { grid: state.grid, turn: opponent(state.turn) };
    if (legalMoves(reply).length === 0) return finalScore(state); // season over
    // Forced pass: same position, other side to move, no depth spent.
    return -negamax(reply, depth, -beta, -alpha, leafEval);
  }
  if (depth === 0) return leafEval(state, moves);

  for (const move of orderMoves(moves)) {
    const score = -negamax(applyMove(state, move), depth - 1, -beta, -alpha, leafEval);
    if (aborted) return 0;
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

// Game truly over: winning at all dwarfs everything, margin breaks ties.
function finalScore(state) {
  const diff = leafDiff(state);
  if (diff > 0) return WIN_SCORE + diff;
  if (diff < 0) return -WIN_SCORE + diff;
  return 0;
}

function leafDiff(state) {
  const { counts } = getStatus(state);
  const mine = state.turn === GREEN ? counts.green : counts.red;
  const theirs = state.turn === GREEN ? counts.red : counts.green;
  return mine - theirs;
}

// Heuristic for non-terminal leaves of the midgame search: positional
// weights plus mobility, from the side to move's point of view.
function evaluate(state, myMoves) {
  const me = state.turn;
  const them = opponent(me);
  let score = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = state.grid[r][c];
      if (v === me) score += W[r][c];
      else if (v === them) score -= W[r][c];
    }
  }
  const theirMoveCount = legalMoves({ grid: state.grid, turn: them }).length;
  score += (myMoves.length - theirMoveCount) * 8;
  return score;
}

// Leaf evaluation for the exact endgame solve: depth exceeds the number of
// empty squares, so every line truly ends — but if the depth cap is somehow
// hit, raw leaf difference is the honest stand-in.
function exactLeafDiff(state) {
  return leafDiff(state);
}
