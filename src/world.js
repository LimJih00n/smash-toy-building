// World layout: R5 research-campus motif (twin 27-storey glass towers on a white stone
// podium) plus streets and surrounding offices. Units are metres; +z points south (toward the
// main street the reference photo was taken from), +x east.
import * as THREE from 'three';
import * as terrain from './terrain.js';
import { Building } from './structure.js';
import { K } from './blocks.js';
import { mulberry } from './util.js';
import * as mapgen from './mapgen.js';

// which map is loaded (data/maps/<id>.json). The old hand-built 'r5' photo map was retired on
// 2026-10-28: R5 lives on, rebuilt from street view, inside the digital city map ('r5' links land there).
export const MAP = { id: 'suwon-core', doc: null, title: '삼성전자 수원 디지털시티' };
export const MAPS = [
  { id: 'suwon-core', short: '디지털시티', title: '삼성전자 수원 디지털시티', sub: 'R3 정보통신연구소 · R4 디지털연구소 · R5 모바일연구소', kw: '삼성 삼성전자 samsung 수원 디지털시티 r3 r4 r5 정보통신연구소 디지털연구소 모바일연구소 매탄' },
  { id: 'cpg-dongtan1', short: '동탄1센터', title: '쿠팡 동탄1센터', sub: '물류센터 · 화성 동탄', kw: '쿠팡 coupang 풀필먼트 cfs 물류센터 화성 동탄' },
  { id: 'cpg-goyang', short: '고양센터', title: '쿠팡 고양센터', sub: '물류센터 · 고양 덕양', kw: '쿠팡 coupang 풀필먼트 cfs 물류센터 고양 덕양' },
  // nearby companies inside the same map (Kakao map labels, 2026-10-28): searchable by name, shown as plain text only
  { id: 'office-meritz', short: '서울역·숭례문', title: '서울역·숭례문 권역 (순화동·봉래동)', sub: '메리츠화재 · AIA생명 · 이마트 · 에스원 본사 사옥 외',
    near: ['메리츠화재 봉래동사옥', 'AIA생명 (AIA타워)', '이마트 본사 (오렌지센터)', '에스원 본사 (삼성생명에스원빌딩)', 'HSBC빌딩', 'OK저축은행 영업부', '신한은행 본점', '한국산업안전보건공단 서울광역본부', '한국노인인력개발원 서울지역본부', '연세봉래빌딩', '서울상공회의소', '라마다호텔앤스위트 서울남대문'],
    kw: '메리츠 메리츠화재 meritz 손해보험 보험 봉래동 순화동 칠패로 서울역 숭례문 남대문 중구 aia aia생명 aia타워 이마트 emart 이마트타워 오렌지센터 에스원 s1 세콤 삼성생명 hsbc 상공회의소 ok저축은행 오케이저축은행 신한은행 신한은행본점 산업안전보건공단 노인인력개발원 연세대 라마다' },
  { id: 'hotel-shilla', short: '서울신라호텔', title: '호텔신라 본사 (서울신라호텔)', sub: '서울신라호텔 · 신라면세점 서울점 · 장충동', kw: '호텔신라 신라호텔 서울신라호텔 신라면세점 shilla 호텔 면세점 장충동 동호로 남산 중구' },
  { id: 'dfs-incheon', short: '인천공항 면세물류', title: '인천공항 자유무역지역 면세점 통합물류단지', sub: '신라면세점 · 롯데면세점 · 신세계면세점 · 경복궁면세점 제2통합물류센터 외',
    near: ['신라면세점 제2통합물류센터', '롯데면세점 제2통합물류센터', '신세계면세점 제2통합물류센터', '경복궁면세점 제2통합물류센터', '한국면세점협회 제2통합물류창고', '롯데글로벌로지스 인천공항물류센터', '엘엑스판토스 특송물류센터'],
    kw: '신라면세점 호텔신라 신라 면세점 물류센터 통합물류센터 인천공항 영종도 자유무역지역 공항물류단지 롯데면세점 신세계면세점 경복궁면세점 면세점협회 롯데글로벌로지스 판토스 운서동' },
  { id: 'skhynix-icheon', short: 'SK하이닉스 이천', title: 'SK하이닉스 이천캠퍼스', sub: 'M16 · R&D센터 · 본관 · 경기 이천 부발읍',
    near: ['SK하이닉스 M16', 'SK하이닉스 이천캠퍼스 R&D센터', 'SK하이닉스 본관', 'SK하이닉스 M14'],
    kw: 'sk하이닉스 하이닉스 sk hynix skhynix 에스케이하이닉스 sk 반도체 메모리 d램 디램 m16 m14 m10 팹 fab 이천 부발 부발읍 아미리 경충대로 이천캠퍼스 본사' },
  { id: 'samsung-seocho', short: '삼성 서초사옥', title: '삼성 서초사옥 (강남역)', sub: '삼성전자 서초사옥 · 삼성생명 · 삼성화재 서초타워',
    near: ['삼성전자 서초사옥', '삼성생명 서초타워', '삼성화재 서초타워', '동양화재 신사옥'],
    kw: '삼성 삼성전자 samsung 서초사옥 삼성타운 삼성생명 삼성화재 서초타워 강남역 강남 서초동 서초대로 강남대로 본사' },
  { id: 'lg-twin', short: 'LG 트윈타워', title: 'LG 트윈타워 (여의도)', sub: 'LG 본사 · 서관 · 동관 · 여의도 한강변',
    near: ['LG 트윈타워 서관', 'LG 트윈타워 동관', 'LG전자', 'LG화학', 'LG유플러스'],
    kw: 'lg 엘지 lg그룹 엘지그룹 lg전자 엘지전자 lg화학 lg유플러스 트윈타워 쌍둥이빌딩 여의도 여의대로 영등포 본사 lg디스플레이' },
  { id: 'hyundai-yangjae', short: '현대차 양재', title: '현대자동차·기아 양재 사옥', sub: '현대자동차 · 기아 본사 쌍둥이 타워 · 서초 양재동',
    near: ['현대자동차 양재 사옥', '기아 양재 사옥', '한국소비자원', 'aT센터'],
    kw: '현대 현대자동차 현대차 hyundai 기아 기아차 kia 양재 양재동 헌릉로 본사 사옥 쌍둥이 트윈 서초' },
  { id: 'lotte-tower', short: '롯데월드타워', title: '롯데월드타워 (잠실)', sub: '롯데월드타워 · 롯데월드몰 · 에비뉴엘 · 송파 잠실',
    near: ['롯데월드타워', '롯데월드몰', '롯데백화점 에비뉴엘 월드타워점', '롯데지주', '롯데물산'],
    kw: '롯데 롯데그룹 lotte 롯데월드타워 롯데타워 월드타워 롯데월드몰 에비뉴엘 롯데지주 롯데물산 잠실 송파 석촌호수 올림픽로 123층 555m 본사' },
  { id: 'cpg-eastpole', short: '쿠팡 본사', title: '쿠팡 본사 (구의 이스트폴타워)', sub: '쿠팡 신사옥 · 이스트폴 · 광진구 구의역',
    near: ['쿠팡 본사 (이스트폴타워)', '풀만 앰배서더 서울 이스트폴', 'NC이스트폴', '광진구청', '롯데캐슬 이스트폴'],
    kw: '쿠팡 coupang 쿠팡본사 쿠팡 본사 쿠팡 신사옥 이스트폴 이스트폴타워 구의역 구의 자양동 광진구 아차산로 광진구청 풀만 앰배서더 nc이스트폴 롯데캐슬' },
  { id: 'sk-seorin', short: 'SK 서린빌딩', title: 'SK 서린빌딩 (SK그룹 본사)', sub: 'SK그룹 · SK이노베이션 · 종로 청계천',
    near: ['SK 서린빌딩 (SK그룹 본사)', '종로타워', '서울파이낸스센터', '동아일보미디어센터', 'K스퀘어 시티'],
    kw: 'sk sk그룹 에스케이 sk이노베이션 sk에너지 sk본사 서린빌딩 서린사옥 서린동 종로 청계천 광화문 종각 본사' },
  { id: 'amore-yongsan', short: '아모레퍼시픽', title: '아모레퍼시픽 본사 (용산)', sub: '아모레퍼시픽 · 용산 한강대로 · 신용산역',
    near: ['아모레퍼시픽 본사', 'LS용산타워', '아스테리움 용산', '용산 시티파크'],
    kw: '아모레 아모레퍼시픽 amorepacific 아모레퍼시픽그룹 화장품 설화수 이니스프리 용산 신용산 한강대로 한강로 큐브 본사 사옥' },
  { id: 'posco-center', short: '포스코센터', title: '포스코센터 (강남 테헤란로)', sub: '포스코홀딩스 서울 사무소 · 서관 · 동관 · 대치동',
    near: ['포스코센터', 'DB금융센터', '현대타워', '파르나스 호텔'],
    kw: '포스코 posco 포스코센터 포스코홀딩스 포스코인터내셔널 포스코그룹 철강 테헤란로 대치동 선릉 삼성로 강남 본사 사옥' },
  { id: 'shinshin-cheonjiyeon', short: '신신호텔 천지연', title: '신신호텔 천지연 (제주 서귀포)', sub: '신신호텔 천지연점 · 서귀포 서귀동 · 천지연폭포 근처',
    near: ['신신호텔 천지연', '비스타케이호텔(천지연)', '서귀포 가족호텔'],
    kw: '신신호텔 신신 호텔 천지연 천지연점 제주 제주도 서귀포 서귀동 서문로 천지연폭포' },
  { id: 'hybe-yongsan', short: '하이브', title: '하이브 사옥 (용산)', sub: '하이브 · 용산 한강대로 · 신용산역',
    near: ['하이브 사옥', '엘지유플러스용산사옥', '디케이밸리뷰용산'],
    kw: '하이브 hybe 빅히트 bighit 용산 사옥 본사 한강대로 42 용산트레이드센터 신용산역 bts 방탄소년단 세븐틴 뉴진스 르세라핌 엔터' },
  { id: 'hanwha-janggyo', short: '한화빌딩', title: '한화빌딩 (장교동)', sub: '한화그룹 본사 · 중구 청계천로 · 을지로',
    near: ['한화빌딩', '미래에셋 센터원', '서울지방고용노동청'],
    kw: '한화 hanwha 한화그룹 본사 장교동 한화빌딩 청계천로 86 청계천 을지로 종각 한화생명 한화솔루션 한화에어로스페이스' },
  { id: 'gangbuk-office', short: '강북구청', title: '강북구청 일대 (수유역·임시청사)', sub: '용신빌딩·코스타타워 임시청사 · 옛 청사 자리는 신청사 공사 중',
    near: ['강북구청 임시청사 (용신빌딩)', '강북구청 임시청사 (코스타타워)'],
    kw: '강북구청 강북구 구청 수유 수유역 수유동 번동 도봉로 덕릉로 임시청사 용신빌딩 코스타타워 창강빌딩 신청사' },
  { id: 'kepco-kps', short: '한전KPS', title: '한전KPS 본사 (나주 빛가람)', sub: '한전케이피에스 · 나주 혁신도시 19층 사옥',
    near: ['한전KPS 본사'],
    kw: '한전kps 한전 kps 한전케이피에스 케이피에스 kepco kps 한국전력 나주 빛가람 혁신도시 전남 본사 사옥 공기업' },
  { id: 'pyeongtaek-p1', short: '삼성 평택캠퍼스', title: '삼성전자 평택캠퍼스 (P1)', sub: '반도체 1라인 · 길이 520m · 평택 고덕동',
    near: ['삼성전자 평택캠퍼스 P1'],
    kw: '삼성전자 삼성 평택 평택캠퍼스 평택사업장 평택공장 p1 1라인 반도체 메모리 d램 낸드 팹 fab 고덕 고덕동 삼성로 브레인시티' },
  { id: 'gumi-1', short: '삼성 구미사업장', title: '삼성전자 구미1사업장', sub: '갤럭시 스마트폰 생산기지 · 구미 1공단',
    near: ['삼성전자 구미1사업장'],
    kw: '삼성전자 삼성 구미 구미사업장 구미1사업장 구미공장 구미스마트시티 갤럭시 스마트폰 휴대폰 무선사업부 1공단 공단동 경북' },
  { id: 'koreanair-hq', short: '대한항공 본사', title: '대한항공 본사 (김포 공항동)', sub: '본사 사옥 · 정비 격납고 · 강서구 하늘길',
    near: ['대한항공 본사'],
    kw: '대한항공 korean air koreanair 칼 kal 한진 한진그룹 항공사 본사 사옥 김포 김포공항 공항동 하늘길 강서구 격납고' },
  { id: 'asiana-hq', short: '아시아나 본사', title: '아시아나항공 본사 (아시아나타운)', sub: '본관 · 운항동 · IT동 · 강서구 오쇠동',
    near: ['아시아나항공 본사'],
    kw: '아시아나 아시아나항공 asiana 항공사 본사 아시아나타운 오쇠동 오정로 김포 김포공항 강서구 금호' },
  { id: 'naver-1784', short: '네이버 본사', title: '네이버 본사 (그린팩토리·1784)', sub: '네이버 그린팩토리 28층 · 제2사옥 1784 · 분당 정자동',
    near: ['네이버 그린팩토리', '네이버 1784'],
    kw: '네이버 naver 네이버본사 그린팩토리 1784 제2사옥 분당 정자동 정자역 불정로 정자일로 성남 판교 본사 사옥 IT 포털' },
  { id: 'samsung-umyeon', short: '삼성리서치', title: '삼성리서치 (우면동 서울R&D캠퍼스)', sub: '삼성전자 서울R&D캠퍼스 · 서초구 우면동 성촌길',
    near: ['삼성리서치 (서울R&D캠퍼스)'],
    kw: '삼성리서치 삼성 리서치 samsung research 삼성전자 서울r&d캠퍼스 서울알앤디캠퍼스 r&d 연구소 우면 우면동 서초 양재 성촌길 태봉로 디자인센터' },
  { id: 'kg-munjeong', short: 'KG엔지니어링', title: 'KG엔지니어링 (문정동 KG타워)', sub: 'KG엔지니어링종합건축사사무소 사옥 · 송파구 문정동',
    near: ['KG엔지니어링 (KG타워)'],
    kw: 'kg엔지니어링 케이지엔지니어링 kg engineering 케이지 kg타워 케이지타워 종합건축사사무소 건축사사무소 엔지니어링 문정동 문정 법조단지 송파구 정의로 사옥 본사' },
  { id: 'seongsu-ebiz', short: '성수 우림이비즈센터', title: '성수동 우림이비즈센터 (지식산업센터)', sub: 'KTS엔지니어링 외 입주사 59곳 · 성동구 성수동2가',
    near: ['성수동 우림이비즈센터', 'KTS엔지니어링 (케이티에스엔지니어링)', '이씨오', '명인에스아이엔지니어링', '하이테크4치과기공소', '관세법인 선율', '아이브스', '건우기획', '서전문화재단', '삼우구조컨설턴트', '한국환경보전원 국가환경교육센터', '솔트앤초콜릿', '건우프린트', '에스알씨컴퍼니', '피닉스씨엠씨', '윤진어패럴', '아이넵', '토탈코인', '캠핑톡', '샤니코리아', '디노시스', '더에스지', '아이엔디', '엠앤제이문화복지재단', '동방하이테크상사', '정운건축사사무소', '캠핑톡 서울오피스/고객센터', '인핸스비', '흥광기획', '세인상공', '토스치과기공소', '글로벌에이원', 'T크로스', '성명인쇄', '벨로이', '서울씨엠', '비앤비', '하이테크 교정기공소 서울점', '일광건설', '바이오위더스', '주 I 선일상사', '코비토스', '다빈치치과기공소', '윤여홀', '브랜드창작공장', '에이아이플랜', '이로운건축사사무소', '브솔종합건축사사무소', '수남기업', '스타에스테이트', '아보다', '저스트인', '에스제이프로모션', '토탈파워콤', '비나제이', '피케이컴퍼니', '이노텍웨이브', '서영티이씨', '파워베스트', '실바톤어쿠스틱스', '가디우스'],
    kw: '성수 성수동 성수동2가 우림 우림이비즈센터 이비즈센터 e비즈센터 지식산업센터 성동구 광나루로 kts엔지니어링 케이티에스엔지니어링 케이티에스 엔지니어링' },
  { id: 'gasan-depolis', short: '가산 대성디폴리스', title: '가산동 대성디폴리스 (지식산업센터)', sub: '한국클라우드 외 입주사 428곳 · 금천구 가산디지털단지',
    near: ['가산 대성디폴리스', '한국클라우드', '오토오아시스 가산디지털단지점', '슈가맨워크 서울가산디지털단지역점', '로젠택배 남금천지점', '한국대학교육협의회', '로젠택배 북금천지점', '리바트오피스 웰스라움', '대아이앤씨', '퍼스트사무용가구', '숭실원격평생교육원', '한국캘랩', '더클락 창업센터', '대성씨앤에스', '시스템엘르 가산점', '한국페트라이트', '티앤제이오피스디자인', '아이컴시스', '내일날씨', '피피솔', '빅쏘코리아', '대성계전', '주영냉열시스템', '대성모터스', '위디자인', '엘에스웨어', '퍼스트웹21', '비온컴퍼니', '모댄', '티앤티아이', '엘레파츠', '화인석재', '다후아테크놀로지코리아', '이오에스코리아', '태원세무회계사무소', '에너지움', '연후공조에어컨', '컴퓨터서비스센터', '다올종합건축사사무소', '스터너즈', '엠팩토리', '한국정책자금지원센터', '노무법인 같이', '익제건설산업', '지엔', '펜트리', '피스티스에듀', '에스엠우일', '미래휴넷시스템', '아이티스톤', '성안테크 대성디폴리스 지점', '지앤제이커머스', '자원생활', '바른길특허법률사무소', '디엠텍', '모터하이', '올라이프', '법률사무소 한결 가산사무소', '비즈온스마트워크 가산센터', '텔몬', '에이블웍스', '유원이엔지테크', '지니온', '유원트로피', '유이즈소프트', '대성산업', '라벨공장', '일진플랜트엔지니어링', '컴퓨터수리', '대륜회계법인', '비오메이징스튜디오', '코피온', '웨이브파워', '플렉스엔지니어링', '데밀린', '바이올푸드글로벌', '쓰리에스텍', '킨스튜디오', '프리아몰', '도래샘 본사', '티엘그룹', '디에치앤컴퍼니', '맏앙', '한국온실가스검증협회', '건축사사무소간향', '한국경영품질연구소', '샤론델', '대성스팀', '룸제이', '피에스알코리아', '수봉산업', '유하엔지니어링', '헤이네이처', '글로벌이지스', '진성테크', '시글락', '더위즈', '동진건설산업개발', '지에프씨코리아', '포스텍코리아', '토마토명함', '푸드린', '미미상사', '우리차모빌리티', '유피모터', '네트디자인 본점', '노무법인마음', '정공아이이앤씨', '투어텍스리펀드', '와플이엔티', '윤민개발', '코리아베스트원', '램굴', '한국국방MICE연구원', '엘엠유통', '한국국방마이스연구원', '일조클럽 라운지 & 코워킹스페이스', '디케법무사사무소', '관세법인지오 구로사무소', '로얄로더', '뉴아시아일보', '아이만텍이엔지', '트레스칼코리아 한국캘랩', '씨디엔에이 법의학연구소', '아이리텍인크', '세무회계 승인', '뿌쥬아쥬얼리', '코드엠', '더라이즈대부', '세무법인혜움 SC점', '티에이치케이컴퍼니', '더보다매칭', '템피드', '에이씨지', 'LX지인시스템창 테크윈', '이츠와치', '가람아이티', '에스엔웨딩', '주식회사 레드플러스', '미피', '대용노무사사무소', '세림씨앤에어', '오디뮤직', '티에스인터내셔널', '더보다컴퍼니', '태영오피스', 'LX지인시스템창 SC테크윈', '닥터블랭크', '디폴리스 운영위원회', '디에스글로벌대부', '더스트헌터 서울남부지사', '크레파스', '지유엔시스템즈', '크로스보드인터내셔널', '아이에스트레이드', '한국협동조합 창업경영지원센터', '싸라기별', '태라베이스', '세무법인다솔 G밸리점', '동관중엔상무유한책임회사', '아크이엔에스', '선두과학사', '미성텍', '포시오', '성원이엔지', '컨비니랩스', '구니카 서울사무소', '쏠리밋', '시스템본', '마이클리닝', '티엘코리아', '데일리에프앤아이대부', '업츠', '지비인터렉티브', '서비스가든', '우리펫', '케이티지글로벌', '아트앤페어', '용사운드', '키소스', '투나이스', '알파라이프 화한무역', '푸르다컴퍼니', '프리키픽쳐스', '레이브잇', '르애드카누', '강남이시다이엔지', '어반포레스트', 'HR니즈법인', '네트컴시스템', '보다결혼정보', '난진', '하나에너지', '위드인스트루먼트', '서울엘엔에스금융컨설팅', '에이스파이브', '금도전자', '캐치일리', '맥스윈', '더한인관세사무소', '디올레드', '세무회계하다', '아이에스오에스컨설팅', '에코자원', '위더스아이티', '아이티브래인', '교통안전환경연구소', '고잉홈', '와이케이미디어', '윈텍', '아이리헬스', '아유비지', '현대종합계기', '울트라웨이브', '큐렉스아이엔씨', '마크원테크놀로지 서울지점', '인프라큐브', '레이랩', '파크엘즈 본사', '휴온컴퍼니', '모든세븐', '준이엔씨', '시소모기지파트너스', '컨펌스', '세무법인예성 강서지사', '에이티지씨', '코리아엘리베이터컨설팅', '싱크탱크디스포저', '가온에디스', '에스컴', '서울시자동차전문정비업협동조합', '이룸솔루션즈', '장수온돌', '아이앤티시스템', '에스와이랩', '신태양서울특허사무소', '소풍차', '메티스소프트', '경향북스', '톰스브릭앤건축사사무소', '뉴텍월드', 'MDS모빌리티 본사', '멀리뉴', '이유컨설팅 가산동지점', '하랑비투비', '태주마케팅', '알고리즘코리아', '코렉스인증그룹', '도경시스템', '제터캐터리틱', '유엔아이컴퍼니', '한국건기', '세인테크놀로지', '플래트', '코리아플러스파워', '더테크', '레드우드엠에프지코리아', '투어홀릭', '분팟', '허니비통신', '디에이드', '케이밴', '네이브랩스 앤드블록', '피아이티', '리미트리스', '에이치티소프트', '성익건설', '멘토비스', '유노이아', '다솔G밸리', '신화국제', '에셋레이어', '디지털주원이엔지', '이안소프트', '다빈치케이', '경영지원인스', '사라트레이딩', '코라이징코퍼레이션', '윤슬코리아', '로마니츠', '지투지샵', '커우커우위 해전자상무', '히어로팩토리', '비엑스비대부', '디에이치라인', '제이와이엠앤씨', '인홍 본사', '트리플나인', '스이프로비', '에이제이피', '하비트', '별그레', '메디바이오', '차이나스토리여행사', '피디오라', '티오엔지니어링', '디앤와트', '메이드메이트', '아이씨티씨앤알', '네오소닉스', '더위드랩', '비씨앤코리아', '아이새롬', '강원 서울사무소', '디엠엑스포', '와이블루컨설팅', '제이케이원 서울지점', '아이넷로보틱스', '1101에이아이', '알디오피스', '바이탈본딩', '나무와가구', '고쇼투어', '서울벤더(seoulvendor)', '오늘이즈', '이엔소프트', '셀리스트', '팜플', '센세이션스튜디오', '브릿지데이터', '씨엔케이테크', '브이디씨테크', '아이컴', '나인폭스', '헌드레드엑스', '원탑제이에스', '쓰리디베이스', '제이에스오버시스', '다빈치벤처스', '대일시스템', '루미에듀', '주노에스엔씨', '패스트엔지니어링', '바이오비', '렌지드', '모마스아이디', '던라이크', '인디비정보시스템', '솔밴코리아', '그랜드파워솔루션', '지솔루텍', '알에스이엔지', '투위스', '콘텐츠쿡', '메티소프트', '노보그룹', '엔텍엔지니어링', '인테그랩', '탑스코리아', '에이티비스', '다빈치웹', '핏소프트', '정원SNP', '클릭인', '파인에어텍', '디웹스', '세진컴퍼니', '쓰리알코리아', '더블유페이먼츠', '영성트레이드', '이정아이앤씨', '유진에쓰엔티', '명화실업', '시드매니지먼트', '제이와이스톤', '효림', '금수성', '라온에이티에스', '한국창의성학회', '트리탑', '그린힐바이오', '사자', '모모비즈온', '피플푸드', '디스플레이피플', '디투에스', '미인들', '지나엔터테인먼트', '와치투', '찰스폰 가산점', '위드유 스튜디오', '스마트모션', '건율행정사사무소', '찐우드', '키즈피플', '아인스메드', '천지씨앤엘', '쿠스코네트웍스', '미유에스앤씨', '소셜밸런스', '온라인바다', '아이뷰', '비트리더', '아인스건설', '에이치유인터내셔널', '디에스에이', '뮤텍소프트', '에이티웍스', '사삼구구코리아', '지알컴퍼니', '에스엔에스파워', '에드잉글리쉬 본사', '자영테크', '스트라틱', '씨앤에스네트웍스', '에스제이케미컬', '비앤유', '느티나무상회', '키즈원전자장부', '에스크라운', '윈트', '영화사그램', '헥셈', '하이스토밸리', '엘에스티소프트', '위드씨지', '액세스미디어', '이노데일', '마인드뱅크', '루이텍스타일', '레더리스', '엘씨브이', '파노시스', '유니후니', '세이프n', '유비아이오', '케이제이타임즈', '신안아이티컨설팅', '와일드스톤', '웨코스'],
    kw: '가산 가산동 가산디지털단지 가디 대성디폴리스 디폴리스 d-polis 대성 지식산업센터 금천구 서부샛길 한국클라우드 클라우드' },
  { id: 'cpg-chilgok', short: '칠곡 물류단지', title: '쿠팡 칠곡 물류단지', sub: '대구1·2·6센터 · 경북 칠곡', kw: '쿠팡 coupang 풀필먼트 cfs 물류센터 칠곡 대구1센터 대구2센터 대구6센터 영남복합물류' },
];
export async function load(id) {
  const m = MAPS.find((x) => x.id === id) || MAPS[0];
  MAP.id = m.id; MAP.title = m.title; MAP.doc = null;
  if (m.id !== 'r5') {
    const r = await fetch(`data/maps/${m.id}.json`);
    if (!r.ok) throw new Error(`map ${m.id}: HTTP ${r.status}`);
    MAP.doc = await r.json();
  }
  return MAP;
}

