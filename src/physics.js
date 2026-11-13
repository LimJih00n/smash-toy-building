// Lightweight rigid-box dynamics tuned for destruction:
//  - every body is an oriented box; contacts are its 8 corners vs terrain, standing chunks and other bodies
//  - impulses with friction so chunks tumble and settle on a face (no "floating spheres")
//  - bodies sleep when calm and are woken by nearby changes; sleeping bodies stay as solid rubble
//  - clusters: a whole severed part of a building rotating about its hinge (laser cut / undermined)
//    or free-falling (story collapse) as one rigid object, then shattering on impact
import * as THREE from 'three';
import * as terrain from './terrain.js';
import * as SG from './staticgrid.js';
import { writeMatrix, split as splitPiece, removePiece, Piece } from './blocks.js';
import { rand } from './util.js';

export const GRAV = 24;
export const bodies = new Set();
let awake = [];
export const clusters = [];
export const hooks = { impact: null, crush: null, shatter: null };
export const budget = { split: 0, crush: 0 };
export const LIMITS = { maxAwake: 1500, maxBodies: 2600 };
export const prof = { cp: 0, cs: 0, cpHit: 0, csHit: 0, integ: 0, terrain: 0, stat: 0, pairs: 0, sleep: 0, sync: 0, impacts: 0, clusters: 0, n: 0 };
const now = () => performance.now();
let uid = 1, frameNo = 0;

// ---------- body setup
function inertia(b) {
  const m = b.mass;
  const x2 = b.hx * b.hx, y2 = b.hy * b.hy, z2 = b.hz * b.hz;
  b.invM = 1 / m;
  b.iIx = 3 / (m * (y2 + z2)); b.iIy = 3 / (m * (x2 + z2)); b.iIz = 3 / (m * (x2 + y2));
  if (!b.R) b.R = new Float32Array(9);
}
export function makeDynamic(b, vel, ang) {
  if (!b.uid) b.uid = uid++;
  b.mass = b.massOverride || Math.max(0.05, 8 * b.hx * b.hy * b.hz);
  b._r = Math.hypot(b.hx, b.hy, b.hz);
  inertia(b);
  if (vel) b.vel.copy(vel);
  if (ang) b.ang.copy(ang);
  b.dyn = true; b.still = 0; b.born = frameNo; b.cl = null;
  if (b.sleep) unsleep(b);
  b.sleep = false;
  if (!bodies.has(b)) { bodies.add(b); awake.push(b); }
  else if (!awake.includes(b)) awake.push(b);
}
export function removeBody(b) {
  if (!bodies.has(b)) return;
  bodies.delete(b);
  if (b.sleep) unsleep(b);
  b.sleep = false; b.dyn = false;
  const i = awake.indexOf(b); if (i >= 0) { awake[i] = awake[awake.length - 1]; awake.pop(); }
  // whatever was resting on it must fall now
  const bb = b._bb;
  if (bb) wakeBox(bb[0] - 0.5, bb[1] + 0.5, bb[2] - 0.5, bb[3] + 8, bb[4] - 0.5, bb[5] + 0.5);
}

// ---------- support audit: a sleeping piece with nothing under it wakes up (no floating rubble)
let auditIt = null;
function supported(b) {
  const bb = b._bb; if (!bb) return true;
  const yb = bb[2] - 0.4;
  const cx = (bb[0] + bb[1]) / 2, cz = (bb[4] + bb[5]) / 2, hx = (bb[1] - bb[0]) * 0.32, hz = (bb[5] - bb[4]) * 0.32;
  const pts = [[cx, cz], [cx - hx, cz - hz], [cx + hx, cz - hz], [cx - hx, cz + hz], [cx + hx, cz + hz]];
  for (const [x, z] of pts) {
    if (terrain.groundY(x, z) >= yb - 0.5) return true;
    let ok = false;
    SG.query(x - 0.05, x + 0.05, z - 0.05, z + 0.05, (s) => {
      if (Math.abs(x - s.pos.x) <= s.hx + 0.05 && Math.abs(z - s.pos.z) <= s.hz + 0.05 && yb <= s.pos.y + s.hy + 0.5 && yb >= s.pos.y - s.hy - 0.5) { ok = true; return false; }
    });
    if (ok) return true;
    const c = sleepMap.get(hkey(Math.floor(x / SC), Math.floor(z / SC), Math.floor(yb / SC)));
    if (c) for (const o of c) { if (o === b || !o._bb) continue; const q = o._bb; if (x >= q[0] && x <= q[1] && z >= q[4] && z <= q[5] && yb >= q[2] - 0.3 && yb <= q[3] + 0.5) return true; }
    for (const o of awake) { if (o === b || !o._bb) continue; const q = o._bb; if (x >= q[0] && x <= q[1] && z >= q[4] && z <= q[5] && yb >= q[2] - 0.3 && yb <= q[3] + 0.5) return true; }
  }
  return false;
}
function auditSleepers(n) {
  if (!auditIt) auditIt = bodies.values();
  for (let i = 0; i < n; i++) {
    const r = auditIt.next();
    if (r.done) { auditIt = null; return; }
    const b = r.value;
    if (b.sleep && bodies.has(b) && !supported(b)) wake(b);
  }
}
export function awakeCount() { return awake.length; }

