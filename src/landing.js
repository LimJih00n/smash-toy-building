// First-screen extras: 조작법 / 회사 파괴 랭킹 / 방명록 / 친구에게 공유, shown in one sheet over the start card.
import * as Rank from './rank.js';

const api = ((document.querySelector('meta[name="rank-api"]') || {}).content || '').replace(/\/$/, '');
const SITE_URL = location.origin; // share links point at wherever this build is served
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let ctx = null; // { MAPS, MAP, won, toast }
export function initLanding(c) {
  ctx = c;
  document.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); open(b.dataset.sheet); }));
  const sh = document.getElementById('sheet');
  sh.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === sh) close(); });
  sh.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  document.getElementById('sheetClose').addEventListener('click', close);
  renderTop3();
}

function close() { document.getElementById('sheet').classList.remove('show'); }
/** open one of the sheets: 'howto' | 'rank' | 'guest' | 'share' */
export function openSheet(kind) { open(kind); }
function open(kind) {
  const body = document.getElementById('sheetBody'); body.textContent = '';
  const title = { howto: '🎮 조작법', rank: '🏆 회사 파괴 랭킹', guest: '📝 방명록', share: '📤 친구에게 공유' }[kind];
  document.getElementById('sheetTitle').textContent = title;
  ({ howto, rank, guest, share })[kind](body);
  document.getElementById('sheet').classList.add('show');
}

// ------------------------------------------------------------------ 조작법
const WEAPONS = [
  ['1', '기관총', '누르고 있으면 연사. 유리와 외벽이 조금씩 뜯겨요.'],
  ['2', '망치', '찍은 곳을 거대한 망치로 내려쳐요. 떨어진 조각도 다시 부서져요.'],
  ['3', '폭탄', '던지면 도화선이 타고 터져요.'],
  ['4', '미사일', '한 번 누르면 3발이 차례로 꽂혀요.'],
  ['5', '레이저', '건물 위를 끌어 선을 그으면 위성이 그 선대로 잘라요.'],
  ['6', '운석', '반경 40 m를 날려 버려요.'],
  ['7', '핵폭탄', '반경 230 m가 통째로. 대신 랭킹에는 안 올라가요.'],
];
WEAPONS.push(['8', '칼', '화면을 그으면 그 선대로 베어요. 건물을 끝까지 가로지르면 윗부분이 떨어져요.']);
const PC = [['🖱 왼쪽 클릭', '공격 (고른 무기)'], ['🖱 끌기', '시점 돌리기'], ['🖱 오른쪽 끌기', '화면 이동'], ['🖱 휠', '확대·축소'], ['🖱 기관총·레이저·칼일 때', '오른쪽 끌기로 시점 돌리기'], ['W A S D / 방향키', '걸어서 이동'], ['Q / E', '아래로 / 위로'], ['1 ~ 8', '무기 바꾸기'], ['V · R · M · Esc', '시점 · 복원 · 소리 · 맵 선택']];
const MO = [['👆 탭', '공격 (고른 무기)'], ['☝️ 한 손가락 끌기', '시점 돌리기'], ['✌️ 두 손가락', '이동 · 확대'], ['✌️ 기관총·레이저·칼일 때', '두 손가락으로 끌어서 시점 돌리기'], ['⬇️ 아래 무기 버튼', '눌러서 무기 바꾸기'], ['⏸ 왼쪽 위 버튼', '일시정지 · 메뉴']];
function howto(body) {
  const isMo = matchMedia('(pointer: coarse)').matches;
  const tabs = el('div', 'tabs'); const pane = el('div');
  const show = (mo) => {
    tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', (i === 1) === mo));
    pane.textContent = '';
    const g = el('div', 'keys');
    for (const [k, v] of mo ? MO : PC) { const r = el('div', 'key'); r.append(el('b', null, k), el('span', null, v)); g.appendChild(r); }
    pane.appendChild(g);
  };
  for (const [i, t] of ['💻 PC', '📱 휴대폰'].entries()) { const b = el('button', null, t); b.addEventListener('click', () => show(i === 1)); tabs.appendChild(b); }
  body.append(tabs, pane);
  show(isMo);
  body.appendChild(el('h3', null, `무기 ${WEAPONS.length}종`));
  const w = el('div', 'weap');
  for (const [k, n, d] of WEAPONS) { const r = el('div', 'wrow'); r.append(el('i', null, k), el('b', null, n), el('span', null, d)); w.appendChild(r); }
  body.appendChild(w);
  body.appendChild(el('h3', null, '목표'));
  const ul = el('ul', 'goal');
  for (const t of ['파란 이름표가 붙은 건물이 목표예요. 목표 건물을 전부 무너뜨리면 완파!', '완파까지 걸린 시간으로 랭킹에 올라가요. 한 가지 무기로만 깨면 무기별 랭킹에도 올라가요.', '쉬지 않고 부수면 직급이 올라가요 (인턴 → 사원 → 대리 → 과장 → 부장 → 임원 → 회장). 직급이 높을수록 피해액이 더 크게 쌓이고(회장 2.8배), 손을 놓으면 다시 내려가요.', '기둥이 사라진 층은 위층을 버티지 못하고 무너져요. 아래부터 노려 보세요.'])
    ul.appendChild(el('li', null, t));
  body.appendChild(ul);
}