const FLOOR = 4.6;            // R5 storey height
// Placement solved from the reference photo (camera on the sidewalk ~3 m outside the fence):
// bearings of the tower edges and elevation angles of the tower tops / podium parapet put the
// west tower ~90 m and the east tower ~140 m behind the fence, with the podium joining both.
export const R5 = {
  podium: { x0: -105, x1: 105, z0: -112, z1: 30, h: 24 },
  t1: { x0: -66, x1: -20, z0: -66, z1: -26, floors: 27 },
  t2: { x0: 10, x1: 56, z0: -100, z1: -60, floors: 27 },
  entrance: { x0: -32, x1: -14 },
  fenceZ: 62,
  road: { z0: 74, z1: 98 },
  gates: [-100, 116],
};

// ---------------------------------------------------------------- ground painting
function paintGround(rng) {
  const g = terrain.paint;
  const W = 640, X0 = -320, Z0 = -320;
  // grass base with mottling
  g.fillStyle = '#6d8752'; g.fillRect(X0, Z0, W, W);
  for (let i = 0; i < 9000; i++) {
    const x = X0 + rng() * W, z = Z0 + rng() * W, r = 0.6 + rng() * 3.2;
    g.fillStyle = rng() < 0.5 ? 'rgba(84,110,62,0.35)' : 'rgba(128,150,92,0.28)';
    g.beginPath(); g.arc(x, z, r, 0, Math.PI * 2); g.fill();
  }
  const rect = (x0, z0, x1, z1, c) => { g.fillStyle = c; g.fillRect(x0, z0, x1 - x0, z1 - z0); };
  const pavers = (x0, z0, x1, z1, base, line, s = 1.2) => {
    rect(x0, z0, x1, z1, base);
    g.strokeStyle = line; g.lineWidth = 0.08; g.beginPath();
    for (let x = x0; x <= x1; x += s) { g.moveTo(x, z0); g.lineTo(x, z1); }
    for (let z = z0; z <= z1; z += s) { g.moveTo(x0, z); g.lineTo(x1, z); }
    g.stroke();
  };
  // campus plaza (granite) around the podium
  pavers(-150, -133, 150, 62, '#b9b6ae', 'rgba(90,88,82,0.35)', 2.4);
  // lawns and planting beds inside the campus
  const lawn = (x0, z0, x1, z1) => {
    rect(x0, z0, x1, z1, '#6a8a4c');
    for (let i = 0; i < (x1 - x0) * (z1 - z0) / 6; i++) {
      g.fillStyle = rng() < 0.5 ? 'rgba(60,92,44,0.4)' : 'rgba(120,150,80,0.3)';
      g.beginPath(); g.arc(x0 + rng() * (x1 - x0), z0 + rng() * (z1 - z0), 0.5 + rng() * 1.6, 0, 6.3); g.fill();
    }
  };
  lawn(-146, 36, -44, 58); lawn(-2, 36, 104, 58); lawn(126, 36, 146, 58);
  lawn(-146, -126, -112, 26); lawn(124, -126, 146, 26);
  // front entrance forecourt (lighter stone with a pattern) + walk to the gate
  pavers(-44, 30, -2, 62, '#cfcbc2', 'rgba(110,104,96,0.35)', 1.6);
  pavers(-104, 36, -96, 62, '#cfcbc2', 'rgba(110,104,96,0.35)', 1.6);
  // back parking
  rect(-106, -133, 106, -114, '#55595c');
  g.strokeStyle = 'rgba(235,235,230,0.8)'; g.lineWidth = 0.15; g.beginPath();
  for (let x = -100; x <= 100; x += 2.6) { g.moveTo(x, -133); g.lineTo(x, -128); }
  g.stroke();
  // service driveway east of podium
  rect(110, -130, 122, 74, '#4d5155');
  // roads
  const road = (x0, z0, x1, z1) => rect(x0, z0, x1, z1, '#464a4e');
  road(-320, R5.road.z0, 320, R5.road.z1);
  road(-170, -320, -150, 320); road(150, -320, 170, 320);
  road(-320, -152, 320, -134);
  // asphalt texture
  for (let i = 0; i < 14000; i++) {
    const x = X0 + rng() * W, z = Z0 + rng() * W;
    const onRoad = (z > R5.road.z0 && z < R5.road.z1) || (x > -170 && x < -150) || (x > 150 && x < 170) || (z > -152 && z < -134);
    if (!onRoad) continue;
    g.fillStyle = rng() < 0.5 ? 'rgba(30,32,35,0.25)' : 'rgba(110,112,115,0.18)';
    g.fillRect(x, z, 0.4 + rng(), 0.4 + rng());
  }
  // markings
  g.lineWidth = 0.18;
  g.strokeStyle = '#d8b440';
  g.beginPath(); g.moveTo(-320, 85.85); g.lineTo(320, 85.85); g.moveTo(-320, 86.15); g.lineTo(320, 86.15); g.stroke();
  g.strokeStyle = 'rgba(240,240,236,0.9)'; g.setLineDash([3, 5]);
  g.beginPath();
  for (const z of [78, 82, 90, 94]) { g.moveTo(-320, z); g.lineTo(320, z); }
  for (const x of [-163.3, -156.7, 156.7, 163.3]) { g.moveTo(x, -320); g.lineTo(x, 320); }
  for (const z of [-146, -140]) { g.moveTo(-320, z); g.lineTo(320, z); }
  g.stroke(); g.setLineDash([]);
  // crosswalks
  g.fillStyle = 'rgba(240,240,236,0.92)';
  const zebraX = (x0, x1, z0, z1) => { for (let x = x0; x < x1; x += 1.4) g.fillRect(x, z0, 0.7, z1 - z0); };
  const zebraZ = (z0, z1, x0, x1) => { for (let z = z0; z < z1; z += 1.4) g.fillRect(x0, z, x1 - x0, 0.7); };
  zebraZ(R5.road.z0 + 0.5, R5.road.z1 - 0.5, -180, -174); zebraZ(R5.road.z0 + 0.5, R5.road.z1 - 0.5, 174, 180);
  zebraX(-149, -141, R5.road.z0, R5.road.z1); // not a real crosswalk direction; reads as stop markings
  zebraZ(R5.road.z0 + 0.5, R5.road.z1 - 0.5, -104, -96);
  // sidewalks
  pavers(-320, R5.fenceZ, 320, R5.road.z0, '#b4aea4', 'rgba(80,76,70,0.3)', 1.5);
  pavers(-320, R5.road.z1, 320, R5.road.z1 + 10, '#b4aea4', 'rgba(80,76,70,0.3)', 1.5);
  pavers(-176, -320, -170, 320, '#b4aea4', 'rgba(80,76,70,0.3)', 1.5);
  pavers(170, -320, 176, 320, '#b4aea4', 'rgba(80,76,70,0.3)', 1.5);
  pavers(-150, -134, -144, 74, '#b4aea4', 'rgba(80,76,70,0.3)', 1.5);
  pavers(144, -134, 150, 74, '#b4aea4', 'rgba(80,76,70,0.3)', 1.5);
  // curbs
  g.strokeStyle = '#d9d6cf'; g.lineWidth = 0.3;
  g.beginPath(); g.moveTo(-320, R5.road.z0); g.lineTo(320, R5.road.z0); g.moveTo(-320, R5.road.z1); g.lineTo(320, R5.road.z1); g.stroke();
  // gate driveways across the sidewalk
  rect(110, R5.fenceZ, 122, R5.road.z0, '#4d5155');
  // fence footing line
  rect(-150, R5.fenceZ - 0.4, 150, R5.fenceZ + 0.4, '#9b968c');
  // context lots south / around
  pavers(-146, 108, 146, 176, '#a9a59d', 'rgba(70,68,64,0.25)', 3);
  pavers(176, -128, 320, 128, '#a8a49c', 'rgba(70,68,64,0.25)', 3);
  pavers(-320, -128, -176, 128, '#a8a49c', 'rgba(70,68,64,0.25)', 3);
  pavers(-146, -320, 146, -152, '#a8a49c', 'rgba(70,68,64,0.25)', 3);
  lawn(-140, 160, -100, 176); lawn(60, 158, 140, 176); lawn(240, 30, 300, 110); lawn(-300, -40, -270, 20);
  lawn(-60, -250, -20, -240); lawn(200, -300, 300, -230); lawn(-300, -300, -200, -230);
  terrain.commitPaint();
}

