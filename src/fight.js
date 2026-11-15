// 반격 모드 (experimental, ?mode=fight): the target buildings fight back.
// A window facing the player lights up red for a moment (the warning), then throws office things (paper balls,
// coffee cups, staplers) at where the player is. The player is the camera: moving it around the building
// (joystick, one-finger drag, WASD / arrow keys) dodges. A hit costs a heart; with no hearts left the run is over.
// Later on the buildings lead their shots (aim where you are going) and throw fans of three.
import * as THREE from 'three';
import { scene, camera, controls } from './engine.js';
import * as S from './structure.js';
import * as FX from './fx.js';
import * as A from './audio.js';
import { EXTRA_WARM } from './weapons.js';
import { clamp } from './util.js';

const MAX_HP = 5;
export const state = {
  on: new URLSearchParams(location.search).get('mode') === 'fight',
  hp: MAX_HP, max: MAX_HP, over: false,
  t: 0, // active fight time (s): the difficulty ramps with it
  hits: 0, dodged: 0, blocked: 0,
};
export const hooks = { onStart: null, onHit: null, onDead: null };

// ---------------------------------------------------------------- tuning (lengths are fractions of D, the camera's distance to the building)
const GRACE = 2.5; // s before the first throw
const WARN = 0.9; // s of warning before a throw
const HIT_R = 0.055; // the player's size
const SIZE = 0.024; // a thrown thing's size
const MOVE = 0.55; // full joystick: D per second
const EL_MIN = THREE.MathUtils.degToRad(7), EL_MAX = THREE.MathUtils.degToRad(52); // camera height range (elevation)
const INVULN = 1.2; // s of blinking after a hit

// ---------------------------------------------------------------- thrown things (toy office supplies)
const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, flatShading: true });
const M = { paper: mat(0xf7f4ec), cup: mat(0xffffff), sleeve: mat(0xc0814f), lid: mat(0x6b4a32), stapler: mat(0xff5a5f), steel: mat(0x59606b) };
function paper() { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), M.paper); m.scale.set(1, 0.85, 0.95); return m; }
function cup() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.52, 1.7, 10), M.cup));
  const s = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.6, 0.62, 10), M.sleeve); s.scale.setScalar(1.04); g.add(s);
  const l = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.22, 10), M.lid); l.position.y = 0.9; g.add(l);
  return g;
}
function stapler() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.32, 0.72), M.steel); b.position.y = -0.3; g.add(b);
  const t = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.42, 0.7), M.stapler); t.position.set(0.05, 0.14, 0); t.rotation.z = 0.08; g.add(t);
  return g;
}
const PROTOS = [paper(), cup(), stapler()];
const KINDS = ['서류 뭉치', '커피컵', '스테이플러'];

// the warning: a red badge with "!" over the window, always on top
const warnTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,72,72,0.28)'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ff4646'; g.beginPath(); g.arc(64, 64, 44, 0, Math.PI * 2); g.fill();
  g.lineWidth = 6; g.strokeStyle = '#fff'; g.stroke();
  g.fillStyle = '#fff'; g.font = '900 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const warnMat = new THREE.SpriteMaterial({ map: warnTex, depthTest: false, depthWrite: false, transparent: true });
// compiled with the weapons before the game starts, so the first throw does not stall
EXTRA_WARM.push(...PROTOS.map((p) => p.clone()), new THREE.Sprite(warnMat));

const warns = []; // { b, p, pos, t, n, lead, fan }
const shots = []; // { obj, pos, prev, vel, spin, axis, life, near, passed }
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _c = new THREE.Vector3();

let D = 600; // camera distance to the building, fixed once the fight starts
let began = false, nextIn = GRACE, inv = 0;
const pvel = new THREE.Vector3(), lastCam = new THREE.Vector3(); // the player's velocity, for leading shots
const cache = new WeakMap(); // building -> { n, arr } its standing pieces as an array

