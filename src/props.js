// Street furniture and greenery. Intact props are cheap instanced meshes; anything that gets hit
// is swapped for a free rigid body (its own mesh) that the physics engine tumbles around.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene } from './engine.js';
import * as terrain from './terrain.js';
import * as P from './physics.js';
import { rand, mulberry, fbm, clamp } from './util.js';
import { R5, MAP } from './world.js';
import { layout } from './mapgen.js';
import { rayBox } from './staticgrid.js';

export const sets = [];
export const loose = new Set();   // PropBody instances in the world
export const hooks = { knock: null };

// ---------- geometry helpers (all props are built with origin at the ground, centred)
function colored(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[3 * i] = c.r; a[3 * i + 1] = c.g; a[3 * i + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (geo.index) geo = geo.toNonIndexed();
  return geo;
}
const boxG = (w, h, d, x, y, z, hex) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
const cylG = (r0, r1, h, x, y, z, hex, seg = 8) => colored(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z), hex);
function blobG(r, x, y, z, hex, seed, squash = 1) {
  let g = new THREE.IcosahedronGeometry(r, 2);
  const p = g.attributes.position;
  const base = new THREE.Color(hex), c = new THREE.Color();
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const n = fbm(vx * 0.9 + seed, vz * 0.9 + vy * 0.7 - seed, 3);
    const k = 0.94 + 0.12 * n; // round low-poly balls
    p.setXYZ(i, vx * k + x, vy * k * squash + y, vz * k + z);
    // darker underside, lighter sunny top
    const t = clamp(0.55 + vy / r * 0.45, 0, 1);
    c.copy(base).multiplyScalar(0.55 + 0.6 * t * (0.8 + 0.4 * n));
    col[3 * i] = c.r; col[3 * i + 1] = c.g; col[3 * i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g = g.toNonIndexed(); g.computeVertexNormals();
  return g;
}
const merge = (list) => { const g = mergeGeometries(list.map((x) => { x.deleteAttribute('uv'); return x; })); g.computeBoundingSphere(); return g; };

function treeGeo(kind) {
  const parts = [];
  if (kind === 'zelkova') {
    parts.push(cylG(0.22, 0.38, 4.2, 0, 2.1, 0, 0x6b5a48, 7));
    parts.push(cylG(0.1, 0.18, 3.2, 0.7, 4.8, 0.2, 0x6b5a48, 5).rotateZ(-0.35));
    parts.push(cylG(0.1, 0.18, 3.2, -0.6, 4.8, -0.3, 0x6b5a48, 5).rotateZ(0.32));
    parts.push(blobG(2.6, 0, 7.4, 0, 0x4f7f3a, 1.3, 0.8));
    parts.push(blobG(2.0, 1.9, 6.6, 0.6, 0x5a8a3f, 2.7, 0.85));
    parts.push(blobG(2.1, -1.8, 6.8, -0.5, 0x4a7a36, 4.1, 0.85));
    parts.push(blobG(1.8, 0.4, 6.4, -1.9, 0x568640, 5.3, 0.9));
    parts.push(blobG(1.7, -0.3, 8.9, 0.8, 0x62934a, 6.1, 0.85));
  } else if (kind === 'round') {
    parts.push(cylG(0.16, 0.26, 3, 0, 1.5, 0, 0x5f5040, 6));
    parts.push(blobG(2.0, 0, 4.4, 0, 0x3f6e33, 7.7, 1.05));
    parts.push(blobG(1.4, 0.8, 5.4, 0.3, 0x4c7d3b, 8.2, 1));
  } else { // hedge
    parts.push(blobG(0.9, -0.8, 0.7, 0, 0x3e6a31, 9.1, 0.8));
    parts.push(blobG(0.95, 0.7, 0.75, 0.1, 0x46733a, 9.7, 0.8));
  }
  return merge(parts);
}
function lampGeo() {
  return merge([
    cylG(0.1, 0.16, 9, 0, 4.5, 0, 0x3c4246, 8),
    boxG(0.5, 0.5, 0.5, 0, 0.25, 0, 0x50565a),
    boxG(1.9, 0.12, 0.12, 0.85, 8.9, 0, 0x3c4246),
    boxG(0.9, 0.22, 0.42, 1.7, 8.8, 0, 0x2b3033),
    boxG(0.8, 0.04, 0.34, 1.7, 8.67, 0, 0xfff6dc),
  ]);
}
function fenceGeo() {
  const parts = [boxG(3.0, 0.6, 0.55, 0, 0.3, 0, 0xb9b5ab), boxG(0.16, 2.6, 0.16, -1.42, 1.3 + 0.3, 0, 0x2f2622)];
  for (let i = 0; i < 13; i++) parts.push(boxG(0.045, 1.9, 0.045, -1.3 + i * 0.205, 0.6 + 0.95, 0, 0x3b2f29));
  parts.push(boxG(3.0, 0.07, 0.09, 0, 2.5, 0, 0x2f2622));
  parts.push(boxG(3.0, 0.06, 0.08, 0, 0.75, 0, 0x2f2622));
  return merge(parts);
}
function carGeo() {
  const body = new THREE.BoxGeometry(4.3, 0.75, 1.8, 1, 1, 1).translate(0, 0.72, 0);
  const cab = new THREE.BoxGeometry(2.3, 0.62, 1.62).translate(-0.2, 1.4, 0);
  // taper the cabin roof
  const cp = cab.attributes.position;
  for (let i = 0; i < cp.count; i++) if (cp.getY(i) > 1.5) { cp.setX(i, cp.getX(i) * 0.82 - 0.05); cp.setZ(i, cp.getZ(i) * 0.9); }
  const parts = [colored(body, 0xffffff), colored(cab, 0x22282e)];
  for (const [x, z] of [[1.35, 0.85], [-1.35, 0.85], [1.35, -0.85], [-1.35, -0.85]]) parts.push(cylG(0.36, 0.36, 0.28, 0, 0, 0, 0x151515, 10).rotateX(Math.PI / 2).translate(x, 0.36, z));
  parts.push(boxG(0.05, 0.16, 1.3, 2.16, 0.86, 0, 0xfff3d0));
  parts.push(boxG(0.05, 0.14, 1.4, -2.16, 0.86, 0, 0xb3261e));
  return merge(parts);
}
function benchGeo() {
  return merge([boxG(1.9, 0.08, 0.5, 0, 0.45, 0, 0x8a6a4a), boxG(1.9, 0.4, 0.06, 0, 0.75, -0.24, 0x8a6a4a), boxG(0.08, 0.45, 0.45, -0.8, 0.22, 0, 0x33383b), boxG(0.08, 0.45, 0.45, 0.8, 0.22, 0, 0x33383b)]);
}

const matTree = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
const matMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.55 });
const matCar = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.6 });
const matWood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 });
// painted plastic: faceted bright trees, candy-coloured cars, no chrome
matTree.flatShading = true; matTree.color.setRGB(1.25, 1.45, 1.0);
matMetal.metalness = 0.15; matMetal.roughness = 0.5;
matCar.metalness = 0.05; matCar.roughness = 0.35;
const CAR_COLORS = [0xff6b6b, 0xffd166, 0x4dabf7, 0x63e6be, 0xffffff, 0xf783ac, 0x9775fa, 0xffa94d, 0x74c0fc, 0xffffff];

