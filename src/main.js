import * as THREE from 'three';
import { scene, camera, controls, renderer, render, IS_TEST, QUALITY, COARSE, STYLE, updateLights, exposure, fitSunTo, DRS, drsTick } from './engine.js';
import * as terrain from './terrain.js';
import * as B from './blocks.js';
import * as P from './physics.js';
import * as S from './structure.js';
import * as SG from './staticgrid.js';
import * as world from './world.js';
import * as props from './props.js';
import * as FX from './fx.js';
import * as A from './audio.js';
import * as W from './weapons.js';
import * as Score from './score.js';
import * as Replay from './replay.js';
import * as Rank from './rank.js';
import { initLanding, openSheet } from './landing.js';
import { initToyUI } from './toyui.js';
import * as Emblem from './emblem.js';
import * as Fight from './fight.js';
import { clamp } from './util.js';
initLanding({ MAPS: world.MAPS, MAP: world.MAP, won: Score.won }); // first-screen sheets work while the map loads

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- build
const urlMap = new URLSearchParams(location.search).get('map') || world.MAPS[0].id;
try { await world.load(urlMap); } catch (e) { console.error(e); await world.load(world.MAPS[0].id); }
world.build();
fitSunTo(Math.max(0, ...S.buildings.map((b) => b.top || 0)));
props.build();
P.LIMITS.maxAwake = QUALITY.level === 'low' ? 420 : 700;
P.LIMITS.maxBodies = QUALITY.level === 'low' ? 1500 : 2600;

const VIEW_SETS = {
  r5: {
    home: { pos: [60, 110, 290], target: [-8, 45, -30], label: '기본 시점' },
    photo: { pos: [-4.5, 2.4, 71.0], target: [-7.8, 36.6, -22.9], fov: 74, label: '사진 비교 시점 (거리)' },
    aerial: { pos: [240, 330, 250], target: [0, 20, -20], label: '조감 시점' },
    side: { pos: [-260, 70, 60], target: [0, 50, -20], label: '서쪽 측면' },
  },
  zone: {
    home: { pos: [170, 150, 300], target: [-30, 55, -10], label: '기본 시점' },
    aerial: { pos: [250, 430, 320], target: [0, 20, 0], label: '조감 시점' },
    side: { pos: [-330, 95, 140], target: [-40, 60, -20], label: '서쪽 측면' },
    back: { pos: [-60, 120, -330], target: [-30, 50, 0], label: 'R5 정면 (도로 쪽)' },
  },
};
// generic zones frame the focus building (biggest footprint at the address) from three sides
function focusViews(f) {
  const [x, h, z, size] = f; const d = Math.max(220, size * 1.25 + h * 1.5);
  // supertall (롯데월드타워 555 m): stand back level with its middle instead of hovering 1 km up
  if (h > 250) return {
    home: { pos: [x + 760, h * 0.86, z - 480], target: [x - 130, h * 0.52, z - 205], label: '기본 시점' },
    aerial: { pos: [x + 380, h * 0.75, z + 420], target: [x, 40, z], label: '조감 시점' },
    side: { pos: [x - 600, h * 0.4, z + 120], target: [x, h * 0.42, z], label: '측면' },
    back: { pos: [x - 150, h * 0.35, z - 620], target: [x, h * 0.42, z], label: '뒤쪽' },
  };
  // zone 'view' = [x, z] direction of the home camera (default south-east); set where the famous side faces elsewhere
  const [vx, vz] = (world.MAP.doc && world.MAP.doc.view) || [0.6, 0.85];
  return {
    home: { pos: [x + d * vx, h + d * 0.45, z + d * vz], target: [x, h * 0.45, z], label: '기본 시점' },
    aerial: { pos: [x + d * 0.7, h + d * 1.25, z + d * 0.9], target: [x, 10, z], label: '조감 시점' },
    side: { pos: [x - d * 0.95, h + 95, z + d * 0.35], target: [x, h * 0.5, z], label: '측면' },
    back: { pos: [x - d * 0.2, h + 95, z - d], target: [x, h * 0.4, z], label: '뒤쪽' },
  };
}
export const VIEWS = world.MAP.doc ? (world.MAP.doc.id === 'suwon-core' || !world.MAP.doc.focus ? VIEW_SETS.zone : focusViews(world.MAP.doc.focus)) : VIEW_SETS.r5;
const viewOrder = Object.keys(VIEWS);
let viewIdx = 0, baseFov = STYLE.fov;
// views are framed for a 45° lens; a narrower lens (toy style) backs the camera off along the same
// line so the framing stays the same and only the perspective flattens
const LENS = Math.tan(THREE.MathUtils.degToRad(45) / 2) / Math.tan(THREE.MathUtils.degToRad(STYLE.fov) / 2);
export function setView(name) {
  const v = VIEWS[name];
  controls.target.set(...v.target);
  camera.position.set(...v.pos);
  if (!v.fov && LENS !== 1) camera.position.sub(controls.target).multiplyScalar(LENS).add(controls.target);
  baseFov = v.fov || STYLE.fov; camera.fov = baseFov; camera.updateProjectionMatrix();
  controls.update();
}
setView('home');