// ---------- sleeping bodies live in a 3D hash so awake ones can land on them
const SC = 6;
const sleepMap = new Map();
const hkey = (i, j, k) => ((i + 1024) * 2048 + (j + 1024)) * 512 + (k + 128);
function aabbOf(b, out) {
  const R = b.R;
  const ex = Math.abs(R[0]) * b.hx + Math.abs(R[1]) * b.hy + Math.abs(R[2]) * b.hz;
  const ey = Math.abs(R[3]) * b.hx + Math.abs(R[4]) * b.hy + Math.abs(R[5]) * b.hz;
  const ez = Math.abs(R[6]) * b.hx + Math.abs(R[7]) * b.hy + Math.abs(R[8]) * b.hz;
  out = out || new Float32Array(6);
  out[0] = b.pos.x - ex; out[1] = b.pos.x + ex; out[2] = b.pos.y - ey; out[3] = b.pos.y + ey; out[4] = b.pos.z - ez; out[5] = b.pos.z + ez;
  return out;
}
function cellsOf(bb, cs, fn) {
  const i0 = Math.floor(bb[0] / cs), i1 = Math.floor(bb[1] / cs), k0 = Math.floor(bb[2] / cs), k1 = Math.floor(bb[3] / cs), j0 = Math.floor(bb[4] / cs), j1 = Math.floor(bb[5] / cs);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) fn(hkey(i, j, k));
}
function sleepIt(b) {
  b.sleep = true; b.vel.set(0, 0, 0); b.ang.set(0, 0, 0);
  updateR(b);
  b._keys = [];
  cellsOf(aabbOf(b, b._bb), SC, (k) => { let c = sleepMap.get(k); if (!c) { c = []; sleepMap.set(k, c); } c.push(b); b._keys.push(k); });
}
function unsleep(b) {
  if (b._keys) for (const k of b._keys) { const c = sleepMap.get(k); if (!c) continue; const n = c.indexOf(b); if (n >= 0) { c[n] = c[c.length - 1]; c.pop(); } }
  b._keys = null; b.sleep = false; b.still = 0;
}
export function wake(b) { if (b.sleep && bodies.has(b)) { unsleep(b); awake.push(b); } }
export function wakeBox(x0, x1, y0, y1, z0, z1) {
  const set = new Set();
  cellsOf([x0, x1, y0, y1, z0, z1], SC, (k) => { const c = sleepMap.get(k); if (c) for (const b of c) set.add(b); });
  for (const b of set) wake(b);
  return set.size;
}
export function sleepingIn(x0, x1, y0, y1, z0, z1) {
  const set = new Set();
  cellsOf([x0, x1, y0, y1, z0, z1], SC, (k) => { const c = sleepMap.get(k); if (c) for (const b of c) set.add(b); });
  return set;
}
/** all dynamic bodies (awake or asleep) whose centre is within r of c */
export function bodiesNear(c, r) {
  const out = [];
  const r2 = r * r;
  for (const b of bodies) if (b.pos.distanceToSquared(c) < r2) out.push(b);
  return out;
}

// ---------- keeping the world bounded: rubble merges into the ground instead of vanishing
function enforceBudget() {
  if (bodies.size <= LIMITS.maxBodies && awake.length <= LIMITS.maxAwake * 1.1) return;
  const over = bodies.size - LIMITS.maxBodies;
  if (over > 0 && hooks.toRubble) {
    // oldest, smallest sleeping rubble lying on the ground becomes part of a rubble mound
    const cand = [];
    for (const b of bodies) if (b.sleep && b instanceof Piece && b.pos.y - terrain.groundY(b.pos.x, b.pos.z) < b.maxH * 2 + 0.6) cand.push(b);
    cand.sort((a, c) => a.vol - c.vol);
    for (let i = 0; i < Math.min(cand.length, over + 50); i++) { const b = cand[i]; removeBody(b); hooks.toRubble(b); removePiece(b); }
  }
  if (awake.length > LIMITS.maxAwake * 1.1 && hooks.toChip) {
    // too many tumbling fragments: the smallest ones are ground to dust and chips
    const list = awake.filter((b) => b instanceof Piece && !b.cl).sort((a, c) => a.vol - c.vol);
    const n = Math.min(list.length, awake.length - LIMITS.maxAwake);
    for (let i = 0; i < n; i++) { const b = list[i]; removeBody(b); hooks.toChip(b); removePiece(b); }
  }
}

