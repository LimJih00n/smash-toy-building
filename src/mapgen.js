// Data-driven zone maps: buildings come from a map JSON made by tools/makezone.py
// (public building register footprints, rotated so the campus grid lines up with the axes).
// Every footprint is a list of axis-aligned rectangles sharing one height; hand-made models
// (like the R5 twin towers) are dropped into their real lots.
import * as terrain from './terrain.js';
import { Building } from './structure.js';
import { K } from './blocks.js';
import { mulberry, clamp } from './util.js';

export const layout = { lawns: [], walks: [], asphalt: [], lots: [], roads: [], curbs: [], rows: [] };

const STYLE_NAME = { tower: '연구동', office: '사무동', factory: '공장동', apartment: '아파트동', house: '주택', shop: '상가동', parking: '주차동' };
const TOUGH = { tower: 0.95, office: 0.9, factory: 0.78, apartment: 0.9, house: 0.7, shop: 0.75, parking: 0.85 };

function hash(n) { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

function kindFnFor(style, h, levelH, seed, facade, roof) {
  const top = h - levelH;
  // street-view look: 'k:<KIND>:<vari>[:<ground KIND>[:<top KIND>]]' (visual only; durability is set by style)
  if (facade && facade.startsWith('k:')) {
    const [, kn, vr, gk, tk] = facade.split(':');
    // ground part may carry its own variant and storey count: 'STONE.5.3' = STONE vari 5 on the lowest 3 storeys
    const [gn, gv, gl] = (gk || '').split('.');
    const kind = K[kn] ?? K.OFFICE, vari = +vr || 0, g = gn ? K[gn] : null, t = tk ? K[tk] : null, gH = levelH * (+gl || 1), gVari = +gv || 0;
    return (cx, cy) => (g != null && cy < gH ? { kind: g, vari: gVari } : t != null && cy > top ? { kind: t } : { kind, vari });
  }
  if (facade === 'darkband') return (cx, cy) => (cy < levelH ? { kind: K.STONE } : cy > top ? { kind: K.CROWN } : { kind: K.OFFICE, vari: 7 });
  if (facade === 'curtain') style = 'tower';
  if (facade === 'shed') style = 'shed';
  if (facade === 'fc') { const vari = (roof ? 200 + 100 * roof : 100) + Math.round(h); return () => ({ kind: K.SHED, vari }); }
  if (facade === 'ramp') return (cx, cy) => ({ kind: K.CONC, vari: 0 });
  if (facade === 'fc2') { const vari = 200 + Math.round(h); return () => ({ kind: K.SHED, vari }); }
  switch (style) {
    case 'tower':
      return (cx, cy) => (cy < levelH ? { kind: K.STONE } : cy > top ? { kind: K.CROWN } : { kind: K.CURTAIN });
    case 'factory':
      return (cx, cy) => (cy < Math.min(4.5, levelH) ? { kind: K.CONC } : cy > top && h > 12 ? { kind: K.RIBBON } : { kind: K.METAL });
    case 'shed': {
      const vari = roof != null ? roof : Math.floor(hash(seed * 3.7) * 3); // roof: plain / solar / green + solar
      return () => ({ kind: K.SHED, vari });
    }
    case 'parking':
      return () => ({ kind: K.CONC });
    case 'apartment': {
      const vari = hash(seed) < 0.6 ? 0 : 3;
      return () => ({ kind: K.OFFICE, vari });
    }
    case 'house': case 'shop': {
      const vari = [3, 6, 0][Math.floor(hash(seed) * 3)];
      return () => ({ kind: K.OFFICE, vari });
    }
    default: {
      const vari = [0, 1, 4, 7, 2, 5][Math.floor(hash(seed) * 6)];
      if (vari === 2 || vari === 5) return (cx, cy) => (cy < levelH ? { kind: K.STONE } : cy > top && h > 20 ? { kind: K.CROWN } : { kind: K.OFFICE, vari });
      return () => ({ kind: K.OFFICE, vari });
    }
  }
}

export function buildBuildings(doc) {
  const counts = {};
  doc.buildings.forEach((b, idx) => {
    const style = b.style;
    counts[style] = (counts[style] || 0) + 1;
    const name = b.label || b.name || `${STYLE_NAME[style] || '건물'} ${counts[style]}`;
    const levelH = b.floors ? clamp(b.h / b.floors, 3.6, 7.6) : Math.min(6, b.h);
    const h = Math.max(levelH, b.h);
    const bld = new Building(name, { target: !!b.label, tag: b.tag || null, levelH, collapse: h > 18, cantilever: 2, tough: (TOUGH[style] ?? 0.9) * (doc.dense ? 1.45 : 1) * (doc.tough_mul || 1), tint: b.tint || null, hold: b.hold ?? null });
    const cs = b.cell || (style === 'factory' || style === 'parking' ? 12 : 9); // 'cell': finer pieces for small targets (durability)
    const kindFn = kindFnFor(style, h, levelH, idx + 1, b.facade, b.roof);
    // what the inside is used for (hollow model: slabs, columns, furniture)
    const use = b.use || (['shed', 'fc', 'fc2'].includes(b.facade) ? 'logistics' : b.facade === 'ramp' ? null
      : style === 'factory' ? 'factory' : style === 'parking' ? 'parking' : style === 'apartment' || style === 'house' ? 'residential' : 'office');
    // a tall building on a big base: low podium over the whole outline + tower on part of it
    const hb = b.tower ? Math.min(h - levelH, Math.max(1, Math.round(22 / levelH)) * levelH) : h;
    const podFn = b.tower ? (cx, cy) => (cy < levelH ? { kind: K.STONE } : cy > hb - levelH ? { kind: K.GRID } : { kind: K.RIBBON }) : kindFn;
    let big = null, bigA = 0;
    // hollow: one shell over the whole footprint (walls on its outline only); solid fill otherwise
    const shell = use && bld.addHollow({ rects: b.rects, y0: 0, y1: hb, cell: [cs, levelH, cs], kindFn: podFn, hollow: use, lite: !!doc.dense && !b.fine, cores: b.cores || 0 }); // 'fine': a target in a dense map keeps the full grid (durability)
    for (const [x0, z0, x1, z1] of b.rects) {
      const w = x1 - x0, d = z1 - z0;
      if (!shell) bld.addBox({ x0, x1, y0: 0, y1: hb, z0, z1, cell: [w / Math.max(1, Math.round(w / cs)), levelH, d / Math.max(1, Math.round(d / cs))], kindFn: podFn });
      if (w * d > bigA) { bigA = w * d; big = [x0, z0, x1, z1]; }
    }
    if (b.tower) {
      const [x0, z0, x1, z1] = b.tower, w = x1 - x0, d = z1 - z0;
      const tFn = (cx, cy) => (cy > h - levelH ? { kind: K.CROWN } : { kind: K.CURTAIN });
      bld.addBox({ x0, x1, y0: hb, y1: h, z0, z1, cell: [w / Math.max(1, Math.round(w / 7)), levelH, d / Math.max(1, Math.round(d / 7))], kindFn: tFn, hollow: 'office', lite: !!doc.dense });
      big = b.tower; bigA = w * d;
    }
    // rooftop plant rows seen on the satellite (fab exhaust / chiller units): units = [columns, rows]
    if (big && b.units) {
      const [x0, z0, x1, z1] = big, [nx, nz] = b.units, gx = (x1 - x0) / nx, gz = (z1 - z0) / nz;
      const w = Math.min(12, gx * 0.78), d = Math.min(12, gz * 0.78), uh = b.unitH || 5;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const ux = x0 + gx * (i + 0.5) - w / 2, uz = z0 + gz * (j + 0.5) - d / 2;
        bld.addBox({ x0: ux, x1: ux + w, y0: h, y1: h + uh, z0: uz, z1: uz + d, kind: K.UNIT, vari: b.unitDark ? 1 : 0, cell: [w, uh, d] });
      }
    } else
    // rooftop plant on larger roofs
    if (big && h > 12 && bigA > 300) {
      const [x0, z0, x1, z1] = big, n = 1 + Math.floor(hash(idx * 7.3) * 3);
      for (let i = 0; i < n; i++) {
        const w = Math.min(8, (x1 - x0) * 0.3), d = Math.min(6, (z1 - z0) * 0.3);
        const ux = x0 + 2 + hash(idx + i * 3.1) * Math.max(0, x1 - x0 - w - 4), uz = z0 + 2 + hash(idx + i * 5.7) * Math.max(0, z1 - z0 - d - 4);
        bld.addBox({ x0: ux, x1: ux + w, y0: h, y1: h + 2.6, z0: uz, z1: uz + d, kind: K.UNIT, cell: [w, 2.6, d] });
      }
    }
    // roof mast (telecom research tower)
    if (b.antenna && big) {
      const [x0, z0, x1, z1] = big, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      bld.addBox({ x0: cx - 4, x1: cx + 4, y0: h, y1: h + 4, z0: cz - 4, z1: cz + 4, kind: K.UNIT, cell: [8, 4, 8] });
      bld.addBox({ x0: cx - 0.9, x1: cx + 0.9, y0: h + 4, y1: h + b.antenna, z0: cz - 0.9, z1: cz + 0.9, kind: K.METAL, cell: [1.8, b.antenna / 3, 1.8] });
    }
    // the podium roof around a tower gets plant too
    if (b.tower) {
      for (const [x0, z0, x1, z1] of b.rects) {
        if ((x1 - x0) * (z1 - z0) < 400 || hash(x0 * 3.1 + z0) < 0.4) continue;
        const ux = x0 + 3, uz = z0 + 3;
        const [tx0, tz0, tx1, tz1] = b.tower;
        if (ux + 8 > tx0 && ux < tx1 && uz + 6 > tz0 && uz < tz1) continue;
        bld.addBox({ x0: ux, x1: ux + 8, y0: hb, y1: hb + 2.6, z0: uz, z1: uz + 6, kind: K.UNIT, cell: [8, 2.6, 6] });
      }
    }
    bld.finalize();
  });
  // racetrack spiral truck ramps beside multi-storey fulfilment centres (satellite):
  // stacked concrete decks on a central spine, open between the decks
  (doc.ramps || []).forEach(([cx, cz, L, W, H, axis], i) => {
    const r = new Building(`진입 램프 ${i + 1}`, { levelH: 5.5, collapse: true, cantilever: 3, tough: 0.8 });
    const box = (a0, a1, b0, b1, y0, y1, kind) => {
      const [x0, x1, z0, z1] = axis === 'z' ? [cx + b0, cx + b1, cz + a0, cz + a1] : [cx + a0, cx + a1, cz + b0, cz + b1];
      const w = x1 - x0, d = z1 - z0;
      r.addBox({ x0, x1, y0, y1, z0, z1, kind, cell: [w / Math.max(1, Math.round(w / 10)), y1 - y0, d / Math.max(1, Math.round(d / 10))] });
    };
    const m = (L - W) / 2, hw = W / 2;
    box(-m, m, -1.6, 1.6, 0, H + 1.2, K.CONC); // spine
    for (let y = 5.5; y <= H + 0.1; y += 5.5) {
      box(-m, m, -hw, hw, y - 1.4, y, K.CONC);                  // straight run
      box(-m - hw * 0.6, -m, -hw * 0.8, hw * 0.8, y - 1.4, y, K.CONC); // rounded ends
      box(m, m + hw * 0.6, -hw * 0.8, hw * 0.8, y - 1.4, y, K.CONC);
      box(-m - hw, -m - hw * 0.6, -hw * 0.45, hw * 0.45, y - 1.4, y, K.CONC);
      box(m + hw * 0.6, m + hw, -hw * 0.45, hw * 0.45, y - 1.4, y, K.CONC);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * m - 1, sx * m + 1, sz * (hw - 2) - 1, sz * (hw - 2) + 1, 0, H, K.CONC); // columns
    r.finalize();
  });
}

