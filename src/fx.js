// Visual effects: GPU-instanced billboard particles (fire, smoke, dust, sparks, plasma),
// physical glass shards and concrete chips, shockwaves, explosions, screen shake & hit-stop.
// Every pool has a hard cap and recycles its oldest entries, so nothing grows without bound.
import * as THREE from 'three';
import { scene, camera, flashLight, exposure } from './engine.js';
import * as terrain from './terrain.js';
import { rand, clamp, randomUnit, TAU, lerp } from './util.js';

// ---------------------------------------------------------------- noise puff atlas
const atlas = (() => {
  const S = 512, F = 4, cs = S / F;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const h = (x, y, s) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
  for (let f = 0; f < F * F; f++) {
    const ox = (f % F) * cs, oy = Math.floor(f / F) * cs;
    for (let y = 0; y < cs; y++) for (let x = 0; x < cs; x++) {
      const u = (x + 0.5) / cs * 2 - 1, v = (y + 0.5) / cs * 2 - 1;
      const r = Math.hypot(u, v);
      const o = 4 * ((oy + y) * S + ox + x);
      if (f === 15) { // pure soft dot
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = Math.pow(clamp(1 - r, 0, 1), 1.6) * 255;
        continue;
      }
      // cartoon puff: 3-4 overlapping discs with a crisp edge, lit from the top-left
      let d = 9;
      for (let q = 0; q < 4; q++) {
        const pa = f * 2.4 + q * 1.9, pr = 0.36 + 0.14 * h(q, f, 3);
        const px = q === 0 ? 0 : Math.cos(pa) * 0.32, py = q === 0 ? 0.05 : Math.sin(pa) * 0.26;
        d = Math.min(d, Math.hypot(u - px, v - py) - (q === 0 ? 0.46 : pr));
      }
      const lum = 205 + 50 * clamp(0.5 - 0.6 * (u * 0.6 + v * 0.8), 0, 1);
      img.data[o] = img.data[o + 1] = img.data[o + 2] = lum; img.data[o + 3] = clamp(0.5 - d * cs * 0.5, 0, 1) * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = true;
  return t;
})();

// ---------------------------------------------------------------- billboard pool
const VS = /* glsl */`
attribute vec3 iPos; attribute vec4 iCol; attribute vec4 iMisc; // size, rot, frame, stretch
attribute vec3 iVel;
varying vec4 vCol; varying vec2 vUv;
#include <fog_pars_vertex>
void main(){
  vCol = iCol;
  float frame = iMisc.z;
  vec2 cell = vec2(mod(frame, 4.0), floor(frame / 4.0));
  // canvas rows run top-down while texture v runs bottom-up (flipY)
  vUv = vec2((position.x + 0.5 + cell.x) / 4.0, (position.y + 0.5 + 3.0 - cell.y) / 4.0);
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec2 corner = position.xy * iMisc.x;
  if (iMisc.w > 0.0) {
    // streak along the screen-space velocity
    vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
    vec2 d = vv.xy; float l = length(d);
    if (l > 1e-4) {
      d /= l;
      vec2 n = vec2(-d.y, d.x);
      float len = iMisc.x + l * iMisc.w;
      corner = d * position.y * len + n * position.x * iMisc.x * 0.5;
    }
  } else {
    float c = cos(iMisc.y), s = sin(iMisc.y);
    corner = mat2(c, s, -s, c) * corner;
  }
  mv.xy += corner;
  vec4 mvPosition = mv;
  gl_Position = projectionMatrix * mv;
  #include <fog_vertex>
}`;
const FS = /* glsl */`
uniform sampler2D map; varying vec4 vCol; varying vec2 vUv;
#include <fog_pars_fragment>
void main(){
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(min(vCol.rgb * t.rgb, vec3(24.0)), clamp(vCol.a * t.a, 0.0, 1.0));
  if (gl_FragColor.a < 0.003) discard;
  #include <fog_fragment>
}`;

class Pool {
  constructor(cap, additive) {
    this.cap = cap; this.n = 0;
    this.p = new Float32Array(cap * 3); this.v = new Float32Array(cap * 3);
    this.age = new Float32Array(cap); this.life = new Float32Array(cap);
    this.s0 = new Float32Array(cap); this.s1 = new Float32Array(cap);
    this.rot = new Float32Array(cap); this.rv = new Float32Array(cap);
    this.frame = new Float32Array(cap); this.type = new Uint8Array(cap);
    this.drag = new Float32Array(cap); this.grav = new Float32Array(cap);
    this.c = new Float32Array(cap * 4); this.heat = new Float32Array(cap);
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.setAttribute('position', quad.attributes.position);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iCol', this.aCol); g.setAttribute('iMisc', this.aMisc); g.setAttribute('iVel', this.aVel);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: atlas } }]),
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 3 : 2;
    scene.add(this.mesh);
  }
  spawn(type, x, y, z, vx, vy, vz, life, s0, s1, o = {}) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else { // recycle the oldest-by-ratio slot
      i = Math.floor(Math.random() * this.cap);
    }
    this.type[i] = type;
    this.p[3 * i] = x; this.p[3 * i + 1] = y; this.p[3 * i + 2] = z;
    this.v[3 * i] = vx; this.v[3 * i + 1] = vy; this.v[3 * i + 2] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.rot[i] = rand(0, TAU); this.rv[i] = o.rv ?? rand(-0.6, 0.6);
    this.frame[i] = o.frame ?? Math.floor(rand(0, 15));
    this.drag[i] = o.drag ?? 1; this.grav[i] = o.grav ?? 0;
    this.heat[i] = o.heat ?? 1;
    const c = o.c || [1, 1, 1, 1];
    this.c[4 * i] = c[0]; this.c[4 * i + 1] = c[1]; this.c[4 * i + 2] = c[2]; this.c[4 * i + 3] = c[3];
    return i;
  }
  update(dt) {
    const { p, v } = this;
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      const k = this.age[i] / this.life[i];
      if (k >= 1) continue;
      // integrate
      const d = Math.exp(-this.drag[i] * dt);
      v[3 * i] *= d; v[3 * i + 1] = v[3 * i + 1] * d - this.grav[i] * dt; v[3 * i + 2] *= d;
      p[3 * i] += v[3 * i] * dt; p[3 * i + 1] += v[3 * i + 1] * dt; p[3 * i + 2] += v[3 * i + 2] * dt;
      const t = this.type[i];
      if (t === T_SPARK || t === T_EMBER) {
        const gy = terrain.groundY(p[3 * i], p[3 * i + 2]);
        if (p[3 * i + 1] < gy) { p[3 * i + 1] = gy + 0.02; v[3 * i + 1] *= -0.35; v[3 * i] *= 0.6; v[3 * i + 2] *= 0.6; }
      }
      this.rot[i] += this.rv[i] * dt;
      // compact into slot w
      if (w !== i) this.copy(i, w);
      // shading per type
      const size = lerp(this.s0[w], this.s1[w], 1 - Math.pow(1 - k, 2.2));
      shade(t, k, this.c, w, this.heat[w], out4);
      this.aPos.array[3 * w] = p[3 * w]; this.aPos.array[3 * w + 1] = p[3 * w + 1]; this.aPos.array[3 * w + 2] = p[3 * w + 2];
      this.aCol.array[4 * w] = out4[0]; this.aCol.array[4 * w + 1] = out4[1]; this.aCol.array[4 * w + 2] = out4[2]; this.aCol.array[4 * w + 3] = out4[3];
      const streak = (t === T_SPARK || t === T_PLASMA_STREAK) ? 0.045 : 0;
      this.aMisc.array[4 * w] = size; this.aMisc.array[4 * w + 1] = this.rot[w]; this.aMisc.array[4 * w + 2] = (t === T_SPARK || t === T_GLOW || t === T_EMBER || t === T_PLASMA_STREAK) ? 15 : this.frame[w]; this.aMisc.array[4 * w + 3] = streak;
      this.aVel.array[3 * w] = v[3 * w]; this.aVel.array[3 * w + 1] = v[3 * w + 1]; this.aVel.array[3 * w + 2] = v[3 * w + 2];
      w++;
    }
    this.n = w;
    this.geo.instanceCount = w;
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aMisc.needsUpdate = this.aVel.needsUpdate = true;
  }
  copy(i, w) {
    for (let a = 0; a < 3; a++) { this.p[3 * w + a] = this.p[3 * i + a]; this.v[3 * w + a] = this.v[3 * i + a]; }
    for (let a = 0; a < 4; a++) this.c[4 * w + a] = this.c[4 * i + a];
    this.age[w] = this.age[i]; this.life[w] = this.life[i]; this.s0[w] = this.s0[i]; this.s1[w] = this.s1[i];
    this.rot[w] = this.rot[i]; this.rv[w] = this.rv[i]; this.frame[w] = this.frame[i]; this.type[w] = this.type[i];
    this.drag[w] = this.drag[i]; this.grav[w] = this.grav[i]; this.heat[w] = this.heat[i];
  }
  clear() { this.n = 0; this.geo.instanceCount = 0; }
}