// ------------------------------------------------------------------ 회사 파괴 랭킹
async function rankRows() {
  const { kind, rows } = await Rank.hits();
  const byKey = (r) => ctx.MAPS.find((m) => m.id === r.map || m.id.replace(/[^a-zA-Z0-9]/g, '_') === r.key);
  return { kind, list: rows.map((r) => ({ ...r, m: byKey(r) })).filter((r) => r.m && r.dmg > 0) };
}
async function rank(body) {
  body.appendChild(el('p', 'lead', '모든 이용자가 낸 피해액을 회사(맵)별로 합친 순위예요. 오래 부술수록, 많이 부술수록 올라가요.'));
  const box = el('div', 'board'); box.textContent = '불러오는 중…'; body.appendChild(box);
  const { kind, list } = await rankRows();
  box.textContent = '';
  if (kind !== 'online') box.appendChild(el('div', 'empty', '온라인 집계는 companysmash.com에서만 보여요. 지금은 이 기기 기록이에요.'));
  if (!list.length) { box.appendChild(el('div', 'empty', '아직 집계된 피해가 없어요. 첫 피해를 남겨 보세요!')); await wishList(body); return; }
  const max = list[0].dmg;
  const ol = el('ol', 'crank');
  list.slice(0, 10).forEach((r, i) => {
    const li = el('li', i < 3 ? 'top' : '');
    li.appendChild(el('i', null, ['🥇', '🥈', '🥉'][i] || String(i + 1)));
    const mid = el('div', 'mid'); mid.appendChild(el('b', null, r.m.title));
    mid.appendChild(el('small', null, r.m.sub + (r.clears ? ' · 완파 ' + r.clears.toLocaleString() + '회' : '')));
    const bar = el('div', 'rbar'); const fill = el('em'); fill.style.width = Math.max(4, (r.dmg / max) * 100) + '%'; bar.appendChild(fill); mid.appendChild(bar);
    li.appendChild(mid);
    li.appendChild(el('span', 'amt', ctx.won(r.dmg)));
    li.addEventListener('click', () => go(r.m.id));
    ol.appendChild(li);
  });
  box.appendChild(ol);
  body.appendChild(el('p', 'fine', '순위를 누르면 그 맵으로 가요. 맵별 완파 타임어택 순위는 게임 중 🏆 랭킹 버튼에 있어요.'));
  await wishList(body);
}
function go(id) {
  if (id === ctx.MAP.id) { close(); return; }
  const qs = new URLSearchParams(location.search); qs.set('map', id); location.search = qs.toString();
}
// small top-3 strip on the start card
async function renderTop3() {
  const box = document.getElementById('top3'); if (!box) return;
  try {
    const { list } = await rankRows();
    if (!list.length) { box.style.display = 'none'; return; }
    box.textContent = '';
    box.appendChild(el('span', 'lb', '🔥 지금 제일 많이 부서진 곳'));
    list.slice(0, 3).forEach((r, i) => { const a = el('button', null, ['🥇', '🥈', '🥉'][i] + ' ' + (r.m.short || r.m.title)); a.addEventListener('click', (e) => { e.stopPropagation(); go(r.m.id); }); box.appendChild(a); });
  } catch (e) { box.style.display = 'none'; }
}

