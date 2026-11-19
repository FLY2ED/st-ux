"""업종별 '서울 상권과 비교' 기준값을 미리 센다 (브라우저 리포트가 씀).

python3 -I scripts/build_cmp.py ../midterm/data public/data
가게 30곳 넘는 200m 칸 가운데에서 반경 300m 안 업종별 가게 수·비중의 분포를 업종마다 저장한다.
"""
import json, math, os, sys
from collections import Counter, defaultdict

SRC, OUT = sys.argv[1], sys.argv[2]
cats = json.load(open(os.path.join(SRC, 'cats.json'), encoding='utf-8'))
ST, R = 0.002, 300
kx, ky = 111320 * math.cos(math.radians(37.56)), 110540

cell = defaultdict(list)
total = Counter()
n_all = 0
for f in os.listdir(os.path.join(SRC, 'signs')):
    tx, ty = map(int, f[:-5].split('_'))
    for _, cat, _, ox, oy in json.load(open(os.path.join(SRC, 'signs', f), encoding='utf-8')):
        lon, lat = (tx * 1000 + ox) / 1e5, (ty * 1000 + oy) / 1e5
        cell[(int(lon / ST), int(lat / ST))].append((cat, lon, lat))
        total[cat] += 1
        n_all += 1

rows = []   # 칸마다 (전체 수, {업종: 수})
for (cx, cy), items in cell.items():
    if len(items) < 30:
        continue
    lon0, lat0 = (cx + .5) * ST, (cy + .5) * ST
    c = Counter()
    for dx in (-2, -1, 0, 1, 2):
        for dy in (-2, -1, 0, 1, 2):
            for cat, lon, lat in cell.get((cx + dx, cy + dy), ()):
                if math.hypot((lon - lon0) * kx, (lat - lat0) * ky) <= R:
                    c[cat] += 1
    rows.append((sum(c.values()), c))

N = len(rows)
out = {'cells': N, 'shops': n_all, 'cat': {}}
for k in range(len(cats)):
    counts = sorted(c[k] for _, c in rows)
    shares = sorted(c[k] / n if n else 0 for n, c in rows)
    # 가게 수는 값별 칸 수, 비중은 백분위 101개
    out['cat'][k] = {
        'n': total[k],
        'hist': sorted(Counter(counts).items()),
        'q': [round(shares[min(N - 1, round(i / 100 * (N - 1)))], 4) for i in range(101)],
        'mc': counts[N // 2], 'ms': round(shares[N // 2], 4),
    }
json.dump(out, open(os.path.join(OUT, 'cmp.json'), 'w', encoding='utf-8'), separators=(',', ':'))
print(N, os.path.getsize(os.path.join(OUT, 'cmp.json')))
