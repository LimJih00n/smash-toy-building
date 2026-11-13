// Site-level links shown on the start screen (empty = hidden). Fill these in, rebuild, push.
// No ads or pop-ups during play: these only appear on the start screen and the result card.
export const SITE = {
  donate: {
    toss: '',   // (토스아이디 서비스 종료)
    kakao: '',  // https://qr.kakaopay.com/<코드>
    bmc: 'https://buymeacoffee.com/smashtheworld',
  },
  email: 'companysmash.help@gmail.com',
};

export function renderSupport(el) {
  if (!el) return;
  el.textContent = '';
  const links = [['toss', '토스로 후원'], ['kakao', '카카오페이로 후원'], ['bmc', 'Buy Me a Coffee']].filter(([k]) => SITE.donate[k]);
  if (!links.length && !SITE.email) { el.style.display = 'none'; return; }
  el.style.display = '';
  if (links.length) {
    const row = document.createElement('div'); row.className = 'sup-row';
    const t = document.createElement('span'); t.className = 'sup-t'; t.textContent = '☕ 재밌게 즐기셨다면';
    row.appendChild(t);
    for (const [k, label] of links) {
      const a = document.createElement('a'); a.href = SITE.donate[k]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = label; a.className = 'sup-a';
      a.addEventListener('click', (e) => e.stopPropagation());
      row.appendChild(a);
    }
    el.appendChild(row);
  }
  if (SITE.email) {
    const row = document.createElement('div'); row.className = 'sup-row';
    const t = document.createElement('span'); t.className = 'sup-t'; t.textContent = '📮 맵 제보·문의';
    const a = document.createElement('a'); a.href = 'mailto:' + SITE.email + '?subject=' + encodeURIComponent('[회사 때려부수기] 맵 제보/문의'); a.textContent = SITE.email; a.className = 'sup-a';
    a.addEventListener('click', (e) => e.stopPropagation());
    const n = document.createElement('div'); n.className = 'sup-n'; n.textContent = '건물 제보는 공공장소에서 직접 찍은 외관 사진만 받아요. 회사 내부 사진은 보내지 마세요.';
    row.append(t, a); el.append(row, n);
  }
}
