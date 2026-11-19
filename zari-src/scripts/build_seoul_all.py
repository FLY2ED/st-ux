"""서울 상권분석서비스 원자료를 상권별 작은 파일로 쪼개 public/data/sa/ 에 둔다.
브라우저(src/seoulCalc.js)가 이 파일들로 어느 자리·어느 업종이든 리포트 숫자를 계산한다.

python3 -I scripts/build_seoul_all.py <내려받은 폴더> [출력 폴더]
폴더 구성은 build_seoul.py와 같다(CP949 CSV, x_OA-15560_5 상권 영역 shp/dbf).

출력
  index.json  {cols, areas:[[code,name,lon,lat,gu,x,y,rings]...]}  넓이 작은 상권부터
              rings: 꼭짓점 줄인 경계, 중심 lon/lat에서 1e-5도 단위 차이를 펼친 배열
  a/<code>.json  상권 하나의 원자료 (키 설명은 area_file 참고)
  seoul.json  분기·업종 이름·서울 평균·구별 뜨는 상권
  dist/<업종>.json  점수 백분위용 서울 분포(정렬 배열)
  catmap.json  소상공인 소분류 이름 → 서비스업종 코드
"""
import csv, glob, json, math, os, struct, sys
from collections import defaultdict

D = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', 'public', 'data', 'sa')
CATS = os.path.join(HERE, '..', '..', 'midterm', 'data', 'cats.json')
SIMPLIFY_M = 12           # 경계 꼭짓점 줄이는 허용 오차(m)


def rows(path):
    with open(path, encoding='cp949', newline='') as f:
        r = csv.reader(f)
        head = next(r)
        for x in r:
            if x and x[0] != head[0] and not x[0].isalpha():
                yield dict(zip(head, x))


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


# ---------- 좌표: EPSG:5181(Korea 2000 중부원점, 가산 200000/500000) → 경위도 ----------
A_ = 6378137.0
F_ = 1 / 298.257222101
E2 = F_ * (2 - F_)
EP2 = E2 / (1 - E2)
LAT0, LON0, FE, FN, K0 = math.radians(38), math.radians(127), 200000.0, 500000.0, 1.0


def merid(p):
    e4, e6 = E2 * E2, E2 ** 3
    return A_ * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * p - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * p)
                 + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * p) - (35 * e6 / 3072) * math.sin(6 * p))


M0 = merid(LAT0)


def tm2ll(x, y):
    m = M0 + (y - FN) / K0
    mu = m / (A_ * (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - E2)) / (1 + math.sqrt(1 - E2))
    p1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
          + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    s, c, t = math.sin(p1), math.cos(p1), math.tan(p1)
    c1, t1 = EP2 * c * c, t * t
    n1 = A_ / math.sqrt(1 - E2 * s * s)
    r1 = A_ * (1 - E2) / (1 - E2 * s * s) ** 1.5
    d = (x - FE) / (n1 * K0)
    lat = p1 - (n1 * t / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4 / 24
                               + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6 / 720)
    lon = LON0 + (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5 / 120) / c
    return math.degrees(lon), math.degrees(lat)


# ---------- 상권 영역 dbf + shp ----------
def read_dbf(p):
    d = open(p, 'rb').read()
    n, hl, rl = struct.unpack('<IHH', d[4:12])
    fs, o = [], 32
    while d[o] != 0x0D:
        fs.append((d[o:o + 11].split(b'\0')[0].decode(), d[o + 16])); o += 32
    out = []
    for i in range(n):
        r, p0, rec = d[hl + i * rl + 1:hl + (i + 1) * rl], 0, {}
        for nm, fl in fs:
            rec[nm] = r[p0:p0 + fl].decode('utf-8', 'replace').strip(); p0 += fl
        out.append(rec)
    return out


