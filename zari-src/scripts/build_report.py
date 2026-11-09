"""
기획 화면용 리포트 데이터 한 건을 만든다 (서울 간판 칸 파일 → 리포트 JSON).
사용법: python3 -I scripts/build_report.py ../midterm/data public/data
만드는 파일:
  report-gongneung-cafe.json  예시 리포트(공릉로 232 · 카페 · 반경 300m)
  seoul-grid.json             첫 화면 서울 픽셀 지도(200m 칸별 가게 수)
"""
import json, math, os, sys
from collections import Counter, defaultdict

SRC, OUT = sys.argv[1], sys.argv[2]
cats = json.load(open(os.path.join(SRC, "cats.json"), encoding="utf-8"))

# 예시 자리: 서울 노원구 공릉로 232 (서울과학기술대학교 정문 앞)
Q = {"what": "카페", "cat": cats.index("카페"), "address": "서울 노원구 공릉로 232", "near": "서울과기대 정문", "dong": "공릉동",
     "lon": 127.07655, "lat": 37.62994}
R, FAR = 300, 600
kx = 111320 * math.cos(math.radians(Q["lat"]))
ky = 110540

# 서울 간판 전부 읽기
rows = []
for f in os.listdir(os.path.join(SRC, "signs")):
    tx, ty = map(int, f[:-5].split("_"))
    for name, cat, floor, ox, oy in json.load(open(os.path.join(SRC, "signs", f), encoding="utf-8")):
        rows.append((name, cat, floor, (tx * 1000 + ox) / 1e5, (ty * 1000 + oy) / 1e5))
print("seoul shops", len(rows))

# 1) 첫 화면 픽셀 지도: 0.002도 칸
X0, X1, Y0, Y1, ST = 126.76, 127.19, 37.42, 37.71, 0.002
W, H = round((X1 - X0) / ST), round((Y1 - Y0) / ST)
g = [0] * (W * H)
for _, _, _, lon, lat in rows:
    x, y = int((lon - X0) / ST), int((Y1 - lat) / ST)
    if 0 <= x < W and 0 <= y < H:
        g[y * W + x] += 1
json.dump({"w": W, "h": H, "x0": X0, "y1": Y1, "st": ST, "g": g}, open(os.path.join(OUT, "seoul-grid.json"), "w"), separators=(",", ":"))

# 2) 예시 자리 주변
def local(lon, lat):
    return (lon - Q["lon"]) * kx, (lat - Q["lat"]) * ky

near = []
for name, cat, floor, lon, lat in rows:
    x, y = local(lon, lat)
    d = math.hypot(x, y)
    if d <= FAR:
        near.append({"n": name, "c": cat, "f": floor, "x": round(x, 1), "y": round(y, 1), "d": round(d)})
# 화면과 같은 값이 나오도록 반올림한 좌표로 거리를 다시 잰다
inR = [s for s in near if math.hypot(s["x"], s["y"]) <= R]
comp = sorted([s for s in near if s["c"] == Q["cat"]], key=lambda s: s["d"])
mix = Counter(cats[s["c"]] for s in inR).most_common(8)

# 3) 서울 상권과 비교: 가게 30곳 이상인 200m 칸 가운데에서 반경 300m 같은 업종 수
cell = defaultdict(list)
for _, cat, _, lon, lat in rows:
    cell[(int(lon / ST), int(lat / ST))].append((cat, lon, lat))
counts, shares = [], []
for (cx, cy), items in cell.items():
    if len(items) < 30:
        continue
    lon0, lat0 = (cx + .5) * ST, (cy + .5) * ST
    n = same = 0
    for dx in (-2, -1, 0, 1, 2):
        for dy in (-2, -1, 0, 1, 2):
            for cat, lon, lat in cell.get((cx + dx, cy + dy), ()):
                if math.hypot((lon - lon0) * kx, (lat - lat0) * ky) <= R:
                    n += 1
                    same += cat == Q["cat"]
    counts.append(same)
    shares.append(same / n if n else 0)
here = sum(1 for s in inR if s["c"] == Q["cat"])
share = here / len(inR)
counts.sort(); shares.sort()
pct = lambda arr, v: round(100 * sum(1 for a in arr if a > v) / len(arr))
seoul_share = sum(1 for r in rows if r[1] == Q["cat"]) / len(rows)

out = {
    "query": Q, "radius": R, "total": len(inR), "count": here, "share": round(share, 4),
    "compare": {"cells": len(counts), "medianCount": counts[len(counts) // 2], "medianShare": round(shares[len(shares) // 2], 4),
                "topPct": pct(counts, here), "sharePct": pct(shares, share), "seoulShare": round(seoul_share, 4),
                "seoulCount": sum(1 for r in rows if r[1] == Q["cat"]), "seoulShops": len(rows)},
    "floors": Counter(s["f"] for s in comp if s["d"] <= R).most_common(),
    "mix": mix,
    "competitors": [{"name": s["n"], "dist": s["d"], "x": s["x"], "y": s["y"], "floor": s["f"]} for s in comp],
    "shops": [[s["x"], s["y"], s["c"]] for s in near],
    "cats": {c: cats[c] for c in sorted({s["c"] for s in near})},
    "source": "소상공인시장진흥공단 상가(상권)정보 · 서울 · 2026년 6월",
}
json.dump(out, open(os.path.join(OUT, "report-gongneung-cafe.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("total", len(inR), "cafe", here, "share", round(share, 3), "compare", out["compare"], "mix", mix[:4])