// ---------------------------------------------------------------- picking
const ray = new THREE.Raycaster();
const _m3 = new THREE.Matrix3();
function rayOBB(o, d, b) {
  // ray in body-local frame
  const inv = b.quat.clone().invert();
  const lo = o.clone().sub(b.pos).applyQuaternion(inv), ld = d.clone().applyQuaternion(inv);
  const r = SG.rayBox(lo, ld, -b.hx, -b.hy, -b.hz, b.hx, b.hy, b.hz);
  if (!r) return null;
  const n = new THREE.Vector3(...r.n).applyQuaternion(b.quat);
  return { t: r.t, n };
}
export function pickRay(o, d) {
  let best = null, bestT = 4000;
  const tt = terrain.raycast(o, d, bestT);
  if (tt >= 0) {
    const p = o.clone().addScaledVector(d, tt);
    const e = 1, gx = terrain.groundY(p.x - e, p.z) - terrain.groundY(p.x + e, p.z), gz = terrain.groundY(p.x, p.z - e) - terrain.groundY(p.x, p.z + e);
    best = { kind: 'terrain', t: tt, point: p, normal: new THREE.Vector3(gx, 2 * e, gz).normalize() }; bestT = tt;
  }
  const s = SG.raycast(o, d, bestT);
  if (s && s.t < bestT) { bestT = s.t; best = { kind: 'static', t: s.t, point: o.clone().addScaledVector(d, s.t), normal: new THREE.Vector3(...s.n), piece: s.piece }; }
  // loose bodies (bounding sphere reject first)
  const oc = new THREE.Vector3();
  for (const b of P.bodies) {
    if (b.cl) continue;
    oc.copy(b.pos).sub(o);
    const along = oc.dot(d);
    if (along < 0 || along - 20 > bestT) continue;
    const r2 = b.hx * b.hx + b.hy * b.hy + b.hz * b.hz;
    if (oc.lengthSq() - along * along > r2) continue;
    const h = rayOBB(o, d, b);
    if (h && h.t < bestT) { bestT = h.t; best = { kind: 'dyn', t: h.t, point: o.clone().addScaledVector(d, h.t), normal: h.n, body: b }; }
  }
  const pr = props.raycast(o, d, bestT);
  if (pr && pr.t < bestT) { bestT = pr.t; best = { kind: 'prop', t: pr.t, point: o.clone().addScaledVector(d, pr.t), normal: new THREE.Vector3(...pr.n), set: pr.set, it: pr.it }; }
  return best;
}
export function pickScreen(x, y) {
  const ndc = new THREE.Vector2((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return pickRay(ray.ray.origin, ray.ray.direction);
}
const DOWN = new THREE.Vector3(0, -1, 0);
function surfaceBelow(x, z, y0) {
  const h = pickRay(new THREE.Vector3(x, y0, z), DOWN);
  return h && h.kind !== 'prop' ? h : (h ? { ...h } : null);
}
W.setSurfaceProbe(surfaceBelow);
function pickNear(x, z, yHint) { const h = surfaceBelow(x, z, Math.max(yHint, 0) + 60); return h ? h.point : null; }

// ---------------------------------------------------------------- UI
// phones (touch screens): the same destruction with fewer loose bodies simulated at once, and the
// physics' crowded-scene shortcuts kicking in earlier, so a big collapse doesn't stall a phone CPU
if (COARSE) Object.assign(P.LIMITS, { maxAwake: 800, maxBodies: 1600, crowded: 160, throttle: 480 });
let tool = 'hammer';
const toolBtns = [...document.querySelectorAll('.tool')];
// the weapon hints are written for a mouse; on touch screens it's a tap, and laser / machine-gun
// rotation is a two-finger drag (see controls.touches below)
const touchHint = (s) => s.replace(/클릭 한 번에/g, '탭 한 번에').replace(/클릭한/g, '탭한').replace(/오른쪽 끌기/g, '두 손가락 끌기');
let TOY = null; // the UI around the game (src/toyui.js), set up once the rest of the page exists
let paused = false; // the toy UI's pause menu is open: the world stands still
function setTool(t) {
  if (t === 'nuke' && Fight.state.on) { toast('반격 모드에서는 핵폭탄을 쓸 수 없어요'); return; }
  tool = t;
  W.setGunVisible(t === 'mg');
  W.setSwordVisible(t === 'sword');
  for (const b of toolBtns) b.classList.toggle('on', b.dataset.tool === t);
  const ht = COARSE ? touchHint(W.TOOLS[t].hint) : W.TOOLS[t].hint;
  $('hint').textContent = Fight.state.on ? ht.replace(/ · (두 손가락|오른쪽 끌기): 회전/, '') : ht; // fight mode: the joystick moves
  $('hint').style.opacity = 1;
  if (TOY) TOY.toolChanged(t);
  if (t === 'laser' || t === 'mg' || t === 'sword') {
    controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: -1, TWO: THREE.TOUCH.DOLLY_ROTATE };
  } else {
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  }
}
for (const b of toolBtns) b.addEventListener('click', (e) => { e.stopPropagation(); setTool(b.dataset.tool); A.blip(660); });
setTool('hammer');

let toastT = 0, bannerT = 0;
function toast(msg) { $('toast').textContent = msg; $('toast').style.opacity = 1; toastT = 1.8; }
function banner(t, s) { $('bannerT').textContent = t; $('bannerS').textContent = s || ''; $('banner').style.opacity = 1; bannerT = 2.6; }
W.ui.toast = toast; W.ui.banner = banner;
let lastAttack = '대기 중';
W.ui.onAttack = (t) => {
  lastAttack = (W.TOOLS[t] ? W.TOOLS[t].name : t) + ' 사용'; $('hint').style.opacity = 0.0; Score.onAttack(t);
  if (!run.done && !run.failed) { run.on = true; run.shots++; run.weapons.add(t); if (t === 'nuke') { run.nuke = true; $('tmTag').textContent = '☢ 핵 사용'; } }
};

// ---------------------------------------------------------------- time attack
// The clock starts with the first attack and stops for good when the map's target buildings are
// fully destroyed (파괴율 100% = 98% of their volume gone: the last stubs of rubble don't count).
// Runs that used the nuke are kept but not ranked (one nuke clears any map in seconds).
const CRUMBLE = 0.03; // a target with ≤3% of its volume standing gives way completely

// floating markers over the target buildings: name + %, they follow what is left standing
const markerBox = document.createElement('div'); markerBox.id = 'markers'; markerBox.className = 'hud'; document.body.appendChild(markerBox);
const markers = new Map();
const _mv3 = new THREE.Vector3(), _mvp = new THREE.Vector3();
let mkMain = null, mkList = null; // one marker per target name (a tower split into parts keeps the tag on its biggest part)
// runs every frame: walks only the buildings that carry a marker, and writes to the DOM only on change
const show = (m, on) => { if (m.on !== on) { m.on = on; m.el.style.display = on ? 'block' : 'none'; } };
// the camera pose and screen the markers were last placed for: with neither changed (and no recalc),
// every marker is already where it should be
const mkCam = new Float64Array(10);
// the viewport size, kept from resize events: reading innerWidth right after a DOM write forces a layout
let vpW = innerWidth, vpH = innerHeight;
addEventListener('resize', () => { vpW = innerWidth; vpH = innerHeight; });
function camMoved() {
  const p = camera.position, q = camera.quaternion, v = [p.x, p.y, p.z, q.x, q.y, q.z, q.w, camera.fov, vpW, vpH];
  let moved = false;
  for (let i = 0; i < 10; i++) if (mkCam[i] !== v[i]) { mkCam[i] = v[i]; moved = true; }
  return moved;
}
function updateMarkers(recalc) {
  if (!mkMain) {
    mkMain = new Map(); for (const b of S.buildings) if (b.target) { const o = mkMain.get(b.name); if (!o || b.vol0 > o.vol0) mkMain.set(b.name, b); }
    mkList = S.buildings.filter((b) => (b.target ? mkMain.get(b.name) === b : b.tag === 'name' || b.tag === 'addr'));
    recalc = true;
  }
  if (!camMoved() && !recalc) return;
  const vw = vpW, vh = vpH;
  for (const b of mkList) {
    let m = markers.get(b);
    if (!m) { m = { el: document.createElement('div'), at: null, on: true, tf: '' }; m.el.className = b.target ? 'mk' : b.tag === 'addr' ? 'mk sub addr' : 'mk sub'; markerBox.appendChild(m.el); markers.set(b, m); }
    if (recalc) {
      m.at = b.cleared || !b.statics.size ? null : S.remainingAnchor(b);
      const left = b.vol0 ? b.volume() / b.vol0 : 0;
      const txt = b.target ? b.name + ' ' + Math.min(99, Math.floor((1 - left) * 100)) + '%' : b.name;
      if (m.txt !== txt) { m.txt = txt; m.el.textContent = txt; }
      if (!b.target && left < 0.35) m.at = null; // named neighbours: tag disappears once mostly down
    }
    if (!m.at) { show(m, false); continue; }
    // neighbours' tags only show up close: test the distance before projecting
    if (!b.target && camera.position.distanceToSquared(_mvp.set(m.at[0], m.at[1], m.at[2])) > (b.tag === 'addr' ? 200 * 200 : 380 * 380)) { show(m, false); continue; }
    _mv3.set(m.at[0], m.at[1] + 10, m.at[2]).project(camera);
    if (_mv3.z > 1 || Math.abs(_mv3.x) > 1.1 || Math.abs(_mv3.y) > 1.1) { show(m, false); continue; }
    show(m, true);
    const tf = `translate(${((_mv3.x + 1) / 2 * vw).toFixed(0)}px,${((1 - _mv3.y) / 2 * vh).toFixed(0)}px) translate(-50%,-100%)`;
    if (tf !== m.tf) { m.tf = tf; m.el.style.transform = tf; }
  }
}
function clearMarkers() { markerBox.textContent = ''; markers.clear(); mkMain = null; mkList = null; }
const run = { on: false, t: 0, done: false, failed: false, fight: false, nuke: false, shots: 0, lastRatio: 0, weapons: new Set() };
const veil = $('veil');
// fight mode: the clock runs from the first throw; a knockout ends the run (not a clear)
Fight.hooks.onStart = () => { if (!run.on && !run.done) { run.on = true; run.fight = true; } banner('건물의 반격!', '빨간 ! 가 뜨면 피하세요'); };
Fight.hooks.onHit = (what, hp) => toast(what + '에 맞았어요 · ❤ ' + hp);
Fight.hooks.onDead = () => {
  run.on = false; run.failed = true;
  reportHits(); Rank.flushHits();
  banner('쓰러졌어요', fmtT(run.t) + ' 버팀');
  setTimeout(() => showResult(), 2200);
};
const qs0 = new URLSearchParams(location.search);
const vsMs = qs0.get('map') === world.MAP.id ? +qs0.get('vs') || 0 : 0; // challenge link: a friend's time to beat (same map only)
const fmtT = (sec) => { const m = Math.floor(sec / 60), s = sec - m * 60; return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0'); };
{ const n = S.buildings.filter((b) => b.target).length; $('pctLbl').textContent = n ? '목표 건물 파괴율' : '파괴율'; }
if (vsMs) $('tmVs').textContent = '도전: ' + fmtT(vsMs / 1000);
function runReset() {
  Object.assign(run, { on: false, t: 0, done: false, failed: false, fight: Fight.state.on, nuke: false, shots: 0, lastRatio: 0, submitted: false, weapons: new Set(), newEmb: null });
  $('tm').textContent = fmtT(0); $('tmTag').textContent = ''; $('timer').classList.remove('done');
  Replay.reset();
}
// per-map damage pot for "가장 많이 부서진 곳": the score delta since the last report
let hitsAt = 0;
function reportHits(clear = false) {
  const s = Score.state.score;
  if (s < hitsAt) hitsAt = 0; // score was reset (restore / new run)
  const d = s - hitsAt; hitsAt = s;
  if (d > 0 || clear) Rank.addHits(world.MAP.id, d, clear);
}
// Every /api call is a paid-plan Worker request (free plan: 100k a day), so damage is sent at most every 3 min;
// unsent damage stays in localStorage and goes with the next send.
setInterval(() => { reportHits(); Rank.flushHits(); }, 180000);
Rank.flushHits();
let hidAt = 0;
addEventListener('pagehide', () => { reportHits(); Rank.flushHits(true); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && Date.now() - hidAt > 60000) { hidAt = Date.now(); reportHits(); Rank.flushHits(true); } });
function runComplete() {
  reportHits(!run.nuke); Rank.flushHits();
  run.done = true; run.on = false;
  $('timer').classList.add('done'); $('tm').textContent = fmtT(run.t);
  banner('완파!', fmtT(run.t) + (run.nuke ? ' · 핵 사용' : '') + (run.fight ? ' · ❤ ' + Fight.state.hp : ''));
  // fight-mode runs don't count for the time records and emblems
  run.newEmb = run.fight ? null : Emblem.onClear({ map: world.MAP.id, sec: run.t, shots: run.shots, nuke: run.nuke, weapon: singleWeapon() }, world.MAPS);
  setTimeout(() => embPop(run.newEmb), 2600);
  Replay.trigger(4.5, true);
  if (TOY) TOY.onComplete();
  setTimeout(() => showResult(), 5200);
}

// ---------------------------------------------------------------- score hooks
function popup(label, value, up) {
  const box = $('ledger'); const d = document.createElement('div'); if (up) d.className = 'up';
  const l = document.createElement('span'); l.textContent = label; const v = document.createElement('b'); v.textContent = value;
  d.append(l, v); box.appendChild(d);
  while (box.children.length > 5) box.firstChild.remove();
  setTimeout(() => d.remove(), 2100);
}
Score.ui.popup = popup;
Score.ui.rankUp = (r) => { if (Score.rankInfo().id === '회장') { const g = Emblem.award('c_chair'); if (g) embPop([g]); } const el = $('rk'); el.classList.remove('flip'); void el.offsetWidth; el.classList.add('flip'); A.blip(520 + Score.state.rank * 70); };
{
  const prevCollapse = S.events.collapse;
  S.events.collapse = (b, bb) => { if (prevCollapse) prevCollapse(b, bb); Score.bonus(20000, '연쇄 붕괴', 45); if (b.target && !run.done) Replay.trigger(7); };
  const prevLanded = P.hooks.clusterLanded;
  P.hooks.clusterLanded = (cl) => { if (prevLanded) prevLanded(cl); if (cl.list.length > 30) Score.bonus(Math.min(60000, cl.list.length * 150), '상층부 낙하', 40); };
  const prevVanish = props.hooks.vanish;
  props.hooks.vanish = (set, it) => { if (prevVanish) prevVanish(set, it); Score.propHit(set.name); };
  const prevKnock = props.hooks.knock;
  props.hooks.knock = (set, it, b) => { if (prevKnock) prevKnock(set, it, b); Score.propHit(set.name); };
}
let lastLostVol = 0;
function lostVolume() { let v = 0; for (const b of S.buildings) v += Math.max(0, b.vol0 - b.volume()); return v; }
function scoreTick() {
  const lost = lostVolume();
  if (lost > lastLostVol) Score.damage(lost - lastLostVol);
  lastLostVol = lost;
  for (const b of S.buildings) if (b.vol0 > 0 && b.volume() < b.vol0 * 0.15) Score.buildingCollapsed(b.name);
}
// HUD writes only when the value changed: every write invalidates the page's style and layout
const setText = (id, t) => { const e = $(id); if (e.textContent !== t) e.textContent = t; };
const setStyle = (id, k, v) => { const e = $(id); if (e.style[k] !== v) e.style[k] = v; };
function scoreHud() {
  const st = Score.state, r = Score.rankInfo(), nx = Score.nextRank();
  setText('rk', r.id);
  setStyle('score', 'color', r.color);
  setText('rn', nx ? '다음 · ' + nx.id : '최고 직급');
  setText('sv', Score.won(st.score));
  setStyle('gb', 'width', (Score.gaugeFrac() * 100).toFixed(1) + '%');
  setText('mul', '×' + (r.mult * st.toolMult).toFixed(2));
  setText('best', '최고 ' + Score.won(st.best));
}

function cycleView() { viewIdx = (viewIdx + 1) % viewOrder.length; setView(viewOrder[viewIdx]); toast(VIEWS[viewOrder[viewIdx]].label); }
function toggleSound() { A.setMuted(!A.isMuted()); }

addEventListener('keydown', (e) => {
  if (e.repeat || (e.target && e.target.tagName === 'INPUT')) return;
  const k = e.key.toLowerCase();
  const map = { 1: 'mg', 2: 'hammer', 3: 'bomb', 4: 'missile', 5: 'laser', 6: 'meteor', 7: 'nuke', 8: 'sword' };
  if (map[k]) setTool(map[k]);
  else if (k === 'r') resetWorld();
  else if (k === 'v') cycleView();
  else if (k === 'm') toggleSound();
  else if (k === 'escape' && drawing) cancelLaser();
  else if (k === 'escape') { if ($('veil').classList.contains('hide')) openVeil(); else closeVeil(); }
});

// ---------------------------------------------------------------- pointer input
const cross = $('cross');
const canvas = renderer.domElement;
let down = null, drawing = null, firing = false, aimAcc = 0, swipe = null;
// sword taps chain strokes in turn: → ← ↘ ↙ ↓ ↗ (screen angle in degrees, 0 = left to right, 90 = downward),
// a little off each time; a pause of over 1.2 s starts the chain again
const COMBO = [-6, 186, 35, 145, 88, -35];
let combo = 0, comboT = 0;
// sword: a white line follows the swipe until release
const slashLine = document.createElement('div'); slashLine.id = 'slashLine';
slashLine.style.cssText = 'position:fixed;left:0;top:0;height:4px;margin-top:-2px;border-radius:2px;background:#fff;box-shadow:0 0 8px rgba(255,255,255,.9),0 0 2px rgba(0,0,0,.35);transform-origin:0 50%;pointer-events:none;display:none;z-index:5';
document.body.appendChild(slashLine);
function drawSlashLine(x0, y0, x1, y1) {
  if (x0 == null) { slashLine.style.display = 'none'; return; }
  slashLine.style.display = 'block'; slashLine.style.width = Math.hypot(x1 - x0, y1 - y0) + 'px';
  slashLine.style.transform = `translate(${x0}px,${y0}px) rotate(${Math.atan2(y1 - y0, x1 - x0)}rad)`;
}
function crossAt(x, y, bad) { cross.style.display = 'block'; cross.style.left = x + 'px'; cross.style.top = y + 'px'; cross.classList.toggle('bad', !!bad); }
canvas.addEventListener('pointerdown', (e) => {
  A.init();
  down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button, id: e.pointerId, multi: false };
  if (tool === 'mg' && e.button === 0 && e.isPrimary) {
    const h = pickScreen(e.clientX, e.clientY);
    if (h) { W.gunStart(h); firing = true; }
    crossAt(e.clientX, e.clientY, !h);
    return;
  }
  if (tool === 'sword' && e.button === 0 && e.isPrimary) { swipe = { x: e.clientX, y: e.clientY }; crossAt(e.clientX, e.clientY, false); return; }
  if (tool === 'laser' && e.button === 0 && e.isPrimary) {
    drawing = new W.LaserPath();
    const h = pickScreen(e.clientX, e.clientY);
    if (h && h.kind !== 'prop') drawing.add(h.point, h.normal);
    crossAt(e.clientX, e.clientY, !h);
  }
});
let hoverAcc = 0;
canvas.addEventListener('pointermove', (e) => {
  if (down && e.pointerId !== down.id) down.multi = true;
  if (firing) {
    const now = performance.now();
    if (now - aimAcc > 30) { aimAcc = now; const h = pickScreen(e.clientX, e.clientY); if (h) W.gunAim(h); crossAt(e.clientX, e.clientY, !h); }
    return;
  }
  if (swipe && !down?.multi) { drawSlashLine(swipe.x, swipe.y, e.clientX, e.clientY); crossAt(e.clientX, e.clientY, false); return; }
  if (drawing) {
    const h = pickScreen(e.clientX, e.clientY);
    // only real surfaces are recorded: pointing at the sky adds nothing
    if (h && h.kind !== 'prop') drawing.add(h.point, h.normal);
    crossAt(e.clientX, e.clientY, !h);
    return;
  }
  if (e.pointerType === 'mouse' && !down) {
    const now = performance.now();
    if (now - hoverAcc > 40) { hoverAcc = now; crossAt(e.clientX, e.clientY, !pickScreen(e.clientX, e.clientY)); }
  }
});
function cancelLaser() { if (drawing) { drawing.dispose(); drawing = null; } }
addEventListener('pointercancel', () => { if (firing) { W.gunStop(); firing = false; } swipe = null; drawSlashLine(null); });
addEventListener('blur', () => { if (firing) { W.gunStop(); firing = false; } });
addEventListener('pointerup', (e) => {
  if (firing) { W.gunStop(); firing = false; }
  if (!down || e.pointerId !== down.id) return;
  if (tool === 'mg') { down = null; return; }
  if (swipe) {
    const s = swipe; swipe = null; drawSlashLine(null);
    if (!down.multi) {
      // a swipe cuts along itself; a tap cuts a short stroke through the tapped point (direction: COMBO)
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 24) W.slash(s.x, s.y, e.clientX, e.clientY);
      else {
        const now = performance.now(); if (now - comboT > 1200) combo = 0; comboT = now;
        const ang = THREE.MathUtils.degToRad(COMBO[combo++ % COMBO.length] + (Math.random() - 0.5) * 12);
        const r = Math.min(innerWidth, innerHeight) * 0.18, dx = Math.cos(ang) * r, dy = Math.sin(ang) * r;
        W.slash(s.x - dx, s.y - dy, s.x + dx, s.y + dy);
      }
    }
    down = null; return;
  }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dur = performance.now() - down.t;
  if (drawing) {
    const path = drawing; drawing = null;
    if (path.pts.length) W.fireLaser(path); else { path.dispose(); toast('건물이나 땅 위에서 그어 주세요'); }
  } else if (down.button === 0 && moved < 8 && dur < 700 && !down.multi && e.target === canvas) {
    const h = pickScreen(e.clientX, e.clientY);
    if (!h) { toast('하늘은 조준할 수 없습니다'); crossAt(e.clientX, e.clientY, true); }
    else W.fire(tool, h, pickNear);
  }
  down = null;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------------------------------------------------------------- reset
function resetWorld() {
  cancelLaser();
  if (W.W_cine.active) { /* the meteor shot owns the camera; give it back */ }
  W.reset();
  P.reset();
  B.clearAll();
  SG.clear();
  S.reset();
  FX.reset();
  world.build();
  props.reset();
  Score.reset(); lastLostVol = 0;
  Fight.reset();
  runReset(); clearMarkers();
  FX.cam.trauma = 0; FX.cam.hitstop = 0; FX.cam.slowmo = 1;
  exposure.dip = 0; exposure.boost = 0;
  toast('월드를 복원했습니다');
}

// ---------------------------------------------------------------- loop
let hudAcc = 0, fpsAcc = 0, fpsN = 0, fps = 60;
const perf = { stepMs: 0, frameMs: 0 };
function simulate(realDt) {
  let dt = realDt;
  if (FX.cam.hitstop > 0) { FX.cam.hitstop -= realDt; dt = realDt * 0.04; }
  FX.cam.slowmo += (1 - FX.cam.slowmo) * Math.min(1, realDt * 1.6);
  dt *= FX.cam.slowmo;
  const t0 = performance.now();
  W.update(dt);
  Fight.update(dt, veil.classList.contains('hide') && !document.hidden && !run.done && !run.failed);
  const t1 = performance.now();
  if (dt > 1e-4) P.step(dt);
  const t2 = performance.now();
  S.update();
  const t3 = performance.now();
  terrain.update(dt);
  B.coolDown(dt);
  const t4 = performance.now();
  FX.update(dt);
  updateLights(dt);
  const t5 = performance.now();
  perf.stepMs = t5 - t0;
  const pa = perf.acc || (perf.acc = { weapons: 0, physics: 0, structure: 0, terrain: 0, fx: 0, n: 0 });
  pa.weapons += t1 - t0; pa.physics += t2 - t1; pa.structure += t3 - t2; pa.terrain += t4 - t3; pa.fx += t5 - t4; pa.n++;
}
// ---------------------------------------------------------------- free movement
// WASD / arrow keys on desktop (two fingers on touch screens move the view): slide the camera and its
// orbit point together across the ground, in the direction the camera faces.
const moveKeys = new Set();
addEventListener('keydown', (e) => { if (e.target && e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase(); if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'].includes(k)) moveKeys.add(k); });
addEventListener('keyup', (e) => moveKeys.delete(e.key.toLowerCase()));
addEventListener('blur', () => moveKeys.clear());
const _fw = new THREE.Vector3(), _rt = new THREE.Vector3(), _mv = new THREE.Vector3();
function moveCamera(dt) {
  if (Fight.state.on) { Fight.move(dt, moveKeys); return; } // fight mode: around the building at a set distance
  let f = 0, r = 0, u = 0;
  if (moveKeys.has('w') || moveKeys.has('arrowup')) f += 1;
  if (moveKeys.has('s') || moveKeys.has('arrowdown')) f -= 1;
  if (moveKeys.has('d') || moveKeys.has('arrowright')) r += 1;
  if (moveKeys.has('a') || moveKeys.has('arrowleft')) r -= 1;
  if (moveKeys.has('e')) u += 1;
  if (moveKeys.has('q')) u -= 1;
  if (!f && !r && !u) return;
  camera.getWorldDirection(_fw); _fw.y = 0; _fw.normalize();
  _rt.crossVectors(_fw, camera.up).normalize();
  const dist = camera.position.distanceTo(controls.target);
  const speed = clamp(dist * 0.45, 18, 260) * dt;
  _mv.set(0, 0, 0).addScaledVector(_fw, f * speed).addScaledVector(_rt, r * speed);
  _mv.y = u * speed * 0.6;
  // keep the orbit point over the playable area
  const t = controls.target.clone().add(_mv);
  t.x = clamp(t.x, -620, 620); t.z = clamp(t.z, -620, 620); t.y = clamp(t.y, 0, 400);
  _mv.subVectors(t, controls.target);
  controls.target.add(_mv); camera.position.add(_mv);
}

// The views are framed for landscape screens. FOV is vertical, so on a portrait phone (aspect ~0.46)
// 45° leaves barely 22° across and the buildings fall off the sides: widen the vertical FOV until
// the horizontal coverage matches a 1.25:1 screen, capped at 72° to keep edge distortion mild.
const H_MIN = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(STYLE.fov) / 2) * 1.25);
// the camera stands ~1.45x farther back, so a 50° cap covers about as much width as 72° does
// at the normal distance while keeping the flatter miniature perspective
const FOV_CAP = 50;
function fitFov(f) {
  const need = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(H_MIN / 2) / camera.aspect));
  return Math.max(f, Math.min(need, FOV_CAP));
}
function draw(realDt) {
  B.flushGPU();
  moveCamera(realDt);
  controls.update();
  const gy = terrain.groundY(camera.position.x, camera.position.z);
  if (camera.position.y < gy + 1.5) camera.position.y = gy + 1.5;
  const { off } = FX.applyCamera(realDt);
  camera.position.add(off);
  const f = fitFov(baseFov) + FX.cam.fovPunch;
  if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); }
  render();
  camera.position.sub(off);
}
function hud(dt) {
  hudAcc += dt;
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').style.opacity = 0; }
  if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) $('banner').style.opacity = 0; }
  Score.update(dt);
  if (hudAcc < 0.25) return;
  hudAcc = 0;
  scoreTick(); scoreHud();
  // 파괴율 = the map's target buildings only (marked on screen). A target that is down to its last
  // few percent crumbles completely; 100% only when every target has no standing part left.
  const tg = S.targets();
  let cleared = 0;
  for (const b of tg) {
    if (!b.cleared && b.vol0 > 0 && b.volume() <= b.vol0 * CRUMBLE) {
      S.crumble(b); b.cleared = true;
      if (run.on || run.done) { toast(b.name + ' 완파!'); Replay.trigger(5); }
    }
    if (b.cleared || !b.statics.size) cleared++;
  }
  const raw = S.targetRatio();
  // a big jump in one tick = something large is coming down: record it
  if (raw - run.lastRatio > 0.06 && run.on && !run.done) Replay.trigger(6);
  run.lastRatio = raw;
  const all = cleared === tg.length;
  const pct = all ? 100 : Math.min(99, raw * 100);
  setText('pct', (pct < 10 ? pct.toFixed(1) : Math.floor(pct)) + '%');
  setStyle('pctbar', 'width', clamp(pct, 0, 100) + '%');
  if (all && run.on && !run.done) runComplete();
  setText('fallen', `목표 ${cleared}/${tg.length}동 · 전체 ${Math.floor(S.destructionRatio() * 100)}%`);
  updateMarkers(true);
  setText('combo', lastAttack);
}
let last = performance.now(), tmAcc = 0;
function runTick(dt) {
  if (paused || !run.on || run.done || !$('veil').classList.contains('hide') || document.hidden) return;
  run.t += dt; tmAcc += dt;
  if (tmAcc > 0.1) { tmAcc = 0; $('tm').textContent = fmtT(run.t); }
}
function frame(now) {
  const t0 = performance.now(), gap = (now - last) / 1000;
  const realDt = Math.min(0.05, gap); last = now;
  if (!paused) simulate(realDt);
  draw(realDt);
  updateMarkers(false);
  Replay.tick(renderer.domElement, { map: world.MAP.title, time: fmtT(run.t) });
  runTick(realDt);
  hud(realDt);
  fpsAcc += realDt; fpsN++;
  if (fpsAcc > 1) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  drsTick(gap, performance.now() - t0);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
const startBtn = $('startBtn');
// the button says 불러오는 중… (index.html) until the shaders are ready and the loop runs (see W.warmup below)
const enableStart = () => { startBtn.disabled = false; if (startBtn.textContent === '불러오는 중…') startBtn.textContent = '파괴 시작'; };
if (IS_TEST) enableStart();
startBtn.addEventListener('click', () => { A.init(); $('veil').classList.add('hide'); });
function openVeil() { cancelLaser(); $('veil').classList.remove('hide'); startBtn.textContent = '계속하기'; }
function closeVeil() { $('veil').classList.add('hide'); }
// index.html is served as a static file (no Worker), so the per-map canonical link is set here
{ const id = new URLSearchParams(location.search).get('map'); const c = document.createElement('link'); c.rel = 'canonical';
  c.href = 'https://companysmash.com/' + (id && world.MAP.id === id ? '?map=' + id : ''); document.head.appendChild(c); }
if (new URLSearchParams(location.search).has('map') && !/ 부수기 - /.test(document.title)) document.title = world.MAP.title.replace(/\s*\(.*\)$/, '') + ' 부수기 · ' + document.title; // per-map search title (e.g. 'SK하이닉스 이천캠퍼스 부수기')
if (IS_TEST) $('veil').classList.add('hide');
if (new URLSearchParams(location.search).has('clean')) document.body.classList.add('clean');

// ---------------------------------------------------------------- emblems
const toolSvg = (t) => { const b = document.querySelector(`.tool[data-tool="${t}"] svg`); return b ? b.innerHTML : ''; };
const embDefs = Emblem.defs(world.MAPS);
const embById = Object.fromEntries(embDefs.map((d) => [d.id, d]));
function embEl(def, tier) {
  const el = document.createElement('div'); el.className = 'emb' + (tier ? '' : ' off');
  el.innerHTML = Emblem.badge(def, tier, toolSvg);
  const b = document.createElement('b'); b.textContent = def.title; el.appendChild(b);
  if (def.tiered && tier) { const t = document.createElement('span'); t.className = 't'; t.style.color = Emblem.TIER[tier].c; t.textContent = Emblem.TIER[tier].n; el.appendChild(t); }
  const i = document.createElement('i'); i.textContent = def.desc; el.appendChild(i);
  return el;
}
function renderEmblems() {
  const own = Emblem.owned(), grid = $('embGrid'); grid.textContent = '';
  let n = 0;
  for (const g of [...new Set(embDefs.map((d) => d.group))]) {
    const h = document.createElement('div'); h.className = 'grp'; h.textContent = g; grid.appendChild(h);
    const row = document.createElement('div'); row.className = 'row';
    for (const d of embDefs.filter((x) => x.group === g)) { const t = own[d.id] ? own[d.id].tier : 0; if (t) n++; row.appendChild(embEl(d, t)); }
    grid.appendChild(row);
  }
  $('embCount').textContent = `${n} / ${embDefs.length}`;
}
let embPopT = 0;
function embPop(list) {
  if (!list.length) return;
  const r = list[0], d = embById[r.id]; if (!d) return;
  const el = $('embPop'); el.innerHTML = Emblem.badge(d, r.tier, toolSvg);
  const t = document.createElement('div'); t.textContent = d.title; const s = document.createElement('small'); s.textContent = (r.upgraded ? '엠블럼 승급! ' : '엠블럼 획득! ') + (d.tiered ? Emblem.TIER[r.tier].n : '') + (list.length > 1 ? ` 외 ${list.length - 1}개` : ''); t.prepend(s); el.appendChild(t);
  el.style.opacity = 1; clearTimeout(embPopT); embPopT = setTimeout(() => { el.style.opacity = 0; }, 3200);
  A.blip(880);
}
function openEmblems() { renderEmblems(); $('embPanel').classList.add('show'); }
$('embClose').addEventListener('click', () => $('embPanel').classList.remove('show'));
$('embPanel').addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === $('embPanel')) $('embPanel').classList.remove('show'); });

