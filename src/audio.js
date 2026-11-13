// All sounds are synthesised with Web Audio: no files to load.
import { camera } from './engine.js';
import { clamp, rand } from './util.js';

let ctx = null, master = null, noiseBuf = null, muted = false;
const lastPlay = {};
export function init() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25;
  master = ctx.createGain(); master.gain.value = 0.8;
  comp.connect(master); master.connect(ctx.destination);
  master._in = comp;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.8; }
export function isMuted() { return muted; }
const ok = () => ctx && !muted && ctx.state === 'running';
const out = () => master._in;
function gate(name, minGap) { const t = performance.now(); if (lastPlay[name] && t - lastPlay[name] < minGap) return false; lastPlay[name] = t; return true; }
export function distGain(at) { if (!at) return 1; return clamp(1.25 - camera.position.distanceTo(at) / 520, 0.12, 1); }

function noise(t0, dur, { type = 'lowpass', f0 = 1000, f1 = 200, q = 0.7, gain = 1, attack = 0.005, curve = 2 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  src.playbackRate.value = rand(0.85, 1.15);
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.setTargetAtTime(0.0001, t0 + attack, dur / (curve * 2.2));
  src.connect(f); f.connect(g); g.connect(out());
  src.start(t0, rand(0, 1.5)); src.stop(t0 + dur + 0.5);
  return g;
}
function tone(t0, dur, { type = 'sine', f0 = 100, f1 = 40, gain = 1, attack = 0.004 } = {}) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(out()); o.start(t0); o.stop(t0 + dur + 0.05);
  return o;
}

