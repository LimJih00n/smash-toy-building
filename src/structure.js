// Buildings are sets of standing, axis-aligned chunks. This module decides what stays up:
//  - vertical support (with a short cantilever allowance) -> unsupported chunks fall
//  - story collapse: a floor that lost most of its chunks drops everything above as one mass
//  - severed parts (laser) topple as a hinged cluster
//  - blast / slice / crush damage APIs used by the weapons
import * as THREE from 'three';
import * as B from './blocks.js';
import * as SG from './staticgrid.js';
import * as P from './physics.js';
import * as terrain from './terrain.js';
import { rand, clamp } from './util.js';

// every building that isn't a target gets one of these pastel paints
const PAINT = [[0.98, 0.58, 0.66], [1.0, 0.70, 0.48], [1.0, 0.85, 0.45], [0.50, 0.88, 0.72], [0.52, 0.76, 1.0], [0.72, 0.64, 1.0], [1.0, 0.52, 0.48], [0.66, 0.88, 0.50]];
let paintN = 0;

export const buildings = [];
const dirty = new Set();
export const events = { glass: null, chunk: null };
export const totals = { vol0: 0 };

const EPS = 0.06;
const FACE = { px: 1, nx: 2, py: 4, ny: 8, pz: 16, nz: 32 };

export class Building {
  constructor(name, opt = {}) {
    this.name = name;
    this.statics = new Set();
    this.levelH = opt.levelH || 4.6;
    this.collapse = opt.collapse ?? true;
    this.cantilever = opt.cantilever ?? 1;
    this.tough = opt.tough ?? 1; // >1: needs a closer/stronger hit to break
    this.hold = opt.hold ?? null; // chance a standing chunk holds a falling one (default 0.2 / 0.35 tough); slim tall slabs need more
    this.tint = opt.tint || null; // facade tint [r,g,b,wall] carried by every piece of the building
    this.target = !!opt.target;
    this.paint = !this.target ? PAINT[Math.floor(Math.abs(Math.sin(++paintN * 12.9898) * 43758.5453) % 1 * PAINT.length)] : null;
    this.tag = opt.tag || null; // 'name': a named building (company / building name) gets a floating name tag // the building(s) the map is about: 파괴율 / time attack count only these
    this.levelCount0 = new Map();
    this.levelVol0 = new Map();
    this.vol0 = 0;
    this.x0 = Infinity; this.x1 = -Infinity; this.z0 = Infinity; this.z1 = -Infinity; this.top = 0;
    this.collapsed = false;
    buildings.push(this);
  }
  /** Fill a box with chunks of roughly cell size. kindFn(cx,cy,cz,iy) -> {kind,vari} overrides per chunk.
   *  o.hollow = 'office' | 'logistics' | 'parking' | 'factory' | 'residential' builds the box like a real
   *  building instead: a facade skin, a floor slab per storey on a column grid, and furniture that fits
   *  the use (desks + a core, pallet racks, machines, room walls). */
  addBox(o) {
    const { x0, x1, y0, y1, z0, z1 } = o;
    if (!(x1 > x0 && y1 > y0 && z1 > z0)) throw new Error(`inverted box in ${this.name}`);
    if (o.hollow && this.addHollow(o)) return;
    const cs = o.cell || [6, this.levelH, 6];
    const nx = Math.max(1, Math.round((x1 - x0) / cs[0])), ny = Math.max(1, Math.round((y1 - y0) / cs[1])), nz = Math.max(1, Math.round((z1 - z0) / cs[2]));
    const sx = (x1 - x0) / nx, sy = (y1 - y0) / ny, sz = (z1 - z0) / nz;
    for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
      const cx = x0 + (ix + 0.5) * sx, cy = y0 + (iy + 0.5) * sy, cz = z0 + (iz + 0.5) * sz;
      let kind = o.kind ?? B.K.CONC, vari = o.vari ?? 0;
      if (o.kindFn) { const r = o.kindFn(cx, cy, cz, iy, ix, iz); if (r) { kind = r.kind ?? kind; vari = r.vari ?? vari; } }
      const p = B.addPiece({ kind, vari, hx: sx / 2, hy: sy / 2, hz: sz / 2, pos: new THREE.Vector3(cx, cy, cz), bld: this, level: Math.floor((y0 + iy * sy + 0.01) / this.levelH) });
      if (!p) return;
      this.statics.add(p);
      SG.add(p);
      this.x0 = Math.min(this.x0, x0); this.x1 = Math.max(this.x1, x1); this.z0 = Math.min(this.z0, z0); this.z1 = Math.max(this.z1, z1); this.top = Math.max(this.top, y1);
    }
  }
  /** see addBox; returns false when the box is too small to be worth hollowing.
   *  o.rects (optional) = the building's footprint as rectangles: the grid follows their edges, so a
   *  footprint made of many raster strips becomes one hollow shell with walls only on its outline. */
  addHollow(o) {
    const { y0, y1 } = o;
    const use = o.hollow;
    const rects = o.rects || [[o.x0, o.z0, o.x1, o.z1]];
    const X0 = Math.min(...rects.map((r) => r[0])), X1 = Math.max(...rects.map((r) => r[2]));
    const Z0 = Math.min(...rects.map((r) => r[1])), Z1 = Math.max(...rects.map((r) => r[3]));
    const lh = (o.cell && o.cell[1]) || this.levelH;
    const area = rects.reduce((a, r) => a + (r[2] - r[0]) * (r[3] - r[1]), 0);
    if (Math.round((y1 - y0) / lh) < 2 || area < 400 || Math.min(X1 - X0, Z1 - Z0) < 14) return false;
    // piece budget (the block pool is shared by every building and all the debris): the buildings a
    // map is about get one slab per storey up to 14 slabs; the others get a coarser grid and at most
    // 8 slabs (tall ones then have double-height floors inside — the facade outside is unchanged)
    const maxLv = this.target ? (o.lite ? 7 : 14) : o.lite ? 5 : 8;
    const ny = Math.max(2, Math.min(maxLv, Math.round((y1 - y0) / lh)));
    const LH = (y1 - y0) / ny;
    const furn = this.target ? (o.lite ? 0.5 : 1) : o.lite ? 0.25 : 1; // dense city maps: lighter interiors in the context buildings
    if (!this.statics.size) this.levelH = LH; // storey bookkeeping (story collapse) follows the real slabs
    this.cantilever = Math.max(this.cantilever, 4); // floor slabs bridge a lost column or two
    const cs = Math.max(o.lite ? (this.target ? 11 : 14) : 9, Math.min(this.target ? 18 : o.lite ? 30 : 24, Math.sqrt(area) / (this.target ? (o.lite ? 6 : 8) : o.lite ? 4 : 5.5)));
    const grid = (edges, lo, hi) => {
      const e = [...new Set(edges.map((v) => Math.round(v * 10) / 10))].sort((p, q) => p - q);
      const keep = [lo];
      for (const v of e) if (v - keep[keep.length - 1] >= 3 && hi - v >= 3) keep.push(v);
      keep.push(hi);
      const out = [keep[0]];
      for (let i = 1; i < keep.length; i++) {
        const n = Math.max(1, Math.round((keep[i] - keep[i - 1]) / cs));
        for (let j = 1; j <= n; j++) out.push(keep[i - 1] + (keep[i] - keep[i - 1]) * j / n);
      }
      return out;
    };
    const gx = grid(rects.flatMap((r) => [r[0], r[2]]), X0, X1), gz = grid(rects.flatMap((r) => [r[1], r[3]]), Z0, Z1);
    const nx = gx.length - 1, nz = gz.length - 1;
    const inside = (i, k) => {
      if (i < 0 || k < 0 || i >= nx || k >= nz) return false;
      const cx = (gx[i] + gx[i + 1]) / 2, cz = (gz[k] + gz[k + 1]) / 2;
      return rects.some((r) => cx > r[0] - 0.01 && cx < r[2] + 0.01 && cz > r[1] - 0.01 && cz < r[3] + 0.01);
    };
    const IN = []; for (let i = 0; i < nx; i++) { IN.push([]); for (let k = 0; k < nz; k++) IN[i].push(inside(i, k)); }
    const isIn = (i, k) => i >= 0 && k >= 0 && i < nx && k < nz && IN[i][k];
    const T = Math.min(0.9, Math.max(0.5, LH * 0.12)); // slab thickness
    const WT = 0.9; // facade skin thickness
    const ext = (cx, cy, cz, iy, ix, iz) => {
      let kind = o.kind ?? B.K.CONC, vari = o.vari ?? 0;
      if (o.kindFn) { const r = o.kindFn(cx, cy, cz, iy, ix, iz); if (r) { kind = r.kind ?? kind; vari = r.vari ?? vari; } }
      return { kind, vari };
    };
    const floorVari = use === 'logistics' || use === 'factory' ? 1 : use === 'parking' ? 2 : use === 'residential' ? 3 : 0;
    let full = false;
    const put = (kind, vari, cx, cy, cz, hx, hy, hz) => {
      if (full || hx < 0.05 || hz < 0.05) return;
      const p = B.addPiece({ kind, vari, hx, hy, hz, pos: new THREE.Vector3(cx, cy, cz), bld: this, level: Math.floor((cy - hy + 0.01) / this.levelH) });
      if (!p) { full = true; return; }
      this.statics.add(p); SG.add(p);
    };
    let seed = Math.abs(Math.floor(X0 * 13.1 + Z0 * 7.7 + y0 * 3.3)) % 2147483647 || 1;
    const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    // office core: the interior cells closest to the footprint's centre
    const core = new Set();
    if (use === 'office') {
      const mx = (X0 + X1) / 2, mz = (Z0 + Z1) / 2, cand = [];
      for (let i = 1; i < nx - 1; i++) for (let k = 1; k < nz - 1; k++) if (IN[i][k] && isIn(i - 1, k) && isIn(i + 1, k) && isIn(i, k - 1) && isIn(i, k + 1))
        cand.push([Math.hypot((gx[i] + gx[i + 1]) / 2 - mx, (gz[k] + gz[k + 1]) / 2 - mz), i, k]);
      cand.sort((p, q) => p[0] - q[0]);
      const nCore = o.cores || Math.max(1, Math.min(4, Math.round(area / 1600))); // 'cores': long slab towers whose core runs the length of the floor
      for (const [, i, k] of cand.slice(0, nCore)) core.add(i * 1000 + k);
    }
    for (let iy = 0; iy < ny; iy++) {
      const yb = y0 + iy * LH, yt = yb + LH, top = iy === ny - 1;
      const wy = (yb + yt - T) / 2, why = (LH - T) / 2;
      for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
        if (!IN[i][k]) continue;
        const xa = gx[i], xb = gx[i + 1], za = gz[k], zb = gz[k + 1];
        const cx = (xa + xb) / 2, cz = (za + zb) / 2, sx = xb - xa, sz = zb - za;
        const wN = !isIn(i, k - 1), wS = !isIn(i, k + 1), wW = !isIn(i - 1, k), wE = !isIn(i + 1, k);
        const edge = wN || wS || wW || wE;
        // ---- facade skin on the outline (z-facing skins own the corners)
        if (wN) { const e = ext(cx, wy, za + WT / 2, iy, i, k); put(e.kind, e.vari, cx, wy, za + WT / 2, sx / 2, why, WT / 2); }
        if (wS) { const e = ext(cx, wy, zb - WT / 2, iy, i, k); put(e.kind, e.vari, cx, wy, zb - WT / 2, sx / 2, why, WT / 2); }
        const z0w = za + (wN ? WT : 0), z1w = zb - (wS ? WT : 0);
        if (wW) { const e = ext(xa + WT / 2, wy, (z0w + z1w) / 2, iy, i, k); put(e.kind, e.vari, xa + WT / 2, wy, (z0w + z1w) / 2, WT / 2, why, (z1w - z0w) / 2); }
        if (wE) { const e = ext(xb - WT / 2, wy, (z0w + z1w) / 2, iy, i, k); put(e.kind, e.vari, xb - WT / 2, wy, (z0w + z1w) / 2, WT / 2, why, (z1w - z0w) / 2); }
        // ---- slab on top of the storey (the top one is the roof and wears the facade's roof)
        let kind = B.K.SLAB, vari = floorVari;
        if (top || edge) { const e = ext(cx, yt - T / 2, cz, iy, i, k); kind = e.kind; vari = e.vari; }
        put(kind, vari, cx, yt - T / 2, cz, sx / 2, T / 2, sz / 2);
        if (edge) continue;
        // ---- structure inside: core walls, a column every other cell
        if (core.has(i * 1000 + k)) { // lift/stair core: a ring of concrete walls (hollow shaft)
          const ct = 0.5, hx = sx / 2 - 0.05, hz = sz / 2 - 0.05;
          put(B.K.CONC, 1, cx, wy, cz - hz + ct / 2, hx, why, ct / 2); put(B.K.CONC, 1, cx, wy, cz + hz - ct / 2, hx, why, ct / 2);
          put(B.K.CONC, 1, cx - hx + ct / 2, wy, cz, ct / 2, why, hz - ct); put(B.K.CONC, 1, cx + hx - ct / 2, wy, cz, ct / 2, why, hz - ct);
          continue;
        }
        if ((i % 2 === 1 && k % 2 === 1) || (o.cols === 'all' && (i + k) % 2 === 0)) { const c = use === 'logistics' || use === 'factory' ? 0.45 : 0.6; put(B.K.CONC, 1, cx, wy, cz, c, why, c); continue; }
        // ---- furniture that fits the use, standing on this floor
        if (rnd() > furn) continue;
        const r = rnd();
        if (use === 'logistics') {
          const rh = Math.min(LH - T - 1.2, 8.5);
          if (r < 0.85 && rh > 2) put(B.K.RACK, 0, cx, yb + rh / 2, cz + (sx > sz ? 0 : 0), sx > sz ? sx * 0.46 : 0.7, rh / 2, sx > sz ? 0.7 : sz * 0.46);
        } else if (use === 'office') {
          if (r < 0.5) put(B.K.DESK, 0, cx + (rnd() - 0.5) * sx * 0.3, yb + 0.4, cz + (rnd() - 0.5) * sz * 0.3, Math.min(3.2, sx * 0.3), 0.4, Math.min(1.6, sz * 0.18));
          else if (r < 0.62) put(B.K.CONC, 2, cx, wy, za + 0.1, sx / 2 * 0.9, why, 0.1); // glass-less partition
        } else if (use === 'factory') {
          if (r < 0.35) { const mh = Math.min(LH - T - 1, 2 + rnd() * 3); put(B.K.METAL, 1, cx, yb + mh / 2, cz, sx * 0.3, mh / 2, sz * 0.22); }
        } else if (use === 'residential') {
          if (i % 2 === 0) put(B.K.CONC, 2, xa + 0.1, wy, cz, 0.1, why, sz / 2 * 0.95);
        }
      }
    }
    this.x0 = Math.min(this.x0, X0); this.x1 = Math.max(this.x1, X1); this.z0 = Math.min(this.z0, Z0); this.z1 = Math.max(this.z1, Z1); this.top = Math.max(this.top, y1);
    return true;
  }
  finalize() {
    // exterior faces = faces not covered by another standing chunk
    for (const p of this.statics) {
      let mask = 0;
      const probes = [
        [FACE.px, p.pos.x + p.hx + EPS, p.pos.y, p.pos.z], [FACE.nx, p.pos.x - p.hx - EPS, p.pos.y, p.pos.z],
        [FACE.py, p.pos.x, p.pos.y + p.hy + EPS, p.pos.z], [FACE.ny, p.pos.x, p.pos.y - p.hy - EPS, p.pos.z],
        [FACE.pz, p.pos.x, p.pos.y, p.pos.z + p.hz + EPS], [FACE.nz, p.pos.x, p.pos.y, p.pos.z - p.hz - EPS],
      ];
      for (const [bit, x, y, z] of probes) {
        let covered = false;
        if (bit === FACE.ny && y < 0.1) covered = true; // sits on the ground
        if (!covered) SG.query(x - 0.01, x + 0.01, z - 0.01, z + 0.01, (s) => {
          if (s === p) return;
          if (Math.abs(x - s.pos.x) <= s.hx && Math.abs(y - s.pos.y) <= s.hy && Math.abs(z - s.pos.z) <= s.hz) { covered = true; return false; }
        });
        if (!covered) mask |= bit;
      }
      p.mask = mask;
      B.markInfo(p);
      this.vol0 += p.vol;
      this.levelCount0.set(p.level, (this.levelCount0.get(p.level) || 0) + 1);
      this.levelVol0.set(p.level, (this.levelVol0.get(p.level) || 0) + p.vol);
    }
    totals.vol0 += this.vol0;
  }
  volume() { let v = 0; for (const p of this.statics) v += p.vol; return v; }
}

