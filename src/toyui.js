// Mobile UI for the toy style (?style=toy), portrait one-hand first:
//  - in play: one top bar (menu · target progress + time · title + damage) and the weapon row at
//    the thumb; everything else lives in the pause menu
//  - home: the stage cards and one start button (the web page's landing card is hidden)
//  - result: time, damage, title, what this run added to the stage's total, best time, next stage
// The HUD's live elements (#meter, #timer, #score) are updated by main.js; the top bar re-homes them.
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const svg = (s) => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstChild; };
const SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/></svg>';
const DICE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><circle cx="8.5" cy="8.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.6" fill="currentColor" stroke="none"/></svg>';
// search: Korean initials ('ㅅㅅ' finds 삼성) as well as plain text, spaces ignored
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const initials = (s) => s.replace(/[가-힣]/g, (c) => CHO[Math.floor((c.charCodeAt(0) - 0xac00) / 588)]);
const squash = (s) => s.toLowerCase().replace(/\s+/g, '');
const TOWER = '<svg viewBox="-12 -12 24 24"><path d="M-9 9V-5h6V9M-2 9V-11h7V9M6 9V-2h4V9" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const MEDAL = { 1: ['동', '#c98a5c'], 2: ['은', '#9aa5b1'], 3: ['금', '#e2b33c'] };

// A tap by a second finger gets no click from the browser (clicks come from the first touch only). In fight mode
// the thumb rests on the joystick, so the weapon button, the picker and the menu would ignore the other finger:
// click them on such a tap ourselves, and drop a real click that might follow anyway.
{
  const TAPPABLE = 'button, label, input';
  const second = new Map(); // pointerId -> { el, x, y }
  let synth = null;
  addEventListener('pointerdown', (e) => {
    if (e.isPrimary || e.pointerType !== 'touch') return;
    const el = e.target.closest && e.target.closest(TAPPABLE);
    if (el) second.set(e.pointerId, { el, x: e.clientX, y: e.clientY });
  }, true);
  addEventListener('pointerup', (e) => {
    const s = second.get(e.pointerId); if (!s) return;
    second.delete(e.pointerId);
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 14) return; // a drag, not a tap
    const at = document.elementFromPoint(e.clientX, e.clientY);
    if (!at || !s.el.contains(at)) return;
    synth = { el: s.el, t: performance.now() };
    s.el.click();
  }, true);
  addEventListener('pointercancel', (e) => second.delete(e.pointerId), true);
  addEventListener('click', (e) => {
    if (!e.isTrusted || !synth || performance.now() - synth.t > 600 || !synth.el.contains(e.target)) return;
    e.stopPropagation(); e.preventDefault(); synth = null;
  }, true);
}

