// PEAK FOLIAGE — UI only. A Btown Games production for the BTown Brief.
//
// This file renders state, animates the season turning, and dispatches
// moves. Every rule lives in js/engine.js and every bot decision in
// js/bot.js — if you're tempted to check a bracket here, stop and use
// flipsFor() / getStatus() instead.

import {
  SIZE, GREEN, RED, PASS,
  createInitialState, legalMoves, applyMove, getStatus, flipsFor,
} from './engine.js';
import { chooseMove } from './bot.js';
import { sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const menuEl = $('menu');
const gameEl = $('game');
const boardEl = $('board');
const turnChip = $('turnChip');
const tallyEl = $('tally');
const passBar = $('passbar');
const passText = $('passText');
const passBtn = $('passBtn');
const resultBar = $('resultbar');
const resultText = $('resultText');
const resultScore = $('resultScore');
const greenFill = document.querySelector('#thermoGreen .fill');
const redFill = document.querySelector('#thermoRed .fill');
const greenBulb = document.querySelector('#thermoGreen .bulb');
const redBulb = document.querySelector('#thermoRed .bulb');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FLIP_STAGGER = reducedMotion ? 0 : 80; // ms between leaves down a line
const FLIP_START = reducedMotion ? 60 : 220; // ms after the new leaf lands

/* ------------------------------------------------------------- copy desk */

const BOT_THINKING = {
  peeper: "📷 THE PEEPER'S GAWKING…",
  forester: "🌲 THE FORESTER'S SURVEYING…",
};
const BOT_WIN_LINES = {
  peeper: 'THE LEAF PEEPER OUT-PEEPED YOU 📷',
  forester: 'THE FORESTER READ THE WOODS 🌲',
};
const PASS_LINES = {
  you: 'No moves for you — the wind passes. 🍂',
  green: 'Green is out of moves — the wind passes. 🍂',
  red: 'Red is out of moves — the wind passes. 🍂',
  bot: 'out of moves — the wind passes. 🍂',
};

/* ------------------------------------------------------------- game shell */

let mode = 'pass'; // 'pass' | 'peeper' | 'forester'
let state = createInitialState();
let busy = false; // an animation or bot think is in flight
let session = 0; // bumped on every new match / exit, cancels stale timers
let tally = { green: 0, red: 0, ties: 0 };

// Build the 64 canopy cells once.
const cells = [];
for (let r = 0; r < SIZE; r++) {
  for (let c = 0; c < SIZE; c++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.row = String(r);
    cell.dataset.col = String(c);
    cell.setAttribute('role', 'gridcell');
    boardEl.appendChild(cell);
    cells.push(cell);
  }
}
const cellAt = (r, c) => cells[r * SIZE + c];

// The floating "+N leaves" chip shown while a square is held down.
const countChip = document.createElement('div');
countChip.id = 'countChip';
countChip.className = 'hidden';
gameEl.appendChild(countChip);

document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => startMatch(btn.dataset.mode));
});
$('trailBtn').addEventListener('click', backToTrailhead);
$('rematchBtn').addEventListener('click', rematch);
$('howBtn').addEventListener('click', () => $('howTo').classList.toggle('hidden'));
$('mute').addEventListener('click', () => {
  $('mute').textContent = sound.toggleMuted() ? '🔇' : '🔊';
});
$('mute').textContent = sound.muted ? '🔇' : '🔊';
passBtn.addEventListener('click', onHumanPass);

function startMatch(chosen) {
  mode = chosen;
  session++;
  state = createInitialState();
  busy = false;
  menuEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  passBar.classList.add('hidden');
  resultBar.classList.add('hidden');
  render();
}

function rematch() {
  startMatch(mode);
}

function backToTrailhead() {
  session++;
  busy = false;
  clearPreview();
  gameEl.classList.add('hidden');
  passBar.classList.add('hidden');
  resultBar.classList.add('hidden');
  menuEl.classList.remove('hidden');
}

function later(ms, fn) {
  const mySession = session;
  setTimeout(() => {
    if (session === mySession) fn();
  }, ms);
}

