// Every breakable building chunk is one instance of a unit box in a single InstancedMesh.
// The facade (mullions, panels, broken windows, cut concrete) is drawn procedurally from each
// chunk's *rest-frame* coordinates, so splitting a chunk keeps the pattern continuous and
// freshly cut faces show floor slabs instead of glass.
import * as THREE from 'three';
import { scene } from './engine.js';

export const K = { CURTAIN: 0, CROWN: 1, STONE: 2, GRID: 3, RIBBON: 4, OFFICE: 5, METAL: 6, CONC: 7, DARKGLASS: 8, UNIT: 9, SOIL: 10, SHED: 11, SLAB: 12, RACK: 13, DESK: 14 };
export const CAP = 26000;

// -------- instanced mesh
const box = new THREE.BoxGeometry(1, 1, 1);
const geo = new THREE.InstancedBufferGeometry();
geo.index = box.index;
geo.setAttribute('position', box.attributes.position);
geo.setAttribute('normal', box.attributes.normal);
const aRest = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
const aSize = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
const aInfo = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
const aHeat = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1).setUsage(THREE.DynamicDrawUsage);
// per-building facade tint: rgb multiplies glass, w multiplies opaque walls (1,1,1,1 = as designed)
const aTint = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4).fill(1), 4).setUsage(THREE.DynamicDrawUsage);
geo.setAttribute('aRest', aRest);
geo.setAttribute('aSize', aSize);
geo.setAttribute('aInfo', aInfo);
geo.setAttribute('aHeatI', aHeat);
geo.setAttribute('aTint', aTint);
// the building's pastel paint (rgb) and whether it has one (w)
const aPaint = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
geo.setAttribute('aPaint', aPaint);

const GLSL_COMMON = /* glsl */`
float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }
float hh3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453123); }
float vn(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  float a=hh3(i), b=hh3(i+vec3(1,0,0)), c=hh3(i+vec3(0,1,0)), d=hh3(i+vec3(1,1,0));
  float e=hh3(i+vec3(0,0,1)), g=hh3(i+vec3(1,0,1)), h=hh3(i+vec3(0,1,1)), k=hh3(i+vec3(1,1,1));
  return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y), mix(mix(e,g,f.x),mix(h,k,f.x),f.y), f.z); }
// anti-aliased periodic line: 1 on the line, fades to its average coverage when too small on screen
float gl(float x, float period, float halfW){
  if (halfW < period * 0.25) halfW = min(halfW * 1.6, period * 0.25); // chunkier frames and joints, like a moulded model
  float f = x / period; float w = halfW / period; float fw = max(fwidth(f), 1e-5);
  float d = abs(fract(f + 0.5) - 0.5);
  float l = 1.0 - smoothstep(w - fw * 0.75, w + fw * 0.75, d);
  return mix(l, clamp(2.0 * w, 0.0, 1.0), smoothstep(0.22, 0.5, fw));
}
// anti-aliased band: 1 where fract(x/period) in [a,b]
float band(float x, float period, float a, float b){
  float f = fract(x / period); float fw = max(fwidth(x / period), 1e-5);
  float r = smoothstep(a - fw, a + fw, f) * (1.0 - smoothstep(b - fw, b + fw, f));
  return mix(r, b - a, smoothstep(0.22, 0.5, fw));
}
`;

const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.0, envMapIntensity: 1.0 });
mat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
attribute vec3 aRest; attribute vec3 aSize; attribute vec4 aInfo; attribute float aHeatI; attribute vec4 aTint;
varying vec3 vRest; varying vec3 vRN; varying vec4 vInfo; varying float vExt; varying float vHeatI; varying vec4 vTint;
attribute vec4 aPaint; varying vec3 vLoc; varying vec3 vSz; varying vec4 vPaint;
`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
vRest = aRest + position * aSize; vRN = normal; vInfo = aInfo; vHeatI = aHeatI; vTint = aTint;
vLoc = position * aSize; vSz = aSize; vPaint = aPaint;
{ int m = int(aInfo.y + 0.5);
  int bit = normal.x > 0.5 ? 0 : (normal.x < -0.5 ? 1 : (normal.y > 0.5 ? 2 : (normal.y < -0.5 ? 3 : (normal.z > 0.5 ? 4 : 5))));
  vExt = float((m >> bit) & 1); }`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
varying vec3 vRest; varying vec3 vRN; varying vec4 vInfo; varying float vExt; varying float vHeatI; varying vec4 vTint;
varying vec3 vLoc; varying vec3 vSz; varying vec4 vPaint;
${GLSL_COMMON}`)
    .replace('#include <color_fragment>', `#include <color_fragment>