def read_shp(p):
    d = open(p, 'rb').read()
    o, out = 100, []
    while o < len(d):
        _, clen = struct.unpack('>ii', d[o:o + 8])
        b = d[o + 8:o + 8 + clen * 2]
        o += 8 + clen * 2
        if struct.unpack('<i', b[:4])[0] != 5:
            out.append([]); continue
        npart, npt = struct.unpack('<ii', b[36:44])
        parts = list(struct.unpack(f'<{npart}i', b[44:44 + 4 * npart])) + [npt]
        pts = struct.unpack(f'<{2 * npt}d', b[44 + 4 * npart:44 + 4 * npart + 16 * npt])
        out.append([[(pts[2 * k], pts[2 * k + 1]) for k in range(parts[j], parts[j + 1])] for j in range(npart)])
    return out


def dp(pts, tol):
    # 더글러스-포커로 꼭짓점 줄이기
    if len(pts) < 4:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    st = [(0, len(pts) - 1)]
    while st:
        i, j = st.pop()
        (x1, y1), (x2, y2) = pts[i], pts[j]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1e-9
        best, bi = -1, -1
        for k in range(i + 1, j):
            x, y = pts[k]
            dd = abs(dy * (x - x1) - dx * (y - y1)) / L if (dx or dy) else math.hypot(x - x1, y - y1)
            if dd > best:
                best, bi = dd, k
        if best > tol:
            keep[bi] = True; st += [(i, bi), (bi, j)]
    return [p for p, k in zip(pts, keep) if k]


base = os.path.join(D, 'x_OA-15560_5')
RECS = read_dbf(glob.glob(os.path.join(base, '*.dbf'))[0])
SHPS = read_shp(glob.glob(os.path.join(base, '*.shp'))[0])
A = {}
GU = {}
for rec, rings in zip(RECS, SHPS):
    x, y = num(rec['XCNTS_VALU']), num(rec['YDNTS_VALU'])
    lon, lat = tm2ll(x, y)
    enc = []
    for ring in rings:
        s = dp(ring, SIMPLIFY_M)
        flat = []
        for px, py in s:
            plon, plat = tm2ll(px, py)
            flat += [round((plon - lon) * 1e5), round((plat - lat) * 1e5)]
        if len(flat) >= 6:
            enc.append(flat)
    A[rec['TRDAR_CD']] = {'name': rec['TRDAR_CD_N'], 'x': x, 'y': y, 'lon': lon, 'lat': lat, 'gu': rec['SIGNGU_CD'],
                          'ar': num(rec['RELM_AR']), 'rings': enc}
    GU[rec['SIGNGU_CD']] = rec['SIGNGU_CD_']
ALL = list(A)


# ---------- 상권 단위 분기 파일: 가장 최근 분기만 ----------
def latest(name):
    rs = list(rows(os.path.join(D, name)))
    q = max(r['기준_년분기_코드'] for r in rs)
    return q, {r['상권_코드']: r for r in rs if r['기준_년분기_코드'] == q}


qF, FLOW = latest('OA-15568.csv')
_, WORK = latest('OA-15569.csv')
_, LIVE = latest('OA-15584.csv')
_, CHG = latest('OA-15576.csv')
_, FAC = latest('OA-15580.csv')
_, APT = latest('OA-15566.csv')

DAYS = ['월', '화', '수', '목', '금', '토', '일']
HB = ['06~11', '11~14', '14~17', '17~21', '21~24', '00~06']
AG = ['10', '20', '30', '40', '50', '60_이상']
DET = ([f'{d}요일_매출_금액' for d in DAYS] + [f'시간대_{b}_매출_금액' for b in HB] + [f'연령대_{a}_매출_금액' for a in AG]
       + ['남성_매출_금액', '여성_매출_금액'])

# 추정매출: (상권, 업종) -> {분기: (금액, 건수, 세부 21칸)}
SALES = defaultdict(dict)
INAME = {}
for p in sorted(glob.glob(os.path.join(D, 'x_OA-15572_*', '*.csv'))):
    for r in rows(p):
        INAME[r['서비스_업종_코드']] = r['서비스_업종_코드_명']
        SALES[(r['상권_코드'], r['서비스_업종_코드'])][r['기준_년분기_코드']] = (num(r['당월_매출_금액']), num(r['당월_매출_건수']), r)