// ---------- math helpers
function updateR(b) {
  const q = b.quat, x = q.x, y = q.y, z = q.z, w = q.w;
  const R = b.R;
  R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - z * w); R[2] = 2 * (x * z + y * w);
  R[3] = 2 * (x * y + z * w); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - x * w);
  R[6] = 2 * (x * z - y * w); R[7] = 2 * (y * z + x * w); R[8] = 1 - 2 * (x * x + y * y);
}
// world inverse inertia times vector (x,y,z) -> out
function invIW(b, x, y, z, out) {
  const R = b.R;
  // local = R^T v
  const lx = R[0] * x + R[3] * y + R[6] * z, ly = R[1] * x + R[4] * y + R[7] * z, lz = R[2] * x + R[5] * y + R[8] * z;
  const ax = lx * b.iIx, ay = ly * b.iIy, az = lz * b.iIz;
  out[0] = R[0] * ax + R[1] * ay + R[2] * az; out[1] = R[3] * ax + R[4] * ay + R[5] * az; out[2] = R[6] * ax + R[7] * ay + R[8] * az;
}
const tmp = [0, 0, 0];

// contact impulse between body a (at world point c) and body o (null = immovable) along normal n
function contact(a, cx, cy, cz, nx, ny, nz, depth, o, e, mu) {
  const rax = cx - a.pos.x, ray = cy - a.pos.y, raz = cz - a.pos.z;
  let vx = a.vel.x + a.ang.y * raz - a.ang.z * ray;
  let vy = a.vel.y + a.ang.z * rax - a.ang.x * raz;
  let vz = a.vel.z + a.ang.x * ray - a.ang.y * rax;
  let rbx = 0, rby = 0, rbz = 0;
  if (o) {
    rbx = cx - o.pos.x; rby = cy - o.pos.y; rbz = cz - o.pos.z;
    vx -= o.vel.x + o.ang.y * rbz - o.ang.z * rby;
    vy -= o.vel.y + o.ang.z * rbx - o.ang.x * rbz;
    vz -= o.vel.z + o.ang.x * rby - o.ang.y * rbx;
  }
  // positional correction
  const wa = a.invM, wb = o ? o.invM : 0, ws = wa + wb;
  const corr = Math.max(0, depth - 0.01) * 0.55;
  if (corr > 0) {
    const fa = corr * wa / ws;
    a.pos.x += nx * fa; a.pos.y += ny * fa; a.pos.z += nz * fa;
    if (o) { const fb = corr * wb / ws; o.pos.x -= nx * fb; o.pos.y -= ny * fb; o.pos.z -= nz * fb; }
  }
  const vn = vx * nx + vy * ny + vz * nz;
  if (vn >= 0) return 0;
  // effective mass along n
  let cxn = ray * nz - raz * ny, cyn = raz * nx - rax * nz, czn = rax * ny - ray * nx;
  invIW(a, cxn, cyn, czn, tmp);
  let k = wa + nx * (tmp[1] * raz - tmp[2] * ray) + ny * (tmp[2] * rax - tmp[0] * raz) + nz * (tmp[0] * ray - tmp[1] * rax);
  if (o) {
    const bx = rby * nz - rbz * ny, by = rbz * nx - rbx * nz, bz = rbx * ny - rby * nx;
    invIW(o, bx, by, bz, tmp);
    k += wb + nx * (tmp[1] * rbz - tmp[2] * rby) + ny * (tmp[2] * rbx - tmp[0] * rbz) + nz * (tmp[0] * rby - tmp[1] * rbx);
  }
  const j = -(1 + e) * vn / k;
  applyImpulse(a, rax, ray, raz, nx * j, ny * j, nz * j);
  if (o) applyImpulse(o, rbx, rby, rbz, -nx * j, -ny * j, -nz * j);
  // friction
  const tx = vx - vn * nx, ty = vy - vn * ny, tz = vz - vn * nz;
  const tl = Math.hypot(tx, ty, tz);
  if (tl > 1e-4) {
    const ux = tx / tl, uy = ty / tl, uz = tz / tl;
    cxn = ray * uz - raz * uy; cyn = raz * ux - rax * uz; czn = rax * uy - ray * ux;
    invIW(a, cxn, cyn, czn, tmp);
    let kt = wa + ux * (tmp[1] * raz - tmp[2] * ray) + uy * (tmp[2] * rax - tmp[0] * raz) + uz * (tmp[0] * ray - tmp[1] * rax);
    if (o) kt += wb;
    const jt = Math.min(tl / kt, mu * j);
    applyImpulse(a, rax, ray, raz, -ux * jt, -uy * jt, -uz * jt);
    if (o) applyImpulse(o, rbx, rby, rbz, ux * jt, uy * jt, uz * jt);
  }
  return -vn;
}
function applyImpulse(b, rx, ry, rz, jx, jy, jz) {
  if (b.sleep) wake(b);
  b.vel.x += jx * b.invM; b.vel.y += jy * b.invM; b.vel.z += jz * b.invM;
  invIW(b, ry * jz - rz * jy, rz * jx - rx * jz, rx * jy - ry * jx, tmp);
  b.ang.x += tmp[0]; b.ang.y += tmp[1]; b.ang.z += tmp[2];
}