vec3 P = vRest; vec3 Nr = normalize(vRN);
bool side = abs(Nr.y) < 0.5;
vec2 fc = abs(Nr.x) > 0.5 ? vec2(P.z * sign(Nr.x), P.y) : vec2(-P.x * sign(Nr.z), P.y);
int kind = int(vInfo.x + 0.5); int vari = int(vInfo.w + 0.5); float dmg = vInfo.z;
vec3 col = vec3(0.7); float rgh = 0.8; float mtl = 0.0; vec3 emi = vec3(0.0); float pert = 0.0; vec3 pertSeed = vec3(0.0);
float fh = kind == 0 || kind == 1 ? 4.6 : (kind == 5 ? 3.8 : (kind == 2 || kind == 3 || kind == 4 ? 6.0 : 4.0));
float nz = vn(P * 1.7) * 0.6 + vn(P * 5.3) * 0.4;
nz = 0.5 + (nz - 0.5) * 0.3; // moulded plastic: almost no grime or mottling
if (kind >= 12 && kind <= 14) {
  // ---- what is inside a building (hollow models): floors, pallet racks, desks
  if (kind == 12) {
    if (Nr.y > 0.5) {
      if (vari == 1) { // warehouse epoxy, yellow aisle lines
        col = vec3(0.47, 0.52, 0.48) * (0.85 + 0.2 * nz);
        col = mix(col, vec3(0.86, 0.72, 0.18), max(gl(P.x, 9.0, 0.03), gl(P.z, 4.6, 0.025)) * 0.8);
        rgh = 0.45;
      } else if (vari == 2) { // parking deck
        col = vec3(0.30, 0.31, 0.32) * (0.85 + 0.25 * nz);
        col = mix(col, vec3(0.85), gl(P.x, 2.6, 0.05) * step(0.5, fract(P.z / 16.0)) * 0.8);
      } else if (vari == 3) { // flats: wooden floors
        col = vec3(0.55, 0.40, 0.27) * (0.85 + 0.2 * vn(vec3(floor(P.x / 0.18), 0.0, P.z * 0.4)));
        rgh = 0.6;
      } else { // offices: carpet tiles
        col = vec3(0.33, 0.36, 0.40) * (0.9 + 0.1 * step(0.5, fract(floor(P.x / 0.6) * 0.5 + floor(P.z / 0.6) * 0.5)));
        rgh = 0.95;
      }
    } else if (Nr.y < -0.5) { // ceiling: panels and light strips
      col = vec3(0.80, 0.80, 0.78) * (1.0 - 0.15 * max(gl(P.x, 0.6, 0.04), gl(P.z, 0.6, 0.04)));
      float lt = step(0.45, fract(P.x / 2.4)) * step(fract(P.x / 2.4), 0.55) * step(0.2, fract(P.z / 3.6)) * step(fract(P.z / 3.6), 0.8);
      emi = vec3(0.9, 0.92, 0.95) * lt * 0.6; col = mix(col, vec3(1.0), lt);
    } else {
      col = vec3(0.56, 0.55, 0.53) * (0.8 + 0.3 * nz); rgh = 0.9;
    }
  } else if (kind == 13) { // pallet racking: orange uprights, blue beams, cartons
    float u = fc.x, v = P.y;
    float bay = floor(u / 2.7), lvl = floor(v / 1.7);
    float up = gl(u, 2.7, 0.10), beam = step(fract(v / 1.7), 0.07);
    float h = vn(vec3(bay * 3.1, lvl * 1.7, P.x * 0.01 + P.z * 0.013));
    vec3 box = h < 0.18 ? vec3(0.12) : (h < 0.6 ? vec3(0.62, 0.47, 0.30) : vec3(0.70, 0.56, 0.37)) * (0.85 + 0.25 * vn(P * 3.0));
    if (!side) box = vec3(0.62, 0.47, 0.30);
    col = box; rgh = 0.85;
    if (side && up > 0.5) { col = vec3(0.92, 0.42, 0.10); rgh = 0.5; mtl = 0.3; }
    else if (side && beam > 0.5) { col = vec3(0.12, 0.30, 0.62); rgh = 0.5; mtl = 0.3; }
  } else { // desks with monitors
    if (Nr.y > 0.5) {
      col = vec3(0.86, 0.85, 0.82);
      float mon = step(0.15, fract(P.x / 1.6)) * step(fract(P.x / 1.6), 0.55) * step(0.42, fract(P.z / 1.6)) * step(fract(P.z / 1.6), 0.5);
      col = mix(col, vec3(0.06, 0.07, 0.08), mon); rgh = mix(0.6, 0.2, mon);
    } else { col = vec3(0.45, 0.46, 0.48); rgh = 0.7; }
  }
} else if (vExt < 0.5) {
  // ---- freshly exposed interior: slabs, dark office voids, columns
  float ly = fract(P.y / fh);
  vec3 conc = vec3(0.40, 0.395, 0.385) * (0.62 + 0.5 * nz);
  if (side) {
    float slab = 1.0 - smoothstep(0.10, 0.13, ly);
    float ceil = smoothstep(0.86, 0.9, ly);
    vec3 voidc = vec3(0.10, 0.105, 0.115) * (0.6 + 0.8 * vn(P * 0.6));
    float colm = gl(fc.x, 7.2, 0.35);
    col = mix(voidc, conc, clamp(slab + colm * 0.9 + ceil * 0.35, 0.0, 1.0));
  } else {
    col = conc * 0.85;
  }
  // dust and grime on broken surfaces
  col *= 0.85 + 0.25 * vn(P * 0.35);
  rgh = 0.95;
} else if (!side) {
  // ---- roofs
  if (Nr.y > 0.0) {
    if (kind == 0 || kind == 1) col = vec3(0.30, 0.31, 0.32) + 0.05 * nz;
    else if (kind == 2 || kind == 3 || kind == 4) col = vec3(0.63, 0.64, 0.62) * (0.9 + 0.12 * nz);
    else if (kind == 9) col = vari == 1 ? vec3(0.15, 0.17, 0.17) : vec3(0.55, 0.57, 0.58);
    else if (kind == 6 && vari >= 5) { // coated fab roofs seen on the skyview (SK hynix campus): 5 orange, 6 teal, 7 blue, 8 dark grey, 9 green, 10 grey + solar rows
      col = (vari == 5 ? vec3(0.62, 0.25, 0.10) : vari == 6 ? vec3(0.16, 0.30, 0.36) : vari == 7 ? vec3(0.14, 0.26, 0.45) : vari == 8 ? vec3(0.17, 0.18, 0.19) : vari == 9 ? vec3(0.13, 0.30, 0.20) : vec3(0.42, 0.43, 0.43)) * (0.9 + 0.12 * nz);
      if (vari == 10) { float pr = step(0.15, fract(P.z / 6.0)) * step(fract(P.z / 6.0), 0.85) * step(0.05, fract(P.x / 20.0)) * step(fract(P.x / 20.0), 0.95); col = mix(col, vec3(0.10, 0.13, 0.19), pr); }
    }
    else if (kind == 11 && vari >= 200 && vari < 300) { // rooftop car park: asphalt, white bay lines, drive aisles
      col = vec3(0.16, 0.17, 0.18) * (0.85 + 0.25 * nz);
      float rz = fract(P.z / 16.0);
      float bayl = gl(P.x, 2.6, 0.05) * step(0.5, rz);
      col = mix(col, vec3(0.85), bayl * 0.8);
      // parked cars (satellite: the deck is about half full)
      float bx = floor(P.x / 2.6), bz = floor(P.z / 16.0);
      float occ = vn(vec3(bx, bz, 7.0)), fx = fract(P.x / 2.6);
      if (occ > 0.45 && rz > 0.56 && rz < 0.86 && fx > 0.16 && fx < 0.84) {
        float hc = vn(vec3(bx, bz, 19.0));
        vec3 cc = hc < 0.35 ? vec3(0.86) : hc < 0.55 ? vec3(0.08) : hc < 0.75 ? vec3(0.55, 0.57, 0.6) : hc < 0.87 ? vec3(0.18, 0.24, 0.4) : vec3(0.5, 0.12, 0.1);
        col = cc; rgh = 0.3; mtl = 0.6;
      }
    }
    else if (kind == 11) {
      // steel deck roofs (satellite, Chilgok logistics park): plain light grey with a ridge,
      // light grey with rows of solar panels, or green coated deck with solar panels
      // roof type: sheds carry it in vari (0..2); FC walls use 100+H (plain), 300+H (solar), 400+H (green + solar)
      int rt = vari < 100 ? vari : (vari >= 400 ? 2 : (vari >= 300 ? 1 : 0));
      col = (rt == 2 ? vec3(0.12, 0.33, 0.22) : rt == 3 ? vec3(0.20, 0.36, 0.62) : vec3(0.80, 0.81, 0.80)) * (0.9 + 0.12 * nz); // 3 = blue steel deck
      col *= 1.0 - 0.12 * gl(P.x, 1.0, 0.08);
      if (rt == 1 || rt == 2) {
        float pr = step(0.18, fract(P.z / 7.0)) * step(fract(P.z / 7.0), 0.82) * step(0.06, fract(P.x / 24.0)) * step(fract(P.x / 24.0), rt == 2 ? 0.5 : 0.94);
        col = mix(col, vec3(0.13, 0.17, 0.24) * (1.0 - 0.3 * gl(P.x, 1.0, 0.1)), pr);
        rgh = mix(rgh, 0.25, pr);
      }
    }
    else col = vec3(0.5, 0.5, 0.49) * (0.85 + 0.2 * nz);
    float seams = max(gl(P.x, 6.0, 0.06), gl(P.z, 6.0, 0.06));
    col *= 1.0 - 0.18 * seams;
    rgh = 0.9;
  } else { col = vec3(0.35); rgh = 0.9; }
} else {
  float u = fc.x, v = fc.y;
  // office facades (glass and punched windows) are pure repeats: draw them at a larger scale, so a toy
  // tower has fewer, bigger windows. Other kinds place features at real heights and keep their scale.
  if (kind == 0 || kind == 4 || kind == 5 || kind == 8) { u *= 0.55; v *= 0.55; }
  if (kind == 0 || kind == 8 || kind == 4 || (kind == 5 && (vari == 2 || vari == 5))) {
    // ---- curtain wall family
    float mw = kind == 0 ? 1.55 : (kind == 8 ? 2.0 : 1.6);
    float ph = kind == 4 ? 2.0 : (kind == 8 ? 3.0 : fh);
    vec2 cell = vec2(floor(u / mw), floor(v / ph));
    float pr = hh(cell), pr2 = hh(cell + 17.3);
    vec3 glass;
    if (kind == 0) glass = mix(vec3(0.50, 0.60, 0.68), vec3(0.42, 0.54, 0.64), pr);
    else if (kind == 4) glass = mix(vec3(0.24, 0.40, 0.55), vec3(0.20, 0.34, 0.48), pr);
    else if (kind == 8) glass = vec3(0.16, 0.21, 0.26);
    else if (vari == 2) glass = mix(vec3(0.20, 0.30, 0.42), vec3(0.16, 0.26, 0.37), pr);
    else glass = mix(vec3(0.30, 0.44, 0.40), vec3(0.26, 0.40, 0.37), pr);
    glass *= vTint.rgb;
    float vm = gl(u, mw, kind == 0 ? 0.045 : 0.06);
    float hm = gl(v, ph, kind == 0 ? 0.10 : 0.07);
    float tm = kind == 0 ? gl(v - ph * 0.21, ph, 0.03) : 0.0;
    // vari 3: diagrid glass (one diamond per storey, white members)
    if (kind == 0 && vari == 3) { float dk = 3.2 / ph; vm = max(gl(u + v * dk, 6.4, 0.07), gl(u - v * dk, 6.4, 0.07)); hm *= 0.35; tm = 0.0; }
    // vari 4: dense white aluminium fins over clear glass (아모레퍼시픽 용산): fins win, faint storey lines
    if (kind == 0 && vari == 4) { vm = gl(u, 0.75, 0.32); hm = gl(v, 5.0, 0.03) * 0.5; tm = 0.0; }
    // vari 6: pale glass in a bold white grid, one 3.1 m panel per storey (네이버 1784)
    if (kind == 0 && vari == 6) { vm = gl(u, 3.1, 0.075); hm = gl(v, ph, 0.13); tm = 0.0; }
    // vari 7: tight vertical green glass louvres over the glass (네이버 그린팩토리)
    if (kind == 0 && vari == 7) { vm = gl(u, 0.9, 0.3); hm = gl(v, ph, 0.04) * 0.6; tm = 0.0; }
    // vari 8: grey-blue glass with two grey horizontal louvre bands per storey (삼성 서울R&D캠퍼스)
    if (kind == 0 && vari == 8) { vm = gl(u, 1.55, 0.05); hm = max(gl(v, ph, 0.5), gl(v - ph * 0.5, ph, 0.22)); tm = 0.0; }
    // vari 5: pixel skin (장교동 한화빌딩): half-storey cells, about half of them silver panels, the rest pale glass
    float px5 = 0.0;
    if (kind == 0 && vari == 5) { vec2 c5 = vec2(floor(u / 1.3), floor(v / (ph * 0.5))); px5 = step(0.52, hh(c5 + 5.5)) * (0.9 + 0.12 * hh(c5 + 1.7)); vm = gl(u, 1.3, 0.05); hm = gl(v, ph * 0.5, 0.04) * 0.7; tm = 0.0; }
    float spandrel = kind == 0 && vari != 3 && vari != 4 && vari != 5 && vari != 6 && vari != 7 && vari != 8 ? band(v, ph, 0.0, 0.2) : 0.0;
    vec3 mull = kind == 0 ? (vari == 4 || vari == 6 ? vec3(0.9, 0.9, 0.88) : vari == 7 ? vec3(0.36, 0.56, 0.46) * vTint.rgb : vari == 8 ? vec3(0.50, 0.52, 0.54) : vec3(0.80, 0.82, 0.84)) : (kind == 5 ? vec3(0.85) : vec3(0.22, 0.24, 0.26));
    col = mix(glass, glass * vec3(0.62, 0.68, 0.74), spandrel * 0.85);
    rgh = 0.05 + 0.06 * pr2; mtl = 0.92;
    if (px5 > 0.0) { col = vec3(0.80, 0.82, 0.84) * px5; rgh = 0.32; mtl = 0.55; }
    pert = 1.0; pertSeed = vec3(cell, pr);
    // damage: cracked and blown-out panes
    if (dmg > 0.001) {
      vec2 lp = vec2(fract(u / mw), fract(v / ph));
      if (pr2 < dmg * 0.95) {
        float edge = min(min(lp.x, 1.0 - lp.x), min(lp.y, 1.0 - lp.y));
        float jag = 0.05 + 0.08 * hh(floor(lp * 9.0) + cell);
        if (edge > jag) { col = vec3(0.045, 0.05, 0.055) * (0.6 + 0.8 * vn(P * 0.9)); rgh = 0.95; mtl = 0.0; pert = 0.0; }
      } else if (pr2 < dmg * 1.8) {
        vec2 c0 = vec2(hh(cell + 3.1), hh(cell + 5.7));
        vec2 dlt = lp - c0;
        float ang = atan(dlt.y, dlt.x);
        float rays = smoothstep(0.93, 1.0, abs(sin(ang * 5.0 + pr * 31.0 + length(dlt) * 9.0)));
        float rings = smoothstep(0.86, 1.0, abs(sin(length(dlt) * 38.0))) * step(length(dlt), 0.35);
        float cr = clamp(rays + rings * 0.6, 0.0, 1.0);
        col = mix(col, vec3(0.92), cr * 0.8); rgh = mix(rgh, 0.5, cr); mtl = mix(mtl, 0.2, cr);
      }
    }
    float mm = max(vm, max(hm, tm));
    col = mix(col, mull, mm); rgh = mix(rgh, 0.38, mm); mtl = mix(mtl, kind == 0 ? 0.85 : 0.6, mm);
    pert *= 1.0 - mm;
  } else if (kind == 1) {
    // ---- dark mechanical crown: vertical fins and bands
    float fin = gl(u, 0.55, 0.07);
    float bnd = gl(v, 2.3, 0.08);
    col = vec3(0.115, 0.125, 0.135) * (0.9 + 0.2 * nz);
    col = mix(col, vec3(0.21, 0.22, 0.235), max(fin, bnd * 0.7));
    rgh = 0.42; mtl = 0.65;
  } else if (kind == 2) {
    // ---- white stone podium: coursed panels (+ optional window ribbon)
    vec2 cell = vec2(floor(u / 1.5 + 0.5 * floor(v / 0.75)), floor(v / 0.75));
    float pr = hh(cell);
    col = vec3(0.86, 0.857, 0.84) * (0.965 + 0.06 * pr) * (0.95 + 0.07 * nz);
    float j = max(gl(v, 0.75, 0.012), gl(u + 0.75 * floor(v / 0.75), 1.5, 0.012));
    col *= 1.0 - 0.13 * j;
    rgh = 0.72;
    if (vari == 1 && v > 9.0 && v < 10.7) {
      float vm = gl(u, 1.5, 0.05);
      vec3 g = vec3(0.17, 0.24, 0.31);
      col = mix(g, vec3(0.3, 0.32, 0.34), vm); rgh = mix(0.06, 0.4, vm); mtl = 0.85; pert = 1.0 - vm; pertSeed = vec3(floor(u / 1.5), 3.0, 1.0);
    }
    if (vari == 1 && (abs(v - 8.9) < 0.12 || abs(v - 10.8) < 0.12)) { col = vec3(0.55, 0.56, 0.57); mtl = 0.5; rgh = 0.4; }
    if (vari == 3) col *= vec3(1.0, 0.92, 0.76); // vari 3: warm cream sandstone
    if (vari == 5) { col = vec3(0.47, 0.32, 0.21) * (0.92 + 0.1 * nz) * (1.0 - 0.6 * gl(v, 0.45, 0.2)); rgh = 0.6; } // vari 5: brown horizontal louvres (한화빌딩 저층부)
    // vari 4: white lattice skin (롯데월드몰 / 에비뉴엘): bright panels on a 2.1 x 1.6 m grid, dark joints,
    // a few panels left open as dark glass
    if (vari == 4) {
      vec2 c4 = vec2(floor(u / 2.1), floor(v / 1.6)); float q = hh(c4 + 4.4);
      col = vec3(0.93, 0.93, 0.92) * (0.95 + 0.07 * q) * (0.95 + 0.06 * nz);
      float j4 = max(gl(u, 2.1, 0.035), gl(v, 1.6, 0.04));
      col = mix(col, vec3(0.30, 0.32, 0.34), j4 * 0.85);
      rgh = 0.5;
      float lu = fract(u / 2.1);
      if (q < 0.22 + 0.5 * dmg && lu > 0.38 && lu < 0.62) { col = vec3(0.16, 0.19, 0.22); rgh = 0.08; mtl = 0.8; pert = 1.0; pertSeed = vec3(c4, 4.0); }
    }
    // vari 2: stone-clad core strip with a column of small square windows per storey (4.25 m)
    if (vari == 2) {
      float fy = fract(v / 4.25) * 4.25, fx = mod(u, 9.5);
      float win = step(1.3, fy) * step(fy, 2.9) * max(step(2.2, fx) * step(fx, 3.4), step(6.0, fx) * step(fx, 7.6));
      if (win > 0.5) { vec3 g = vec3(0.10, 0.13, 0.17); if (dmg > 0.001 && hh(vec2(floor(u / 9.5), floor(v / 4.25)) + 9.1) < dmg) g = vec3(0.03); col = g; rgh = 0.08; mtl = 0.85; pert = 1.0; pertSeed = vec3(floor(u / 9.5), floor(v / 4.25), 2.0); }
    }
  } else if (kind == 3) {
    // ---- podium top grid band: light frame, dark recessed squares
    float fr = max(gl(u, 2.6, 0.09), gl(v - 0.2, 2.6, 0.09));
    vec3 inset = vec3(0.20, 0.215, 0.23) * (0.9 + 0.15 * hh(vec2(floor(u / 2.6), floor(v / 2.6))));
    float lv = gl(v, 0.4, 0.05) * 0.35;
    col = mix(inset * (1.0 - lv), vec3(0.62, 0.63, 0.64), fr);
    rgh = mix(0.55, 0.6, fr); mtl = mix(0.45, 0.2, fr);
  } else if (kind == 5) {
    // ---- generic offices
    float bay = 3.0; vec2 cell = vec2(floor(u / bay), floor(v / fh)); float pr = hh(cell);
    vec2 lp = vec2(fract(u / bay), fract(v / fh));
    vec3 wall; float win;
    if (vari == 0) { wall = vec3(0.80, 0.79, 0.76); win = step(0.2, lp.x) * step(lp.x, 0.8) * step(0.3, lp.y) * step(lp.y, 0.78); }
    else if (vari == 1) { wall = vec3(0.88, 0.88, 0.87); win = band(v, fh, 0.32, 0.86); }
    else if (vari == 3) { wall = vec3(0.78, 0.72, 0.62); win = step(0.38, lp.x) * step(lp.x, 0.62) * step(0.2, lp.y) * step(lp.y, 0.85); }
    else if (vari == 6) { wall = vec3(0.70, 0.52, 0.42); win = step(0.25, lp.x) * step(lp.x, 0.75) * step(0.3, lp.y) * step(lp.y, 0.8); }
    else if (vari == 7) { wall = vec3(0.60, 0.62, 0.64); win = band(v, fh, 0.14, 0.9) * (1.0 - gl(u, 1.5, 0.04)); }
    else if (vari == 8) { wall = vec3(0.70, 0.43, 0.30); win = band(v, fh, 0.36, 0.84) * (1.0 - gl(u, 1.8, 0.05)); }
    else if (vari == 10) { wall = vec3(0.115, 0.105, 0.095); lp = vec2(fract(u / 2.7), fract(v / 4.45)); win = step(0.2, lp.x) * step(lp.x, 0.8) * step(0.22, lp.y) * step(lp.y, 0.78); } // SK 서린빌딩: near-black bronze grid, square windows
    else if (vari == 11) { wall = vec3(0.90, 0.89, 0.86); win = band(v, fh, 0.42, 0.76); } // 삼성 구미: cream wall, narrow dark ribbon windows
    else if (vari == 12) { wall = vec3(0.56, 0.27, 0.21) * (1.0 - 0.18 * gl(v, 0.35, 0.1)); win = band(v, fh, 0.30, 0.80) * (1.0 - gl(u, 3.0, 0.08)); } // 삼성 구미: brick-red ground storey
    else if (vari == 9) { float bk = gl(v, 0.3, 0.12) * 0.25; wall = vec3(0.56, 0.27, 0.19) * (1.0 - bk); lp = vec2(fract(u / 2.4), fract(v / 4.0)); win = step(0.28, lp.x) * step(lp.x, 0.72) * step(0.32, lp.y) * step(lp.y, 0.8); }
    else { wall = vec3(0.66, 0.68, 0.70); win = step(0.15, lp.x) * step(lp.x, 0.85) * step(0.25, lp.y) * step(lp.y, 0.8); }
    wall *= (0.92 + 0.12 * nz) * vTint.w;
    vec3 g = mix(vec3(0.20, 0.27, 0.33), vec3(0.28, 0.36, 0.42), pr) * vTint.rgb;
    if (dmg > 0.001 && hh(cell + 9.1) < dmg) { g = vec3(0.04); win = win; }
    col = mix(wall, g, win); rgh = mix(0.78, 0.08, win); mtl = mix(0.05, 0.85, win);
    pert = win; pertSeed = vec3(cell, pr);
  } else if (kind == 6) {
    float j = max(gl(v, 0.62, 0.012), gl(u, 1.25, 0.012));
    col = vec3(0.72, 0.74, 0.76) * (1.0 - 0.15 * j) * (0.95 + 0.08 * nz); rgh = 0.38; mtl = 0.7;
    // vari 11/12: 삼성 평택 fab skin — pale grey panels over an 18 m dark grey base with a louvre band;
    // 12 adds the Mondrian grid (black lines, red / blue / yellow / white fields) seen at the fab ends
    if (vari == 11 || vari == 12) {
      float pj = max(gl(v, 2.5, 0.02), gl(u, 5.0, 0.02));
      col = vec3(0.80, 0.81, 0.82) * (1.0 - 0.1 * pj) * (0.96 + 0.06 * nz); mtl = 0.35; rgh = 0.5;
      if (v < 18.0) { col = vec3(0.22, 0.23, 0.24) * (1.0 - 0.35 * gl(v, 0.5, 0.15) * step(10.0, v)); }
      if (vari == 12 && v >= 18.0) {
        vec2 mc = vec2(floor(u / 17.0), floor((v - 18.0) / 15.0)); float r = hh(mc + 3.1);
        vec3 f = r < 0.12 ? vec3(0.74, 0.08, 0.10) : r < 0.20 ? vec3(0.10, 0.26, 0.62) : r < 0.27 ? vec3(0.92, 0.76, 0.08) : r < 0.55 ? vec3(0.94, 0.94, 0.93) : col;
        float edge = max(gl(u, 17.0, 0.45), gl(v - 18.0, 15.0, 0.45));
        col = mix(f, vec3(0.06), edge * step(r, 0.55)); mtl = 0.15;
      }
    }
  } else if (kind == 9) {
    float f = gl(u, 0.3, 0.05);
    col = (vari == 1 ? vec3(0.20, 0.22, 0.22) : vec3(0.56, 0.58, 0.59)) * (1.0 - 0.25 * f); rgh = 0.45; mtl = 0.6;
  } else if (kind == 11 && vari >= 200 && vari < 300) {
    // ---- multi-storey fulfilment centre, Goyang type (street view): pale grey panels, tall
    //      charcoal window bands every ~22 m, a blue glass ribbon over a deep open ground floor
    //      on white columns. vari - 200 = building height (m)
    float seam = gl(v, 1.2, 0.025);
    col = vec3(0.80, 0.81, 0.82) * vTint.w * (0.94 + 0.07 * nz) * (1.0 - 0.1 * seam); rgh = 0.55; mtl = 0.3;
    float bu = fract(u / 22.0);
    bool dark = bu > 0.4 && bu < 0.62 && v > 12.5;
    if (dark) {
      col = vec3(0.17, 0.18, 0.2) * (0.95 + 0.1 * nz); rgh = 0.35; mtl = 0.6;
      float wl = fract(v / 9.5), wu = fract((bu - 0.4) / 0.22 * 2.0);
      float w = step(0.55, wl) * step(wl, 0.7) * step(0.15, wu) * step(wu, 0.85);
      col = mix(col, vec3(0.32, 0.45, 0.58), w);
    }
    if (v > 9.6 && v < 12.4) { // glass ribbon
      float m = gl(u, 1.8, 0.05);
      col = mix(vec3(0.24, 0.40, 0.58), vec3(0.75), m); rgh = 0.1; mtl = 0.8;
    }
    if (v < 9.6) { // open ground floor under the overhang: deep shade + white columns
      float cu = fract(u / 11.0);
      col = vec3(0.10, 0.10, 0.11);
      if (cu < 0.12) col = vec3(0.82, 0.82, 0.8) * (0.9 + 0.1 * nz);
      rgh = 0.9; mtl = 0.0;
    }
  } else if (kind == 11 && vari >= 100) {
    // ---- multi-storey fulfilment centre (street view, Dongtan): white insulated panels with
    //      horizontal seams, blue vertical bays every ~46 m, a blue band at ~3/4 height,
    //      rows of small dark windows, ramp-fed truck floors. vari - 100 = building height (m)
    float H = float(vari - (vari / 100) * 100);
    float seam = gl(v, 1.0, 0.025);
    col = vec3(0.86, 0.87, 0.87) * vTint.w * (0.94 + 0.07 * nz) * (1.0 - 0.10 * seam);
    rgh = 0.55; mtl = 0.25;
    vec3 blue = vec3(0.22, 0.42, 0.66) * (0.94 + 0.08 * nz);
    float bayU = fract(u / 46.0);
    bool bay = bayU < 0.17;
    bool band = v > H * 0.66 && v < H * 0.82;
    if (bay || band) { col = blue * (1.0 - 0.08 * seam); rgh = 0.5; }
    // small dark windows in two rows, skipping the blue bays
    if (!bay && !band) {
      float wu = fract(u / 5.6);
      float r1 = step(H * 0.40, v) * step(v, H * 0.40 + 1.1), r2 = step(H * 0.60, v) * step(v, H * 0.60 + 1.1);
      float w = (r1 + r2) * step(0.35, wu) * step(wu, 0.62);
      col = mix(col, vec3(0.16, 0.2, 0.24), w); rgh = mix(rgh, 0.15, w); mtl = mix(mtl, 0.7, w);
    }
    // louvre panels inside the blue bays
    if (bay && v > H * 0.2 && v < H * 0.62) {
      float lu = fract(v / 9.5);
      float lv = step(0.25, lu) * step(lu, 0.6) * step(0.035, bayU) * step(bayU, 0.135);
      col = mix(col, vec3(0.62, 0.64, 0.66) * (1.0 - 0.35 * gl(v, 0.35, 0.3)), lv);
    }
    // loading docks along the long faces
    if (abs(Nr.z) > 0.5 && v < 5.6 && !bay) {
      float du = fract(u / 4.2);
      float door = step(0.12, du) * step(du, 0.86) * step(1.2, v) * step(v, 4.6);
      col = mix(vec3(0.55, 0.55, 0.54), vec3(0.62, 0.64, 0.66) * (0.9 - 0.12 * gl(v, 0.28, 0.12)), door);
      col = mix(col, vec3(0.07), step(0.06, du) * step(du, 0.92) * step(1.0, v) * step(v, 4.9) * (1.0 - door));
    }
  } else if (kind == 11) {
    // ---- logistics shed: ribbed sandwich panels, a coloured stripe, loading docks at the base
    //      vari 0 = docks on this face, 1 = plain wall. tint.rgb = stripe colour, tint.w = panel brightness
    float rib = gl(u, 0.32, 0.18) * 0.5 + gl(u, 1.0, 0.04);
    float seam = gl(v, 1.2, 0.03);
    vec3 panel = vec3(0.83, 0.85, 0.86) * vTint.w * (0.93 + 0.08 * nz);
    col = panel * (1.0 - 0.10 * rib - 0.12 * seam); rgh = 0.5; mtl = 0.35;
    // upper storeys: thin window strips every 9 m
    float wl = fract(v / 9.0);
    if (v > 10.0 && wl > 0.62 && wl < 0.72) { float wcell = step(0.15, fract(u / 4.0)); col = mix(col, vec3(0.20, 0.27, 0.33), wcell); rgh = mix(rgh, 0.1, wcell); mtl = mix(mtl, 0.8, wcell); }
    // accent stripe band
    if (v > 6.2 && v < 7.4) { col = vTint.rgb * vec3(0.30, 0.48, 0.80) * (0.95 + 0.1 * nz); rgh = 0.45; }
    // dock zone
    if (v < 6.2) {
      vec3 conc = vec3(0.56, 0.56, 0.55) * (0.85 + 0.2 * nz);
      col = conc; rgh = 0.9; mtl = 0.0;
      if (vari <= 2) {
        float du = fract(u / 4.2);
        float door = step(0.12, du) * step(du, 0.86) * step(1.2, v) * step(v, 4.6);
        float slat = gl(v, 0.28, 0.12);
        vec3 doorc = vec3(0.62, 0.64, 0.66) * (0.9 - 0.12 * slat);
        float seal = step(0.06, du) * step(du, 0.92) * step(1.0, v) * step(v, 4.9) * (1.0 - door);
        col = mix(col, vec3(0.07, 0.07, 0.08), seal);
        col = mix(col, doorc, door); rgh = mix(rgh, 0.5, door); mtl = mix(mtl, 0.5, door);
        float lamp = step(0.45, du) * step(du, 0.55) * step(5.0, v) * step(v, 5.3);
        col = mix(col, vec3(0.9, 0.85, 0.6), lamp);
      }
    }
  } else if (kind == 10) {
    col = vec3(0.42, 0.33, 0.24) * (0.7 + 0.5 * nz); rgh = 1.0;
  } else {
    col = vec3(0.64, 0.63, 0.60) * (0.82 + 0.3 * nz); rgh = 0.9;
  }
}
if (kind == 2 || kind == 3 || kind == 6 || kind == 7 || kind == 1) col *= ((kind == 2 && vari == 2 && mtl > 0.8) || (kind == 6 && vari >= 5 && !side && Nr.y > 0.0)) ? 1.0 : vTint.w;
// ---- toy model look: same patterns, plastic materials and pastel colours
if (kind < 12 && vExt < 0.5) {
  // cut faces: cream foam-board slabs and columns over soft lilac-grey voids, so a break reads at a glance
  float ly = fract(P.y / fh);
  if (side) {
    float slab = 1.0 - smoothstep(0.10, 0.13, ly), colm = gl(fc.x, 7.2, 0.35);
    col = mix(vec3(0.42, 0.43, 0.55), vec3(0.95, 0.88, 0.74), clamp(slab + colm * 0.9, 0.0, 1.0));
  } else col = vec3(0.92, 0.85, 0.71);
}
if (kind < 12 && vExt > 0.5) {
  float mx = max(max(col.r, col.g), col.b), mn = min(min(col.r, col.g), col.b);
  if (side) {
    // glass (shiny and smooth before the plastic pass below; frames are rougher) becomes candy glass:
    // the pane's own hue, bright and saturated, so grey glass turns sky blue and green glass mint;
    // darker glass stays a deeper shade so light and dark towers still read apart
    float gls = smoothstep(0.6, 0.8, mtl) * (1.0 - smoothstep(0.16, 0.3, rgh));
    vec3 hue = col / max(mx, 0.02);
    vec3 tg = mix(hue, vec3(0.25, 0.60, 1.0), 0.6) * (0.55 + 0.45 * clamp(mx / 0.6, 0.0, 1.0));
    col = mix(col, tg, gls);
    // candy paint: walls and frames take the building's pastel, keeping the pattern's light and dark
    if (vPaint.w > 0.5) col = mix(col, vPaint.rgb * min(1.0, dot(col, vec3(0.2126, 0.7152, 0.0722)) * 1.15), 1.0 - gls);
  } else if (Nr.y > 0.5) {
    // dark grey roofs read as holes from above: lift them to a pale blue-grey (coloured roofs keep theirs)
    float k = (1.0 - smoothstep(0.25, 0.55, mx)) * (1.0 - smoothstep(0.08, 0.2, mx - mn));
    col = mix(col, col * 0.45 + vec3(0.36, 0.39, 0.44), k);
    if (vPaint.w > 0.5) col = mix(vPaint.rgb, vec3(1.0), 0.25) * min(1.0, dot(col, vec3(0.2126, 0.7152, 0.0722)) * 1.2 + 0.12);
  }
}
{ float lum = dot(col, vec3(0.2126, 0.7152, 0.0722)); col = max(mix(vec3(lum), col, 1.3), 0.0) * 0.95 + 0.02; }
// light rim along the building's real corners (where both faces are outside walls), like a moulded edge.
// Only vertical corners and the roof outline: hollow models are stacks of wall panels whose top and
// bottom faces count as outside, and rimming those would stripe every facade.
if (kind < 12 && vExt > 0.5 && Nr.y > -0.5) {
  int em = int(vInfo.y + 0.5);
  vec3 e = vSz * 0.5 - abs(vLoc);
  float ed = 1e4;
  if (abs(Nr.x) < 0.5 && ((em >> (vLoc.x > 0.0 ? 0 : 1)) & 1) == 1) ed = min(ed, e.x);
  if (abs(Nr.z) < 0.5 && ((em >> (vLoc.z > 0.0 ? 4 : 5)) & 1) == 1) ed = min(ed, e.z);
  float w = clamp(fwidth(ed) * 1.4, 0.3, 1.2);
  col = mix(col, vec3(1.0), (1.0 - smoothstep(w * 0.45, w, ed)) * 0.5);
}
mtl *= 0.12; rgh = max(rgh, 0.32); pert *= 0.3; // no mirrors: glossy plastic at most
col *= 1.0 - 0.3 * clamp(dmg - 0.6, 0.0, 1.0) * (0.6 + 0.6 * nz); // light soot only
diffuseColor.rgb = col;
`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rgh;')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mtl;')
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (pert > 0.0) { vec3 pr3 = vec3(hh(pertSeed.xy + 1.3), hh(pertSeed.xy + 7.9), hh(pertSeed.xy + 4.2)) - 0.5; normal = normalize(normal + pr3 * 0.07 * pert); }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (vHeatI > 0.0) {
  float ax = floor(vHeatI / 10.0);
  float h = vHeatI - ax * 10.0;
  // slice heat only glows on freshly cut (interior) faces of the slice axis; blast heat glows everywhere
  float faceOk = ax > 1.5 ? (vExt < 0.5 ? 1.0 : 0.35) : (vExt < 0.5 ? (ax < 0.5 ? step(0.5, abs(Nr.x)) : step(0.5, abs(Nr.z))) : 0.0);
  h *= faceOk;
  vec3 hc = mix(vec3(1.0, 0.16, 0.02), vec3(1.7, 0.75, 0.22), clamp(h - 0.5, 0.0, 1.0));
  totalEmissiveRadiance += hc * h * h * 1.7 * (0.6 + 0.7 * vn(vRest * 2.0));
}`);
};