/* ------------------------------------------------------------- rendering */

function isHumanTurn() {
  return mode === 'pass' || state.turn === GREEN;
}

function render() {
  const st = getStatus(state);
  const showDots = !busy && !st.over && !st.mustPass && isHumanTurn();
  const legal = showDots ? legalMoves(state) : [];
  const legalSet = new Set(legal.map((m) => m.row * SIZE + m.col));

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = cellAt(r, c);
      const v = state.grid[r][c];
      syncLeaf(cell, v);
      cell.classList.toggle('legal', legalSet.has(r * SIZE + c));
      cell.setAttribute('aria-label', `Row ${r + 1}, column ${c + 1}: ${v === GREEN ? 'green leaf' : v === RED ? 'red leaf' : 'empty'}`);
    }
  }

  renderThermos(st.counts);
  renderTurnChip(st);
  tallyEl.textContent = `🌿 ${tally.green} · 🍁 ${tally.red} · 🍂 ${tally.ties}`;
}

// Make the cell's leaf element match the engine, no animation.
function syncLeaf(cell, v) {
  let leaf = cell.querySelector('.leaf');
  if (v === 0) {
    if (leaf) leaf.remove();
    return;
  }
  if (!leaf) leaf = makeLeaf(cell);
  leaf.classList.remove('drop');
  const inner = leaf.querySelector('.leaf-inner');
  inner.style.transitionDelay = '';
  leaf.classList.toggle('red', v === RED);
}

function makeLeaf(cell) {
  const leaf = document.createElement('div');
  leaf.className = 'leaf';
  const inner = document.createElement('div');
  inner.className = 'leaf-inner';
  const front = document.createElement('div');
  front.className = 'face front';
  const back = document.createElement('div');
  back.className = 'face back';
  inner.appendChild(front);
  inner.appendChild(back);
  leaf.appendChild(inner);
  cell.appendChild(leaf);
  return leaf;
}

function renderThermos(counts) {
  const pct = (n) => Math.max(3, (n / (SIZE * SIZE)) * 100);
  greenFill.style.height = `${pct(counts.green)}%`;
  redFill.style.height = `${pct(counts.red)}%`;
  pulseBulb(greenBulb, counts.green);
  pulseBulb(redBulb, counts.red);
}

function pulseBulb(bulb, n) {
  if (bulb.textContent !== String(n)) {
    bulb.textContent = String(n);
    bulb.classList.add('pulse');
    setTimeout(() => bulb.classList.remove('pulse'), 250);
  }
}

function renderTurnChip(st) {
  if (st.over) {
    turnChip.textContent = '🏔 SEASON OVER';
    turnChip.className = '';
    return;
  }
  if (mode === 'pass') {
    turnChip.textContent = st.turn === GREEN ? '🍃 GREEN’S TURN' : '🍁 RED’S TURN';
    turnChip.className = st.turn === GREEN ? 'green' : 'red';
  } else if (st.turn === GREEN) {
    turnChip.textContent = '🍃 YOUR MOVE';
    turnChip.className = 'green';
  } else {
    turnChip.textContent = BOT_THINKING[mode];
    turnChip.className = 'red';
  }
}

/* ------------------------------------------------- press preview + input */

let pressed = null; // { cell, move, rect }

boardEl.addEventListener('pointerdown', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell || !cell.classList.contains('legal') || busy) return;
  const move = { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
  const lines = flipsFor(state, move);
  const flips = lines.reduce((n, line) => n + line.length, 0);
  pressed = { cell, move, rect: cell.getBoundingClientRect() };

  cell.classList.add('will-flip');
  for (const line of lines) {
    for (const { row, col } of line) cellAt(row, col).classList.add('will-flip');
  }
  const gameRect = gameEl.getBoundingClientRect();
  countChip.textContent = `+${flips + 1}`;
  countChip.style.left = `${pressed.rect.left + pressed.rect.width / 2 - gameRect.left}px`;
  countChip.style.top = `${pressed.rect.top - gameRect.top}px`;
  countChip.classList.remove('hidden');
});

