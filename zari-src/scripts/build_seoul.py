"""서울 열린데이터광장 상권분석서비스 파일에서 리포트 숫자를 뽑아 src/seoul.json을 만든다.

python3 -I scripts/build_seoul.py <내려받은 폴더>
폴더에는 OA-15566/15568/15569/15576/15580/15584.csv(상권 단위, 분기),
x_OA-15572_*(추정매출 연도별), x_OA-15577_*(점포 연도별), x_OA-15560_5(상권 영역)가 있어야 한다.
CSV는 CP949. 2025년 점포 파일만 영문 머리줄이라 순서로 읽는다.
"""
import csv, glob, json, math, os, struct, sys
from collections import defaultdict

D = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'seoul.json')
HOME = '3110435'          # 서울과학기술대 상권: 공릉로 232에서 10m
NEAR_M = 600              # 가게·건물 데이터와 같은 600m 안 상권을 묶어 본다
CAFE = 'CS100010'         # 커피-음료
CMP = [('3110433', '공릉역 2번 출구', '공릉역 2번 상권 · 동일로'), ('3110427', '하계역 1번 출구', '노원 을지대병원 상권 · 하계동')]


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


# 상권 영역: 중심 좌표(TM, m)와 구
def areas():
    p = glob.glob(os.path.join(D, 'x_OA-15560_5', '*.dbf'))[0]
    d = open(p, 'rb').read()
    n, hl, rl = struct.unpack('<IHH', d[4:12])
    fs, o = [], 32
    while d[o] != 0x0D:
        fs.append((d[o:o + 11].split(b'\0')[0].decode(), d[o + 16])); o += 32
    out = {}
    for i in range(n):
        r, p0, rec = d[hl + i * rl + 1:hl + (i + 1) * rl], 0, {}
        for nm, fl in fs:
            rec[nm] = r[p0:p0 + fl].decode('utf-8', 'replace').strip(); p0 += fl
        out[rec['TRDAR_CD']] = {'name': rec['TRDAR_CD_N'], 'x': num(rec['XCNTS_VALU']), 'y': num(rec['YDNTS_VALU']), 'gu': rec['SIGNGU_CD']}
    return out


A = areas()
h = A[HOME]
def near(code):
    o = A[code]
    return sorted([c for c, a in A.items() if math.hypot(a['x'] - o['x'], a['y'] - o['y']) <= NEAR_M],
                  key=lambda c: math.hypot(A[c]['x'] - o['x'], A[c]['y'] - o['y']))


NEAR = near(HOME)

# 상권 단위 분기 파일: 가장 최근 분기만
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

# 추정매출·점포: 연도 파일 모두
SALES = defaultdict(dict)    # (상권, 업종) -> {분기: row}
for p in sorted(glob.glob(os.path.join(D, 'x_OA-15572_*', '*.csv'))):
    for r in rows(p):
        SALES[(r['상권_코드'], r['서비스_업종_코드'])][r['기준_년분기_코드']] = r
STORE = defaultdict(dict)    # (상권, 업종) -> {분기: (점포, 개업, 폐업)}
for p in sorted(glob.glob(os.path.join(D, 'x_OA-15577_*', '*.csv'))):
    for r in rows(p):
        v = list(r.values())
        STORE[(v[3], v[5])][v[0]] = (int(num(v[7])), int(num(v[10])), int(num(v[12])))
QS = sorted({q for d in SALES.values() for q in d})
qS = QS[-1]
qlab = lambda q: f"{q[2:4]}.{q[4]}Q"
qname = lambda q: f"{q[:4]}년 {q[4]}분기"


def stores(codes, ind, q):
    return sum(STORE[(c, ind)].get(q, (0, 0, 0))[0] for c in codes)


def sales(codes, ind, q, col='당월_매출_금액'):
    return sum(num(SALES[(c, ind)].get(q, {}).get(col)) for c in codes)


def per_store(codes, ind, q):
    n = stores(codes, ind, q)
    return sales(codes, ind, q) / n / 1e4 if n else 0


def share(vals):
    t = sum(vals) or 1
    return [round(v / t * 100) for v in vals]


