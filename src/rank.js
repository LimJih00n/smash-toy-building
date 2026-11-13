// Time-attack leaderboard. Three backends, best first:
//   1. HTTP API (self-hosted site: <meta name="rank-api" content="/api">, see server/worker.js)
//   2. the claude.ai artifact database (test link: everyone reads, Contributors and up write)
//   3. this browser only (personal bests) — the board says so
// A run counts when every target building is down (파괴율 100%) without the nuke; a run that used a
// single weapon also goes on that weapon's board.
const LOCAL_KEY = 'smash.rank.local';
const api = (document.querySelector('meta[name="rank-api"]') || {}).content || '';

const field = (map, weapon) => map.replace(/[^a-zA-Z0-9]/g, '_') + (weapon && weapon !== 'all' ? '__' + weapon : '');
/** boards: 'all' (any weapons but the nuke) and one per weapon for runs that used only that weapon */
export const BOARDS = ['all', 'mg', 'hammer', 'bomb', 'missile', 'laser', 'meteor'];
const cleanName = (s) => String(s || '').replace(/[<>"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);

function readLocal() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch (e) { return {}; } }
function writeLocal(o) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(o)); } catch (e) { /* private mode */ } }

let dbP = null;
async function dbBackend() {
  if (dbP) return dbP;
  dbP = (async () => {
    if (!window.claude || !window.claude.use) return null;
    const db = await window.claude.use('db');
    const user = await window.claude.use('user');
    if (!db || !user) return null;
    const uid = await user.id();
    let canWrite = null;
    try { canWrite = await user.can('data.write'); } catch (e) { /* unknown */ }
    return { db, uid, canWrite };
  })().catch(() => null);
  return dbP;
}

/** where the board lives, for the UI: 'online' | 'shared' | 'local', and whether this viewer can submit */
export async function mode() {
  if (api) return { kind: 'online', canSubmit: true };
  const d = await dbBackend();
  if (d) return { kind: 'shared', canSubmit: !!d.uid && d.canWrite !== false };
  return { kind: 'local', canSubmit: true };
}

/** submit a finished run; resolves { ok, rank?, note? } */
export async function submit(run) {
  const name = cleanName(run.name) || '익명';
  const rec = { map: run.map, name, ms: Math.round(run.ms), dmg: Math.round(run.dmg || 0), shots: run.shots | 0 };
  const boards = ['all'].concat(run.weapon && BOARDS.includes(run.weapon) ? [run.weapon] : []);
  // personal bests always kept locally
  const loc = readLocal();
  for (const w of boards) { const k = field(run.map, w); if (!loc[k] || rec.ms < loc[k].ms) loc[k] = { ...rec, at: Date.now() }; }
  writeLocal(loc);
  if (api) {
    try {
      let rank = null;
      for (const w of boards) {
        const r = await fetch(api.replace(/\/$/, '') + '/rank', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...rec, weapon: w }) });
        const j = await r.json();
        if (!r.ok) return { ok: false, note: j.error || '등록 실패' };
        if (w === 'all') rank = j.rank;
      }
      return { ok: true, rank };
    } catch (e) { return { ok: false, note: '서버에 연결하지 못했어요' }; }
  }
  const d = await dbBackend();
  if (d && d.uid) {
    try {
      const ref = d.db.doc('rank/' + d.uid);
      const cur = await ref.get();
      const body = cur.exists ? { ...cur.data() } : {};
      body.name = name;
      for (const w of boards) {
        const k = field(run.map, w), old = body['t_' + k];
        if (!old || rec.ms < old) { body['t_' + k] = rec.ms; body['d_' + k] = rec.dmg; body['s_' + k] = rec.shots; }
      }
      await ref.set(body);
      return { ok: true };
    } catch (e) { return { ok: false, note: '이 링크에서는 랭킹 등록 권한이 없어요 (기록은 이 기기에 저장됨)' }; }
  }
  return { ok: true, note: '이 기기에 저장됨' };
}

/** top runs for a map: [{ name, ms, dmg, shots, me }] */
export async function top(map, n = 10, weapon = 'all') {
  const k = field(map, weapon);
  if (api) {
    try { const r = await fetch(api.replace(/\/$/, '') + '/rank?map=' + encodeURIComponent(map) + '&weapon=' + weapon + '&n=' + n); const j = await r.json(); return j.rows || []; } catch (e) { return []; }
  }
  const d = await dbBackend();
  if (d) {
    try {
      const q = await d.db.collection('rank').where('t_' + k, '>', 0).orderBy('t_' + k, 'asc').limit(n).get();
      return q.docs.map((s) => { const b = s.data(); return { name: cleanName(b.name) || '익명', ms: b['t_' + k], dmg: b['d_' + k] || 0, shots: b['s_' + k] || 0, me: s.id === d.uid }; });
    } catch (e) { /* fall through to local */ }
  }
  const loc = readLocal()[k];
  return loc ? [{ ...loc, me: true }] : [];
}