document.addEventListener('pointerup', (e) => {
  if (!pressed) return;
  const { rect, move } = pressed;
  clearPreview();
  const inCell =
    e.clientX >= rect.left && e.clientX <= rect.right &&
    e.clientY >= rect.top && e.clientY <= rect.bottom;
  if (inCell && !busy) playMove(move);
});
document.addEventListener('pointercancel', clearPreview);

function clearPreview() {
  if (!pressed) return;
  pressed = null;
  countChip.classList.add('hidden');
  for (const cell of cells) cell.classList.remove('will-flip');
}

/* --------------------------------------------------- moves + animation */

function playMove(move) {
  const lines = flipsFor(state, move); // the animation script, straight from the engine
  const next = applyMove(state, move);
  const mover = state.turn;
  busy = true;

  // Clear the dots right away, land the new leaf with a drop.
  for (const cell of cells) cell.classList.remove('legal');
  const cell = cellAt(move.row, move.col);
  const leaf = makeLeaf(cell);
  leaf.classList.toggle('red', mover === RED);
  if (!reducedMotion) leaf.classList.add('drop');
  sound.land();

  // The signature moment: the season ripples outward down every line.
  let longest = 0;
  for (const line of lines) {
    line.forEach(({ row, col }, i) => {
      longest = Math.max(longest, i);
      later(FLIP_START + i * FLIP_STAGGER, () => {
        const flipped = cellAt(row, col).querySelector('.leaf');
        if (flipped) flipped.classList.toggle('red', mover === RED);
        sound.flip(i);
      });
    });
  }

  const settle = FLIP_START + longest * FLIP_STAGGER + (reducedMotion ? 200 : 620);
  later(settle, () => {
    state = next;
    busy = false;
    render();
    advance();
  });
}

// Look at the new position and keep the game moving: end it, handle a
// forced pass, or wake the bot.
function advance() {
  const st = getStatus(state);
  if (st.over) {
    finish(st);
    return;
  }
  if (st.mustPass) {
    if (isHumanTurn()) {
      const who = mode === 'pass' ? (state.turn === GREEN ? 'green' : 'red') : 'you';
      passText.textContent = PASS_LINES[who];
      passBtn.classList.remove('hidden');
      passBar.classList.remove('hidden');
    } else {
      passText.textContent = `The ${mode === 'peeper' ? 'Leaf Peeper is' : 'Forester is'} ${PASS_LINES.bot}`;
      passBtn.classList.add('hidden');
      passBar.classList.remove('hidden');
      later(1200, () => {
        passBar.classList.add('hidden');
        sound.pass();
        state = applyMove(state, PASS);
        render();
        advance();
      });
    }
    return;
  }
  if (!isHumanTurn()) {
    busy = true;
    render(); // shows the thinking chip, hides the dots
    later(reducedMotion ? 150 : 550, () => {
      const move = chooseMove(state, mode);
      busy = false;
      playMove(move);
    });
  }
}

function onHumanPass() {
  passBar.classList.add('hidden');
  sound.pass();
  state = applyMove(state, PASS);
  render();
  advance();
}

/* --------------------------------------------------------------- finish */

function finish(st) {
  const { green, red } = st.counts;
  if (st.tie) {
    tally.ties++;
    resultText.textContent = 'STICK SEASON — DEAD EVEN 🍂';
    sound.tie();
  } else if (st.winner === GREEN) {
    tally.green++;
    resultText.textContent = mode === 'pass' ? 'SUMMER HOLDS ON! 🌿' : 'YOU TURNED THE WHOLE MOUNTAIN! 🍁';
    sound.win();
  } else {
    tally.red++;
    resultText.textContent = mode === 'pass' ? 'PEAK FOLIAGE! 🍁' : BOT_WIN_LINES[mode];
    if (mode === 'pass') sound.win();
    else sound.lose();
  }
  resultScore.textContent = `🌿 ${green} — ${red} 🍁`;
  render();
  later(reducedMotion ? 100 : 500, () => resultBar.classList.remove('hidden'));
}
