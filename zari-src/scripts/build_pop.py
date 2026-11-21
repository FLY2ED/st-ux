"""서울 생활인구(내국인, 250m 칸, 열린데이터광장 OA-22784) 하루하루 CSV를 평일 시간대 평균으로 묶어
public/data/pop/ 에 1km 칸으로 나눠 둔다. 지도 '생활인구' 층과 시간 재생이 읽는다.

python3 -I scripts/build_pop.py <OA-22784 CSV 폴더(하루 한 파일, ..._YYYYMMDD.csv)>

출력 pop/index.json {asOf, days, tiles:[칸 이름]}, pop/<x>_<y>.json [[경도, 위도, 0시..23시 사람 수], ...]
경도·위도는 250m 칸 가운데(EPSG:5179 → WGS84).
"""
import csv, glob, json, math, os, sys, datetime, collections
from collections import defaultdict

src = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', 'pop')
TILE = 0.01
HOL = {'20261005','20261009'}  # 대체공휴일(개천절), 한글날
# EPSG:5179 UTM-K inverse (GRS80, lat0=38 lon0=127.5 k=0.9996 FE=1e6 FN=2e6)
a=6378137.0; f=1/298.257222101; e2=f*(2-f); ep2=e2/(1-e2)
k0=0.9996; lat0=math.radians(38); lon0=math.radians(127.5)
def M(p): return a*((1-e2/4-3*e2**2/64-5*e2**3/256)*p-(3*e2/8+3*e2**2/32+45*e2**3/1024)*math.sin(2*p)+(15*e2**2/256+45*e2**3/1024)*math.sin(4*p)-(35*e2**3/3072)*math.sin(6*p))
def inv(E,N):
    x=E-1e6; m=M(lat0)+(N-2e6)/k0
    mu=m/(a*(1-e2/4-3*e2**2/64-5*e2**3/256)); e1=(1-math.sqrt(1-e2))/(1+math.sqrt(1-e2))
    p1=mu+(3*e1/2-27*e1**3/32)*math.sin(2*mu)+(21*e1**2/16-55*e1**4/32)*math.sin(4*mu)+(151*e1**3/96)*math.sin(6*mu)+(1097*e1**4/512)*math.sin(8*mu)
    s,c,t=math.sin(p1),math.cos(p1),math.tan(p1)
    C=ep2*c*c; T=t*t; Nn=a/math.sqrt(1-e2*s*s); R=a*(1-e2)/(1-e2*s*s)**1.5; D=x/(Nn*k0)
    lat=p1-(Nn*t/R)*(D*D/2-(5+3*T+10*C-4*C*C-9*ep2)*D**4/24+(61+90*T+298*C+45*T*T-252*ep2-3*C*C)*D**6/720)
    lon=lon0+(D-(1+2*T+C)*D**3/6+(5-2*C+28*T-3*C*C+8*ep2+24*T*T)*D**5/120)/c
    return math.degrees(lon),math.degrees(lat)
L='가나다라마바사아'
def cell_sw(cid):  # 국가지점번호: 문자2(100km: 가=E700km/N1300km 기준) + 4+4자리(10m 단위)
    e=700000+L.index(cid[0])*100000+int(cid[2:6])*10
    n=1300000+L.index(cid[1])*100000+int(cid[6:10])*10
    return e,n
tot=collections.defaultdict(lambda:[0.0]*24); days=set()
for fn in sorted(glob.glob(src+'/*.csv')):
    d=fn[-12:-4]
    if d in HOL or datetime.date(int(d[:4]),int(d[4:6]),int(d[6:])).weekday()>=5: continue
    days.add(d)
    r=csv.reader(open(fn,encoding='cp949')); next(r)
    for row in r:
        try: v=float(row[4])
        except ValueError: continue
        tot[row[3]][int(row[1])]+=v
n = len(days)
tiles = defaultdict(list)
for cid, h in sorted(tot.items()):
    e, nn = cell_sw(cid); lon, lat = inv(e + 125, nn + 125)
    hh = [round(x / n) for x in h]
    if max(hh) == 0:
        continue
    tiles[f'{int(lon / TILE)}_{int(lat / TILE)}'].append([round(lon, 5), round(lat, 5)] + hh)
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    os.remove(os.path.join(OUT, f))
for k, v in tiles.items():
    json.dump(v, open(os.path.join(OUT, k + '.json'), 'w'), separators=(',', ':'))
d0, d1 = sorted(days)[0], sorted(days)[-1]
json.dump({'asOf': f'{d1[:4]}년 {int(d1[4:6])}월', 'days': n, 'tile': TILE, 'tiles': sorted(tiles)}, open(os.path.join(OUT, 'index.json'), 'w'),
          ensure_ascii=False, separators=(',', ':'))
print(n, 'weekdays', d0, d1, sum(map(len, tiles.values())), 'cells', len(tiles), 'tiles')
