// What the player sees: company and building names lightly twisted ('삼성전자' -> '삼송전자').
// The data keeps the real names, and so does search: typing '삼성' still finds '삼송전자'.
// Public places (서울역, 인천공항, 강북구청, area and street names) stay as they are.
// Each twist has to sound different too (롯떼, 실라 = how 신라 is said, 아모래 would read the same).
// Longer words first, so a word inside another is not swapped twice.
const SWAP = [
  ['한전케이피에스', '한전케이피지'], ['한전KPS', '한전KPZ'],
  ['경복궁면세점', '경봉궁면세점'], ['대성디폴리스', '대송디폴리스'], ['한국클라우드', '한국클라우디'],
  ['우림이비즈센터', '우람이비즈센터'], ['그린팩토리', '블루팩토리'], ['아모레퍼시픽', '아모르퍼시픽'],
  ['코스타타워', '코스모타워'], ['용신빌딩', '용심빌딩'], ['이스트폴', '이스트풀'], ['에비뉴엘', '에비뉴엠'],
  ['신신호텔', '싱싱호텔'], ['대한항공', '대환항공'], ['아시아나', '아시아노'],
  ['신세계', '신세기'], ['메리츠', '메리추'], ['이마트', '이마또'], ['에스원', '에스윈'],
  ['하이브', '바이브'], ['네이버', '네이비'], ['카카오', '카카포'], ['포스코', '포수코'], ['갤럭시', '은하'],
  ['삼성', '삼송'], ['쿠팡', '쿠빵'], ['신라', '신나'], ['롯데', '롯또'], ['현대', '현다이'], ['기아', '기와'], ['한화', '한파'],
  ['AIA', 'AYA'], ['KTS', 'KTZ'], ['KG', 'KJ'], ['LG', '엘쥐'], ['SK', 'ZK'],
];

export function parody(s) {
  if (!s) return s;
  for (const [a, b] of SWAP) if (s.includes(a)) s = s.split(a).join(b);
  return s;
}
