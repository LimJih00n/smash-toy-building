// Renderer, camera, the toy-miniature (diorama) look: painted sky, soft lighting, tilt-shift post-processing.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { clamp } from './util.js';

const QS = new URLSearchParams(location.search);
export const IS_TEST = QS.has('test');
export const COARSE = matchMedia('(pointer: coarse)').matches;
// The camera looks down at a model city: a narrow lens from farther away (fov), and a fake tilt-shift
// blur at the top and bottom of the screen (tilt; ?tilt=0 turns it off).
export const STYLE = { fov: 30, tilt: QS.get('tilt') !== '0' };
export const QUALITY = { level: QS.get('q') || (COARSE ? 'low' : 'high') };
QUALITY.shadowSize = QUALITY.level === 'low' ? 2048 : 4096;
const POST = STYLE.tilt;

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(STYLE.fov, innerWidth / innerHeight, 0.5, 5000);

export const renderer = new THREE.WebGLRenderer({
  antialias: !POST, powerPreference: 'high-performance', preserveDrawingBuffer: IS_TEST,
});
const PR = Math.min(devicePixelRatio || 1, QUALITY.level === 'low' ? 1.25 : 1.75);
renderer.setPixelRatio(IS_TEST ? 1 : PR);
renderer.setSize(innerWidth, innerHeight);
// linear keeps the pastel colours and the blue sky clean (ACES greys them); fire simply clips to white
renderer.toneMapping = THREE.LinearToneMapping;
// shader error checks read the compile log back from the driver, which waits for the compile to finish:
// keep them for tests and ?debug only
renderer.debug.checkShaderErrors = IS_TEST || QS.has('debug');
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = QUALITY.level === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
document.getElementById('stage').appendChild(renderer.domElement);

export const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.minDistance = 12;
controls.maxDistance = 2000;
controls.maxPolarAngle = Math.PI * 0.62;
controls.zoomSpeed = 1.1;
controls.rotateSpeed = 0.55;
controls.panSpeed = 0.9;
controls.screenSpacePanning = false;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

