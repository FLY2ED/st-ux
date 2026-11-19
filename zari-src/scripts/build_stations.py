"""서울(과 바로 바깥) 지하철·전철역 이름·노선·좌표를 public/data/stations.json 으로 만든다.

python3 -I scripts/build_stations.py [overpass 응답 json]
파일을 안 주면 OpenStreetMap Overpass API(키 없음)에서 받아 온다. 자료 © OpenStreetMap 기여자, ODbL.
출력: [[역 이름, 노선, lon, lat], ...]
"""
import json, math, os, sys, time, urllib.parse, urllib.request
from collections import defaultdict

BBOX = (37.40, 126.75, 37.72, 127.20)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', 'stations.json')
Q = ('[out:json][timeout:180];rel["route"~"^(subway|train|light_rail|monorail)$"]({0},{1},{2},{3})->.r;.r out body;'
     'node(r.r)->.m;.m out;node["railway"="station"]({0},{1},{2},{3});out;').format(*BBOX)
# 도시철도 노선 ref → 화면 이름 (KTX·무궁화 같은 간선 열차는 뺀다)
LINE = {'W': '우이신설선', 'Silim': '신림선', 'I2': '인천2호선', '김포 골드라인': '김포골드라인', 'AREX': '공항철도', '공항철도': '공항철도',
        'GTX-A': 'GTX-A', '경강': '경강선', '경의·중앙': '경의중앙선', '경춘': '경춘선', '서해': '서해선', '수인·분당': '수인분당선', '신분당': '신분당선'}


def fetch():
    for i in range(6):
        try:
            req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': Q}).encode(),
                                         headers={'User-Agent': 'zari-build/1.0'})
            return json.load(urllib.request.urlopen(req, timeout=240))
        except Exception as e:
            print('다시 시도', i, e); time.sleep(15 * 2 ** i)
    raise SystemExit('Overpass 응답 없음')


def dist(a, b):
    return math.hypot((a[0] - b[0]) * 88200, (a[1] - b[1]) * 111000)


def norm(n):
    return (n or '').replace(' ', '').removesuffix('역')


def main():
    d = json.load(open(sys.argv[1], encoding='utf-8')) if len(sys.argv) > 1 else fetch()
    el = d['elements']
    nodes = {e['id']: e for e in el if e['type'] == 'node'}
    # 노선별 정차 노드
    stops = []    # (이름, (lon, lat), 노선)
    for r in el:
        if r['type'] != 'relation':
            continue
        ref = r['tags'].get('ref')
        if ref is None or (ref not in LINE and not ref.isdigit()) or ref == '201':
            continue
        ln = f'{ref}호선' if ref.isdigit() else LINE[ref]
        for m in r.get('members', []):
            n = nodes.get(m['ref']) if m['type'] == 'node' else None
            if n and 'tags' in n:
                stops.append((norm(n['tags'].get('name')), (n['lon'], n['lat']), ln))
    by_name = defaultdict(list)
    for nm, p, ln in stops:
        by_name[nm].append((p, ln))
    # 역 노드: 같은 이름 정차 노드가 500m 안이면 그 노선
    st = []
    for n in nodes.values():
        t = n.get('tags', {})
        if t.get('railway') != 'station':
            continue
        nm, p = norm(t.get('name')), (n['lon'], n['lat'])
        lines = {ln for q, ln in by_name.get(nm, []) if dist(p, q) < 500}
        if nm and lines:
            st.append([nm, lines, p])
    # 환승역처럼 같은 이름 노드가 여러 개면 하나로
    merged = []
    for nm, lines, p in st:
        for m in merged:
            if m[0] == nm and dist(m[2], p) < 600:
                m[1] |= lines; m[3].append(p); break
        else:
            merged.append([nm, set(lines), p, [p]])
    out = []
    for nm, lines, _, ps in merged:
        lon = sum(q[0] for q in ps) / len(ps); lat = sum(q[1] for q in ps) / len(ps)
        nums = sorted(int(l[:-2]) for l in lines if l.endswith('호선') and l[:-2].isdigit())
        rest = sorted(l for l in lines if not (l.endswith('호선') and l[:-2].isdigit()))
        lab = ([('·'.join(map(str, nums)) + '호선')] if nums else []) + rest
        out.append([nm + '역', '·'.join(lab), round(lon, 6), round(lat, 6)])
    out.sort()
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(len(out), '역')


main()
