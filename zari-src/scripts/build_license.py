"""서울 인허가 이력(행정안전부 지방행정 인허가, file.localdata.go.kr)에서 가게마다 업종·좌표·개업월·폐업월만 남겨
public/data/lic/ 에 1km 칸으로 나눠 둔다. 브라우저가 내 자리 반경 안 같은 업종의 생존율·문 연 지를 직접 센다.

python3 -I scripts/build_license.py <seoul.csv>
  seoul.csv: kind,name,subtype,open(YYYYMMDD),close,status,lon,lat (WGS84)

출력
  lic/index.json {asOf:YYYYMM, codes:[서비스업종 코드...], tiles:[칸 이름...], seoul:{코드:{s:[1·3·5년 생존 %], n:[표본], ages:[4칸 %]}}}
  lic/t/<x>_<y>.json  [코드번호, 경도*1e5-칸, 위도*1e5-칸, 개업월, 폐업월(영업 중이면 0), ...] 5개씩 이어 붙인 정수 배열
  월은 2000-01을 0으로 센 수.
"""
import csv, json, os, sys
from collections import defaultdict

SRC = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'data', 'lic')
FROM = 2010                        # 이 해 이후 문 연 가게와 지금 영업 중인 가게만 남긴다
TILE = 0.01                        # 칸 크기(도). 경도 약 880m · 위도 약 1.1km

# 상권분석서비스 업종 코드 → (인허가 종류, 업태 이름들)
MAP = {
    'CS100001': [('general', '한식')],
    'CS100002': [('general', '중국식')],
    'CS100003': [('general', '일식'), ('general', '횟집')],
    'CS100004': [('general', '경양식'), ('general', '외국음식전문점(인도,태국등)')],
    'CS100005': [('bakery', '*'), ('rest', '과자점')],
    'CS100006': [('rest', '패스트푸드'), ('general', '패스트푸드')],
    'CS100007': [('general', '통닭(치킨)'), ('general', '호프/통닭')],   # 요즘 치킨집은 대개 호프/통닭으로 신고
    'CS100008': [('general', '분식'), ('general', '김밥(도시락)')],
    'CS100009': [('general', '호프/통닭'), ('general', '정종/대포집/소주방')],
    'CS100010': [('rest', '커피숍'), ('general', '까페'), ('general', '전통찻집')],
    'CS200028': [('beauty', '일반미용업')],
    'CS200029': [('beauty', '네일아트업')],
    'CS200030': [('beauty', '피부미용업')],
    'CS300002': [('rest', '편의점')],
}
CODES = list(MAP)
look = {}                          # (종류, 업태) → 코드 번호들. 호프/통닭은 치킨·호프 둘 다
for c, pairs in MAP.items():
    for k, s in pairs:
        look.setdefault((k, s), []).append(CODES.index(c))


def month(d):
    return (int(d[:4]) - 2000) * 12 + int(d[4:6]) - 1 if d and len(d) >= 6 and d[:4].isdigit() else None


rows, last = [], 0
for r in csv.DictReader(open(SRC, encoding='utf-8')):
    cis = look.get((r['kind'], r['subtype'])) or look.get((r['kind'], '*'))
    if not cis or not r['lon']:
        continue
    o, c = month(r['open']), month(r['close'])
    alive = r['status'].startswith('영업')
    if o is None or o < 0 or (not alive and c is None):
        continue                   # 개업월이 없거나, 문 닫았는데 폐업월이 없는 기록
    if c is not None and not alive and c < o:
        continue
    if o < (FROM - 2000) * 12 and not alive:
        continue
    lon, lat = float(r['lon']), float(r['lat'])
    if not (126.7 < lon < 127.3 and 37.4 < lat < 37.75):
        continue
    last = max(last, o, c or 0)
    rows.extend((ci, lon, lat, o, 0 if alive else c) for ci in cis)

NOW = last


def stats(rs):
    """rs: (개업월, 폐업월) 목록 → k년 생존율(그 k년을 다 지난 개업 묶음만), 지금 가게 문 연 지 4칸"""
    s, n = [], []
    for k in (1, 3, 5):
        co = [(o, c) for o, c in rs if (FROM - 2000) * 12 <= o <= NOW - k * 12]
        live = sum(1 for o, c in co if c == 0 or c - o >= k * 12)
        s.append(round(live / len(co) * 100) if co else None); n.append(len(co))
    age = [0, 0, 0, 0]
    for o, c in rs:
        if c == 0:
            y = (NOW - o) / 12
            age[0 if y < 1 else 1 if y < 3 else 2 if y < 5 else 3] += 1
    t = sum(age)
    return {'s': s, 'n': n, 'ages': [round(a / t * 100) for a in age] if t else None}


by = defaultdict(list)
for r in rows:
    by[r[0]].append((r[3], r[4]))
seoul = {CODES[i]: stats(v) for i, v in sorted(by.items())}

tiles = defaultdict(list)
for ci, lon, lat, o, c in rows:
    tx, ty = int(lon / TILE), int(lat / TILE)
    tiles[f'{tx}_{ty}'].extend([ci, round(lon * 1e5) - tx * 1000, round(lat * 1e5) - ty * 1000, o, c])

os.makedirs(os.path.join(OUT, 't'), exist_ok=True)
for f in os.listdir(os.path.join(OUT, 't')):
    os.remove(os.path.join(OUT, 't', f))
size = 0
for k, v in tiles.items():
    p = os.path.join(OUT, 't', k + '.json')
    json.dump(v, open(p, 'w'), separators=(',', ':')); size += os.path.getsize(p)
y, m = divmod(NOW, 12)
json.dump({'asOf': f'{2000 + y}{m + 1:02d}', 'from': FROM, 'tile': TILE, 'codes': CODES, 'tiles': sorted(tiles), 'seoul': seoul},
          open(os.path.join(OUT, 'index.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('shops', len(rows), 'tiles', len(tiles), 'total', size // 1024, 'KB', 'asOf', 2000 + y, m + 1)
for c, v in seoul.items():
    print(c, v)