export function initToyUI(api) {
  const { world, Score, Rank, Emblem, W, Replay, run, fmtT, toast, resetWorld, setPaused, shareText, COARSE, isMuted, cycleView, toggleSound, openEmblems, openVeil, openSheet, saveClip, Fight, setFight } = api;
  const tap = COARSE ? '탭' : '클릭';
  // the drag weapons use one finger (left button) themselves: the view turns with two fingers (right drag)
  const turn = COARSE ? '두 손가락: 회전' : '오른쪽 끌기: 회전';
  // one line per weapon, shown for a moment when it is picked
  const HINT = {
    mg: `누르고 있기: 연사 · 끌며 조준 · ${turn}`, hammer: `${tap}: 망치로 내려치기`, bomb: `${tap}: 폭탄 던지기`, missile: `${tap}: 미사일 3발`,
    laser: `그어서 레이저로 자르기 · ${turn}`, meteor: `${tap}: 운석 떨어뜨리기`, nuke: `${tap}: 핵폭탄 (기록에서 빠져요)`, sword: `그어서 베기 · ${tap}: 연속 베기 · ${turn}`,
  };
  for (const [k, v] of Object.entries(HINT)) if (W.TOOLS[k]) W.TOOLS[k].hint = v;

  // ---------------------------------------------------------------- top bar
  const top = el('div'); top.id = 'toyTop';
  const menuBtn = el('button'); menuBtn.id = 'toyMenuBtn'; menuBtn.setAttribute('aria-label', '메뉴');
  menuBtn.appendChild(svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6v12M15 6v12"/></svg>'));
  const meter = $('meter'), timer = $('timer'), score = $('score');
  meter.querySelector('.row').appendChild(timer); // time sits beside the percentage
  top.append(menuBtn, meter, score);
  document.body.appendChild(top);

  // ---------------------------------------------------------------- weapon: one button, a picker sheet
  // the row of every weapon grew with each new one: now the current weapon sits under the thumb, and a tap
  // opens the whole set (the world waits while you choose)
  const DESC = {
    mg: '누르는 동안 연사', hammer: '찍은 곳 내려치기', bomb: '던지면 잠시 뒤 펑', missile: '한 번에 3발',
    laser: '그은 선대로 절단', meteor: '반경 40 m 초토화', nuke: '전부 날리기 · 기록 제외', sword: '그어서 베기 · 검기',
  };
  const dock = $('dock');
  for (const b of dock.querySelectorAll('.tool')) b.appendChild(el('small', 'desc', DESC[b.dataset.tool] || ''));
  const wbtn = el('button'); wbtn.id = 'toyWeapon'; wbtn.setAttribute('aria-label', '무기 바꾸기');
  const wIcon = el('span', 'ic'), wName = el('b'), wText = el('span', 'tx');
  wText.append(wName, el('small', null, '무기 바꾸기'));
  wbtn.append(wIcon, wText, svg('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>'));
  document.body.appendChild(wbtn);
  const pick = el('div'); pick.id = 'toyPick';
  const pSheet = el('div', 'sheet'), pHd = el('div', 'hd');
  pHd.appendChild(el('h2', null, '무기 고르기'));
  pSheet.append(pHd, dock); pick.appendChild(pSheet); document.body.appendChild(pick);
  const openPick = () => { pick.classList.add('show'); setPaused(true); };
  const closePick = () => { if (!pick.classList.contains('show')) return; pick.classList.remove('show'); setPaused(false); };
  wbtn.addEventListener('click', (e) => { e.stopPropagation(); openPick(); });
  pick.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === pick) closePick(); });

  // ---------------------------------------------------------------- hint: a moment, then gone
  let hintT = 0;
  const hintShown = () => { clearTimeout(hintT); hintT = setTimeout(() => { $('hint').style.opacity = 0; }, 2200); };
  const showHint = () => { $('hint').style.opacity = 1; hintShown(); };

  // ---------------------------------------------------------------- pause menu
  const menu = el('div'); menu.id = 'toyMenu';
  const sheet = el('div', 'sheet');
  const mh = el('div', 'hd'); mh.append(el('small', null, world.MAP.title), el('h2', null, '일시정지'));
  const resume = el('button', 'primary', '계속하기');
  const grid = el('div', 'grid');
  const item = (label, icon, fn) => { const b = el('button', 'item'); b.append(svg(icon), el('span', null, label)); b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); }); grid.appendChild(b); return b; };
  const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  item('다시 하기', I('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/>'), () => { close(); resetWorld(); });
  item('시점 바꾸기', I('<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3"/>'), () => { close(); cycleView(); });
  const sound = item('', '', () => { toggleSound(); paintSound(); });
  const paintSound = () => {
    const m = isMuted();
    sound.replaceChildren(svg(I(m ? '<path d="M5 9v6h4l5 4V5L9 9z"/><path d="M17 9l4 6M21 9l-4 6"/>' : '<path d="M5 9v6h4l5 4V5L9 9z"/><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11"/>')), el('span', null, m ? '소리 켜기' : '소리 끄기'));
  };
  item('엠블럼', I('<path d="M12 3l7 4v10l-7 4-7-4V7z"/><path d="M12 8l1.5 3 3 .4-2.2 2 .6 3-2.9-1.5-2.9 1.5.6-3-2.2-2 3-.4z"/>'), () => { close(); openEmblems(); });
  item('회사 파괴 랭킹', I('<path d="M5 20V10M12 20V4M19 20v-7"/>'), () => { close(); openSheet('rank'); });
  item('스테이지 고르기', I('<path d="M4 20V9l5-3v14M9 20V4h7v16M16 20V10h4v10"/>'), () => { close(); openVeil(); });
  sheet.append(mh, resume, grid);
  menu.appendChild(sheet);
  document.body.appendChild(menu);
  const open = () => { paintSound(); menu.classList.add('show'); setPaused(true); };
  function close() { menu.classList.remove('show'); setPaused(false); }
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); open(); });
  resume.addEventListener('click', (e) => { e.stopPropagation(); close(); });
  menu.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === menu) close(); });

  // ---------------------------------------------------------------- home: stage cards
  const home = el('div'); home.id = 'toyHome';
  const hh = el('header');
  const brand = el('div', 'tt'); brand.append(el('small', null, '미니어처 건물 부수기'), el('h1', null, '회사부수기'));
  const best = el('div', 'best'); best.append(el('small', null, '최고 피해액'), el('b', null, Score.won(Score.state.best)));
  hh.append(brand, best);
  const bar = el('div', 'bar');
  const count = el('span', 'n'); const bh = el('h2', null, '스테이지 '); bh.appendChild(count); bar.appendChild(bh);
  const seg = el('div', 'seg');
  const sortRec = el('button', 'on', '추천순'), sortMost = el('button', null, '많이 부서진 순');
  seg.append(sortRec, sortMost); bar.appendChild(seg);
  // find a stage by name, or let the dice pick one
  const find = el('div', 'find');
  const qBox = el('label', 'q'), q = el('input');
  q.type = 'search'; q.placeholder = '이름·지역으로 찾기'; q.enterKeyHint = 'search'; q.autocomplete = 'off'; q.spellcheck = false;
  qBox.append(svg(SEARCH), q);
  const rnd = el('button', 'rnd'); rnd.append(svg(DICE), document.createTextNode('랜덤'));
  find.append(qBox, rnd);
  const cards = el('div', 'cards');
  const foot = el('div', 'foot');
  const links = el('div', 'links');
  for (const [label, fn] of [['조작법', () => openSheet('howto')], ['회사 파괴 랭킹', () => openSheet('rank')], ['엠블럼', openEmblems]]) {
    const b = el('button', null, label); b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); links.appendChild(b);
  }
  // fight mode (experimental): the buildings throw things back; it sticks to the address so stage changes keep it
  const mode = el('label', 'mode');
  const mTx = el('span', 'mt'); mTx.append(el('b', null, '⚔️ 반격 모드'), el('em', null, '실험'), el('small', null, '건물이 던지는 걸 피하면서 부수기'));
  const mSw = el('input'); mSw.type = 'checkbox'; mSw.className = 'sw'; mSw.checked = Fight.state.on;
  mode.append(mTx, mSw);
  mSw.addEventListener('change', () => {
    const qs = new URLSearchParams(location.search);
    if (mSw.checked) qs.set('mode', 'fight'); else qs.delete('mode');
    history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : ''));
    setFight(mSw.checked);
    toast(mSw.checked ? '반격 모드: 조이스틱으로 피하세요' : '일반 모드');
  });
  mode.addEventListener('click', (e) => e.stopPropagation());
  foot.append(mode, links, $('startBtn')); // the start button keeps its loading state and handler
  home.append(hh, bar, find, cards, foot);
  $('veil').appendChild(home);

  const hue = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  let hits = {}, sort = 'rec', query = '';
  // what a search looks at: the stage's name first, then its areas, keywords and the companies nearby;
  // initials ('ㅅㅅ') only match the name
  const hay = new Map(world.MAPS.map((m) => {
    // the shown (twisted) name and the real one both count as the name: '삼성' finds '삼송전자'
    const r = m.real || {};
    const name = squash([m.title, m.short, r.title, r.short].filter(Boolean).join(' '));
    return [m.id, { name, all: squash([name, m.sub, r.sub, m.kw, ...(m.near || [])].filter(Boolean).join(' ')), ini: initials(name) }];
  }));
  /** 0: the name starts with it, 1: the name has it, 2: something else about the stage has it, -1: no match */
  const rank = (m) => {
    if (!query) return 0;
    const h = hay.get(m.id);
    if (/^[ㄱ-ㅎ]+$/.test(query)) return h.ini.startsWith(query) ? 0 : h.ini.includes(query) ? 1 : -1;
    return h.name.startsWith(query) ? 0 : h.name.includes(query) ? 1 : h.all.includes(query) ? 2 : -1;
  };
  const matches = (m) => rank(m) >= 0;
  const goMap = (id) => { const qs = new URLSearchParams(location.search); qs.set('map', id); qs.set('go', '1'); location.search = qs.toString(); };
  function renderCards() {
    const own = Emblem.owned();
    const list = world.MAPS.filter(matches);
    if (sort === 'most') list.sort((a, b) => (hits[b.id] || 0) - (hits[a.id] || 0));
    else if (query) list.sort((a, b) => rank(a) - rank(b)); // best matches first (stable: the usual order within)
    cards.textContent = '';
    count.textContent = query ? `${list.length} / ${world.MAPS.length}` : String(world.MAPS.length);
    if (!list.length) cards.appendChild(el('div', 'empty', `'${q.value.trim()}'에 맞는 스테이지가 없어요`));
    for (const m of list) {
      const b = el('button', 'sc' + (m.id === world.MAP.id ? ' on' : '')); b.dataset.id = m.id;
      const th = el('span', 'th'); th.style.setProperty('--h', hue(m.id)); th.appendChild(svg(TOWER));
      const tx = el('span', 'tx');
      tx.append(el('b', null, m.title), el('small', null, m.sub || ''));
      const meta = el('span', 'meta');
      const tier = own['map_' + m.id] ? own['map_' + m.id].tier : 0;
      if (tier) { const md = el('i', 'medal', MEDAL[tier][0]); md.style.setProperty('--c', MEDAL[tier][1]); meta.appendChild(md); }
      const bt = Rank.localBest(m.id);
      meta.appendChild(el('span', null, bt ? '최고 ' + fmtT(bt.ms / 1000) : '기록 없음'));
      if (hits[m.id]) meta.appendChild(el('span', 'dmg', '누적 ' + Score.won(hits[m.id])));
      tx.appendChild(meta);
      b.append(th, tx);
      if (m.id === world.MAP.id) b.appendChild(el('em', 'cur', '선택됨'));
      b.addEventListener('click', (e) => { e.stopPropagation(); if (m.id === world.MAP.id) { if (!$('startBtn').disabled) $('startBtn').click(); } else goMap(m.id); });
      cards.appendChild(b);
    }
  }
  const setSort = (s) => { sort = s; sortRec.classList.toggle('on', s === 'rec'); sortMost.classList.toggle('on', s === 'most'); renderCards(); };
  sortRec.addEventListener('click', (e) => { e.stopPropagation(); setSort('rec'); });
  sortMost.addEventListener('click', (e) => { e.stopPropagation(); setSort('most'); });
  q.addEventListener('input', () => { query = squash(q.value); renderCards(); cards.scrollTop = 0; });
  q.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') q.blur(); if (e.key === 'Escape') { q.value = ''; query = ''; renderCards(); q.blur(); } });
  // the dice: any stage but this one (among the search results when there is a search), shown, then loaded
  rnd.addEventListener('click', (e) => {
    e.stopPropagation();
    if (rnd.disabled) return;
    let pool = world.MAPS.filter((m) => matches(m) && m.id !== world.MAP.id);
    if (!pool.length) pool = world.MAPS.filter((m) => m.id !== world.MAP.id);
    if (!pool.length) return;
    const m = pool[Math.floor(Math.random() * pool.length)];
    rnd.disabled = true;
    let card = cards.querySelector(`.sc[data-id="${m.id}"]`);
    if (!card) { q.value = ''; query = ''; renderCards(); card = cards.querySelector(`.sc[data-id="${m.id}"]`); }
    cards.querySelectorAll('.sc.on').forEach((c) => c.classList.remove('on'));
    card.classList.add('on', 'pick'); card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => goMap(m.id), 650);
  });
  async function loadHits() {
    const { rows } = await Rank.hits();
    hits = {};
    for (const r of rows) { const m = world.MAPS.find((x) => x.id === r.map || x.id.replace(/[^a-zA-Z0-9]/g, '_') === r.key); if (m) hits[m.id] = (hits[m.id] || 0) + (r.dmg || 0); }
    renderCards();
  }
  // the stage that is loaded is the one to start: bring its card into view
  const showCurrent = () => { const on = cards.querySelector('.sc.on'); if (on) on.scrollIntoView({ block: 'center' }); };
  renderCards(); requestAnimationFrame(showCurrent); loadHits().then(showCurrent);
  // coming back to the home screen: fresh numbers, the current stage in view
  new MutationObserver(() => {
    if ($('veil').classList.contains('hide')) return;
    best.lastChild.textContent = Score.won(Score.state.best);
    loadHits().then(showCurrent);
  }).observe($('veil'), { attributes: true, attributeFilter: ['class'] });
  $('startBtn').addEventListener('click', () => setTimeout(showHint, 350));

  // ---------------------------------------------------------------- result
  const res = el('div'); res.id = 'toyResult';
  const rs = el('div', 'sheet');
  const rHd = el('div', 'hd'); const rStage = el('small'), rTitle = el('h2');
  rHd.append(rStage, rTitle);
  const rTimeRow = el('div', 'timerow'); const rTime = el('div', 'time'), rMedal = el('i', 'medal'), rNew = el('em', 'new', '신기록');
  rTimeRow.append(rTime, rMedal, rNew);
  const rStats = el('div', 'stats');
  const stat = (label) => { const d = el('div'); const b = el('b'); d.append(el('small', null, label), b); rStats.appendChild(d); return b; };
  const sDmg = stat('피해액'), sRank = stat('직급'), sBest = stat('내 최고 기록');
  const rHl = el('div', 'hl'); const hlT = el('small', null, '이 회사에 쌓인 누적 피해'), hlV = el('b'), hlS = el('span');
  rHl.append(hlT, hlV, hlS);
  const rVideo = el('video'); rVideo.muted = true; rVideo.loop = true; rVideo.playsInline = true; rVideo.setAttribute('playsinline', '');
  const rClip = el('button', 'ghost small', '붕괴 영상 저장');
  const again = el('button', 'primary', '다시 하기');
  const row = el('div', 'row'); const next = el('button', null, '다음 스테이지'), share = el('button', null, '결과 공유'); row.append(next, share);
  const keep = el('button', 'ghost', '계속 부수기');
  rs.append(rHd, rTimeRow, rStats, rHl, rVideo, rClip, again, row, keep);
  res.appendChild(rs); document.body.appendChild(res);
  const hideResult = () => { res.classList.remove('show'); rVideo.pause(); };
  res.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === res) hideResult(); });
  keep.addEventListener('click', (e) => { e.stopPropagation(); hideResult(); });
  again.addEventListener('click', (e) => { e.stopPropagation(); hideResult(); resetWorld(); });
  next.addEventListener('click', (e) => { e.stopPropagation(); const i = world.MAPS.findIndex((m) => m.id === world.MAP.id); goMap(world.MAPS[(i + 1) % world.MAPS.length].id); });
  share.addEventListener('click', async (e) => {
    e.stopPropagation();
    const text = shareText();
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (err) { if (err && err.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('결과를 복사했어요'); } catch (err) { /* nothing to copy with */ }
  });
  rClip.addEventListener('click', (e) => { e.stopPropagation(); saveClip(); });
  const paintClip = () => {
    const c = Replay.latest();
    rVideo.style.display = c && run.done ? 'block' : 'none'; rClip.style.display = c && run.done ? '' : 'none';
    if (c && run.done) { if (rVideo.src !== c.url) rVideo.src = c.url; if (res.classList.contains('show')) rVideo.play().catch(() => {}); }
  };
  Replay.onClip(paintClip);

  let prevBest = null, newBest = false;
  /** a finished run (no nuke): keep the best time on this device, remember whether it is a new one */
  function onComplete() {
    prevBest = Rank.localBest(world.MAP.id);
    newBest = !run.nuke && !run.fight && (!prevBest || run.t * 1000 < prevBest.ms);
    if (!run.nuke && !run.fight) Rank.saveLocalBest({ map: world.MAP.id, ms: run.t * 1000, dmg: Score.state.score, shots: run.shots });
  }
  async function showResult() {
    const done = run.done;
    rStage.textContent = world.MAP.title + (run.fight ? ' · ⚔️ 반격 모드' : '');
    rTitle.textContent = run.failed ? '쓰러졌어요' : done ? (run.nuke ? '완파! (핵 사용)' : '완파!') : '지금까지 기록';
    rTime.textContent = fmtT(run.t);
    const tier = done && !run.nuke && !run.fight ? (run.t <= Emblem.LIMIT.gold ? 3 : run.t <= Emblem.LIMIT.silver ? 2 : 1) : 0;
    rMedal.style.display = tier ? '' : 'none';
    if (tier) { rMedal.textContent = MEDAL[tier][0] + '메달'; rMedal.style.setProperty('--c', MEDAL[tier][1]); }
    rNew.style.display = done && newBest ? '' : 'none';
    sDmg.textContent = Score.won(Score.state.score);
    sRank.textContent = Score.rankInfo().id;
    const bt = Rank.localBest(world.MAP.id);
    sBest.previousSibling.textContent = run.failed ? '피한 공격' : run.fight ? '남은 체력' : '내 최고 기록';
    sBest.textContent = run.failed ? Fight.state.dodged + '개' : run.fight ? `❤ ${Fight.state.hp} / ${Fight.state.max}` : bt ? fmtT(bt.ms / 1000) : '—';
    hlV.textContent = '…'; hlS.textContent = '이번 판 +' + Score.won(Score.state.score);
    paintClip();
    res.classList.add('show');
    const { kind, rows } = await Rank.hits();
    const r = rows.find((x) => x.map === world.MAP.id || x.key === world.MAP.id.replace(/[^a-zA-Z0-9]/g, '_'));
    hlT.textContent = kind === 'online' ? '모두가 이 회사에 낸 누적 피해' : '내가 이 회사에 낸 누적 피해';
    hlV.textContent = Score.won(r ? r.dmg : Score.state.score);
  }

  return {
    onComplete, showResult,
    /** the weapon changed (picker, number key): show it on the button, close the picker, flash the hint */
    toolChanged(t) {
      const b = dock.querySelector(`.tool[data-tool="${t}"]`);
      if (b) { wIcon.replaceChildren(b.querySelector('svg').cloneNode(true)); wName.textContent = W.TOOLS[t] ? W.TOOLS[t].name : t; }
      closePick();
      hintShown();
    },
    /** the game loop is running: a stage picked from the home screen starts right away */
    ready() {
      const qs = new URLSearchParams(location.search);
      if (!qs.has('go')) return;
      qs.delete('go'); history.replaceState(null, '', location.pathname + '?' + qs.toString());
      $('startBtn').click();
    },
  };
}
