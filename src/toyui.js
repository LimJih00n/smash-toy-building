// Mobile UI for the toy style (?style=toy), portrait one-hand first:
//  - in play: one top bar (menu · target progress + time · title + damage) and the weapon row at
//    the thumb; everything else lives in the pause menu
//  - home: the stage cards and one start button (the web page's landing card is hidden)
//  - result: time, damage, title, what this run added to the stage's total, best time, next stage
// The HUD's live elements (#meter, #timer, #score) are updated by main.js; the top bar re-homes them.
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const svg = (s) => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstChild; };
const TOWER = '<svg viewBox="-12 -12 24 24"><path d="M-9 9V-5h6V9M-2 9V-11h7V9M6 9V-2h4V9" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const MEDAL = { 1: ['동', '#c98a5c'], 2: ['은', '#9aa5b1'], 3: ['금', '#e2b33c'] };

export function initToyUI(api) {
  const { world, Score, Rank, Emblem, W, Replay, run, fmtT, toast, resetWorld, setPaused, shareText, COARSE, isMuted, cycleView, toggleSound, openEmblems, openVeil, openSheet, saveClip } = api;
  const tap = COARSE ? '탭' : '클릭';
  // one line per weapon, shown for a moment when it is picked
  const HINT = {
    mg: '누르고 있기: 연사 · 끌며 조준', hammer: `${tap}: 망치로 내려치기`, bomb: `${tap}: 폭탄 던지기`, missile: `${tap}: 미사일 3발`,
    laser: '그어서 레이저로 자르기', meteor: `${tap}: 운석 떨어뜨리기`, nuke: `${tap}: 핵폭탄 (기록에서 빠져요)`, sword: `그어서 베기 · ${tap}: 연속 베기`,
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
  const bar = el('div', 'bar'); bar.appendChild(el('h2', null, '스테이지'));
  const seg = el('div', 'seg');
  const sortRec = el('button', 'on', '추천순'), sortMost = el('button', null, '많이 부서진 순');
  seg.append(sortRec, sortMost); bar.appendChild(seg);
  const cards = el('div', 'cards');
  const foot = el('div', 'foot');
  const links = el('div', 'links');
  for (const [label, fn] of [['조작법', () => openSheet('howto')], ['회사 파괴 랭킹', () => openSheet('rank')], ['엠블럼', openEmblems]]) {
    const b = el('button', null, label); b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); links.appendChild(b);
  }
  foot.append(links, $('startBtn')); // the start button keeps its loading state and handler
  home.append(hh, bar, cards, foot);
  $('veil').appendChild(home);

  const hue = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
  let hits = {}, sort = 'rec';
  const goMap = (id) => { const qs = new URLSearchParams(location.search); qs.set('map', id); qs.set('go', '1'); location.search = qs.toString(); };
  function renderCards() {
    const own = Emblem.owned();
    const list = [...world.MAPS];
    if (sort === 'most') list.sort((a, b) => (hits[b.id] || 0) - (hits[a.id] || 0));
    cards.textContent = '';
    for (const m of list) {
      const b = el('button', 'sc' + (m.id === world.MAP.id ? ' on' : ''));
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
    newBest = !run.nuke && (!prevBest || run.t * 1000 < prevBest.ms);
    if (!run.nuke) Rank.saveLocalBest({ map: world.MAP.id, ms: run.t * 1000, dmg: Score.state.score, shots: run.shots });
  }
  async function showResult() {
    const done = run.done;
    rStage.textContent = world.MAP.title;
    rTitle.textContent = done ? (run.nuke ? '완파! (핵 사용)' : '완파!') : '지금까지 기록';
    rTime.textContent = fmtT(run.t);
    const tier = done && !run.nuke ? (run.t <= Emblem.LIMIT.gold ? 3 : run.t <= Emblem.LIMIT.silver ? 2 : 1) : 0;
    rMedal.style.display = tier ? '' : 'none';
    if (tier) { rMedal.textContent = MEDAL[tier][0] + '메달'; rMedal.style.setProperty('--c', MEDAL[tier][1]); }
    rNew.style.display = done && newBest ? '' : 'none';
    sDmg.textContent = Score.won(Score.state.score);
    sRank.textContent = Score.rankInfo().id;
    const bt = Rank.localBest(world.MAP.id);
    sBest.textContent = bt ? fmtT(bt.ms / 1000) : '—';
    hlV.textContent = '…'; hlS.textContent = '이번 판 +' + Score.won(Score.state.score);
    paintClip();
    res.classList.add('show');
    const { kind, rows } = await Rank.hits();
    const r = rows.find((x) => x.map === world.MAP.id || x.key === world.MAP.id.replace(/[^a-zA-Z0-9]/g, '_'));
    hlT.textContent = kind === 'online' ? '모두가 이 회사에 낸 누적 피해' : '내가 이 회사에 낸 누적 피해';
    hlV.textContent = Score.won(r ? r.dmg : Score.state.score);
  }

  return {
    hintShown, onComplete, showResult,
    /** the game loop is running: a stage picked from the home screen starts right away */
    ready() {
      const qs = new URLSearchParams(location.search);
      if (!qs.has('go')) return;
      qs.delete('go'); history.replaceState(null, '', location.pathname + '?' + qs.toString());
      $('startBtn').click();
    },
  };
}