export const mesh = new THREE.InstancedMesh(geo, mat, CAP);
mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
mesh.count = 0;
mesh.castShadow = true;
mesh.receiveShadow = true;
mesh.frustumCulled = false;
mesh.name = 'blocks';
scene.add(mesh);

// Depth pre-pass. The facade shader above is expensive per pixel, and the instances are drawn in
// storage order (not front to back), so most pixels used to be shaded several times over. This
// twin writes depth only (no colour, trivial fragment shader) before anything else; the facade
// pass then fails the depth test everywhere except the front-most surface, so each pixel runs the
// facade shader about once. Same image; measured on an Intel UHD 630 the blocks draw got ~3.6x
// cheaper and whole frames 1.2-2.9x faster depending on the map (most where towers fill the view).
// It shares the geometry and the instance-matrix buffer, and always draws as many instances.
export const depthPre = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false }), CAP);
depthPre.instanceMatrix = mesh.instanceMatrix;
Object.defineProperty(depthPre, 'count', { get: () => mesh.count, set() {} });
depthPre.frustumCulled = false;
depthPre.renderOrder = -1;
depthPre.name = 'blocksDepthPre';
scene.add(depthPre);

// -------- piece store
export const pieces = new Array(CAP).fill(null);
const free = [];
let high = 0;
// GPU uploads: each group of instance attributes remembers the lowest and highest instance changed since
// the last flush, and only that span is sent (the buffers are sized for CAP instances, far more than are
// usually in use). 'shape' is the rest position and size a piece is drawn with (set once, when it is made).
const dirty = { mat: [Infinity, -1], info: [Infinity, -1], heat: [Infinity, -1], tint: [Infinity, -1], shape: [Infinity, -1] };
const touch = (r, i) => { if (i < r[0]) r[0] = i; if (i > r[1]) r[1] = i; };
export const hotPieces = new Set();
const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