/** Paint pavement, roads and lawns from the footprints: sidewalks hug the buildings, wide open
 * areas become lawns, the remaining gaps read as campus roads. Also records spots for props. */
export function paintZone(doc, extraLots = []) {
  const rng = mulberry(4242);
  const g = terrain.paint;
  const half = 320;
  layout.lawns.length = 0; layout.walks.length = 0; layout.asphalt.length = 0; layout.lots = extraLots;
  const rects = [];
  for (const b of doc.buildings) for (const r of b.rects) rects.push(r);
  for (const l of extraLots) rects.push(l);
  // coarse occupancy: distance (in 4 m cells) to the nearest building
  const C = 4, N = Math.ceil(half * 2 / C);
  const dist = new Float32Array(N * N).fill(1e9);
  const q = [];
  for (const [x0, z0, x1, z1] of rects) {
    for (let i = Math.max(0, Math.floor((x0 + half) / C)); i <= Math.min(N - 1, Math.floor((x1 + half) / C)); i++)
      for (let j = Math.max(0, Math.floor((z0 + half) / C)); j <= Math.min(N - 1, Math.floor((z1 + half) / C)); j++) { dist[j * N + i] = 0; q.push(i, j); }
  }
  // BFS chamfer distance
  for (let k = 0; k < q.length; k += 2) {
    const i = q[k], j = q[k + 1], d = dist[j * N + i];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      if (dist[b * N + a] > d + 1) { dist[b * N + a] = d + 1; q.push(a, b); }
    }
  }
  const at = (i, j) => dist[clamp(j, 0, N - 1) * N + clamp(i, 0, N - 1)];
  // real land use from the cadastral map (public roads, streams, green parcels) when present
  const G = new Uint8Array(N * N);
  // industrial zones: unclassified land is paved yard, not lawn
  const def = doc.ground && doc.ground.default ? doc.ground.default.charCodeAt(0) : 0;
  if (def) G.fill(def);
  if (doc.ground) {
    doc.ground.rle.split('/').forEach((row, j) => {
      let i = 0;
      for (const m of row.matchAll(/(\D)(\d*)/g)) {
        const n = m[2] ? +m[2] : 1, code = m[1] === '.' ? def : m[1].charCodeAt(0);
        for (let k = 0; k < n && i < N; k++, i++) G[j * N + i] = code;
      }
    });
  }
  const R = 114, W = 119, GR = 103, PK = 112, IY = 105, RL = 116; // 'r' 'w' 'g' 'p' 'i' 't'
  const g_ = (i, j) => (i < 0 || j < 0 || i >= N || j >= N ? 0 : G[j * N + i]);
  layout.roads.length = 0; layout.curbs.length = 0;
  // base asphalt
  g.fillStyle = '#5a5e62'; g.fillRect(-half, -half, half * 2, half * 2);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const d = dist[j * N + i], x = -half + i * C, z = -half + j * C;
    const k = G[j * N + i];
    if (d > 0 && k) {
      if (k === R) {
        g.fillStyle = '#44474b'; g.fillRect(x, z, C + 0.05, C + 0.05);
        const hr = g_(i - 1, j) === R && g_(i + 1, j) === R, vr = g_(i, j - 1) === R && g_(i, j + 1) === R;
        layout.roads.push([x + C / 2, z + C / 2, hr && !vr ? 0 : vr && !hr ? 1 : 2]);
      } else if (k === W) { g.fillStyle = '#5a7d96'; g.fillRect(x, z, C + 0.05, C + 0.05); }
      else if (k === IY) { // concrete yard slabs
        g.fillStyle = ((i + j) & 1) ? '#8e8c86' : '#918f89'; g.fillRect(x, z, C + 0.05, C + 0.05);
        g.fillStyle = 'rgba(60,58,54,0.35)'; g.fillRect(x, z, C, 0.12); g.fillRect(x, z, 0.12, C);
        if (d > 3 && d < 9) layout.asphalt.push([x + C / 2, z + C / 2, 4]);
      }
      else if (k === RL) { // ballast with rails
        g.fillStyle = '#6d675f'; g.fillRect(x, z, C + 0.05, C + 0.05);
      }
      else if (k === GR) { g.fillStyle = '#6a8a4c'; g.fillRect(x, z, C + 0.05, C + 0.05); layout.lawns.push([x + C / 2, z + C / 2]); }
      else { g.fillStyle = '#5c6064'; g.fillRect(x, z, C + 0.05, C + 0.05); layout.asphalt.push([x + C / 2, z + C / 2, 4]); }
      continue;
    }
    // sidewalk strip along public roads
    if (d > 0 && (g_(i - 1, j) === R || g_(i + 1, j) === R || g_(i, j - 1) === R || g_(i, j + 1) === R)) {
      g.fillStyle = '#b4aea4'; g.fillRect(x, z, C + 0.05, C + 0.05);
      layout.curbs.push([x + C / 2, z + C / 2]);
      continue;
    }
    // lawns: far from buildings and in blob-shaped patches so roads stay continuous
    const blob = Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017 - 0.4) + 0.35 * Math.sin((x + z) * 0.05);
    if (d >= 5 && blob > -0.25 && !(i % 12 === 0 || j % 12 === 0)) {
      g.fillStyle = '#6a8a4c'; g.fillRect(x, z, C + 0.05, C + 0.05);
      layout.lawns.push([x + C / 2, z + C / 2]);
    } else if (d <= 2) {
      g.fillStyle = d === 0 ? '#a7a39b' : '#b2ada4'; g.fillRect(x, z, C + 0.05, C + 0.05);
      if (d === 2) layout.walks.push([x + C / 2, z + C / 2]);
    } else {
      layout.asphalt.push([x + C / 2, z + C / 2, d]);
    }
  }
  // lawn mottling and paver joints
  for (let i = 0; i < 16000; i++) {
    const x = -half + rng() * half * 2, z = -half + rng() * half * 2;
    const d = at(Math.floor((x + half) / C), Math.floor((z + half) / C));
    if (d >= 5 && !G[clamp(Math.floor((z + half) / C), 0, N - 1) * N + clamp(Math.floor((x + half) / C), 0, N - 1)]) { g.fillStyle = rng() < 0.5 ? 'rgba(60,92,44,0.4)' : 'rgba(120,150,80,0.3)'; g.beginPath(); g.arc(x, z, 0.5 + rng() * 1.8, 0, 6.3); g.fill(); }
  }
  g.strokeStyle = 'rgba(80,76,70,0.28)'; g.lineWidth = 0.08; g.beginPath();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const d = dist[j * N + i]; if (d > 2) continue;
    const x = -half + i * C, z = -half + j * C;
    for (let s = 0; s <= C; s += 2) { g.moveTo(x + s, z); g.lineTo(x + s, z + C); g.moveTo(x, z + s); g.lineTo(x + C, z + s); }
  }
  g.stroke();
  // lane markings on long straight public-road runs
  if (doc.ground) {
    g.strokeStyle = 'rgba(236,236,230,0.85)'; g.lineWidth = 0.16; g.setLineDash([3, 5]); g.beginPath();
    for (let j = 1; j < N; j++) {
      let run = 0;
      for (let i = 0; i <= N; i++) {
        const ok = i < N && G[j * N + i] === R && G[(j - 1) * N + i] === R;
        if (ok) run++;
        if (!ok && run >= 12) { const z = -half + j * C; g.moveTo(-half + (i - run) * C, z); g.lineTo(-half + i * C, z); }
        if (!ok) run = 0;
      }
    }
    for (let i = 1; i < N; i++) {
      let run = 0;
      for (let j = 0; j <= N; j++) {
        const ok = j < N && G[j * N + i] === R && G[j * N + i - 1] === R && !(g_(i - 2, j) === R && g_(i + 1, j) === R);
        if (ok) run++;
        if (!ok && run >= 12) { const x = -half + i * C; g.moveTo(x, -half + (j - run) * C); g.lineTo(x, -half + j * C); }
        if (!ok) run = 0;
      }
    }
    g.stroke(); g.setLineDash([]);
  }
  sitePlan(doc, g, rng);
  terrain.commitPaint();
}

