// Emblems: collected by clearing maps (bronze / silver / gold by time), single-weapon clears and
// a few challenges. Kept in this browser for now; the shape is ready to sync to an account once
// sign-in exists on the public site (merge = keep the better tier / earliest date per id).
// Designs are our own: hexagon badges with generic icons. No company logos or brand marks.
const KEY = 'smash.emblems';
export const TIER = { 1: { n: '동', c: '#c98a5c' }, 2: { n: '은', c: '#c9d2da' }, 3: { n: '금', c: '#f2c94c' } };
// time limits for silver / gold (seconds); bronze = any clear without the nuke
const LIMIT = { silver: 180, gold: 90 };

const WEAPON = { mg: '기관총', hammer: '망치', bomb: '폭탄', missile: '미사일', laser: '레이저', meteor: '운석' };

export function defs(maps) {
  const out = [];
  for (const m of maps) out.push({ id: 'map_' + m.id, group: '맵 완파', title: m.short || m.title, desc: `완파 · 은 ${LIMIT.silver / 60}분 이내 · 금 ${LIMIT.gold}초 이내`, icon: 'tower', tiered: true });
  for (const [w, n] of Object.entries(WEAPON)) out.push({ id: 'w_' + w, group: '무기 장인', title: n + ' 장인', desc: `${n}만으로 아무 맵이나 완파`, icon: 'w:' + w });
  out.push(
    { id: 'c_few', group: '도전', title: '저격수', desc: '공격 10회 이하로 완파', icon: 'target' },
    { id: 'c_fast', group: '도전', title: '번개', desc: '30초 안에 완파', icon: 'bolt' },
    { id: 'c_chair', group: '도전', title: '회장님', desc: '한 판에 직급 회장 달성', icon: 'crown' },
    { id: 'c_cpg', group: '수집', title: '물류 정복', desc: '물류센터 맵 모두 완파', icon: 'star' },
    { id: 'c_all', group: '수집', title: '전 맵 정복', desc: '모든 맵 완파', icon: 'star' },
  );
  return out;
}

function read() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
function write(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* private mode */ } }
export const owned = () => read();

/** give (or upgrade) one emblem; returns the def-less record when it is new or better */
export function award(id, tier = 1) {
  const o = read(), cur = o[id];
  if (cur && cur.tier >= tier) return null;
  o[id] = { tier, at: cur ? cur.at : Date.now() };
  write(o);
  return { id, tier, upgraded: !!cur };
}

/** after a finished run: everything it earned. run = { map, sec, shots, nuke, weapon } */
export function onClear(run, maps) {
  if (run.nuke) return [];
  const got = [];
  const add = (r) => { if (r) got.push(r); };
  add(award('map_' + run.map, run.sec <= LIMIT.gold ? 3 : run.sec <= LIMIT.silver ? 2 : 1));
  if (run.weapon && WEAPON[run.weapon]) add(award('w_' + run.weapon));
  if (run.shots <= 10) add(award('c_few'));
  if (run.sec <= 30) add(award('c_fast'));
  const o = read();
  const cleared = (ids) => ids.length && ids.every((id) => o['map_' + id]);
  if (cleared(maps.filter((m) => m.id.startsWith('cpg-')).map((m) => m.id))) add(award('c_cpg'));
  if (cleared(maps.map((m) => m.id))) add(award('c_all'));
  return got;
}

// ---------- badge drawing (inline SVG)
const ICON = {
  tower: '<path d="M-9 9V-5h6V9M-2 9V-11h7V9M6 9V-2h4V9" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  target: '<circle r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M0-12v5M0 7v5M-12 0h5M7 0h5" stroke="currentColor" stroke-width="2"/>',
  bolt: '<path d="M2-11L-6 2h6l-2 9 8-13H0z" fill="currentColor"/>',
  crown: '<path d="M-10 6l-1-12 6 5 5-8 5 8 6-5-1 12z" fill="currentColor"/>',
  star: '<path d="M0-11l3.2 6.6 7.3 1-5.3 5.1 1.3 7.2L0 5.5-6.5 9l1.3-7.2-5.3-5.1 7.3-1z" fill="currentColor"/>',
};
export function badge(def, tier, weaponSvg) {
  const on = tier > 0, col = on ? (def.tiered ? TIER[tier].c : TIER[3].c) : '#3a434b';
  let icon = ICON[def.icon] || '';
  if (def.icon.startsWith('w:')) icon = `<g transform="translate(-12 -12) scale(0.75)" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${weaponSvg(def.icon.slice(2))}</g>`;
  return `<svg viewBox="-20 -22 40 44" class="emb-svg"><path d="M0-20L17-10V10L0 20-17 10V-10z" fill="${col}" fill-opacity="${on ? 0.22 : 0.12}" stroke="${col}" stroke-width="2"/>`
    + `<path d="M0-15.5L13-8V8L0 15.5-13 8V-8z" fill="none" stroke="${col}" stroke-opacity=".45" stroke-width="1"/>`
    + `<g style="color:${on ? col : '#5a646d'}">${icon}</g></svg>`;
}
