// PEAK FOLIAGE — UI only. A Btown Games production for the BTown Brief.
//
// This file renders state, animates the season turning, and dispatches
// moves. Every rule lives in js/engine.js and every bot decision in
// js/bot.js — if you're tempted to check a bracket here, stop and use
// flipsFor() / getStatus() instead.

import {
  SIZE, GREEN, RED, PASS, opponent,
  createInitialState, legalMoves, applyMove, getStatus, flipsFor,
} from './engine.js';
import { chooseMove } from './bot.js';
import { sound } from './audio.js';
import { OnlineMatch, savedSession, clearSession, getName } from './rooms.js';
import {
  lbEnabled, fetchTop, submitScore, renamePlayer, monthLabel,
  getName as lbGetName, playerId as lbPlayerId,
} from './leaderboard.js';

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
const resultLine = $('resultLine');
const coachHint = $('coachHint');
const momentCallout = $('momentCallout');
const effectsEl = $('effects');
const announcer = $('announcer');
const greenFill = document.querySelector('#thermoGreen .fill');
const redFill = document.querySelector('#thermoRed .fill');
const greenBulb = document.querySelector('#thermoGreen .bulb');
const redBulb = document.querySelector('#thermoRed .bulb');
const trailBtn = $('trailBtn');
const rematchBtn = $('rematchBtn');
const onlinePanel = $('onlinePanel');
const opTitle = $('opTitle');
const opName = $('opName');
const opCodeWrap = $('opCodeWrap');
const opCode = $('opCode');
const opError = $('opError');
const lobbyEl = $('lobby');
const lobbyCode = $('lobbyCode');
const rejoinBtn = $('rejoinBtn');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FLIP_STAGGER = reducedMotion ? 0 : 80; // ms between leaves down a line
const FLIP_START = reducedMotion ? 60 : 220; // ms after the new leaf lands
const MEGA_FLIP = 6;
const HUGE_FLIP = 10;
const COACH_KEY = 'peak-foliage-hold-preview-v1';

/* ------------------------------------------------------------- copy desk */

const BOT_THINKING = {
  peeper: "📷 THE PEEPER'S GAWKING…",
  forester: "🌲 THE FORESTER'S SURVEYING…",
};
const BOT_RESULT_LINES = {
  peeper: {
    wonClose: '📷 Leaf Peeper: “Caught you right at golden hour!”',
    wonBig: '📷 Leaf Peeper: “That view belongs on the front page!”',
    lostClose: '📷 Leaf Peeper: “You found the shot I missed!”',
    lostBig: '📷 Leaf Peeper: “Worth it for that view!”',
    tie: '📷 Leaf Peeper: “Perfectly balanced — hold still!”',
  },
  forester: {
    wonClose: '🌲 Forester: “A narrow trail, but a sound one.”',
    wonBig: '🌲 Forester: “The canopy told me where to stand.”',
    lostClose: '🌲 Forester: “You read that ridge line well.”',
    lostBig: '🌲 Forester: “I’ll be studying your trail map.”',
    tie: '🌲 Forester: “The woods call that a fair season.”',
  },
};
const PASS_LINES = {
  you: 'No moves for you — the wind passes. 🍂',
  green: 'Green is out of moves — the wind passes. 🍂',
  red: 'Red is out of moves — the wind passes. 🍂',
  bot: 'out of moves — the wind passes. 🍂',
};

/* ------------------------------------------------------------- game shell */

let mode = 'pass'; // 'pass' | 'peeper' | 'forester' | 'online'
let state = createInitialState();
let busy = false; // an animation or bot think is in flight
let session = 0; // bumped on every new match / exit, cancels stale timers
let tally = { green: 0, red: 0, ties: 0 };
let firstPlayer = GREEN; // who opens the next game — like sugarbush-squares,
                         // the loser opens the rematch (ties alternate)
let online = null; // { match, myPlayer } while in an online crew
let lastFinishedState = null;
let calloutVersion = 0;