// ---------- the step
const awakeMap = new Map();
const cellPool = [];
const CS = SC;
let crowded = false;
let pairStamp = 1;
const SIGN = [[-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1], [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]];
const cw = new Float32Array(24);
function corners(b, shrink = 0.985) {
  const R = b.R, hx = b.hx * shrink, hy = b.hy * shrink, hz = b.hz * shrink;
  for (let c = 0; c < 8; c++) {
    const s = SIGN[c], lx = s[0] * hx, ly = s[1] * hy, lz = s[2] * hz;
    cw[3 * c] = b.pos.x + R[0] * lx + R[1] * ly + R[2] * lz;
    cw[3 * c + 1] = b.pos.y + R[3] * lx + R[4] * ly + R[5] * lz;
    cw[3 * c + 2] = b.pos.z + R[6] * lx + R[7] * ly + R[8] * lz;
  }
}
const impacts = [];

function collideTerrain(b) {
  let any = false, maxVn = 0, px = 0, py = 0, pz = 0;
  // terrain normal at centre
  const x = b.pos.x, z = b.pos.z;
  const gx = terrain.groundY(x - 1, z) - terrain.groundY(x + 1, z), gz = terrain.groundY(x, z - 1) - terrain.groundY(x, z + 1);
  let nx = gx, ny = 2, nz = gz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
  for (let c = 0; c < 8; c++) {
    const cx = cw[3 * c], cy = cw[3 * c + 1], cz = cw[3 * c + 2];
    const gy = terrain.groundY(cx, cz);
    if (cy < gy) {
      const vn = contact(b, cx, cy, cz, nx, ny, nz, (gy - cy) * ny, null, 0.12, 0.75);
      any = true;
      if (vn > maxVn) { maxVn = vn; px = cx; py = gy; pz = cz; }
    }
  }
  if (maxVn > 7) impacts.push({ b, v: maxVn, x: px, y: py, z: pz, ground: true });
  return any;
}

function collideStatic(b, bb) {
  let any = false, maxVn = 0, hit = null, px = 0, py = 0, pz = 0;
  SG.query(bb[0], bb[1], bb[4], bb[5], (s) => {
    if (s.pos.y + s.hy < bb[2] || s.pos.y - s.hy > bb[3]) return;
    if (Math.abs(s.pos.x - b.pos.x) > s.hx + (bb[1] - bb[0]) / 2 || Math.abs(s.pos.z - b.pos.z) > s.hz + (bb[5] - bb[4]) / 2) return;
    for (let c = 0; c < 8; c++) {
      const cx = cw[3 * c], cy = cw[3 * c + 1], cz = cw[3 * c + 2];
      const dx0 = cx - (s.pos.x - s.hx), dx1 = s.pos.x + s.hx - cx;
      if (dx0 <= 0 || dx1 <= 0) continue;
      const dy0 = cy - (s.pos.y - s.hy), dy1 = s.pos.y + s.hy - cy;
      if (dy0 <= 0 || dy1 <= 0) continue;
      const dz0 = cz - (s.pos.z - s.hz), dz1 = s.pos.z + s.hz - cz;
      if (dz0 <= 0 || dz1 <= 0) continue;
      let d = dy1, nx = 0, ny = 1, nz = 0;
      if (dx0 < d) { d = dx0; nx = -1; ny = 0; nz = 0; }
      if (dx1 < d) { d = dx1; nx = 1; ny = 0; nz = 0; }
      if (dz0 < d) { d = dz0; nx = 0; ny = 0; nz = -1; }
      if (dz1 < d) { d = dz1; nx = 0; ny = 0; nz = 1; }
      if (dy0 < d) { d = dy0; nx = 0; ny = -1; nz = 0; }
      const vn = contact(b, cx, cy, cz, nx, ny, nz, d, null, 0.08, 0.7);
      any = true;
      if (vn > maxVn) { maxVn = vn; hit = s; px = cx; py = cy; pz = cz; }
    }
  });
  if (hit && maxVn > 6.5) impacts.push({ b, v: maxVn, x: px, y: py, z: pz, stat: hit });
  return any;
}

