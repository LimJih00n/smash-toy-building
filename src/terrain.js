// Deformable heightmap terrain: painted ground map, real craters with raised rims,
// soil strata revealed by depth, scorch/rubble overlay and glowing molten grooves.
import * as THREE from 'three';
import { scene } from './engine.js';
import { clamp, fbm } from './util.js';

export const T = { x0: -320, z0: -320, size: 640, step: 2 };
T.n = Math.round(T.size / T.step) + 1;
const N = T.n;
export const H = new Float32Array(N * N);   // current height
const H0 = new Float32Array(N * N);         // original height
const heat = new Float32Array(N * N);
const hot = new Set();
export const MIN_Y = -70;

// ---------- painted ground (roads, pavements, grass) drawn by world.js in world units
const PAINT = 2048;
const paintCanvas = document.createElement('canvas');
paintCanvas.width = paintCanvas.height = PAINT;
export const paint = paintCanvas.getContext('2d');
const pk = PAINT / T.size;
export function paintReset() {
  paint.setTransform(1, 0, 0, 1, 0, 0);
  paint.fillStyle = '#6f8a5a';
  paint.fillRect(0, 0, PAINT, PAINT);
  paint.setTransform(pk, 0, 0, pk, -T.x0 * pk, -T.z0 * pk); // world x,z -> pixels
}
export const paintTex = new THREE.CanvasTexture(paintCanvas);
paintTex.colorSpace = THREE.SRGBColorSpace;
paintTex.anisotropy = 8;

// overlay: R = scorch, G = rubble
const OV = 1024, ok = OV / T.size;
const ovCanvas = document.createElement('canvas');
ovCanvas.width = ovCanvas.height = OV;
const ov = ovCanvas.getContext('2d');
const ovTex = new THREE.CanvasTexture(ovCanvas);
let ovDirty = false;
function ovReset() { ov.setTransform(1, 0, 0, 1, 0, 0); ov.globalCompositeOperation = 'source-over'; ov.fillStyle = '#000'; ov.fillRect(0, 0, OV, OV); ov.setTransform(ok, 0, 0, ok, -T.x0 * ok, -T.z0 * ok); ovDirty = true; }
export function scorch(x, z, r, s = 0.8) {
  ov.globalCompositeOperation = 'lighter';
  const g = ov.createRadialGradient(x, z, 0, x, z, r);
  g.addColorStop(0, `rgba(${Math.round(255 * s)},0,0,1)`);
  g.addColorStop(0.55, `rgba(${Math.round(160 * s)},0,0,1)`);
  g.addColorStop(1, 'rgba(0,0,0,1)');
  ov.fillStyle = g; ov.beginPath(); ov.arc(x, z, r, 0, Math.PI * 2); ov.fill();
  ovDirty = true;
}
export function scorchLine(ax, az, bx, bz, w, s = 0.9) {
  ov.globalCompositeOperation = 'lighter';
  ov.strokeStyle = `rgba(${Math.round(255 * s)},0,0,1)`; ov.lineWidth = w; ov.lineCap = 'round';
  ov.beginPath(); ov.moveTo(ax, az); ov.lineTo(bx, bz); ov.stroke();
  ovDirty = true;
}
export function rubbleMark(x, z, r, s = 0.7) {
  ov.globalCompositeOperation = 'lighter';
  const g = ov.createRadialGradient(x, z, 0, x, z, r);
  g.addColorStop(0, `rgba(0,${Math.round(255 * s)},0,1)`); g.addColorStop(1, 'rgba(0,0,0,1)');
  ov.fillStyle = g; ov.beginPath(); ov.arc(x, z, r, 0, Math.PI * 2); ov.fill();
  ovDirty = true;
}