export class Piece {
  constructor() {
    this.idx = -1; this.kind = 0; this.vari = 0;
    this.hx = 1; this.hy = 1; this.hz = 1;
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion();
    this.rest = new THREE.Vector3();
    this.mask = 63; this.dmg = 0; this.heat = 0;
    this.bld = null; this.level = 0;
    this.dyn = false; this.vel = new THREE.Vector3(); this.ang = new THREE.Vector3();
    this.sleep = false; this.still = 0; this.mass = 1; this.born = 0; this.gen = 0;
    this.lastHit = 0;
  }
  get vol() { return 8 * this.hx * this.hy * this.hz; }
  get maxH() { return Math.max(this.hx, this.hy, this.hz); }
  get minH() { return Math.min(this.hx, this.hy, this.hz); }
}

export function stats() { return { used: high - free.length, high, cap: CAP }; }

export function addPiece(o) {
  let idx;
  if (free.length) idx = free.pop();
  else { if (high >= CAP) return null; idx = high++; mesh.count = high; }
  const p = new Piece();
  p.idx = idx;
  p.kind = o.kind ?? 0; p.vari = o.vari ?? 0;
  p.hx = o.hx; p.hy = o.hy; p.hz = o.hz;
  p.pos.copy(o.pos);
  if (o.quat) p.quat.copy(o.quat);
  p.rest.copy(o.rest ?? o.pos);
  p.mask = o.mask ?? 63; p.dmg = o.dmg ?? 0; p.gen = o.gen ?? 0;
  p.bld = o.bld ?? null; p.level = o.level ?? 0;
  p.mass = p.vol;
  pieces[idx] = p;
  aRest.setXYZ(idx, p.rest.x, p.rest.y, p.rest.z);
  aSize.setXYZ(idx, 2 * p.hx, 2 * p.hy, 2 * p.hz);
  aInfo.setXYZW(idx, p.kind, p.mask, p.dmg, p.vari);
  aHeat.setX(idx, 0);
  const t = o.tint || (p.bld && p.bld.tint) || null;
  if (t) aTint.setXYZW(idx, t[0], t[1], t[2], t[3]); else aTint.setXYZW(idx, 1, 1, 1, 1);
  const pt = p.bld && p.bld.paint;
  if (pt) aPaint.setXYZW(idx, pt[0], pt[1], pt[2], 1); else aPaint.setXYZW(idx, 0, 0, 0, 0);
  touch(dirty.tint, idx); touch(dirty.shape, idx);
  writeMatrix(p);
  touch(dirty.info, idx); touch(dirty.heat, idx);
  return p;
}