STORE = defaultdict(dict)    # (상권, 업종) -> {분기: (점포, 개업, 폐업)}
for p in sorted(glob.glob(os.path.join(D, 'x_OA-15577_*', '*.csv'))):
    for r in rows(p):
        v = list(r.values())
        STORE[(v[3], v[5])][v[0]] = (int(num(v[7])), int(num(v[10])), int(num(v[12])))
        INAME.setdefault(v[5], v[6])
QS = sorted({q for d in SALES.values() for q in d})
qS = QS[-1]
Q8 = QS[-8:]
YEARS = sorted({q[:4] for q in QS})


def stores(c, i, q):
    return STORE[(c, i)].get(q, (0, 0, 0))[0] if (c, i) in STORE else 0


def sales(c, i, q, k=0):
    return SALES[(c, i)].get(q, (0, 0))[k] if (c, i) in SALES else 0


BY_AREA = defaultdict(set)
for (c, i) in list(SALES) + list(STORE):
    BY_AREA[c].add(i)


def area_file(c):
    """상권 하나. f 유동[총,여,연령6,시간6(06-11..00-06),요일7] w 직장 l 상주[인구,가구,아파트가구,비아파트가구]
    g 변화[지표,운영개월,서울운영개월] x 시설[버스,지하철,대학,고,중,초,종합병원,일반병원,약국,은행,관공서,슈퍼]
    p 아파트[단지,66미만,66,99,132,165세대,평균시가(만원)]
    i {업종: [매출8(원), 점포8, 최근분기건수, 개업(연도별), 폐업(연도별), (최근분기 세부 21칸 천원: 요일7 시간6 연령6 남 여)]}"""
    o = {}
    if c in FLOW:
        r = FLOW[c]
        o['f'] = [int(num(r['총_유동인구_수'])), int(num(r['여성_유동인구_수']))] + \
                 [int(num(r[f'연령대_{a}_유동인구_수'])) for a in AG] + \
                 [int(num(r[f'시간대_{b.replace("~", "_")}_유동인구_수'])) for b in HB] + \
                 [int(num(r[f'{d}요일_유동인구_수'])) for d in DAYS]
    if c in WORK:
        o['w'] = int(num(WORK[c]['총_직장_인구_수']))
    if c in LIVE:
        r = LIVE[c]
        o['l'] = [int(num(r[k])) for k in ('총_상주인구_수', '총_가구_수', '아파트_가구_수', '비_아파트_가구_수')]
    if c in CHG:
        r = CHG[c]
        o['g'] = [r['상권_변화_지표'], int(num(r['운영_영업_개월_평균'])), int(num(r['서울_운영_영업_개월_평균']))]
    if c in FAC:
        r = FAC[c]
        o['x'] = [int(num(r[k])) for k in ('버스_정거장_수', '지하철_역_수', '대학교_수', '고등학교_수', '중학교_수', '초등학교_수',
                                            '종합병원_수', '일반_병원_수', '약국_수', '은행_수', '관공서_수', '슈퍼마켓_수')]
    if c in APT:
        r = APT[c]
        o['p'] = [int(num(r['아파트_단지_수']))] + [int(num(r[f'아파트_면적_{k}_세대_수'])) for k in
                                                   ('66_제곱미터_미만', '66_제곱미터', '99_제곱미터', '132_제곱미터', '165_제곱미터')] + \
                 [round(num(r['아파트_평균_시가']) / 1e4)]
    ii = {}
    for i in sorted(BY_AREA[c]):
        s8 = [round(sales(c, i, q)) for q in Q8]
        n8 = [stores(c, i, q) for q in Q8]
        st = STORE.get((c, i), {})
        op = [sum(st.get(q, (0, 0, 0))[1] for q in QS if q[:4] == y) for y in YEARS]
        cl = [sum(st.get(q, (0, 0, 0))[2] for q in QS if q[:4] == y) for y in YEARS]
        if not any(s8) and not any(n8) and not any(op) and not any(cl):
            continue
        row = s8 + n8 + [round(sales(c, i, qS, 1))] + op + cl
        if (c, i) in SALES and qS in SALES[(c, i)]:
            r = SALES[(c, i)][qS][2]
            row += [round(num(r[k]) / 1e3) for k in DET]
        ii[i] = row
    o['i'] = ii
    return o


