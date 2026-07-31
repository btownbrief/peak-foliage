// PEAK FOLIAGE — tiny procedural WebAudio sounds. No audio files.
// Everything is synthesized: a papery rustle when a leaf lands, a rising
// tick for each leaf that flips down the line, a jingle when the season
// turns for good.

const LS_MUTED = 'peak-foliage-muted';

let ctx = null;
let muted = localStorage.getItem(LS_MUTED) === '1';

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, { type = 'sine', gain = 0.16, slide = 0 } = {}) {
  const a = ac();
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

// A short burst of filtered noise — dry leaves underfoot.
function rustleBurst(start, dur, gain) {
  const a = ac();
  const t = a.currentTime + start;
  const frames = Math.ceil(a.sampleRate * dur);
  const buf = a.createBuffer(1, frames, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2600;
  filter.Q.value = 0.8;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(t);
}

export const sound = {
  get muted() {
    return muted;
  },
  toggleMuted() {
    muted = !muted;
    localStorage.setItem(LS_MUTED, muted ? '1' : '0');
    return muted;
  },
  /** A leaf lands in the canopy. */
  land() {
    if (muted) return;
    rustleBurst(0, 0.09, 0.2);
    tone(220, 0, 0.1, { type: 'sine', slide: -120, gain: 0.12 });
  },
  /** The i-th leaf down a line turns over — ticks climb as the wave runs. */
  flip(i) {
    if (muted) return;
    tone(340 + i * 55, 0, 0.07, { type: 'triangle', gain: 0.1 });
  },
  /** A whole branch turns at once. */
  megaFlip(count) {
    if (muted) return;
    rustleBurst(0, 0.38, Math.min(0.14, 0.08 + count * 0.004));
    [440, 554, 659].forEach((f, i) => {
      tone(f, i * 0.055, 0.18, { type: 'triangle', gain: 0.09 });
    });
  },
  /** Corners deserve a clear, bright strategy sting. */
  corner() {
    if (muted) return;
    rustleBurst(0, 0.2, 0.1);
    [523, 659, 784].forEach((f, i) => {
      tone(f, i * 0.07, 0.28, { type: 'triangle', gain: 0.14 });
    });
  },
  /** Quiet confirmation that the thermometers crossed. */
  leadChange() {
    if (muted) return;
    tone(392, 0, 0.16, { type: 'sine', gain: 0.07 });
    tone(523, 0.08, 0.2, { type: 'sine', gain: 0.08 });
  },
  /** No moves — the wind just passes through. */
  pass() {
    if (muted) return;
    rustleBurst(0, 0.35, 0.08);
    tone(500, 0, 0.35, { type: 'sine', slide: -260, gain: 0.05 });
  },
  win() {
    if (muted) return;
    [392, 494, 587, 784].forEach((f, i) => tone(f, i * 0.11, 0.24, { type: 'triangle', gain: 0.18 }));
    tone(784, 0.44, 0.5, { type: 'triangle', gain: 0.14 });
  },
  lose() {
    if (muted) return;
    [330, 262, 196].forEach((f, i) => tone(f, i * 0.14, 0.26, { type: 'triangle', gain: 0.15 }));
  },
  tie() {
    if (muted) return;
    tone(220, 0, 0.5, { type: 'sawtooth', gain: 0.06, slide: -40 });
    tone(224, 0, 0.5, { type: 'sawtooth', gain: 0.06, slide: -40 });
  },
};