def pctl(v, arr):
    arr = sorted(arr)
    return round(sum(a < v for a in arr) / len(arr) * 100) if arr else 50


ALL = list(A)
SEOUL_CAFE = [c for c in ALL if stores([c], CAFE, qS) >= 3 and sales([c], CAFE, qS) > 0]


# 한 상권 묶음의 카페 숫자 (본 자리·비교 후보가 같이 쓴다)
def cafe(codes):
    n = stores(codes, CAFE, qS)
    m = per_store(codes, CAFE, qS)
    cnt = sales(codes, CAFE, qS, '당월_매출_건수')
    yo = QS[-5]
    grow = (sales(codes, CAFE, qS) / sales(codes, CAFE, yo) - 1) if sales(codes, CAFE, yo) else 0
    last4 = [per_store(codes, CAFE, q) for q in QS[-4:]]
    even = min(last4) / max(last4) if max(last4) else 0
    flow = sum(num(FLOW[c]['총_유동인구_수']) for c in codes if c in FLOW) / 91 / max(len(codes), 1)
    life = sum(num(CHG[c]['운영_영업_개월_평균']) for c in codes if c in CHG) / max(len(codes), 1)
    fsum = sum(num(FLOW[c]['총_유동인구_수']) for c in codes if c in FLOW) / 91
    return dict(n=n, month=round(m), fsum=round(fsum), ticket=round(sales(codes, CAFE, qS) / cnt) if cnt else 0, grow=grow, even=even, flow=flow, life=life,
                perDay=round(cnt / 30 / n) if n else 0)


def seoul_dist():
    out = defaultdict(list)
    for c in SEOUL_CAFE:
        k = cafe([c])
        out['money'].append(k['month']); out['grow'].append(k['grow']); out['even'].append(k['even'])
        out['flow'].append(k['flow']); out['life'].append(k['life'])
    return out


SD = seoul_dist()


def score(k):
    return [['남는 돈', pctl(k['month'], SD['money'])], ['고른 매출', pctl(k['even'], SD['even'])], ['손님 모으기', pctl(k['flow'], SD['flow'])],
            ['오래 버티기', pctl(k['life'], SD['life'])], ['커지는 정도', pctl(k['grow'], SD['grow'])]]


def grade(sc):
    a = sum(v for _, v in sc) / len(sc)
    return 'A' if a >= 75 else 'B+' if a >= 62 else 'B' if a >= 50 else 'C+' if a >= 38 else 'C'


K = cafe(NEAR)
SC = score(K)
G = grade(SC)
seoul_month = round(sum(sales([c], CAFE, qS) for c in ALL) / sum(stores([c], CAFE, qS) for c in ALL) / 1e4)
seoul_ticket = round(sum(sales([c], CAFE, qS) for c in ALL) / sum(sales([c], CAFE, qS, '당월_매출_건수') for c in ALL))

# 매출 쪼개 보기 (주변 상권 카페 합)
DAYS = ['월', '화', '수', '목', '금', '토', '일']
week = share([sales(NEAR, CAFE, qS, f'{d}요일_매출_금액') for d in DAYS])
HB = [('06–11', '06~11'), ('11–14', '11~14'), ('14–17', '14~17'), ('17–21', '17~21'), ('21–24', '21~24'), ('0–6', '00~06')]
LEN = [5, 3, 3, 4, 3, 6]   # 시간대 길이(시간): 긴 칸이 커 보이지 않게 1시간 평균으로 나눔
hours = share([sales(NEAR, CAFE, qS, f'시간대_{b}_매출_금액') / k for (_, b), k in zip(HB, LEN)])
AG = [('10대', '10'), ('20대', '20'), ('30대', '30'), ('40대', '40'), ('50대', '50'), ('60대+', '60_이상')]
age = share([sales(NEAR, CAFE, qS, f'연령대_{a}_매출_금액') for _, a in AG])
fem = sales(NEAR, CAFE, qS, '여성_매출_금액'); male = sales(NEAR, CAFE, qS, '남성_매출_금액')
quarters = [[qlab(q), round(per_store(NEAR, CAFE, q))] for q in QS[-8:]]
# 분기별 계절: 최근 2년 같은 분기 평균을 연평균 100으로
bq = defaultdict(list)
for q in QS[-8:]:
    bq[q[4]].append(per_store(NEAR, CAFE, q))