// Build the 64 canopy cells once.
const cells = [];
for (let r = 0; r < SIZE; r++) {
  for (let c = 0; c < SIZE; c++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.row = String(r);
    cell.dataset.col = String(c);
    cell.setAttribute('role', 'gridcell');
    if ((r === 0 || r === SIZE - 1) && (c === 0 || c === SIZE - 1)) {
      cell.classList.add('corner');
    }
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
trailBtn.addEventListener('click', backToTrailhead);
rematchBtn.addEventListener('click', rematch);
$('howBtn').addEventListener('click', () => $('howTo').classList.toggle('hidden'));
$('mute').addEventListener('click', () => {
  $('mute').textContent = sound.toggleMuted() ? '🔇' : '🔊';
});
$('mute').textContent = sound.muted ? '🔇' : '🔊';
passBtn.addEventListener('click', onHumanPass);
$('coachDismiss').addEventListener('click', dismissCoach);

function startMatch(chosen) {
  mode = chosen;
  firstPlayer = GREEN; // green (you, against a bot) opens a fresh match
  newGame();
}

function rematch() {
  if (online) {
    onlineRematch();
  } else {
    newGame(); // firstPlayer carries over — finish() decided who opens
  }
}

function newGame() {
  session++;
  state = createInitialState(firstPlayer);
  busy = false;
  lastFinishedState = null;
  clearEffects();
  menuEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  passBar.classList.add('hidden');
  resultBar.classList.add('hidden');
  resetLbPanel();
  showCoach();
  render({ animateCounts: false });
  advance(); // when red opens a bot game, wake the bot
}

function backToTrailhead() {
  if (online) {
    // Leaving mid-crew ends the game for both phones — ask for a second tap.
    if (trailBtn.dataset.armed !== '1') {
      trailBtn.dataset.armed = '1';
      trailBtn.textContent = '🥾 LEAVE?';
      setTimeout(() => {
        trailBtn.dataset.armed = '';
        trailBtn.textContent = '🥾 TRAILHEAD';
      }, 2500);
      return;
    }
    online.match.leave(); // fire and forget; stops polling + clears session
    online = null;
    mode = 'pass';
    trailBtn.dataset.armed = '';
    trailBtn.textContent = '🥾 TRAILHEAD';
  }
  session++;
  busy = false;
  clearPreview();
  clearEffects();
  coachHint.classList.add('hidden');
  gameEl.classList.add('hidden');
  passBar.classList.add('hidden');
  resultBar.classList.add('hidden');
  resetLbPanel();
  menuEl.classList.remove('hidden');
  refreshRejoin();
}

function later(ms, fn) {
  const mySession = session;
  setTimeout(() => {
    if (session === mySession) fn();
  }, ms);
}

function showCoach() {
  coachHint.classList.toggle(
    'hidden',
    getStatus(state).over || localStorage.getItem(COACH_KEY) === '1',
  );
}

function dismissCoach() {
  localStorage.setItem(COACH_KEY, '1');
  coachHint.classList.add('hidden');
}

function clearEffects() {
  calloutVersion++;
  momentCallout.textContent = '';
  momentCallout.className = '';
  effectsEl.replaceChildren();
  announcer.textContent = '';
  boardEl.classList.remove(
    'shake-local', 'season-green', 'season-red', 'season-tie',
    'season-settled-green', 'season-settled-red', 'season-settled-tie',
  );
  for (const gust of boardEl.querySelectorAll('.wind-gust')) gust.remove();
}

function announce(text) {
  announcer.textContent = text;
}

// One coalescing presentation banner: a new moment replaces the old one.
function showMoment(text, kind, scale = 1) {
  const version = ++calloutVersion;
  momentCallout.textContent = text;
  momentCallout.className = kind;
  momentCallout.style.setProperty('--moment-scale', String(scale));
  // Restart the entrance when two rare events happen close together.
  void momentCallout.offsetWidth;
  momentCallout.classList.add('show');
  announce(text);
  setTimeout(() => {
    if (calloutVersion !== version) return;
    momentCallout.classList.remove('show');
  }, reducedMotion ? 1400 : 1050);
}

function spawnSparks(origin, player, count = 10) {
  if (reducedMotion) return;
  const gameRect = gameEl.getBoundingClientRect();
  const rect = origin.getBoundingClientRect();
  const available = Math.max(0, 40 - effectsEl.childElementCount);
  const total = Math.min(count, available);
  for (let i = 0; i < total; i++) {
    const spark = document.createElement('i');
    const angle = (Math.PI * 2 * i) / total;
    const distance = 44 + (i % 3) * 18;
    spark.className = 'leaf-spark';
    spark.textContent = player === GREEN ? '🍃' : '🍁';
    spark.style.left = `${rect.left + rect.width / 2 - gameRect.left}px`;
    spark.style.top = `${rect.top + rect.height / 2 - gameRect.top}px`;
    spark.style.setProperty('--spark-x', `${Math.cos(angle) * distance}px`);
    spark.style.setProperty('--spark-y', `${Math.sin(angle) * distance}px`);
    spark.style.setProperty('--spark-spin', `${(i % 2 ? -1 : 1) * (100 + i * 23)}deg`);
    effectsEl.appendChild(spark);
    spark.addEventListener('animationend', () => spark.remove(), { once: true });
  }
}

function showWindGusts(move, lines) {
  if (reducedMotion) return;
  const boardRect = boardEl.getBoundingClientRect();
  const start = cellAt(move.row, move.col).getBoundingClientRect();
  const startX = start.left + start.width / 2 - boardRect.left;
  const startY = start.top + start.height / 2 - boardRect.top;
  for (const line of lines) {
    const endPos = line[line.length - 1];
    const end = cellAt(endPos.row, endPos.col).getBoundingClientRect();
    const dx = end.left + end.width / 2 - boardRect.left - startX;
    const dy = end.top + end.height / 2 - boardRect.top - startY;
    const gust = document.createElement('i');
    gust.className = 'wind-gust';
    gust.style.left = `${startX}px`;
    gust.style.top = `${startY}px`;
    gust.style.width = `${Math.hypot(dx, dy) + end.width * 0.45}px`;
    gust.style.setProperty('--gust-angle', `${Math.atan2(dy, dx)}rad`);
    boardEl.appendChild(gust);
    gust.addEventListener('animationend', () => gust.remove(), { once: true });
  }
}

function leader(counts) {
  if (counts.green === counts.red) return null;
  return counts.green > counts.red ? GREEN : RED;
}

function animateFinalScore(green, red, animate) {
  const finalText = `🌿 ${green} — ${red} 🍁`;
  resultScore.setAttribute('aria-label', `Final score: green ${green}, red ${red}`);
  if (!animate || reducedMotion) {
    resultScore.textContent = finalText;
    return;
  }
  resultScore.textContent = '🌿 0 — 0 🍁';
  const mySession = session;
  const start = performance.now();
  const duration = 650;
  const tick = (now) => {
    if (session !== mySession) return;
    const pct = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - pct, 3);
    resultScore.textContent = `🌿 ${Math.round(green * eased)} — ${Math.round(red * eased)} 🍁`;
    if (pct < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function sweepCanopy(winner, animate) {
  const suffix = winner === GREEN ? 'green' : winner === RED ? 'red' : 'tie';
  boardEl.classList.add(`${animate ? 'season' : 'season-settled'}-${suffix}`);
  if (!animate || reducedMotion) return;

  const available = Math.max(0, 40 - effectsEl.childElementCount);
  const total = Math.min(24, available);
  for (let i = 0; i < total; i++) {
    const leaf = document.createElement('i');
    leaf.className = 'season-leaf';
    leaf.textContent = winner === GREEN ? '🍃' : winner === RED ? '🍁' : '🍂';
    leaf.style.top = `${8 + ((i * 37) % 84)}%`;
    leaf.style.setProperty('--season-delay', `${(i % 8) * 45}ms`);
    leaf.style.setProperty('--season-drift', `${-35 + (i % 7) * 12}px`);
    leaf.style.setProperty('--season-spin', `${180 + (i % 5) * 90}deg`);
    effectsEl.appendChild(leaf);
    leaf.addEventListener('animationend', () => leaf.remove(), { once: true });
  }
}

/* ------------------------------------------------------------- rendering */

function isHumanTurn() {
  if (mode === 'pass') return true;
  if (mode === 'online') {
    return online && online.match.status === 'playing' && state.turn === online.myPlayer;
  }
  return state.turn === GREEN;
}

function render({ animateCounts = true } = {}) {
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

  renderThermos(st.counts, animateCounts);
  renderTurnChip(st);
  if (mode === 'online') {
    const mine = online.myPlayer === GREEN ? tally.green : tally.red;
    const theirs = online.myPlayer === GREEN ? tally.red : tally.green;
    tallyEl.textContent = `YOU ${mine} · ${onlineOpponentName()} ${theirs} · 🍂 ${tally.ties}`;
  } else {
    tallyEl.textContent = `🌿 ${tally.green} · 🍁 ${tally.red} · 🍂 ${tally.ties}`;
  }
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

function renderThermos(counts, animate) {
  // --pct drives the tube fill: height on the vertical thermos, width on
  // the narrow-phone horizontal strip (see the media query in style.css).
  const pct = (n) => Math.max(3, (n / (SIZE * SIZE)) * 100);
  if (!animate) {
    greenFill.classList.add('no-transition');
    redFill.classList.add('no-transition');
  }
  greenFill.style.setProperty('--pct', `${pct(counts.green)}%`);
  redFill.style.setProperty('--pct', `${pct(counts.red)}%`);
  pulseBulb(greenBulb, counts.green, animate);
  pulseBulb(redBulb, counts.red, animate);
  if (!animate) {
    void greenFill.offsetHeight;
    greenFill.classList.remove('no-transition');
    redFill.classList.remove('no-transition');
  }
}

function pulseBulb(bulb, n, animate) {
  if (bulb.textContent !== String(n)) {
    bulb.textContent = String(n);
    if (animate) {
      bulb.classList.add('pulse');
      later(250, () => bulb.classList.remove('pulse'));
    } else {
      bulb.classList.remove('pulse');
    }
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
  } else if (mode === 'online') {
    turnChip.className = st.turn === GREEN ? 'green' : 'red';
    if (st.turn === online.myPlayer) {
      turnChip.textContent = st.turn === GREEN ? '🍃 YOUR MOVE' : '🍁 YOUR MOVE';
    } else {
      const opp = online.match.opponents()[0] || {};
      turnChip.textContent = opp.away
        ? `${onlineOpponentName()} WANDERED OFF TRAIL…`
        : `WAITING ON ${onlineOpponentName()}…`;
    }
  } else if (st.turn === GREEN) {
    turnChip.textContent = '🍃 YOUR MOVE';
    turnChip.className = 'green';
  } else {
    turnChip.textContent = BOT_THINKING[mode];
    turnChip.className = 'red';
  }
}

function onlineOpponentName() {
  const opp = online && online.match.opponents()[0];
  return String((opp && opp.name) || 'YOUR FELLOW PEEPER').toUpperCase();
}

/* ------------------------------------------------- press preview + input */

let pressed = null; // { cell, move, rect }

boardEl.addEventListener('pointerdown', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell || !cell.classList.contains('legal') || busy) return;
  dismissCoach();
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
  // The press already chose a legal cell, so a little finger drift on
  // release (up to ~0.6 cells past its edges) still plays it rather than
  // cancelling the move.
  const pad = rect.width * 0.6;
  const nearCell =
    e.clientX >= rect.left - pad && e.clientX <= rect.right + pad &&
    e.clientY >= rect.top - pad && e.clientY <= rect.bottom + pad;
  if (nearCell && !busy && isHumanTurn()) playMove(move);
});
document.addEventListener('pointercancel', clearPreview);

function clearPreview() {
  if (!pressed) return;
  pressed = null;
  countChip.classList.add('hidden');
  for (const cell of cells) cell.classList.remove('will-flip');
}

/* --------------------------------------------------- moves + animation */

function playMove(move, remoteState = null) {
  if (!remoteState && mode === 'online' &&
      (state.turn !== online.myPlayer || online.match.status !== 'playing')) return;
  const lines = flipsFor(state, move); // the animation script, straight from the engine
  const next = remoteState || applyMove(state, move);
  const mover = state.turn;
  const beforeStatus = getStatus(state);
  const nextStatus = getStatus(next);
  const flipCount = lines.reduce((total, line) => total + line.length, 0);
  const cornerMove =
    (move.row === 0 || move.row === SIZE - 1) &&
    (move.col === 0 || move.col === SIZE - 1);
  const beforeLeader = leader(beforeStatus.counts);
  const nextLeader = leader(nextStatus.counts);
  const changedLead = beforeLeader && nextLeader && beforeLeader !== nextLeader;
  busy = true;

  // Clear the dots right away, land the new leaf with a drop.
  for (const cell of cells) cell.classList.remove('legal');
  const cell = cellAt(move.row, move.col);
  const leaf = makeLeaf(cell);
  leaf.classList.toggle('red', mover === RED);
  if (!reducedMotion) leaf.classList.add('drop');
  sound.land();

  if (cornerMove || flipCount >= MEGA_FLIP) {
    later(FLIP_START, () => {
      const megaText = flipCount >= MEGA_FLIP ? `🍁 ${flipCount} LEAVES!` : '';
      const text = cornerMove && megaText ? `CORNER! · ${megaText}` : cornerMove ? 'CORNER!' : megaText;
      const scale = 1 + Math.min(0.32, Math.max(0, flipCount - MEGA_FLIP) * 0.045);
      showMoment(text, cornerMove ? 'corner-callout' : 'mega-callout', scale);
      if (cornerMove) {
        spawnSparks(cell, mover, 12);
        sound.corner();
      } else {
        sound.megaFlip(flipCount);
      }
      if (flipCount >= MEGA_FLIP) showWindGusts(move, lines);
      if (flipCount >= HUGE_FLIP && !reducedMotion) {
        boardEl.classList.add('shake-local');
        later(380, () => boardEl.classList.remove('shake-local'));
      }
    });
  }

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
    if (online && !remoteState) pushOnline(next);
    render();
    if (changedLead && !nextStatus.over && !cornerMove && flipCount < MEGA_FLIP) {
      showMoment('LEAD CHANGE!', 'lead-callout');
      sound.leadChange();
    }
    advance();
  });
}

// Look at the new position and keep the game moving: end it, handle a
// forced pass, or wake the bot.
function advance(celebrate = true) {
  const st = getStatus(state);
  if (st.over) {
    finish(st, celebrate);
    return;
  }
  if (st.mustPass) {
    if (isHumanTurn()) {
      const who = mode === 'pass' ? (state.turn === GREEN ? 'green' : 'red') : 'you';
      passText.textContent = PASS_LINES[who];
      passBtn.classList.remove('hidden');
      passBar.classList.remove('hidden');
    } else if (mode === 'online') {
      passText.textContent = `${onlineOpponentName()} is ${PASS_LINES.bot}`;
      passBtn.classList.add('hidden');
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
  passBar.classList.add('hidden');
  if (mode !== 'online' && !isHumanTurn()) {
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
  if (busy || !getStatus(state).mustPass) return;
  if (online && (state.turn !== online.myPlayer || online.match.status !== 'playing')) return;
  passBar.classList.add('hidden');
  sound.pass();
  state = applyMove(state, PASS);
  if (online) pushOnline(state);
  render();
  advance();
}

/* ------------------------------------------------------------- leaderboard */
// Monthly board for vs-bot wins only. Score = leaf margin (green − red),
// +1000 for Forester wins so any Forester win outranks any Leaf Peeper win.

const lbBox = $('lb');
const lbList = $('lbList');
const lbStatusEl = $('lbStatus');
const lbForm = $('lbForm');
const lbNameInput = $('lbNameInput');
const lbThisBtn = $('lbThisBtn');
const lbLastBtn = $('lbLastBtn');
const lbRenameBtn = $('lbRenameBtn');
let lbMonthOffset = 0;

if (lbEnabled()) {
  lbThisBtn.textContent = `🏆 ${monthLabel(0)}`;
  lbLastBtn.textContent = monthLabel(-1);
}

function resetLbPanel() {
  lbBox.classList.add('hidden');
  lbForm.classList.add('hidden');
  lbForm.dataset.pendingScore = '';
}

function botWinScore(st) {
  const margin = st.counts.green - st.counts.red;
  return mode === 'forester' ? 1000 + margin : margin;
}

// s >= 1000 means a Forester win (margin = s - 1000); otherwise a Peeper win
function lbScoreLabel(s) {
  return s >= 1000 ? `🌲 +${s - 1000} leaves` : `🍁 +${s} leaves`;
}

// score > 0 submits a fresh win; score 0 just shows the standings read-only
async function updateLeaderboard(score) {
  if (!lbEnabled()) return;
  lbBox.classList.remove('hidden');
  if (score > 0 && !lbGetName()) {
    // first win with no saved name: hold the score until they pick one
    lbForm.classList.remove('hidden');
    lbRenameBtn.classList.add('hidden');
    lbStatusEl.textContent = 'Pick a name to join the monthly leaderboard!';
    lbList.innerHTML = '';
    lbForm.dataset.pendingScore = String(score);
    return;
  }
  if (score > 0) {
    try { await submitScore(score); } catch { /* offline — still show the board */ }
  }
  renderLbBoard();
}

async function renderLbBoard() {
  lbForm.classList.add('hidden');
  lbRenameBtn.classList.remove('hidden');
  lbStatusEl.textContent = 'Loading…';
  try {
    const rows = await fetchTop(lbMonthOffset);
    const me = lbPlayerId();
    lbList.innerHTML = '';
    rows.slice(0, 10).forEach((r, i) => {
      const li = document.createElement('li');
      if (r.player_id === me) li.className = 'me';
      const medal = ['🥇', '🥈', '🥉'][i];
      li.innerHTML = '<span class="rank"></span><span class="nm"></span><span class="sc"></span>';
      li.querySelector('.rank').textContent = medal || `${i + 1}.`;
      li.querySelector('.nm').textContent = r.name;
      li.querySelector('.sc').textContent = lbScoreLabel(r.score);
      lbList.appendChild(li);
    });
    const myRank = rows.findIndex((r) => r.player_id === me);
    lbStatusEl.textContent = rows.length === 0
      ? 'No scores yet this month — be the first!'
      : myRank >= 0 ? `You're #${myRank + 1} of ${rows.length} this month` : '';
  } catch {
    lbStatusEl.textContent = 'Leaderboard unavailable (offline?)';
  }
}

$('lbSaveBtn').addEventListener('click', async () => {
  const name = lbNameInput.value.trim();
  if (!name) { lbNameInput.focus(); return; }
  const pending = Number(lbForm.dataset.pendingScore || 0);
  lbForm.dataset.pendingScore = '';
  try {
    await renamePlayer(name); // saves locally + renames any existing rows
    if (pending > 0) await submitScore(pending);
  } catch { /* offline — the name is still saved locally */ }
  renderLbBoard();
});
lbNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('lbSaveBtn').click();
});
lbRenameBtn.addEventListener('click', () => {
  lbNameInput.value = lbGetName();
  lbForm.classList.remove('hidden');
  lbRenameBtn.classList.add('hidden');
  lbNameInput.focus();
});
lbThisBtn.addEventListener('click', () => {
  lbMonthOffset = 0;
  lbThisBtn.classList.add('sel');
  lbLastBtn.classList.remove('sel');
  renderLbBoard();
});
lbLastBtn.addEventListener('click', () => {
  lbMonthOffset = -1;
  lbLastBtn.classList.add('sel');
  lbThisBtn.classList.remove('sel');
  renderLbBoard();
});

/* --------------------------------------------------------------- finish */

function finish(st, celebrate = true) {
  const { green, red } = st.counts;
  const finalState = JSON.stringify(state);
  const newlyFinished = finalState !== lastFinishedState;
  const flourish = celebrate && newlyFinished;
  const close = Math.abs(green - red) <= 6;

  if (newlyFinished) lastFinishedState = finalState;
  coachHint.classList.add('hidden');
  resultLine.classList.add('hidden');
  resultLine.textContent = '';

  if (st.tie) {
    if (newlyFinished) tally.ties++;
    resultText.textContent = 'STICK SEASON — DEAD EVEN 🍂';
    if (flourish) sound.tie();
    if (newlyFinished) firstPlayer = opponent(firstPlayer); // dead even: just take turns opening
  } else if (st.winner === GREEN) {
    if (newlyFinished) tally.green++;
    if (mode === 'online') {
      const iWon = online.myPlayer === GREEN;
      resultText.textContent = iWon
        ? 'SUMMER HOLDS ON — YOU WIN! 🌿'
        : `${onlineOpponentName()} KEPT THE MOUNTAIN GREEN 🌿`;
      if (flourish) (iWon ? sound.win : sound.lose)();
    } else if (mode === 'pass') {
      resultText.textContent = 'SUMMER HOLDS ON! 🌿';
      if (flourish) sound.win();
    } else {
      resultText.textContent = 'YOU KEPT THE MOUNTAIN GREEN! 🌿';
      if (flourish) sound.win();
    }
    if (newlyFinished) firstPlayer = RED; // the loser opens the rematch
  } else {
    if (newlyFinished) tally.red++;
    if (mode === 'online') {
      const iWon = online.myPlayer === RED;
      resultText.textContent = iWon
        ? 'YOU TURNED THE WHOLE MOUNTAIN! 🍁'
        : `${onlineOpponentName()} FOUND PEAK 🍁`;
      if (flourish) (iWon ? sound.win : sound.lose)();
    } else if (mode === 'pass') {
      resultText.textContent = 'PEAK FOLIAGE! 🍁';
      if (flourish) sound.win();
    } else {
      resultText.textContent = mode === 'peeper'
        ? 'THE LEAF PEEPER OUT-PEEPED YOU 📷'
        : 'THE FORESTER READ THE WOODS 🌲';
      if (flourish) sound.lose();
    }
    if (newlyFinished) firstPlayer = GREEN;
  }

  if (mode === 'peeper' || mode === 'forester') {
    const lines = BOT_RESULT_LINES[mode];
    const key = st.tie ? 'tie' : st.winner === GREEN
      ? (close ? 'lostClose' : 'lostBig')
      : (close ? 'wonClose' : 'wonBig');
    resultLine.textContent = lines[key];
    resultLine.classList.remove('hidden');
  }

  render();
  clearEffects();
  sweepCanopy(st.winner, flourish);
  animateFinalScore(green, red, flourish);
  resultBar.classList.remove('hidden');
  if (mode === 'peeper' || mode === 'forester') {
    // Submit only on a fresh, celebrated human win — finish() can be
    // re-entered when repainting an already-finished board (newlyFinished
    // is false then) or with celebrate:false; never resubmit those.
    // Losses and ties still show the standings read-only.
    const humanWon = flourish && !st.tie && st.winner === GREEN;
    updateLeaderboard(humanWon ? botWinScore(st) : 0);
  }
  announce(`${resultText.textContent} Final score: green ${green}, red ${red}. ${resultLine.textContent || ''}`);
  rematchBtn.focus({ preventScroll: true });
}

/* ------------------------------------------------------------- online play */
// Two phones, one shared engine state, refereed by the rooms layer
// (js/rooms.js → Supabase). Host sits in seat 0 and takes whichever color
// createInitialState() puts first; the friend takes the other color. Every
// rule — including forced passes — still comes from engine.js.

const GAME = 'peak-foliage';
const HOST_PLAYER = createInitialState().turn;
let panelIntent = 'host';
let pollErrors = 0;

$('hostBtn').addEventListener('click', () => openPanel('host'));
$('joinBtn').addEventListener('click', () => openPanel('join'));
$('opCancel').addEventListener('click', closePanel);
$('opGo').addEventListener('click', onlineGo);
$('lobbyCancel').addEventListener('click', cancelLobby);
rejoinBtn.addEventListener('click', rejoinCrew);
opCode.addEventListener('input', () => {
  opCode.value = opCode.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
[opName, opCode].forEach((el) => el.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') onlineGo();
}));

function openPanel(intent) {
  panelIntent = intent;
  opTitle.textContent = intent === 'host' ? 'START A CREW' : 'JOIN A CREW';
  $('opGo').textContent = intent === 'host' ? 'GET A CODE' : 'HIT THE TRAIL';
  opCodeWrap.classList.toggle('hidden', intent === 'host');
  opError.classList.add('hidden');
  opName.value = opName.value || getName();
  onlinePanel.classList.remove('hidden');
  (intent === 'join' && opName.value ? opCode : opName).focus();
}

function closePanel() {
  onlinePanel.classList.add('hidden');
}

const FRIENDLY_ERRORS = {
  not_found: 'No crew with that code — double-check the letters.',
  room_full: 'That crew already headed up the mountain.',
  room_started: 'That crew already headed up the mountain.',
  not_ready: "Online play isn't switched on yet — check back soon!",
  offline: "Can't reach the trail — are you online?",
};

function friendly(err) {
  if (err && err.code === 'wrong_game') {
    return `That code is for ${String(err.detail || 'another game').replace(/-/g, ' ')} — head there to use it.`;
  }
  return (err && FRIENDLY_ERRORS[err.code]) || 'A gust scrambled things — please try again.';
}

async function onlineGo() {
  if ($('opGo').disabled) return; // Enter key can't double-submit
  const name = opName.value.trim();
  if (!name) {
    opError.textContent = 'Every leaf peeper needs a name.';
    opError.classList.remove('hidden');
    opName.focus();
    return;
  }
  const go = $('opGo');
  go.disabled = true;
  opError.classList.add('hidden');
  try {
    if (panelIntent === 'host') {
      const match = await OnlineMatch.create({
        game: GAME, name, state: createInitialState(), seats: 2,
      });
      closePanel();
      openLobby(match);
    } else {
      const code = opCode.value.trim();
      if (code.length !== 4) {
        opError.textContent = 'The crew code is 4 letters.';
        opError.classList.remove('hidden');
        opCode.focus();
        return;
      }
      const match = await OnlineMatch.join({ game: GAME, code, name });
      closePanel();
      enterOnlineGame(match);
    }
  } catch (err) {
    opError.textContent = friendly(err);
    opError.classList.remove('hidden');
  } finally {
    go.disabled = false;
  }
}

function openLobby(match) {
  if (lobbyEl._match && lobbyEl._match !== match) lobbyEl._match.stop();
  lobbyCode.textContent = match.code;
  lobbyEl.classList.remove('hidden');
  match.start({
    onStatus: (status) => {
      if (status === 'playing') {
        lobbyEl.classList.add('hidden');
        enterOnlineGame(match);
      }
    },
    onError: () => {}, // waiting-room hiccups resolve on the next poll
  });
  lobbyEl._match = match;
}

function cancelLobby() {
  const match = lobbyEl._match;
  if (match) match.leave();
  lobbyEl._match = null;
  lobbyEl.classList.add('hidden');
  refreshRejoin();
}

async function rejoinCrew() {
  rejoinBtn.disabled = true;
  try {
    const match = await OnlineMatch.resume({ game: GAME });
    if (match.status === 'waiting') {
      openLobby(match);
    } else {
      enterOnlineGame(match);
    }
  } catch (err) {
    // Only a room that's truly gone forfeits the session — a flaky
    // connection must not delete the one path back to the game.
    if (err && (err.code === 'not_found' || err.code === 'not_seated' || err.code === 'room_started')) {
      clearSession(GAME);
      refreshRejoin();
    }
  } finally {
    rejoinBtn.disabled = false;
  }
}

function refreshRejoin() {
  const saved = savedSession(GAME);
  rejoinBtn.classList.toggle('hidden', !saved);
  if (saved) rejoinBtn.textContent = `↩ REJOIN YOUR CREW (${saved.code})`;
}

function enterOnlineGame(match) {
  mode = 'online';
  online = {
    match,
    myPlayer: match.seat === 0 ? HOST_PLAYER : opponent(HOST_PLAYER),
  };
  tally = { green: 0, red: 0, ties: 0 };
  pollErrors = 0;
  menuEl.classList.add('hidden');
  onlinePanel.classList.add('hidden');
  lobbyEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  lastFinishedState = null;
  repaintOnline(match.state);
  match.start({
    onState: onRemoteState,
    onStatus: onRemoteStatus,
    onPresence: onRemotePresence,
    onError: onPollError,
  });
  // A resumed room can already be over because the other peeper left.
  if (match.status === 'over' && !getStatus(state).over) onRemoteStatus('over');
}

/** Replace the canopy from shared truth (resume, pass, rematch, conflict). */
function repaintOnline(newState) {
  session++;
  state = newState;
  busy = false;
  clearPreview();
  clearEffects();
  passBar.classList.add('hidden');
  resultBar.classList.add('hidden');
  resetLbPanel();
  rematchBtn.classList.remove('hidden');
  if (!getStatus(state).over) lastFinishedState = null;
  showCoach();
  render({ animateCounts: false });
  // Shared truth can arrive from resume, reconnect, rematch, or conflict.
  // Present it faithfully, but never replay celebration from that repaint.
  advance(false);
}

function singleMoveBetween(before, after) {
  let move = null;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (before.grid[r][c] === 0 && after.grid[r][c] !== 0) {
        if (move) return null;
        move = { row: r, col: c };
      }
    }
  }
  if (!move) return null;
  try {
    const expected = applyMove(before, move);
    return JSON.stringify(expected) === JSON.stringify(after) ? move : null;
  } catch {
    return null;
  }
}