// ------------------------------------------------------------------ 방명록
const GB_NAME = 'smash.gb.name';
const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? '방금' : s < 3600 ? Math.floor(s / 60) + '분 전' : s < 86400 ? Math.floor(s / 3600) + '시간 전' : Math.floor(s / 86400) + '일 전'; };
async function guest(body) {
  if (!api) { body.appendChild(el('p', 'lead', '방명록은 companysmash.com에서 쓸 수 있어요.')); return; }
  const form = el('div', 'gform');
  const name = el('input'); name.maxLength = 12; name.placeholder = '닉네임 (실명·욕설 금지, 안 쓰면 익명)';
  try { name.value = localStorage.getItem(GB_NAME) || ''; } catch (e) { /* storage blocked */ }
  const msg = el('textarea'); msg.maxLength = 100; msg.rows = 2; msg.placeholder = '한마디 남겨 주세요 (100자). 부숴 줬으면 하는 회사도 환영!';
  const cnt = el('small', 'cnt', '0/100');
  msg.addEventListener('input', () => { cnt.textContent = msg.value.length + '/100'; });
  const send = el('button', null, '남기기');
  const note = el('div', 'note');
  form.append(name, msg, cnt, send, note);
  body.appendChild(form);
  const list = el('div', 'glist'); body.appendChild(list);
  const load = async () => {
    list.textContent = '불러오는 중…';
    try {
      const j = await (await fetch(api + '/guestbook')).json();
      list.textContent = '';
      if (!j.rows || !j.rows.length) { list.appendChild(el('div', 'empty', '첫 방명록을 남겨 보세요!')); return; }
      for (const r of j.rows) {
        const it = el('div', 'gitem');
        const hd = el('div', 'gh'); hd.append(el('b', null, r.name));
        const m = r.map && ctx.MAPS.find((x) => x.id === r.map);
        hd.append(el('small', null, (m ? m.short + ' · ' : '') + ago(r.at)));
        it.append(hd, el('p', null, r.msg));
        list.appendChild(it);
      }
    } catch (e) { list.textContent = '방명록을 불러오지 못했어요. 잠시 후 다시 열어 주세요.'; }
  };
  send.addEventListener('click', async () => {
    const t = msg.value.trim();
    if (t.length < 2) { note.textContent = '두 글자 이상 적어 주세요'; msg.focus(); return; }
    send.disabled = true; note.textContent = '';
    try {
      try { localStorage.setItem(GB_NAME, name.value.trim()); } catch (e) { /* storage blocked */ }
      const r = await fetch(api + '/guestbook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.value, msg: t, map: ctx.MAP.id }) });
      const j = await r.json();
      if (!r.ok) note.textContent = j.error || '남기지 못했어요';
      else { msg.value = ''; cnt.textContent = '0/100'; note.textContent = '남겼어요. 고마워요!'; load(); }
    } catch (e) { note.textContent = '연결이 불안정해요. 잠시 후 다시 시도해 주세요.'; }
    send.disabled = false;
  });
  body.appendChild(el('p', 'fine', '욕설·링크·개인정보는 남길 수 없고, 운영자가 지울 수 있어요. 같은 기기는 30초에 한 번 쓸 수 있어요.'));
  load();
}

// ------------------------------------------------------------------ 공유
function share(body) {
  const url = SITE_URL + '/?map=' + encodeURIComponent(ctx.MAP.id);
  const text = '미니어처 도시, 마음껏 부숴 봤어? 💥 회사부수기 · ' + ctx.MAP.title;
  body.appendChild(el('p', 'lead', '지금 고른 맵(' + ctx.MAP.title + ')으로 바로 들어오는 링크예요.'));
  const box = el('div', 'linkbox'); const inp = el('input'); inp.readOnly = true; inp.value = url; box.appendChild(inp);
  const copy = el('button', null, '링크 복사'); box.appendChild(copy); body.appendChild(box);
  const note = el('div', 'note');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text + '\n' + url); note.textContent = '복사했어요! 카톡·메신저에 붙여넣어 보내 보세요.'; }
    catch (e) { inp.select(); note.textContent = '위 링크를 길게 눌러 복사해 주세요.'; }
  });
  const g = el('div', 'sharebtns');
  if (navigator.share) {
    const b = el('button', 'native', '📱 카톡·메신저로 보내기');
    b.addEventListener('click', async () => { try { await navigator.share({ title: '회사 때려부수기', text, url }); } catch (e) { /* cancelled */ } });
    g.appendChild(b);
  }
  const links = [
    ['X (트위터)', 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(url)],
    ['페이스북', 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url)],
    ['네이버 블로그', 'https://share.naver.com/web/shareView?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(text)],
  ];
  for (const [n, h] of links) { const a = el('a', null, n); a.href = h; a.target = '_blank'; a.rel = 'noopener'; g.appendChild(a); }
  body.append(g, note);
  body.appendChild(el('p', 'fine', '완파하면 결과 화면의 📤 버튼으로 내 기록이 담긴 도전장을 보낼 수 있어요. 받은 친구 화면에 내 기록이 떠요.'));
}