avg = sum(sum(v) / len(v) for v in bq.values()) / len(bq)
season = [[f'{k}분기', round(sum(v) / len(v) / avg * 100)] for k, v in sorted(bq.items())]
vac = round(100 - (season[0][1] + season[2][1]) / 2)   # 1·3분기에 방학이 낌

# 유동인구
F = [FLOW[c] for c in NEAR if c in FLOW]
fs = lambda col: sum(num(r[col]) for r in F)
flow_day = round(fs('총_유동인구_수') / 91)
flow_seoul = round(sum(num(r['총_유동인구_수']) for r in FLOW.values()) / len(FLOW) / 91 * len(F))
FH = [('06–11', '06_11'), ('11–14', '11_14'), ('14–17', '14_17'), ('17–21', '17_21'), ('21–24', '21_24'), ('0–6', '00_06')]
fh = share([fs(f'시간대_{b}_유동인구_수') / k for (_, b), k in zip(FH, LEN)])
fw = share([fs(f'{d}요일_유동인구_수') for d in DAYS])
fa = share([fs(f'연령대_{a}_유동인구_수') for _, a in AG])
peak = FH[fh.index(max(fh))][0]

# 사는·일하는 사람, 주변 시설
Lv = [LIVE[c] for c in NEAR if c in LIVE]
Wk = [WORK[c] for c in NEAR if c in WORK]
Fc = [FAC[c] for c in NEAR if c in FAC]
Ap = [APT[c] for c in NEAR if c in APT]
ls = lambda col: round(sum(num(r[col]) for r in Lv))
fc = lambda *cols: round(sum(num(r[c]) for r in Fc for c in cols))
apt_house = [sum(num(r[f'아파트_면적_{k}_세대_수']) for r in Ap) for k in ('66_제곱미터_미만', '66_제곱미터', '99_제곱미터', '132_제곱미터', '165_제곱미터')]
apt_n = sum(apt_house)
apt_price = sum(num(r['아파트_평균_시가']) * num(r['아파트_단지_수']) for r in Ap) / max(sum(num(r['아파트_단지_수']) for r in Ap), 1)

# 지하철역: 공릉로 232에서 곧은 거리(m) → 걸어서 분 (1.3배 돌아가는 길, 분속 75m)
HERE = (37.62994, 127.07655)
ST = [('공릉역', '7호선', 37.6256, 127.0730), ('하계역', '7호선', 37.6364, 127.0682), ('태릉입구역', '6·7호선', 37.6179, 127.0751)]
def walk(lat, lon):
    m = math.hypot((lon - HERE[1]) * 111320 * math.cos(math.radians(HERE[0])), (lat - HERE[0]) * 110540)
    return round(m * 1.3 / 75)
stations = sorted([[n, l, walk(a, b)] for n, l, a, b in ST], key=lambda s: s[2])

# 상권 변화: 서울시 4가지 지표를 쉬운 말로
CH = {'HL': '줄어드는 중', 'HH': '그대로', 'LH': '커지는 중', 'LL': '자주 바뀜'}
NOTE = {'HL': '오래된 가게는 버티지만 새 가게가 잘 안 들어와요.', 'HH': '가게가 오래 버티고 바뀜이 적어요.',
        'LH': '새 가게가 들어와 자리 잡고 있어요.', 'LL': '가게가 자주 열고 닫혀요. 새로 들어오기 쉽지만 오래 버티기는 어려워요.'}
ch = CHG[HOME]
years = []
for y in sorted({q[:4] for q in QS}):
    qs = [q for q in QS if q[:4] == y]
    o = sum(STORE[(c, CAFE)].get(q, (0, 0, 0))[1] for c in NEAR for q in qs)
    cl = sum(STORE[(c, CAFE)].get(q, (0, 0, 0))[2] for c in NEAR for q in qs)
    years.append([y, o, cl])