# ---------- 서울 분포·평균 (build_seoul.py 의 cafe()/seoul_dist() 를 업종마다) ----------
def metrics(c, i):
    n = stores(c, i, qS)
    m = round(sales(c, i, qS) / n / 1e4) if n else 0
    yo = QS[-5]
    grow = (sales(c, i, qS) / sales(c, i, yo) - 1) if sales(c, i, yo) else 0
    last4 = [(sales(c, i, q) / stores(c, i, q) / 1e4 if stores(c, i, q) else 0) for q in QS[-4:]]
    even = min(last4) / max(last4) if max(last4) else 0
    flow = num(FLOW[c]['총_유동인구_수']) / 91 if c in FLOW else 0
    life = num(CHG[c]['운영_영업_개월_평균']) if c in CHG else 0
    return m, even, flow, life, grow


INDS = sorted({i for (_, i) in SALES})
DIST, AVG, TREND = {}, {}, defaultdict(dict)
for i in INDS:
    cs = [c for c in ALL if stores(c, i, qS) >= 3 and sales(c, i, qS) > 0]
    cols = list(zip(*[metrics(c, i) for c in cs])) if cs else [[]] * 5
    DIST[i] = {'money': sorted(int(v) for v in cols[0]), 'even': sorted(round(v, 4) for v in cols[1]),
               'flow': sorted(round(v, 1) for v in cols[2]), 'life': sorted(round(v, 1) for v in cols[3]),
               'grow': sorted(round(v, 4) for v in cols[4])}
    s = sum(sales(c, i, qS) for c in ALL)
    n = sum(stores(c, i, qS) for c in ALL)
    k = sum(sales(c, i, qS, 1) for c in ALL)
    AVG[i] = [round(s / n / 1e4, 4) if n else 0, round(s / k, 4) if k else 0]
    by_gu = defaultdict(list)
    for c in ALL:
        if stores(c, i, qS) < 3:
            continue
        now, ago = sales(c, i, qS), sales(c, i, QS[-5])
        if ago:
            by_gu[A[c]['gu']].append([A[c]['name'], round((now / ago - 1) * 100), stores(c, i, qS)])
    for g, tr in by_gu.items():
        tr.sort(key=lambda x: -x[1])
        TREND[g][i] = tr[:5]

# 업종 이름: 화면용은 '-'→'·', 커피-음료는 카페
LABEL = {i: ('카페' if i == 'CS100010' else n.replace('-', '·')) for i, n in INAME.items()}

# ---------- 소상공인 소분류 → 서비스업종 ----------
# 이름 규칙(앞에서부터 처음 맞는 것) 뒤에 손으로 고친 표를 덮어쓴다
RULES = [('치과', 'CS200007'), ('한의원', 'CS200008'), ('한방병원', 'CS200008'), ('의원', 'CS200006'), ('학원', 'CS200001'),
         ('의류 소매', 'CS300011'), ('구이/찜', 'CS100001'), ('한식', 'CS100001'), ('일식', 'CS100003'), ('서양식', 'CS100004'),
         ('외국식', 'CS100004'), ('동남아식', 'CS100004'), ('스포츠시설', 'CS200024')]
