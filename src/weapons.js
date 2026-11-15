// The six weapons. Each one is an "action" with its own phases (prepare -> travel -> impact ->
// aftermath) and runs from the main loop until it reports it's finished.
import * as THREE from 'three';
import { scene, camera, controls, exposure, grabLight, flashLight, keepSharp, composer } from './engine.js';
import * as TOY from './toyweapons.js';
import * as terrain from './terrain.js';
import * as B from './blocks.js';
import * as P from './physics.js';
import * as S from './structure.js';
import * as SG from './staticgrid.js';
import * as props from './props.js';
import * as FX from './fx.js';
import * as A from './audio.js';
import { rand, clamp, lerp, smooth01, randomUnit, TAU } from './util.js';

export const actions = [];
export const stats = { missilesLaunched: 0, missileImpacts: 0, salvos: 0, laserPoints: 0, meteors: 0, bombs: 0, hammers: 0, nukes: 0, rounds: 0, roundHits: 0, slashes: 0 };
export const ui = { toast: null, banner: null, onAttack: null };
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

function sizeAt(p) { return clamp(camera.position.distanceTo(p) / 140, 0.65, 1.8); }

// ---------------------------------------------------------------- shared impact
/** destruction + effects at c. size: 1 small .. 7 meteor */
export function detonate(c, size, opt = {}) {
  const gy = terrain.groundY(c.x, c.z);
  const above = c.y - gy;
  const r = opt.radius ?? 4.5 * size;
  // decide before the blast whether we hit a rubble pile (the blast itself creates loose chunks)
  const onRubble = P.bodiesNear(c, Math.max(4, r * 0.5)).length > 0;
  const res = S.blast(c, { radius: r, power: opt.power ?? 12 + 6 * size, up: opt.up ?? 4 + 2.5 * size, dmg: opt.dmg ?? 2.2, dir: opt.dir || null, maxRelease: opt.maxRelease ?? 600, heat: opt.heat ?? 0.6 });
  props.blast(c, r * 1.5, 10 + 5 * size, 5 + 2 * size);
  if (above < r * 0.7 && opt.dig !== false) terrain.dig(c.x, c.z, opt.digR ?? r * 0.75, opt.digD ?? (0.9 * size + 0.5) * (1 - above / (r * 0.7)), { rim: 0.22 });
  // a blast on a rubble pile still reaches the structure underneath
  const under = onRubble ? SG.raycast(c, DOWN, r * 1.6) : null;
  if (under && under.t > 1) {
    const u = c.clone().addScaledVector(DOWN, under.t);
    const r2 = S.blast(u, { radius: r * 0.8, power: (opt.power ?? 12 + 6 * size) * 0.7, up: 3, dmg: 1.6, maxRelease: 200, heat: 0.3 });
    res.released += r2.released; res.glass += r2.glass;
  }
  if (!opt.noFx) FX.explosion(c, size * 0.9, { wave: r * 3 });
  if (res.glass) { FX.glassBurst(c, Math.min(140, res.glass * 3), null, 8 + 3 * size); A.glass(res.glass, c); }
  A.boom(size * 0.7, c);
  if (res.released > 10) A.crumble(Math.min(2, res.released / 60), c);
  return res;
}

// physics/structure feedback -> dust, sounds
let lastImpactFx = 0;
P.hooks.impact = (im) => {
  const b = im.b, m = b.mass;
  if (m < 2 || im.v < 9) return;
  const now = performance.now();
  if (now - lastImpactFx < 12) return;
  lastImpactFx = now;
  const c = new THREE.Vector3(im.x, im.y, im.z);
  const s = clamp(Math.cbrt(m) * 0.6, 0.6, 5);
  for (let i = 0; i < 3 + s * 2; i++) FX.dust(c.x + rand(-s, s), c.y + rand(0, s), c.z + rand(-s, s), rand(-4, 4), rand(1, 4), rand(-4, 4), rand(2, 4.5), 2 * s, 7 * s, 0.5);
  if (m > 20) FX.chipBurst(c, Math.min(10, 2 + s * 2), 6 + s, undefined, [0.15, 0.5]);
  A.thud(im.v * Math.min(1, m / 40), c);
};
P.hooks.clusterLanded = (cl) => {
  const bb = cl.list.reduce((a, p) => { a.x += p.pos.x; a.z += p.pos.z; a.n++; return a; }, { x: 0, z: 0, n: 0 });
  const c = new THREE.Vector3(bb.x / bb.n, 0, bb.z / bb.n); c.y = terrain.groundY(c.x, c.z);
  FX.dustRing(c, 10, 22, 70, 0.65, [8, 26]);
  FX.dustPuff(c.clone().add(new THREE.Vector3(0, 8, 0)), 50, 20, 6, 0.55, [8, 22]);
  FX.shake(0.9, c); A.boom(3, c); A.crumble(2, c);
  if (ui.banner && cl.list.length > 80) ui.banner('붕괴!', `${cl.list[0].bld ? cl.list[0].bld.name : '건물'}이(가) 무너졌습니다`);
};
S.events.collapse = (b) => { if (ui.toast) ui.toast(`연쇄 붕괴 · ${b.name}`); };
const chipColor = (k) => (k.kind === B.K.CURTAIN || k.kind === B.K.RIBBON ? 0x8fa6b5 : (k.kind === B.K.STONE ? 0xd4d2cb : 0x8e8c87));
S.events.crumb = (k, v, big) => {
  const n = big ? Math.min(6, 1 + Math.round(k.vol / 40)) : 1;
  for (let i = 0; i < n; i++) FX.chips.spawn(k.pos.x + rand(-k.hx, k.hx), k.pos.y + rand(-k.hy, k.hy), k.pos.z + rand(-k.hz, k.hz), (v ? v.x : 0) + rand(-4, 4), (v ? v.y : 0) + rand(-2, 5), (v ? v.z : 0) + rand(-4, 4), big ? rand(0.4, 1.3) : Math.max(0.25, k.maxH * 1.4), chipColor(k));
  if (big && Math.random() < 0.35) FX.dust(k.pos.x, k.pos.y, k.pos.z, rand(-6, 6), rand(0, 6), rand(-6, 6), rand(3, 6), 4, 14, 0.5);
};
P.hooks.toChip = (b) => {
  const n = Math.min(5, 1 + Math.floor(b.vol / 20));
  for (let i = 0; i < n; i++) FX.chips.spawn(b.pos.x + rand(-b.hx, b.hx), b.pos.y + rand(-b.hy, b.hy), b.pos.z + rand(-b.hz, b.hz), b.vel.x + rand(-2, 2), b.vel.y + rand(0, 3), b.vel.z + rand(-2, 2), Math.min(1.4, Math.max(0.3, Math.cbrt(b.vol) * 0.5)), chipColor(b));
  if (b.vol > 10) FX.dust(b.pos.x, b.pos.y, b.pos.z, rand(-3, 3), rand(0, 3), rand(-3, 3), rand(3, 5), Math.cbrt(b.vol) * 1.5, Math.cbrt(b.vol) * 4, 0.5);
};
P.hooks.toRubble = (b) => {
  const r = Math.max(1.5, Math.hypot(b.hx, b.hz) * 1.3);
  terrain.deposit(b.pos.x, b.pos.z, r, Math.min(2.5, b.vol / (Math.PI * r * r) * 1.6));
  terrain.rubbleMark(b.pos.x, b.pos.z, r * 1.3, 0.55);
};
props.hooks.vanish = (set, it) => {
  const gy = terrain.groundY(it.x, it.z), h = set.half[1] * it.s, w = set.half[0] * it.s;
  const c = new THREE.Vector3(it.x, gy + h * 1.2, it.z);
  for (let i = 0; i < 14; i++) FX.chips.spawn(c.x + rand(-w, w), c.y + rand(-h * 0.5, h * 0.6), c.z + rand(-w, w), rand(-7, 7), rand(2, 9), rand(-7, 7), rand(0.2, 0.5), [0x4f7f3a, 0x5a8a3f, 0x3f6e33, 0x6b5a48][i % 4]);
  for (let i = 0; i < 4; i++) FX.dust(c.x + rand(-w, w), c.y, c.z + rand(-w, w), rand(-2, 2), rand(0, 2), rand(-2, 2), rand(1.2, 2.2), w * 0.8, w * 1.8, 0.35, [0.42, 0.5, 0.33]);
};
let lastChunkFx = 0;
S.events.chunk = (p, f) => {
  const now = performance.now();
  if (now - lastChunkFx < 4) return;
  lastChunkFx = now;
  if (Math.random() < 0.5) FX.dust(p.pos.x, p.pos.y, p.pos.z, rand(-3, 3), rand(-1, 2), rand(-3, 3), rand(2, 4), 3, 9, 0.45);
};

// ---------------------------------------------------------------- 1. HAMMER
const hammerGeo = TOY.hammer();
class Hammer {
  constructor(hit) {
    stats.hammers++;
    this.hit = hit; this.t = 0; this.struck = false;
    this.s = clamp(camera.position.distanceTo(hit.point) / 62, 1.1, 3.2);
    this.obj = hammerGeo.clone(); this.obj.scale.setScalar(this.s); scene.add(this.obj);
    this.obj.traverse((m) => { if (m.isMesh) m.material = m.material.clone(); });
    const toCam = camera.position.clone().sub(hit.point); toCam.y = 0;
    if (toCam.lengthSq() < 1e-3) toCam.set(0, 0, 1);
    toCam.normalize();
    this.toCam = toCam;
    const right = new THREE.Vector3().crossVectors(UP, toCam).normalize().negate(); // screen right
    // swing plane: comes over the viewer's right shoulder and chops down into the target,
    // so the hammer is seen in three-quarter profile rather than end-on
    this.a = right.clone().multiplyScalar(0.72).addScaledVector(toCam, 0.7).normalize();
    this.axis = new THREE.Vector3().crossVectors(this.a, UP).normalize();
    this.L = 13.5 * this.s;
    this.pivot = hit.point.clone().addScaledVector(this.a, this.L * 0.8).addScaledVector(UP, this.L * 0.4);
    const rel = hit.point.clone().sub(this.pivot);
    this.phiHit = Math.atan2(rel.dot(UP), rel.dot(this.a)) + Math.PI * 2; // ~205 deg: overhand
    this.trail = [];
    this.trailMesh = makeTrail(0xffffff);
    A.swing();
  }
  headAt(phi) {
    return this.pivot.clone().addScaledVector(this.a, Math.cos(phi) * this.L).addScaledVector(UP, Math.sin(phi) * this.L);
  }
  pose(phi) {
    const head = this.headAt(phi);
    const dir = head.clone().sub(this.pivot).normalize();                 // hands -> head
    const tangent = this.a.clone().multiplyScalar(-Math.sin(phi)).addScaledVector(UP, Math.cos(phi)).normalize(); // direction of travel
    this.obj.position.copy(head);
    const yAxis = dir.clone();                    // local +y: from the handle toward the head
    const zAxis = tangent;                        // head's long axis = striking direction
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    this.obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    return head;
  }
  update(dt) {
    this.t += dt;
    const t = this.t, D = Math.PI / 180;
    const RAISE = 88 * D, BACK = 62 * D, HIT = this.phiHit;
    let phi;
    if (t < 0.18) phi = lerp(RAISE, BACK, smooth01(t / 0.18));                      // wind-up: pull back
    else if (t < 0.31) { const k = (t - 0.18) / 0.13; phi = lerp(BACK, HIT, k * k * (2.2 - 1.2 * k)); } // chop
    else if (t < 0.40) phi = HIT;                                                     // contact (hit-stop)
    else if (t < 0.66) phi = HIT - 0.42 * Math.sin((t - 0.40) / 0.26 * Math.PI) * Math.exp(-(t - 0.40) * 5); // recoil
    else phi = HIT - (t - 0.66) * 1.5;
    const head = this.pose(phi);
    if (t > 0.17 && t < 0.33) { this.trail.push(head.clone()); if (this.trail.length > 16) this.trail.shift(); }
    else if (this.trail.length) this.trail.shift();
    updateTrail(this.trailMesh, this.trail, this.axis, 2.6 * this.s, [1, 0.95, 0.85]);
    if (!this.struck && t >= 0.31) { this.struck = true; this.strike(); }
    const fade = t > 0.66 ? Math.max(0, 1 - (t - 0.66) / 0.25) : 1;
    this.obj.traverse((m) => { if (m.isMesh) { m.material.transparent = fade < 1; m.material.opacity = fade; } });
    if (t > 0.92) { scene.remove(this.obj); this.obj.traverse((m) => { if (m.isMesh) m.material.dispose(); }); scene.remove(this.trailMesh); this.trailMesh.geometry.dispose(); return false; }
    return true;
  }
  strike() {
    const h = this.hit, c = h.point;
    const swingDir = this.a.clone().multiplyScalar(-Math.sin(this.phiHit)).addScaledVector(UP, Math.cos(this.phiHit)).normalize();
    FX.hitstop(0.09); FX.shake(0.65, c); FX.punch(3.2);
    A.clang(c);
    const n = h.normal || UP;
    if (h.kind === 'prop') {
      props.knock(h.set, h.it, swingDir.clone().multiplyScalar(26).add(new THREE.Vector3(0, 10, 0)), randomUnit(new THREE.Vector3()).multiplyScalar(6));
    } else if (h.kind === 'dyn') {
      const b = h.body;
      const v = swingDir.clone().multiplyScalar(30).add(new THREE.Vector3(0, 12, 0));
      if (b instanceof B.Piece) S.hitRubble(b, 0.7, v);
      else { P.wake(b); b.vel.add(v); }
      const under = SG.raycast(c, DOWN, 8);
      if (under) S.blast(c.clone().addScaledVector(DOWN, under.t), { radius: 2.4 + this.s, power: 12, up: 2, dmg: 2.2, splitBias: 0.7 });
    }
    const R = 3.4 + 1.6 * this.s;
    if (h.kind === 'terrain') {
      terrain.dig(c.x, c.z, R * 0.8, 1.2 + 0.5 * this.s, { rim: 0.3 });
      FX.chipBurst(c, 18, 10, [0x5b4a39, 0x6e5a45, 0x7d7a73]);
      FX.dustRing(c, 1, 9, 22, 0.55, [2, 7]);
      props.blast(c, R * 1.6, 12, 8);
    } else {
      const res = S.blast(c, { radius: R, power: 24, up: 6, dmg: 2.7, dir: n.clone().negate().lerp(swingDir, 0.45).normalize(), splitBias: 0.85, heat: 0 });
      if (res.glass) { FX.glassBurst(c.clone().addScaledVector(n, 1), Math.min(80, 12 + res.glass * 4), n, 9); A.glass(res.glass + 4, c); }
      FX.chipBurst(c.clone().addScaledVector(n, 0.8), 40, 20);
      FX.dustPuff(c.clone().addScaledVector(n, 1.5), 12, 2.5, 4, 0.5, [2, 6]);
      if (res.released > 3) A.crumble(0.6, c);
      props.blast(c, R * 1.4, 12, 6);
    }
    FX.glow(c.x + n.x, c.y + n.y, c.z + n.z, 0.12, 4, 16, [2.4, 2.2, 2.0, 1]);
    for (let i = 0; i < 30; i++) { const v = randomUnit(new THREE.Vector3()).lerp(n, 0.5).normalize().multiplyScalar(rand(10, 32)); FX.spark(c.x, c.y, c.z, v.x, v.y, v.z, rand(0.25, 0.6), 0.2); }
    FX.shockwave(c, 10 * this.s, 0.35, 0xffffff, false);
  }
}