// corners of a inside box o (oriented)
function cornersInto(a, o) {
  let any = false;
  const R = o.R;
  for (let c = 0; c < 8; c++) {
    const wx = cw[3 * c] - o.pos.x, wy = cw[3 * c + 1] - o.pos.y, wz = cw[3 * c + 2] - o.pos.z;
    const lx = R[0] * wx + R[3] * wy + R[6] * wz, ly = R[1] * wx + R[4] * wy + R[7] * wz, lz = R[2] * wx + R[5] * wy + R[8] * wz;
    const px = o.hx - Math.abs(lx); if (px <= 0) continue;
    const py = o.hy - Math.abs(ly); if (py <= 0) continue;
    const pz = o.hz - Math.abs(lz); if (pz <= 0) continue;
    let d, ax;
    if (px < py && px < pz) { d = px; ax = 0; } else if (py < pz) { d = py; ax = 1; } else { d = pz; ax = 2; }
    const sg = ax === 0 ? Math.sign(lx) || 1 : ax === 1 ? Math.sign(ly) || 1 : Math.sign(lz) || 1;
    const nx = R[ax] * sg, ny = R[3 + ax] * sg, nz = R[6 + ax] * sg;
    contact(a, cw[3 * c], cw[3 * c + 1], cw[3 * c + 2], nx, ny, nz, d, o, 0.1, 0.6);
    any = true;
  }
  return any;
}
function collidePair(a, b) {
  // broad: bounding spheres
  const ra = a._r, rb = b._r;
  if (a.pos.distanceToSquared(b.pos) > (ra + rb) * (ra + rb)) return false;
  // the smaller box's corners against the bigger box; the reverse test only matters for
  // near-equal boxes meeting edge-on, so it is skipped when the scene is busy
  const sm = a.vol <= b.vol ? a : b, lg = sm === a ? b : a;
  corners(sm); let any = cornersInto(sm, lg);
  if (!crowded && lg.vol < sm.vol * 3) { corners(lg); any = cornersInto(lg, sm) || any; }
  return any;
}

