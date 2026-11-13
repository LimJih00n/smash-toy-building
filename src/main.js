import * as THREE from 'three';
import { scene, camera, controls, renderer, render, IS_TEST, QUALITY, updateLights, exposure, fitSunTo } from './engine.js';
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
import { renderSupport } from './site.js';
import { initLanding, wishVote } from './landing.js';
import * as Emblem from './emblem.js';
import { clamp } from './util.js';
initLanding({ MAPS: world.MAPS, MAP: world.MAP, won: Score.won }); // first-screen sheets work while the map loads

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- build
const urlMap = new URLSearchParams(location.search).get('map') || world.MAPS[0].id;
try { await world.load(urlMap); } catch (e) { console.error(e); await world.load(world.MAPS[0].id); }
world.build();
fitSunTo(Math.max(0, ...S.buildings.map((b) => b.top || 0)));
props.build();
props.buildSkyline();
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
let viewIdx = 0, baseFov = 45;
export function setView(name) {
  const v = VIEWS[name];
  camera.position.set(...v.pos);
  controls.target.set(...v.target);
  baseFov = v.fov || 45; camera.fov = baseFov; camera.updateProjectionMatrix();
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
let tool = 'hammer';
const toolBtns = [...document.querySelectorAll('.tool')];
function setTool(t) {
  tool = t;
  W.setGunVisible(t === 'mg');
  for (const b of toolBtns) b.classList.toggle('on', b.dataset.tool === t);
  $('hint').textContent = W.TOOLS[t].hint;
  $('hint').style.opacity = 1;
  if (t === 'laser' || t === 'mg') {
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
  if (!run.done) { run.on = true; run.shots++; run.weapons.add(t); if (t === 'nuke') { run.nuke = true; $('tmTag').textContent = '☢ 핵 사용'; } }
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
let mkMain = null; // one marker per target name (a tower split into parts keeps the tag on its biggest part)
function updateMarkers(recalc) {
  if (!mkMain) { mkMain = new Map(); for (const b of S.buildings) if (b.target) { const o = mkMain.get(b.name); if (!o || b.vol0 > o.vol0) mkMain.set(b.name, b); } }
  for (const b of S.buildings) {
    if (!b.target && b.tag !== 'name' && b.tag !== 'addr') continue;
    if (b.target && mkMain.get(b.name) !== b) continue;
    let m = markers.get(b);
    if (!m) { m = { el: document.createElement('div'), at: null }; m.el.className = b.target ? 'mk' : b.tag === 'addr' ? 'mk sub addr' : 'mk sub'; markerBox.appendChild(m.el); markers.set(b, m); }
    if (recalc) {
      m.at = b.cleared || !b.statics.size ? null : S.remainingAnchor(b);
      const left = b.vol0 ? b.volume() / b.vol0 : 0;
      m.el.textContent = b.target ? b.name + ' ' + Math.min(99, Math.floor((1 - left) * 100)) + '%' : b.name;
      if (!b.target && left < 0.35) m.at = null; // named neighbours: tag disappears once mostly down
    }
    if (!m.at) { m.el.style.display = 'none'; continue; }
    _mv3.set(m.at[0], m.at[1] + 10, m.at[2]).project(camera);
    if (_mv3.z > 1 || Math.abs(_mv3.x) > 1.1 || Math.abs(_mv3.y) > 1.1) { m.el.style.display = 'none'; continue; }
    if (!b.target && camera.position.distanceTo(_mvp.set(m.at[0], m.at[1], m.at[2])) > (b.tag === 'addr' ? 200 : 380)) { m.el.style.display = 'none'; continue; }
    m.el.style.display = 'block';
    m.el.style.transform = `translate(${((_mv3.x + 1) / 2 * innerWidth).toFixed(0)}px,${((1 - _mv3.y) / 2 * innerHeight).toFixed(0)}px) translate(-50%,-100%)`;
  }
}
function clearMarkers() { markerBox.textContent = ''; markers.clear(); mkMain = null; }
const run = { on: false, t: 0, done: false, nuke: false, shots: 0, lastRatio: 0, weapons: new Set() };
const qs0 = new URLSearchParams(location.search);
const vsMs = qs0.get('map') === world.MAP.id ? +qs0.get('vs') || 0 : 0; // challenge link: a friend's time to beat (same map only)
const fmtT = (sec) => { const m = Math.floor(sec / 60), s = sec - m * 60; return String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0'); };
{ const n = S.buildings.filter((b) => b.target).length; $('pctLbl').textContent = n ? '목표 건물 파괴율' : '파괴율'; }
if (vsMs) $('tmVs').textContent = '도전: ' + fmtT(vsMs / 1000);
function runReset() {
  Object.assign(run, { on: false, t: 0, done: false, nuke: false, shots: 0, lastRatio: 0, submitted: false, weapons: new Set(), newEmb: null });
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
  banner('완파!', fmtT(run.t) + (run.nuke ? ' · 핵 사용' : ''));
  run.newEmb = Emblem.onClear({ map: world.MAP.id, sec: run.t, shots: run.shots, nuke: run.nuke, weapon: singleWeapon() }, world.MAPS);
  setTimeout(() => embPop(run.newEmb), 2600);
  Replay.trigger(4.5, true);
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
function scoreHud() {
  const st = Score.state, r = Score.rankInfo(), nx = Score.nextRank();
  const rk = $('rk'); if (rk.textContent !== r.id) rk.textContent = r.id;
  $('score').style.color = r.color;
  $('rn').textContent = nx ? '다음 · ' + nx.id : '최고 직급';
  $('sv').textContent = Score.won(st.score);
  $('gb').style.width = (Score.gaugeFrac() * 100).toFixed(1) + '%';
  $('mul').textContent = '×' + (r.mult * st.toolMult).toFixed(2);
  $('best').textContent = '최고 ' + Score.won(st.best);
}

$('bView').addEventListener('click', () => { viewIdx = (viewIdx + 1) % viewOrder.length; setView(viewOrder[viewIdx]); toast(VIEWS[viewOrder[viewIdx]].label); });
$('bReset').addEventListener('click', () => resetWorld());
$('bSound').addEventListener('click', () => { A.setMuted(!A.isMuted()); $('bSound').textContent = A.isMuted() ? '🔇' : '🔊'; });

addEventListener('keydown', (e) => {
  if (e.repeat || (e.target && e.target.tagName === 'INPUT')) return;
  const k = e.key.toLowerCase();
  const map = { 1: 'mg', 2: 'hammer', 3: 'bomb', 4: 'missile', 5: 'laser', 6: 'meteor', 7: 'nuke' };
  if (map[k]) setTool(map[k]);
  else if (k === 'r') resetWorld();
  else if (k === 'v') $('bView').click();
  else if (k === 'm') $('bSound').click();
  else if (k === 'escape' && drawing) cancelLaser();
  else if (k === 'escape') { if ($('veil').classList.contains('hide')) openVeil(); else closeVeil(); }
});

// ---------------------------------------------------------------- pointer input
const cross = $('cross');
const canvas = renderer.domElement;
let down = null, drawing = null, firing = false, aimAcc = 0;
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
addEventListener('pointercancel', () => { if (firing) { W.gunStop(); firing = false; } });
addEventListener('blur', () => { if (firing) { W.gunStop(); firing = false; } });
addEventListener('pointerup', (e) => {
  if (firing) { W.gunStop(); firing = false; }
  if (!down || e.pointerId !== down.id) return;
  if (tool === 'mg') { down = null; return; }
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
// WASD / arrow keys on desktop, a thumb joystick on touch screens: slide the camera and its
// orbit point together across the ground, in the direction the camera faces.
const moveKeys = new Set();
const joyV = { x: 0, y: 0 };
addEventListener('keydown', (e) => { if (e.target && e.target.tagName === 'INPUT') return; const k = e.key.toLowerCase(); if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q', 'e'].includes(k)) moveKeys.add(k); });
addEventListener('keyup', (e) => moveKeys.delete(e.key.toLowerCase()));
addEventListener('blur', () => moveKeys.clear());
{
  const joy = $('joy'), knob = joy.querySelector('i');
  let id = null, cx = 0, cy = 0;
  const set = (x, y) => {
    let dx = x - cx, dy = y - cy; const r = Math.hypot(dx, dy), R = 40;
    if (r > R) { dx *= R / r; dy *= R / r; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    joyV.x = dx / R; joyV.y = dy / R;
  };
  joy.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); id = e.pointerId; joy.setPointerCapture(id); const r = joy.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; set(e.clientX, e.clientY); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e.clientX, e.clientY); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; joyV.x = joyV.y = 0; knob.style.transform = ''; };
  joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
}
const _fw = new THREE.Vector3(), _rt = new THREE.Vector3(), _mv = new THREE.Vector3();
function moveCamera(dt) {
  let f = -joyV.y, r = joyV.x, u = 0;
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

function draw(realDt) {
  B.flushGPU();
  moveCamera(realDt);
  controls.update();
  const gy = terrain.groundY(camera.position.x, camera.position.z);
  if (camera.position.y < gy + 1.5) camera.position.y = gy + 1.5;
  const { off } = FX.applyCamera(realDt);
  camera.position.add(off);
  const f = baseFov + FX.cam.fovPunch;
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
  $('pct').textContent = (pct < 10 ? pct.toFixed(1) : Math.floor(pct)) + '%';
  $('pctbar').style.width = clamp(pct, 0, 100) + '%';
  if (all && run.on && !run.done) runComplete();
  $('fallen').textContent = `목표 ${cleared}/${tg.length}동 · 전체 ${Math.floor(S.destructionRatio() * 100)}%`;
  updateMarkers(true);
  $('combo').textContent = lastAttack;
}
let last = performance.now(), tmAcc = 0;
function runTick(dt) {
  if (!run.on || run.done || !$('veil').classList.contains('hide') || document.hidden) return;
  run.t += dt; tmAcc += dt;
  if (tmAcc > 0.1) { tmAcc = 0; $('tm').textContent = fmtT(run.t); }
}
function frame(now) {
  const realDt = Math.min(0.05, (now - last) / 1000); last = now;
  simulate(realDt);
  draw(realDt);
  updateMarkers(false);
  Replay.tick(renderer.domElement, { map: world.MAP.title, time: fmtT(run.t) });
  runTick(realDt);
  hud(realDt);
  fpsAcc += realDt; fpsN++;
  if (fpsAcc > 1) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
const startBtn = $('startBtn');
startBtn.disabled = false; startBtn.textContent = '파괴 시작';
startBtn.addEventListener('click', () => { A.init(); $('veil').classList.add('hide'); });
// map chooser: search box + list; switching maps reloads with ?map=<id>
const norm = (t) => t.toLowerCase().replace(/\s+/g, '');
function renderMaps(q = '') {
  const box = $('maps'); box.textContent = '';
  const nq = norm(q);
  const list = world.MAPS.filter((m) => !nq || norm(m.title + m.sub + m.id + (m.kw || '') + (m.near || []).join(' ')).includes(nq));
  for (const m of list) {
    const b = document.createElement('button');
    b.className = m.id === world.MAP.id ? 'on' : '';
    b.textContent = m.title; const sm = document.createElement('small'); sm.textContent = m.sub; b.appendChild(sm);
    // searched for a neighbour company: say it is in this map
    const hit = nq && (m.near || []).find((n) => norm(n).includes(nq) || nq.includes(norm(n).replace(/\(.*\)/, '')));
    if (hit) { const h = document.createElement('small'); h.className = 'near'; h.textContent = '📍 ' + hit + ' 포함 맵'; b.appendChild(h); }
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (m.id === world.MAP.id) { closeVeil(); return; }
      const qs = new URLSearchParams(location.search); qs.set('map', m.id); location.search = qs.toString();
    });
    box.appendChild(b);
  }
  if (!list.length) {
    const d = document.createElement('div'); d.className = 'none'; d.textContent = `"${q}" 맵은 아직 없어요. 표가 많은 회사부터 만들어요.`; box.appendChild(d);
    const v = document.createElement('button'); v.className = 'wishbtn'; v.textContent = `🗳 "${q.trim().slice(0, 30)}" 만들어 주세요`;
    v.addEventListener('click', async (e) => { e.stopPropagation(); v.disabled = true; const j = await wishVote(q.trim()); v.textContent = j.ok ? (j.already ? `이미 투표했어요 · 지금 ${j.votes}표` : `투표했어요! 지금 ${j.votes}표`) : j.error; });
    box.appendChild(v);
  }
}
renderMaps();
$('msearch').addEventListener('input', (e) => renderMaps(e.target.value));
$('msearch').addEventListener('keydown', (e) => {
  e.stopPropagation(); // typing must not trigger weapon hotkeys
  if (e.key === 'Enter') { const first = $('maps').querySelector('button'); if (first) first.click(); }
  if (e.key === 'Escape') closeVeil();
});
function openVeil() { cancelLaser(); $('veil').classList.remove('hide'); startBtn.textContent = '계속하기'; setTimeout(() => $('msearch').focus(), 50); }
function closeVeil() { $('veil').classList.add('hide'); }
$('bMaps').addEventListener('click', (e) => { e.stopPropagation(); openVeil(); });
// index.html is served as a static file (no Worker), so the per-map canonical link is set here
{ const id = new URLSearchParams(location.search).get('map'); const c = document.createElement('link'); c.rel = 'canonical';
  c.href = 'https://companysmash.com/' + (id && world.MAP.id === id ? '?map=' + id : ''); document.head.appendChild(c); }
if (new URLSearchParams(location.search).has('map') && !/ 부수기 - /.test(document.title)) document.title = world.MAP.title.replace(/\s*\(.*\)$/, '') + ' 부수기 · ' + document.title; // per-map search title (e.g. 'SK하이닉스 이천캠퍼스 부수기')
{ const logo = document.querySelector('#brand .logo'); if (logo) logo.lastChild.textContent = '부수기 · ' + world.MAP.title; }
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
$('bEmb').addEventListener('click', (e) => { e.stopPropagation(); renderEmblems(); $('embPanel').classList.add('show'); });
$('embClose').addEventListener('click', () => $('embPanel').classList.remove('show'));
$('embPanel').addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === $('embPanel')) $('embPanel').classList.remove('show'); });

// ---------------------------------------------------------------- result / ranking / sharing
Replay.init();
const NAME_KEY = 'smash.nick';
try { $('rsName').value = localStorage.getItem(NAME_KEY) || ''; } catch (e) { /* storage blocked */ }
Replay.onClip((c) => {
  const v = $('rsVideo'); v.src = c.url; v.style.display = 'block';
  if ($('result').classList.contains('show')) v.play().catch(() => {});
});
const singleWeapon = () => (run.weapons.size === 1 ? [...run.weapons][0] : null);
const BOARD_NAME = { all: '종합', mg: '기관총', hammer: '망치', bomb: '폭탄', missile: '미사일', laser: '레이저', meteor: '운석', hits: '🏢 회사 파괴 랭킹' };
let boardTab = 'all';
function renderTabs() {
  const box = $('boardTabs'); box.textContent = '';
  for (const w of [...Rank.BOARDS, 'hits']) {
    const b = document.createElement('button'); b.textContent = BOARD_NAME[w]; b.className = w === boardTab ? 'on' : '';
    b.addEventListener('click', (e) => { e.stopPropagation(); boardTab = w; renderTabs(); renderBoard(); });
    box.appendChild(b);
  }
}
// every player's damage summed per map ("가장 많이 부서진 곳")
async function renderHits() {
  const { kind, rows } = await Rank.hits();
  const box = $('board'); box.textContent = '';
  const h = document.createElement('div'); h.className = 'h'; h.textContent = '🏢 회사 파괴 랭킹';
  const sp = document.createElement('span'); sp.textContent = kind === 'online' ? '전체 이용자 누적 피해액' : kind === 'shared' ? '테스트 링크 이용자 누적' : '내 누적 (이 기기)'; h.appendChild(sp); box.appendChild(h);
  const byKey = (r) => world.MAPS.find((m) => m.id === r.map || m.id.replace(/[^a-zA-Z0-9]/g, '_') === r.key);
  const list = rows.map((r) => ({ ...r, m: byKey(r) })).filter((r) => r.m && r.dmg > 0);
  if (!list.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = '아직 집계된 피해가 없어요. 첫 피해를 남겨 보세요!'; box.appendChild(d); return; }
  const ol = document.createElement('ol');
  list.slice(0, 10).forEach((r, i) => {
    const li = document.createElement('li'); if (r.m.id === world.MAP.id) li.className = 'me';
    const n = document.createElement('i'); n.textContent = i + 1;
    const nm = document.createElement('span'); nm.textContent = r.m.title + (r.clears ? ' · 완파 ' + r.clears.toLocaleString() + '회' : '');
    const t = document.createElement('b'); t.textContent = Score.won(r.dmg);
    li.append(n, nm, t); ol.appendChild(li);
  });
  box.appendChild(ol);
}
async function renderBoard() {
  if (boardTab === 'hits') return renderHits();
  const m = await Rank.mode();
  const rows = await Rank.top(world.MAP.id, 10, boardTab);
  const where = m.kind === 'online' ? '전체 랭킹' : m.kind === 'shared' ? '전체 랭킹 (테스트 링크)' : '내 기록 (이 기기)';
  const box = $('board'); box.textContent = '';
  const h = document.createElement('div'); h.className = 'h'; h.textContent = '🏆 ' + world.MAP.title + (boardTab === 'all' ? '' : ' · ' + BOARD_NAME[boardTab] + '만');
  const sp = document.createElement('span'); sp.textContent = where; h.appendChild(sp); box.appendChild(h);
  if (!rows.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = boardTab === 'all' ? '아직 완파 기록이 없어요. 첫 기록의 주인공이 되어 보세요.' : BOARD_NAME[boardTab] + '만으로 완파한 기록이 아직 없어요. 도전해 보세요!'; box.appendChild(d); return; }
  const ol = document.createElement('ol');
  rows.forEach((r, i) => {
    const li = document.createElement('li'); if (r.me) li.className = 'me';
    const n = document.createElement('i'); n.textContent = i + 1;
    const nm = document.createElement('span'); nm.textContent = r.name;
    const t = document.createElement('b'); t.textContent = fmtT(r.ms / 1000);
    li.append(n, nm, t); ol.appendChild(li);
  });
  box.appendChild(ol);
}
function shareText() {
  const url = new URL(location.href); url.search = ''; url.searchParams.set('map', world.MAP.id);
  if (run.done && !run.nuke) url.searchParams.set('vs', Math.round(run.t * 1000));
  return [
    '회사 때려부수기 · ' + world.MAP.title,
    (run.done ? '💥 완파 ⏱ ' + fmtT(run.t) : '💥 파괴율 ' + $('pct').textContent + ' ⏱ ' + fmtT(run.t)) + (singleWeapon() && BOARD_NAME[singleWeapon()] ? ' · ' + BOARD_NAME[singleWeapon()] + '만' : '') + ' · 공격 ' + run.shots + '회' + (run.nuke ? ' · ☢' : ''),
    '💰 피해액 ' + Score.won(Score.state.score) + ' · 직급 ' + Score.rankInfo().id,
    (run.done && !run.nuke ? '👉 이 기록 깨 보기: ' : '👉 ') + url.toString(),
  ].join('\n');
}
async function showResult(fromButton = false) {
  const done = run.done;
  $('rsEyebrow').textContent = done ? '완파 기록' : '랭킹';
  $('rsTitle').textContent = done ? '완파! ' + world.MAP.title : world.MAP.title;
  $('rsTime').textContent = done ? fmtT(run.t) : '';
  $('rsTime').style.display = done ? '' : 'none';
  const st = $('rsStats'); st.textContent = '';
  if (done) for (const [k, v] of [['피해액', Score.won(Score.state.score)], ['직급', Score.rankInfo().id], ['공격', run.shots + '회'], ['무기', singleWeapon() ? BOARD_NAME[singleWeapon()] + '만' : [...run.weapons].map((w) => (W.TOOLS[w] ? W.TOOLS[w].name : w)).join('·')]]) {
    const sp = document.createElement('span'); sp.append(k + ' '); const b = document.createElement('b'); b.textContent = v; sp.appendChild(b); st.appendChild(sp);
  }
  const m = await Rank.mode();
  let note = '';
  if (done && run.nuke) note = '☢ 핵폭탄을 쓴 기록은 랭킹에 올라가지 않아요. 핵 없이 도전해 보세요!';
  else if (done && vsMs) note = run.t * 1000 < vsMs ? '🎉 도전 성공! 친구 기록 ' + fmtT(vsMs / 1000) + '보다 빨라요' : '아깝다! 친구 기록은 ' + fmtT(vsMs / 1000);
  else if (done && m.kind === 'local') note = '온라인 랭킹은 사이트 오픈 후 열려요. 지금은 이 기기에만 저장돼요.';
  $('rsNote').textContent = note;
  $('rsSubmitRow').style.display = done && !run.nuke && !run.submitted ? 'flex' : 'none';
  $('rsClip').style.display = Replay.supported ? '' : 'none';
  $('rsClip').disabled = !Replay.latest();
  $('rsShare').style.display = done ? '' : 'none';
  const v = $('rsVideo'); const c = Replay.latest();
  if (c && done) { if (v.src !== c.url) v.src = c.url; v.style.display = 'block'; v.play().catch(() => {}); } else { v.style.display = 'none'; v.pause(); }
  const re = $('rsEmb'); re.textContent = '';
  if (done && run.newEmb) for (const r of run.newEmb) if (embById[r.id]) re.appendChild(embEl(embById[r.id], r.tier));
  boardTab = done && !run.nuke && singleWeapon() && Rank.BOARDS.includes(singleWeapon()) ? singleWeapon() : 'all';
  renderTabs();
  $('result').classList.add('show');
  renderBoard();
}
function hideResult() { $('result').classList.remove('show'); $('rsVideo').pause(); }
$('result').addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === $('result')) hideResult(); });
$('rsClose').addEventListener('click', hideResult);
$('rsAgain').addEventListener('click', () => { hideResult(); resetWorld(); });
$('bRank').addEventListener('click', (e) => { e.stopPropagation(); showResult(true); });
$('rsSubmit').addEventListener('click', async () => {
  if (!run.done || run.nuke || run.submitted) return;
  const name = $('rsName').value.trim();
  if (!name) { $('rsName').focus(); return; }
  try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* storage blocked */ }
  $('rsSubmit').disabled = true;
  const r = await Rank.submit({ map: world.MAP.id, name, ms: run.t * 1000, dmg: Score.state.score, shots: run.shots, weapon: singleWeapon() });
  $('rsSubmit').disabled = false;
  if (r.ok) { run.submitted = true; $('rsSubmitRow').style.display = 'none'; }
  $('rsNote').textContent = r.note || (r.ok ? (singleWeapon() ? '종합 + ' + BOARD_NAME[singleWeapon()] + ' 랭킹에 등록했어요!' : '랭킹에 등록했어요!') : '등록하지 못했어요');
  renderBoard();
});
$('rsShare').addEventListener('click', async () => {
  const text = shareText();
  try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); $('rsNote').textContent = '결과를 복사했어요. 카톡에 붙여넣어 보내 보세요!'; }
  catch (e) { prompt('아래 내용을 복사해 보내세요', text); }
});
$('rsClip').addEventListener('click', async () => {
  const c = Replay.latest(); if (!c) return;
  const fname = `회사부수기_${world.MAP.id}_${fmtT(run.t).replace(/[:.]/g, '')}.${c.ext}`;
  const file = new File([c.blob], fname, { type: c.blob.type });
  try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: shareText() }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = c.url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
});
if (vsMs) toast('친구 기록 ' + fmtT(vsMs / 1000) + ' — 이겨 보세요!');