# 맞는 업종: 주변 상권에서 가게 1곳 매출이 서울 같은 업종보다 얼마나 높은지와 가게 수
inds = {i for (c, i) in SALES if c in NEAR and i.startswith('CS1')}   # 먹고 마시는 가게만
iname = {}
for (c, i), d in SALES.items():
    if i in inds and qS in d:
        iname[i] = d[qS]['서비스_업종_코드_명']
seoul_ind = {}
for i in inds:
    s = sum(num(SALES[(c, i)].get(qS, {}).get('당월_매출_금액')) for c in ALL if (c, i) in SALES)
    n = sum(STORE[(c, i)].get(qS, (0, 0, 0))[0] for c in ALL if (c, i) in STORE)
    seoul_ind[i] = s / n if n else 0
rec = []
for i in inds:
    n = stores(NEAR, i, qS)
    if n < 2 or not seoul_ind[i] or not sales(NEAR, i, qS):
        continue
    r = per_store(NEAR, i, qS) * 1e4 / seoul_ind[i]
    sc = max(5, min(95, round(50 + 22 * math.log2(r) - 1.2 * max(n - 8, 0))))
    rec.append([iname[i].replace('-', '·'), sc, f'1곳 매출 서울 같은 업종의 {r:.1f}배 · 가게 {n}곳'])
rec.sort(key=lambda x: -x[1])
cafe_row = next((x for x in rec if x[0] == '커피·음료'), None)
fit = rec[:5]
if cafe_row and cafe_row not in fit:
    fit = rec[:4] + [cafe_row]
for x in fit:
    if x[0] == '커피·음료':
        x[0] = '카페'

# 노원구 뜨는 상권: 카페 매출 합 1년 증가율 (카페 3곳 넘는 상권)
gu = h['gu']
tr = []
for c, a in A.items():
    if a['gu'] != gu or stores([c], CAFE, qS) < 3:
        continue
    now, ago = sales([c], CAFE, qS), sales([c], CAFE, QS[-5])
    if ago:
        tr.append([a['name'], round((now / ago - 1) * 100), f"카페 {stores([c], CAFE, qS)}곳"])
tr.sort(key=lambda x: -x[1])
trend = [[n, f"{'+' if v >= 0 else ''}{v}%", w] for n, v, w in tr[:5]]

# 좋은 점 · 조심할 점: 숫자에서 자동으로
good, warn = [], []
r_m = K['month'] / seoul_month
(good if r_m >= 1 else warn).append(f"카페 1곳 월매출이 서울 평균의 {r_m:.1f}배예요." if r_m >= 1 else f"카페 1곳 월매출이 서울 평균보다 {round((1 - r_m) * 100)}% 적어요.")
r_f = flow_day / flow_seoul
(good if r_f >= 1 else warn).append(f"유동인구가 서울 상권 평균의 {r_f:.1f}배예요." if r_f >= 1 else f"유동인구가 서울 상권 평균보다 {round((1 - r_f) * 100)}% 적어요.")
oc = sum(y[1] for y in years), sum(y[2] for y in years)
(good if oc[0] >= oc[1] else warn).append(f"최근 3년 카페 개업 {oc[0]}곳, 폐업 {oc[1]}곳이에요.")
if K['grow'] >= 0:
    good.append(f"카페 매출이 1년 전보다 {round(K['grow'] * 100)}% 늘었어요.")
else:
    warn.append(f"카페 매출이 1년 전보다 {round(-K['grow'] * 100)}% 줄었어요.")
we = (week[5] + week[6]) / 2 / (sum(week[:5]) / 5)
if we < .85:
    warn.append(f"주말 하루 매출이 평일의 {round(we * 100)}% 수준이에요.")
if vac >= 5:
    warn.append(f"방학이 낀 1·3분기 매출이 다른 분기보다 {vac}% 적어요.")
if num(ch['운영_영업_개월_평균']) < num(ch['서울_운영_영업_개월_평균']):
    warn.append(f"가게 평균 영업 기간이 {round(num(ch['운영_영업_개월_평균']))}개월로 서울({round(num(ch['서울_운영_영업_개월_평균']))}개월)보다 짧아요.")