const T_FIRE = 1, T_SMOKE = 2, T_DUST = 3, T_SPARK = 4, T_GLOW = 5, T_EMBER = 6, T_PLASMA = 7, T_PLASMA_STREAK = 8, T_STEAM = 9;
const out4 = [0, 0, 0, 0];
function shade(t, k, c, i, heat, o) {
  const r = c[4 * i], g = c[4 * i + 1], b = c[4 * i + 2], a = c[4 * i + 3];
  if (t === T_FIRE) {
    // white-hot core -> yellow -> orange -> dark red, intensity >1 feeds the bloom
    const h = heat * (1 - k);
    const R = 0.9 + 1.5 * h * h, G = 0.16 + 1.05 * Math.pow(h, 1.5), B = 0.03 + 0.45 * Math.pow(h, 3);
    const fade = (k < 0.08 ? k / 0.08 : Math.pow(1 - (k - 0.08) / 0.92, 1.6)) * 0.62;
    o[0] = R * fade * a; o[1] = G * fade * a; o[2] = B * fade * a; o[3] = 1;
  } else if (t === T_SMOKE) {
    const fade = k < 0.12 ? k / 0.12 : 1 - Math.pow((k - 0.12) / 0.88, 1.5);
    const l = lerp(1, 1.35, k);
    o[0] = Math.min(1, r * l); o[1] = Math.min(1, g * l); o[2] = Math.min(1, b * l); o[3] = a * fade;
  } else if (t === T_DUST || t === T_STEAM) {
    const fade = k < 0.06 ? k / 0.06 : 1 - Math.pow((k - 0.06) / 0.94, 1.2);
    o[0] = r; o[1] = g; o[2] = b; o[3] = a * fade;
  } else if (t === T_SPARK || t === T_EMBER || t === T_PLASMA_STREAK) {
    const f = 1 - k;
    o[0] = r * (0.6 + 2.4 * f); o[1] = g * (0.4 + 1.6 * f * f); o[2] = b * f * f; o[3] = 1;
  } else { // glow / plasma: bright, quick falloff
    const f = Math.pow(1 - k, 2);
    o[0] = r * f; o[1] = g * f; o[2] = b * f; o[3] = 1;
  }
}