// ---------------------------------------------------------------- result / ranking / sharing
Replay.init();
const singleWeapon = () => (run.weapons.size === 1 ? [...run.weapons][0] : null);
const BOARD_NAME = { all: '종합', mg: '기관총', hammer: '망치', bomb: '폭탄', missile: '미사일', laser: '레이저', meteor: '운석', sword: '칼', hits: '🏢 회사 파괴 랭킹' };
function shareText() {
  const url = new URL(location.href); url.search = ''; url.searchParams.set('map', world.MAP.id);
  if (run.fight) url.searchParams.set('mode', 'fight');
  else if (run.done && !run.nuke) url.searchParams.set('vs', Math.round(run.t * 1000));
  return [
    '회사부수기 · ' + world.MAP.title + (run.fight ? ' · ⚔️ 반격 모드' : ''),
    ...(run.fight ? [(run.failed ? '😵 쓰러짐' : '💥 완파') + ' ⏱ ' + fmtT(run.t) + ' · ❤ ' + Fight.state.hp + ' / ' + Fight.state.max + ' · 피한 공격 ' + Fight.state.dodged + '개'] : []),
    ...(run.fight ? [] : [(run.done ? '💥 완파 ⏱ ' + fmtT(run.t) : '💥 파괴율 ' + $('pct').textContent + ' ⏱ ' + fmtT(run.t)) + (singleWeapon() && BOARD_NAME[singleWeapon()] ? ' · ' + BOARD_NAME[singleWeapon()] + '만' : '') + ' · 공격 ' + run.shots + '회' + (run.nuke ? ' · ☢' : '')]),
    '💰 피해액 ' + Score.won(Score.state.score) + ' · 직급 ' + Score.rankInfo().id,
    (run.done && !run.nuke && !run.fight ? '👉 이 기록 깨 보기: ' : '👉 ') + url.toString(),
  ].join('\n');
}
function showResult() { return TOY.showResult(); }
/** the latest collapse clip: share it where the device can, else download it */
async function saveClip() {
  const c = Replay.latest(); if (!c) return;
  const fname = `회사부수기_${world.MAP.id}_${fmtT(run.t).replace(/[:.]/g, '')}.${c.ext}`;
  const file = new File([c.blob], fname, { type: c.blob.type });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: shareText() }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = c.url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
}
if (vsMs) toast('친구 기록 ' + fmtT(vsMs / 1000) + ' — 이겨 보세요!');