function singlePassBetween(before, after) {
  if (!getStatus(before).mustPass) return false;
  try {
    return JSON.stringify(applyMove(before, PASS)) === JSON.stringify(after);
  } catch {
    return false;
  }
}

function onRemoteState(newState) {
  const move = !busy && singleMoveBetween(state, newState);
  if (move) {
    // One ordinary placement: reuse Peak Foliage's leaf-drop + ripple.
    playMove(move, newState);
  } else if (!busy && singlePassBetween(state, newState)) {
    // A pass is also a newly confirmed transition, including the second
    // pass that can end a season.
    session++;
    state = newState;
    clearPreview();
    clearEffects();
    sound.pass();
    render();
    advance();
  } else {
    // Rematches, conflict truth, and unexpected diffs repaint quietly.
    repaintOnline(newState);
  }
}

function onRemoteStatus(status) {
  if (status !== 'over') return;
  const opp = online && online.match.opponents()[0];
  if (opp && opp.left && !getStatus(state).over) {
    session++;
    busy = false;
    clearPreview();
    clearEffects();
    coachHint.classList.add('hidden');
    for (const cell of cells) cell.classList.remove('legal');
    passBar.classList.add('hidden');
    turnChip.className = '';
    turnChip.textContent = '';
    resultText.textContent = `${onlineOpponentName()} LEFT THE TRAIL`;
    const counts = getStatus(state).counts;
    resultScore.textContent = `🌿 ${counts.green} — ${counts.red} 🍁`;
    resultScore.setAttribute('aria-label', `Final score: green ${counts.green}, red ${counts.red}`);
    resultLine.classList.add('hidden');
    resultLine.textContent = '';
    rematchBtn.classList.add('hidden');
    resultBar.classList.remove('hidden');
    announce(`${resultText.textContent}. Green ${counts.green}, red ${counts.red}.`);
  }
}