export function reset() { buildings.length = 0; dirty.clear(); totals.vol0 = 0; }

// ---------- detaching chunks
function detach(p) {
  if (p.bld) { p.bld.statics.delete(p); dirty.add(p.bld); }
  SG.remove(p);
  // anything resting on it should wake up
  P.wakeBox(p.pos.x - p.hx - 1, p.pos.x + p.hx + 1, p.pos.y - p.hy - 1, p.pos.y + p.hy + 4, p.pos.z - p.hz - 1, p.pos.z + p.hz + 1);
}
export function isStatic(p) { return p.idx >= 0 && !p.dyn && !p.cl && p.bld && p.bld.statics.has(p); }

export function release(p, vel, ang) {
  if (isStatic(p)) detach(p);
  P.makeDynamic(p, vel || new THREE.Vector3(rand(-0.5, 0.5), 0, rand(-0.5, 0.5)), ang || new THREE.Vector3(rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3)));
}
export function vaporize(p) {
  if (isStatic(p)) detach(p);
  P.removeBody(p);
  B.removePiece(p);
}
/** remove a standing or loose chunk and replace it with n smaller loose chunks */
export function shatter(p, parts, velFn) {
  const wasStatic = isStatic(p);
  if (wasStatic) detach(p);
  P.removeBody(p);
  const kids = B.split(p, parts, 0.3, 0.2);
  if (!kids) { P.makeDynamic(p, velFn ? velFn(p) : null); return [p]; }
  B.removePiece(p);
  const out = [];
  for (const k of kids) {
    const v = velFn ? velFn(k) : null;
    // crumbs become cheap effect chips instead of rigid bodies
    if (k.maxH < 0.5 && events.crumb) { events.crumb(k, v); B.removePiece(k); continue; }
    P.makeDynamic(k, v, new THREE.Vector3(rand(-3, 3), rand(-3, 3), rand(-3, 3)));
    out.push(k);
  }
  return out;
}