export function writeMatrix(p) {
  _s.set(2 * p.hx, 2 * p.hy, 2 * p.hz);
  _m.compose(p.pos, p.quat, _s);
  mesh.setMatrixAt(p.idx, _m);
  touch(dirty.mat, p.idx);
}
export function setDamage(p, d) {
  if (d <= p.dmg) return;
  p.dmg = Math.min(1.6, d);
  aInfo.setZ(p.idx, p.dmg);
  touch(dirty.info, p.idx);
}
/** axis: 0 = only faces facing +-x glow, 1 = +-z, 2 = every face */
export function setHeat(p, h, axis = 2) {
  if (h > p.heat) p.heatAxis = axis;
  p.heat = Math.max(p.heat, h);
  aHeat.setX(p.idx, (p.heatAxis ?? 2) * 10 + Math.min(p.heat, 1.6));
  hotPieces.add(p);
  touch(dirty.heat, p.idx);
}

/**
 * Merge a block of axis-aligned, same-kind, same-orientation chunks into one chunk.
 * Facade stays continuous because the pattern is drawn from rest-frame coordinates.
 */
export function merge(list) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity, rx = 0, ry = 0, rz = 0, mask = 0, dmg = 0, heat = 0, gen = 0;
  for (const p of list) {
    x0 = Math.min(x0, p.pos.x - p.hx); x1 = Math.max(x1, p.pos.x + p.hx);
    y0 = Math.min(y0, p.pos.y - p.hy); y1 = Math.max(y1, p.pos.y + p.hy);
    z0 = Math.min(z0, p.pos.z - p.hz); z1 = Math.max(z1, p.pos.z + p.hz);
    mask |= p.mask; dmg = Math.max(dmg, p.dmg); heat = Math.max(heat, p.heat); gen = Math.max(gen, p.gen);
  }
  const a = list[0];
  const pos = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const rest = a.rest.clone().add(pos.clone().sub(a.pos));
  const m = addPiece({ kind: a.kind, vari: a.vari, hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, hz: (z1 - z0) / 2, pos, rest, mask, dmg, bld: a.bld, level: a.level, gen });
  if (!m) return null;
  for (const p of list) removePiece(p);
  if (heat > 0) setHeat(m, heat * 0.8, 2);
  return m;
}