export const add = new Pool(9000, true);
export const alpha = new Pool(5000, false);

// ---------------------------------------------------------------- physical shards and chips
const SHARD_CAP = 3500, CHIP_CAP = 5000;
const shardMat = new THREE.MeshStandardMaterial({ color: 0xbcd3e0, metalness: 0.9, roughness: 0.06, side: THREE.DoubleSide, envMapIntensity: 1.4 });
const shardGeo = new THREE.BufferGeometry();
shardGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.4, 0, 0.55, -0.3, 0, -0.1, 0.6, 0], 3));
shardGeo.computeVertexNormals();
const chipMat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.02 });
const chipGeo = new THREE.BoxGeometry(1, 1, 1);
class Debris {
  constructor(geo, mat, cap, shadow) {
    this.cap = cap; this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0; this.mesh.castShadow = shadow; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.items = []; this.next = 0;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3();
  }
  spawn(x, y, z, vx, vy, vz, size, color) {
    let it;
    if (this.items.length < this.cap) { it = { i: this.items.length }; this.items.push(it); this.mesh.count = this.items.length; }
    else { it = this.items[this.next]; this.next = (this.next + 1) % this.cap; }
    it.p = new THREE.Vector3(x, y, z); it.v = new THREE.Vector3(vx, vy, vz);
    it.r = new THREE.Vector3(rand(0, 6), rand(0, 6), rand(0, 6)); it.w = new THREE.Vector3(rand(-14, 14), rand(-14, 14), rand(-14, 14));
    it.size = size; it.rest = false; it.sc = [size * rand(0.7, 1.3), size * rand(0.5, 1), size * rand(0.7, 1.2)];
    if (color !== undefined) this.mesh.setColorAt(it.i, new THREE.Color(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.write(it);
    return it;
  }
  write(it) {
    this.e.set(it.r.x, it.r.y, it.r.z); this.q.setFromEuler(this.e);
    this.s.set(it.sc[0], it.sc[1], it.sc[2]);
    this.m.compose(it.p, this.q, this.s);
    this.mesh.setMatrixAt(it.i, this.m);
  }
  update(dt) {
    let any = false;
    for (const it of this.items) {
      if (it.rest) continue;
      any = true;
      it.v.y -= 24 * dt;
      it.v.multiplyScalar(1 - 0.25 * dt);
      it.p.addScaledVector(it.v, dt);
      it.r.addScaledVector(it.w, dt);
      const gy = terrain.groundY(it.p.x, it.p.z) + it.size * 0.25;
      if (it.p.y < gy) {
        it.p.y = gy;
        if (Math.abs(it.v.y) < 2.5) { it.rest = true; it.r.x = Math.round(it.r.x / Math.PI) * Math.PI + rand(-0.1, 0.1); it.r.z = Math.round(it.r.z / Math.PI) * Math.PI + rand(-0.1, 0.1); }
        it.v.y *= -0.3; it.v.x *= 0.5; it.v.z *= 0.5; it.w.multiplyScalar(0.5);
      }
      this.write(it);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
  wake(x0, x1, z0, z1) { for (const it of this.items) if (it.rest && it.p.x > x0 && it.p.x < x1 && it.p.z > z0 && it.p.z < z1) { it.rest = false; it.v.set(0, 0, 0); } }
  clear() { this.items.length = 0; this.mesh.count = 0; this.next = 0; }
}
export const shards = new Debris(shardGeo, shardMat, SHARD_CAP, false);
export const chips = new Debris(chipGeo, chipMat, CHIP_CAP, true);
terrain.listeners.push((x0, x1, z0, z1) => { shards.wake(x0, x1, z0, z1); chips.wake(x0, x1, z0, z1); });

// ---------------------------------------------------------------- shockwave meshes
/** objects carrying the base materials that effects clone per use (see W.warmup) */
export function warmObjects() { return [new THREE.Mesh(ringGeo, ringMat), new THREE.Mesh(shellGeo, shellMat)]; }
const ringMat = new THREE.ShaderMaterial({
  uniforms: { uA: { value: 1 }, uC: { value: new THREE.Color(1, 0.9, 0.75) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'uniform float uA; uniform vec3 uC; varying vec2 vUv; void main(){ float r = length(vUv-0.5)*2.0; float a = smoothstep(0.72,0.93,r)*(1.0-smoothstep(0.93,1.0,r)); gl_FragColor = vec4(uC*a*uA*2.0, a*uA); }',
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});
const shellMat = new THREE.ShaderMaterial({
  uniforms: { uA: { value: 1 }, uC: { value: new THREE.Color(1, 0.85, 0.65) } },
  vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
  fragmentShader: 'uniform float uA; uniform vec3 uC; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0-abs(dot(vN,vV)), 3.0); gl_FragColor = vec4(uC*f*uA*1.6, f*uA); }',
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
const shellGeo = new THREE.SphereGeometry(1, 40, 24);
const waves = [];
export function shockwave(pos, maxR, life = 0.8, color = 0xffe7c4, shell = true) {
  const ring = new THREE.Mesh(ringGeo, ringMat.clone());
  ring.material.uniforms.uC.value.set(color);
  ring.position.set(pos.x, terrain.groundY(pos.x, pos.z) + 0.4, pos.z);
  scene.add(ring);
  waves.push({ obj: ring, t: 0, life, maxR, kind: 'ring' });
  if (shell) {
    const s = new THREE.Mesh(shellGeo, shellMat.clone());
    s.material.uniforms.uC.value.set(color);
    s.position.copy(pos);
    scene.add(s);
    waves.push({ obj: s, t: 0, life: life * 0.55, maxR: maxR * 0.6, kind: 'shell' });
  }
}
function updateWaves(dt) {
  for (let i = waves.length - 1; i >= 0; i--) {
    const w = waves[i]; w.t += dt;
    const k = w.t / w.life;
    if (k >= 1) { scene.remove(w.obj); w.obj.material.dispose(); waves.splice(i, 1); continue; }
    const e = 1 - Math.pow(1 - k, 3);
    w.obj.scale.setScalar(Math.max(0.01, w.maxR * e));
    w.obj.material.uniforms.uA.value = Math.pow(1 - k, 1.5);
  }
}

// ---------------------------------------------------------------- screen feedback
export const cam = { trauma: 0, kick: new THREE.Vector3(), fovPunch: 0, hitstop: 0, slowmo: 1 };
const flashEl = document.getElementById('flash'), heatEl = document.getElementById('heat');
let flashA = 0, heatA = 0;
export function screenFlash(a) { flashA = Math.max(flashA, a); }
export function heatHaze(a) { heatA = Math.max(heatA, a); }
export function shake(amount, at) {
  let f = 1;
  if (at) { const d = camera.position.distanceTo(at); f = clamp(1.4 - d / 420, 0.15, 1.2); }
  cam.trauma = Math.min(1.3, cam.trauma + amount * f);
}
export function hitstop(sec) { cam.hitstop = Math.max(cam.hitstop, sec); }
export function punch(fov) { cam.fovPunch = Math.min(cam.fovPunch + fov, 14); }
let shakeT = 0;
export function applyCamera(dt) {
  shakeT += dt;
  const tr = cam.trauma * cam.trauma;
  const off = new THREE.Vector3(
    Math.sin(shakeT * 41.3) * 0.6 + Math.sin(shakeT * 71.1) * 0.4,
    Math.sin(shakeT * 37.7 + 1.3) * 0.6 + Math.sin(shakeT * 63.2) * 0.4,
    Math.sin(shakeT * 47.9 + 2.1) * 0.5,
  ).multiplyScalar(tr * 2.4);
  // short recoil kicks (machine gun) spring back quickly
  off.add(cam.kick);
  cam.kick.multiplyScalar(Math.exp(-dt * 16));
  const rollish = Math.sin(shakeT * 29.0) * tr * 0.012;
  flashEl.style.opacity = flashA.toFixed(3);
  heatEl.style.opacity = Math.min(1, heatA).toFixed(3);
  return { off, roll: rollish };
}

// ---------------------------------------------------------------- composite emitters
const timers = [];
export function every(period, duration, fn) { timers.push({ period, left: duration, acc: 0, fn, t: 0 }); }
function updateTimers(dt) {
  for (let i = timers.length - 1; i >= 0; i--) {
    const T = timers[i];
    T.left -= dt; T.acc += dt; T.t += dt;
    while (T.acc >= T.period) { T.acc -= T.period; T.fn(T.t); }
    if (T.left <= 0) timers.splice(i, 1);
  }
}

const SMOKE_DARK = [0.36, 0.37, 0.44, 0.9];
const SMOKE_GREY = [0.80, 0.82, 0.88, 0.75];
const DUST = [0.93, 0.87, 0.76, 0.6]; // cream, like the cut faces
export function fire(x, y, z, vx, vy, vz, life, s0, s1, heat = 1) { return add.spawn(T_FIRE, x, y, z, vx, vy, vz, life, s0, s1, { heat, drag: 1.6, grav: -3, c: [1, 1, 1, 1] }); }
export function smoke(x, y, z, vx, vy, vz, life, s0, s1, dark = 0.5, a = 0.8) {
  const c = [lerp(SMOKE_GREY[0], SMOKE_DARK[0], dark), lerp(SMOKE_GREY[1], SMOKE_DARK[1], dark), lerp(SMOKE_GREY[2], SMOKE_DARK[2], dark), a];
  return alpha.spawn(T_SMOKE, x, y, z, vx, vy, vz, life, s0, s1, { drag: 0.7, grav: -1.4, c, rv: rand(-0.25, 0.25) });
}
export function dust(x, y, z, vx, vy, vz, life, s0, s1, a = 0.6, tint = DUST) {
  return alpha.spawn(T_DUST, x, y, z, vx, vy, vz, life, s0, s1, { drag: 1.3, grav: -0.3, c: [tint[0], tint[1], tint[2], a], rv: rand(-0.3, 0.3) });
}
export function spark(x, y, z, vx, vy, vz, life, size = 0.25, col = [1, 0.75, 0.35]) {
  return add.spawn(T_SPARK, x, y, z, vx, vy, vz, life, size, size * 0.6, { drag: 0.6, grav: 22, c: [col[0], col[1], col[2], 1] });
}
export function ember(x, y, z, vx, vy, vz, life, size = 0.35) {
  return add.spawn(T_EMBER, x, y, z, vx, vy, vz, life, size, size * 0.3, { drag: 0.9, grav: 6, c: [1, 0.45, 0.12, 1] });
}
export function glow(x, y, z, life, s0, s1, col) {
  return add.spawn(T_GLOW, x, y, z, 0, 0, 0, life, s0, s1, { c: col, drag: 0, rv: 0 });
}
export function plasma(x, y, z, vx, vy, vz, life, s0, s1, col) {
  return add.spawn(T_PLASMA, x, y, z, vx, vy, vz, life, s0, s1, { c: col, drag: 2, grav: 0 });
}
export function plasmaStreak(x, y, z, vx, vy, vz, life, size, col) {
  return add.spawn(T_PLASMA_STREAK, x, y, z, vx, vy, vz, life, size, size * 0.5, { c: col, drag: 1.2, grav: 12 });
}

export function glassBurst(c, n, dir = null, speed = 10) {
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    randomUnit(v);
    if (dir) v.lerp(dir, 0.6).normalize();
    v.multiplyScalar(speed * rand(0.3, 1.2));
    shards.spawn(c.x + rand(-1.5, 1.5), c.y + rand(-1.5, 1.5), c.z + rand(-1.5, 1.5), v.x, v.y + rand(0, 4), v.z, rand(0.25, 0.75));
  }
  // glittery sparkle on the burst
  for (let i = 0; i < n * 0.5; i++) add.spawn(T_GLOW, c.x + rand(-3, 3), c.y + rand(-3, 3), c.z + rand(-3, 3), rand(-3, 3), rand(-4, 1), rand(-3, 3), rand(0.2, 0.5), 0.5, 0.1, { c: [0.8, 0.9, 1, 1], drag: 1, grav: 6 });
}
const CHIP_COLS = [0xb9b6ae, 0x8e8c87, 0xd8d5ce, 0x6f6d69, 0xa5a197];
export function chipBurst(c, n, speed = 14, colors = CHIP_COLS, size = [0.2, 0.7]) {
  for (let i = 0; i < n; i++) {
    const v = randomUnit(new THREE.Vector3()); v.y = Math.abs(v.y) * 0.8 + 0.25;
    v.multiplyScalar(speed * rand(0.3, 1.1));
    chips.spawn(c.x + rand(-1, 1), c.y + rand(-0.5, 1), c.z + rand(-1, 1), v.x, v.y, v.z, rand(size[0], size[1]), colors[Math.floor(Math.random() * colors.length)]);
  }
}
export function dustPuff(c, n, spread, speed, a = 0.55, size = [3, 9]) {
  for (let i = 0; i < n; i++) dust(c.x + rand(-spread, spread), c.y + rand(0, spread * 0.4), c.z + rand(-spread, spread), rand(-speed, speed), rand(0, speed * 0.6), rand(-speed, speed), rand(1.6, 3.6), size[0], size[1], a);
}
export function dustRing(c, r0, speed, n, a = 0.6, size = [4, 14]) {
  const gy = terrain.groundY(c.x, c.z);
  for (let i = 0; i < n; i++) {
    const t = rand(0, TAU), s = speed * rand(0.7, 1.15);
    dust(c.x + Math.cos(t) * r0, gy + rand(0.5, 2.5), c.z + Math.sin(t) * r0, Math.cos(t) * s, rand(0.5, 3), Math.sin(t) * s, rand(2.2, 4.2), size[0], size[1], a);
  }
}

/**
 * The full explosion package. scale ~1 = grenade-ish bomb, 2.5 = missile, 6+ = meteor.
 */
export function explosion(c, scale = 1, opt = {}) {
  const S = Math.pow(scale, 0.75), N = Math.pow(scale, 0.6); // sizes grow slower than the blast
  const gy = terrain.groundY(c.x, c.z);
  const nearGround = c.y - gy < 6 * S;
  flashLight(c.clone().add(new THREE.Vector3(0, 3 * S, 0)), 0xffb070, 160 * S * S, 0.3 + 0.07 * S, 45 + 25 * S);
  glow(c.x, c.y + S, c.z, 0.1 + 0.02 * S, 4 * S, 10 * S, [1.6, 1.35, 1.1, 1]);
  glow(c.x, c.y + S, c.z, 0.3 + 0.06 * S, 6 * S, 13 * S, [0.7, 0.32, 0.1, 1]);
  // fireball: many noisy puffs pushed outward, decelerating hard
  const nf = Math.round(18 + 12 * N);
  for (let i = 0; i < nf; i++) {
    const v = randomUnit(new THREE.Vector3());
    if (nearGround) v.y = Math.abs(v.y) * 0.9 + 0.15;
    const sp = rand(6, 22) * Math.sqrt(S);
    fire(c.x + v.x * S, c.y + v.y * S + S * 0.5, c.z + v.z * S, v.x * sp, v.y * sp + 3 * S, v.z * sp, rand(0.45, 0.95) * (0.8 + 0.12 * S), 2 * S, rand(5, 8.5) * S, rand(0.8, 1.1));
  }
  // rolling smoke that outlives the fire
  const ns = Math.round(16 + 12 * N);
  for (let i = 0; i < ns; i++) {
    const v = randomUnit(new THREE.Vector3()); v.y = Math.abs(v.y) * 0.6 + 0.3;
    const sp = rand(3, 10) * Math.sqrt(S);
    smoke(c.x + v.x * 2 * S, c.y + v.y * S * 2, c.z + v.z * 2 * S, v.x * sp, v.y * sp + 2, v.z * sp, rand(3.5, 7) * (0.8 + 0.1 * S), 3 * S, rand(9, 15) * S, rand(0.65, 1), 0.85);
  }
  every(0.07, 0.6 + 0.25 * S, () => { // secondary licks of flame inside the smoke
    const v = randomUnit(new THREE.Vector3()).multiplyScalar(rand(1, 4) * S);
    fire(c.x + v.x, c.y + Math.abs(v.y) + S, c.z + v.z, v.x, 4 + rand(0, 5), v.z, rand(0.4, 0.8), 3 * S, 7 * S, 0.7);
  });
  // sparks and burning fragments
  for (let i = 0; i < 50 + 30 * N; i++) { const v = randomUnit(new THREE.Vector3()); v.y = Math.abs(v.y) + 0.1; const sp = rand(15, 50) * Math.sqrt(S); spark(c.x, c.y + 0.5, c.z, v.x * sp, v.y * sp, v.z * sp, rand(0.5, 1.4)); }
  for (let i = 0; i < 12 + 8 * N; i++) { const v = randomUnit(new THREE.Vector3()); v.y = Math.abs(v.y) + 0.3; const sp = rand(8, 26) * Math.sqrt(S); ember(c.x, c.y + 1, c.z, v.x * sp, v.y * sp, v.z * sp, rand(1.5, 3.2), rand(0.4, 0.8)); }
  if (nearGround) {
    dustRing(c, 1.5 * S, 16 * Math.sqrt(S), Math.round(26 + 12 * N), 0.6, [3 * S, 9 * S]);
    chipBurst(new THREE.Vector3(c.x, gy + 0.3, c.z), Math.round(10 + 10 * N), 16 * Math.sqrt(S), [0x5b4a39, 0x6e5a45, 0x7d7a73, 0x4a3d30]);
    terrain.scorch(c.x, c.z, 5 * S + 4, 0.9);
  }
  shockwave(c, opt.wave || 14 * S + 10, 0.55 + 0.1 * S);
  exposure.boost = Math.max(exposure.boost, 0.05 * Math.min(S, 4));
  shake(0.38 + 0.12 * S, c);
}

export function update(dt) {
  add.update(dt); alpha.update(dt);
  shards.update(dt); chips.update(dt);
  updateWaves(dt); updateTimers(dt);
  exposure.boost *= Math.exp(-dt * 3); exposure.dip *= Math.exp(-dt * 2.5);
  // screen feedback decays in simulation time (freezes during hit-stop, matches test stepping)
  cam.trauma = Math.max(0, cam.trauma - dt * 1.25);
  cam.fovPunch *= Math.exp(-dt * 5);
  flashA *= Math.exp(-dt * 4.5); heatA *= Math.exp(-dt * 1.6);
}
export function reset() {
  add.clear(); alpha.clear(); shards.clear(); chips.clear();
  for (const w of waves) scene.remove(w.obj); waves.length = 0; timers.length = 0;
}
export function counts() { return { add: add.n, alpha: alpha.n, shards: shards.items.length, chips: chips.items.length, waves: waves.length, timers: timers.length }; }
