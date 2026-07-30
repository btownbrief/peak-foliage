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

let mode = 'pass'; // 'pass' | 'peeper' | 'forester' | 'online'
let state = createInitialState();
let busy = false; // an animation or bot think is in flight
let session = 0; // bumped on every new match / exit, cancels stale timers
let tally = { green: 0, red: 0, ties: 0 };
let firstPlayer = GREEN; // who opens the next game — like sugarbush-squares,
                         // the loser opens the rematch (ties alternate)
let online = null; // { match, myPlayer } while in an online crew

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
trailBtn.addEventListener('click', backToTrailhead);
rematchBtn.addEventListener('click', rematch);
$('howBtn').addEventListener('click', () => $('howTo').classList.toggle('hidden'));
$('mute').addEventListener('click', () => {
  $('mute').textContent = sound.toggleMuted() ? '🔇' : '🔊';
});
$('mute').textContent = sound.muted ? '🔇' : '🔊';
passBtn.addEventListener('click', onHumanPass);

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
  menuEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  passBar.classList.add('hidden');
  resultBar.classList.add('hidden');
  render();
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
  gameEl.classList.add('hidden');
  passBar.classList.add('hidden');
  resultBar.classList.add('hidden');
  menuEl.classList.remove('hidden');
  refreshRejoin();
}

function later(ms, fn) {
  const mySession = session;
  setTimeout(() => {
    if (session === mySession) fn();
  }, ms);
}

/* ------------------------------------------------------------- rendering */

function isHumanTurn() {
  if (mode === 'pass') return true;
  if (mode === 'online') {
    return online && online.match.status === 'playing' && state.turn === online.myPlayer;
  }
  return state.turn === GREEN;
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

function renderThermos(counts) {
  // --pct drives the tube fill: height on the vertical thermos, width on
  // the narrow-phone horizontal strip (see the media query in style.css).
  const pct = (n) => Math.max(3, (n / (SIZE * SIZE)) * 100);
  greenFill.style.setProperty('--pct', `${pct(counts.green)}%`);
  redFill.style.setProperty('--pct', `${pct(counts.red)}%`);
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
    if (online && !remoteState) pushOnline(next);
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

/* --------------------------------------------------------------- finish */

function finish(st) {
  const { green, red } = st.counts;
  if (st.tie) {
    tally.ties++;
    resultText.textContent = 'STICK SEASON — DEAD EVEN 🍂';
    sound.tie();
    firstPlayer = opponent(firstPlayer); // dead even: just take turns opening
  } else if (st.winner === GREEN) {
    tally.green++;
    if (mode === 'online') {
      const iWon = online.myPlayer === GREEN;
      resultText.textContent = iWon
        ? 'SUMMER HOLDS ON — YOU WIN! 🌿'
        : `${onlineOpponentName()} KEPT THE MOUNTAIN GREEN 🌿`;
      if (iWon) sound.win();
      else sound.lose();
    } else {
      resultText.textContent = mode === 'pass' ? 'SUMMER HOLDS ON! 🌿' : 'YOU TURNED THE WHOLE MOUNTAIN! 🍁';
      sound.win();
    }
    firstPlayer = RED; // the loser opens the rematch
  } else {
    tally.red++;
    if (mode === 'online') {
      const iWon = online.myPlayer === RED;
      resultText.textContent = iWon
        ? 'YOU TURNED THE WHOLE MOUNTAIN! 🍁'
        : `${onlineOpponentName()} FOUND PEAK 🍁`;
      if (iWon) sound.win();
      else sound.lose();
    } else {
      resultText.textContent = mode === 'pass' ? 'PEAK FOLIAGE! 🍁' : BOT_WIN_LINES[mode];
      if (mode === 'pass') sound.win();
      else sound.lose();
    }
    firstPlayer = GREEN;
  }
  resultScore.textContent = `🌿 ${green} — ${red} 🍁`;
  render();
  later(reducedMotion ? 100 : 500, () => resultBar.classList.remove('hidden'));
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
  passBar.classList.add('hidden');
  resultBar.classList.add('hidden');
  rematchBtn.classList.remove('hidden');
  render();
  advance();
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

function onRemoteState(newState) {
  const move = !busy && singleMoveBetween(state, newState);
  if (move) {
    // One ordinary placement: reuse Peak Foliage's leaf-drop + ripple.
    playMove(move, newState);
  } else {
    // Forced passes, rematches, conflict truth, and unexpected diffs repaint.
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
    for (const cell of cells) cell.classList.remove('legal');
    passBar.classList.add('hidden');
    turnChip.className = '';
    turnChip.textContent = '';
    resultText.textContent = `${onlineOpponentName()} LEFT THE TRAIL`;
    const counts = getStatus(state).counts;
    resultScore.textContent = `🌿 ${counts.green} — ${counts.red} 🍁`;
    rematchBtn.classList.add('hidden');
    resultBar.classList.remove('hidden');
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