// ---------- mesh
const geo = new THREE.BufferGeometry();
const pos = new Float32Array(N * N * 3), nor = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2);
const aDig = new Float32Array(N * N), aHeat = new Float32Array(N * N);
for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
  const k = i * N + j;
  pos[3 * k] = T.x0 + j * T.step; pos[3 * k + 2] = T.z0 + i * T.step;
  uv[2 * k] = j / (N - 1); uv[2 * k + 1] = 1 - i / (N - 1);
  nor[3 * k + 1] = 1;
}
const idx = new Uint32Array((N - 1) * (N - 1) * 6);
{
  let o = 0;
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < N - 1; j++) {
    const a = i * N + j, b = a + 1, c = a + N, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
}
geo.setIndex(new THREE.BufferAttribute(idx, 1));
const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
const norAttr = new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage);
const digAttr = new THREE.BufferAttribute(aDig, 1).setUsage(THREE.DynamicDrawUsage);
const heatAttr = new THREE.BufferAttribute(aHeat, 1).setUsage(THREE.DynamicDrawUsage);
geo.setAttribute('position', posAttr);
geo.setAttribute('normal', norAttr);
geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
geo.setAttribute('aDig', digAttr);
geo.setAttribute('aHeat', heatAttr);
geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), T.size);

