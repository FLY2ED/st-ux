"""서울 Overture 건물을 0.01도 칸 파일로 나눈다 (브라우저 리포트의 건물 색 지도·공실이 씀).

uv run --with duckdb python3 -I scripts/build_blds.py <seoul.parquet> ../midterm/data/blds
seoul.parquet: Overture buildings(class, subtype, height, num_floors, wkb), 서울 범위.
칸 파일: {"c": [건물 분류], "b": [[분류 번호, 높이 m, x0, y0, dx, dy, ...], ...]}
좌표는 칸 왼쪽 아래에서 1e-6도 단위 정수, 둘째 점부터는 앞 점과의 차이.
"""
import json, os, sys
from collections import defaultdict
import duckdb

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
c = duckdb.connect()
c.sql('INSTALL spatial; LOAD spatial')
rows = c.sql(f"""select coalesce(class, subtype, '') as cls, coalesce(height, num_floors * 3.2, 0) as h,
  ST_X(ST_Centroid(ST_GeomFromWKB(wkb))) as cx, ST_Y(ST_Centroid(ST_GeomFromWKB(wkb))) as cy,
  ST_AsGeoJSON(ST_GeomFromWKB(wkb)) as g from '{SRC}'""").fetchall()
classes, cidx = [], {}
tiles = defaultdict(list)
for cls, h, cx, cy, g in rows:
    g = json.loads(g)
    ring = g['coordinates'][0] if g['type'] == 'Polygon' else g['coordinates'][0][0] if g['type'] == 'MultiPolygon' else None
    if not ring or len(ring) < 4:
        continue
    tx, ty = int(cx * 100), int(cy * 100)
    if cls not in cidx:
        cidx[cls] = len(classes); classes.append(cls)
    pts = [(round(x * 1e6) - tx * 10000, round(y * 1e6) - ty * 10000) for x, y in ring[:-1]]
    flat = [pts[0][0], pts[0][1]]
    for (a, b), (p, q) in zip(pts, pts[1:]):
        flat += [p - a, q - b]
    tiles[(tx, ty)].append([cidx[cls], round(h or 0, 1)] + flat)
for (tx, ty), b in tiles.items():
    json.dump({'c': classes, 'b': b}, open(os.path.join(OUT, f'{tx}_{ty}.json'), 'w'), separators=(',', ':'))
print(len(rows), 'buildings', len(tiles), 'tiles', classes)