class PropSet {
  constructor(name, geo, mat, half, cap, opt = {}) {
    this.name = name; this.geo = geo; this.mat = mat; this.half = half;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0; this.mesh.castShadow = opt.shadow ?? true; this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.items = []; this.mass = opt.mass || 1; this.cap = cap;
    this.colored = !!opt.colored;
    this.vanish = !!opt.vanish;
    scene.add(this.mesh);
    sets.push(this);
  }
  add(x, z, yaw = 0, s = 1, color = null) {
    if (this.items.length >= this.cap) return;
    const it = { x, z, yaw, s, color, alive: true, i: this.items.length };
    this.items.push(it);
    this.mesh.count = this.items.length;
    this.place(it);
    if (this.colored) this.mesh.setColorAt(it.i, new THREE.Color(color || 0xffffff));
  }
  place(it) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(it.x, terrain.groundY(it.x, it.z), it.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw), new THREE.Vector3(it.s, it.s, it.s));
    this.mesh.setMatrixAt(it.i, m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  hide(it) { it.alive = false; this.mesh.setMatrixAt(it.i, new THREE.Matrix4().makeScale(0, 0, 0)); this.mesh.instanceMatrix.needsUpdate = true; }
  restore() { for (const it of this.items) { it.alive = true; this.place(it); } if (this.colored && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true; }
  bounds(it) {
    const [hx, hy, hz] = this.half;
    const c = Math.abs(Math.cos(it.yaw)), s = Math.abs(Math.sin(it.yaw));
    const ex = (hx * c + hz * s) * it.s, ez = (hx * s + hz * c) * it.s;
    const gy = terrain.groundY(it.x, it.z);
    return [it.x - ex, gy, it.z - ez, it.x + ex, gy + 2 * hy * it.s, it.z + ez];
  }
}

// a knocked-loose prop: same shape, now a physics body
class PropBody {
  constructor(set, it) {
    this.set = set; this.it = it;
    const [hx, hy, hz] = set.half;
    this.hx = hx * it.s; this.hy = hy * it.s; this.hz = hz * it.s;
    this.massOverride = set.mass * it.s * it.s * it.s;
    this.pos = new THREE.Vector3(it.x, terrain.groundY(it.x, it.z) + this.hy, it.z);
    this.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw);
    this.vel = new THREE.Vector3(); this.ang = new THREE.Vector3();
    this.sleep = false; this.still = 0; this.dyn = false;
    let mat = set.mat;
    if (set.colored) { mat = set.mat.clone(); mat.color.set(it.color || 0xffffff); }
    this.mesh = new THREE.Mesh(set.geo, mat);
    this.mesh.scale.setScalar(it.s);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    this.sync();
  }
  sync() {
    // geometry origin is at its base: offset by -hy along the body's up axis
    this.mesh.quaternion.copy(this.quat);
    this.mesh.position.set(0, -this.hy, 0).applyQuaternion(this.quat).add(this.pos);
  }
  get maxH() { return Math.max(this.hx, this.hy, this.hz); }
  dispose() { scene.remove(this.mesh); if (this.mesh.material !== this.set.mat) this.mesh.material.dispose(); loose.delete(this); }
}