const mat = new THREE.MeshStandardMaterial({ map: paintTex, roughness: 0.92, metalness: 0 });
mat.onBeforeCompile = (sh) => {
  sh.uniforms.uOverlay = { value: ovTex };
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aDig; attribute float aHeat; varying float vDig; varying float vHeat; varying vec3 vWp;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDig = aDig; vHeat = aHeat; vWp = (modelMatrix * vec4(position,1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
uniform sampler2D uOverlay; varying float vDig; varying float vHeat; varying vec3 vWp;
float th(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float tn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(th(i),th(i+vec2(1,0)),f.x), mix(th(i+vec2(0,1)),th(i+vec2(1,1)),f.x), f.y); }`)
    .replace('#include <map_fragment>', `#include <map_fragment>
{
  float dn = tn(vWp.xz*1.7)*0.6 + tn(vWp.xz*6.3)*0.4;
  diffuseColor.rgb *= 0.9 + 0.2*dn;
  float d = abs(vDig);
  if (d > 0.05) {
    float strata = 0.5 + 0.5*sin((vWp.y)*2.1 + tn(vWp.xz*0.3)*5.0);
    vec3 top = vec3(0.21,0.16,0.11), clay = vec3(0.47,0.34,0.22), sand = vec3(0.58,0.50,0.39), rock = vec3(0.36,0.34,0.33);
    vec3 soil = mix(top, clay, smoothstep(0.3, 2.5, d));
    soil = mix(soil, sand, smoothstep(5.0, 10.0, d));
    soil = mix(soil, rock, smoothstep(13.0, 20.0, d));
    soil *= 0.82 + 0.28*strata*smoothstep(1.0,3.0,d);
    soil *= 0.8 + 0.4*tn(vWp.xz*3.1 + vWp.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, soil, smoothstep(0.05, 0.6, d));
  }
  vec4 ovc = texture2D(uOverlay, vMapUv);
  float rub = clamp(ovc.g, 0.0, 1.0);
  vec3 rubC = vec3(0.52,0.50,0.47) * (0.65 + 0.6*tn(vWp.xz*2.7));
  diffuseColor.rgb = mix(diffuseColor.rgb, rubC, rub*0.85);
  float sc = clamp(ovc.r, 0.0, 1.0);
  diffuseColor.rgb *= 1.0 - 0.82*sc*(0.75+0.25*tn(vWp.xz*1.3));
}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float h = clamp(vHeat, 0.0, 1.5);
  vec3 hc = mix(vec3(0.9,0.12,0.02), vec3(1.6,0.85,0.35), clamp(h-0.3,0.0,1.0));
  totalEmissiveRadiance += hc * h * h * (2.2 + 1.2*tn(vWp.xz*2.0));
}`);
};
export const mesh = new THREE.Mesh(geo, mat);
mesh.receiveShadow = true;
mesh.name = 'terrain';
scene.add(mesh);

// outer ground so the playable square never floats in a void
{
  const shape = new THREE.Shape();
  const R = 3200;
  shape.moveTo(-R, -R); shape.lineTo(R, -R); shape.lineTo(R, R); shape.lineTo(-R, R); shape.lineTo(-R, -R);
  const hole = new THREE.Path();
  const a = T.x0 + 0.5, b = T.x0 + T.size - 0.5;
  hole.moveTo(a, a); hole.lineTo(a, b); hole.lineTo(b, b); hole.lineTo(b, a); hole.lineTo(a, a);
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2);
  const outer = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x77866a, roughness: 1 }));
  outer.position.y = -0.03; outer.receiveShadow = true;
  scene.add(outer);
}

// ---------- queries
export function groundY(x, z) {
  const gj = (x - T.x0) / T.step, gi = (z - T.z0) / T.step;
  if (gj < 0 || gi < 0 || gj >= N - 1 || gi >= N - 1) return 0;
  const j = Math.floor(gj), i = Math.floor(gi), fx = gj - j, fz = gi - i, k = i * N + j;
  const a = H[k], b = H[k + 1], c = H[k + N], d = H[k + N + 1];
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}
export const depthAt = (x, z) => {
  const j = Math.round((x - T.x0) / T.step), i = Math.round((z - T.z0) / T.step);
  if (j < 0 || i < 0 || j >= N || i >= N) return 0;
  return H0[i * N + j] - H[i * N + j];
};
export function inside(x, z) { return x > T.x0 + 1 && z > T.z0 + 1 && x < T.x0 + T.size - 1 && z < T.z0 + T.size - 1; }

// Ray vs heightfield: march then bisect. Returns distance or -1.
export function raycast(o, d, maxT = 3000) {
  let t = 0, step = 1.5;
  let prevT = 0, prevAbove = o.y - groundY(o.x, o.z);
  if (prevAbove < 0 && inside(o.x, o.z)) return 0;
  while (t < maxT) {
    t += step;
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y < MIN_Y - 5) return -1;
    if (!inside(x, z)) { if (d.y >= 0) return -1; step = Math.min(8, step * 1.2); prevT = t; continue; }
    const above = y - groundY(x, z);
    if (above < 0) {
      let lo = prevT, hi = t;
      for (let k = 0; k < 14; k++) {
        const m = (lo + hi) / 2;
        const a2 = o.y + d.y * m - groundY(o.x + d.x * m, o.z + d.z * m);
        if (a2 < 0) hi = m; else lo = m;
      }
      return hi;
    }
    prevT = t; prevAbove = above;
    step = clamp(above * 0.5, 0.5, 6);
  }
  return -1;
}

// ---------- updates
let dirtyBox = null;
function markDirty(i0, i1, j0, j1) {
  if (!dirtyBox) dirtyBox = [i0, i1, j0, j1];
  else { dirtyBox[0] = Math.min(dirtyBox[0], i0); dirtyBox[1] = Math.max(dirtyBox[1], i1); dirtyBox[2] = Math.min(dirtyBox[2], j0); dirtyBox[3] = Math.max(dirtyBox[3], j1); }
}
function refresh(i0, i1, j0, j1) {
  i0 = Math.max(0, i0 - 1); j0 = Math.max(0, j0 - 1); i1 = Math.min(N - 1, i1 + 1); j1 = Math.min(N - 1, j1 + 1);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const k = i * N + j;
    pos[3 * k + 1] = H[k];
    aDig[k] = H0[k] - H[k];
    const hl = H[j > 0 ? k - 1 : k], hr = H[j < N - 1 ? k + 1 : k], hd = H[i > 0 ? k - N : k], hu = H[i < N - 1 ? k + N : k];
    let nx = hl - hr, ny = 2 * T.step, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz); nor[3 * k] = nx / l; nor[3 * k + 1] = ny / l; nor[3 * k + 2] = nz / l;
  }
  posAttr.needsUpdate = true; norAttr.needsUpdate = true; digAttr.needsUpdate = true;
}

export const listeners = [];   // fn(x0,x1,z0,z1) called after ground changes
function notify(x0, x1, z0, z1) { for (const f of listeners) f(x0, x1, z0, z1); }

/**
 * Carve a crater. profile: 'bowl' (explosions), 'shaft' (drill), 'groove' (laser)
 * rim: raised ejecta height as a fraction of depth.
 */
export function dig(cx, cz, r, depth, { profile = 'bowl', rim = 0.18, heatAmt = 0, quiet = false } = {}) {
  const R2 = r * (profile === 'shaft' ? 1.35 : 1.7);
  const j0 = Math.max(0, Math.floor((cx - R2 - T.x0) / T.step)), j1 = Math.min(N - 1, Math.ceil((cx + R2 - T.x0) / T.step));
  const i0 = Math.max(0, Math.floor((cz - R2 - T.z0) / T.step)), i1 = Math.min(N - 1, Math.ceil((cz + R2 - T.z0) / T.step));
  if (j0 > j1 || i0 > i1) return 0;
  let removed = 0;
  // carve relative to the current floor at the centre so repeated hits keep deepening;
  // grooves are carved relative to the original surface so overlapping beam points don't over-dig
  const hc = Math.min(groundY(cx, cz), 0);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const x = T.x0 + j * T.step, z = T.z0 + i * T.step;
    const k = i * N + j;
    const n = (fbm(x * 0.21 + 3, z * 0.21 - 7, 2) - 0.5);
    const d = Math.hypot(x - cx, z - cz) * (1 + n * 0.22);
    const q = d / r;
    if (q < 1) {
      let prof;
      if (profile === 'shaft') prof = 1 - Math.pow(q, 6);
      else if (profile === 'groove') prof = Math.pow(1 - q * q, 0.8);
      else prof = Math.pow(1 - q * q, 1.35);
      const base = profile === 'groove' ? H0[k] : hc;
      const v = Math.max(MIN_Y, Math.min(H[k], base - depth * prof));
      if (v < H[k]) { removed += (H[k] - v) * T.step * T.step; H[k] = v; }
      if (heatAmt > 0) { const hv = heatAmt * (1 - q * 0.7); if (hv > heat[k]) { heat[k] = hv; hot.add(k); } }
    } else if (rim > 0 && q < R2 / r) {
      // ejecta: raised lip that fades outward
      const t = (q - 1) / (R2 / r - 1);
      const lift = depth * rim * Math.pow(1 - t, 2) * (0.75 + n);
      if (lift > 0) H[k] = Math.min(H[k] + lift * 0.6, H0[k] + depth * rim * 1.15);
    }
  }
  markDirty(i0, i1, j0, j1);
  if (!quiet) flush();
  notify(cx - R2, cx + R2, cz - R2, cz + R2);
  return removed;
}

export function deposit(cx, cz, r, h) {
  const j0 = Math.max(0, Math.floor((cx - r - T.x0) / T.step)), j1 = Math.min(N - 1, Math.ceil((cx + r - T.x0) / T.step));
  const i0 = Math.max(0, Math.floor((cz - r - T.z0) / T.step)), i1 = Math.min(N - 1, Math.ceil((cz + r - T.z0) / T.step));
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const x = T.x0 + j * T.step, z = T.z0 + i * T.step, q = Math.hypot(x - cx, z - cz) / r;
    if (q >= 1) continue;
    const k = i * N + j;
    H[k] += h * (1 - q * q) * (0.75 + 0.5 * fbm(x * 0.7, z * 0.7, 2));
  }
  markDirty(i0, i1, j0, j1);
}

export function addHeat(cx, cz, r, amt) {
  const j0 = Math.max(0, Math.floor((cx - r - T.x0) / T.step)), j1 = Math.min(N - 1, Math.ceil((cx + r - T.x0) / T.step));
  const i0 = Math.max(0, Math.floor((cz - r - T.z0) / T.step)), i1 = Math.min(N - 1, Math.ceil((cz + r - T.z0) / T.step));
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const x = T.x0 + j * T.step, z = T.z0 + i * T.step, q = Math.hypot(x - cx, z - cz) / r;
    if (q >= 1) continue;
    const k = i * N + j, v = amt * (1 - q);
    if (v > heat[k]) { heat[k] = v; hot.add(k); }
  }
}

export function flush() {
  if (dirtyBox) { refresh(...dirtyBox); dirtyBox = null; }
}

export function update(dt) {
  flush();
  if (hot.size) {
    for (const k of hot) {
      heat[k] = Math.max(0, heat[k] - dt * (heat[k] > 0.9 ? 0.09 : 0.06));
      aHeat[k] = heat[k];
      if (heat[k] <= 0) hot.delete(k);
    }
    heatAttr.needsUpdate = true;
  }
  if (ovDirty) { ovTex.needsUpdate = true; ovDirty = false; }
}

export function reset() {
  for (let k = 0; k < N * N; k++) { H[k] = H0[k]; heat[k] = 0; aHeat[k] = 0; }
  hot.clear();
  refresh(0, N - 1, 0, N - 1);
  heatAttr.needsUpdate = true;
  ovReset();
}

export function init() {
  for (let k = 0; k < N * N; k++) H0[k] = 0;
  paintReset();
  reset();
}
export function commitPaint() { paintTex.needsUpdate = true; }