const _c = new THREE.Vector3();
export function aabbDist(p, c) {
  const dx = Math.max(Math.abs(c.x - p.pos.x) - p.hx, 0), dy = Math.max(Math.abs(c.y - p.pos.y) - p.hy, 0), dz = Math.max(Math.abs(c.z - p.pos.z) - p.hz, 0);
  return Math.hypot(dx, dy, dz);
}

/**
 * Generic blast. Returns { released, glassPanes } for effects.
 *  radius: destruction radius; power: outward speed; dmg: crack/blow-out radius multiplier
 *  dir: optional bias direction (hammer, missile)
 */
export function blast(c, { radius, power = 20, up = 6, dmg = 1.8, dir = null, splitBias = 1, maxRelease = 600, heat = 0, pulverize = 0, hitWeight = 1 } = {}) {
  let released = 0, glass = 0, pulverized = 0;
  const R = radius, D = radius * dmg;
  const list = SG.collect(c.x - D, c.x + D, c.z - D, c.z + D, (p) => isStatic(p) && aabbDist(p, c) < D);
  list.sort((a, b) => aabbDist(a, c) - aabbDist(b, c));
  const dirv = new THREE.Vector3();
  const velAt = (k, f) => {
    dirv.copy(k.pos).sub(c);
    if (dirv.lengthSq() < 1e-4) dirv.set(rand(-1, 1), 1, rand(-1, 1));
    dirv.normalize();
    if (dir) dirv.lerp(dir, 0.55).normalize();
    // chunks leave fast and high so blasts read as blasts
    const s = power * (0.5 + 0.8 * f) * rand(0.8, 1.25);
    return dirv.clone().multiplyScalar(s).add(new THREE.Vector3(rand(-3, 3), up * (0.4 + f) * rand(0.7, 1.4) + 3, rand(-3, 3)));
  };
  const whole = [];
  const hitB = new Set();
  const budget = Math.min(maxRelease, Math.max(40, P.LIMITS.maxBodies - P.bodies.size));
  for (const p of list) {
    const d = aabbDist(p, c) * (p.bld ? p.bld.tough : 1);
    const isGlass = p.kind === B.K.CURTAIN || p.kind === B.K.RIBBON || p.kind === B.K.DARKGLASS;
    if (d < R && p.bld) hitB.add(p.bld);
    if (d < R) {
      const f = clamp(1 - d / R, 0, 1);
      if (isGlass) glass += p.mask ? 6 : 1;
      // the core of a huge blast is pulverised: dust and chips instead of rigid bodies
      if ((pulverize && d < R * pulverize) || (f > 0.8 && p.maxH < 1.2)) {
        if (events.crumb) events.crumb(p, velAt(p, f), true);
        vaporize(p); pulverized++; continue;
      }
      if (released >= budget) { B.setDamage(p, p.dmg + 1.2); continue; }
      if (p.maxH > 1.2 && f > 0.5) {
        const kids = shatter(p, f > 0.8 ? 3 : 2, (k) => velAt(k, f));
        released += kids.length;
        if (heat) for (const k of kids) B.setHeat(k, heat * f);
      } else { detach(p); p._f = f; whole.push(p); released++; }
      if (events.chunk) events.chunk(p, f);
    } else {
      const f = clamp(1 - d / D, 0, 1);
      const before = p.dmg;
      B.setDamage(p, p.dmg + f * 1.25);
      if ((isGlass || p.kind === B.K.OFFICE) && p.dmg - before > 0.15) glass += 2;
    }
  }
  // a building only gives way floor-wise after it has been hit at least twice (huge blasts count double)
  for (const b of hitB) b.hits = (b.hits || 0) + (R >= 25 ? 2 : 1) * hitWeight;
  // outer chunks fly as merged blocks (fewer, heavier bodies with continuous facades)
  if (whole.length) {
    const blocks = whole.length > 6 ? coarsen(whole, 2) : whole;
    for (const k of blocks) {
      const f = k._f ?? whole[0]._f ?? 0.5;
      P.makeDynamic(k, velAt(k, f), new THREE.Vector3(rand(-4, 4), rand(-4, 4), rand(-4, 4)).multiplyScalar(0.25 + f));
      if (heat) B.setHeat(k, heat * f * 0.6);
    }
  }
  // loose rubble gets thrown around and broken further
  for (const b of P.bodiesNear(c, R * 1.4)) {
    if (b.cl) continue;
    const d = b.pos.distanceTo(c), f = clamp(1 - d / (R * 1.4), 0, 1);
    dirv.copy(b.pos).sub(c).normalize();
    if (dir) dirv.lerp(dir, 0.4).normalize();
    // loose rubble is thrown hard: every piece in range flies, the closest ones also break up
    const v = dirv.multiplyScalar(power * (0.4 + 1.0 * f) * rand(0.8, 1.2)).add(new THREE.Vector3(rand(-2, 2), up * (0.6 + 1.2 * f) + 4, rand(-2, 2)));
    if (b instanceof B.Piece && f > 0.35) {
      hitRubble(b, f, v);
    } else {
      P.wake(b);
      const k = b instanceof B.Piece ? Math.min(1, 9 / Math.sqrt(b.mass + 1)) * 0.5 + 0.5 : Math.min(1, 6 / Math.sqrt(b.mass + 0.5));
      b.vel.add(v.multiplyScalar(k));
      b.ang.add(new THREE.Vector3(rand(-4, 4), rand(-4, 4), rand(-4, 4)).multiplyScalar(0.4 + f));
    }
  }
  return { released, glass, pulverized };
}