const _q = new THREE.Quaternion(), _ax = new THREE.Vector3();
export function step(dt) {
  frameNo++;
  budget.split = bodies.size > LIMITS.maxBodies * 0.8 || awake.length > LIMITS.maxAwake * 0.8 ? 0 : 6;
  budget.crush = awake.length > LIMITS.maxAwake * 0.8 ? 1 : 2;
  enforceBudget();
  auditSleepers(160);
  crowded = awake.length > 300;
  const SUB = crowded ? 1 : 2, h = dt / SUB;
  // long-lived rubble that is barely moving is put to rest so huge piles stay cheap
  for (const b of awake) if (frameNo - b.born > 360 && b._contact && b.vel.lengthSq() < 6 && b.ang.lengthSq() < 6) b._force = true;
  // keep the awake list bounded: the oldest calm pieces go to sleep early
  if (awake.length > LIMITS.maxAwake) {
    awake.sort((p, q) => (p.vel.lengthSq() + p.ang.lengthSq()) - (q.vel.lengthSq() + q.ang.lengthSq()));
    for (let i = 0; i < awake.length - LIMITS.maxAwake && i < awake.length; i++) {
      const b = awake[i];
      if (b.vel.lengthSq() < 4 && b.pos.y - terrain.groundY(b.pos.x, b.pos.z) < b.hy * 2 + 1) b._force = true;
    }
  }
  prof.n++;
  for (let s = 0; s < SUB; s++) {
    let T0 = now();
    // integrate
    for (const b of awake) {
      b.vel.y -= GRAV * h;
      const air = 1 - 0.02 * h;
      b.vel.multiplyScalar(air);
      b.ang.multiplyScalar(1 - 0.08 * h);
      b.pos.addScaledVector(b.vel, h);
      const w = b.ang.length();
      if (w > 1e-5) { _q.setFromAxisAngle(_ax.copy(b.ang).divideScalar(w), w * h); b.quat.premultiply(_q).normalize(); }
      updateR(b);
    }
    prof.integ += now() - T0; T0 = now();
    // broadphase for awake bodies
    for (const c of awakeMap.values()) { c.length = 0; cellPool.push(c); }
    awakeMap.clear();
    for (const b of awake) {
      b._bb = aabbOf(b, b._bb);
      const cells = b._cells || (b._cells = []);
      cells.length = 0;
      const bb = b._bb;
      const i0 = Math.floor(bb[0] / CS), i1 = Math.floor(bb[1] / CS), k0 = Math.floor(bb[2] / CS), k1 = Math.floor(bb[3] / CS), j0 = Math.floor(bb[4] / CS), j1 = Math.floor(bb[5] / CS);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
        const key = hkey(i, j, k);
        let c = awakeMap.get(key); if (!c) { c = cellPool.pop() || []; awakeMap.set(key, c); }
        c.push(b); cells.push(key);
      }
    }
    const throttle = awake.length > 900;
    for (const b of awake) b._nc = 0;
    for (const b of awake) {
      if (b.sleep) continue;
      b._contact = false;
      corners(b);
      if (collideTerrain(b)) b._contact = true;
      corners(b);
      if (collideStatic(b, b._bb)) b._contact = true;
      // other bodies (very crowded scenes test each body's pairs every other step)
      if (throttle && ((frameNo + b.uid) & 1)) continue;
      const st = ++pairStamp;
      const bb = b._bb;
      for (const key of b._cells) {
        const c = awakeMap.get(key);
        // when the scene is crowded, small fragments skip body-body tests (they still hit ground, walls and big rubble)
        if (c) for (let n = 0; n < c.length; n++) {
          const o = c[n];
          if (o === b || o._ps === st || o.uid < b.uid) continue; o._ps = st;
          if (crowded && b.maxH < 1.3 && o.maxH < 1.3) continue;
          const ob = o._bb;
          if (ob[0] > bb[1] || ob[1] < bb[0] || ob[2] > bb[3] || ob[3] < bb[2] || ob[4] > bb[5] || ob[5] < bb[4]) continue;
          prof.cp++; if (collidePair(b, o)) { prof.cpHit++; b._contact = true; o._contact = true; b._nc++; o._nc++; }
        }
        const sl = sleepMap.get(key); // same cell size and key space as awakeMap
        if (sl) for (let n = 0; n < sl.length; n++) {
          const o = sl[n];
          if (o._ps === st) continue; o._ps = st;
          if (crowded && b.maxH < 0.9 && o.maxH < 0.9) continue;
          const ob = o._bb;
          if (ob[0] > bb[1] || ob[1] < bb[0] || ob[2] > bb[3] || ob[3] < bb[2] || ob[4] > bb[5] || ob[5] < bb[4]) continue;
          prof.cs++; if (collideSleeping(b, o)) { prof.csHit++; b._contact = true; b._nc++; }
        }
      }
    }
    prof.pairs += now() - T0; T0 = now();
    // sleep
    for (let i = awake.length - 1; i >= 0; i--) {
      const b = awake[i];
      if (b.sleep) { awake[i] = awake[awake.length - 1]; awake.pop(); continue; }
      if (b._contact) { b.vel.multiplyScalar(0.992); b.ang.multiplyScalar(0.95); }
      // wedged in a pile: soak up energy fast so piles come to rest
      if (b._nc >= 2 && b.vel.lengthSq() < 9) { b.vel.multiplyScalar(0.93); b.ang.multiplyScalar(0.85); }
      const calm = b.vel.lengthSq() < 1.2 && b.ang.lengthSq() < 1.5;
      if ((b._contact && calm) || (b._force && b._contact)) b.still += h; else b.still = Math.max(0, b.still - h);
      if (b.still > 0.25 || (b._force && b.still > 0.05)) { b._force = false; sleepIt(b); awake[i] = awake[awake.length - 1]; awake.pop(); if (b.sync) b.sync(); else writeMatrix(b); continue; }
      if (b.pos.y < terrain.MIN_Y - 40) { removeBody(b); if (b instanceof Piece) removePiece(b); else if (b.dispose) b.dispose(); }
    }
  }
  let T1 = now();
  for (const b of awake) { if (b.sync) b.sync(); else writeMatrix(b); }
  prof.sync += now() - T1; T1 = now();
  processImpacts();
  prof.impacts += now() - T1; T1 = now();
  for (let i = clusters.length - 1; i >= 0; i--) if (!clusters[i].update(dt)) clusters.splice(i, 1);
  prof.clusters += now() - T1;
}