export function removePiece(p) {
  if (p.idx < 0) return;
  mesh.setMatrixAt(p.idx, ZERO_M);
  pieces[p.idx] = null;
  hotPieces.delete(p);
  aHeat.setX(p.idx, 0);
  touch(dirty.mat, p.idx); touch(dirty.heat, p.idx);
  free.push(p.idx);
  p.idx = -1;
}

export function clearAll() {
  for (let i = 0; i < high; i++) { pieces[i] = null; mesh.setMatrixAt(i, ZERO_M); }
  if (high) { touch(dirty.mat, 0); touch(dirty.mat, high - 1); }
  free.length = 0; high = 0; mesh.count = 0;
  hotPieces.clear();
}

/**
 * Split a piece into children along its longest axes. Children keep the rest-frame mapping,
 * outer faces stay exterior, new internal faces become "cut" faces.
 * parts: target number of children (2..8). Returns children (parent removed) or null.
 */
const BITS = { px: 1, nx: 2, py: 4, ny: 8, pz: 16, nz: 32 };
export function split(p, parts = 2, minHalf = 0.35, jitter = 0.18) {
  const boxes = [{ cx: 0, cy: 0, cz: 0, hx: p.hx, hy: p.hy, hz: p.hz, mask: p.mask }];
  let guard = 0;
  while (boxes.length < parts && guard++ < 16) {
    // split the largest box along its longest axis
    boxes.sort((a, b) => b.hx * b.hy * b.hz - a.hx * a.hy * a.hz);
    const b = boxes[0];
    const ax = b.hx >= b.hy && b.hx >= b.hz ? 'x' : (b.hy >= b.hz ? 'y' : 'z');
    const h = b['h' + ax];
    if (h < minHalf * 2) break;
    const t = 0.5 + (Math.random() * 2 - 1) * jitter;
    const h1 = h * t, h2 = h * (1 - t);
    const c = b['c' + ax];
    const A = { ...b }, B = { ...b };
    A['h' + ax] = h1; A['c' + ax] = c - h + h1;
    B['h' + ax] = h2; B['c' + ax] = c + h - h2;
    // A is the negative side: its positive face is new (interior)
    A.mask &= ~BITS['p' + ax];
    B.mask &= ~BITS['n' + ax];
    boxes.shift(); boxes.push(A, B);
  }
  if (boxes.length < 2) return null;
  const kids = [];
  const off = new THREE.Vector3();
  for (const b of boxes) {
    off.set(b.cx, b.cy, b.cz);
    const restC = p.rest.clone().add(off);
    off.applyQuaternion(p.quat);
    const k = addPiece({
      kind: p.kind, vari: p.vari, hx: b.hx, hy: b.hy, hz: b.hz,
      pos: p.pos.clone().add(off), quat: p.quat, rest: restC, mask: b.mask, dmg: p.dmg,
      bld: p.bld, level: p.level, gen: p.gen + 1,
    });
    if (!k) break;
    k.vel.copy(p.vel); k.ang.copy(p.ang);
    if (p.heat > 0) setHeat(k, p.heat, p.heatAxis ?? 2);
    kids.push(k);
  }
  return kids;
}

