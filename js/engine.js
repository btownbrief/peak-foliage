// PEAK FOLIAGE — pure disc-flipping (Reversi) rules. A Btown Games production.
//
// THE ONE NON-NEGOTIABLE: everything in this file is a pure function over a
// plain JSON-serializable state object. No DOM, no timers, no Date, no
// Math.random, no imports. Online multiplayer will later sync this exact
// state object between phones, so any rule logic outside this file breaks
// that plan. The whole game must survive JSON.stringify → JSON.parse → resume.
//
// State shape: { grid, turn }
//   grid — 8 rows × 8 cols of 0 (empty) | 1 (summer-green leaf) | 2 (peak-red
//          leaf); row 0 is the TOP of the board as drawn
//   turn — whose leaf lands next, 1 or 2

export const SIZE = 8;
export const EMPTY = 0;
export const GREEN = 1;
export const RED = 2;
export const PASS = 'pass';

// All eight compass directions a bracket line can run.
const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

/** A fresh forest: the four center leaves, green moves first by default. */
export function createInitialState(firstPlayer = GREEN) {
  if (firstPlayer !== GREEN && firstPlayer !== RED) {
    throw new Error(`First player must be ${GREEN} (green) or ${RED} (red).`);
  }
  const grid = [];
  for (let r = 0; r < SIZE; r++) grid.push(new Array(SIZE).fill(EMPTY));
  grid[3][3] = RED;
  grid[4][4] = RED;
  grid[3][4] = GREEN;
  grid[4][3] = GREEN;
  return { grid, turn: firstPlayer };
}

export function opponent(player) {
  return player === GREEN ? RED : GREEN;
}

/**
 * The lines of enemy leaves that placing at `move` ({ row, col }) would flip,
 * one array per direction, each ordered from the placed leaf outward. Empty
 * array means the placement is illegal (occupied, off the board, or brackets
 * nothing). This is the flip rule AND the animation/preview source of truth.
 */
export function flipsFor(state, move) {
  const { row, col } = move || {};
  if (!Number.isInteger(row) || !Number.isInteger(col)) return [];
  if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return [];
  if (state.grid[row][col] !== EMPTY) return [];
  const me = state.turn;
  const them = opponent(me);
  const lines = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && state.grid[r][c] === them) {
      line.push({ row: r, col: c });
      r += dr;
      c += dc;
    }
    if (line.length > 0 && r >= 0 && r < SIZE && c >= 0 && c < SIZE && state.grid[r][c] === me) {
      lines.push(line);
    }
  }
  return lines;
}

/**
 * Every square where the current player can legally place a leaf, as
 * [{ row, col }, ...]. Empty when the player must pass — and also once the
 * game is over; check getStatus(state) to tell those apart.
 */
export function legalMoves(state) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (state.grid[r][c] !== EMPTY) continue;
      if (hasBracket(state, r, c)) moves.push({ row: r, col: c });
    }
  }
  return moves;
}

// Cheaper than flipsFor when we only need yes/no.
function hasBracket(state, row, col) {
  const me = state.turn;
  const them = opponent(me);
  for (const [dr, dc] of DIRS) {
    let r = row + dr;
    let c = col + dc;
    let sawEnemy = false;
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && state.grid[r][c] === them) {
      sawEnemy = true;
      r += dr;
      c += dc;
    }
    if (sawEnemy && r >= 0 && r < SIZE && c >= 0 && c < SIZE && state.grid[r][c] === me) {
      return true;
    }
  }
  return false;
}

/**
 * Place the current player's leaf at `move` ({ row, col }), flipping every
 * bracketed enemy leaf — or pass with applyMove(state, PASS), legal only
 * when the player has no placement and the game isn't over. Returns a NEW
 * state; the input state is never mutated. Throws on any illegal move.
 */
export function applyMove(state, move) {
  const status = getStatus(state);
  if (status.over) {
    throw new Error('The season has turned — the game is over.');
  }
  if (move === PASS) {
    if (legalMoves(state).length > 0) {
      throw new Error('You have a legal placement — you must play it, not pass.');
    }
    return { grid: state.grid.map((row) => row.slice()), turn: opponent(state.turn) };
  }
  const lines = flipsFor(state, move);
  if (lines.length === 0) {
    throw new Error(`Illegal placement at row ${move && move.row}, col ${move && move.col} — it brackets nothing.`);
  }
  const grid = state.grid.map((row) => row.slice());
  grid[move.row][move.col] = state.turn;
  for (const line of lines) {
    for (const { row, col } of line) grid[row][col] = state.turn;
  }
  return { grid, turn: opponent(state.turn) };
}

/**
 * Where the season stands:
 *   { over, turn, mustPass, counts, winner, tie }
 *   over     — true when neither player has a placement (covers a full board
 *              and the double-pass ending alike)
 *   turn     — whose move is next (1|2), or null when over
 *   mustPass — true when the player to move has no placement but the game
 *              isn't over; their only legal move is applyMove(state, PASS)
 *   counts   — { green, red } leaves on the board right now
 *   winner   — 1|2 once over (most leaves), or null
 *   tie      — true only when the game is over dead even
 */
export function getStatus(state) {
  let green = 0;
  let red = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (state.grid[r][c] === GREEN) green++;
      else if (state.grid[r][c] === RED) red++;
    }
  }
  const counts = { green, red };
  const myMoves = legalMoves(state).length;
  if (myMoves > 0) {
    return { over: false, turn: state.turn, mustPass: false, counts, winner: null, tie: false };
  }
  const theirMoves = legalMoves({ grid: state.grid, turn: opponent(state.turn) }).length;
  if (theirMoves > 0) {
    return { over: false, turn: state.turn, mustPass: true, counts, winner: null, tie: false };
  }
  const winner = green > red ? GREEN : red > green ? RED : null;
  return { over: true, turn: null, mustPass: false, counts, winner, tie: winner === null };
}