/**
 * Loose rubble that gets hit: breaks into smaller pieces each time, and once it is small
 * or has taken three hits it is ground to dust (so piles never shield what lies under them).
 */
export function hitRubble(b, f, v) {
  b.hits = (b.hits || 0) + 1;
  // only crumbs or rubble hit over and over turn to dust; everything else breaks and flies
  if (b.vol < 2.5 || b.hits >= 4 || P.bodies.size >= P.LIMITS.maxBodies) {
    if (events.crumb) events.crumb(b, v, true);
    vaporize(b);
    return [];
  }
  const kids = shatter(b, f > 0.6 ? 4 : 3, (k) => { const o = k.pos.clone().sub(b.pos).normalize().multiplyScalar(rand(3, 8)); return v.clone().add(o).add(new THREE.Vector3(rand(-3, 3), rand(1, 6), rand(-3, 3))); });
  for (const k of kids) k.hits = b.hits;
  return kids;
}

/** Laser: cut a vertical kerf at point c through everything standing. Returns removed volume. */
export function sliceAt(c, dirXZ, kerf = 1.3, heat = 1) {
  let vol = 0;
  const axis = Math.abs(dirXZ.x) > Math.abs(dirXZ.z) ? 'z' : 'x';
  const list = SG.collect(c.x - kerf - 0.1, c.x + kerf + 0.1, c.z - kerf - 0.1, c.z + kerf + 0.1, (p) => isStatic(p)
    && Math.abs(c.x - p.pos.x) < p.hx + kerf && Math.abs(c.z - p.pos.z) < p.hz + kerf);
  const touched = new Set();
  for (const p of list) {
    touched.add(p.bld);
    const h = p['h' + axis];
    const at = c[axis];
    if (h < kerf * 1.2 || (Math.abs(at - p.pos[axis]) < kerf && h < kerf * 2)) {
      vol += p.vol;
      // small chunk in the beam: blasted loose and glowing rather than silently deleted
      if (p.maxH > 0.8) { const kids = shatter(p, 3, (k) => new THREE.Vector3(rand(-6, 6), rand(4, 12), rand(-6, 6))); for (const k of kids) B.setHeat(k, heat * 0.8); }
      else vaporize(p);
      continue;
    }
    const bld = p.bld;
    detach(p);
    const parts = B.sliceStatic(p, axis, at, kerf);
    vol += p.vol - parts.reduce((s, k) => s + k.vol, 0);
    B.removePiece(p);
    for (const k of parts) {
      k.bld = bld; bld.statics.add(k); SG.add(k);
      B.setHeat(k, heat, axis === 'x' ? 0 : 1);
    }
  }
  return { vol, touched };
}