// ---------------------------------------------------------------- R5
// Wrap a Building so the hand-made R5 coordinates can be scaled/moved into a real lot.
function placed(b, T) {
  if (!T) return b;
  const add = b.addBox.bind(b);
  b.addBox = (o) => add({
    ...o, x0: T.X(o.x0), x1: T.X(o.x1), z0: T.Z(o.z0), z1: T.Z(o.z1),
    cell: o.cell && [o.cell[0] * T.sx, o.cell[1], o.cell[2] * T.sz],
    kindFn: o.kindFn && ((cx, cy, cz, ...r) => o.kindFn(T.Xi(cx), cy, T.Zi(cz), ...r)),
  });
  return b;
}
function lotTransform(lot) {
  const P = R5.podium, [lx0, lz0, lx1, lz1] = lot;
  const sx = (lx1 - lx0) / (P.x1 - P.x0), sz = (lz1 - lz0) / (P.z1 - P.z0);
  return { sx, sz, X: (x) => lx0 + (x - P.x0) * sx, Z: (z) => lz0 + (z - P.z0) * sz, Xi: (x) => P.x0 + (x - lx0) / sx, Zi: (z) => P.z0 + (z - lz0) / sz };
}

function buildR5(T = null, midrise = true) {
  const P = R5.podium, t1 = R5.t1, t2 = R5.t2, E = R5.entrance;
  const ph = P.h;
  // ---- podium (white stone, window ribbon, dark grid band on top, recessed glass ribbon on the east)
  const pod = placed(new Building('R5 저층동', { target: true, levelH: 6, collapse: false, cantilever: 2, tough: 0.66 }), T);
  const podKind = (cx, cy, cz) => {
    if (cy > 18) return cx < 6 ? { kind: K.GRID } : { kind: K.RIBBON };
    if (cy > 12 && cx > 30) return { kind: K.RIBBON };
    if (cy > 6 && cy < 12) return { kind: K.STONE, vari: 1 };
    return { kind: K.STONE };
  };
  const uniq = (a) => [...new Set(a)].sort((p, q) => p - q);
  const xs = uniq([P.x0, t1.x0, E.x0, E.x1, t1.x1, t2.x0, t2.x1, P.x1]);
  const zs = uniq([P.z0, t2.z0, t2.z1, t1.z0, t1.z1, P.z1]);
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (cx > t1.x0 && cx < t1.x1 && cz > t1.z0 && cz < t1.z1) continue;
    if (cx > t2.x0 && cx < t2.x1 && cz > t2.z0 && cz < t2.z1) continue;
    const front = j === zs.length - 2;
    const cell = [Math.min(10, x1 - x0), 6, Math.min(10, z1 - z0)];
    if (front && cx > E.x0 && cx < E.x1) {
      // recessed lobby glass under the entrance canopy
      pod.addBox({ x0, x1, y0: 0, y1: 9, z0, z1: z1 - 5, kind: K.DARKGLASS, cell: [x1 - x0, 9, 10] });
      pod.addBox({ x0, x1, y0: 9, y1: ph, z0, z1, cell: [11, 7.5, 10], kindFn: podKind, hollow: 'office' });
    } else if (front && cx > t2.x0) {
      // east wing: lower stone, upper floors glass ribbon set back from the stone face
      pod.addBox({ x0, x1, y0: 0, y1: 12, z0, z1, cell, kindFn: podKind, hollow: 'office' });
      pod.addBox({ x0, x1, y0: 12, y1: ph, z0, z1: z1 - 2.5, cell, kindFn: podKind, hollow: 'office' });
    } else {
      pod.addBox({ x0, x1, y0: 0, y1: ph, z0, z1, cell, kindFn: podKind, hollow: 'office' });
    }
  }
  // entrance canopy + its two slim columns
  pod.addBox({ x0: E.x0 - 2, x1: E.x1 + 2, y0: 9, y1: 10.3, z0: P.z1, z1: P.z1 + 5.5, kind: K.STONE, cell: [6.5, 1.3, 5.5] });
  for (const x of [E.x0 - 1.2, E.x1 + 1.2]) pod.addBox({ x0: x - 0.35, x1: x + 0.35, y0: 0, y1: 9, z0: P.z1 + 4.5, z1: P.z1 + 5.2, kind: K.METAL, cell: [0.7, 9, 0.7] });
  // roof plant boxes
  for (const [x, z] of [[-96, -60], [-90, 10], [-8, 14], [0, -40], [30, -20], [84, -44], [92, 4], [80, -80], [-40, -86], [-96, -100], [70, -106]])
    pod.addBox({ x0: x - 3, x1: x + 3, y0: ph, y1: ph + 2.6, z0: z - 2.2, z1: z + 2.2, kind: K.UNIT, cell: [6, 2.6, 4.4] });
  pod.finalize();

  // ---- tower 1 (west, in front): broad silver-blue curtain wall, dark crown band
  const T1 = placed(new Building('R5 서쪽 타워', { target: true, levelH: FLOOR, collapse: true, cantilever: 2, tough: 0.95 }), T);
  const H1 = t1.floors * FLOOR;
  T1.addBox({ x0: t1.x0, x1: t1.x1, y0: 0, y1: H1, z0: t1.z0, z1: t1.z1, cell: [6.6, FLOOR, 6.7], kindFn: (cx, cy) => (cy > H1 - FLOOR ? { kind: K.CROWN } : { kind: K.CURTAIN }), hollow: 'office' });
  // parapet ring and plant on the roof
  const pr = (x0, x1, z0, z1) => T1.addBox({ x0, x1, y0: H1, y1: H1 + 3.2, z0, z1, kind: K.CROWN, cell: [6.5, 3.2, 6] });
  pr(t1.x0, t1.x1, t1.z1 - 1, t1.z1); pr(t1.x0, t1.x1, t1.z0, t1.z0 + 1); // parapet ring
  pr(t1.x0, t1.x0 + 1, t1.z0 + 1, t1.z1 - 1); pr(t1.x1 - 1, t1.x1, t1.z0 + 1, t1.z1 - 1);
  T1.addBox({ x0: t1.x0 + 10, x1: t1.x0 + 34, y0: H1, y1: H1 + 4.5, z0: t1.z0 + 6, z1: t1.z0 + 22, kind: K.UNIT, cell: [8, 4.5, 8] });
  T1.finalize();

  // ---- tower 2 (east, set back): two slabs split by a dark recessed joint, crown on the wider slab
  const T2 = placed(new Building('R5 동쪽 타워', { target: true, levelH: FLOOR, collapse: true, cantilever: 2, tough: 0.95 }), T);
  const H2 = t2.floors * FLOOR, H2b = H2 + FLOOR;
  const jx0 = t2.x0 + 15, jx1 = t2.x0 + 17.5;
  T2.addBox({ x0: t2.x0, x1: jx0, y0: 0, y1: H2, z0: t2.z0, z1: t2.z1, cell: [5, FLOOR, 6.7], kindFn: (cx, cy) => (cy > H2 - FLOOR ? { kind: K.CROWN } : { kind: K.CURTAIN }) });
  T2.addBox({ x0: jx0, x1: jx1, y0: 0, y1: H2 + 2, z0: t2.z0 + 2, z1: t2.z1 - 2, kind: K.DARKGLASS, cell: [2.5, FLOOR, 6] });
  T2.addBox({ x0: jx1, x1: t2.x1, y0: 0, y1: H2b, z0: t2.z0, z1: t2.z1, cell: [6.1, FLOOR, 6.7], kindFn: (cx, cy) => (cy > H2b - 2 * FLOOR ? { kind: K.CROWN } : { kind: K.CURTAIN }), hollow: 'office' });
  T2.addBox({ x0: jx1 + 6, x1: jx1 + 24, y0: H2b, y1: H2b + 4, z0: t2.z0 + 6, z1: t2.z0 + 22, kind: K.UNIT, cell: [6, 4, 8] });
  T2.finalize();

  if (!midrise) return;
  // ---- the dark banded mid-rise glimpsed between the towers
  const M = new Building('연구동 R4', { levelH: 7.6, collapse: true, cantilever: 2, tough: 0.93 });
  M.addBox({ x0: -16, x1: 6, y0: 0, y1: 76, z0: -98, z1: -76, kind: K.OFFICE, vari: 7, cell: [7.3, 7.6, 7.3], hollow: 'office' });
  M.finalize();
}

