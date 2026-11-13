// Uniform XZ grid of standing (static, axis-aligned) building chunks: used for
// collisions, neighbour lookups, blast queries and picking.
const CS = 8;
const map = new Map();
const key = (i, j) => (i + 2048) * 4096 + (j + 2048);

export function add(p) {
  const i0 = Math.floor((p.pos.x - p.hx) / CS), i1 = Math.floor((p.pos.x + p.hx) / CS);
  const j0 = Math.floor((p.pos.z - p.hz) / CS), j1 = Math.floor((p.pos.z + p.hz) / CS);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const k = key(i, j);
    let c = map.get(k); if (!c) { c = []; map.set(k, c); }
    c.push(p);
  }
}
export function remove(p) {
  const i0 = Math.floor((p.pos.x - p.hx) / CS), i1 = Math.floor((p.pos.x + p.hx) / CS);
  const j0 = Math.floor((p.pos.z - p.hz) / CS), j1 = Math.floor((p.pos.z + p.hz) / CS);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const c = map.get(key(i, j)); if (!c) continue;
    const n = c.indexOf(p); if (n >= 0) { c[n] = c[c.length - 1]; c.pop(); }
  }
}
export function clear() { map.clear(); }

let stamp = 1;
/** Calls fn(p) once for each static chunk whose cell overlaps [x0,x1]x[z0,z1]. */
export function query(x0, x1, z0, z1, fn) {
  const s = ++stamp;
  const i0 = Math.floor(x0 / CS), i1 = Math.floor(x1 / CS), j0 = Math.floor(z0 / CS), j1 = Math.floor(z1 / CS);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const c = map.get(key(i, j)); if (!c) continue;
    for (let n = 0; n < c.length; n++) { const p = c[n]; if (p._qs === s) continue; p._qs = s; if (fn(p) === false) return; }
  }
}
export function collect(x0, x1, z0, z1, filter) {
  const out = [];
  query(x0, x1, z0, z1, (p) => { if (!filter || filter(p)) out.push(p); });
  return out;
}
export function cellAt(x, z) { return map.get(key(Math.floor(x / CS), Math.floor(z / CS))); }

/** Ray vs axis-aligned static chunks via 2D DDA over the grid. */
export function raycast(o, d, maxT) {
  let best = null, bestT = maxT, bestN = null;
  const s = ++stamp;
  let i = Math.floor(o.x / CS), j = Math.floor(o.z / CS);
  const si = d.x > 0 ? 1 : -1, sj = d.z > 0 ? 1 : -1;
  const tdi = Math.abs(CS / (d.x || 1e-9)), tdj = Math.abs(CS / (d.z || 1e-9));
  let ti = ((d.x > 0 ? (i + 1) * CS - o.x : o.x - i * CS) / Math.abs(d.x || 1e-9));
  let tj = ((d.z > 0 ? (j + 1) * CS - o.z : o.z - j * CS) / Math.abs(d.z || 1e-9));
  let t = 0;
  for (let it = 0; it < 600 && t < bestT; it++) {
    const c = map.get(key(i, j));
    if (c) for (const p of c) {
      if (p._qs === s) continue; p._qs = s;
      const r = rayBox(o, d, p.pos.x - p.hx, p.pos.y - p.hy, p.pos.z - p.hz, p.pos.x + p.hx, p.pos.y + p.hy, p.pos.z + p.hz);
      if (r && r.t < bestT) { bestT = r.t; best = p; bestN = r.n; }
    }
    if (ti < tj) { t = ti; ti += tdi; i += si; } else { t = tj; tj += tdj; j += sj; }
  }
  return best ? { piece: best, t: bestT, n: bestN } : null;
}

export function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity, nAxis = 0, nSign = 1;
  const lo = [x0, y0, z0], hi = [x1, y1, z1], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dd[a]) < 1e-9) { if (oo[a] < lo[a] || oo[a] > hi[a]) return null; continue; }
    let t1 = (lo[a] - oo[a]) / dd[a], t2 = (hi[a] - oo[a]) / dd[a], sg = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sg = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = a; nSign = sg; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  const t = tmin > 0 ? tmin : 0;
  const n = [0, 0, 0]; n[nAxis] = nSign;
  return { t, n };
}