// satellite site plan: perimeter roads around walled lots (with tree rows on their inner edge),
// vehicle yards packed with parked cars, rail sidings
function sitePlan(doc, g, rng) {
  layout.rows.length = 0;
  for (const [x0, z0, x1, z1] of doc.lots || []) {
    g.fillStyle = '#c4c1b8';
    const B = 7;
    g.fillRect(x0 - B / 2, z0 - B / 2, x1 - x0 + B, B); g.fillRect(x0 - B / 2, z1 - B / 2, x1 - x0 + B, B);
    g.fillRect(x0 - B / 2, z0 - B / 2, B, z1 - z0 + B); g.fillRect(x1 - B / 2, z0 - B / 2, B, z1 - z0 + B);
    // narrow planting strip just inside the road
    g.fillStyle = '#5f7f45';
    const S = 3, o = B / 2;
    g.fillRect(x0 + o, z0 + o, x1 - x0 - 2 * o, S); g.fillRect(x0 + o, z1 - o - S, x1 - x0 - 2 * o, S);
    g.fillRect(x0 + o, z0 + o, S, z1 - z0 - 2 * o); g.fillRect(x1 - o - S, z0 + o, S, z1 - z0 - 2 * o);
    const t = o + S / 2;
    for (let x = x0 + 12; x < x1 - 10; x += 11) { layout.rows.push([x, z0 + t]); layout.rows.push([x, z1 - t]); }
    for (let z = z0 + 12; z < z1 - 10; z += 11) { layout.rows.push([x0 + t, z]); layout.rows.push([x1 - t, z]); }
  }
  const carCols = ['#eeeeec', '#e4e4e2', '#c9ccd0', '#9da2a8', '#2b2d31', '#18191c', '#3a4a6a', '#7d2424', '#d8d4ca'];
  for (const [x0, z0, x1, z1] of doc.yards || []) {
    const along = (x1 - x0) >= (z1 - z0);
    for (let a = (along ? z0 : x0) + 3; a < (along ? z1 : x1) - 5; a += 13) { // double rows + aisle
      for (const off of [0, 4.9]) {
        for (let b = (along ? x0 : z0) + 2; b < (along ? x1 : z1) - 2; b += 2.4) {
          if (rng() < 0.08) continue;
          g.fillStyle = carCols[Math.floor(rng() * carCols.length)];
          if (along) g.fillRect(b, a + off, 1.8, 4.3); else g.fillRect(a + off, b, 4.3, 1.8);
        }
      }
    }
  }
  for (const [x0, z0, x1, z1] of doc.rails || []) {
    g.fillStyle = '#6d675f'; g.fillRect(x0, z0, x1 - x0, z1 - z0);
    g.fillStyle = '#3e3a36';
    const along = (x1 - x0) >= (z1 - z0);
    const w = along ? z1 - z0 : x1 - x0;
    for (let k = 2; k < w - 1.5; k += 5) {
      if (along) { g.fillRect(x0, z0 + k, x1 - x0, 0.2); g.fillRect(x0, z0 + k + 1.5, x1 - x0, 0.2); }
      else { g.fillRect(x0 + k, z0, 0.2, z1 - z0); g.fillRect(x0 + k + 1.5, z0, 0.2, z1 - z0); }
    }
  }
}