// ---------------------------------------------------------------------------------------------------
// "가장 많이 부서진 곳": damage (만원) summed over every player, per map. Each client adds its own
// damage to a pending pot (kept in localStorage so a reload or map switch loses nothing) and flushes it
// every ~20 s and when the page is hidden. Board = maps sorted by total damage.
const PEND_KEY = 'smash.hits.pending', MINE_KEY = 'smash.hits.mine';
const readJ = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) { return {}; } };
const writeJ = (k, o) => { try { localStorage.setItem(k, JSON.stringify(o)); } catch (e) { /* private mode */ } };
let memPend = {};
function pend() { return { ...readJ(PEND_KEY), ...memPend }; }

/** add damage (만원) dealt on a map; clear = a completed run (counted once per run) */
export function addHits(map, dmg, clear = false) {
  if (!(dmg > 0) && !clear) return;
  const p = pend(); const e = p[map] || { d: 0, c: 0 };
  e.d += Math.max(0, Math.round(dmg || 0)); if (clear) e.c += 1;
  p[map] = e; memPend = p; writeJ(PEND_KEY, p);
  const mine = readJ(MINE_KEY); const m = mine[map] || { d: 0, c: 0 }; m.d += Math.max(0, Math.round(dmg || 0)); if (clear) m.c += 1; mine[map] = m; writeJ(MINE_KEY, mine);
}

let flushing = false;
export async function flushHits(beacon = false) {
  const p = pend(); const maps = Object.keys(p).filter((k) => p[k].d > 0 || p[k].c > 0);
  if (!maps.length || flushing) return;
  if (api) {
    const body = JSON.stringify({ items: maps.map((k) => ({ map: k, dmg: p[k].d, clears: p[k].c })) });
    const url = api.replace(/\/$/, '') + '/hits';
    if (beacon && navigator.sendBeacon) { if (navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) { memPend = {}; writeJ(PEND_KEY, {}); } return; }
    flushing = true;
    try { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body }); if (r.ok) { memPend = {}; writeJ(PEND_KEY, {}); } } catch (e) { /* retry later */ }
    flushing = false; return;
  }
  const d = await dbBackend();
  if (d && d.uid && d.canWrite !== false && !beacon) {
    flushing = true;
    try {
      const ref = d.db.doc('rank/' + d.uid); const cur = await ref.get(); const b = cur.exists ? { ...cur.data() } : {};
      for (const k of maps) { const f = k.replace(/[^a-zA-Z0-9]/g, '_'); b['h_' + f] = (b['h_' + f] || 0) + p[k].d; b['hc_' + f] = (b['hc_' + f] || 0) + p[k].c; }
      await ref.set(b); memPend = {}; writeJ(PEND_KEY, {});
    } catch (e) { /* no write access on this link: keep it local */ }
    flushing = false; return;
  }
  if (!d) { memPend = {}; writeJ(PEND_KEY, {}); } // local-only: the 'mine' totals are the board
}

/** maps by total damage: [{ map, dmg, clears, players? }], biggest first; kind says whose totals they are */
export async function hits() {
  if (api) {
    try { const r = await fetch(api.replace(/\/$/, '') + '/hits'); const j = await r.json(); return { kind: 'online', rows: j.rows || [] }; } catch (e) { /* fall through */ }
  }
  const d = await dbBackend();
  if (d) {
    try {
      const q = await d.db.collection('rank').limit(500).get(); const sum = {};
      for (const s of q.docs) { const b = s.data(); for (const [k, v] of Object.entries(b)) { if (k.startsWith('h_')) { const id = k.slice(2); const e = sum[id] || (sum[id] = { dmg: 0, clears: 0, players: 0 }); e.dmg += +v || 0; e.players += 1; } else if (k.startsWith('hc_')) { const id = k.slice(3); const e = sum[id] || (sum[id] = { dmg: 0, clears: 0, players: 0 }); e.clears += +v || 0; } } }
      const p = pend(); for (const [k, v] of Object.entries(p)) { const id = k.replace(/[^a-zA-Z0-9]/g, '_'); const e = sum[id] || (sum[id] = { dmg: 0, clears: 0, players: 1 }); e.dmg += v.d; e.clears += v.c; }
      return { kind: 'shared', rows: Object.entries(sum).map(([k, e]) => ({ key: k, ...e })).sort((a, b) => b.dmg - a.dmg) };
    } catch (e) { /* fall through */ }
  }
  const mine = readJ(MINE_KEY);
  return { kind: 'local', rows: Object.entries(mine).map(([k, e]) => ({ map: k, dmg: e.d, clears: e.c })).sort((a, b) => b.dmg - a.dmg) };
}