// awake body vs sleeping body: the sleeper is immovable unless hit hard
function collideSleeping(b, o) {
  const ra = b._r, rb = o._r;
  if (b.pos.distanceToSquared(o.pos) > (ra + rb) * (ra + rb)) return false;
  const rel = b.vel.length();
  if (rel > 6 && b.mass > o.mass * 0.4) { wake(o); return collidePair(b, o); }
  // treat sleeper as static oriented box
  corners(b);
  let any = false;
  const R = o.R;
  for (let c = 0; c < 8; c++) {
    const wx = cw[3 * c] - o.pos.x, wy = cw[3 * c + 1] - o.pos.y, wz = cw[3 * c + 2] - o.pos.z;
    const lx = R[0] * wx + R[3] * wy + R[6] * wz, ly = R[1] * wx + R[4] * wy + R[7] * wz, lz = R[2] * wx + R[5] * wy + R[8] * wz;
    const px = o.hx - Math.abs(lx); if (px <= 0) continue;
    const py = o.hy - Math.abs(ly); if (py <= 0) continue;
    const pz = o.hz - Math.abs(lz); if (pz <= 0) continue;
    let d, ax;
    if (px < py && px < pz) { d = px; ax = 0; } else if (py < pz) { d = py; ax = 1; } else { d = pz; ax = 2; }
    const sg = ax === 0 ? Math.sign(lx) || 1 : ax === 1 ? Math.sign(ly) || 1 : Math.sign(lz) || 1;
    contact(b, cw[3 * c], cw[3 * c + 1], cw[3 * c + 2], R[ax] * sg, R[3 + ax] * sg, R[6 + ax] * sg, d, null, 0.08, 0.7);
    any = true;
  }
  // sleeper corners poking into the awake body push the awake body away
  corners(o);
  const Rb = b.R;
  for (let c = 0; c < 8; c++) {
    const wx = cw[3 * c] - b.pos.x, wy = cw[3 * c + 1] - b.pos.y, wz = cw[3 * c + 2] - b.pos.z;
    const lx = Rb[0] * wx + Rb[3] * wy + Rb[6] * wz, ly = Rb[1] * wx + Rb[4] * wy + Rb[7] * wz, lz = Rb[2] * wx + Rb[5] * wy + Rb[8] * wz;
    const px = b.hx - Math.abs(lx); if (px <= 0) continue;
    const py = b.hy - Math.abs(ly); if (py <= 0) continue;
    const pz = b.hz - Math.abs(lz); if (pz <= 0) continue;
    let d, ax;
    if (px < py && px < pz) { d = px; ax = 0; } else if (py < pz) { d = py; ax = 1; } else { d = pz; ax = 2; }
    const sg = ax === 0 ? Math.sign(lx) || 1 : ax === 1 ? Math.sign(ly) || 1 : Math.sign(lz) || 1;
    contact(b, cw[3 * c], cw[3 * c + 1], cw[3 * c + 2], -Rb[ax] * sg, -Rb[3 + ax] * sg, -Rb[6 + ax] * sg, d, null, 0.08, 0.7);
    any = true;
  }
  return any;
}

function processImpacts() {
  if (!impacts.length) return;
  impacts.sort((a, b) => b.v * b.b.mass - a.v * a.b.mass);
  const seen = new Set();
  for (const im of impacts) {
    const b = im.b;
    if (seen.has(b) || !bodies.has(b)) continue;
    seen.add(b);
    if (hooks.impact) hooks.impact(im);
    // crush the standing chunk underneath
    if (im.stat && budget.crush > 0 && im.v > 12 && b.mass > im.stat.vol * 0.3 && hooks.crush) { budget.crush--; hooks.crush(im.stat, b, im.v); }
    // big chunks break apart on hard landings
    if (b instanceof Piece && budget.split > 0 && im.v > 13 && b.maxH > 1.7 && b.gen < 3) {
      budget.split--;
      const parts = b.maxH > 3 ? 3 : 2;
      const v0 = b.vel.clone(), a0 = b.ang.clone();
      removeBody(b);
      const kids = splitPiece(b, parts, 0.32, 0.22);
      if (kids) {
        removePiece(b);
        for (const k of kids) {
          const out = k.pos.clone().sub(b.pos).normalize().multiplyScalar(rand(1, 3.5) * Math.min(1, im.v / 20));
          makeDynamic(k, v0.clone().multiplyScalar(0.55).add(out).add(new THREE.Vector3(0, rand(0.5, 3), 0)), a0.clone().multiplyScalar(0.6).add(new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2))));
        }
        if (hooks.shatter) hooks.shatter(b, im);
      } else makeDynamic(b, v0, a0);
    }
  }
  impacts.length = 0;
}