// ---------------------------------------------------------------- context
const CONTEXT = [
  // x0, x1, z0, z1, height, office variant, name
  [-140, -96, 118, 160, 38, 1, '사무동 A'],
  [-82, -32, 120, 150, 15.2, 3, '사무동 B'],
  [-14, 38, 118, 164, 22.8, 2, '사무동 C'],
  [54, 96, 122, 152, 22.8, 0, '사무동 D'],
  [110, 140, 118, 158, 45.6, 4, '사무동 E'],
  [186, 238, -40, 20, 68.4, 5, '연구동 R3'],
  [192, 232, 40, 92, 30.4, 0, '사무동 F'],
  [250, 300, -118, -62, 53.2, 1, '사무동 G'],
  [-250, -192, -60, 8, 60.8, 2, '연구동 R6'],
  [-238, -196, 30, 86, 22.8, 6, '사무동 H'],
  [-92, -24, -232, -172, 83.6, 2, '연구동 R2'],
  [22, 100, -222, -166, 68.4, 5, '연구동 R1'],
  [122, 168, -212, -162, 38, 0, '사무동 I'],
  [-300, -258, 120, 170, 30.4, 4, '사무동 J'],
  [250, 300, 130, 178, 38, 3, '사무동 K'],
];
function buildContext(rng) {
  for (const [x0, x1, z0, z1, h, vari, name] of CONTEXT) {
    const b = new Building(name, { levelH: 7.6, collapse: true, cantilever: 2, tough: 0.93 });
    const w = x1 - x0, d = z1 - z0;
    const cell = [w / Math.max(1, Math.round(w / 9)), 7.6, d / Math.max(1, Math.round(d / 9))];
    if (vari === 2 || vari === 5) {
      // glass towers get a stone base and a dark top band
      b.addBox({ x0, x1, y0: 0, y1: h, z0, z1, cell, kindFn: (cx, cy) => (cy < 7.6 ? { kind: K.STONE } : cy > h - 7.6 ? { kind: K.CROWN } : { kind: K.OFFICE, vari }), hollow: 'office' });
    } else {
      b.addBox({ x0, x1, y0: 0, y1: h, z0, z1, cell, kind: K.OFFICE, vari, hollow: 'office' });
    }
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const ux = x0 + 4 + rng() * (w - 12), uz = z0 + 4 + rng() * (d - 10);
      b.addBox({ x0: ux, x1: ux + 5, y0: h, y1: h + 2.4, z0: uz, z1: uz + 4, kind: K.UNIT, cell: [5, 2.4, 4] });
    }
    b.finalize();
  }
}

