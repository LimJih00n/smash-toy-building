// Renderer, camera, sky dome with clouds, image-based lighting, sun, post-processing.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { clamp } from './util.js';

const QS = new URLSearchParams(location.search);
export const IS_TEST = QS.has('test');
export const COARSE = matchMedia('(pointer: coarse)').matches;
export const QUALITY = { level: QS.get('q') || (COARSE ? 'low' : 'high') };
QUALITY.bloom = QUALITY.level !== 'low' && QS.get('bloom') !== '0';
QUALITY.shadowSize = QUALITY.level === 'low' ? 2048 : 4096;

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 5000);

export const renderer = new THREE.WebGLRenderer({
  antialias: !QUALITY.bloom, powerPreference: 'high-performance', preserveDrawingBuffer: IS_TEST,
});
const PR = Math.min(devicePixelRatio || 1, QUALITY.level === 'low' ? 1.25 : 1.75);
renderer.setPixelRatio(IS_TEST ? 1 : PR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = QUALITY.level === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
document.getElementById('stage').appendChild(renderer.domElement);

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.minDistance = 12;
controls.maxDistance = 1300;
controls.maxPolarAngle = Math.PI * 0.62;
controls.zoomSpeed = 1.1;
controls.rotateSpeed = 0.55;
controls.panSpeed = 0.9;
controls.screenSpacePanning = false;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

// ---------- sky: painted cloud dome (also baked into the reflection environment)
function noise3Factory() {
  const perm = new Uint8Array(512);
  const p = []; for (let i = 0; i < 256; i++) p.push(i);
  let s = 1337;
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const h = (x, y, z) => perm[(perm[(perm[x & 255] + y) & 255] + z) & 255] / 255;
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const l = (a, b, t) => a + (b - a) * t;
    return l(
      l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
  };
}

function makeSkyTexture() {
  const W = IS_TEST ? 512 : 1024, H = W / 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const n3 = noise3Factory();
  const fbm3 = (x, y, z) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < 5; i++) { s += a * n3(x * f, y * f, z * f); a *= 0.5; f *= 2.07; } return s / 0.97; };
  for (let j = 0; j < H; j++) {
    const lat = (0.5 - (j + 0.5) / H) * Math.PI; // +90 top
    const el = Math.max(lat, 0) / (Math.PI / 2);   // 0 horizon .. 1 zenith
    // sky gradient: pale hazy horizon -> soft blue zenith
    const hr = 0.80 - 0.28 * Math.pow(el, 0.55), hg = 0.86 - 0.20 * Math.pow(el, 0.55), hb = 0.92 - 0.06 * Math.pow(el, 0.6);
    for (let i = 0; i < W; i++) {
      const lon = (i / W) * Math.PI * 2;
      const dx = Math.cos(lat) * Math.cos(lon), dy = Math.sin(lat), dz = Math.cos(lat) * Math.sin(lon);
      let r = hr, gg = hg, b = hb;
      if (lat > -0.12) {
        // clouds live on a flattened shell: stretch toward the horizon
        const k = 1 / Math.max(0.12, dy + 0.1);
        const cx = dx * k * 1.6, cz = dz * k * 1.6;
        let d = fbm3(cx + 11.3, 3.1, cz + 7.7);
        d = clamp((d - 0.47) * 2.6, 0, 1);
        const fade = clamp((dy - 0.0) * 6, 0, 1);
        d *= fade;
        const shade = 0.78 + 0.22 * fbm3(cx * 2.3 + 1, 9.2, cz * 2.3 + 4);
        const cr = 0.93 * shade, cg = 0.94 * shade, cb = 0.96 * shade;
        r = r + (cr - r) * d; gg = gg + (cg - gg) * d; b = b + (cb - b) * d;
      }
      if (lat < 0.10) {
        // below the horizon: a soft blend into a city/ground tone (what glass reflects low down)
        const t = clamp((0.10 - lat) / 0.5, 0, 1), s2 = t * t * (3 - 2 * t);
        const n = fbm3(dx * 9 + 2, dy * 9, dz * 9 + 5);
        const gr = 0.50 + 0.08 * n, gc = 0.53 + 0.08 * n, gb = 0.55 + 0.07 * n;
        r = r + (gr - r) * s2; gg = gg + (gc - gg) * s2; b = b + (gb - b) * s2;
      }
      const o = 4 * (j * W + i);
      img.data[o] = Math.min(255, r * 255); img.data[o + 1] = Math.min(255, gg * 255); img.data[o + 2] = Math.min(255, b * 255); img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

export const skyTex = makeSkyTexture();
scene.background = skyTex;
scene.backgroundIntensity = 1.0;
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(skyTex).texture;
  scene.environment = env;
  pmrem.dispose();
}
export const fog = new THREE.Fog(0xc6d2dc, 600, 2600);
scene.fog = fog;

// ---------- lights
export const hemi = new THREE.HemisphereLight(0xdfeaf5, 0x6b7a66, 0.75);
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xfff2e2, 2.6);
sun.position.set(-160, 260, 190);
sun.target.position.set(0, 0, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(QUALITY.shadowSize, QUALITY.shadowSize);
const SC = 290;
Object.assign(sun.shadow.camera, { left: -SC, right: SC, top: SC, bottom: -SC, near: 20, far: 900 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
// very tall maps (롯데월드타워 555 m): a tower top above the light's near plane is clamped into the shadow map
// and paints its shadow over the haze and the skyline -> move the light back along its direction
export function fitSunTo(top) {
  const dist = top > 300 ? top + 500 : 360;
  sun.position.set(-160, 260, 190).setLength(dist);
  sun.shadow.camera.far = dist + 600;
  sun.shadow.camera.updateProjectionMatrix();
}

// reusable dynamic point lights (kept in scene so shaders never recompile)
export const lightPool = [];
for (let i = 0; i < 6; i++) {
  const l = new THREE.PointLight(0xffaa66, 0, 120, 1.6);
  l.position.set(0, -999, 0);
  scene.add(l);
  lightPool.push({ light: l, busy: false, t: 0, life: 0, peak: 0, update: null });
}
export function grabLight() {
  let best = lightPool.find((l) => !l.busy);
  if (!best) best = lightPool.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));
  best.busy = true; best.t = 0; best.update = null;
  return best;
}
export function flashLight(pos, color, peak, life, range = 160) {
  const L = grabLight();
  L.light.color.set(color); L.light.distance = range; L.light.position.copy(pos);
  L.peak = peak; L.life = life; L.t = 0;
  L.update = (L, dt) => { L.t += dt; const k = L.t / L.life; L.light.intensity = L.peak * Math.pow(Math.max(0, 1 - k), 2); return k < 1; };
  return L;
}
export function updateLights(dt) {
  for (const L of lightPool) {
    if (!L.busy) continue;
    if (!L.update || !L.update(L, dt)) { L.busy = false; L.light.intensity = 0; L.light.position.y = -999; }
  }
}

// ---------- post
export let composer = null, bloom = null;
if (QUALITY.bloom) {
  const rt = new THREE.WebGLRenderTarget(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  // any NaN / overflowing HDR pixel would be blurred by the bloom into large black squares
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv);
        bool bad = !(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b) || max(max(c.r, c.g), c.b) > 6.0e4;
        if (bad) c = vec4(1.0, 0.9, 0.8, 1.0);
        gl_FragColor = vec4(clamp(c.rgb, 0.0, 40.0), 1.0); }`,
  }));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.32, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

export const exposure = { base: 0.95, dip: 0, boost: 0 };
export function render() {
  renderer.toneMappingExposure = exposure.base * (1 - exposure.dip) * (1 + exposure.boost);
  if (composer) composer.render(); else renderer.render(scene, camera);
}

export function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);

// ---------- dynamic resolution
// Rendering is fill-rate bound (the facade is shaded per pixel), so when a device can't hold the
// frame rate the cheapest fix is to render fewer pixels: scale the pixel ratio between 55% and 100%
// of the quality tier's value. Two traps are handled by checking that a drop actually helped:
// a frame-rate cap (iOS Low Power Mode runs rAF at 30 Hz) and CPU-bound frames (physics during a
// big collapse) don't get faster with fewer pixels, so an unhelpful drop is undone and the
// resolution is left alone for a while. ?drs=0 turns it off.
const PR_MAX = IS_TEST ? 1 : PR;
export const DRS = {
  on: !IS_TEST && QS.get('drs') !== '0',
  pr: PR_MAX, min: Math.max(0.6, PR_MAX * 0.55), max: PR_MAX,
  acc: 0, n: 0, cpu: 0, hold: 0, fails: 0, trial: null, log: [],
};
function setPR(pr) {
  pr = Math.round(pr * 20) / 20; // 0.05 steps: no resize for tiny changes
  if (pr === DRS.pr) return false;
  DRS.pr = pr;
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight);
  if (composer) { composer.setPixelRatio(pr); composer.setSize(innerWidth, innerHeight); }
  return true;
}
/** call once per rendered frame: frameSec = time since the previous frame, cpuMs = JS time spent on this one */
export function drsTick(frameSec, cpuMs) {
  if (!DRS.on || !(frameSec > 0) || frameSec > 0.5) return; // tab was hidden / stalled: not a sample
  DRS.acc += frameSec; DRS.n++; DRS.cpu += cpuMs;
  if (DRS.acc < 1) return;
  const fps = DRS.n / DRS.acc, frameMs = 1000 * DRS.acc / DRS.n, cpu = DRS.cpu / DRS.n;
  DRS.acc = 0; DRS.n = 0; DRS.cpu = 0;
  if (DRS.trial) { // judge the last drop
    const t = DRS.trial; DRS.trial = null;
    if (fps < t.fps * 1.08) { // didn't help: put it back, and wait longer each time this happens
      setPR(t.pr); DRS.fails++; DRS.hold = Math.min(120, 10 * 2 ** DRS.fails); DRS.log.push(['undo', DRS.pr, +fps.toFixed(1)]);
      return;
    }
    DRS.fails = 0; DRS.hold = 3; // helped: settle before trying to climb back
  }
  if (DRS.hold > 0) { DRS.hold--; return; }
  const gpuBound = cpu < frameMs * 0.6;
  if (fps < 45 && gpuBound && DRS.pr > DRS.min) {
    const prev = DRS.pr;
    if (setPR(Math.max(DRS.min, prev * (fps < 28 ? 0.8 : 0.9)))) { DRS.trial = { pr: prev, fps }; DRS.log.push(['down', DRS.pr, +fps.toFixed(1)]); }
  } else if (fps > 56 && DRS.pr < DRS.max) {
    if (setPR(Math.min(DRS.max, DRS.pr * 1.08))) { DRS.hold = 2; DRS.log.push(['up', DRS.pr, +fps.toFixed(1)]); }
  }
  if (DRS.log.length > 20) DRS.log.splice(0, DRS.log.length - 20);
}
