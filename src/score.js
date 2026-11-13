// Damage ledger + 직급 (job title) progression.
// The score is the estimated property damage in won (internally in units of 만원).
// A "promotion" gauge fills with sustained destruction and drains when idle;
// each title raises the damage multiplier. Switching weapons nudges it further.
export const RANKS = [
  { id: '인턴', mult: 1.0, color: '#8f9aa3' },
  { id: '사원', mult: 1.15, color: '#6fb7a8' },
  { id: '대리', mult: 1.35, color: '#5ab0e6' },
  { id: '과장', mult: 1.6, color: '#7f8cff' },
  { id: '부장', mult: 1.9, color: '#e6a23c' },
  { id: '임원', mult: 2.3, color: '#ef6b3a' },
  { id: '회장', mult: 2.8, color: '#f2c94c' },
];
// gauge needed to reach each title; later promotions take longer
const TH = [0, 120, 300, 550, 900, 1350, 1900];
const GMAX = 2400;
const rankOf = (g) => { let r = 0; while (r + 1 < TH.length && g >= TH[r + 1]) r++; return r; };
const WON_PER_M3 = 80; // 만원 per destroyed m³ (rough build cost incl. fit-out)
const BEST_KEY = 'smash.bestDamage';

export const state = {
  score: 0, best: 0, gauge: 0, rank: 0, peakRank: 0,
  toolMult: 1, lastTool: null, sameTool: 0,
  collapsed: new Set(), props: 0, idle: 0,
};
export const ui = { popup: null, rankUp: null };

try { state.best = +localStorage.getItem(BEST_KEY) || 0; } catch (e) { /* storage blocked */ }

/** 만원 → "3.2억원" / "1.05조원" / "4,500만원" */
export function won(man) {
  man = Math.round(man);
  if (man >= 1e8) return (man / 1e8).toFixed(man >= 1e9 ? 1 : 2) + '조원';
  if (man >= 1e4) return (man / 1e4).toFixed(man >= 1e6 ? 0 : 1).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '억원';
  if (man > 0) return man.toLocaleString() + '만원';
  return '0원';
}

function multiplier() { return RANKS[state.rank].mult * state.toolMult; }

function addGauge(g) {
  state.gauge = Math.min(GMAX, state.gauge + g);
  state.idle = 0;
  const r = rankOf(state.gauge);
  if (r > state.rank) {
    state.rank = r;
    if (r > state.peakRank && ui.popup) ui.popup('승진', RANKS[r].id, true);
    if (ui.rankUp) ui.rankUp(RANKS[r]);
  }
  state.peakRank = Math.max(state.peakRank, state.rank);
}

function add(amount) {
  const p = Math.round(amount * multiplier());
  state.score += p;
  if (state.score > state.best) { state.best = state.score; try { localStorage.setItem(BEST_KEY, String(state.best)); } catch (e) { /* ignore */ } }
  return p;
}

/** destroyed volume (m³) since the last call */
export function damage(vol) {
  if (vol <= 0) return 0;
  const p = add(vol * WON_PER_M3);
  addGauge(Math.min(30, 6 * Math.log2(1 + vol / 200)));
  return p;
}

/** a lump-sum bonus (만원) with a ledger line */
export function bonus(amount, label, gauge = 20) {
  const p = add(amount);
  addGauge(gauge);
  if (ui.popup) ui.popup(label, '+' + won(p));
  return p;
}

export function onAttack(tool) {
  // variety pays: switching weapons raises the multiplier, spamming one lowers it
  if (state.lastTool && tool !== state.lastTool) { state.toolMult = Math.min(2, state.toolMult + 0.15); state.sameTool = 0; }
  else if (tool === state.lastTool) { state.sameTool++; if (state.sameTool > 3) state.toolMult = Math.max(0.6, state.toolMult - 0.08); }
  state.lastTool = tool;
  state.idle = 0;
}

export function propHit(kind) {
  state.props++;
  add(kind === 'car' ? 3000 : kind === 'tree' || kind === 'hedge' ? 300 : 500);
  addGauge(2);
}

export function buildingCollapsed(name) {
  if (state.collapsed.has(name)) return;
  state.collapsed.add(name);
  bonus(100000, `${name} 전파`, 120);
}

export function update(dt) {
  state.idle += dt;
  // after a short grace period the gauge drains, faster at higher titles
  if (state.idle > 2) {
    state.gauge = Math.max(0, state.gauge - dt * (20 + state.rank * 14));
    const r = rankOf(state.gauge);
    if (r < state.rank) state.rank = r;
    state.toolMult += (1 - state.toolMult) * Math.min(1, dt * 0.2);
  }
}

export function reset() {
  Object.assign(state, { score: 0, gauge: 0, rank: 0, peakRank: 0, toolMult: 1, lastTool: null, sameTool: 0, props: 0, idle: 0 });
  state.collapsed = new Set();
}
export const rankInfo = () => RANKS[state.rank];
export const nextRank = () => RANKS[state.rank + 1] || null;
export const gaugeFrac = () => {
  const r = state.rank; if (r + 1 >= TH.length) return Math.min(1, (state.gauge - TH[r]) / (GMAX - TH[r]));
  return (state.gauge - TH[r]) / (TH[r + 1] - TH[r]);
};