MANUAL = {
    '카페': 'CS100010', '아이스크림/빙수': 'CS100010',
    '백반/한정식': 'CS100001', '국/탕/찌개류': 'CS100001', '국수/칼국수': 'CS100001', '횟집': 'CS100001', '족발/보쌈': 'CS100001',
    '곱창 전골/구이': 'CS100001', '뷔페': 'CS100001', '냉면/밀면': 'CS100001', '전/부침개': 'CS100001', '복 요리 전문': 'CS100001',
    '중국집': 'CS100002', '마라탕/훠궈': 'CS100002',
    '일식 회/초밥': 'CS100003', '일식 카레/돈가스/덮밥': 'CS100003', '일식 면 요리': 'CS100003',
    '경양식': 'CS100004', '파스타/스테이크': 'CS100004', '패밀리레스토랑': 'CS100004', '베트남식 전문': 'CS100004',
    '빵/도넛': 'CS100005', '떡/한과': 'CS100005',
    '피자': 'CS100006', '버거': 'CS100006', '토스트/샌드위치/샐러드': 'CS100006',
    '치킨': 'CS100007',
    '김밥/만두/분식': 'CS100008', '그 외 기타 간이 음식점': 'CS100008',
    '생맥주 전문': 'CS100009', '요리 주점': 'CS100009',
    '입시·교과학원': 'CS200001', '전문자격/고시학원': 'CS200001', '외국어학원': 'CS200002', '미술학원': 'CS200003', '음악학원': 'CS200003',
    '컴퓨터 학원': 'CS200004', '요가/필라테스 학원': 'CS200005', '태권도/무술학원': 'CS200005', '기타 예술/스포츠 교육기관': 'CS200005',
    '기타 기술/직업 훈련학원': None, '운전학원': None,
    '동물병원': 'CS200009', '변호사': 'CS200010', '변리사': 'CS200011', '법무사': 'CS200012', '행정사': 'CS200013',
    '공인노무사': 'CS200013', '기타 법무관련 서비스업': 'CS200013', '공인회계사': 'CS200014', '기타 회계 관련 서비스업': 'CS200014',
    '세무사': 'CS200015', '당구장': 'CS200016', '골프 연습장': 'CS200017', '볼링장': 'CS200018', 'PC방': 'CS200019',
    '전자 게임장': 'CS200020', '기타 오락장': 'CS200021', '기타 오락관련 서비스업': 'CS200021', '바둑/장기/체스 경기 운영업': 'CS200021',
    '복권 발행/판매업': 'CS200022', '핸드폰/통신장비 수리업': 'CS200023',
    '헬스장': 'CS200024', '수영장': 'CS200024', '테니스장': 'CS200024', '탁구장': 'CS200024', '스쿼시/라켓볼장': 'CS200024',
    '종합 스포츠시설': 'CS200024',
    '자동차 정비소': 'CS200025', '자동차 세차장': 'CS200026', '모터사이클 수리업': 'CS200027', '미용실': 'CS200028',
    '네일숍': 'CS200029', '피부 관리실': 'CS200030', '체형/비만 관리': 'CS200030', '세탁소': 'CS200031', '셀프 빨래방': 'CS200031',
    '가전제품 수리업': 'CS200032', '부동산 중개/대리업': 'CS200033', '여관/모텔': 'CS200034', '그 외 기타 숙박업': 'CS200035',
    '기숙사/고시원': 'CS200036', '노래방': 'CS200037', '독서실/스터디 카페': 'CS200038', '비디오방': 'CS200039',
    '사진촬영업': 'CS200041', '번역/통역 서비스업': 'CS200042', '건축물 일반 청소업': 'CS200043',
    '산업설비; 운송장비 및 공공장소 청소업': 'CS200043', '여행사': 'CS200044', '기타 여행 보조/예약 서비스업': 'CS200044',
    '만화방': 'CS200045', '음반/비디오물 대여업': 'CS200045', '의류 대여업': 'CS200046', '기타 개인/가정용품 대여업': 'CS200047',
    '슈퍼마켓': 'CS300001', '편의점': 'CS300002', '컴퓨터/소프트웨어 소매업': 'CS300003', '사무기기 소매업': 'CS300003',
    '핸드폰 소매업': 'CS300004', '주류 소매업': 'CS300005', '곡물/곡분 소매업': 'CS300006', '정육점': 'CS300007',
    '수산물 소매업': 'CS300008', '건어물/젓갈 소매업': 'CS300008', '채소/과일 소매업': 'CS300009', '반찬/식료품 소매업': 'CS300010',
    '한복 소매업': 'CS300012', '유아용 의류 소매업': 'CS300013', '신발 소매업': 'CS300014', '가방 소매업': 'CS300015',
    '액세서리/잡화 소매업': 'CS300015', '안경렌즈 소매업': 'CS300016', '시계/귀금속 소매업': 'CS300017', '약국': 'CS300018',
    '의료기기 소매업': 'CS300019', '서점': 'CS300020', '문구/회화용품 소매업': 'CS300021', '화장품 소매업': 'CS300022',
    '가발 소매업': 'CS300023', '운동용품 소매업': 'CS300024', '자전거 소매업': 'CS300025', '장난감 소매업': 'CS300026',
    '실/섬유제품 소매업': 'CS300027', '침구류/커튼 소매업': 'CS300027', '꽃집': 'CS300028', '애완동물/애완용품 소매업': 'CS300029',
    '가구 소매업': 'CS300031', '가전제품 소매업': 'CS300032', '철물/공구 소매업': 'CS300033', '악기 소매업': 'CS300034',
    '인테리어 디자인업': 'CS300035', '벽지/장판/마루 소매업': 'CS300035', '전기용품/조명장치 소매업': 'CS300036',
    '자동차 부품 소매업': 'CS300038', '타이어 소매업': 'CS300038', '모터사이클 및 부품 소매업': 'CS300039',
    '중고 상품 소매업': 'CS300040', '예술품 소매업': 'CS300041', '주유소': 'CS300042',
    # 맞는 서비스업종이 없는 것(규칙에 걸려도 비운다)
    '종합병원': None, '일반병원': None, '요양병원': None, '유사 의료업': None, '사회교육시설': None, '그 외 기타 교육기관': None,
    '레크리에이션 교육기관': None, '직원 훈련기관': None, '기타 교육지원 서비스업': None, '구내식당': None,
    '일반 유흥 주점': None, '무도 유흥 주점': None, '기타 스포츠시설 운영업': 'CS200024',
}


