"""동별 지출(상권분석서비스 소비-행정동 OA-22166)과 구별 소득(국세청 근로소득 연말정산, 주소지)을
public/data/spend.json 하나로 묶는다.

python3 -I scripts/build_spend.py <OA-22166.csv> <x_OA-15560_5 폴더>

출력 {asOf, keys, dong:{행정동코드:[이름, 지출 항목별 원(keys 순), 1년 전 음식 지출]}, a2d:{상권코드:행정동코드},
      med:[항목별 서울 동 가운데 비중 %], gu:{구 이름: 1인당 연 총급여(만 원)}, guAsOf}
"""
import csv, glob, json, os, struct, sys
from statistics import median

SRC, AREA = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'data', 'spend.json')
KEYS = ['식료품', '음식', '의료비', '교통', '여가_문화', '교육', '의류_신발', '생활용품', '유흥', '기타']

# 국세통계 4-2-15 시·군·구별 근로소득 연말정산 신고현황(주소지), 2024년 귀속 · 1인당 평균 총급여(만 원)
GU = {'서초구': 8960, '강남구': 8925, '용산구': 8041, '송파구': 6109, '성동구': 5867, '종로구': 5722, '중구': 5712,
      '마포구': 5679, '양천구': 5496, '영등포구': 5337, '강동구': 5095, '서대문구': 4947, '동작구': 4897, '성북구': 4675,
      '광진구': 4558, '강서구': 4514, '동대문구': 4387, '노원구': 4367, '구로구': 4179, '은평구': 4135, '관악구': 3770,
      '도봉구': 3705, '중랑구': 3673, '금천구': 3632, '강북구': 3485}


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


rows = list(csv.DictReader(open(SRC, encoding='cp949')))
q = max(r['기준_년분기_코드'] for r in rows)
q0 = str(int(q[:4]) - 1) + q[4:]
ago = {r['행정동_코드']: int(r['음식_지출_총금액']) for r in rows if r['기준_년분기_코드'] == q0}
dong, shares = {}, []
for r in rows:
    if r['기준_년분기_코드'] != q:
        continue
    v = [int(r[f'{k}_지출_총금액']) for k in KEYS]
    dong[r['행정동_코드']] = [r['행정동_코드_명']] + v + [ago.get(r['행정동_코드'], 0)]
    t = sum(v)
    if t > 1e9:                      # 지출이 거의 없는 동은 가운데값에서 뺀다
        shares.append([x / t * 100 for x in v])
med = [round(median(s[k] for s in shares), 1) for k in range(len(KEYS))]

a2d = {r['TRDAR_CD']: r['ADSTRD_CD'] for r in read_dbf(glob.glob(os.path.join(AREA, '*.dbf'))[0])}
json.dump({'asOf': f'{q[:4]}년 {q[4]}분기', 'keys': [k.replace('_', '·') for k in KEYS], 'dong': dong, 'a2d': a2d, 'med': med,
           'gu': GU, 'guAsOf': '2024년 귀속'}, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
print(q, len(dong), 'dongs', len(a2d), 'areas', 'med', med, os.path.getsize(OUT) // 1024, 'KB')