export function boom(size = 1, at) {
  if (!ok()) return;
  const t = ctx.currentTime, g = distGain(at), S = clamp(size, 0.3, 6);
  tone(t, 0.5 + 0.35 * S, { f0: 110 / Math.sqrt(S) + 30, f1: 24, gain: 0.9 * g });
  tone(t, 0.25 + 0.1 * S, { type: 'triangle', f0: 180, f1: 45, gain: 0.35 * g });
  noise(t, 0.9 + 0.7 * S, { f0: 2600, f1: 120, gain: 0.85 * g, curve: 1.4 });
  noise(t + 0.02, 0.35, { type: 'highpass', f0: 3000, f1: 1500, gain: 0.25 * g });
  // crackle tail
  for (let i = 0; i < 6 * S; i++) noise(t + 0.1 + rand(0, 0.8 * S), 0.05, { type: 'bandpass', f0: rand(800, 2400), f1: 600, q: 3, gain: 0.25 * g });
}
export function glass(n = 1, at) {
  if (!ok() || !gate('glass', 70)) return;
  const t = ctx.currentTime, g = distGain(at);
  noise(t, 0.35, { type: 'highpass', f0: 5200, f1: 2500, gain: 0.32 * g * Math.min(1.5, 0.5 + n * 0.05) });
  const k = Math.min(18, 4 + n);
  for (let i = 0; i < k; i++) tone(t + rand(0, 0.45), rand(0.05, 0.14), { type: 'sine', f0: rand(2600, 7200), f1: rand(2000, 6000), gain: rand(0.04, 0.11) * g });
}
export function clang(at) {
  if (!ok()) return;
  const t = ctx.currentTime, g = distGain(at);
  for (const [f, a, d] of [[143, 0.5, 0.9], [347, 0.32, 0.7], [811, 0.18, 0.5], [1290, 0.12, 0.35], [2230, 0.07, 0.25]]) tone(t, d, { type: 'sine', f0: f, f1: f * 0.98, gain: a * g });
  noise(t, 0.12, { type: 'bandpass', f0: 2500, f1: 900, q: 1.2, gain: 0.5 * g });
  tone(t, 0.3, { f0: 90, f1: 35, gain: 0.8 * g });
}
export function gunshot(at) {
  if (!ok() || !gate('gun', 40)) return;
  const t = ctx.currentTime, g = distGain(at);
  noise(t, 0.09, { type: 'bandpass', f0: 1800, f1: 400, q: 0.8, gain: 0.55, curve: 2.5 });
  tone(t, 0.07, { f0: 160, f1: 60, gain: 0.45 });
  noise(t + 0.01, 0.05, { type: 'highpass', f0: 4200, f1: 2500, gain: 0.12 });
}
export function ricochet(at) {
  if (!ok() || !gate('rico', 60)) return;
  const t = ctx.currentTime, g = distGain(at);
  const f = rand(1800, 3200);
  tone(t, 0.16, { type: 'sine', f0: f, f1: f * 0.55, gain: 0.08 * g });
  noise(t, 0.06, { type: 'bandpass', f0: 2600, f1: 900, q: 2, gain: 0.25 * g });
}
export function crumble(size = 1, at) {
  if (!ok() || !gate('crumble', 90)) return;
  const t = ctx.currentTime, g = distGain(at) * clamp(size, 0.2, 2);
  noise(t, 0.6 + size * 0.8, { f0: 700, f1: 90, gain: 0.45 * g, attack: 0.02, curve: 1.2 });
  for (let i = 0; i < 8; i++) noise(t + rand(0, 0.8), 0.06, { type: 'bandpass', f0: rand(250, 900), f1: 200, q: 2, gain: 0.3 * g });
}
export function thud(v, at) {
  if (!ok() || !gate('thud', 45)) return;
  const t = ctx.currentTime, g = distGain(at) * clamp(v / 20, 0.15, 1);
  tone(t, 0.18, { f0: 120, f1: 40, gain: 0.5 * g });
  noise(t, 0.2, { f0: 900, f1: 150, gain: 0.3 * g });
}
export function whoosh(at, dur = 0.8) {
  if (!ok()) return;
  const t = ctx.currentTime, g = distGain(at);
  noise(t, dur, { type: 'bandpass', f0: 400, f1: 2200, q: 1.5, gain: 0.35 * g, attack: 0.15, curve: 1 });
}
export function swing() {
  if (!ok()) return;
  const t = ctx.currentTime;
  noise(t, 0.22, { type: 'bandpass', f0: 300, f1: 1800, q: 1.2, gain: 0.4, attack: 0.08, curve: 1.2 });
}
export function charge(dur = 0.9) {
  if (!ok()) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(1400, t + dur);
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 4; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(3800, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + dur * 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
  o.connect(f); f.connect(g); g.connect(out()); o.start(t); o.stop(t + dur + 0.1);
  noise(t, dur, { type: 'highpass', f0: 2000, f1: 7000, gain: 0.12, attack: dur * 0.8, curve: 0.6 });
}
/** looped sounds return a handle with set(level 0..1) and stop() */
function loop(build) {
  if (!ok()) return { set() {}, stop() {} };
  const t = ctx.currentTime;
  const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(out());
  const nodes = build(g, t);
  return {
    set(v, ramp = 0.08) { g.gain.setTargetAtTime(Math.max(0.0001, v), ctx.currentTime, ramp); if (nodes.onSet) nodes.onSet(v); },
    stop(fade = 0.25) { const n = ctx.currentTime; g.gain.setTargetAtTime(0.0001, n, fade / 3); for (const s of nodes.srcs) try { s.stop(n + fade + 0.1); } catch (e) { } },
  };
}
export function laserLoop() {
  return loop((g, t) => {
    const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 74;
    const b = ctx.createOscillator(); b.type = 'square'; b.frequency.value = 111;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 17; const lg = ctx.createGain(); lg.gain.value = 300;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2;
    lfo.connect(lg); lg.connect(f.frequency);
    const sz = ctx.createBufferSource(); sz.buffer = noiseBuf; sz.loop = true;
    const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 4000;
    const sg = ctx.createGain(); sg.gain.value = 0.35;
    a.connect(f); b.connect(f); f.connect(g); sz.connect(hf); hf.connect(sg); sg.connect(g);
    for (const s of [a, b, lfo, sz]) s.start(t);
    return { srcs: [a, b, lfo, sz] };
  });
}
export function rumbleLoop() {
  return loop((g, t) => {
    const sz = ctx.createBufferSource(); sz.buffer = noiseBuf; sz.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 38;
    const og = ctx.createGain(); og.gain.value = 0.6;
    const hiss = ctx.createBufferSource(); hiss.buffer = noiseBuf; hiss.loop = true;
    const hf = ctx.createBiquadFilter(); hf.type = 'bandpass'; hf.frequency.value = 1400; hf.Q.value = 0.8;
    const hg = ctx.createGain(); hg.gain.value = 0.25;
    sz.connect(f); f.connect(g); o.connect(og); og.connect(g); hiss.connect(hf); hf.connect(hg); hg.connect(g);
    for (const s of [sz, o, hiss]) s.start(t);
    return { srcs: [sz, o, hiss], onSet(v) { f.frequency.setTargetAtTime(200 + 900 * v, ctx.currentTime, 0.1); hf.frequency.setTargetAtTime(900 + 2500 * v, ctx.currentTime, 0.1); } };
  });
}
export function drillLoop() {
  return loop((g, t) => {
    const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 62;
    const trem = ctx.createOscillator(); trem.frequency.value = 23; const tg = ctx.createGain(); tg.gain.value = 0.4;
    const amp = ctx.createGain(); amp.gain.value = 0.6;
    trem.connect(tg); tg.connect(amp.gain);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const grind = ctx.createBufferSource(); grind.buffer = noiseBuf; grind.loop = true;
    const gf = ctx.createBiquadFilter(); gf.type = 'bandpass'; gf.frequency.value = 600; gf.Q.value = 1.3;
    const gg = ctx.createGain(); gg.gain.value = 0.0;
    a.connect(f); f.connect(amp); amp.connect(g); grind.connect(gf); gf.connect(gg); gg.connect(g);
    for (const s of [a, trem, grind]) s.start(t);
    return { srcs: [a, trem, grind], onSet(v) { gg.gain.setTargetAtTime(v > 0.6 ? 0.8 : 0.05, ctx.currentTime, 0.1); a.frequency.setTargetAtTime(v > 0.6 ? 48 : 66, ctx.currentTime, 0.2); } };
  });
}
export function fuseLoop() {
  return loop((g, t) => {
    const sz = ctx.createBufferSource(); sz.buffer = noiseBuf; sz.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 3500;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 31; const lg = ctx.createGain(); lg.gain.value = 0.5;
    const amp = ctx.createGain(); amp.gain.value = 0.5; lfo.connect(lg); lg.connect(amp.gain);
    sz.connect(f); f.connect(amp); amp.connect(g);
    sz.start(t); lfo.start(t);
    return { srcs: [sz, lfo] };
  });
}
export function rocketLoop() {
  return loop((g, t) => {
    const sz = ctx.createBufferSource(); sz.buffer = noiseBuf; sz.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.6;
    sz.connect(f); f.connect(g); sz.start(t);
    return { srcs: [sz] };
  });
}
export function blip(f = 880) {
  if (!ok()) return;
  tone(ctx.currentTime, 0.08, { type: 'square', f0: f, f1: f, gain: 0.06 });
}