/** a falling mass smashing into a standing chunk: it and its floor neighbours give way together */
P.hooks.crush = (s, b, v) => {
  if (!isStatic(s)) return;
  if (Math.random() < (s.bld && s.bld.hold != null ? s.bld.hold : s.bld && s.bld.tough > 1 ? 0.35 : 0.2)) return; // floors often hold a falling chunk // tough floors sometimes hold
  // a floor slab of a hollow building: it takes a much heavier load than the slab that fell on it, and
  // gives way alone (no domino of neighbours), so one dropped slab doesn't pancake the whole building
  if (s.hy < 0.6 && s.hx > 2) {
    if (b.mass < s.vol * 2.5 || v < 15 || Math.random() < 0.5) return;
    release(s, b.vel.clone().multiplyScalar(0.4));
    if (events.chunk) events.chunk(s, 0.6);
    return;
  }
  if (s.maxH > 1.5) {
    const grp = [s];
    SG.query(s.pos.x - s.hx - 0.2, s.pos.x + s.hx + 0.2, s.pos.z - s.hz - 0.2, s.pos.z + s.hz + 0.2, (q) => {
      if (grp.length >= 6 || q === s || !isStatic(q) || q.bld !== s.bld || q.kind !== s.kind) return;
      if (Math.abs(q.pos.y - s.pos.y) > 0.1 || Math.abs(q.hy - s.hy) > 0.05) return;
      grp.push(q);
    });
    for (const q of grp) detach(q);
    const blocks = grp.length > 1 ? coarsen(grp) : grp;
    for (const k of blocks) P.makeDynamic(k, b.vel.clone().multiplyScalar(0.45).add(new THREE.Vector3(rand(-3, 3), rand(-2, 1), rand(-3, 3))), new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)));
    if (events.chunk) events.chunk(s, 0.6);
    return;
  }
  if (P.bodies.size > P.LIMITS.maxBodies * 0.8) { release(s, b.vel.clone().multiplyScalar(0.4)); return; }
  shatter(s, 2, (k) => b.vel.clone().multiplyScalar(0.5).add(new THREE.Vector3(rand(-3, 3), rand(-2, 1), rand(-3, 3))));
  if (events.chunk) events.chunk(s, 0.6);
};

terrain.listeners.push((x0, x1, z0, z1) => {
  for (const b of buildings) if (b.statics.size && b.x1 > x0 && b.x0 < x1 && b.z1 > z0 && b.z0 < z1) dirty.add(b);
  P.wakeBox(x0, x1, -100, 300, z0, z1);
});