// R5 massing traced from satellite + street views (reference only): two broad 27-storey blocks at
// the ends of the lot, a 4-storey podium between them with a glass atrium on the inner side and
// terraced roof gardens stepping down toward the road. Lot coords: x from the north-east end,
// z from the road side.
function buildR5Sat(lot) {
  const [lx0, lz0, lx1, lz1] = lot;
  // MEASURED 2026-10-28 on Kakao skyview through the map SDK (pixel -> lat/lng -> game coords), roof
  // outlines of both towers, the annex, atrium and glass hall; heights from the building register.
  // Game axes here: z0 side = 삼성로 (east), x0 end = north-east, x1 end = south-west.
  //   north-east tower  x -151..-113  z -121..-36   (38 m to the road, 85 m deep)
  //   south-west tower  x  -57..-21   z -118..-35   (36 m x 83 m)   -> 56 m apart
  //   glass hall        x  -25..33    z  -45..-2    (teal glass, ~30 m)
  //   atrium skylight   x -110..-60   z  -52..-14 ; roof garden between the towers on the road side
  const FL = 134.5 / 27, H = 27 * FL;
  const towerKind = (cx, cy) => (cy < FL * 2 ? { kind: K.STONE } : cy > H - 2 * FL && cy < H - FL ? { kind: K.CROWN } : { kind: K.CURTAIN });
  const tower = (name, x0, x1, z0, z1, slotX) => {
    const t = new Building(name, { target: true, levelH: FL, collapse: true, cantilever: 2, tough: 0.95, tint: [0.86, 1.0, 1.16, 1.0] }); // bluer glass than the stock curtain wall
    const w = x1 - x0, td = z1 - z0;
    const cw = w / Math.round(w / 9.5), cd = td / Math.round(td / 9.5);
    // a dark recessed slot runs up one corner of the road face (press photos)
    const slot = (cx, cy, cz) => cy > FL * 2 && cy < H - 2 * FL && Math.abs(cx - slotX) < cw * 0.6 && cz < z0 + cd;
    t.addBox({ x0, x1, y0: 0, y1: H, z0, z1, cell: [cw, FL, cd], kindFn: (cx, cy, cz) => (slot(cx, cy, cz) ? { kind: K.DARKGLASS } : towerKind(cx, cy, cz)), hollow: 'office' });
    // roof: glass parapet ring, plant around a helipad (satellite)
    const r = (a0, a1, b0, b1) => t.addBox({ x0: a0, x1: a1, y0: H, y1: H + 3.4, z0: b0, z1: b1, kind: K.CURTAIN, cell: [8, 3.4, 8] });
    r(x0, x1, z0, z0 + 1.2); r(x0, x1, z1 - 1.2, z1); r(x0, x0 + 1.2, z0 + 1.2, z1 - 1.2); r(x1 - 1.2, x1, z0 + 1.2, z1 - 1.2);
    for (const az of [0.08, 0.78]) t.addBox({ x0: x0 + 4, x1: x1 - 4, y0: H, y1: H + 4, z0: z0 + td * az, z1: z0 + td * az + 8, kind: K.UNIT, cell: [10, 4, 8] });
    t.finalize();
  };
  tower('삼성전자 R5 북동 타워', -151, -113, -121, -36, -113);
  tower('삼성전자 R5 남서 타워', -57, -21, -118, -35, -57);
  const pod = new Building('삼성전자 R5 저층동', { target: true, levelH: 4.8, collapse: false, cantilever: 2, tough: 0.7 });
  const cell = (w, d) => [w / Math.max(1, Math.round(w / 10)), 4.8, d / Math.max(1, Math.round(d / 10))];
  // podium facade (street view): tall white stone base, a blue glass ribbon, grey louvre band on top
  const podKind = (cx, cy) => (cy < 14.4 ? { kind: K.STONE } : cy < 19.2 ? { kind: K.RIBBON } : { kind: K.GRID });
  const PH = 24, zf = lz0 + 4, zb = lz1 - 3;
  // between the towers (full depth), the north-east wing with the annex, the south-west end
  pod.addBox({ x0: -113, x1: -57, y0: 0, y1: PH, z0: zf, z1: zb, cell: cell(56, zb - zf), kindFn: podKind, hollow: 'office' });
  pod.addBox({ x0: lx0 + 2, x1: -151, y0: 0, y1: PH, z0: zf, z1: lz1 - 22, cell: cell(-151 - lx0 - 2, lz1 - 22 - zf), kindFn: podKind, hollow: 'office' });
  pod.addBox({ x0: -21, x1: lx1 - 3, y0: 0, y1: PH, z0: zf, z1: -45, cell: cell(lx1 - 3 + 21, -45 - zf), kindFn: podKind, hollow: 'office' });
  // podium strips in front of / behind the towers
  for (const [x0, x1, z0, z1] of [[-151, -113, zf, -121], [-151, -113, -36, zb], [-57, -21, zf, -118], [-57, -21, -35, zb]])
    if (z1 - z0 > 2) pod.addBox({ x0, x1, y0: 0, y1: PH, z0, z1, cell: cell(x1 - x0, z1 - z0), kindFn: podKind });
  // atrium skylight between the towers on the inner side
  pod.addBox({ x0: -110, x1: -60, y0: PH, y1: PH + 6, z0: -52, z1: -14, kind: K.DARKGLASS, cell: cell(50, 38) });
  pod.finalize();
  // teal glass hall at the south-west end (press photo, satellite glass roof)
  const hall = new Building('삼성전자 R5 글라스홀', { target: true, levelH: 6, collapse: true, cantilever: 2, tough: 0.75, tint: [0.80, 1.10, 1.02, 1.0] });
  hall.addBox({ x0: -21, x1: Math.min(33, lx1 - 3), y0: 0, y1: 30, z0: -45, z1: zb, cell: [10, 6, 10], kind: K.CURTAIN, hollow: 'office' });
  hall.finalize();
}