// ---------- sky: a clean studio gradient (deep sky blue overhead, pale at the horizon, blue again below
// it, since the diorama floats) with a few round cartoon clouds; a dimmer copy lights the scene
const HORIZON = 0xd6e7fb;
function makeSkyTexture() {
  const W = IS_TEST ? 512 : 1024, H = W / 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#5f9ff0'); grd.addColorStop(0.32, '#9cc6f6'); grd.addColorStop(0.5, '#d6e7fb');
  grd.addColorStop(0.6, '#bcd6f6'); grd.addColorStop(1, '#8fb9ec');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  let s = 4242; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const k = W / 1024;
  for (let i = 0; i < 18; i++) {
    const x = rnd() * W, y = H * 0.5 - (14 + rnd() * 48) * k, n = 3 + Math.floor(rnd() * 4), r = (9 + rnd() * 9) * k;
    const puffs = [];
    for (let j = 0; j < n; j++) puffs.push([x + (j - (n - 1) / 2) * r * 1.15 + (rnd() - 0.5) * r * 0.4, y - Math.sin((j + 0.5) / n * Math.PI) * r * 0.7, r * (0.75 + 0.5 * Math.sin((j + 0.5) / n * Math.PI))]);
    for (const dx of [0, -W, W]) { // wrap around the seam
      g.fillStyle = 'rgba(200,218,240,0.9)';
      for (const [px, py, pr] of puffs) { g.beginPath(); g.arc(px + dx, py + pr * 0.18, pr, 0, 7); g.fill(); }
      g.fillStyle = '#ffffff';
      for (const [px, py, pr] of puffs) { g.beginPath(); g.arc(px + dx, py - pr * 0.06, pr * 0.94, 0, 7); g.fill(); }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

export const skyTex = makeSkyTexture();
scene.background = skyTex;
scene.backgroundIntensity = 1.0;
{
  // the scene is lit by a dimmer copy of the sky (about half, linear): with the full sky as fill the shadow
  // sides came out nearly as bright as the sunlit ones and every building looked flat and washed out
  const pmrem = new THREE.PMREMGenerator(renderer);
  const img = skyTex.image, c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0); g.fillStyle = 'rgba(0,0,0,0.24)'; g.fillRect(0, 0, c.width, c.height);
  const src = new THREE.CanvasTexture(c); src.colorSpace = THREE.SRGBColorSpace; src.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = pmrem.fromEquirectangular(src).texture;
  src.dispose();
  pmrem.dispose();
}
export const fog = new THREE.Fog(HORIZON, 1400, 4200);
scene.fog = fog;

// ---------- lights
// a cool fill, kept low enough that the sun still models the buildings
export const hemi = new THREE.HemisphereLight(0xeef4ff, 0xb9b2a4, 0.6);
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xfff2e2, 3.0);
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
// Fake tilt-shift: a sharp band through the middle of the screen, a blur that grows toward
// the top and bottom edges, as two separable passes (horizontal, then vertical). The vertical pass also
// does the tone mapping and sRGB output, so the pipeline is scene -> H -> V with no OutputPass, and
// pixels inside the sharp band cost one texture read per pass. Blur radius is in CSS pixels.
// The scene writes alpha 1 everywhere except hand-held objects (see keepSharp), which write 0: those
// pixels are not blurred, and the blur around them leaves them out so they don't bleed into the background.
const TILT_PX = 3.2, TILT_BAND = 0.14;
const tiltShader = (out) => ({
  defines: out ? { OUT: '' } : {},
  uniforms: { tDiffuse: { value: null }, uStep: { value: new THREE.Vector2() }, uAmt: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uStep; uniform float uAmt; varying vec2 vUv;
    vec4 tap(vec2 uv, float w) { vec4 t = texture2D(tDiffuse, uv); return vec4(t.rgb * t.a, t.a) * w; }
    void main(){
      float d = clamp((abs(vUv.y - 0.5) - ${TILT_BAND.toFixed(3)}) / ${(0.5 - TILT_BAND).toFixed(3)}, 0.0, 1.0);
      vec4 s = texture2D(tDiffuse, vUv);
      float k = d * d * uAmt * s.a;
      if (k >= 0.01) {
        vec2 o = uStep * k;
        vec4 a = tap(vUv, 0.1633);
        a += tap(vUv - o, 0.1531) + tap(vUv + o, 0.1531);
        a += tap(vUv - 2.0 * o, 0.12245) + tap(vUv + 2.0 * o, 0.12245);
        a += tap(vUv - 3.0 * o, 0.0918) + tap(vUv + 3.0 * o, 0.0918);
        a += tap(vUv - 4.0 * o, 0.051) + tap(vUv + 4.0 * o, 0.051);
        s.rgb = a.rgb / a.a;
      }
      gl_FragColor = s;
      #ifdef OUT
      gl_FragColor.a = 1.0;
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #endif
    }`,
});
/** keep a hand-held object (the gun rig) out of the tilt-shift blur by having it write alpha 0 */
export function keepSharp(m) {
  if (!STYLE.tilt) return;
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a = 0.0;'); };
}
export let composer = null;
const tilt = [];
function sizeTilt() { if (tilt.length) { tilt[0].uniforms.uStep.value.set(TILT_PX / innerWidth, 0); tilt[1].uniforms.uStep.value.set(0, TILT_PX / innerHeight); } }
if (POST) {
  // the image clips anyway (no bloom), so an 8-bit sRGB target (no banding in the sky gradient) is enough
  // and halves the bandwidth of the multisampled scene buffer
  const rt = new THREE.WebGLRenderTarget(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio(), { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  for (const out of [false, true]) { const p = new ShaderPass(tiltShader(out)); tilt.push(p); composer.addPass(p); }
  sizeTilt();
}

// A real tilt-shift photo of a model is taken from above. Looking down, the blur sells the miniature;
// looking level at a tall tower it would only smear the tower top, so it fades out below ~12° of pitch.
const _look = new THREE.Vector3();
function updateTilt() {
  if (!tilt.length) return;
  camera.getWorldDirection(_look);
  const pitch = Math.asin(clamp(-_look.y, -1, 1)), t = clamp((pitch - 0.2) / 0.4, 0, 1), amt = t * t * (3 - 2 * t);
  for (const p of tilt) p.uniforms.uAmt.value = amt;
}
export const exposure = { base: 0.95, dip: 0, boost: 0 };
// low quality (phones): the sun's shadow map is redrawn every other frame. The sun doesn't move, only
// rubble does, and its shadow trailing one frame is invisible, while the pass costs a full scene draw.
const SHADOW_HALF = QUALITY.level === 'low';
renderer.shadowMap.autoUpdate = !SHADOW_HALF;
let shadowTick = 0;
export function render() {
  renderer.toneMappingExposure = exposure.base * (1 - exposure.dip) * (1 + exposure.boost);
  updateTilt();
  if (SHADOW_HALF) renderer.shadowMap.needsUpdate = (shadowTick++ & 1) === 0;
  if (composer) composer.render(); else renderer.render(scene, camera);
}

export function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
  sizeTilt();
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