// ---------------------------------------------------------------- UI: hearts, joystick, hurt flash
const ui = {};
function buildUI() {
  if (ui.hp) return;
  ui.hp = document.createElement('div'); ui.hp.id = 'fHp';
  ui.joy = document.createElement('div'); ui.joy.id = 'fJoy';
  ui.joy.innerHTML = '<span class="ar l">◀</span><span class="ar r">▶</span><span class="ar u">▲</span><span class="ar d">▼</span><i></i>';
  ui.knob = ui.joy.querySelector('i');
  ui.hurt = document.createElement('div'); ui.hurt.id = 'fHurt';
  document.body.append(ui.hp, ui.joy, ui.hurt);
  paintHp();
  // the joystick: drag the knob; it springs back on release
  let id = null, cx = 0, cy = 0;
  const R = 44;
  const set = (x, y) => {
    let dx = x - cx, dy = y - cy; const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    joy.x = dx / R; joy.y = -dy / R;
    ui.knob.style.transform = `translate(${dx}px,${dy}px)`;
  };
  ui.joy.addEventListener('pointerdown', (e) => {
    e.stopPropagation(); e.preventDefault(); A.init();
    id = e.pointerId; ui.joy.setPointerCapture(id);
    const r = ui.joy.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; set(e.clientX, e.clientY);
  });
  ui.joy.addEventListener('pointermove', (e) => { if (e.pointerId === id) { e.stopPropagation(); set(e.clientX, e.clientY); } });
  const end = (e) => { if (e.pointerId !== id) return; e.stopPropagation(); id = null; joy.x = joy.y = 0; ui.knob.style.transform = ''; };
  ui.joy.addEventListener('pointerup', end); ui.joy.addEventListener('pointercancel', end);
}
const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.4C.9 8.2 3 4.5 6.6 4.5c2.2 0 3.6 1.2 5.4 3.1 1.8-1.9 3.2-3.1 5.4-3.1 3.6 0 5.7 3.7 4.2 7.1C19.5 16.4 12 21 12 21z"/></svg>';
function paintHp() {
  if (!ui.hp) return;
  ui.hp.innerHTML = Array.from({ length: state.max }, (_, i) => `<b class="${i < state.hp ? 'on' : ''}">${HEART}</b>`).join('');
}
const joy = { x: 0, y: 0 };

// ---------------------------------------------------------------- mode on / off
export function setOn(v) {
  state.on = v;
  document.documentElement.classList.toggle('fight', v);
  if (v) buildUI();
  limits();
}
/** the camera stays at one distance from the building and within a band of heights: what's left is moving around it */
function limits() {
  controls.enableZoom = !state.on;
  controls.enablePan = !state.on;
  controls.minPolarAngle = state.on ? Math.PI / 2 - EL_MAX : 0;
  controls.maxPolarAngle = state.on ? Math.PI / 2 - EL_MIN : Math.PI * 0.62;
}
setOn(state.on);

export function reset() {
  for (const w of warns) scene.remove(w.sprite);
  for (const s of shots) scene.remove(s.obj);
  warns.length = 0; shots.length = 0;
  Object.assign(state, { hp: MAX_HP, over: false, t: 0, hits: 0, dodged: 0, blocked: 0 });
  began = false; nextIn = GRACE; inv = 0;
  if (ui.hp) { paintHp(); ui.hp.classList.remove('blink'); }
}

// ---------------------------------------------------------------- moving (called every frame before controls.update)
const _off = new THREE.Vector3(), _rt = new THREE.Vector3(), _up = new THREE.Vector3(), mv = new THREE.Vector2();
export function move(dt, keys) {
  if (!state.on) return;
  let x = joy.x, y = joy.y;
  if (keys) {
    if (keys.has('d') || keys.has('arrowright')) x += 1;
    if (keys.has('a') || keys.has('arrowleft')) x -= 1;
    if (keys.has('w') || keys.has('arrowup')) y += 1;
    if (keys.has('s') || keys.has('arrowdown')) y -= 1;
  }
  x = clamp(x, -1, 1); y = clamp(y, -1, 1);
  // a little inertia: speeds ease in and out
  const k = Math.min(1, dt * 10);
  mv.x += (x - mv.x) * k; mv.y += (y - mv.y) * k;
  const tg = controls.target;
  _off.subVectors(camera.position, tg);
  const dist = began ? D : _off.length();
  if (Math.abs(mv.x) + Math.abs(mv.y) > 1e-3) {
    // sideways along the camera's right, up and down along the sphere around the building
    _rt.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize();
    _up.set(0, 1, 0).addScaledVector(_off, -_off.y / _off.lengthSq()).normalize();
    const sp = MOVE * dist * dt;
    _off.addScaledVector(_rt, mv.x * sp).addScaledVector(_up, mv.y * sp);
  }
  // back onto the sphere, inside the height band
  _off.setLength(dist);
  const h = Math.hypot(_off.x, _off.z), el = clamp(Math.atan2(_off.y, h), EL_MIN, EL_MAX);
  _off.set(_off.x / (h || 1) * Math.cos(el) * dist, Math.sin(el) * dist, _off.z / (h || 1) * Math.cos(el) * dist);
  camera.position.copy(tg).add(_off);
}