// hand-built focus buildings, keyed by the zone's hand model id
const HAND = {
  r5sat: (h) => buildR5Sat(h.lot),
  meritz: buildMeritz,
  shilla: buildShilla,
  dfsShilla: buildDfsShilla,
  lotteTower: buildLotteTower,
  amore: buildAmore,
};

// 메리츠화재 봉래동사옥 (2026-10-28, re-measured): 지하 6층·지상 20층 (2024 사용승인, 연면적 40,278㎡).
// Roadview: north (칠패로) = 3 clear-glass podium floors, a recessed column floor, then deep blue glass;
// south (parking lot) = grey stone podium with a dark glass lobby, and the tower's south face is split
// into a west blue-glass wing (~21 m), a dark grey stone core strip with a column of small square windows
// (~19 m) and a narrow east glass wing (~8 m); the core rises above the roof as a louvred plant room.
// Height from two panoramas ≈ 86-88 m. Durability (tough / cols) unchanged from the balance patch.
function buildMeritz(h) {
  const PH = 13.5, TF = 18.0, NF = 16, LH = 4.25, TOP = TF + NF * LH; // 3 + 1 + 16 = 20 storeys, 86 m
  const [x0, z0, x1, z1] = h.tower;
  const sx0 = x0 + 21, sx1 = x0 + 40; // stone core strip on the south face (game +z = south)
  // reinforced (2026-10-28): denser column grid, tougher slabs
  const pod = new Building('메리츠화재 봉래동사옥 저층부', { target: true, levelH: 4.5, collapse: false, cantilever: 2, tough: 1.4, tint: [1.0, 1.06, 1.06, 0.3] });
  // north / under the tower: clear glass; the part south of the tower: grey stone with a dark glass lobby
  pod.addHollow({ rects: h.rects, y0: 0, y1: PH, cell: [8, 4.5, 8], kindFn: (cx, cy, cz) => {
    if (cz > z1 + 1) return cy < 4.5 ? { kind: K.DARKGLASS } : { kind: K.STONE };
    return cy < 4.5 ? { kind: K.DARKGLASS } : { kind: K.CURTAIN };
  }, hollow: 'office', cols: 'all' });
  pod.finalize();
  const t = new Building('메리츠화재 봉래동사옥 타워', { target: true, levelH: LH, collapse: true, cantilever: 2, tough: 1.6, tint: [0.42, 0.6, 1.05, 0.21] }); // deep blue glass, dark grey stone
  // recessed column floor between podium and tower: glass set back 2 m, columns on the facade line
  t.addBox({ x0: x0 + 2, x1: x1 - 2, y0: PH, y1: TF, z0: z0 + 2, z1: z1 - 2, kind: K.DARKGLASS, cell: [8, TF - PH, 8], hollow: 'office' });
  for (let x = x0 + 0.6; x < x1; x += (x1 - x0 - 1.2) / 5) for (const z of [z0 + 0.6, z1 - 0.6]) t.addBox({ x0: x - 0.6, x1: x + 0.6, y0: PH, y1: TF, z0: z - 0.6, z1: z + 0.6, kind: K.CONC, cell: [1.2, TF - PH, 1.2] });
  // stone core strip continues down the south face through the column floor
  t.addBox({ x0: sx0, x1: sx1, y0: PH, y1: TF, z0: z1 - 2, z1: z1, kind: K.STONE, vari: 2, cell: [6, TF - PH, 2] });
  t.addBox({ x0, x1, y0: TF, y1: TOP, z0, z1, cell: [8, LH, 8], kindFn: (cx, cy, cz) => {
    if (cz > z1 - 4 && cx > sx0 && cx < sx1) return { kind: K.STONE, vari: 2 };
    return cy > TOP - LH ? { kind: K.CROWN } : { kind: K.CURTAIN };
  }, hollow: 'office', cols: 'all' });
  // core plant room above the roof (dark louvre band), over the stone strip
  t.addBox({ x0: sx0, x1: sx1, y0: TOP, y1: TOP + 5, z0: z1 - 12, z1: z1, kind: K.STONE, cell: [6, 5, 6] });
  // roof: helipad deck on the west half, plant on the east half
  const w = x1 - x0;
  t.addBox({ x0: x0 + 3, x1: x0 + w * 0.42, y0: TOP, y1: TOP + 2.2, z0: z0 + 3, z1: z1 - 3, kind: K.UNIT, cell: [8, 2.2, 8] });
  t.addBox({ x0: sx1 + 1, x1: x1 - 2, y0: TOP, y1: TOP + 3, z0: z0 + 4, z1: z1 - 14, kind: K.UNIT, cell: [6, 3, 6] });
  t.finalize();
}

