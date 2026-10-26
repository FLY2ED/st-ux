"""3D 거리에 세울 서울 간판을 0.01도 칸 파일로 나눈다.

사용법: python3 -I scripts/build_signs.py <서울 CSV> ../midterm/data
칸 파일 signs/<경도*100>_<위도*100>.json 한 줄: [이름, 업종 번호(cats.json), 층(모르면 0), 칸 안 경도·위도 0.00001도 단위]
"""
import collections
import csv
import json
import math
import os
import re
import sys

SRC, OUT = sys.argv[1], sys.argv[2]
SKIP = re.compile(r"업소명없음")


def floor_of(v):
    v = v.strip().upper()
    if v in ("지", "B1"):
        return -1
    if re.fullmatch(r"B[2-9]", v):
        return -int(v[1])
    if v.isdigit() and 1 <= int(v) <= 70:
        return int(v)
    return 0


with open(os.path.join(OUT, "cats.json"), encoding="utf-8") as fh:
    cats = json.load(fh)
cat_idx = {c: i for i, c in enumerate(cats)}

tiles = collections.defaultdict(list)
with open(SRC, encoding="utf-8") as fh:
    for r in csv.DictReader(fh):
        name = r["상호명"].strip()
        if not name or SKIP.search(name) or r["상권업종소분류명"] not in cat_idx:
            continue
        lng, lat = float(r["경도"]), float(r["위도"])
        tx, ty = math.floor(lng * 100), math.floor(lat * 100)
        ox = min(999, round((lng * 100 - tx) * 1000))
        oy = min(999, round((lat * 100 - ty) * 1000))
        tiles[(tx, ty)].append([name, cat_idx[r["상권업종소분류명"]], floor_of(r["층정보"]), ox, oy])

os.makedirs(os.path.join(OUT, "signs"), exist_ok=True)
total = 0
for (tx, ty), rows in tiles.items():
    total += len(rows)
    with open(os.path.join(OUT, "signs", f"{tx}_{ty}.json"), "w", encoding="utf-8") as fh:
        json.dump(rows, fh, ensure_ascii=False, separators=(",", ":"))
print("tiles", len(tiles), "signs", total)