export function knock(set, it, vel, ang) {
  if (!it.alive) return null;
  set.hide(it);
  // greenery doesn't fly off intact: it bursts into leaves and is gone
  if (set.vanish) { if (hooks.vanish) hooks.vanish(set, it); return null; }
  const b = new PropBody(set, it);
  loose.add(b);
  P.makeDynamic(b, vel, ang);
  if (hooks.knock) hooks.knock(set, it, b);
  return b;
}

let tree1, tree2, hedge, lamps, fence, cars, benches;
export function build() {
  const rng = mulberry(77);
  tree1 = new PropSet('tree', treeGeo('zelkova'), matTree, [2.6, 5.2, 2.6], 520, { mass: 6, vanish: true });
  tree2 = new PropSet('tree', treeGeo('round'), matTree, [1.9, 3.3, 1.9], 300, { mass: 3, vanish: true });
  hedge = new PropSet('hedge', treeGeo('hedge'), matTree, [1.6, 0.8, 1.0], 400, { mass: 0.8, shadow: false, vanish: true });
  lamps = new PropSet('lamp', lampGeo(), matMetal, [1.2, 4.6, 0.3], 160, { mass: 1.5 });
  fence = new PropSet('fence', fenceGeo(), matMetal, [1.5, 1.35, 0.3], 220, { mass: 1.2 });
  cars = new PropSet('car', carGeo(), matCar, [2.2, 0.9, 0.95], 120, { mass: 6, colored: true });
  benches = new PropSet('bench', benchGeo(), matWood, [1.0, 0.5, 0.3], 60, { mass: 0.6 });
  if (MAP.doc) { zoneProps(rng); return; }

  const onRoad = (x, z) => (z > R5.road.z0 - 1 && z < R5.road.z1 + 1) || Math.abs(x + 160) < 11 || Math.abs(x - 160) < 11 || (z > -153 && z < -133);
  // street trees outside the fence and on the far sidewalk
  const nearGate = (x, w) => R5.gates.some((g) => Math.abs(x - g) < w);
  for (let x = -146; x <= 146; x += 10.5) {
    if (nearGate(x, 8)) continue;
    tree1.add(x + rand(-0.6, 0.6), 68.2, rng() * 6.3, 0.95 + rng() * 0.25);
  }
  for (let x = -300; x <= 300; x += 12) if (Math.abs(x) > 150 || true) { if (Math.abs(Math.abs(x) - 177) < 8) continue; tree2.add(x + rng() * 2, 103.5, rng() * 6.3, 0.9 + rng() * 0.3); }
  for (let z = -300; z <= 300; z += 12) { if (onRoad(-173, z) && Math.abs(z - 86) < 16) continue; tree2.add(-173, z, rng() * 6.3, 0.9 + rng() * 0.3); tree2.add(173, z + 6, rng() * 6.3, 0.9 + rng() * 0.3); }
  // big trees between the fence and the podium (they frame the reference photo)
  for (let x = -142; x <= 100; x += 12) {
    if ((x > -48 && x < 2) || nearGate(x, 7)) continue; // entrance forecourt and gate walk
    tree1.add(x + rng() * 4, 41 + rng() * 14, rng() * 6.3, 1.05 + rng() * 0.3);
    if (rng() < 0.5) tree2.add(x + 6 + rng() * 3, 36 + rng() * 6, rng() * 6.3, 0.9 + rng() * 0.3);
  }
  tree1.add(3.5, 49, 1.2, 1.3); // the big zelkova in the middle of the reference photo
  tree1.add(-50, 46, 2.2, 1.15); tree2.add(16, 40, 0.4, 1.1);
  for (let x = 128; x <= 146; x += 9) tree1.add(x, 46 + rng() * 6, rng() * 6.3, 1.1);
  // hedges along the inside of the fence
  for (let x = -146; x <= 146; x += 3.2) { if (nearGate(x, 7)) continue; hedge.add(x, 60.4, 0, 0.55 + rng() * 0.2); }
  // side lawns and back
  for (let i = 0; i < 26; i++) tree1.add(-140 + rng() * 26, -126 + rng() * 146, rng() * 6.3, 0.9 + rng() * 0.35);
  for (let i = 0; i < 20; i++) tree1.add(128 + rng() * 16, -120 + rng() * 140, rng() * 6.3, 0.9 + rng() * 0.35);
  // context lots: clumps of trees on the painted lawns
  for (const [x0, z0, x1, z1, n] of [[-140, 160, -100, 176, 6], [60, 158, 140, 176, 10], [240, 30, 300, 110, 16], [-300, -40, -270, 20, 10], [200, -300, 300, -230, 22], [-300, -300, -200, -230, 22], [-60, -250, -20, -240, 4]])
    for (let i = 0; i < n; i++) (rng() < 0.6 ? tree1 : tree2).add(x0 + rng() * (x1 - x0), z0 + rng() * (z1 - z0), rng() * 6.3, 0.85 + rng() * 0.4);
  // street lamps
  for (let x = -300; x <= 300; x += 28) { if (Math.abs(Math.abs(x) - 160) < 14) continue; lamps.add(x, 72.6, Math.PI, 1); lamps.add(x + 14, 99.4, 0, 1); }
  for (let z = -290; z <= 290; z += 30) { if (Math.abs(z - 86) < 16 || Math.abs(z + 143) < 14) continue; lamps.add(-148.5, z, 0, 1); lamps.add(148.5, z, Math.PI, 1); }
  for (const x of [-95, -60, -25, 10, 45, 80]) lamps.add(x, -114, -Math.PI / 2, 0.8);
  lamps.add(-3.2, 64.9, Math.PI, 1); // the lamp post right next to the photo position
  // the iron fence along the street (gaps for the pedestrian gate and the car gate)
  for (let x = -148.5; x <= 148.5; x += 3) { if (nearGate(x, 6)) continue; fence.add(x, R5.fenceZ, 0, 1); }
  // cars: stopped traffic on the main road, parked behind the podium, side streets
  const colors = CAR_COLORS;
  const pc = () => colors[Math.floor(rng() * colors.length)];
  for (let x = -300; x <= 300; x += 9 + rng() * 14) { if (rng() < 0.35) continue; cars.add(x, [76, 80, 84][Math.floor(rng() * 3)], 0, 1, pc()); }
  for (let x = -300; x <= 300; x += 9 + rng() * 14) { if (rng() < 0.4) continue; cars.add(x, [88, 92, 96][Math.floor(rng() * 3)], Math.PI, 1, pc()); }
  for (let x = -99; x <= 99; x += 2.6) { if (rng() < 0.5) cars.add(x + 1.3, -130.5, Math.PI / 2, 1, pc()); }
  for (let z = -290; z <= 290; z += 14 + rng() * 20) { if (rng() < 0.5) continue; cars.add(-163, z, Math.PI / 2, 1, pc()); }
  for (let z = -290; z <= 290; z += 14 + rng() * 20) { if (rng() < 0.5) continue; cars.add(157, z, -Math.PI / 2, 1, pc()); }
  if (cars.mesh.instanceColor) cars.mesh.instanceColor.needsUpdate = true;
  // benches in the forecourt and on the sidewalk
  for (const x of [-40, -34, -12, -6]) benches.add(x, 56, 0, 1);
  for (let x = -130; x <= 130; x += 37) benches.add(x + 5, 64.2, Math.PI, 1);
}