// 호텔신라 본사 · 서울신라호텔 (2026-10-29): register 22F 88 m (whole complex outline). Kakao skyview through
// the map SDK: a 115 m x 22 m north-south slab (roof shifted ~11 m north / 5 m west of its base by the photo
// lean), a lower west wing in its shadow, a dark glass atrium roof by the entrance roundabout, a roof
// terrace + tennis court podium (east) and the outdoor pool terrace (south-west). Roadview (동호로, entrance):
// red-brown brick with a grid of punched windows, a blue glass band under the roof parapet, dark canopy.
// West wing: hidden behind the tower in every street view; its roof lies in the tower's shadow on the
// skyview, which caps it at ~41 m (shadow ratio 0.57) -> 10 storeys.
function buildShilla(h) {
  const FL = 4.0, NF = 22, TOP = NF * FL; // 88 m (register)
  const [tx0, tz0, tx1, tz1] = h.tower;
  const lowRest = new Building('서울신라호텔 저층부', { target: true, levelH: 4.5, collapse: false, cantilever: 2, tough: 1.4, tint: [0.7, 0.8, 0.95, 0.85] });
  // podium under everything the parts below do not cover: stone, dark glazing at grade
  const covered = (cx, cz) => ['tower', 'wing', 'atrium', 'terrace', 'pool'].some((k) => { const r = h[k]; return r && cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3]; });
  const rest = h.rects.filter((r) => !covered((r[0] + r[2]) / 2, (r[1] + r[3]) / 2));
  if (rest.length) lowRest.addHollow({ rects: rest, y0: 0, y1: 6, cell: [8, 6, 8], kindFn: (cx, cy) => (cy < 3 ? { kind: K.DARKGLASS } : { kind: K.STONE }), hollow: 'office', cols: 'all', lite: true });
  // pool terrace podium (south-west) and the roof-terrace / tennis podium (east)
  const [px0, pz0, px1, pz1] = h.pool;
  lowRest.addBox({ x0: px0, x1: Math.min(px1, tx0), y0: 0, y1: 6, z0: pz0, z1: pz1, cell: [8, 6, 8], kindFn: (cx, cy) => (cy < 3 ? { kind: K.DARKGLASS } : { kind: K.STONE }), hollow: 'office' });
  const [ex0, ez0, ex1, ez1] = h.terrace;
  lowRest.addBox({ x0: Math.max(ex0, tx1), x1: ex1, y0: 0, y1: 7, z0: ez0, z1: ez1, cell: [8, 7, 8], kindFn: (cx, cy) => (cy < 3.5 ? { kind: K.DARKGLASS } : { kind: K.STONE }), hollow: 'office' });
  lowRest.finalize();
  // entrance atrium: dark glass hall next to the roundabout
  const [ax0, az0, ax1, az1] = h.atrium;
  const atr = new Building('서울신라호텔 로비동', { target: true, levelH: 5, collapse: true, cantilever: 2, tough: 1.4, tint: [0.75, 0.85, 1.0, 0.8] });
  atr.addBox({ x0: Math.max(ax0, tx1), x1: ax1, y0: 0, y1: 7, z0: az0, z1: az1, cell: [8, 3.5, 8], kind: K.DARKGLASS, hollow: 'office' });
  atr.finalize();
  // lower west wing (estimate: 10 storeys), brick like the tower
  const [wx0, wz0, wx1, wz1] = h.wing;
  const wing = new Building('서울신라호텔 서측 저층동', { target: true, levelH: FL, collapse: true, cantilever: 2, tough: 1.5, tint: [0.75, 0.85, 1.05, 1.0] });
  const wx1c = Math.min(wx1, tx0), ww = (wx1c - wx0) / 3;
  wing.addHollow({ rects: [0, 1, 2].map((i) => [wx0 + i * ww, wz0, wx0 + (i + 1) * ww, wz1]), y0: 0, y1: 10 * FL, cell: [8, FL, 8], kindFn: (cx, cy) => (cy < FL ? { kind: K.DARKGLASS } : { kind: K.OFFICE, vari: 9 }), hollow: 'residential', cols: 'all' });
  wing.finalize();
  // the tower: brick slab, guest-room floors, blue glass band under the parapet, plant + helipad on the roof
  const t = new Building('호텔신라 본사 · 서울신라호텔', { target: true, levelH: FL, collapse: true, cantilever: 2, tough: 1.6, tint: [0.62, 0.8, 1.1, 1.0] });
  // the slab is only 22 m deep: split it in three bays so the hollow grid gets a corridor bay with real floors
  const tw = (tx1 - tx0) / 3, bays = [0, 1, 2].map((i) => [tx0 + i * tw, tz0, tx0 + (i + 1) * tw, tz1]);
  t.addHollow({ rects: bays, y0: 0, y1: TOP, cell: [8, FL, 8], kindFn: (cx, cy) => (cy < FL ? { kind: K.DARKGLASS } : cy > TOP - 2 * FL && cy < TOP - FL ? { kind: K.CURTAIN } : { kind: K.OFFICE, vari: 9 }), hollow: 'residential', cols: 'all' });
  const L = tz1 - tz0;
  t.addBox({ x0: tx0 + 3, x1: tx1 - 3, y0: TOP, y1: TOP + 2.2, z0: tz0 + 6, z1: tz0 + 6 + L * 0.16, kind: K.UNIT, cell: [8, 2.2, 8] }); // helipad deck (north part)
  t.addBox({ x0: tx0 + 4, x1: tx1 - 4, y0: TOP, y1: TOP + 3.5, z0: tz0 + L * 0.3, z1: tz1 - 8, kind: K.UNIT, cell: [8, 3.5, 8] }); // rooftop plant
  t.finalize();
}

// 호텔신라 · 신라면세점 제2통합물류센터 (인천공항 자유무역지역, 2026-10-29): register outline (4 floors, no
// height on record), roadview 2025-07 from the south road and the west gate: a white insulated-panel box
// ~28 m tall; one end carries a blue glass office block (~3 storeys, about 4-19 m) on half its width.
// Durability: 2.6 (user tests: the generated 1.13 lost its facade to two hammer blows; 1.9 still too weak).
function buildDfsShilla(h) {
  const H = 28, LH = 7;
  const X0 = Math.min(...h.rects.map((r) => r[0])), X1 = Math.max(...h.rects.map((r) => r[2]));
  const Z1 = Math.max(...h.rects.map((r) => r[3]));
  const xm = (X0 + X1) / 2;
  const b = new Building('호텔신라 · 신라면세점 제2통합물류센터', { target: true, levelH: LH, collapse: true, cantilever: 2, tough: 2.6, tint: [0.62, 0.82, 1.1, 1.0] }); // raised twice 2026-10-29 (user: two hammer blows stripped the facade; then 'more')
  b.addHollow({ rects: h.rects, y0: 0, y1: H, cell: [9, LH, 9], kindFn: (cx, cy, cz) => (cz > Z1 - 3 && cx > xm && cy > 4 && cy < 19 ? { kind: K.CURTAIN } : { kind: K.METAL }), hollow: 'logistics' }); // full grid: smaller facade panels
  b.finalize();
}