// a ribbon trail mesh
function makeTrail(color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 2 * 3), 3));
  g.setAttribute('a', new THREE.BufferAttribute(new Float32Array(64 * 2), 1));
  const idx = []; for (let i = 0; i < 63; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color(color) } },
    vertexShader: 'attribute float a; varying float vA; void main(){ vA = a; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 uC; varying float vA; void main(){ gl_FragColor = vec4(uC*vA*1.4, vA); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; scene.add(mesh);
  return mesh;
}
function updateTrail(mesh, pts, sideAxis, width, col, widthFn) {
  const pos = mesh.geometry.attributes.position.array, a = mesh.geometry.attributes.a.array;
  const n = Math.min(pts.length, 64);
  for (let i = 0; i < n; i++) {
    const k = i / Math.max(1, n - 1);
    const w = widthFn ? widthFn(k) : width * k;
    let sx = sideAxis.x, sy = sideAxis.y, sz = sideAxis.z;
    if (!sideAxis.isVector3) { const s = sideAxis(i, pts); sx = s.x; sy = s.y; sz = s.z; }
    pos[6 * i] = pts[i].x - sx * w; pos[6 * i + 1] = pts[i].y - sy * w; pos[6 * i + 2] = pts[i].z - sz * w;
    pos[6 * i + 3] = pts[i].x + sx * w; pos[6 * i + 4] = pts[i].y + sy * w; pos[6 * i + 5] = pts[i].z + sz * w;
    a[2 * i] = a[2 * i + 1] = k * k * 0.75;
  }
  mesh.geometry.setDrawRange(0, Math.max(0, (n - 1) * 6));
  mesh.geometry.attributes.position.needsUpdate = true; mesh.geometry.attributes.a.needsUpdate = true;
  if (col && mesh.material.uniforms && mesh.material.uniforms.uC) mesh.material.uniforms.uC.value.setRGB(col[0], col[1], col[2]);
}

// ---------------------------------------------------------------- 2. BOMB
const bombProto = TOY.bomb();
class Bomb {
  constructor(hit) {
    stats.bombs++;
    this.hit = hit; this.t = 0; this.phase = 'fly';
    this.s = sizeAt(hit.point) * 1.1;
    this.obj = bombProto.clone(); this.obj.scale.setScalar(this.s); scene.add(this.obj);
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    this.start = camera.position.clone().addScaledVector(right, 7).add(new THREE.Vector3(0, -6, 0)).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 12);
    this.target = hit.point.clone().addScaledVector(hit.normal || UP, 1.25 * this.s);
    const d = this.start.distanceTo(this.target);
    this.T = clamp(0.55 + d / 260, 0.7, 1.7);
    const g = new THREE.Vector3(0, -P.GRAV, 0);
    this.v0 = this.target.clone().sub(this.start).addScaledVector(g, -0.5 * this.T * this.T).divideScalar(this.T);
    this.spin = randomUnit(new THREE.Vector3()).multiplyScalar(8);
    this.fuseT = 0.55; this.light = grabLight(); this.light.light.color.set(0xffa040); this.light.light.distance = 40;
    this.light.update = () => true;
    this.sfx = A.fuseLoop(); this.sfx.set(0.25);
    A.whoosh(this.start, 0.6);
  }
  tipWorld() { return new THREE.Vector3(...this.obj.userData.tip).multiplyScalar(this.s).applyQuaternion(this.obj.quaternion).add(this.obj.position); }
  update(dt) {
    this.t += dt;
    if (this.phase === 'fly') {
      const t = Math.min(this.t, this.T);
      this.obj.position.copy(this.start).addScaledVector(this.v0, t).add(new THREE.Vector3(0, -0.5 * P.GRAV * t * t, 0));
      this.obj.rotateOnWorldAxis(_v.copy(this.spin).normalize(), this.spin.length() * dt);
      if (this.t >= this.T) { this.phase = 'fuse'; this.t = 0; this.obj.position.copy(this.target); FX.dustPuff(this.target, 6, 1, 3, 0.4, [1.5, 4]); A.thud(8, this.target); }
    } else if (this.phase === 'fuse') {
      // final seconds: the fuse burns down, a red pulse speeds up
      const k = this.t / this.fuseT;
      const pulse = Math.sin(this.t * (16 + 40 * k)) > 0 ? 1 : 0.25;
      this.light.light.color.set(pulse > 0.5 ? 0xff3020 : 0xffa040);
      if (Math.floor(this.t * (8 + 26 * k)) !== this._lb) { this._lb = Math.floor(this.t * (8 + 26 * k)); A.blip(900 + 900 * k); }
      this.obj.scale.setScalar(this.s * (1 + 0.12 * k * pulse));
      if (this.t >= this.fuseT) { this.explode(); return false; }
    }
    // fuse sparks
    const tip = this.tipWorld();
    for (let i = 0; i < 3; i++) FX.spark(tip.x, tip.y, tip.z, rand(-5, 5), rand(1, 7), rand(-5, 5), rand(0.15, 0.4), 0.12, [1, 0.8, 0.45]);
    if (Math.random() < 0.6) FX.smoke(tip.x, tip.y, tip.z, rand(-0.5, 0.5), 1.5, rand(-0.5, 0.5), 1.2, 0.4 * this.s, 1.6 * this.s, 0.2, 0.4);
    FX.glow(tip.x, tip.y, tip.z, 0.08, 0.9 * this.s, 0.3, [2, 1.4, 0.6, 1]);
    this.light.light.position.copy(tip); this.light.light.intensity = 300 * (0.6 + Math.random() * 0.6);
    return true;
  }
  explode() {
    scene.remove(this.obj); this.sfx.stop(0.05);
    this.light.update = null;
    const c = this.target;
    FX.hitstop(0.05);
    detonate(c, 2.4, { radius: 13, power: 38, up: 15, digR: 9.5, digD: 4.6 });
    FX.shake(0.55, c); FX.punch(3);
    FX.chipBurst(c, 70, 34);
    FX.screenFlash(0.08);
  }
}