// props for data-driven zones: tree clumps on lawns, street trees and lamps on the sidewalk
// edges, cars parked on the open asphalt
function zoneProps(rng) {
  const pick = (arr, n) => { const out = []; for (let i = 0; i < n && arr.length; i++) out.push(arr[Math.floor(rng() * arr.length)]); return out; };
  const colors = CAR_COLORS;
  for (const [x, z] of pick(layout.lawns, 420)) (rng() < 0.6 ? tree1 : tree2).add(x + rand(-1.8, 1.8), z + rand(-1.8, 1.8), rng() * 6.3, 0.85 + rng() * 0.4);
  for (const [x, z] of pick(layout.walks, 200)) tree2.add(x + rand(-1, 1), z + rand(-1, 1), rng() * 6.3, 0.85 + rng() * 0.3);
  for (const [x, z] of pick(layout.lawns, 160)) hedge.add(x, z, rng() < 0.5 ? 0 : Math.PI / 2, 0.55 + rng() * 0.2);
  for (const [x, z] of pick(layout.walks, 120)) lamps.add(x, z, rng() * 6.3, 1);
  const lots = layout.asphalt.filter((a) => a[2] >= 3 && a[2] <= 6);
  for (const [x, z] of pick(lots, 115)) { const a = rng() < 0.5 ? 0 : Math.PI / 2; cars.add(x + rand(-1, 1), z + rand(-1, 1), a + (rng() < 0.5 ? Math.PI : 0), 1, colors[Math.floor(rng() * colors.length)]); }
  // traffic on the public roads, street trees and lamps along their sidewalks
  for (const [x, z, dir] of pick(layout.roads, 70)) {
    if (dir === 2) continue;
    const a = dir === 0 ? 0 : Math.PI / 2;
    cars.add(x + rand(-0.6, 0.6), z + rand(-0.6, 0.6), a + (rng() < 0.5 ? Math.PI : 0), 1, colors[Math.floor(rng() * colors.length)]);
  }
  for (const [x, z] of layout.rows) tree1.add(x + rand(-0.4, 0.4), z + rand(-0.4, 0.4), rng() * 6.3, 0.8 + rng() * 0.25);
  layout.curbs.forEach(([x, z], i) => { if (i % 3 === 0) tree1.add(x + rand(-0.5, 0.5), z + rand(-0.5, 0.5), rng() * 6.3, 0.95 + rng() * 0.25); else if (i % 7 === 1) lamps.add(x, z, rng() * 6.3, 1); });
  if (cars.mesh.instanceColor) cars.mesh.instanceColor.needsUpdate = true;
  for (const [x, z] of pick(layout.walks, 40)) benches.add(x, z, rng() * 6.3, 1);
}