// test / debugging hooks (deterministic stepping when ?test=1)
TOY = initToyUI({ world, Score, Rank, Emblem, W, Replay, run, fmtT, toast, resetWorld, shareText, COARSE,
  setPaused: (v) => { paused = v; }, isMuted: () => A.isMuted(), cycleView, toggleSound, openEmblems, openVeil, openSheet, saveClip, Fight,
  setFight: (v) => { const started = run.on || run.done || run.failed; Fight.setOn(v); if (v && tool === 'nuke') setTool('hammer'); if (started) resetWorld(); else runReset(); setTool(tool); } });
setTool(tool); // again, now with the toy UI's short hints
window.SMASH = {
  THREE, scene, camera, controls, renderer, QUALITY, DRS, terrain, B, P, S, SG, props, FX, W, Fight, setView, pickScreen, pickRay,
  setFov(f) { baseFov = f; },
  setTool, resetWorld, VIEWS, Score, Emblem, renderEmblems, run, Replay, Rank, showResult, shareText,
  advance(sec, step = 1 / 60) { const n = Math.round(sec / step); for (let i = 0; i < n; i++) simulate(step); },
  play(sec, step = 1 / 30, drawEvery = 0) { const n = Math.round(sec / step); for (let i = 0; i < n; i++) { simulate(step); runTick(step); if (drawEvery && i % drawEvery === 0) { draw(step); Replay.tick(renderer.domElement, { map: world.MAP.title, time: fmtT(run.t) }); } hudAcc = 1; hud(step); } },
  frame(dt = 1 / 60) { draw(dt); hudAcc = 1; hud(dt); },
  hud(dt = 1 / 60) { hudAcc = 1; hud(dt); },
  gunWorld(x, y, z, sec) { const h = surfaceBelow(x, z, y); if (!h) return null; W.gunStart(h); return h.point.toArray(); },
  gunStop() { W.gunStop(); },
  slashScreen(x0, y0, x1, y1) { return !!W.slash(x0, y0, x1, y1); },
  fireAt(t, x, y) { const h = pickScreen(x, y); if (!h) return null; W.fire(t, h, pickNear); return { kind: h.kind, point: h.point.toArray() }; },
  fireWorld(t, x, y, z) { const h = surfaceBelow(x, z, y); if (!h) return null; W.fire(t, h, pickNear); return { kind: h.kind, point: h.point.toArray() }; },
  laserScreen(points) { const p = new W.LaserPath(); let miss = 0; for (const [x, y] of points) { const h = pickScreen(x, y); if (h && h.kind !== 'prop') p.add(h.point, h.normal); else miss++; } const n = p.pts.length; W.fireLaser(p); return { recorded: n, missed: miss }; },
  stats() {
    let statics = 0; for (const b of S.buildings) statics += b.statics.size;
    return { blocks: B.stats(), statics, bodies: P.bodies.size, awake: P.awakeCount(), clusters: P.clusters.length, fx: FX.counts(), weapons: { ...W.stats }, actions: W.actions.length, destruction: +(S.destructionRatio() * 100).toFixed(2), score: Score.state.score, rank: Score.rankInfo().id, fps: Math.round(fps), perf: { ...perf } };
  },
};
// the loop starts once every shader is compiled and has been drawn once (W.warmup): the start card is up
// meanwhile, so nothing is missed, and no frame stalls later on a first use. Tests step frames themselves.
if (!IS_TEST) { const go = () => { performance.mark('loop-start'); enableStart(); if (TOY) TOY.ready(); requestAnimationFrame((t) => { last = t; frame(t); }); }; W.warmup(renderer).then(go, go); }
window.__ready = true;