// ---------------------------------------------------------------- the buildings' turn
function standing(b) {
  let c = cache.get(b);
  if (!c || c.n !== b.statics.size) { c = { n: b.statics.size, arr: [...b.statics] }; cache.set(b, c); }
  return c.arr;
}
/** a window on the side of a target building facing the player */
function pickWindow() {
  const tg = S.buildings.filter((b) => b.target && !b.cleared && b.statics.size > 12);
  if (!tg.length) return null;
  const b = tg[Math.floor(Math.random() * tg.length)];
  const arr = standing(b);
  let best = null, bd = Infinity;
  for (let i = 0; i < 30; i++) {
    const p = arr[Math.floor(Math.random() * arr.length)];
    if (!p || !S.isStatic(p) || p.pos.y < 6) continue;
    const d = p.pos.distanceToSquared(camera.position);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { b, p: best } : null;
}
function warn(lead, fan) {
  const w = pickWindow(); if (!w) return;
  const dir = _v.subVectors(camera.position, w.p.pos).normalize();
  const pos = w.p.pos.clone().addScaledVector(dir, 7); // just outside the facade
  const sprite = new THREE.Sprite(warnMat); sprite.renderOrder = 20; sprite.position.copy(pos); scene.add(sprite);
  warns.push({ ...w, pos, sprite, t: 0, lead, fan });
  A.blip(740);
}
function throwFrom(w) {
  const T = Math.max(1.45, 2.5 - state.t * 0.012); // flight time to the player
  const aim = _w.copy(camera.position);
  if (w.lead) aim.addScaledVector(pvel, T * w.lead);
  const offs = [0];
  if (w.fan) offs.push(-1, 1);
  const side = _c.subVectors(aim, w.pos).cross(THREE.Object3D.DEFAULT_UP).normalize();
  for (const o of offs) {
    const to = aim.clone().addScaledVector(side, o * D * 0.17);
    const vel = to.sub(w.pos).divideScalar(T);
    const kind = Math.floor(Math.random() * PROTOS.length);
    const obj = PROTOS[kind].clone(); obj.scale.multiplyScalar(D * SIZE * 0.35); // grows to full size as it leaves the window
    obj.position.copy(w.pos); obj.rotation.set(Math.random() * 6, Math.random() * 6, 0); scene.add(obj);
    shots.push({ obj, kind, base: D * SIZE, grow: 0, pos: w.pos.clone(), prev: w.pos.clone(), vel, axis: new THREE.Vector3().randomDirection(), spin: 5 + Math.random() * 6, life: T * 2.4, near: Infinity, passed: false });
  }
  FX.smoke(w.pos.x, w.pos.y, w.pos.z, 0, 2, 0, 0.8, D * 0.02, D * 0.05, 0.1, 0.6);
  A.whoosh(w.pos, 0.35);
}
function hit(s) {
  state.hp--; state.hits++; inv = INVULN;
  paintHp(); if (ui.hp) ui.hp.classList.add('blink');
  FX.shake(0.85); FX.cam.hitstop = Math.max(FX.cam.hitstop, 0.06);
  A.thud(40); A.glass(1);
  if (ui.hurt) { ui.hurt.style.transition = 'none'; ui.hurt.style.opacity = 1; requestAnimationFrame(() => { ui.hurt.style.transition = 'opacity .7s'; ui.hurt.style.opacity = 0; }); }
  if (navigator.vibrate) try { navigator.vibrate(state.hp > 0 ? 90 : [120, 60, 220]); } catch (e) { /* not allowed */ }
  if (hooks.onHit) hooks.onHit(KINDS[s.kind], state.hp);
  if (state.hp <= 0) {
    state.over = true; FX.cam.slowmo = 0.25;
    for (const w of warns) scene.remove(w.sprite);
    warns.length = 0;
    if (hooks.onDead) hooks.onDead();
  }
}

/** one step of the fight; `active` = the game is being played (not paused, home screen closed, run not over) */
export function update(dt, active) {
  if (!state.on || !active || state.over) return;
  if (!began) {
    began = true;
    D = camera.position.distanceTo(controls.target);
    lastCam.copy(camera.position); pvel.set(0, 0, 0);
    if (hooks.onStart) hooks.onStart();
  }
  state.t += dt;
  // the player's velocity, smoothed
  if (dt > 0) { _v.subVectors(camera.position, lastCam).divideScalar(dt); pvel.lerp(_v, Math.min(1, dt * 6)); }
  lastCam.copy(camera.position);
  if (inv > 0) { inv -= dt; if (inv <= 0 && ui.hp) ui.hp.classList.remove('blink'); }

  // the more of them is down, the angrier they get
  const anger = 1 + S.targetRatio() * 0.8;
  nextIn -= dt * anger;
  if (nextIn <= 0 && warns.length < 3) {
    const lead = Math.random() < clamp((state.t - 15) / 40, 0, 0.7) ? 0.6 + Math.random() * 0.4 : 0;
    const fan = !lead && Math.random() < clamp((state.t - 30) / 60, 0, 0.35);
    warn(lead, fan);
    nextIn = Math.max(0.8, 2.4 - state.t * 0.025) * (fan ? 1.5 : 1) * (0.8 + Math.random() * 0.4);
  }

  // warnings: blink, then throw (a window that got knocked out meanwhile throws nothing)
  for (let i = warns.length - 1; i >= 0; i--) {
    const w = warns[i]; w.t += dt;
    const d = camera.position.distanceTo(w.pos);
    const blink = 0.75 + 0.25 * Math.sin(w.t * 26);
    w.sprite.scale.setScalar(d * 0.07 * blink * Math.min(1, w.t * 6));
    if (!S.isStatic(w.p)) { scene.remove(w.sprite); warns.splice(i, 1); state.blocked++; continue; }
    if (w.t >= WARN) { scene.remove(w.sprite); warns.splice(i, 1); throwFrom(w); }
  }

  // thrown things: fly straight, spin, and hit the player if they pass close enough
  const cam = camera.position, R = D * HIT_R;
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.prev.copy(s.pos); s.pos.addScaledVector(s.vel, dt); s.life -= dt;
    s.grow = Math.min(1, s.grow + dt * 4);
    s.obj.position.copy(s.pos); s.obj.rotateOnAxis(s.axis, s.spin * dt);
    // it looms as it comes, but shrinks in the last stretch so it never blanks out the whole screen
    const dc = s.pos.distanceTo(cam);
    s.obj.scale.setScalar(s.base * (0.35 + 0.65 * s.grow) * clamp(dc / (R * 4), 0.3, 1));
    // closest approach on this frame's path
    const seg = _v.subVectors(s.pos, s.prev), l2 = seg.lengthSq();
    const u = l2 > 0 ? clamp(_w.subVectors(cam, s.prev).dot(seg) / l2, 0, 1) : 0;
    const dist = _c.copy(s.prev).addScaledVector(seg, u).distanceTo(cam);
    s.near = Math.min(s.near, dist);
    if (dist < R && inv <= 0 && !state.over) { hit(s); scene.remove(s.obj); shots.splice(i, 1); continue; }
    // gone past the player: a near miss whooshes by
    if (!s.passed && _w.subVectors(s.pos, cam).dot(s.vel) > 0) {
      s.passed = true; state.dodged++;
      if (s.near < R * 3) A.whoosh(s.pos, 0.45);
    }
    if (s.life <= 0) { scene.remove(s.obj); shots.splice(i, 1); }
  }
}
export const counts = () => ({ warns: warns.length, shots: shots.length });