// ---------- support analysis
function groundSupported(p) {
  const bottom = p.pos.y - p.hy;
  if (bottom > 1.5) return false;
  let n = 0;
  const pts = [[0, 0], [-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]];
  for (const [a, b] of pts) if (terrain.groundY(p.pos.x + a * p.hx, p.pos.z + b * p.hz) > bottom - 1.2) n++;
  return n >= 3;
}

function analyse(b) {
  const list = [...b.statics];
  if (!list.length) return;
  list.sort((a, c) => (a.pos.y - a.hy) - (c.pos.y - c.hy));
  const sup = new Map();
  const fall = [];
  let i = 0;
  while (i < list.length) {
    const y = list[i].pos.y - list[i].hy;
    let j = i;
    while (j < list.length && (list[j].pos.y - list[j].hy) - y < 0.25) j++;
    const group = list.slice(i, j);
    // vertical
    for (const p of group) {
      let s = 0;
      if (groundSupported(p)) s = 2;
      else {
        const bottom = p.pos.y - p.hy;
        SG.query(p.pos.x - p.hx + 0.1, p.pos.x + p.hx - 0.1, p.pos.z - p.hz + 0.1, p.pos.z + p.hz - 0.1, (q) => {
          if (q === p || !isStatic(q)) return;
          const top = q.pos.y + q.hy;
          if (Math.abs(top - bottom) > 0.3) return;
          if (Math.abs(q.pos.x - p.pos.x) >= q.hx + p.hx - 0.2 || Math.abs(q.pos.z - p.pos.z) >= q.hz + p.hz - 0.2) return;
          const sq = sup.has(q) ? sup.get(q) : (q.bld === b ? 0 : 2);
          if (sq >= 1) { s = 2; return false; }
        });
      }
      sup.set(p, s);
    }
    // cantilever hops
    for (let hop = 0; hop < b.cantilever; hop++) {
      const need = hop === 0 ? 2 : 1;
      for (const p of group) {
        if (sup.get(p) > 0) continue;
        let ok = false;
        SG.query(p.pos.x - p.hx - 0.2, p.pos.x + p.hx + 0.2, p.pos.z - p.hz - 0.2, p.pos.z + p.hz + 0.2, (q) => {
          if (q === p || q.bld !== b || !isStatic(q)) return;
          if (Math.abs(q.pos.y - p.pos.y) > Math.max(q.hy, p.hy)) return;
          const gx = Math.abs(q.pos.x - p.pos.x) - (q.hx + p.hx), gz = Math.abs(q.pos.z - p.pos.z) - (q.hz + p.hz);
          if (gx > 0.15 || gz > 0.15) return;
          if ((sup.get(q) || 0) >= need) { ok = true; return false; }
        });
        if (ok) sup.set(p, hop === 0 ? 1 : 0.5);
      }
    }
    for (const p of group) if (!(sup.get(p) > 0)) fall.push(p);
    // a chunk held only at the second hop can't carry anything above it
    for (const p of group) if (sup.get(p) === 0.5) sup.set(p, 0);
    i = j;
  }
  return fall;
}

function storyCollapse(b) {
  if (!b.collapse || b.collapsed || (b.hits || 0) < 2) return null;
  const now = new Map();
  for (const p of b.statics) now.set(p.level, (now.get(p.level) || 0) + p.vol);
  const levels = [...b.levelCount0.keys()].sort((a, c) => a - c);
  const top = levels[levels.length - 1];
  for (const L of levels) {
    if (L >= top - 1) break;
    const n0 = b.levelVol0.get(L), n = now.get(L) || 0;
    if (b.levelCount0.get(L) >= 6 && n / n0 < 0.34 / Math.sqrt(b.tough)) { // a floor gives way once about two thirds of it is gone
      let above = 0, above0 = 0;
      for (const [l, c] of now) if (l > L) above += c;
      for (const [l, c] of b.levelVol0) if (l > L) above0 += c;
      if (above < above0 * 0.1) continue;
      return L;
    }
  }
  return null;
}

/** connected parts of a building (6-neighbour touching) */
function components(b) {
  const left = new Set(b.statics), comps = [];
  while (left.size) {
    const seed = left.values().next().value;
    const comp = [seed]; left.delete(seed);
    for (let k = 0; k < comp.length; k++) {
      const p = comp[k];
      SG.query(p.pos.x - p.hx - 0.2, p.pos.x + p.hx + 0.2, p.pos.z - p.hz - 0.2, p.pos.z + p.hz + 0.2, (q) => {
        if (!left.has(q)) return;
        const gx = Math.abs(q.pos.x - p.pos.x) - (q.hx + p.hx), gy = Math.abs(q.pos.y - p.pos.y) - (q.hy + p.hy), gz = Math.abs(q.pos.z - p.pos.z) - (q.hz + p.hz);
        if (gx > 0.12 || gy > 0.12 || gz > 0.12) return;
        // need a real face contact, not just an edge
        const touching = (gx > -0.12 ? 1 : 0) + (gy > -0.12 ? 1 : 0) + (gz > -0.12 ? 1 : 0);
        if (touching > 1) return;
        left.delete(q); comp.push(q);
      });
    }
    comps.push(comp);
  }
  return comps;
}

function boundsOf(list) {
  const bb = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const p of list) {
    bb.x0 = Math.min(bb.x0, p.pos.x - p.hx); bb.x1 = Math.max(bb.x1, p.pos.x + p.hx);
    bb.y0 = Math.min(bb.y0, p.pos.y - p.hy); bb.y1 = Math.max(bb.y1, p.pos.y + p.hy);
    bb.z0 = Math.min(bb.z0, p.pos.z - p.hz); bb.z1 = Math.max(bb.z1, p.pos.z + p.hz);
  }
  return bb;
}

