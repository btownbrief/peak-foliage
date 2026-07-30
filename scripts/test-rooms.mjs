// Online-rooms wiring test: drives the real vendored client (js/rooms.js)
// against the local shim (scripts/rooms-shim.mjs) as two simulated phones,
// then plays a full online game through the real engine. No network, no
// Supabase — the SQL file has its own referee tests; this proves OUR side.
//
//   node scripts/test-rooms.mjs

import { createRooms } from './rooms-shim.mjs';
import {
  GREEN, RED, PASS, createInitialState, legalMoves, applyMove, getStatus,
} from '../js/engine.js';

const GAME = 'peak-foliage';

/* ------------------------------------------------- two-phone environment */

const stores = new Map();
let current = 'A';
globalThis.localStorage = {
  getItem: (k) => (stores.get(current).has(k) ? stores.get(current).get(k) : null),
  setItem: (k, v) => stores.get(current).set(k, String(v)),
  removeItem: (k) => stores.get(current).delete(k),
};
function device(d) {
  if (!stores.has(d)) stores.set(d, new Map());
  current = d;
}
device('A');
device('B');

let passed = 0;
function t(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed++;
  console.log(`  ok — ${label}`);
}
async function expectCode(promise, code, label) {
  try {
    await promise;
    t(false, `${label} (no error thrown)`);
  } catch (e) {
    t(e && e.code === code, `${label} (got ${e && e.code})`);
  }
}

// Route fetch straight to the canonical shim's RPC functions. This exercises
// the same referee without requiring a localhost port in restricted shells.
const { rpcs } = createRooms();
let backendReady = true;
globalThis.fetch = async (url, options) => {
  if (!backendReady) return new Response('{}', { status: 404 });
  const fn = String(url).match(/\/rest\/v1\/rpc\/(\w+)$/)?.[1];
  if (!fn || !rpcs[fn]) return new Response('{}', { status: 404 });
  try {
    const body = rpcs[fn](JSON.parse(options.body || '{}')) ?? {};
    return new Response(JSON.stringify(body), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ message: e.message }), { status: e.rpc ? 400 : 500 });
  }
};
globalThis.BTOWN_ROOMS_URL = 'http://rooms.test';
const { OnlineMatch, savedSession } = await import('../js/rooms.js');

/* ------------------------------------------------------------ the tests */

// create + join
device('A');
const host = await OnlineMatch.create({
  game: GAME, name: 'Peeper A', state: createInitialState(), seats: 2,
});
t(/^[A-Z2-9]{4}$/.test(host.code) && host.seat === 0 && host.status === 'waiting', 'host creates room, seat 0');
t(savedSession(GAME)?.roomId === host.roomId, 'host session saved');

device('B');
await expectCode(OnlineMatch.join({ game: GAME, code: 'ZZZZ', name: 'X' }), 'not_found', 'bad code rejected');
await expectCode(OnlineMatch.join({ game: 'four-in-a-rowboat', code: host.code, name: 'X' }), 'wrong_game', 'wrong game rejected');
const guest = await OnlineMatch.join({
  game: GAME, code: ` ${host.code.toLowerCase()} `, name: 'Peeper B',
});
t(guest.seat === 1 && guest.status === 'playing', 'guest joins (sloppy code ok), game starts');
t(guest.opponents().length === 1 && guest.opponents()[0].name === 'Peeper A', 'guest sees host name');

device('A');
await host._fetch();
t(host.status === 'playing' && host.opponents()[0].name === 'Peeper B', 'host poll sees game start');

// referee: push, sync, conflict
const hostMove = legalMoves(host.state)[0];
const sA = applyMove(host.state, hostMove);
await host.push(sA);
t(host.version === 1, 'host pushes move, version 1');

device('B');
await guest._fetch();
t(JSON.stringify(guest.state) === JSON.stringify(sA) && guest.state.turn === RED, 'guest poll receives the move');
const guestStatus = getStatus(guest.state);
const guestMove = guestStatus.mustPass ? PASS : legalMoves(guest.state)[0];
await guest.push(applyMove(guest.state, guestMove));
t(guest.version === 2, 'guest pushes reply, version 2');

device('A');
const staleStatus = getStatus(sA);
const staleMove = staleStatus.mustPass ? PASS : legalMoves(sA).at(-1);
const staleState = applyMove(sA, staleMove);
await expectCode(host.push(staleState), 'version_conflict', 'stale push rejected');
t(host.version === 2 && JSON.stringify(host.state) === JSON.stringify(guest.state), 'conflict refetches the truth');

// Full Reversi game, choosing a random legal placement on the phone whose
// engine turn it is. Forced passes are pushed as moves too.
device('A'); await host._fetch();
device('B'); await guest._fetch();
const phones = {
  [GREEN]: { match: host, device: 'A' },
  [RED]: { match: guest, device: 'B' },
};
let plies = 0;
let forcedPasses = 0;
let randomSeed = 2;
while (!getStatus(host.state).over && plies < 400) {
  const phone = phones[host.state.turn];
  device(phone.device);
  await phone.match._fetch();
  const status = getStatus(phone.match.state);
  const moves = legalMoves(phone.match.state);
  randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
  const move = status.mustPass ? PASS : moves[randomSeed % moves.length];
  if (move === PASS) forcedPasses++;
  const next = applyMove(phone.match.state, move);
  await phone.match.push(next, { over: getStatus(next).over });

  device('A'); await host._fetch();
  device('B'); await guest._fetch();
  if (JSON.stringify(host.state) !== JSON.stringify(guest.state)) {
    t(false, `phones stay synchronized after move ${plies + 1}`);
  }
  plies++;
}
t(
  plies < 400 && getStatus(host.state).over && host.status === 'over' && forcedPasses > 0,
  `full online game ends cleanly (${plies} moves/passes, ${forcedPasses} forced passes)`,
);
t(JSON.stringify(host.state) === JSON.stringify(guest.state), 'end states identical');

// rematch: either phone turns a fresh canopy into the finished room
device('B');
await guest.push(createInitialState(), {});
t(guest.status === 'playing' && guest.version === host.version + 1, 'rematch deal accepted');

// resume after a "refresh"
device('A');
const resumed = await OnlineMatch.resume({ game: GAME });
t(resumed.roomId === host.roomId && resumed.seat === 0 && resumed.status === 'playing', 'resume reattaches to the room');

// leave: other side sees the flag, session cleared
await resumed.leave();
t(savedSession(GAME) === null, 'leave clears the session');
device('B');
await guest._fetch();
t(guest.status === 'over' && guest.opponents()[0].left === true, 'guest sees host left');

// full room turns a third phone away
device('A');
const h2 = await OnlineMatch.create({ game: GAME, name: 'A', state: createInitialState() });
device('B');
await OnlineMatch.join({ game: GAME, code: h2.code, name: 'B' });
device('C');
await expectCode(OnlineMatch.join({ game: GAME, code: h2.code, name: 'C' }), 'room_started', 'third phone turned away');

// backend not installed → clean 'not_ready' (RPCs return 404)
{
  backendReady = false;
  const fresh = await import('../js/rooms.js?not-ready');
  await expectCode(
    fresh.OnlineMatch.create({ game: GAME, name: 'A', state: {} }),
    'not_ready', 'missing backend reads as not_ready');
}

console.log(`\nALL ROOMS TESTS PASSED (${passed} checks)`);
process.exit(0);