// ------------------------------------------------------------------ 만들어 주세요 투표
export async function wishTop() {
  if (!api) return [];
  try { const j = await (await fetch(api + '/wish')).json(); return j.rows || []; } catch (e) { return []; }
}
export async function wishVote(name) {
  if (!api) return { ok: false, error: '투표는 companysmash.com에서 할 수 있어요' };
  try {
    const r = await fetch(api + '/wish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    const j = await r.json(); return r.ok ? j : { ok: false, error: j.error || '투표하지 못했어요' };
  } catch (e) { return { ok: false, error: '연결이 불안정해요' }; }
}
async function wishList(body) {
  body.appendChild(el('h3', null, '🗳 만들어 줬으면 하는 회사'));
  const box = el('div', 'board'); body.appendChild(box);
  const rows = await wishTop();
  if (!rows.length) { box.appendChild(el('div', 'empty', '맵 검색창에 없는 회사를 치면 투표할 수 있어요. 표가 많은 회사부터 만들어요.')); return; }
  const ol = el('ol', 'crank');
  rows.slice(0, 10).forEach((r, i) => {
    const li = el('li', ''); li.appendChild(el('i', null, String(i + 1)));
    const mid = el('div', 'mid'); mid.appendChild(el('b', null, r.name)); li.appendChild(mid);
    const v = el('button', 'vote', '👍 ' + r.votes);
    v.addEventListener('click', async (e) => { e.stopPropagation(); v.disabled = true; const j = await wishVote(r.name); v.textContent = '👍 ' + (j.votes || r.votes) + (j.already ? ' (투표함)' : ''); });
    li.appendChild(v); ol.appendChild(li);
  });
  box.appendChild(ol);
  body.appendChild(el('p', 'fine', '맵 검색창에 회사 이름을 쳐서 없으면 새로 투표할 수 있어요. 같은 회사는 기기당 한 표예요.'));
}