function onRemotePresence(opponents) {
  pollErrors = 0;
  const opp = opponents[0];
  if (opp && opp.left) rematchBtn.classList.add('hidden');
  if (!busy && !getStatus(state).over) renderTurnChip(getStatus(state));
}

function onPollError(err) {
  if (err && err.code === 'not_found') {
    online.match.stop();
    clearSession(GAME);
    online = null;
    mode = 'pass';
    clearEffects();
    gameEl.classList.add('hidden');
    menuEl.classList.remove('hidden');
    refreshRejoin();
    return;
  }
  pollErrors++;
  if (pollErrors >= 3 && !getStatus(state).over) {
    turnChip.className = '';
    turnChip.textContent = 'WINDY CONNECTION — HANG TIGHT…';
  }
}

async function pushOnline(newState) {
  const match = online && online.match;
  if (!match) return;
  try {
    await match.push(newState, { over: getStatus(newState).over });
    pollErrors = 0;
  } catch (err) {
    if (err && err.code === 'version_conflict') {
      if (online && online.match === match &&
          JSON.stringify(state) !== JSON.stringify(match.state)) {
        repaintOnline(match.state);
      }
      return;
    }
    // One calm retry, then let the poll loop surface the trouble.
    setTimeout(async () => {
      if (!online || online.match !== match) return;
      try {
        await match.push(newState, { over: getStatus(newState).over });
        pollErrors = 0;
      } catch (retryErr) {
        onPollError(retryErr);
      }
    }, 1500);
  }
}