/** Split along a world-axis plane (used by the laser to slice static, axis-aligned chunks). */
export function sliceStatic(p, axis, at, kerf) {
  const h = p['h' + axis], c = p.pos[axis];
  const lo = c - h, hi = c + h;
  const a0 = at - kerf, a1 = at + kerf;
  const out = [];
  const mk = (from, to, keepNeg, keepPos) => {
    const hh = (to - from) / 2;
    if (hh < 0.15) return;
    const cc = (from + to) / 2;
    const pos = p.pos.clone(); pos[axis] = cc;
    const rest = p.rest.clone(); rest[axis] = p.rest[axis] + (cc - c);
    let mask = p.mask;
    if (!keepNeg) mask &= ~BITS['n' + axis];
    if (!keepPos) mask &= ~BITS['p' + axis];
    const o = { kind: p.kind, vari: p.vari, hx: p.hx, hy: p.hy, hz: p.hz, pos, rest, mask, dmg: p.dmg, bld: p.bld, level: p.level, gen: p.gen + 1 };
    o['h' + axis] = hh;
    const k = addPiece(o);
    if (k) out.push(k);
  };
  mk(lo, Math.min(hi, a0), true, false);
  mk(Math.max(lo, a1), hi, false, true);
  return out;
}

function send(r, attrs) {
  if (r[1] < r[0]) return;
  for (const a of attrs) { a.clearUpdateRanges(); a.addUpdateRange(r[0] * a.itemSize, (r[1] - r[0] + 1) * a.itemSize); a.needsUpdate = true; }
  r[0] = Infinity; r[1] = -1;
}
export function flushGPU() {
  send(dirty.mat, [mesh.instanceMatrix]);
  send(dirty.info, [aInfo]);
  send(dirty.tint, [aTint, aPaint]);
  send(dirty.heat, [aHeat]);
  send(dirty.shape, [aRest, aSize]);
}

export function coolDown(dt) {
  if (!hotPieces.size) return;
  for (const p of hotPieces) {
    p.heat = Math.max(0, p.heat - dt * 0.16);
    aHeat.setX(p.idx, p.heat > 0 ? (p.heatAxis ?? 2) * 10 + Math.min(p.heat, 1.6) : 0);
    touch(dirty.heat, p.idx);
    if (p.heat <= 0) hotPieces.delete(p);
  }
}
export function markInfo(p) { aInfo.setXYZW(p.idx, p.kind, p.mask, p.dmg, p.vari); touch(dirty.info, p.idx); }