/** merge same-size neighbours into blocks up to 2x2x2 so a falling mass is tens of bodies, not hundreds */
function coarsen(list, maxN = 2) {
  const key = (x, y, z) => `${Math.round(x * 4)},${Math.round(y * 4)},${Math.round(z * 4)}`;
  const at = new Map();
  for (const p of list) at.set(key(p.pos.x, p.pos.y, p.pos.z), p);
  const used = new Set(), out = [];
  const same = (a, b) => b && !used.has(b) && b.kind === a.kind && b.vari === a.vari && Math.abs(b.hx - a.hx) < 0.05 && Math.abs(b.hy - a.hy) < 0.05 && Math.abs(b.hz - a.hz) < 0.05;
  const sorted = [...list].sort((a, b) => (a.pos.y - b.pos.y) || (a.pos.x - b.pos.x) || (a.pos.z - b.pos.z));
  for (const p of sorted) {
    if (used.has(p)) continue;
    const dx = 2 * p.hx, dy = 2 * p.hy, dz = 2 * p.hz;
    const get = (i, j, k) => at.get(key(p.pos.x + i * dx, p.pos.y + j * dy, p.pos.z + k * dz));
    let best = [p];
    const shapes = maxN >= 3
      ? [[3, 2, 3], [3, 1, 3], [2, 2, 2], [3, 2, 2], [2, 2, 3], [2, 1, 2], [2, 2, 1], [1, 2, 2], [2, 1, 1], [1, 1, 2], [1, 2, 1]]
      : [[2, 2, 2], [2, 1, 2], [2, 2, 1], [1, 2, 2], [2, 1, 1], [1, 1, 2], [1, 2, 1]];
    for (const [nx, ny, nz] of shapes) {
      const grp = [];
      let ok = true;
      for (let i = 0; i < nx && ok; i++) for (let j = 0; j < ny && ok; j++) for (let k = 0; k < nz && ok; k++) {
        const q = i || j || k ? get(i, j, k) : p;
        if (q !== p && !same(p, q)) ok = false; else grp.push(q);
      }
      if (ok) { best = grp; break; }
    }
    for (const q of best) used.add(q);
    if (best.length === 1) { out.push(p); continue; }
    const f = best.reduce((a, q) => Math.max(a, q._f || 0), 0);
    const m = B.merge(best);
    if (m) { m._f = f; out.push(m); } else out.push(...best.filter((q) => q.idx >= 0));
  }
  return out;
}
function toCluster(list, mode, opt) {
  for (const p of list) if (isStatic(p)) detach(p);
  // big masses come down as floor-slab sized blocks
  return new P.Cluster(coarsen(list, list.length > 150 ? 3 : 2), mode, opt);
}

/**
 * Sword: cut along the plane through o with normal n, wherever inside(pos) allows (the stretch of the
 * screen the slash covered). Each crossed chunk is split along the axis closest to the plane normal at
 * the plane's position over its centre, so a slanted cut becomes a fine staircase. A building cut all
 * the way across (no crossed chunk outside the slash) loses everything above the cut: on a shallow cut
 * that part tips off over the low edge of the slope; a steep cut is handled like a laser cut.
 * Returns [{ b, pts, severed, glass }] for the effects.
 */
const SLASH_KERF = 0.3;
/** standing chunks of b that the plane crosses: those inside the slash, and how many outside it */
function slashHits(b, o, n, inside) {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  // quick reject: the plane misses the building's box
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, cy = b.top / 2;
  const rb = ax * (b.x1 - b.x0) / 2 + ay * b.top / 2 + az * (b.z1 - b.z0) / 2;
  if (!b.statics.size || Math.abs((cx - o.x) * n.x + (cy - o.y) * n.y + (cz - o.z) * n.z) > rb + 1) return null;
  const hit = []; let outside = 0;
  for (const p of b.statics) {
    const d = (p.pos.x - o.x) * n.x + (p.pos.y - o.y) * n.y + (p.pos.z - o.z) * n.z;
    if (Math.abs(d) > ax * p.hx + ay * p.hy + az * p.hz) continue;
    if (inside(p.pos)) hit.push(p); else outside++;
  }
  return hit.length ? { hit, outside } : null;
}
/** the buildings a slash would cut, nearest first, with the distance from o to the nearest cut chunk */
export function slashPlan(o, n, inside) {
  const out = [];
  for (const b of buildings) {
    const h = slashHits(b, o, n, inside);
    if (h) out.push({ b, d: Math.min(...h.hit.map((p) => p.pos.distanceTo(o))) });
  }
  return out.sort((a, c) => a.d - c.d);
}
export function slash(o, n, inside, push, only = null) {
  if (n.y < 0) n = n.clone().negate();
  const sd = (v) => (v.x - o.x) * n.x + (v.y - o.y) * n.y + (v.z - o.z) * n.z;
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  const axis = ay >= ax && ay >= az ? 'y' : ax >= az ? 'x' : 'z';
  const out = [];
  for (const b of only ? [only] : buildings) {
    const h = slashHits(b, o, n, inside);
    if (!h) continue;
    const { hit, outside } = h;
    const pts = [], others = { x: axis === 'x' ? 'y' : 'x', z: axis === 'z' ? 'y' : 'z' };
    let glass = 0;
    for (const p of hit) {
      const at = p.pos[axis] - sd(p.pos) / n[axis]; // where the plane crosses this chunk's centre line
      pts.push(p.pos.clone().addScaledVector(n, -sd(p.pos)));
      if (p.kind === B.K.CURTAIN || p.kind === B.K.RIBBON || p.kind === B.K.DARKGLASS) glass++;
      if (p['h' + axis] < 0.4) continue; // too thin to split: it goes with whichever side its centre is on
      detach(p);
      const parts = B.sliceStatic(p, axis, at, SLASH_KERF);
      B.removePiece(p);
      for (const k of parts) { k.bld = b; b.statics.add(k); SG.add(k); }
    }
    b.hits = (b.hits || 0) + 1;
    dirty.add(b);
    let severed = false;
    if (!outside) {
      if (ay < 0.35) { // steep: two halves standing side by side, like a laser kerf
        noteCut(b, pts[0], new THREE.Vector3(-n.z, 0, n.x).normalize());
      } else {
        const top = [...b.statics].filter((p) => sd(p.pos) > 0 && inside(p.pos));
        if (top.length) {
          const bb = boundsOf(top);
          // tip toward the low side of the cut; a nearly level cut tips the way the blade travelled
          const dir = new THREE.Vector3(n.x, 0, n.z);
          if (dir.length() < 0.15) dir.set(push.x, 0, push.z);
          dir.normalize();
          const mx = (bb.x0 + bb.x1) / 2, mz = (bb.z0 + bb.z1) / 2;
          const ext = Math.abs(dir.x) * (bb.x1 - bb.x0) / 2 + Math.abs(dir.z) * (bb.z1 - bb.z0) / 2;
          const pivot = new THREE.Vector3(mx + dir.x * ext, bb.y0, mz + dir.z * ext);
          toCluster(top, 'hinge', { pivot, axis: new THREE.Vector3(0, 1, 0).cross(dir).normalize(), omega0: 0.45 });
          severed = true;
          if (top.length > b.statics.size * 0.3) b.collapsed = true;
        }
      }
    }
    out.push({ b, pts, severed, glass });
  }
  return out;
}

