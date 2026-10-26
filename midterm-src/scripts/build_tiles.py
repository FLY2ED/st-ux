"""상가 CSV 전체(277만 곳)를 지도용 벡터 타일(PMTiles)로 만든다.

사용법: python3 -I scripts/build_tiles.py <CSV 폴더> ../midterm/data/tiles <tippecanoe 경로>

- overview.pmtiles: 전국~동네를 볼 때(z4~13). 빽빽한 곳은 점을 덜어 내고 업종 번호만 담는다
- <지역>.pmtiles: 골목까지 당겼을 때(z14, 더 당기면 지도가 늘려 그린다). 한 곳도 빼지 않고 이름·업종·층을 담는다
  z12·13 에 전부 담으면 강남 한 칸이 수 MB 라서 z14 한 단계만 만든다
GitHub Pages 는 파일 하나가 100MB 를 넘으면 못 올리므로 시도별로 나눈다.
타일 한 장: 레이어 s, 속성 n(상호명, 상세만) c(업종 번호, cats.json) f(층, 모르면 없음)
"""
import csv
import glob
import json
import os
import re
import subprocess
import sys

SRC, OUT, TIPPECANOE = sys.argv[1], sys.argv[2], sys.argv[3]
SKIP = re.compile(r"업소명없음")

with open(os.path.join(os.path.dirname(os.path.abspath(OUT)), "cats.json"), encoding="utf-8") as fh:
    cats = json.load(fh)
cat_idx = {c: i for i, c in enumerate(cats)}


def floor_of(v):
    v = v.strip().upper()
    if v in ("지", "B1"):
        return -1
    if re.fullmatch(r"B[2-9]", v):
        return -int(v[1])
    if v.isdigit() and 1 <= int(v) <= 70:
        return int(v)
    return None


def rows(path):
    with open(path, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            name = r["상호명"].strip()
            cat = cat_idx.get(r["상권업종소분류명"])
            if not name or SKIP.search(name) or cat is None:
                continue
            try:
                lng, lat = float(r["경도"]), float(r["위도"])
            except ValueError:
                continue
            if not (124 < lng < 132 and 33 < lat < 39):
                continue
            yield name, cat, floor_of(r["층정보"]), round(lng, 6), round(lat, 6)


def tippecanoe(out, args):
    return subprocess.Popen(
        [TIPPECANOE, "-q", "-f", "-o", out, "-l", "s", "-P", "-T", "c:int", "-T", "f:int", *args],
        stdin=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )


def feature(lng, lat, props):
    return json.dumps({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lng, lat]}, "properties": props}, ensure_ascii=False, separators=(",", ":"))


os.makedirs(OUT, exist_ok=True)
overview = tippecanoe(os.path.join(OUT, "overview.pmtiles"), ["-Z4", "-z13", "-r1.6", "--drop-densest-as-needed", "-M", "400000"])
regions = {}
total = 0
for path in sorted(glob.glob(os.path.join(SRC, "*.csv"))):
    region = re.search(r"정보_(.+?)_\d{6}\.csv$", os.path.basename(path)).group(1)
    out = os.path.join(OUT, f"{region}.pmtiles")
    # 골목 단계에선 한 곳도 덜어 내지 않는다: 타일 크기·개수 상한을 풀고 z14 에 전부 담는다
    detail = tippecanoe(out, ["-Z14", "-z14", "-r1", "--no-feature-limit", "--no-tile-size-limit"])
    box = [180, 90, -180, -90]
    n = 0
    for name, cat, floor, lng, lat in rows(path):
        props = {"n": name, "c": cat}
        if floor is not None:
            props["f"] = floor
        detail.stdin.write(feature(lng, lat, props) + "\n")
        overview.stdin.write(feature(lng, lat, {"c": cat}) + "\n")
        box = [min(box[0], lng), min(box[1], lat), max(box[2], lng), max(box[3], lat)]
        n += 1
    detail.stdin.close()
    if detail.wait():
        sys.exit(f"tippecanoe 실패: {region}")
    regions[region] = {"count": n, "bounds": [round(v, 4) for v in box], "bytes": os.path.getsize(out)}
    total += n
    print(region, n, f"{os.path.getsize(out) / 1e6:.1f}MB", flush=True)

overview.stdin.close()
if overview.wait():
    sys.exit("tippecanoe 실패: overview")
print("overview", f"{os.path.getsize(os.path.join(OUT, 'overview.pmtiles')) / 1e6:.1f}MB")

with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as fh:
    json.dump({"total": total, "detailMinZoom": 14, "regions": regions}, fh, ensure_ascii=False, separators=(",", ":"))
print("total", total)