// ---------------------------------------------------------------- 3. LASER
const beamMat = (inner, outer, alpha) => new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 }, uA: { value: alpha }, uIn: { value: new THREE.Color(...inner) }, uOut: { value: new THREE.Color(...outer) } },
  vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
  fragmentShader: `uniform float uT; uniform float uA; uniform vec3 uIn; uniform vec3 uOut; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  float h(float x){ return fract(sin(x*91.7)*43758.5); }
  void main(){
    float f = abs(dot(vN, vV));             // 1 at the centre line of the cylinder, 0 at its silhouette
    float core = pow(f, 2.2);
    float n = 0.75 + 0.25*sin(vUv.y*140.0 - uT*90.0) + 0.15*sin(vUv.y*37.0 + uT*40.0);
    vec3 c = mix(uOut, uIn, core) * (core*0.9 + 0.1) * n;
    gl_FragColor = vec4(c*uA, uA*core);
  }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
const satProto = TOY.satellite();
const pathMat = new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(1.0, 0.25, 0.6) } },
  vertexShader: 'attribute float a; varying float vA; void main(){ vA=a; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: 'uniform float uT; uniform vec3 uC; varying float vA; void main(){ float p = 0.6+0.4*sin(uT*14.0 - vA*0.6); gl_FragColor = vec4(uC*p*1.6, 0.9); }',
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

/** live preview ribbon of the path being drawn */
export class LaserPath {
  constructor() {
    this.pts = []; this.nrm = []; this.cut = []; this.raw = []; this.rawN = [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2048 * 2 * 3), 3));
    g.setAttribute('a', new THREE.BufferAttribute(new Float32Array(2048 * 2), 1));
    const idx = []; for (let i = 0; i < 2047; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, pathMat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 10;
    scene.add(this.mesh);
  }
  add(p, n) {
    const last = this.raw[this.raw.length - 1];
    if (last && last.distanceTo(p) < 1.2) return false;
    // fill long gaps (fast mouse) with interpolated points re-projected onto real surfaces only
    if (last && last.distanceTo(p) > 4) {
      const steps = Math.ceil(last.distanceTo(p) / 2);
      for (let i = 1; i < steps; i++) {
        const q = last.clone().lerp(p, i / steps);
        const hit = surfaceBelow(q.x, q.z, Math.max(q.y, p.y, last.y) + 30);
        if (hit && Math.abs(hit.point.y - q.y) < 40) { this.raw.push(hit.point); this.rawN.push(hit.normal); }
      }
    }
    if (this.raw.length >= 2000) return false;
    this.raw.push(p.clone()); this.rawN.push((n || UP).clone());
    this.smooth(Math.max(0, this.pts.length - 4));
    this.rebuild();
    return true;
  }
  /** hand-drawn input wobbles: average each point with its neighbours on the ground plane
   *  (heights stay on the picked surfaces) so the preview and the cut follow a clean line */
  smooth(from) {
    const R = this.raw, W = 3;
    for (let i = from; i < R.length; i++) {
      let sx = 0, sz = 0, sw = 0;
      for (let k = -W; k <= W; k++) {
        const j = i + k; if (j < 0 || j >= R.length) continue;
        if (Math.abs(R[j].y - R[i].y) > 3) continue; // don't drag ground points onto roofs
        const w = 1 - Math.abs(k) / (W + 1); sx += R[j].x * w; sz += R[j].z * w; sw += w;
      }
      const q = new THREE.Vector3(sx / sw, R[i].y, sz / sw);
      if (i === 0 || i === R.length - 1) q.copy(R[i]);
      this.pts[i] = q; this.nrm[i] = this.rawN[i].clone(); this.cut[i] = this.cutPoint(q, this.rawN[i]);
    }
    this.pts.length = this.nrm.length = this.cut.length = R.length;
  }
  /** a line drawn on a wall means "cut into this building": the kerf runs 6 m behind the facade */
  cutPoint(p, n) {
    if (Math.abs(n.y) > 0.5) return p.clone();
    const h = new THREE.Vector3(n.x, 0, n.z).normalize();
    return p.clone().addScaledVector(h, -6);
  }
  rebuild() {
    const pos = this.mesh.geometry.attributes.position.array, a = this.mesh.geometry.attributes.a.array;
    const n = this.pts.length, w = 0.8;
    const ix = this.mesh.geometry.index.array; let cnt = 0;
    let len = 0, prevSide = null;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i], nr = this.nrm[i];
      const prev = this.pts[Math.max(0, i - 1)], next = this.pts[Math.min(n - 1, i + 1)];
      // width runs sideways on the ground plane for floors/roofs, and along the wall for facades
      const t = next.clone().sub(prev); const flat = Math.abs(nr.y) > 0.5;
      if (flat) t.y = 0;
      if (t.lengthSq() < 1e-6) t.set(1, 0, 0); t.normalize();
      const side = flat ? new THREE.Vector3(-t.z, 0, t.x) : new THREE.Vector3().crossVectors(t, nr);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      if (prevSide && side.dot(prevSide) < 0) side.negate(); // no twisting
      prevSide = side.clone();
      side.multiplyScalar(w);
      const o = p.clone().addScaledVector(nr, 0.25);
      // a jump between a roof and the ground is not drawn as a wall-climbing streak
      const jump = i > 0 && Math.abs(p.y - this.pts[i - 1].y) > 2.5 && Math.abs(p.y - this.pts[i - 1].y) > 1.5 * Math.hypot(p.x - this.pts[i - 1].x, p.z - this.pts[i - 1].z);
      if (i > 0) len += p.distanceTo(this.pts[i - 1]);
      pos[6 * i] = o.x - side.x; pos[6 * i + 1] = o.y - side.y; pos[6 * i + 2] = o.z - side.z;
      pos[6 * i + 3] = o.x + side.x; pos[6 * i + 4] = o.y + side.y; pos[6 * i + 5] = o.z + side.z;
      a[2 * i] = a[2 * i + 1] = len;
      if (i > 0 && !jump) { const q = 2 * (i - 1); ix[cnt++] = q; ix[cnt++] = q + 1; ix[cnt++] = q + 2; ix[cnt++] = q + 1; ix[cnt++] = q + 3; ix[cnt++] = q + 2; }
    }
    this.mesh.geometry.index.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, cnt);
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.a.needsUpdate = true;
  }
  update(dt) { pathMat.uniforms.uT.value += dt; }
  dispose() { scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}

/** first solid surface straight down from (x, y0, z) */
export let surfaceBelow = () => null; // set by main.js (needs the shared picker)
export function setSurfaceProbe(fn) { surfaceBelow = fn; }

class Laser {
  constructor(path) {
    stats.laserPoints += path.pts.length;
    this.pts = (path.cut && path.cut.length === path.pts.length ? path.cut : path.pts).map((p) => p.clone());
    this.path = path;
    // densify to 1.2 m steps
    const dense = [this.pts[0]];
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1], b = this.pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.2));
      if (Math.hypot(b.x - a.x, b.z - a.z) < 0.3) continue; // vertical hops (facade -> roof) add no cut length
      for (let k = 1; k <= n; k++) dense.push(a.clone().lerp(b, k / n));
    }
    this.dense = dense;
    let len = 0; for (let i = 1; i < dense.length; i++) len += Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z);
    this.len = len;
    this.spot = dense.length < 3;
    this.dur = this.spot ? 1.3 : clamp(len / 42, 0.9, 4.6);
    const cen = dense.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(dense.length);
    const off = camera.getWorldDirection(new THREE.Vector3()); off.y = 0; off.normalize();
    // the platform hangs beyond the cut as seen from the player, so the beams lean away from the camera
    this.emit = new THREE.Vector3(cen.x + off.x * 70, Math.max(320, cen.y + 260), cen.z + off.z * 70);
    this.sat = satProto.clone(); this.sat.scale.setScalar(1.0); this.sat.position.copy(this.emit).add(new THREE.Vector3(0, 260, 0)); scene.add(this.sat);
    this.phase = 'charge'; this.t = 0; this.idx = 0;
    this.beams = [beamMat([1.5, 1.4, 1.6], [1.0, 0.35, 0.75], 0.85), beamMat([1.1, 0.25, 0.75], [0.7, 0.08, 0.4], 0.32), beamMat([0.6, 0.12, 0.45], [0.3, 0.03, 0.25], 0.1)]
      .map((m) => { const b = new THREE.Mesh(beamGeo, m); b.frustumCulled = false; b.visible = false; b.renderOrder = 5; scene.add(b); return b; });
    this.radii = [0.95, 2.7, 6.2];
    this.light = grabLight(); this.light.update = () => true; this.light.light.color.set(0xff70c8); this.light.light.distance = 90; this.light.light.intensity = 0;
    this.touched = new Set(); this.cutAt = new Map(); this.lastBurst = 0; this.tipY = 0;
    A.charge(0.95);
    if (ui.toast) ui.toast(this.spot ? '궤도 레이저 · 정밀 조사' : `궤도 레이저 · 절단선 ${Math.round(len)} m`);
  }
  setBeam(to, scale = 1) {
    const d = to.clone().sub(this.emit), L = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize());
    this.beams.forEach((b, i) => { b.visible = true; b.position.copy(this.emit); b.quaternion.copy(q); const r = this.radii[i] * scale * (0.92 + Math.random() * 0.16); b.scale.set(r, L, r); b.material.uniforms.uT.value = this.t; });
  }
  update(dt) {
    this.t += dt;
    this.path.update(dt);
    if (this.phase === 'charge') {
      const k = Math.min(1, this.t / 0.95);
      this.sat.position.lerpVectors(this.emit.clone().add(new THREE.Vector3(0, 260, 0)), this.emit.clone().add(new THREE.Vector3(0, 6, 0)), smooth01(k));
      this.sat.rotation.y += dt * 0.6;
      exposure.dip = Math.max(exposure.dip, 0.38 * k);
      const lens = this.emit.clone().add(new THREE.Vector3(0, -6, 0));
      FX.glow(lens.x, lens.y, lens.z, 0.1, 3 + 14 * k * k, 2, [1.2, 0.45, 0.9, 1]);
      for (let i = 0; i < 6; i++) { // energy converging into the lens
        const v = randomUnit(new THREE.Vector3()).multiplyScalar(rand(18, 40));
        FX.plasmaStreak(lens.x + v.x, lens.y + v.y, lens.z + v.z, -v.x * 2.4, -v.y * 2.4, -v.z * 2.4, 0.35, 0.5, [1, 0.5, 0.9]);
      }
      // aiming pulse on the first point
      const p0 = this.dense[0];
      if (Math.random() < 0.5) FX.glow(p0.x, p0.y + 0.5, p0.z, 0.15, 2, 7 * k, [1.6, 0.3, 0.9, 1]);
      if (k > 0.35) { this.setBeam(p0, 0.06 + 0.06 * Math.sin(this.t * 50)); this.beams[0].visible = true; this.beams[1].visible = false; this.beams[2].visible = false; }
      FX.shake(0.012 * k);
      if (k >= 1) {
        this.phase = 'fire'; this.t = 0;
        exposure.dip = 0.12; exposure.boost = Math.max(exposure.boost, 0.12);
        FX.screenFlash(0.12); FX.shake(0.5, p0);
        this.sfx = A.laserLoop(); this.sfx.set(0.55);
        A.boom(1.5, p0);
      }
      return true;
    }
    if (this.phase === 'fire') {
      const k = Math.min(1, this.t / this.dur);
      const upto = this.spot ? 0 : Math.min(this.dense.length - 1, Math.floor(k * (this.dense.length - 1)));
      while (this.idx <= upto) { this.burn(this.idx); this.idx++; }
      if (this.spot) this.spotBurn(dt);
      const cur = this.dense[Math.min(upto, this.dense.length - 1)];
      const gy = terrain.groundY(cur.x, cur.z);
      const top = this.topAt(cur.x, cur.z);
      const contact = new THREE.Vector3(cur.x, Math.max(top, gy), cur.z);
      this.setBeam(contact, 1 + 0.15 * Math.sin(this.t * 30));
      // contact fireworks
      for (let i = 0; i < 10; i++) { const v = randomUnit(new THREE.Vector3()); v.y = Math.abs(v.y) + 0.2; v.multiplyScalar(rand(10, 34)); FX.spark(contact.x, contact.y + 0.5, contact.z, v.x, v.y, v.z, rand(0.3, 0.9), 0.22, [1, 0.6, 0.9]); }
      for (let i = 0; i < 2; i++) FX.ember(contact.x, contact.y + 0.5, contact.z, rand(-8, 8), rand(6, 16), rand(-8, 8), rand(1, 2.2), 0.5);
      FX.glow(contact.x, contact.y + 1, contact.z, 0.08, 7, 11, [1.1, 0.3, 0.75, 1]);
      if (Math.random() < 0.5) FX.smoke(contact.x + rand(-2, 2), contact.y + 2, contact.z + rand(-2, 2), rand(-1, 1), rand(3, 6), rand(-1, 1), rand(2.5, 4.5), 3, 10, 0.45, 0.6);
      this.light.light.position.set(contact.x, contact.y + 6, contact.z);
      this.light.light.intensity = 2200 * (0.8 + Math.random() * 0.4);
      exposure.dip = Math.max(exposure.dip, 0.1); // the sky stays a little dimmed while the beam is on
      FX.shake(0.05, contact);
      FX.heatHaze(0.12);
      if (k >= 1) { this.phase = 'fade'; this.t = 0; this.finish(); }
      return true;
    }
    // fade out
    const k = Math.min(1, this.t / 0.45);
    this.beams.forEach((b, i) => { b.scale.x *= 0.86; b.scale.z *= 0.86; b.material.uniforms.uA.value *= 0.9; });
    this.light.light.intensity *= 0.85;
    this.sat.position.y += dt * 60 * k;
    if (k >= 1) {
      for (const b of this.beams) { scene.remove(b); b.material.dispose(); }
      scene.remove(this.sat); this.path.dispose();
      this.light.update = null;
      return false;
    }
    return true;
  }
  topAt(x, z) {
    let top = -Infinity;
    SG.query(x - 0.6, x + 0.6, z - 0.6, z + 0.6, (p) => { if (Math.abs(p.pos.x - x) < p.hx + 0.5 && Math.abs(p.pos.z - z) < p.hz + 0.5) top = Math.max(top, p.pos.y + p.hy); });
    return top;
  }
  burn(i) {
    const p = this.dense[i];
    const prev = this.dense[Math.max(0, i - 1)], next = this.dense[Math.min(this.dense.length - 1, i + 1)];
    const dir = next.clone().sub(prev); dir.y = 0; if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0); dir.normalize();
    const top = this.topAt(p.x, p.z);
    const res = S.sliceAt(p, dir, 1.9, 0.8);
    for (const b of res.touched) { this.touched.add(b); this.cutAt.set(b, { p: p.clone(), dir: dir.clone() }); }
    // vertical string of blasts down the kerf through the floors
    if (top > -Infinity && i - this.lastBurst >= 4) {
      this.lastBurst = i;
      const gy = terrain.groundY(p.x, p.z);
      const n = Math.min(6, Math.ceil((top - gy) / 18));
      for (let k = 0; k < n; k++) {
        const y = lerp(gy + 2, top, (k + Math.random() * 0.5) / n);
        const c = new THREE.Vector3(p.x, y, p.z);
        for (let j = 0; j < 3; j++) FX.fire(c.x + rand(-1, 1), c.y, c.z + rand(-1, 1), rand(-6, 6), rand(-2, 6), rand(-6, 6), rand(0.4, 0.7), 2, 6, 0.9);
        FX.glassBurst(c, 8, null, 12);
        // side blow-out: chunks next to the kerf are kicked away from the cut
        const side = new THREE.Vector3(-dir.z, 0, dir.x);
        for (const s of [1, -1]) {
          const q = c.clone().addScaledVector(side, 3.4 * s);
          S.blast(q, { radius: 2.4, power: 12, up: 5, dmg: 2.4, dir: side.clone().multiplyScalar(s), splitBias: 0.5, heat: 0.9, maxRelease: 12 });
        }
      }
      A.glass(10, p);
      if (Math.random() < 0.6) A.boom(0.6, p);
    }
    // ground: molten groove and scorch
    terrain.dig(p.x, p.z, 2.2, 1.8, { profile: 'groove', rim: 0.08, heatAmt: 0.75, quiet: true });
    if (i > 0) terrain.scorchLine(prev.x, prev.z, p.x, p.z, 4.5, 0.7);
    // loose rubble and props in the beam
    for (const b of P.bodiesNear(p, 4)) {
      if (Math.hypot(b.pos.x - p.x, b.pos.z - p.z) > 3) continue;
      if (b instanceof B.Piece) { if (b.maxH > 0.8) S.shatter(b, 3, () => new THREE.Vector3(rand(-8, 8), rand(6, 14), rand(-8, 8))).forEach((k) => B.setHeat(k, 1)); else S.vaporize(b); }
      else { P.wake(b); b.vel.add(new THREE.Vector3(rand(-6, 6), 10, rand(-6, 6))); }
    }
    props.blast(new THREE.Vector3(p.x, terrain.groundY(p.x, p.z) + 1, p.z), 5, 10, 8);
  }
  spotBurn(dt) {
    // a single point: bore straight down
    const p = this.dense[0];
    this._acc = (this._acc || 0) + dt;
    if (this._acc > 0.12) {
      this._acc = 0;
      S.sliceAt(p, new THREE.Vector3(1, 0, 0), 2.2, 1.3).touched.forEach((b) => S.markDirty(b));
      S.sliceAt(p, new THREE.Vector3(0, 0, 1), 2.2, 1.3);
      terrain.dig(p.x, p.z, 3.2, 3.5, { profile: 'shaft', rim: 0.1, heatAmt: 1.5 });
      FX.glassBurst(p.clone().add(new THREE.Vector3(0, 6, 0)), 6, null, 10);
    }
  }
  finish() {
    terrain.flush();
    if (this.sfx) this.sfx.stop(0.4);
    for (const b of this.touched) S.markDirty(b);
    for (const [b, c] of this.cutAt) S.noteCut(b, c.p, c.dir);
    const end = this.dense[this.dense.length - 1];
    FX.explosion(new THREE.Vector3(end.x, terrain.groundY(end.x, end.z) + 1, end.z), 1.2);
    A.boom(1.2, end);
  }
}

// ---------------------------------------------------------------- 4. METEOR
const meteorMat = new THREE.MeshStandardMaterial({ color: 0xa77a58, roughness: 0.65, metalness: 0, emissive: 0xffffff, emissiveIntensity: 1, flatShading: true });
meteorMat.onBeforeCompile = (sh) => {
  sh.uniforms.uHeat = meteorMat.userData.uHeat = { value: 0 };
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvOP = position;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
uniform float uHeat; varying vec3 vOP;
float mh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
float mn(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(mh(i),mh(i+vec3(1,0,0)),f.x),mix(mh(i+vec3(0,1,0)),mh(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(mh(i+vec3(0,0,1)),mh(i+vec3(1,0,1)),f.x),mix(mh(i+vec3(0,1,1)),mh(i+vec3(1,1,1)),f.x),f.y),f.z); }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  // cartoon rock: flat warm brown, darker crater spots, crisp cracks that glow hotter as it falls
  float n = mn(vOP*1.3)*0.55 + mn(vOP*3.1)*0.3 + mn(vOP*7.0)*0.15;
  float crater = smoothstep(0.64, 0.68, mn(vOP*2.3 + 7.0));
  diffuseColor.rgb *= mix(1.0, 0.62, crater);
  float crack = 1.0 - smoothstep(0.02, 0.05, abs(n - 0.5));
  float hot = clamp(uHeat, 0.0, 2.0);
  totalEmissiveRadiance = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.85, 0.35), clamp(hot - 0.6, 0.0, 1.0)) * crack * min(1.0, hot) * 1.2;
}`);
};
meteorMat.userData.uHeat = { value: 0 };
const meteorGeo = TOY.meteorGeo();
// the meteor's wake is alpha-blended (not additive) so it reads against a bright daytime sky:
// white-hot at the rock, orange, then a long dark smoke tail
const meteorTrailMat = () => new THREE.ShaderMaterial({
  vertexShader: 'attribute float a; varying float vA; void main(){ vA = a; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `varying float vA; void main(){
    float k = clamp(vA / 0.75, 0.0, 1.0);
    vec3 smoke = vec3(0.95, 0.92, 0.88), fire = vec3(1.0, 0.55, 0.18), hot = vec3(1.0, 0.93, 0.62); // cream puff -> orange -> pale yellow
    vec3 c = mix(smoke, fire, smoothstep(0.35, 0.8, k));
    c = mix(c, hot, smoothstep(0.88, 1.0, k));
    gl_FragColor = vec4(c, smoothstep(0.0, 0.35, k) * 0.6); }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
});
class Meteor {
  constructor(hit) {
    stats.meteors++;
    this.c = hit.point.clone();
    this.R = 19;
    // cinematic vantage: low and to the side of the target, looking up into the sky the rock comes from
    const fromCam = camera.position.clone().sub(this.c); fromCam.y = 0;
    if (fromCam.lengthSq() < 1) fromCam.set(0, 0, 1);
    fromCam.normalize();
    const side = new THREE.Vector3().crossVectors(UP, fromCam).normalize();
    this.cam0 = { pos: camera.position.clone(), target: controls.target.clone() };
    this.camPos = this.c.clone().addScaledVector(fromCam, 230).addScaledVector(side, 70).add(new THREE.Vector3(0, 34, 0));
    this.camPos.y = Math.max(this.camPos.y, terrain.groundY(this.camPos.x, this.camPos.z) + 20);
    // the rock comes from far beyond the target, high up, slightly across the view: visible the whole way
    // start far away along the camera ray through the upper-left of the screen: both ends of the
    // path are then on screen, so the whole fall is visible from wherever the player is looking
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(-0.6, 0.86), camera);
    this.start = camera.position.clone().addScaledVector(rc.ray.direction, 1100);
    if (this.start.y < this.c.y + 140) this.start.y = this.c.y + 140;
    this.dir = this.c.clone().sub(this.start).normalize();
    this.T = 2.5; this.t = 0; this.phase = 'fall';
    this.rock = new THREE.Mesh(meteorGeo, meteorMat); this.rock.scale.setScalar(this.R); this.rock.castShadow = true;
    this.shell = TOY.cometFlame(); // a cartoon comet tail streaming back from the rock
    this.grp = new THREE.Group(); this.grp.add(this.rock, this.shell); scene.add(this.grp);
    this.spinAxis = randomUnit(new THREE.Vector3());
    this.trail = []; this.trailMesh = makeTrail(0xffffff); this.trailMesh.renderOrder = 4;
    this.trailMesh.material = meteorTrailMat();
    this.light = grabLight(); this.light.update = () => true; this.light.light.color.set(0xff8a3a); this.light.light.distance = 600;
    this.sfx = A.rumbleLoop(); this.sfx.set(0.05);
    // the camera stays free during the fall so the player can move to see past buildings
    if (ui.toast) ui.toast('운석 접근 중 · 카메라는 자유롭게 움직일 수 있습니다');
    A.whoosh(this.start, 3);
  }

  posAt(t) { const k = Math.pow(clamp(t / this.T, 0, 1), 1.5); return this.start.clone().lerp(this.c, k); }
  cine(dt, look) {
    // ease the camera to the vantage point and aim between rock and target
    const k = 1 - Math.exp(-dt * 3.2);
    camera.position.lerp(this.camPos, k);
    controls.target.lerp(look, k * 1.4 > 1 ? 1 : k * 1.4);
  }
  update(dt) {
    this.t += dt;
    if (this.phase === 'fall') {
      const k = Math.min(1, this.t / this.T);
      const pos = this.posAt(this.t);
      this.grp.position.copy(pos);
      this.rock.rotateOnWorldAxis(this.spinAxis, dt * 1.2);
      const heat = 0.5 + 1.2 * k;
      meteorMat.userData.uHeat.value = heat;
      this.shell.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.dir.clone().negate());
      const fl = 1 + 0.07 * Math.sin(this.t * 37) + 0.05 * Math.sin(this.t * 23); // flicker
      this.shell.scale.set(this.R * 1.2 * fl, this.R * 1.2 * fl, this.R * (1.4 + 1.6 * k) * fl);
      // burning wake: hot near the rock, dark smoke further back
      const back = this.dir.clone().negate();
      const n = 5 + Math.round(6 * k);
      for (let i = 0; i < n; i++) {
        const o = randomUnit(new THREE.Vector3()).multiplyScalar(this.R * 0.6);
        const along = rand(0.6, 2.4) * this.R;
        FX.fire(pos.x + o.x + back.x * along, pos.y + o.y + back.y * along, pos.z + o.z + back.z * along, back.x * 40 + o.x, back.y * 40 + o.y, back.z * 40 + o.z, rand(0.3, 0.6), this.R * 0.8, this.R * rand(1.3, 2.0), rand(0.9, 1.2));
      }
      for (let i = 0; i < 2; i++) {
        const o = randomUnit(new THREE.Vector3()).multiplyScalar(this.R * 0.8);
        const along = rand(4.5, 7) * this.R; // well behind the rock, so it never darkens the fireball itself
        FX.smoke(pos.x + o.x + back.x * along, pos.y + o.y + back.y * along, pos.z + o.z + back.z * along, o.x * 0.2, 1, o.z * 0.2, rand(7, 10), this.R * 1.0, this.R * rand(2.2, 3.0), 0.12, 0.55); // white cartoon puffs
      }
      for (let i = 0; i < 5; i++) { const v = randomUnit(new THREE.Vector3()).multiplyScalar(25).addScaledVector(back, 80); FX.spark(pos.x, pos.y, pos.z, v.x, v.y, v.z, rand(0.5, 1.1), 1.2, [1, 0.6, 0.3]); }
      FX.glow(pos.x, pos.y, pos.z, 0.08, this.R * 5, this.R * 4, [1.4, 0.6, 0.18, 1]);
      exposure.dip = Math.max(exposure.dip, 0.32 * k); // the sky darkens as the fireball fills it
      FX.heatHaze(0.25 * k * k);
      this.trail.push(pos.clone()); if (this.trail.length > 60) this.trail.shift();
      const camDir = camera.position.clone().sub(pos).normalize();
      const sideT = new THREE.Vector3().crossVectors(this.dir, camDir).normalize();
      updateTrail(this.trailMesh, this.trail, sideT, this.R, null, (q) => this.R * 0.7 * Math.pow(q, 0.8));
      this.light.light.position.copy(pos);
      this.light.light.intensity = 1.2e4 * k * k + 600;
      this.sfx.set(0.1 + 0.7 * k);
      FX.shake(0.015 + 0.05 * k * k);
      // look from the sky down to the target as the rock arrives
      // frame both the incoming rock and the target, then settle on the target for the hit
      if (k >= 1) { this.impact(); this.phase = 'after'; this.t = 0; }
      return true;
    }
    // aftermath: hold the shot, then hand the camera back
    const k = Math.min(1, this.t / 14);
    meteorMat.userData.uHeat.value = lerp(1.2, 0.25, k);
    if (this.trail.length) { this.trail.splice(0, 6); updateTrail(this.trailMesh, this.trail, new THREE.Vector3(1, 0, 0), this.R, null, (q) => this.R * 0.7 * Math.pow(q, 0.8)); }
    this.light.light.intensity = 1500 * (1 - k);
    if (Math.random() < 0.25 * (1 - k)) FX.smoke(this.grp.position.x + rand(-6, 6), this.grp.position.y + 4, this.grp.position.z + rand(-6, 6), rand(-1, 1), rand(4, 8), rand(-1, 1), rand(5, 8), 6, 18, 0.25, 0.55);
    if (k >= 1) { this.light.update = null; scene.remove(this.trailMesh); return false; }
    return true;
  }
  impact() {
    const c = this.c;
    this.sfx.stop(0.1);
    FX.screenFlash(0.75); FX.hitstop(0.1); FX.cam.slowmo = 0.35; FX.punch(8); FX.shake(1.25, c); FX.heatHaze(0.5);
    exposure.boost = 0.35;
    flashLight(c.clone().add(new THREE.Vector3(0, 30, 0)), 0xffd3a0, 3e4, 1.1, 700);
    // destruction
    const res = S.blast(c, { radius: 40, power: 54, up: 26, dmg: 2.4, maxRelease: 520, heat: 1, pulverize: 0.55 });
    props.blast(c, 82, 46, 20);
    terrain.dig(c.x, c.z, 42, 18, { rim: 0.28, heatAmt: 0 });
    terrain.addHeat(c.x, c.z, 16, 1.5);
    terrain.scorch(c.x, c.z, 95, 1);
    // effects
    FX.explosion(c.clone().add(new THREE.Vector3(0, 6, 0)), 5, { wave: 110 });
    FX.shockwave(c, 260, 2.0, 0xffd9b0, true);
    FX.dustRing(c, 30, 46, 90, 0.6, [8, 24]);
    FX.glassBurst(c.clone().add(new THREE.Vector3(0, 20, 0)), 200, null, 30);
    FX.chipBurst(c, 150, 48, [0x4b3b2d, 0x5f4c3a, 0x6e6a63, 0x3a2f25, 0x8a8277], [0.4, 1.6]);
    // rising fire column and a lingering mushroom of smoke
    FX.every(0.08, 2.6, (tt) => {
      const r = 8 + tt * 5, y = 8 + tt * 36;
      FX.fire(c.x + rand(-r, r) * 0.5, c.y + y * rand(0.4, 1), c.z + rand(-r, r) * 0.5, rand(-5, 5), rand(14, 28), rand(-5, 5), rand(0.7, 1.2), 8, 20, rand(0.7, 1.0) * (1 - tt / 3));
      FX.smoke(c.x + rand(-r, r), c.y + y + rand(0, 16), c.z + rand(-r, r), rand(-4, 4), rand(8, 14), rand(-4, 4), rand(7, 11), 12, 32, 0.4, 0.75);
    });
    FX.every(0.07, 5, () => { const v = randomUnit(new THREE.Vector3()); FX.ember(c.x + v.x * 60, c.y + 60 + rand(0, 60), c.z + v.z * 60, rand(-4, 4), rand(-2, 2), rand(-4, 4), rand(3, 5), rand(0.5, 1)); });
    // the core stays, half buried and glowing
    this.grp.remove(this.shell);
    remnants.push(this.grp);
    this.rock.scale.setScalar(this.R * 0.55);
    this.grp.position.set(c.x, terrain.groundY(c.x, c.z) + this.R * 0.22, c.z);
    A.boom(6, c); A.crumble(2, c); A.glass(40, c);
    if (ui.banner) ui.banner('운석 충돌', `구조물 ${res.released + res.pulverized}개 파괴 · 지름 76 m 크레이터`);
  }
}
export const W_cine = { active: false };