/** after a laser cut: free-standing slender parts topple away from the cut */
const pendingCuts = [];
export function noteCut(b, point, dir) { pendingCuts.push({ b, point: point.clone(), dir: dir.clone() }); dirty.add(b); }

function handleCuts(b) {
  const cuts = pendingCuts.filter((c) => c.b === b);
  if (!cuts.length) return;
  for (let i = pendingCuts.length - 1; i >= 0; i--) if (pendingCuts[i].b === b) pendingCuts.splice(i, 1);
  const comps = components(b);
  if (comps.length < 2) return;
  comps.sort((a, c) => c.length - a.length);
  const cut = cuts[cuts.length - 1];
  for (let k = 0; k < comps.length; k++) {
    const comp = comps[k];
    const bb = boundsOf(comp);
    const h = bb.y1 - bb.y0;
    if (comp.length <= 3) { for (const p of comp) release(p); continue; }
    const cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2;
    // away from the cut line
    const away = new THREE.Vector3(cx - cut.point.x, 0, cz - cut.point.z);
    const n = new THREE.Vector3(-cut.dir.z, 0, cut.dir.x);
    if (n.dot(away) < 0) n.negate();
    const w = Math.abs(n.x) > Math.abs(n.z) ? bb.x1 - bb.x0 : bb.z1 - bb.z0;
    // only slender parts topple; squat ones (podium halves) just stand there with a scar
    if (h <= w * 1.4 || h < 14) {
      if (comp.length < 12 && k > 0) for (const p of comp) release(p, n.clone().multiplyScalar(2));
      continue;
    }
    // hinge on the far bottom edge
    const pivot = new THREE.Vector3(n.x > 0.5 ? bb.x1 : n.x < -0.5 ? bb.x0 : cx, bb.y0, n.z > 0.5 ? bb.z1 : n.z < -0.5 ? bb.z0 : cz);
    const axis = new THREE.Vector3(0, 1, 0).cross(n).normalize();
    toCluster(comp, 'hinge', { pivot, axis, omega0: 0.12 });
    b.collapsed = k === 0 ? true : b.collapsed;
  }
}

export function update(maxBuildings = 3) {
  let n = 0;
  for (const b of [...dirty]) {
    if (n++ >= maxBuildings) break;
    dirty.delete(b);
    if (!b.statics.size) continue;
    handleCuts(b);
    const L = storyCollapse(b);
    if (L !== null) {
      // everything above the failed floor drops as one mass, tilting toward the damage
      const above = [...b.statics].filter((p) => p.level > L);
      const at = [...b.statics].filter((p) => p.level === L);
      for (const p of at) release(p, new THREE.Vector3(rand(-2, 2), -2, rand(-2, 2)));
      const bb = boundsOf(above);
      const ax = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize();
      if (above.length) toCluster(above, 'fall', { axis: ax, spin: rand(0.05, 0.14), vy: 1 });
      b.collapsed = true;
      if (events.collapse) events.collapse(b, bb);
      dirty.add(b);
      continue;
    }
    const fall = analyse(b);
    if (fall && fall.length) {
      if (fall.length > 24) {
        // coherent drop for big unsupported masses
        toCluster(fall, 'fall', { axis: new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)), spin: rand(0.02, 0.08), vy: 0.5 });
      } else for (const p of fall) release(p);
      dirty.add(b); // re-check (things above may now be unsupported)
    }
  }
}

export function destructionRatio() {
  let v = 0;
  for (const b of buildings) v += b.volume();
  return totals.vol0 ? 1 - v / totals.vol0 : 0;
}
/** 파괴율 of the map's target buildings (all buildings when none is flagged), 0..1 of their volume */
export function targets() { const t = buildings.filter((b) => b.target); return t.length ? t : buildings; }
export function targetRatio() {
  let v = 0, v0 = 0;
  for (const b of targets()) { v += b.volume(); v0 += b.vol0; }
  return v0 ? 1 - v / v0 : 0;
}
/** a target building with only scraps left gives way completely: the scraps fall (or turn to dust
 *  when there are too many to simulate), so nobody has to hunt the last block of rubble */
export function crumble(b, maxFall = 140) {
  const list = [...b.statics].sort((a, c) => c.pos.y - a.pos.y);
  list.forEach((p, i) => { if (i < maxFall) release(p); else vaporize(p); });
  b.collapsed = true;
  dirty.add(b);
}
/** where a building's remaining standing parts are: [x, topY, z] or null */
export function remainingAnchor(b) {
  let x = 0, z = 0, top = -Infinity, n = 0;
  for (const p of b.statics) { x += p.pos.x; z += p.pos.z; n++; if (p.pos.y > top) top = p.pos.y; }
  return n ? [x / n, top, z / n] : null;
}
export function markDirty(b) { if (b) dirty.add(b); }
export function collapsedCount() { return buildings.filter((b) => b.collapsed || b.statics.size < 0.3 * b.levelCount0.size).length; }