def catmap():
    cats = json.load(open(CATS, encoding='utf-8'))
    out = {}
    for n in cats:
        code = None
        for k, c in RULES:
            if k in n:
                code = c; break
        if n in MANUAL:
            code = MANUAL[n]
        out[n] = code
    assert out['카페'] == 'CS100010'
    return out


# ---------- 쓰기 ----------
def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))


order = sorted(ALL, key=lambda c: A[c]['ar'])
dump(os.path.join(OUT, 'index.json'), {
    'cols': ['code', 'name', 'lon', 'lat', 'gu', 'x', 'y', 'rings'],
    'areas': [[c, A[c]['name'], round(A[c]['lon'], 6), round(A[c]['lat'], 6), A[c]['gu'], round(A[c]['x']), round(A[c]['y']), A[c]['rings']]
              for c in order]})
for c in ALL:
    dump(os.path.join(OUT, 'a', f'{c}.json'), area_file(c))
for i in INDS:
    dump(os.path.join(OUT, 'dist', f'{i}.json'), DIST[i])
flow_avg = sum(num(r['총_유동인구_수']) for r in FLOW.values()) / len(FLOW) / 91
dump(os.path.join(OUT, 'seoul.json'), {
    'qS': qS, 'qF': qF, 'q8': Q8, 'years': YEARS, 'flowAvg': round(flow_avg, 2),
    'ind': {i: [INAME[i], LABEL[i]] for i in sorted(INAME)}, 'sales': INDS,
    'avg': AVG, 'gu': GU, 'trend': TREND})
cm = catmap()
dump(os.path.join(OUT, 'catmap.json'), cm)

h = A.get('3110435')
if h:
    print('서울과학기술대 중심', round(h['lon'], 5), round(h['lat'], 5))
print('상권', len(ALL), '업종(매출)', len(INDS), '업종(전체)', len(INAME), '분기', Q8[0], '~', qS, '유동', qF,
      '매핑', sum(v is not None for v in cm.values()), '/', len(cm))