// ---------------------------------------------------------------- 5. MISSILE x3
const missileProto = TOY.missile();
class Missile {
  constructor(salvo, start, target, delay, k) {
    this.salvo = salvo; this.target = target; this.delay = delay; this.t = 0; this.state = 'wait';
    this.start = start;
    const d = start.distanceTo(target);
    this.T = clamp(0.8 + d / 420, 0.9, 1.7) + k * 0.08;
    // a shallow, weaving arc that stays inside the view, then a short terminal dive
    const side = new THREE.Vector3().crossVectors(UP, target.clone().sub(start)).normalize();
    this.c1 = start.clone().lerp(target, 0.35).add(new THREE.Vector3(0, 18 + d * 0.05, 0)).addScaledVector(side, (k - 1) * 22);
    this.c2 = target.clone().add(new THREE.Vector3(0, 30 + d * 0.07, 0)).addScaledVector(side, (1 - k) * 14);
    this.obj = missileProto.clone(); this.obj.scale.setScalar(2.3); this.obj.visible = false; scene.add(this.obj);
    this.flame = this.obj.getObjectByName('flame');
  }
  bez(t, out) {
    const u = 1 - t;
    return out.copy(this.start).multiplyScalar(u * u * u).addScaledVector(this.c1, 3 * u * u * t).addScaledVector(this.c2, 3 * u * t * t).addScaledVector(this.target, t * t * t);
  }
  update(dt) {
    if (this.state === 'done') return false;
    this.t += dt;
    if (this.state === 'wait') {
      if (this.t < this.delay) return true;
      this.state = 'fly'; this.t = 0; this.obj.visible = true;
      stats.missilesLaunched++;
      this.sfx = A.rocketLoop(); this.sfx.set(0.25);
      FX.glow(this.start.x, this.start.y, this.start.z, 0.2, 6, 14, [2, 1.3, 0.6, 1]);
    }
    const k = Math.min(1, this.t / this.T), e = k * k * (1.6 - 0.6 * k);
    const pos = this.bez(e, new THREE.Vector3());
    const ahead = this.bez(Math.min(1, e + 0.01), new THREE.Vector3());
    const dir = ahead.sub(pos); if (dir.lengthSq() > 1e-8) dir.normalize(); else dir.copy(this.lastDir || UP);
    this.lastDir = dir.clone();
    this.obj.position.copy(pos);
    this.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    this.obj.rotateZ(this.t * 9);
    this.flame.scale.set(1 + Math.random() * 0.3, 1 + Math.random() * 0.3, 0.8 + Math.random() * 0.6);
    const noz = pos.clone().addScaledVector(dir, -4.4 * 2.3);
    for (let i = 0; i < 3; i++) FX.fire(noz.x, noz.y, noz.z, -dir.x * 30 + rand(-2, 2), -dir.y * 30 + rand(-2, 2), -dir.z * 30 + rand(-2, 2), rand(0.12, 0.28), 1.3, 3.4, 1.2);
    // a continuous smoke ribbon: puffs spaced along the segment travelled this frame
    const prev = this.prevNoz || noz;
    for (let i = 0; i < 3; i++) { const q = prev.clone().lerp(noz, i / 3); FX.smoke(q.x, q.y, q.z, rand(-0.5, 0.5), rand(0, 0.8), rand(-0.5, 0.5), rand(4, 7), 1.6, rand(6, 9), 0.08, 0.6); }
    this.prevNoz = noz.clone();
    FX.glow(noz.x, noz.y, noz.z, 0.06, 4.5, 2, [1.8, 1.1, 0.5, 1]);
    if (k >= 1) this.hit();
    return true;
  }
  hit() {
    // exactly one impact per missile; the impact never schedules more missiles
    if (this.state === 'done') return;
    this.state = 'done';
    stats.missileImpacts++;
    this.salvo.impacts++;
    scene.remove(this.obj);
    if (this.sfx) this.sfx.stop(0.05);
    const c = this.target;
    FX.hitstop(0.03);
    detonate(c, 3.3, { radius: 13, power: 40, up: 15, dir: this.lastDir.clone().multiplyScalar(0.5), digR: 7.5, digD: 3.6 });
  }
}
class Salvo {
  constructor(hit, pickNear) {
    stats.salvos++;
    this.impacts = 0;
    const back = camera.getWorldDirection(new THREE.Vector3()).negate(); back.y = 0; back.normalize();
    const right = new THREE.Vector3().crossVectors(UP, back).normalize();
    const base = camera.position.clone().addScaledVector(back, 30).add(new THREE.Vector3(0, 12, 0));
    const targets = [hit.point.clone()];
    for (let i = 0; i < 2; i++) {
      const a = (i + 0.5) * Math.PI + rand(-0.6, 0.6), r = rand(5, 9);
      const q = pickNear(hit.point.x + Math.cos(a) * r, hit.point.z + Math.sin(a) * r, hit.point.y);
      targets.push(q || hit.point.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)));
    }
    this.missiles = targets.map((t, i) => new Missile(this, base.clone().addScaledVector(right, (i - 1) * 22).add(new THREE.Vector3(0, i * 3, 0)), t, i * 0.14, i));
    if (this.missiles.length !== 3) throw new Error('salvo must contain exactly 3 missiles');
    if (ui.toast) ui.toast('미사일 3발 발사');
  }
  update(dt) {
    let alive = false;
    for (const m of this.missiles) if (m.update(dt)) alive = true;
    return alive;
  }
}