// 롯데월드타워 (2026-10-30): 지상 123층 555 m (2017). Register outline (월드타워동) = ~76 m rounded square,
// zone rotated 62° so its faces line up with the axes. Photos (송파구청, 롯데 공식 블로그, 아주경제) + Kakao skyview:
// a smooth tapering cone of pale silver-blue glass with fine white vertical mullions, one dark seam running up the
// middle of every face, a slightly convex taper to ~30 m at the 123rd-floor roof (~497 m), then an open lantern
// (diagrid frame + glass) narrowing to the 555 m tip. Stacked 3-storey hollow segments (one slab each: piece budget) approximate the curve.
function buildLotteTower(h) {
  const [x0, z0, x1, z1] = h.lot;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, W0 = Math.min(x1 - x0, z1 - z0);
  const LH = 4.5, SEG = 3 * LH, ROOF = 112 * LH, TIP = 555; // 504 m roof line, crown above
  const width = (y) => W0 * (1 - 0.6 * Math.pow(Math.min(1, y / ROOF), 1.35));
  const t = new Building('롯데월드타워', { target: true, levelH: LH, collapse: true, cantilever: 3, tough: 2.0, tint: [1.22, 1.22, 1.2, 1.0] });
  const square = (w) => { const c = w * 0.15, a = w / 2; return [[cx - a + c, cz - a, cx + a - c, cz + a], [cx - a, cz - a + c, cx - a + c, cz + a - c], [cx + a - c, cz - a + c, cx + a, cz + a - c]]; };
  for (let y = 0; y < ROOF - 0.1; y += SEG) {
    const y1 = Math.min(ROOF, y + SEG), w = width((y + y1) / 2);
    t.addHollow({ rects: square(w), y0: y, y1, cell: [9, (y1 - y) / 2, 9], kindFn: (px, py) => (py < 2 * LH ? { kind: K.DARKGLASS } : { kind: K.CURTAIN }), hollow: 'office', lite: true });
    // the seam: a dark line up the middle of each face (kept just off the skin: a box touching the
    // skin would hide that skin's outer face in finalize() and open an 8 m hole in the facade)
    const a = w / 2 + 0.08, b = a + 0.5, sw = 1.3;
    if (y >= 2 * LH) {
      t.addBox({ x0: cx - sw, x1: cx + sw, y0: y, y1, z0: cz - b, z1: cz - a, kind: K.DARKGLASS, cell: [2 * sw, SEG, 0.5] });
      t.addBox({ x0: cx - sw, x1: cx + sw, y0: y, y1, z0: cz + a, z1: cz + b, kind: K.DARKGLASS, cell: [2 * sw, SEG, 0.5] });
      t.addBox({ x0: cx - b, x1: cx - a, y0: y, y1, z0: cz - sw, z1: cz + sw, kind: K.DARKGLASS, cell: [0.5, SEG, 2 * sw] });
      t.addBox({ x0: cx + a, x1: cx + b, y0: y, y1, z0: cz - sw, z1: cz + sw, kind: K.DARKGLASS, cell: [0.5, SEG, 2 * sw] });
    }
  }
  // crown lantern: glass core narrowing to the tip inside a light frame (corner posts, rings, seam ribs)
  const BAND = 6.5, span = TIP - ROOF;
  for (let y = ROOF; y < TIP - 0.5; y += BAND) {
    const y1 = Math.min(TIP, y + BAND), f = ((y + y1) / 2 - ROOF) / span;
    const w = width(ROOF) * (1 - 0.78 * f), a = w / 2, c = 0.45;
    const core = w * 0.86, ring = Math.round((y - ROOF) / BAND) % 2 === 1;
    if (core > 3) t.addBox({ x0: cx - core / 2, x1: cx + core / 2, y0: y, y1, z0: cz - core / 2, z1: cz + core / 2, kind: K.CURTAIN, vari: 3, cell: [core / 2, BAND, core / 2] });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) t.addBox({ x0: cx + sx * (a - c) - c, x1: cx + sx * (a - c) + c, y0: y, y1, z0: cz + sz * (a - c) - c, z1: cz + sz * (a - c) + c, kind: K.METAL, cell: [2 * c, BAND, 2 * c] });
    for (const s of [-1, 1]) {
      if (ring) t.addBox({ x0: cx - a, x1: cx + a, y0: y1 - 0.35, y1, z0: cz + s * a - 0.3, z1: cz + s * a + 0.3, kind: K.METAL, cell: [a, 0.35, 0.6] });
      if (ring) t.addBox({ x0: cx + s * a - 0.3, x1: cx + s * a + 0.3, y0: y1 - 0.35, y1, z0: cz - a + 0.6, z1: cz + a - 0.6, kind: K.METAL, cell: [0.6, 0.35, a] });
      t.addBox({ x0: cx - 0.5, x1: cx + 0.5, y0: y, y1, z0: cz + s * a - 0.4, z1: cz + s * a + 0.4, kind: K.METAL, cell: [1, BAND, 0.8] });
      t.addBox({ x0: cx + s * a - 0.4, x1: cx + s * a + 0.4, y0: y, y1, z0: cz - 0.5, z1: cz + 0.5, kind: K.METAL, cell: [0.8, BAND, 1] });
    }
  }
  t.finalize();
}

// 아모레퍼시픽 용산 본사 (2026-11-01): 지상 22층, 약 110 m, 2017 (David Chipperfield). Register outline = 93.6 m
// square (zone rotated 37° to its edges). Photos (한국경제, SPACE, 아시아경제, 이코노미조선): a cube wrapped in dense
// white aluminium fins (CURTAIN vari 4) with faint tier breaks, three big 'urban windows' cut into different faces
// at different heights (roof gardens inside), a central atrium open to the sky, a tall glazed ground floor.
// Durability: tough 1.1 -> hammer x12 on the ring roof 4.5% (the test's centre point falls into the atrium).
function buildAmore(h) {
  const [x0, z0, x1, z1] = h.lot;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, A = Math.min(x1 - x0, z1 - z0) / 2;
  const H = 110, LH = 5;
  const t = new Building('아모레퍼시픽 본사', { target: true, levelH: LH, collapse: true, cantilever: 3, tough: 1.1, tint: [0.8, 0.86, 0.92, 1.0] });
  // boxes cut out of the cube (relative to the centre): [x0, z0, x1, z1, y0, y1]
  const voids = [ // every band between these heights must be >= 2 storeys (addHollow skips thinner ones -> a gap)
    [-15, -15, 15, 15, 15, H + 1],          // central atrium
    [-14, -A - 1, 14, -A + 22, 80, 100],    // urban window, high on one face
    [A - 22, -30, A + 1, -4, 50, 65],       // mid height, next face
    [8, A - 22, 34, A + 1, 25, 40],         // low, third face
  ];
  const cut = (rects, b) => rects.flatMap((r) => {
    const ix0 = Math.max(r[0], b[0]), iz0 = Math.max(r[1], b[1]), ix1 = Math.min(r[2], b[2]), iz1 = Math.min(r[3], b[3]);
    if (ix1 <= ix0 || iz1 <= iz0) return [r];
    return [[r[0], r[1], r[2], iz0], [r[0], iz1, r[2], r[3]], [r[0], iz0, ix0, iz1], [ix1, iz0, r[2], iz1]].filter((q) => q[2] - q[0] > 1 && q[3] - q[1] > 1);
  });
  const ys = [...new Set([0, 15, H, ...voids.flatMap((v) => [v[4], v[5]])].filter((y) => y >= 0 && y <= H))].sort((a, b) => a - b);
  for (let i = 0; i < ys.length - 1; i++) {
    const y0 = ys[i], y1 = ys[i + 1], ym = (y0 + y1) / 2;
    let rects = [[-A, -A, A, A]];
    for (const v of voids) if (ym > v[4] && ym < v[5]) rects = cut(rects, v);
    rects = rects.map((r) => [cx + r[0], cz + r[1], cx + r[2], cz + r[3]]);
    t.addHollow({ rects, y0, y1, cell: [9, LH, 9], kindFn: (px, py, pz) => {
      if (py < 15) return { kind: K.DARKGLASS };
      // faces around a void (garden windows, atrium): dark glass, so the openings read as holes
      const lx = px - cx, lz = pz - cz;
      if (voids.some((v) => lx > v[0] - 1.5 && lx < v[2] + 1.5 && lz > v[1] - 1.5 && lz < v[3] + 1.5 && py > v[4] - LH && py < v[5] + 1)) return { kind: K.DARKGLASS };
      return { kind: K.CURTAIN, vari: 4 };
    }, hollow: 'office', cols: 'all' });
  }
  t.finalize();
}

export function build() {
  const rng = mulberry(20260611);
  terrain.init();
  if (MAP.doc) {
    const hand = MAP.doc.hand.find((h) => HAND[h.model] || h.model === 'r5');
    mapgen.paintZone(MAP.doc, hand ? [hand.lot] : []);
    if (hand && HAND[hand.model]) HAND[hand.model](hand);
    else if (hand) buildR5(lotTransform(hand.lot), false);
    mapgen.buildBuildings(MAP.doc);
    return;
  }
  paintGround(rng);
  buildR5();
  buildContext(rng);
}
