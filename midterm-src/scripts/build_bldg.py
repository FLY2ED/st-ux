"""3D 거리 프리셋의 건물을 국토교통부 GIS건물통합정보(브이월드, CC BY)로 바꾼다.

사용법: python3 -I scripts/build_bldg.py <AL_D010_11_*.shp 경로(확장자 없이)> ../midterm/data
필요한 패키지: pyshp, pyproj
build_world.mjs로 OSM 지도를 구운 뒤에 돌린다. 건물 이름이 GIS에 없으면 같은 자리의 OSM 이름을 쓴다.
한 줄: [높이 m, 이름, 외곽선 동·북 미터, 겉모습, 지상 층수, 주용도, 사용승인 연도]
"""
import glob
import json
import math
import os
import sys

import shapefile
from pyproj import Transformer

SRC, OUT = sys.argv[1], sys.argv[2]
# 컬럼: A9 주용도, A11 구조, A13 사용승인일, A16 높이, A24 건물명, A25 동명, A26 지상층수
USE, STRUCT, BUILT, HEIGHT, NAME, DONG, FLOORS = 9, 11, 13, 16, 24, 25, 26

to_lnglat = Transformer.from_crs("EPSG:5186", "EPSG:4326", always_xy=True)
to_tm = Transformer.from_crs("EPSG:4326", "EPSG:5186", always_xy=True)


def look_of(use, struct, floors):
    if use == "공동주택":
        return "apt" if floors >= 6 else "villa"
    if use == "단독주택":
        return "brick" if "벽돌" in struct else "house"
    if use == "업무시설":
        return "office"
    if use in ("교육연구시설", "노유자시설"):
        return "school"
    if use == "종교시설":
        return "church"
    if "근린생활" in use or use == "판매시설":
        return "brick" if "벽돌" in struct else "retail"
    return "office" if floors >= 10 else "other"


def inside(x, y, flat):
    hit = False
    n = len(flat) // 2
    j = n - 1
    for i in range(n):
        xi, yi, xj, yj = flat[i * 2], flat[i * 2 + 1], flat[j * 2], flat[j * 2 + 1]
        if (yi > y) != (yj > y) and x < xi + (y - yi) / (yj - yi) * (xj - xi):
            hit = not hit
        j = i
    return hit


sf = shapefile.Reader(SRC, encoding="cp949")
for path in sorted(glob.glob(os.path.join(OUT, "world", "*.json"))):
    with open(path, encoding="utf-8") as fh:
        world = json.load(fh)
    if world.get("bsrc") == "gis":
        print(os.path.basename(path), "already gis, skip")
        continue
    lng, lat, r = world["lng"], world["lat"], world["r"]
    kx = 111320 * math.cos(math.radians(lat))
    ky = 110540
    cx, cy = to_tm.transform(lng, lat)
    bbox = [cx - r - 50, cy - r - 50, cx + r + 50, cy + r + 50]
    # OSM 건물 이름은 무게중심으로 GIS 건물에 옮긴다
    osm_names = []
    for b in world["b"]:
        if b[1]:
            pts = b[2]
            n = len(pts) // 2
            osm_names.append((sum(pts[0::2]) / n, sum(pts[1::2]) / n, b[1]))
    out = []
    for sr in sf.iterShapeRecords(bbox=bbox):
        shape, rec = sr.shape, sr.record
        if not shape.points:
            continue
        end = shape.parts[1] if len(shape.parts) > 1 else len(shape.points)
        flat = []
        for x, y in shape.points[:end]:
            lo, la = to_lnglat.transform(x, y)
            flat += [round((lo - lng) * kx * 2) / 2, round((la - lat) * ky * 2) / 2]
        mx = sum(flat[0::2]) / (len(flat) // 2)
        my = sum(flat[1::2]) / (len(flat) // 2)
        if math.hypot(mx, my) > r:
            continue
        floors = int(rec[FLOORS] or 0)
        height = float(rec[HEIGHT] or 0)
        if height < 2 or height > 400:
            height = max(1, floors or 2) * 3.3
        name, dong = str(rec[NAME]).strip(), str(rec[DONG]).strip()
        if dong and dong not in name:
            name = f"{name} {dong}".strip()
        if not name:
            name = next((nm for ox, oy, nm in osm_names if inside(ox, oy, flat)), "")
        use = str(rec[USE]).strip()
        built = str(rec[BUILT])[:4]
        year = int(built) if built.isdigit() else 0
        out.append([round(height), name, flat, look_of(use, str(rec[STRUCT]), floors), floors, use, year])
    world["b"] = out
    world["bsrc"] = "gis"
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(world, fh, ensure_ascii=False, separators=(",", ":"))
    named = sum(1 for b in out if b[1])
    print(os.path.basename(path), "buildings", len(out), "named", named)