// test / debugging hooks (deterministic stepping when ?test=1)
renderSupport(document.getElementById('support')); renderSupport(document.getElementById('rsSupport'));
window.SMASH = {
  THREE, scene, camera, controls, terrain, B, P, S, SG, props, FX, W, setView, pickScreen, pickRay,
  setFov(f) { baseFov = f; },
  setTool, resetWorld, VIEWS, Score, Emblem, renderEmblems, run, Replay, Rank, showResult, shareText,
  advance(sec, step = 1 / 60) { const n = Math.round(sec / step); for (let i = 0; i < n; i++) simulate(step); },
  play(sec, step = 1 / 30, drawEvery = 0) { const n = Math.round(sec / step); for (let i = 0; i < n; i++) { simulate(step); runTick(step); if (drawEvery && i % drawEvery === 0) { draw(step); Replay.tick(renderer.domElement, { map: world.MAP.title, time: fmtT(run.t) }); } hudAcc = 1; hud(step); } },
  frame(dt = 1 / 60) { draw(dt); hudAcc = 1; hud(dt); },
  hud(dt = 1 / 60) { hudAcc = 1; hud(dt); },
  gunWorld(x, y, z, sec) { const h = surfaceBelow(x, z, y); if (!h) return null; W.gunStart(h); return h.point.toArray(); },
  gunStop() { W.gunStop(); },
  fireAt(t, x, y) { const h = pickScreen(x, y); if (!h) return null; W.fire(t, h, pickNear); return { kind: h.kind, point: h.point.toArray() }; },
  fireWorld(t, x, y, z) { const h = surfaceBelow(x, z, y); if (!h) return null; W.fire(t, h, pickNear); return { kind: h.kind, point: h.point.toArray() }; },
  laserScreen(points) { const p = new W.LaserPath(); let miss = 0; for (const [x, y] of points) { const h = pickScreen(x, y); if (h && h.kind !== 'prop') p.add(h.point, h.normal); else miss++; } const n = p.pts.length; W.fireLaser(p); return { recorded: n, missed: miss }; },
  stats() {
    let statics = 0; for (const b of S.buildings) statics += b.statics.size;
    return { blocks: B.stats(), statics, bodies: P.bodies.size, awake: P.awakeCount(), clusters: P.clusters.length, fx: FX.counts(), weapons: { ...W.stats }, actions: W.actions.length, destruction: +(S.destructionRatio() * 100).toFixed(2), score: Score.state.score, rank: Score.rankInfo().id, fps: Math.round(fps), perf: { ...perf } };
  },
};
if (!IS_TEST) requestAnimationFrame(frame);
window.__ready = true;