// ---------------------------------------------------------------- 6. NUKE
const nukeProto = TOY.nuke();
const fireballMat = new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 }, uK: { value: 0 } },
  vertexShader: `uniform float uT; varying vec3 vN; varying vec3 vV; varying vec3 vP;
  float hv(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
  float nv(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hv(i),hv(i+vec3(1,0,0)),f.x),mix(hv(i+vec3(0,1,0)),hv(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hv(i+vec3(0,0,1)),hv(i+vec3(1,0,1)),f.x),mix(hv(i+vec3(0,1,1)),hv(i+vec3(1,1,1)),f.x),f.y),f.z); }
  void main(){
    // billowing, lumpy surface instead of a smooth ball
    float b = nv(position*2.2 + vec3(0.0, -uT*0.8, 0.0))*0.6 + nv(position*5.0 + uT*0.5)*0.4;
    vec3 p = position * (0.82 + 0.36*b);
    p.y *= 0.82;
    vP = position; vec4 mv = modelViewMatrix*vec4(p,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `uniform float uT; uniform float uK; varying vec3 vN; varying vec3 vV; varying vec3 vP;
  float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
  float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
  void main(){
    float n = n3(vP*3.0 + vec3(0.0, -uT*1.5, 0.0))*0.6 + n3(vP*7.0 - uT)*0.4;
    float rim = pow(1.0 - abs(dot(vN, vV)), 2.0);
    float heat = clamp(1.25 - uK*1.2 + (n-0.5)*0.8, 0.0, 1.4);
    vec3 c = mix(vec3(0.35,0.06,0.02), vec3(1.6,0.62,0.16), smoothstep(0.15, 0.7, heat));
    c = mix(c, vec3(2.4,2.1,1.6), smoothstep(0.85, 1.3, heat));
    c *= 0.75 + 0.5*n;
    c = mix(c, c*0.35 + vec3(0.18,0.15,0.13), smoothstep(0.55, 1.0, uK));
    gl_FragColor = vec4(c, clamp(1.0 - rim*0.6, 0.0, 1.0) * (1.0 - smoothstep(0.8, 1.0, uK)));
  }`,
  transparent: true, depthWrite: false,
});
class Nuke {
  constructor(hit) {
    stats.nukes++;
    this.g = new THREE.Vector3(hit.point.x, terrain.groundY(hit.point.x, hit.point.z), hit.point.z);
    this.burst = this.g.clone().add(new THREE.Vector3(0, Math.max(hit.point.y - this.g.y, 0) + 26, 0)); // airburst
    const fromCam = camera.position.clone().sub(this.g); fromCam.y = 0;
    if (fromCam.lengthSq() < 1) fromCam.set(0, 0, 1);
    fromCam.normalize();
    const side = new THREE.Vector3().crossVectors(UP, fromCam).normalize();
    this.cam0 = { pos: camera.position.clone(), target: controls.target.clone() };
    this.camPos = this.g.clone().addScaledVector(fromCam, 560).addScaledVector(side, 150).add(new THREE.Vector3(0, 110, 0));
    this.start = this.burst.clone().addScaledVector(side, -60).add(new THREE.Vector3(0, 650, 0));
    this.T = 2.2; this.t = 0; this.phase = 'fall';
    this.obj = nukeProto.clone(); this.obj.scale.setScalar(1.7); scene.add(this.obj);
    this.sfx = A.rumbleLoop(); this.sfx.set(0.04);
    controls.enabled = false; W_cine.active = true;
    if (ui.toast) ui.toast('핵폭탄 투하');
    A.whoosh(this.start, 3);
  }
  cine(dt, look) {
    const k = 1 - Math.exp(-dt * 3);
    camera.position.lerp(this.camPos, k);
    controls.target.lerp(look, Math.min(1, k * 1.4));
  }
  update(dt) {
    this.t += dt;
    if (this.phase === 'fall') {
      const k = Math.min(1, this.t / this.T);
      const pos = this.start.clone().lerp(this.burst, k * k);
      this.obj.position.copy(pos);
      this.obj.rotation.set(Math.sin(this.t * 3.1) * 0.05, this.t * 0.8, Math.sin(this.t * 2.3) * 0.05);
      this.sfx.set(0.05 + 0.4 * k);
      if (Math.random() < 0.5) FX.smoke(pos.x, pos.y + 12, pos.z, rand(-1, 1), rand(1, 3), rand(-1, 1), rand(1.5, 2.5), 1.2, 4, 0.1, 0.35);
      this.cine(dt, this.g.clone().add(new THREE.Vector3(0, 40, 0)).lerp(pos, 0.45 * (1 - smooth01(k * 1.2))));
      if (k >= 1) { this.detonate(); this.phase = 'blast'; this.t = 0; }
      return true;
    }
    const k = Math.min(1, this.t / 4.8);
    // the fireball grows fast, rises and becomes the head of the mushroom
    const r = 105 * (1 - Math.exp(-this.t * 2.6));
    this.fb.scale.setScalar(Math.max(1, r));
    this.fb.position.copy(this.burst).add(new THREE.Vector3(0, this.t * 16, 0));
    this.fb.material.uniforms.uT.value = this.t; this.fb.material.uniforms.uK.value = k;
    this.light.light.position.copy(this.fb.position);
    this.light.light.intensity = 4e4 * Math.pow(1 - k, 2) + 200;
    // hold the wide shot, then hand the camera back
    if (this.t < 2.8) this.cine(dt, this.burst.clone().add(new THREE.Vector3(0, 60 + this.t * 12, 0)));
    else if (W_cine.active) {
      const ee = 1 - Math.exp(-dt * 3.5);
      camera.position.lerp(this.cam0.pos, ee); controls.target.lerp(this.cam0.target, ee);
      if (camera.position.distanceTo(this.cam0.pos) < 2) { camera.position.copy(this.cam0.pos); controls.target.copy(this.cam0.target); controls.enabled = true; W_cine.active = false; }
    }
    if (this.t > 7 && !W_cine.active) { scene.remove(this.fb); this.fb.material.dispose(); this.light.update = null; return false; }
    return true;
  }
  detonate() {
    const c = this.burst, g = this.g;
    scene.remove(this.obj); this.sfx.stop(0.05);
    FX.screenFlash(1.0); FX.hitstop(0.15); FX.cam.slowmo = 0.25; FX.punch(10); FX.shake(1.3, c); FX.heatHaze(0.6);
    exposure.boost = 0.5;
    flashLight(c.clone(), 0xfff0d8, 5e4, 1.6, 1400);
    this.light = grabLight(); this.light.update = () => true; this.light.light.color.set(0xffa050); this.light.light.distance = 900;
    this.fb = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), fireballMat.clone()); this.fb.position.copy(c); this.fb.renderOrder = 3; scene.add(this.fb);
    // destruction: the core is vaporised, everything further out is thrown
    const res = S.blast(g.clone().add(new THREE.Vector3(0, 8, 0)), { radius: 230, power: 110, up: 40, dmg: 1.6, maxRelease: 600, heat: 1, pulverize: 0.7 });
    props.blast(g, 480, 90, 30);
    terrain.dig(g.x, g.z, 115, 36, { rim: 0.3 });
    terrain.addHeat(g.x, g.z, 40, 1.5);
    terrain.scorch(g.x, g.z, 420, 1);
    FX.explosion(c, 6, { wave: 160 });
    FX.shockwave(g, 1000, 3.6, 0xfff1dc, true);
    FX.shockwave(c, 300, 1.4, 0xffffff, true);
    FX.dustRing(g, 110, 110, 220, 0.65, [18, 46]);
    FX.glassBurst(c.clone(), 260, null, 40);
    FX.chipBurst(g, 160, 60, [0x4b3b2d, 0x5f4c3a, 0x6e6a63, 0x3a2f25, 0x8a8277], [0.4, 1.8]);
    // mushroom cloud: a rising stem and a rolling ring-shaped cap
    FX.every(0.05, 6.5, (tt) => {
      const capY = c.y + 40 + Math.min(tt, 4) * 38, capR = 26 + tt * 9;
      for (let j = 0; j < 2; j++) {
        const sy = g.y + rand(0, capY - g.y), sr = 10 + 6 * Math.min(1, tt / 2);
        FX.smoke(g.x + rand(-sr, sr), sy, g.z + rand(-sr, sr), rand(-2, 2), rand(14, 26), rand(-2, 2), rand(6, 9), 18, 40, 0.62, 0.8);
      }
      const sy = g.y + rand(0, capY - g.y);
      if (tt < 2.5) FX.fire(g.x + rand(-6, 6), sy, g.z + rand(-6, 6), rand(-2, 2), rand(18, 30), rand(-2, 2), rand(0.6, 1), 10, 20, 0.9 - tt * 0.25);
      for (let i = 0; i < 5; i++) {
        const a = rand(0, TAU), rr = capR * rand(0.6, 1.05);
        const x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr, y = capY + rand(-12, 16);
        FX.smoke(x, y, z, Math.cos(a) * 6, rand(4, 9), Math.sin(a) * 6, rand(9, 13), 26, 60, 0.5, 0.85);
        if (tt < 2.2) FX.fire(x * 0.7 + c.x * 0.3, y, z * 0.7 + c.z * 0.3, Math.cos(a) * 4, 6, Math.sin(a) * 4, rand(0.7, 1.2), 14, 26, 1.0 - tt * 0.35);
      }
    });
    FX.every(0.08, 7, () => { const v = randomUnit(new THREE.Vector3()); FX.ember(c.x + v.x * 120, c.y + 60 + rand(0, 120), c.z + v.z * 120, rand(-5, 5), rand(-3, 2), rand(-5, 5), rand(3, 6), rand(0.6, 1.2)); });
    A.boom(6, c); setTimeout(() => A.boom(4, c), 450); A.crumble(2, c); A.glass(60, c);
    if (ui.banner) ui.banner('핵폭발', `구조물 ${res.released + res.pulverized}개 파괴 · 반경 230 m 초토화`);
  }
}

// ---------------------------------------------------------------- 7. MACHINE GUN
// Hold to fire. A door-gun just off the bottom-right of the view sprays tracer rounds at the
// cursor; each round chips a little off whatever it hits, so sustained fire chews through
// facades, shreds glass and keeps rubble bouncing.
const tracerGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.5);
const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 2.6, 1.1), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
const RPS = 14, SPEED = 620, SPREAD = 0.012;
// the gun itself: a six-barrel rotary gun hanging off the bottom-right of the view
let rig = null;
function gunRig() {
  if (rig) return rig;
  scene.add(camera); // children of the camera render with it
  const { dark, steel, olive, brass } = TOY.gunMats(); // toy blaster colours
  const g = new THREE.Group(); // +z points down the barrels
  const recoil = new THREE.Group(); g.add(recoil);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.36, 0.9), olive); body.position.z = -0.2; recoil.add(body);
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.42, 16).rotateX(Math.PI / 2), dark); motor.position.set(0, 0.22, -0.35); recoil.add(motor);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.14), dark); grip.position.set(0, -0.3, -0.45); grip.rotation.x = 0.35; recoil.add(grip);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.4), olive); box.position.set(-0.36, -0.08, -0.25); recoil.add(box);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.3), brass); belt.position.set(-0.2, 0.0, -0.05); belt.rotation.y = 0.5; recoil.add(belt);
  const spin = new THREE.Group(); spin.name = 'spin'; spin.position.z = 0.25; recoil.add(spin);
  const clamp1 = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.08, 18).rotateX(Math.PI / 2), dark); clamp1.position.z = 0.1; spin.add(clamp1);
  const clamp2 = clamp1.clone(); clamp2.position.z = 1.05; spin.add(clamp2);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.35, 8).rotateX(Math.PI / 2), steel);
    br.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0.7); spin.add(br);
  }
  const fc = document.createElement('canvas'); fc.width = fc.height = 128;
  { const x = fc.getContext('2d'); const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.25, 'rgba(255,200,110,0.85)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    x.globalCompositeOperation = 'lighter'; x.fillStyle = 'rgba(255,220,150,0.9)';
    for (let i = 0; i < 5; i++) { x.save(); x.translate(64, 64); x.rotate(i / 5 * Math.PI * 2); x.beginPath(); x.moveTo(0, -6); x.lineTo(62, 0); x.lineTo(0, 6); x.fill(); x.restore(); } }
  const ftex = new THREE.CanvasTexture(fc); ftex.colorSpace = THREE.SRGBColorSpace;
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({ map: ftex, color: new THREE.Color(2.2, 1.6, 1.0), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  flash.position.z = 1.55; flash.name = 'flash'; recoil.add(flash);
  const flash2 = flash.clone(); flash2.material = flash.material; flash2.rotation.y = Math.PI / 2; flash2.position.z = 1.75; flash2.scale.set(0.5, 1.6, 1); recoil.add(flash2);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.renderOrder = 10; if (!m.material.transparent) keepSharp(m.material); } });
  g.position.set(1.05, -0.8, -2.7); g.scale.setScalar(0.85);
  g.visible = false;
  g.userData = { recoil, spin, flash, flash2, spinV: 0, kick: 0 };
  camera.add(g);
  rig = g;
  return g;
}
// the lens is narrow (and wider again on portrait screens), which would magnify the rig or push
// it off a tall screen. Keep it at the size it has through the default 45 deg lens, a bit smaller on
// portrait, and inside the right edge.
function placeRig(g) {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const z = 2.7 * Math.tan(Math.PI / 8) / t / clamp(camera.aspect / 1.2, 0.6, 1);
  g.position.set(Math.min(1.05 * z / 2.7, 0.62 * z * t * camera.aspect), -0.8 * z / 2.7, -z);
}
export function setGunVisible(v) { gunRig().visible = v; if (v) placeRig(gunRig()); if (v) gunRig().lookAt(camera.localToWorld(new THREE.Vector3(0, 0, -60))); }
const _aimTmp = new THREE.Vector3();
function rigTick(dt, aim, firing) {
  const g = gunRig(); if (!g.visible) return;
  placeRig(g);
  const u = g.userData;
  // ease the barrels toward the target (or straight ahead when idle)
  const tgt = aim || camera.localToWorld(_aimTmp.set(0, 0, -60));
  const q0 = g.quaternion.clone(); g.lookAt(tgt); const q1 = g.quaternion.clone();
  g.quaternion.copy(q0).slerp(q1, Math.min(1, dt * 18));
  u.spinV += ((firing ? 38 : 0) - u.spinV) * Math.min(1, dt * (firing ? 6 : 1.5));
  u.spin.rotation.z += u.spinV * dt;
  u.kick *= Math.exp(-dt * 22);
  u.recoil.position.z = -u.kick * 0.22; u.recoil.position.y = u.kick * 0.04;
  u.recoil.rotation.x = -u.kick * 0.06;
  u.flash.material.opacity *= Math.exp(-dt * 60);
}
class Gun {
  constructor(hit) {
    this.aim = hit.point.clone(); this.held = true; this.t = 0; this.acc = 1 / RPS; this.rounds = []; this.spin = 0;
    this.light = grabLight(); this.light.update = () => true; this.light.light.color.set(0xffc070); this.light.light.distance = 30;
  }
  muzzle(out) {
    const g = gunRig();
    if (g.visible) { g.updateMatrixWorld(true); return g.userData.flash.getWorldPosition(out); }
    const fwd = camera.getWorldDirection(_v).clone();
    const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
    return out.copy(camera.position).addScaledVector(fwd, 6).addScaledVector(right, 4.2).addScaledVector(UP, -3.2);
  }
  setAim(hit) { if (hit) this.aim.copy(hit.point); }
  stop() { this.held = false; }
  shoot() {
    const from = this.muzzle(new THREE.Vector3());
    const dir = this.aim.clone().sub(from).normalize();
    dir.x += rand(-SPREAD, SPREAD); dir.y += rand(-SPREAD, SPREAD); dir.z += rand(-SPREAD, SPREAD); dir.normalize();
    // where does it land? first of terrain / standing structure / loose body, within 900 m
    let best = 900;
    const tt = terrain.raycast(from, dir, best); if (tt >= 0) best = tt;
    const sh = SG.raycast(from, dir, best); if (sh && sh.t < best) best = sh.t;
    for (const b of P.bodiesNear(this.aim, 12)) {
      const d = b.pos.clone().sub(from).dot(dir); if (d <= 0 || d > best) continue;
      const q = from.clone().addScaledVector(dir, d);
      if (q.distanceTo(b.pos) < b.maxH * 1.1) best = d;
    }
    const mesh = new THREE.Mesh(tracerGeo, tracerMat);
    mesh.scale.set(1, 1, 9); mesh.position.copy(from); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
    scene.add(mesh);
    this.rounds.push({ from, dir, dist: best, s: 0, mesh, hitAny: best < 900 });
    stats.rounds++;
    FX.glow(from.x, from.y, from.z, 0.05, 2.2, 0.6, [2.4, 1.6, 0.7, 1]);
    for (let i = 0; i < 2; i++) FX.spark(from.x, from.y, from.z, dir.x * 20 + rand(-4, 4), dir.y * 20 + rand(-4, 4), dir.z * 20 + rand(-4, 4), 0.08, 0.3);
    this.light.light.position.copy(from); this.light.light.intensity = 900;
    // hand feel: barrel kick, flash, and a short camera recoil with a little sideways jitter
    const u = gunRig().userData; u.kick = Math.min(1.6, u.kick + 0.75);
    u.flash.material.opacity = 1; u.flash.rotation.z = Math.random() * Math.PI; u.flash.scale.setScalar(0.8 + Math.random() * 0.6);
    const back = camera.getWorldDirection(_w).clone().negate();
    FX.cam.kick.addScaledVector(back, 0.22).add(new THREE.Vector3(rand(-0.05, 0.05), 0.07, rand(-0.05, 0.05)));
    FX.shake(0.035); FX.punch(0.22);
    A.gunshot(from);
  }
  impact(r) {
    const c = r.from.clone().addScaledVector(r.dir, r.dist - 0.2);
    stats.roundHits++;
    const res = S.blast(c, { radius: 1.9, power: 18, up: 4, dmg: 1.2, dir: r.dir.clone().multiplyScalar(0.6), maxRelease: 3, heat: 0.05, hitWeight: 0.06 });
    props.blast(c, 2.2, 10, 3);
    const gy = terrain.groundY(c.x, c.z);
    if (c.y - gy < 0.6) { terrain.scorch(c.x, c.z, 0.7, 0.35); if (Math.random() < 0.25) terrain.dig(c.x, c.z, 0.9, 0.12, { rim: 0.1, quiet: true }); }
    const back = r.dir.clone().negate();
    for (let i = 0; i < 4; i++) FX.spark(c.x, c.y, c.z, back.x * 9 + rand(-7, 7), back.y * 9 + rand(-2, 8), back.z * 9 + rand(-7, 7), rand(0.15, 0.35), 0.22);
    FX.chipBurst(c, res.released ? 6 : 3, 9, undefined, [0.12, 0.35]);
    FX.dust(c.x, c.y, c.z, back.x * 2, 1.5, back.z * 2, rand(0.6, 1.2), 0.8, 3.2, 0.45);
    if (res.glass) { FX.glassBurst(c, Math.min(30, res.glass * 4), back, 7); A.glass(res.glass, c); }
    else if (Math.random() < 0.3) A.ricochet(c);
  }
  update(dt) {
    this.t += dt; this.spin += dt;
    rigTick(dt, this.held ? this.aim : null, this.held);
    if (this.held) {
      this.acc += dt;
      while (this.acc >= 1 / RPS) { this.acc -= 1 / RPS; this.shoot(); }
    }
    this.light.light.intensity *= Math.exp(-dt * 40);
    for (let i = this.rounds.length - 1; i >= 0; i--) {
      const r = this.rounds[i];
      r.s += SPEED * dt;
      const tail = Math.max(0, r.s - 9);
      r.mesh.position.copy(r.from).addScaledVector(r.dir, Math.min(r.s, r.dist));
      r.mesh.scale.z = Math.max(0.5, Math.min(r.s, r.dist) - tail);
      if (r.s >= r.dist) {
        scene.remove(r.mesh);
        if (r.hitAny) this.impact(r);
        this.rounds.splice(i, 1);
      }
    }
    if (!this.held && !this.rounds.length) { this.light.update = null; this.light.light.intensity = 0; return false; }
    return true;
  }
}
export function gunStart(hit) {
  if (!hit) return null;
  if (ui.onAttack) ui.onAttack('mg');
  let g = actions.find((x) => x instanceof Gun && x.held);
  if (!g) { g = new Gun(hit); actions.push(g); }
  g.setAim(hit);
  return g;
}
export function gunAim(hit) { const g = actions.find((x) => x instanceof Gun && x.held); if (g) g.setAim(hit); }
export function gunStop() { for (const a of actions) if (a instanceof Gun) a.stop(); }

// ---------------------------------------------------------------- 8. SWORD
// Swipe across the screen: a giant toy sword swings along the swipe and cuts everything on the plane
// through the camera and the swipe (S.slash), within the stretch of screen the swipe covered. Like the
// gun, the sword hangs off the camera: it rests low on the right while the sword is selected.
let srig = null;
const SW_Z = 3, SW_LEN = 7.6; // depth of the rig in front of the camera; blade length in model units
function swordRig() {
  if (srig) return srig;
  scene.add(camera);
  const g = TOY.sword();
  g.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.renderOrder = 10; keepSharp(m.material); } });
  g.visible = false;
  camera.add(g);
  srig = g;
  return g;
}
/** camera-space point for a screen position (NDC) at depth z */
function camPt(nx, ny, z, out = new THREE.Vector3()) {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  return out.set(nx * t * camera.aspect * z, ny * t * z, -z);
}
function restSword(g) { applyPose(g, restPose()); }
let swordOn = false; // the sword is the selected tool (it stays in view between slashes)
export function setSwordVisible(v) { swordOn = v; const g = swordRig(); g.visible = swordOn; if (swordOn) restSword(g); }

// the sword's trail and the wave: white core, sky-blue rim, normal blending so they read on a bright sky
const waveMat = () => new THREE.ShaderMaterial({
  uniforms: { uA: { value: 1 } },
  vertexShader: 'attribute vec2 w; varying vec2 vW; void main(){ vW = w; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform float uA; varying vec2 vW;
    void main(){
      float core = smoothstep(0.0, 0.55, vW.y) * (1.0 - smoothstep(0.85, 1.0, vW.y)); // bright toward the leading edge
      float a = smoothstep(0.0, 0.25, vW.y) * smoothstep(0.0, 0.12, vW.x) * smoothstep(0.0, 0.12, 1.0 - vW.x);
      vec3 c = mix(vec3(0.35, 0.78, 1.0), vec3(1.0), core);
      gl_FragColor = vec4(c, a * uA * 0.95);
    }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
});
/** a strip of n+1 vertex pairs with (along, across) coordinates in attribute w */
function stripMesh(n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 2 * 3), 3));
  const wv = new Float32Array((n + 1) * 2 * 2);
  for (let i = 0; i <= n; i++) { wv[4 * i] = wv[4 * i + 2] = i / n; wv[4 * i + 1] = 0; wv[4 * i + 3] = 1; }
  g.setAttribute('w', new THREE.BufferAttribute(wv, 2));
  const idx = []; for (let i = 0; i < n; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setIndex(idx);
  const m = new THREE.Mesh(g, waveMat()); m.frustumCulled = false; m.renderOrder = 9; scene.add(m);
  return m;
}
function poseOf(grip, target, len) {
  const y = target.clone().sub(grip).normalize();
  const z = new THREE.Vector3(0, 0, 1).addScaledVector(y, -y.z).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return { q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)), p: grip.clone(), s: len / SW_LEN };
}
function restPose() {
  const hh = SW_Z * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  return poseOf(camPt(0.86, -1.1, SW_Z), camPt(0.62, -0.5, SW_Z), hh * 0.72);
}
function applyPose(g, a, b = null, k = 0) {
  if (!b) { g.quaternion.copy(a.q); g.position.copy(a.p); g.scale.setScalar(a.s); return; }
  g.quaternion.copy(a.q).slerp(b.q, k); g.position.copy(a.p).lerp(b.p, k); g.scale.setScalar(lerp(a.s, b.s, k));
}

// timeline (s): wind-up, swing, follow-through hold, back to rest
const SW_WIND = 0.09, SW_SWING = 0.11, SW_HOLD = 0.1, SW_BACK = 0.25;
// rapid slashes overlap: the newest one moves the sword (starting from wherever the last one left it),
// the older ones still fly their waves and fade their trails
let curSlash = null;
class Slash {
  constructor(a, b) {
    this.a = a; this.b = b; this.t = 0;
    const sg = swordRig();
    this.startPose = sg.visible ? { q: sg.quaternion.clone(), p: sg.position.clone(), s: sg.scale.x } : restPose();
    sg.visible = true; curSlash = this;
    const pa = camPt(a.x, a.y, SW_Z), pb = camPt(b.x, b.y, SW_Z), d = pb.clone().sub(pa);
    // the hand sits off to the side of the swipe (below it, or right of a vertical one) and sweeps the blade across
    const hh = SW_Z * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const perp = new THREE.Vector3(-d.y, d.x, 0).normalize();
    if (Math.abs(perp.y) > 0.3 ? perp.y > 0 : perp.x < 0) perp.negate();
    const grip = pa.clone().add(pb).multiplyScalar(0.5).addScaledVector(perp, Math.max(1.3 * hh, 0.55 * d.length()));
    const wind = pa.clone().addScaledVector(d, -0.35), thru = pb.clone().addScaledVector(d, 0.25);
    const len = Math.max(wind.distanceTo(grip), thru.distanceTo(grip)) * 1.02;
    this.grip = grip; this.len = len; this.wind = wind; this.thru = thru;
    this.windPose = poseOf(grip.clone().addScaledVector(perp, 0.25 * hh), wind, len * 0.92); // pulled back and a little lower
    this.thruPose = poseOf(grip, thru, len);
    this.trail = []; this.sides = []; this.trailMesh = stripMesh(40);
    // the cut: the plane through the camera and both ends of the swipe, as far as the swipe reached
    // on screen. Fixed now, so moving the camera while the wave flies changes nothing.
    camera.updateMatrixWorld(); // the matrices may be a frame old (or never rendered yet)
    const rc = new THREE.Raycaster();
    rc.setFromCamera(a, camera); this.da = rc.ray.direction.clone();
    rc.setFromCamera(b, camera); this.db = rc.ray.direction.clone();
    this.o = camera.position.clone();
    this.n = new THREE.Vector3().crossVectors(this.da, this.db);
    this.ok = this.n.lengthSq() > 1e-10;
    if (this.ok) this.n.normalize();
    const vp = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
    const W2 = innerWidth / 2, H2 = innerHeight / 2;
    const ax = a.x * W2, ay = a.y * H2, dx = b.x * W2 - ax, dy = b.y * H2 - ay, L2 = dx * dx + dy * dy;
    const v = new THREE.Vector3();
    this.inside = (p) => { v.copy(p).applyMatrix4(vp); if (v.z > 1 || v.z < -1) return false; const t = ((v.x * W2 - ax) * dx + (v.y * H2 - ay) * dy) / L2; return t > -0.03 && t < 1.03; };
    this.plan = this.ok ? S.slashPlan(this.o, this.n, this.inside) : [];
    this.wave = null; this.hits = 0;
    A.swing();
  }
  update(dt) {
    this.t += dt;
    const g = swordRig(), t = this.t, own = curSlash === this;
    const pose = (...a) => { if (own) applyPose(g, ...a); };
    const t1 = SW_WIND, t2 = t1 + SW_SWING, t3 = t2 + SW_HOLD, t4 = t3 + SW_BACK;
    if (t < t1) pose(this.startPose, this.windPose, smooth01(t / t1));
    else if (t < t2 && own) {
      const k = (t - t1) / SW_SWING, e = k * k * (3 - 2 * k);
      const target = this.wind.clone().lerp(this.thru, e);
      applyPose(g, poseOf(this.grip, target, this.len));
      camera.updateMatrixWorld(); g.updateMatrixWorld(true);
      const p = g.localToWorld(new THREE.Vector3(0, SW_LEN * 0.72, 0)), q = g.localToWorld(new THREE.Vector3(0, SW_LEN, 0));
      this.trail.push(p); this.sides.push(q.sub(p));
    } else {
      if (!this.wave && t >= t2) this.launch(g);
      if (t < t3) pose(this.thruPose);
      else pose(this.thruPose, restPose(), smooth01(Math.min(1, (t - t3) / SW_BACK)));
      if (this.trail.length) { this.trail.shift(); this.sides.shift(); if (this.trail.length) { this.trail.shift(); this.sides.shift(); } }
    }
    this.drawTrail();
    const waveAlive = this.wave ? this.flyWave(dt) : true;
    if (t > t4 && !waveAlive) {
      for (const m of [this.trailMesh, this.wave && this.wave.mesh]) if (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
      this.trailMesh = null;
      if (own) { curSlash = null; if (!swordOn) g.visible = false; else applyPose(g, restPose()); }
      return false;
    }
    return true;
  }
  drawTrail() {
    // a band swept by the outer part of the blade, fading toward its tail
    const m = this.trailMesh, pos = m.geometry.attributes.position.array, wv = m.geometry.attributes.w.array, n = Math.min(this.trail.length, 41);
    for (let i = 0; i < n; i++) {
      const p = this.trail[this.trail.length - n + i], sd = this.sides[this.sides.length - n + i];
      pos[6 * i] = p.x; pos[6 * i + 1] = p.y; pos[6 * i + 2] = p.z;
      pos[6 * i + 3] = p.x + sd.x; pos[6 * i + 4] = p.y + sd.y; pos[6 * i + 5] = p.z + sd.z;
      wv[4 * i] = wv[4 * i + 2] = 0.12 + 0.88 * (i / Math.max(1, n - 1)); // tail fades, head stays
    }
    m.geometry.setDrawRange(0, Math.max(0, (n - 1) * 6));
    m.geometry.attributes.position.needsUpdate = true; m.geometry.attributes.w.needsUpdate = true;
  }
  /** the sword lets go of a crescent wave: it starts at the blade and flies out along the cut plane */
  launch(g) {
    const far = this.plan.length ? this.plan[this.plan.length - 1].d : 500;
    camera.updateMatrixWorld(); g.updateMatrixWorld(true);
    const near = this.plan.length ? this.plan[0].d : 300;
    const blade = g.localToWorld(new THREE.Vector3(0, SW_LEN * 0.6, 0));
    const ang = this.da.angleTo(this.db);
    // fast enough to reach the far end quickly, slow enough that it is on the cut line before the first hit
    // the arc's directions on the cut plane, and where each starts (around the blade): fixed from here on
    const mid = this.da.clone().applyAxisAngle(this.n, ang * 0.5), bdir = blade.sub(this.o).normalize(), N = 32;
    const dEnd = [], dStart = [];
    for (let i = 0; i <= N; i++) {
      const d = this.da.clone().applyAxisAngle(this.n, ang * (-0.06 + 1.12 * i / N));
      dEnd.push(d); dStart.push(d.clone().sub(mid).multiplyScalar(0.3).add(bdir));
    }
    this.wave = { mesh: stripMesh(N), r: 6, t: 0, v: clamp(Math.min(near / 0.2, far / 0.3), 300, 2600), rEnd: far + 80, dEnd, dStart };
    FX.punch(1.6); FX.shake(0.18);
    A.whoosh(null, 0.45);
  }
  flyWave(dt) {
    const W = this.wave;
    W.t += dt; W.r += W.v * dt;
    // cut each building as the wave reaches it
    while (this.plan.length && this.plan[0].d <= W.r) this.cut(this.plan.shift().b);
    const fade = 1 - smooth01(clamp((W.r - (W.rEnd - 60)) / 120, 0, 1));
    const m = W.mesh, pos = m.geometry.attributes.position.array, N = 32;
    // on screen the wave leaves the blade small and grows onto the cut line while it flies into the scene:
    // blend directions from the camera (not positions), so the screen path doesn't depend on the depth
    const e = 1 - Math.pow(Math.max(0, 1 - W.t / 0.2), 3);
    const width = 0.8 + 0.035 * W.r, d = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      const u = i / N, s = Math.sin(Math.PI * u);
      d.copy(W.dStart[i]).lerp(W.dEnd[i], e).normalize();
      c.copy(this.o).addScaledVector(d, W.r);
      // crescent: the outer (leading) edge bulges more than the inner one, both meet at the tips
      const outer = width * s, inner = width * 0.35 * s * s;
      pos[6 * i] = c.x + this.n.x * inner; pos[6 * i + 1] = c.y + this.n.y * inner; pos[6 * i + 2] = c.z + this.n.z * inner;
      pos[6 * i + 3] = c.x + this.n.x * outer; pos[6 * i + 4] = c.y + this.n.y * outer; pos[6 * i + 5] = c.z + this.n.z * outer;
      if (i % 4 === 2 && Math.random() < 0.7) FX.spark(c.x, c.y, c.z, rand(-3, 3), rand(-1, 4), rand(-3, 3), rand(0.25, 0.5), 0.3, [0.8, 0.95, 1]);
    }
    m.geometry.attributes.position.needsUpdate = true;
    m.material.uniforms.uA.value = fade;
    return W.r < W.rEnd + 60;
  }
  cut(b) {
    const res = S.slash(this.o, this.n, this.inside, this.db.clone().sub(this.da), b);
    if (!res.length) return;
    if (!this.hits++) { FX.hitstop(0.05); stats.slashes++; }
    FX.shake(0.25, res[0].pts[0]);
    for (const r of res) {
      const step = Math.max(1, Math.floor(r.pts.length / 36));
      for (let i = 0; i < r.pts.length; i += step) {
        const c = r.pts[i];
        for (let j = 0; j < 2; j++) FX.spark(c.x, c.y, c.z, rand(-10, 10), rand(2, 12), rand(-10, 10), rand(0.2, 0.45), 0.25, [1, 0.95, 0.8]);
        if (Math.random() < 0.3) FX.dust(c.x, c.y, c.z, rand(-2, 2), rand(0, 2), rand(-2, 2), rand(1.5, 3), 1.5, 5, 0.4);
        if (Math.random() < 0.25) FX.glow(c.x, c.y, c.z, 0.1, 2.5, 3, [1.6, 1.6, 1.6, 1]);
      }
      const c = r.pts[Math.floor(r.pts.length / 2)];
      A.clang(c);
      if (r.glass) { FX.glassBurst(c, Math.min(80, r.glass * 4), null, 8); A.glass(r.glass, c); }
      if (r.severed) { A.crumble(1.5, c); if (ui.toast && r.b.target) ui.toast('싹둑! ' + r.b.name); }
    }
  }
}
/** a slash from screen point (x0, y0) to (x1, y1), in CSS pixels */
export function slash(x0, y0, x1, y1) {
  const a = new THREE.Vector2(x0 / innerWidth * 2 - 1, 1 - y0 / innerHeight * 2), b = new THREE.Vector2(x1 / innerWidth * 2 - 1, 1 - y1 / innerHeight * 2);
  if (a.distanceTo(b) < 0.02) return null;
  if (ui.onAttack) ui.onAttack('sword');
  const s = new Slash(a, b);
  actions.push(s);
  return s;
}

// ---------------------------------------------------------------- shader warm-up
// The first time anything is drawn with a new shader, the frame stalls while it is compiled: the scene's
// own shaders took seconds on the first frame, and each weapon or effect stalled again on first use. On
// Windows (ANGLE) and many phone GPUs part of that work happens only at the first real draw, even when
// the program was compiled ahead. And materials disposed after each use (beams, sword waves and trails,
// the fireball, shockwave rings) take their program with them, so the next shot would compile it again.
// So before the game loop starts: compile everything (the scene plus one of every weapon, effect and
// loose prop) in parallel on the driver's threads, then draw it all once into a tiny off-screen target
// set up like the real one, and keep those materials so later copies find their shader ready.
const warmKeep = [];
export function warmup(renderer) {
  const g = new THREE.Group();
  const sphere = new THREE.SphereGeometry(1, 8, 6);
  const take = (m) => { scene.remove(m); g.add(m); return m; };
  g.add(hammerGeo.clone(), bombProto.clone(), satProto.clone(), missileProto.clone(), nukeProto.clone());
  take(makeTrail(0xffffff));
  const mt = take(makeTrail(0xffffff)); mt.material = meteorTrailMat();
  g.add(new THREE.Mesh(beamGeo, beamMat([1, 1, 1], [1, 1, 1], 1)), new THREE.Mesh(new THREE.PlaneGeometry(), pathMat));
  g.add(new THREE.Mesh(meteorGeo, meteorMat), TOY.cometFlame(), new THREE.Mesh(sphere, fireballMat));
  g.add(new THREE.Mesh(tracerGeo, tracerMat));
  g.add(...FX.warmObjects());
  // props knocked loose fly as plain meshes (not instanced)
  for (const set of props.sets) if (!set.vanish) { const m = new THREE.Mesh(set.geo, set.mat); m.castShadow = m.receiveShadow = true; g.add(m); }
  take(stripMesh(2));
  // tiny, at the centre of the view: inside the camera and shadow frusta, so it is drawn, but invisible
  g.traverse((o) => { if (o.isMesh) { o.castShadow = o.castShadow || o.material.isMeshStandardMaterial; o.frustumCulled = false; } });
  g.position.copy(controls.target); g.scale.setScalar(1e-3); scene.add(g);
  // one particle of each kind and the hand-held rigs
  const c = controls.target;
  FX.spark(c.x, c.y, c.z, 0, 0, 0, 0.1); FX.fire(c.x, c.y, c.z, 0, 0, 0, 0.1, 1, 1); FX.smoke(c.x, c.y, c.z, 0, 0, 0, 0.1, 1, 1);
  FX.dust(c.x, c.y, c.z, 0, 0, 0, 0.1, 1, 1); FX.glow(c.x, c.y, c.z, 0.1, 1, 1, [1, 1, 1, 1]); FX.ember(c.x, c.y, c.z, 0, 0, 0, 0.1);
  FX.plasmaStreak(c.x, c.y, c.z, 0, 0, 0, 0.1, 1, [1, 1, 1]); FX.glassBurst(c, 1); FX.chipBurst(c, 1);
  FX.update(1e-3); // particle pools set their draw counts in update
  const rigs = [gunRig(), swordRig()], vis = rigs.map((r) => r.visible);
  rigs.forEach((r) => { r.visible = true; });
  // shaders differ by target (the post-processing buffer: linear output, no tone mapping): use one like it
  const ref = composer ? composer.renderTarget1 : null;
  const rt = new THREE.WebGLRenderTarget(16, 16, ref ? { type: ref.texture.type, colorSpace: ref.texture.colorSpace, samples: ref.samples } : {});
  const on = (fn) => { const prev = renderer.getRenderTarget(); renderer.setRenderTarget(rt); const r = fn(); renderer.setRenderTarget(prev); return r; };
  const finish = () => {
    // twice: three builds the shadow pass's shaders with the lights of the previous render of the
    // scene, so the very first render makes variants no later frame uses
    on(() => { for (let i = 0; i < 2; i++) { renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); } });
    rt.dispose();
    rigs.forEach((r, i) => { r.visible = vis[i]; });
    scene.remove(g); warmKeep.push(g);
    FX.reset();
  };
  return on(() => renderer.compileAsync(scene, camera)).then(finish, finish);
}

// ---------------------------------------------------------------- dispatcher
export const TOOLS = {
  hammer: { name: '망치', hint: '클릭한 곳을 거대한 망치로 내려칩니다 · 조각을 다시 치면 더 잘게 부서집니다' },
  bomb: { name: '폭탄', hint: '클릭한 곳으로 폭탄을 던집니다 · 도화선이 다 타면 폭발' },
  laser: { name: '레이저', hint: '건물이나 땅 위를 끌어 절단선을 그리세요 · 놓으면 위성이 조사 (회전: 오른쪽 끌기)' },
  meteor: { name: '운석', hint: '클릭한 곳으로 거대한 운석이 떨어집니다 · 반경 40 m가 날아갑니다' },
  missile: { name: '미사일', hint: '클릭 한 번에 정확히 3발 · 목표 주변에 차례로 착탄' },
  mg: { name: '기관총', hint: '누르고 있는 동안 연사 · 끌면서 조준 (회전: 오른쪽 끌기) · 유리창과 외벽이 조금씩 뜯겨 나갑니다' },
  nuke: { name: '핵폭탄', hint: '클릭한 곳 상공에서 터지는 핵폭탄 · 반경 230 m 일대가 통째로 날아가고 버섯구름이 솟습니다' },
  sword: { name: '칼', hint: '화면을 그어 그 선대로 건물을 벱니다 · 건물을 끝까지 가로질러 베면 윗부분이 떨어집니다 (회전: 오른쪽 끌기)' },
};
export function fire(tool, hit, pickNear) {
  if (!hit) return null;
  if (ui.onAttack) ui.onAttack(tool);
  let a = null;
  if (tool === 'hammer') a = new Hammer(hit);
  else if (tool === 'bomb') a = new Bomb(hit);
  else if (tool === 'meteor') a = new Meteor(hit);
  else if (tool === 'missile') {
    const live = actions.filter((x) => x instanceof Salvo).length;
    if (live >= 4) { if (ui.toast) ui.toast('미사일 재장전 중'); return null; }
    a = new Salvo(hit, pickNear);
  } else if (tool === 'nuke') {
    if (actions.some((x) => x instanceof Nuke && x.phase === 'fall')) { if (ui.toast) ui.toast('핵폭탄 낙하 중'); return null; }
    a = new Nuke(hit);
  }
  if (a) actions.push(a);
  return a;
}
export function fireLaser(path) {
  if (!path.pts.length) { path.dispose(); return null; }
  const a = new Laser(path);
  actions.push(a);
  if (ui.onAttack) ui.onAttack('laser');
  return a;
}
export function update(dt) {
  for (let i = actions.length - 1; i >= 0; i--) if (!actions[i].update(dt)) actions.splice(i, 1);
  if (rig && rig.visible && !actions.some((a) => a instanceof Gun)) rigTick(dt, null, false);
  if (srig && srig.visible && !actions.some((a) => a instanceof Slash)) restSword(srig);
}
export function reset() {
  for (const a of actions) {
    for (const k of ['obj', 'grp', 'sat', 'trailMesh', 'fb']) if (a[k]) scene.remove(a[k]);
    if (a.beams) for (const b of a.beams) scene.remove(b);
    if (a.path) a.path.dispose();
    if (a.sfx) a.sfx.stop(0.05);
    if (a.light) a.light.update = null;
    if (a.missiles) for (const m of a.missiles) { scene.remove(m.obj); if (m.sfx) m.sfx.stop(0.05); }
    if (a.rounds) for (const r of a.rounds) scene.remove(r.mesh);
    if (a.wave) scene.remove(a.wave.mesh);
  }
  actions.length = 0;
  meteorRemnants();
  controls.enabled = true; W_cine.active = false;
}
const remnants = [];
function meteorRemnants() { for (const g of remnants) scene.remove(g); remnants.length = 0; }
