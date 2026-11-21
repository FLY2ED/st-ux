"""한국부동산원 상업용부동산 임대동향조사(상가 통계표 xlsx)의 서울 조사 상권 임대료·공실률과
서울시 상가임대차 실태조사(2023) 상권별 권리금을 public/data/rent.json 으로 묶는다.

python3 -I scripts/build_rent.py <상가 통계표.xlsx> <OSM 역 overpass json>
  통계표: R-ONE 공표보고서 '상업용부동산 임대동향조사' 분기 상가 통계표(공표용)
  역: 상권 이름 → 대표 지하철역 좌표

출력 {asOf, q:[최근 8분기], seoul:{rent, vac, trend, key}, areas:[[이름, 권역, 경도, 위도, 임대료, 공실률, 추세[8], 권리금|null, 'small'|'mid']],
      keys:[[조사 상권 이름, 경도, 위도, 권리금]]}
임대료는 만 원/㎡·월(1층). 소규모 상가 값을 쓰고 없으면 중대형 값.
"""
import json, os, re, sys, zipfile
import xml.etree.ElementTree as ET

XLSX, OSM = sys.argv[1], sys.argv[2]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', 'rent.json')
KEY_SEOUL = 6438                   # 서울시 2023 실태조사 점포당 평균 권리금(만 원, 보고서 27쪽)

import xml.etree.ElementTree as ET
NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
def sheets(z):
    wb=ET.fromstring(z.read('xl/workbook.xml'))
    rels=ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    rm={r.get('Id'):r.get('Target') for r in rels}
    out=[]
    for s in wb.find('m:sheets',NS):
        t=rm[s.get('{%s}id'%NS['r'])]
        out.append((s.get('name'),'xl/'+t.lstrip('/').replace('xl/','')))
    return out
def sst(z):
    if 'xl/sharedStrings.xml' not in z.namelist(): return []
    r=ET.fromstring(z.read('xl/sharedStrings.xml'))
    return [''.join(t.text or '' for t in si.iter('{%s}t'%NS['m'])) for si in r]
def rows(z,path,ss,maxrows=None):
    n=0
    for ev,el in ET.iterparse(z.open(path)):
        if el.tag=='{%s}row'%NS['m']:
            row={}
            for c in el:
                ref=c.get('r');col=re.match('[A-Z]+',ref).group()
                v=c.find('m:v',NS)
                if v is None:
                    is_=c.find('m:is',NS)
                    if is_ is not None: row[col]=''.join(t.text or '' for t in is_.iter('{%s}t'%NS['m']))
                    continue
                row[col]=ss[int(v.text)] if c.get('t')=='s' else v.text
            yield int(el.get('r')),row
            el.clear();n+=1
            if maxrows and n>=maxrows: return

M={'광화문':['광화문'],'남대문':['회현'],'동대문':['동대문역사문화공원'],'명동':['명동'],'방산시장':['을지로4가'],'북촌':['안국'],'서촌':['경복궁'],'시청':['시청'],'을지로':['을지로3가'],'종로':['종로3가'],'충무로':['충무로'],
'강남대로':['강남'],'교대역':['교대'],'남부터미널':['남부터미널'],'논현역':['논현'],'도산대로':['신사','압구정로데오'],'방배역/내방역':['방배','내방'],'서래마을':['고속터미널'],'신사역':['신사'],'압구정':['압구정'],'양재말죽거리':['양재시민의숲'],'양재역':['양재'],'청담':['청담'],'테헤란로':['역삼'],'학동/강남구청역':['학동','강남구청'],
'공덕역':['공덕'],'당산역':['당산'],'동교/연남':['홍대입구'],'망원역':['망원'],'신촌/이대':['신촌','이대'],'영등포역':['영등포'],'홍대/합정':['홍대입구','합정'],
'가락시장':['가락시장'],'건대입구':['건대입구'],'경희대':['회기'],'구로디지털단지역':['구로디지털단지'],'구의역':['구의'],'군자':['군자'],'까치산역':['까치산'],'낙성대':['낙성대'],'노량진':['노량진'],'독산/시흥':['독산'],'뚝섬':['뚝섬'],'목동':['목동'],'미아사거리':['미아사거리'],'불광역':['불광'],'사당':['사당'],'상계역':['상계'],'상봉역':['상봉'],'서울대입구역':['서울대입구'],'성신여대':['성신여대입구'],'수유':['수유'],'숙명여대':['숙대입구'],'신림역':['신림'],'쌍문역':['쌍문'],'약수역':['약수'],'연신내':['연신내'],'오류동역':['오류동'],'왕십리':['왕십리'],'용산역':['용산'],'이태원':['이태원'],'잠실/송파':['잠실'],'잠실새내역':['잠실새내'],'장안동':['장한평'],'천호':['천호'],'청량리':['청량리'],'혜화동':['혜화'],'화곡':['화곡']}
# 서울시 2023 실태조사 권리금(만 원, 27~28쪽 표): 부동산원 상권 → (조사 상권 이름, 값, 이름 일치도)
K={'광화문':('광화문역',15197,'exact'),'명동':('명동(명동거리)',16146,'partial'),'북촌':('북촌',3667,'exact'),'서촌':('서촌',3868,'exact'),'시청':('시청역 1번',16295,'exact'),'을지로':('을지로3가역',5685,'exact'),'종로':('종로3가역',4200,'exact'),'충무로':('충무로역',2438,'exact'),
'강남대로':('강남역',9277,'exact'),'교대역':('교대역(법원·검찰청)',6644,'exact'),'남부터미널':('남부터미널역',4274,'exact'),'논현역':('논현역',4141,'exact'),'방배역/내방역':('방배역',4703,'partial'),'신사역':('신사역',5861,'exact'),'압구정':('압구정역',6829,'exact'),'양재역':('양재역',4664,'exact'),
'공덕역':('공덕역',5982,'exact'),'당산역':('당산역',12294,'exact'),'동교/연남':('연남동',7512,'partial'),'망원역':('망리단길',4687,'partial'),'영등포역':('영등포역',3857,'exact'),'홍대/합정':('홍대입구역',11026,'partial'),
'가락시장':('가락시장역',5804,'exact'),'건대입구':('건대입구역',8240,'exact'),'경희대':('경희대학교',7113,'exact'),'구로디지털단지역':('구로디지털단지역역',7447,'exact'),'구의역':('구의역',5829,'exact'),'군자':('군자역',5923,'exact'),'까치산역':('까치산역',3608,'exact'),'낙성대':('낙성대역',10820,'exact'),'노량진':('노량진역',5173,'exact'),'뚝섬':('뚝섬역',6588,'exact'),'목동':('목동사거리',3804,'partial'),'미아사거리':('미아사거리역',2986,'exact'),'불광역':('불광역',3886,'exact'),'사당':('사당역',16525,'exact'),'상봉역':('상봉역',4593,'exact'),'서울대입구역':('서울대입구역',6500,'exact'),'성신여대':('성신여대',6798,'exact'),'수유':('수유역',4762,'exact'),'숙명여대':('숙대입구',5346,'partial'),'신림역':('신림역',16843,'exact'),'쌍문역':('쌍문역1번(쌍리단길)',2431,'exact'),'약수역':('약수역',8076,'exact'),'연신내':('연신내역',1659,'exact'),'오류동역':('오류동역',5317,'exact'),'왕십리':('왕십리역',2069,'exact'),'이태원':('이태원역',5411,'exact'),'잠실새내역':('잠실새내역(신천)',5575,'exact'),'천호':('천호역',2267,'exact'),'청량리':('청량리역',3889,'exact'),'혜화동':('혜화역',6293,'exact'),'화곡':('화곡역',5003,'exact')}