wd = sum(week[:5]) / 5
title = '평일 장사 자리' if we < .85 else '주말에도 붐비는 자리'
if fa[1] >= 25:
    title = '대학가 ' + title


def cmp_row(code, name, sub):
    k = cafe(near(code)); sc = score(k)
    return {'name': name, 'sub': sub, 'cafes': k['n'], 'sales': k['month'], 'flow': k['fsum'], 'grade': grade(sc)}


out = {
    'asOf': {'sales': qname(qS), 'flow': qname(qF)},
    'area': {'home': A[HOME]['name'], 'near': [A[c]['name'] for c in NEAR], 'n': len(NEAR)},
    'grade': {'g': G, 't': title, 's': f"{A[HOME]['name']} 상권 등 걸어서 닿는 상권 {len(NEAR)}곳 기준"},
    'score': SC,
    'insight': {'good': good[:3], 'warn': warn[:3]},
    'sales': {'month': K['month'], 'seoul': seoul_month, 'ticket': K['ticket'], 'seoulTicket': seoul_ticket, 'perDay': K['perDay'], 'stores': K['n'],
              'quarters': quarters, 'season': season, 'vac': vac, 'week': [[d, v] for d, v in zip(DAYS, week)],
              'hours': [[n, v] for (n, _), v in zip(HB, hours)], 'age': [[n, v] for (n, _), v in zip(AG, age)],
              'female': round(fem / (fem + male) * 100) if fem + male else 50, 'grow': round(K['grow'] * 100)},
    'flow': {'day': flow_day, 'seoul': flow_seoul, 'peak': peak, 'hours': [[n, v] for (n, _), v in zip(FH, fh)],
             'week': [[d, v] for d, v in zip(DAYS, fw)], 'age': [[n, v] for (n, _), v in zip(AG, fa)],
             'female': round(fs('여성_유동인구_수') / max(fs('총_유동인구_수'), 1) * 100)},
    'people': {'live': ls('총_상주인구_수'), 'work': round(sum(num(r['총_직장_인구_수']) for r in Wk)), 'house': ls('총_가구_수'),
               'aptHouse': ls('아파트_가구_수'), 'otherHouse': ls('비_아파트_가구_수')},
    'place': {'stations': stations, 'bus': fc('버스_정거장_수'), 'subway': fc('지하철_역_수'),
              'schools': [['대학교', fc('대학교_수')], ['고등학교', fc('고등학교_수')], ['중학교', fc('중학교_수')], ['초등학교', fc('초등학교_수')]],
              'etc': [['병원', fc('종합병원_수', '일반_병원_수')], ['약국', fc('약국_수')], ['은행', fc('은행_수')], ['관공서', fc('관공서_수')], ['슈퍼마켓', fc('슈퍼마켓_수')]],
              'apt': {'complex': fc and round(sum(num(r['아파트_단지_수']) for r in Ap)), 'house': round(apt_n), 'price': round(apt_price / 1e8, 1),
                      'sizes': [['66㎡ 미만', round(apt_house[0] / max(apt_n, 1) * 100)], ['66–99㎡', round(apt_house[1] / max(apt_n, 1) * 100)],
                                ['99㎡ 이상', round(sum(apt_house[2:]) / max(apt_n, 1) * 100)]]}},
    'change': {'state': CH[ch['상권_변화_지표']], 'stateNote': NOTE[ch['상권_변화_지표']], 'states': ['줄어드는 중', '그대로', '커지는 중', '자주 바뀜'],
               'years': years, 'life': round(num(ch['운영_영업_개월_평균']) / 12, 1), 'lifeSeoul': round(num(ch['서울_운영_영업_개월_평균']) / 12, 1)},
    'recommend': fit,
    'trend': trend,
    'compare': [{'name': '공릉로 232', 'sub': '서울과기대 정문', 'cafes': K['n'], 'sales': K['month'], 'flow': flow_day, 'grade': G}]
               + [cmp_row(c, n, s) for c, n, s in CMP],
}
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False)[:4000])