// ---------- clusters: a severed section moving as one rigid object
export class Cluster {
  /**
   * mode 'hinge': rotates about pivot/axis (topple). mode 'fall': drops with slight spin.
   */
  constructor(list, mode, opt = {}) {
    this.list = list; this.mode = mode; this.t = 0; this.done = false;
    this.pivot = opt.pivot ? opt.pivot.clone() : null;
    this.axis = opt.axis ? opt.axis.clone().normalize() : new THREE.Vector3(1, 0, 0);
    this.theta = 0; this.omega = opt.omega0 || 0.08;
    this.vy = opt.vy || 0;
    this.spin = opt.spin || 0;
    this.q = new THREE.Quaternion();
    // capture rest transforms
    let M = 0; const com = new THREE.Vector3();
    for (const p of list) { M += p.vol; com.addScaledVector(p.pos, p.vol); p.cl = this; p._p0 = p.pos.clone(); p._q0 = p.quat.clone(); }
    com.divideScalar(M);
    this.M = M; this.com0 = com;
    this.minY0 = Math.min(...list.map((p) => p.pos.y - p.hy));
    if (mode === 'hinge') {
      let I = 0;
      const r = new THREE.Vector3();
      for (const p of list) { r.copy(p.pos).sub(this.pivot); const along = r.dot(this.axis); r.addScaledVector(this.axis, -along); I += p.vol * (r.lengthSq() + (p.hx * p.hx + p.hy * p.hy) / 3); }
      this.I = I;
    }
    this.drop = 0;
    clusters.push(this);
  }
  transformPoint(p0, out) {
    if (this.mode === 'hinge') return out.copy(p0).sub(this.pivot).applyQuaternion(this.q).add(this.pivot);
    return out.copy(p0).sub(this.com0).applyQuaternion(this.q).add(this.com0).add(_ax.set(0, -this.drop, 0));
  }
  update(dt) {
    if (this.done) return false;
    this.t += dt;
    if (this.mode === 'hinge') {
      const c = this.transformPoint(this.com0, new THREE.Vector3());
      const r = c.sub(this.pivot);
      // torque of gravity about the hinge axis: (r x (0,-Mg,0)) . axis
      const tau = (r.z * this.axis.x - r.x * this.axis.z) * this.M * GRAV * -1;
      this.omega += (tau / this.I) * dt;
      this.omega = Math.max(this.omega, 0.05);
      this.theta += this.omega * dt;
      this.q.setFromAxisAngle(this.axis, this.theta);
    } else {
      this.vy += GRAV * dt;
      this.drop += this.vy * dt;
      this.q.setFromAxisAngle(this.axis, this.spin * this.t);
    }
    const tp = new THREE.Vector3();
    let hit = false;
    for (const p of this.list) {
      this.transformPoint(p._p0, tp);
      p.pos.copy(tp);
      p.quat.copy(this.q).multiply(p._q0);
      writeMatrix(p);
      if (!hit) {
        const low = p.pos.y - Math.max(p.hx, p.hy, p.hz) * 0.7;
        if (low < terrain.groundY(p.pos.x, p.pos.z)) hit = true;
        else if (this.mode === 'fall' || this.theta > 0.25) {
          SG.query(p.pos.x - 0.5, p.pos.x + 0.5, p.pos.z - 0.5, p.pos.z + 0.5, (s) => {
            if (s.cl) return;
            if (Math.abs(s.pos.x - p.pos.x) < s.hx && Math.abs(s.pos.z - p.pos.z) < s.hz && low < s.pos.y + s.hy && p.pos.y > s.pos.y) { hit = true; return false; }
          });
        }
      }
    }
    if (hit || this.theta > 1.45 || this.t > 9) this.shatter();
    return !this.done;
  }
  velocityAt(p, out) {
    if (this.mode === 'hinge') {
      const w = _ax.copy(this.axis).multiplyScalar(this.omega);
      const r = p.pos.clone().sub(this.pivot);
      return out.copy(w).cross(r);
    }
    return out.set(0, -this.vy, 0);
  }
  shatter() {
    this.done = true;
    const v = new THREE.Vector3();
    const angv = this.mode === 'hinge' ? this.axis.clone().multiplyScalar(this.omega) : new THREE.Vector3();
    for (const p of this.list) {
      if (p.idx < 0) continue;
      p.cl = null;
      this.velocityAt(p, v);
      makeDynamic(p, v.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.5, 0.5), rand(-1, 1))), angv.clone().add(new THREE.Vector3(rand(-0.4, 0.4), rand(-0.4, 0.4), rand(-0.4, 0.4))));
    }
    if (hooks.clusterLanded) hooks.clusterLanded(this);
  }
}

export function reset() {
  auditIt = null;
  bodies.clear(); awake = []; sleepMap.clear(); clusters.length = 0; impacts.length = 0;
}
export function allAwake() { return awake; }
/** test helper: sleeping bodies with nothing underneath */
export function floatingCount() { let n = 0; for (const b of bodies) if (b.sleep && !supported(b)) n++; return n; }