async function onlineRematch() {
  if (!online) return;
  const fresh = createInitialState(firstPlayer);
  repaintOnline(fresh);
  try {
    await online.match.push(fresh, {});
    render();
    advance();
  } catch (err) {
    if (err && err.code === 'version_conflict') {
      // They turned the season first — take their fresh canopy.
      if (JSON.stringify(state) !== JSON.stringify(online.match.state)) {
        repaintOnline(online.match.state);
      }
    } else {
      onPollError(err);
    }
  }
}

// Show the rejoin chip on first load if a crew is waiting on us.
refreshRejoin();

/* ------------------------------------------------- crew-link invites */
// Text a link instead of reading letters aloud: ?join=ABCD opens the join
// panel with the code filled in, then scrubs the URL so refreshes don't
// re-trigger it. Canonical pattern: four-in-a-rowboat (ROOMS-INTEGRATION §6).

$('inviteBtn').addEventListener('click', async () => {
  const code = ($('lobbyCode').textContent || '').trim();
  if (!code) return;
  const url = `${location.origin}${location.pathname}?join=${code}`;
  const text = `🍂 Flip the mountain with me — tap to join my Peak Foliage game: ${url}`;
  try {
    if (navigator.share && /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
      await navigator.share({ text });
    } else {
      await navigator.clipboard.writeText(url);
      $('inviteBtn').textContent = '✓ LINK COPIED';
      setTimeout(() => { $('inviteBtn').textContent = '📲 SEND AN INVITE'; }, 1800);
    }
  } catch { /* share sheet closed */ }
});

(() => {
  const code = new URLSearchParams(location.search).get('join');
  if (!code || !/^[A-Za-z0-9]{4}$/.test(code)) return;
  history.replaceState(null, '', location.pathname);
  openPanel('join');
  $('opCode').value = code.toUpperCase();
})();