// ---------- interactions
export function blast(c, R, power, up = 6) {
  let n = 0;
  for (const set of sets) {
    for (const it of set.items) {
      if (!it.alive) continue;
      const dx = it.x - c.x, dz = it.z - c.z;
      if (Math.abs(dx) > R + 4 || Math.abs(dz) > R + 4) continue;
      const gy = terrain.groundY(it.x, it.z);
      const d = Math.hypot(dx, (gy + set.half[1] * it.s) - c.y, dz);
      if (d > R) continue;
      const f = 1 - d / R;
      const dir = new THREE.Vector3(dx, 0, dz).normalize();
      const vel = dir.multiplyScalar(power * f * rand(0.6, 1.1)).add(new THREE.Vector3(0, up * f * rand(0.6, 1.3) + 2, 0));
      const ang = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(4 * f + 0.5);
      knock(set, it, vel, ang);
      n++;
    }
  }
  return n;
}

export function raycast(o, d, maxT) {
  let best = null;
  for (const set of sets) for (const it of set.items) {
    if (!it.alive) continue;
    const b = set.bounds(it);
    const r = rayBox(o, d, b[0], b[1], b[2], b[3], b[4], b[5]);
    if (r && r.t < maxT) { maxT = r.t; best = { set, it, t: r.t, n: r.n }; }
  }
  return best;
}

terrain.listeners.push((x0, x1, z0, z1) => {
  for (const set of sets) for (const it of set.items) {
    if (!it.alive || it.x < x0 || it.x > x1 || it.z < z0 || it.z > z1) continue;
    if (terrain.depthAt(it.x, it.z) > 0.6) knock(set, it, new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)), new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)));
  }
});

export function reset() {
  for (const b of [...loose]) { P.removeBody(b); b.dispose(); }
  loose.clear();
  for (const s of sets) s.restore();
}