Z = zipfile.ZipFile(XLSX)
ss, sh = sst(Z), dict(sheets(Z))


def load(n):
    """시트 n의 서울 상권별 분기 값 {이름: (권역, [값...])}, 분기 이름 목록"""
    rs = list(rows(Z, sh[n], ss))
    hdr = rs[3][1]
    cols = [k for k, v in hdr.items() if re.fullmatch(r'\d{4}\.\dQ', v or '')]
    cols.sort(key=lambda k: hdr[k])
    out, a, region = {}, '', None
    for _, row in rs[4:]:
        a = row.get('A', a)
        if a.strip() != '서울':
            continue
        b = row['B'].strip()
        if b.startswith('소계'):
            region = b[3:-1]; continue
        v = [float(row[c]) if row.get(c) not in (None, '') else None for c in cols]
        out['__seoul__' if b == '계' else b] = (region, v)
    return out, [hdr[c] for c in cols]


r_s, Q = load('304'); v_s, _ = load('303'); r_m, _ = load('204'); v_m, _ = load('203')
osm = json.load(open(OSM))
ST = {}
for e in osm['elements']:
    t = e.get('tags', {})
    if e['type'] == 'node' and t.get('railway') == 'station' and 'lat' in e:
        ST.setdefault(t['name'], (e['lat'], e['lon']))

r1 = lambda x: None if x is None else round(x / 10, 2)      # 천원 → 만 원
last8 = lambda v: [r1(x) for x in v[-8:]]
areas = []
for name, (region, mv) in r_m.items():
    if name == '__seoul__':
        continue
    ps = [ST[s] for s in M[name]]
    lat, lon = sum(p[0] for p in ps) / len(ps), sum(p[1] for p in ps) / len(ps)
    sm = name in r_s and r_s[name][1][-1] is not None
    rv, vv = (r_s[name][1], v_s[name][1]) if sm else (mv, v_m[name][1])
    areas.append([name, region, round(lon, 5), round(lat, 5), r1(rv[-1]), round(vv[-1], 1), last8(rv),
                  K[name][1] if name in K else None, 'small' if sm else 'mid'])
# 권리금 지점: 부동산원 상권과 이름이 맞는 조사 상권 + 노원구 조사 상권(부동산원 상권 없음, 보고서 27~28쪽)
EXTRA_KEY = [('공릉역', ST['공릉'], 3408), ('노원역', ST['노원'], 5767)]
keys = [[K[a[0]][0], a[2], a[3], a[7]] for a in areas if a[7] is not None]
keys += [[n, round(p[1], 5), round(p[0], 5), v] for n, p, v in EXTRA_KEY]
q = Q[-1]
json.dump({'asOf': f'{q[:4]}년 {q[5]}분기', 'q': [f"{x[2:4]}.{x[5]}Q" for x in Q[-8:]],
           'seoul': {'rent': r1(r_s['__seoul__'][1][-1]), 'vac': round(v_s['__seoul__'][1][-1], 1), 'trend': last8(r_s['__seoul__'][1]), 'key': KEY_SEOUL},
           'areas': areas, 'keys': keys}, open(OUT, 'w'), ensure_ascii=False, separators=(',', ':'))
print(len(areas), 'areas', sum(1 for a in areas if a[7]), 'with key', os.path.getsize(OUT) // 1024, 'KB')
for a in areas:
    if a[0] in ('상계역', '홍대/합정', '성수', '뚝섬', '강남대로'):
        print(a)
