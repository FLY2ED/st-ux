"""소상공인시장진흥공단 상가(상권)정보 CSV를 정적 JSON으로 가공한다.

사용법: python3 -I scripts/build_data.py <CSV 폴더> ../midterm/data
"""
import collections
import csv
import glob
import json
import os
import random
import re
import sys

SRC, OUT = sys.argv[1], sys.argv[2]
BUCKETS = 1024
SAMPLE = 24
random.seed(7)

STREET = [
    ("flower", "꽃집", "꽃집", "💐"),
    ("bread", "빵/도넛", "빵집", "🥨"),
    ("cafe", "카페", "카페", "☕"),
    ("pharm", "약국", "약국", "💊"),
    ("ricecake", "떡/한과", "떡집", "🍡"),
    ("laundry", "세탁소", "세탁소", "👔"),
    ("karaoke", "노래방", "노래방", "🎤"),
    ("hair", "미용실", "미용실", "💇"),
    ("chicken", "치킨", "치킨집", "🍗"),
    ("book", "서점", "서점", "📚"),
    ("hardware", "철물/공구 소매업", "철물점", "🔨"),
    ("snack", "김밥/만두/분식", "분식집", "🍙"),
]
GENERIC = re.compile(r"(업소명없음|공인중개|컴퓨터수리|입주청소|학원$|컨설팅|업$|슈퍼마켓$|교습소?$|^약국$|^노래연습장$|^카페$|^서점$|^꽃집$)")
HANGUL2 = re.compile(r"[가-힣]{2}")
# 프랜차이즈 브랜드. 이름이 이 표기로 시작하면 그 브랜드로 본다 (준오헤어코엑스몰 → 준오헤어).
# 지점명 칸은 업종마다 채우는 습관이 달라서 브랜드 목록이 먼저고, 지점명 비율은 목록 밖을 찾는 데만 쓴다.
BRANDS = {
    # 카페·디저트
    "스타벅스": [], "투썸플레이스": [], "이디야커피": ["이디야"], "메가커피": ["메가엠지씨커피", "메가MGC커피"],
    "컴포즈커피": [], "빽다방": [], "더벤티": [], "할리스": [], "커피빈": [], "파스쿠찌": [], "엔제리너스": [],
    "탐앤탐스": [], "폴바셋": [], "공차": [], "매머드커피": ["매머드익스프레스"], "커피베이": [], "요거프레소": [],
    "설빙": [], "커피에반하다": [], "감성커피": [], "하삼동커피": [], "텐퍼센트커피": [], "더리터": [],
    "셀렉토커피": [], "바나프레소": [], "달콤커피": [], "드롭탑": [], "빈스빈스": [], "만랩커피": [],
    "배스킨라빈스": ["베스킨라빈스"], "던킨": [], "크리스피크림": [],
    # 빵·떡
    "파리바게뜨": ["파리바게트"], "뚜레쥬르": [], "떡보의하루": [], "빚은": [],
    # 세탁·노래방
    "크린토피아": [], "월드크리닝": [], "수노래연습장": ["수노래방"], "락휴": [], "세븐스타코인": [],
    # 미용실
    "준오헤어": [], "박승철헤어": [], "이철헤어커커": [], "리안헤어": [], "블루클럽": [], "헤어벨": [],
    "차홍": [], "라뷰티코아": [], "아이디헤어": [], "박준뷰티랩": [], "이가자헤어비스": [], "태후사랑": [],
    "큐사랑": [], "미랑컬": [],
    # 치킨·버거·피자
    "교촌치킨": [], "BBQ": ["비비큐"], "BHC": ["비에이치씨"], "굽네치킨": [], "네네치킨": [], "처갓집양념치킨": [],
    "페리카나": [], "멕시카나": [], "멕시칸치킨": ["맥시칸치킨"], "호식이두마리치킨": [], "노랑통닭": [], "가마치통닭": [], "자담치킨": [],
    "또봉이통닭": [], "푸라닭": [], "60계치킨": ["육십계"], "지코바": [], "바른치킨": [], "땅땅치킨": [],
    "깐부치킨": [], "치킨플러스": [], "훌랄라": [], "둘둘치킨": [], "구어조은닭": [], "후라이드참잘하는집": [],
    "오븐마루": [], "치킨마루": [], "맘스터치": [], "롯데리아": [], "맥도날드": [], "버거킹": [],
    "KFC": ["케이에프씨"], "써브웨이": ["서브웨이"], "이삭토스트": [], "피자스쿨": [], "도미노피자": [],
    "피자헛": [], "피자나라치킨공주": [], "피자마루": [], "반올림피자": [], "7번가피자": [],
    # 분식·밥
    "김밥천국": [], "김밥나라": [], "신전떡볶이": [], "엽기떡볶이": ["동대문엽기떡볶이"], "죠스떡볶이": [],
    "국대떡볶이": [], "배떡": [], "청년다방": [], "두끼": [], "고봉민김밥": [], "바르다김선생": [], "김가네": [],
    "봉구스밥버거": [], "얌샘김밥": [], "마녀김밥": [], "명랑핫도그": ["명랑시대쌀핫도그"], "감탄떡볶이": [], "응급실떡볶이": [],
    "걸작떡볶이": [], "한솥": [], "본도시락": [], "본죽": [], "국수나무": [], "등촌샤브칼국수": [],
    "탕화쿵푸마라탕": [], "땅스부대찌개": [], "명륜진사갈비": [], "가장맛있는족발": [], "투다리": [],
    "역전할머니맥주": [], "홍콩반점": [], "새마을식당": [], "한신포차": [], "봉추찜닭": [], "원할머니보쌈": [],
    # 편의점·소매
    "CU": ["씨유"], "세븐일레븐": [], "GS25": ["지에스25"], "이마트24": [], "미니스톱": [], "올리브영": ["씨제이올리브영"],
    "다이소": [], "정관장": [], "아모레카운셀러": [], "신앙촌상회": [], "이니스프리": [], "아리따움": [],
    "더페이스샵": [], "파크랜드": [], "삼천리자전거": [], "교보문고": [], "영풍문고": [], "알라딘": ["알라딘중고서점"],
    "아이북랜드": [], "온누리약국": [],
    # 정비
    "현대자동차": ["블루핸즈"], "기아오토큐": [], "애니카랜드": [], "스피드메이트": [],
}
# 다른 말로 이어질 수 있어 이름이 똑같을 때만 브랜드로 보는 짧은 표기
EXACT = {"BBQ", "BHC", "KFC", "빚은", "락휴", "차홍", "알라딘"}
# 브랜드 이름으로 시작하지만 다른 가게인 이름
NOT_BRAND = re.compile(r"^(씨유펫|씨유통(?!영)|CU통|한솥밥|한솥식당)")
BRAND_OF = {v: k for k, vs in BRANDS.items() for v in [k, *vs]}
PREFIX_LENS = sorted({len(v) for v in BRAND_OF}, reverse=True)

def floor_of(v):
    v = v.strip().upper()
    if v in ("지", "B1"):
        return -1
    if re.fullmatch(r"B[2-9]", v):
        return -int(v[1])
    if v.isdigit() and 1 <= int(v) <= 70:
        return int(v)
    return None


def bucket(bigram):
    return (ord(bigram[0]) * 31 + ord(bigram[1])) % BUCKETS


rows = []
cats, cat_idx = [], {}
regions, region_idx = [], {}
for path in sorted(glob.glob(os.path.join(SRC, "*.csv"))):
    with open(path, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            cat = r["상권업종소분류명"]
            if cat not in cat_idx:
                cat_idx[cat] = len(cats)
                cats.append(cat)
            region = f"{r['시도명']} {r['시군구명']}"
            if region not in region_idx:
                region_idx[region] = len(regions)
                regions.append(region)
            rows.append((
                r["상호명"].strip(),
                bool(r["지점명"].strip()),
                cat_idx[cat],
                region_idx[region],
                floor_of(r["층정보"]),
                round(float(r["경도"]), 3),
                round(float(r["위도"]), 3),
                r["도로명주소"],
                r["건물명"].strip(),
            ))

total = len(rows)
name_count = collections.Counter(r[0] for r in rows)
branch_count = collections.Counter(r[0] for r in rows if r[1])


sido_of_name = collections.defaultdict(set)
for r in rows:
    sido_of_name[r[0]].add(regions[r[3]].split()[0])
chain_cache = {}


def chain_of(name):
    """프랜차이즈면 브랜드 이름, 아니면 None."""
    if name in chain_cache:
        return chain_cache[name]
    key = re.sub(r"\s+", "", name)
    brand = BRAND_OF.get(key)
    if brand is None and not GENERIC.search(key) and not NOT_BRAND.match(key):
        for n in PREFIX_LENS:
            v = key[:n]
            if len(key) > n and v in BRAND_OF and v not in EXACT:
                brand = BRAND_OF[v]
                break
    # 목록 밖: 지점명을 적은 곳이 30% 넘고, 50곳 넘게 다섯 개 시도 이상에 퍼진 이름
    if brand is None and name_count[name] >= 50 and len(sido_of_name[name]) >= 5 and branch_count[name] / name_count[name] >= 0.3 and not GENERIC.search(name):
        brand = name
    chain_cache[name] = brand
    return brand


def is_chain(name):
    return chain_of(name) is not None


def chain_top(counter, k):
    merged = collections.Counter()
    for n, c in counter.items():
        b = chain_of(n)
        if b:
            merged[b] += c
    return [[n, c] for n, c in merged.most_common(k) if c >= 10]


def is_indie(name):
    return not is_chain(name) and not GENERIC.search(name)


os.makedirs(os.path.join(OUT, "search"), exist_ok=True)


def dump(name, obj):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))


unique_names = sum(1 for c in name_count.values() if c == 1)
dump("meta.json", {
    "total": total,
    "names": len(name_count),
    "uniqueNames": unique_names,
    "categories": len(cats),
    "source": "소상공인시장진흥공단 상가(상권)정보 (공공데이터포털)",
    "date": "2026-06-30",
})
dump("cats.json", cats)
center = collections.defaultdict(lambda: [0.0, 0.0, 0])
for r in rows:
    c = center[r[3]]
    c[0] += r[5]
    c[1] += r[6]
    c[2] += 1
dump("regions.json", [[name, round(center[i][0] / center[i][2], 3), round(center[i][1] / center[i][2], 3)] for i, name in enumerate(regions)])

# 간판 거리: 업종별 순위
street = []
for key, cat, label, emoji in STREET:
    if cat not in cat_idx:
        print("업종 없음:", cat)
        continue
    ci = cat_idx[cat]
    names = [r[0] for r in rows if r[2] == ci]
    counter = collections.Counter(names)
    top = [[n, c] for n, c in counter.most_common(300) if is_indie(n)][:10]
    chains = chain_top(counter, 10)
    chain_rows = sum(c for n, c in counter.items() if is_chain(n))
    grams = collections.Counter()
    for n in names:
        if is_chain(n):
            continue
        grams.update({n[i:i + k] for k in (2, 3) for i in range(len(n) - k + 1) if re.fullmatch(r"[가-힣A-Za-z]+", n[i:i + k])})
    word, hits = max(grams.items(), key=lambda kv: (kv[1] * (1.15 if len(kv[0]) == 3 else 1)))
    street.append({
        "key": key, "label": label, "emoji": emoji, "total": len(names), "top": top, "chains": chains,
        "chainShare": round(chain_rows / len(names) * 100, 1),
        "word": word, "wordShare": round(hits / len(names) * 100, 1),
    })
dump("street.json", street)

# 쌍둥이 간판
twins = [[n, c, is_chain(n)] for n, c in name_count.most_common(80) if not GENERIC.search(n)][:30]
building = collections.Counter((r[0], r[7]) for r in rows if r[7] and is_indie(r[0]))
clusters = [[n, a, c] for (n, a), c in building.most_common(15)]
singles = [r for r in rows if name_count[r[0]] == 1 and HANGUL2.search(r[0])]
lonely = [[r[0], cats[r[2]], regions[r[3]]] for r in random.sample(singles, 600)]
dump("twins.json", {"top": twins, "clusters": clusters, "lonely": lonely})

# 명예의 전당
indie_top = [[n, c] for n, c in name_count.most_common(200) if is_indie(n)][:15]
words = collections.Counter()
for n, c in name_count.items():
    words.update({n[i:i + 2]: c for i in range(len(n) - 1) if HANGUL2.fullmatch(n[i:i + 2])}.keys())
word_top = [[w, sum(c for n, c in name_count.items() if w in n)] for w, _ in words.most_common(12)]
one_char = [[n, c] for n, c in name_count.most_common() if len(n) == 1 and re.fullmatch(r"[가-힣]", n)][:8]
longest = sorted((n for n in name_count if re.fullmatch(r"[가-힣]+", n)), key=len, reverse=True)[:5]
dump("fame.json", {"indie": indie_top, "chains": chain_top(name_count, 15), "words": word_top, "oneChar": one_char, "longest": longest})

# 하이로우: 업종별 이름 풀
pool = []
by_cat = collections.defaultdict(collections.Counter)
for r in rows:
    by_cat[r[2]][r[0]] += 1
for ci, counter in by_cat.items():
    cand = [[n, c] for n, c in counter.most_common(40) if c >= 15 and not GENERIC.search(n) and n != cats[ci]]
    if len(cand) >= 4:
        pool.append({"cat": cats[ci], "names": cand})
dump("highlow.json", pool)

# 지도: 0.02도 격자로 묶은 점
grid = collections.defaultdict(collections.Counter)
for r in rows:
    grid[(round(r[5] / 0.02), round(r[6] / 0.02))][r[2]] += 1
cells = [[x, y, sum(c.values()), c.most_common(1)[0][0]] for (x, y), c in grid.items()]
dump("map.json", {"step": 0.02, "cells": cells})

# 이름 검색 조각: 두 글자 → 전체 개수 + 표본
post = collections.defaultdict(list)
for i, r in enumerate(rows):
    for g in {r[0][k:k + 2] for k in range(len(r[0]) - 1)}:
        if HANGUL2.fullmatch(g):
            post[g].append(i)
shards = collections.defaultdict(dict)
for g, ids in post.items():
    pick = ids if len(ids) <= SAMPLE else random.sample(ids, SAMPLE)
    shards[bucket(g)][g] = {
        "n": len(ids),
        "r": [[rows[i][0], rows[i][2], rows[i][3], rows[i][4]] for i in pick],
    }
for b in range(BUCKETS):
    dump(f"search/{b}.json", shards.get(b, {}))

# 같은 이름 개수: 두 곳 이상 있는 이름만, 첫 두 글자 조각으로 나눈다 (없으면 많아야 1곳)
os.makedirs(os.path.join(OUT, "names"), exist_ok=True)
named = collections.defaultdict(dict)
for n, c in name_count.items():
    m = HANGUL2.search(n) if c >= 2 else None
    if m:
        named[bucket(m.group())][n] = c
for b in range(BUCKETS):
    dump(f"names/{b}.json", named.get(b, {}))

# 우리 동네 간판: 0.1도 블록 파일, 그 안의 0.01도 칸마다 많아야 NEAR_CAP곳 ([이름, 업종, 블록 안 경도·위도 0.001도 단위])
NEAR_CAP = 60
near_rand = random.Random(11)
near_cells = collections.defaultdict(list)
for r in rows:
    if GENERIC.search(r[0]) or not r[0]:
        continue
    x, y = round(r[5] * 1000), round(r[6] * 1000)
    near_cells[(x // 10, y // 10)].append((r[0], r[2], x, y))
blocks = collections.defaultdict(list)
for (cx, cy), items in near_cells.items():
    pick = items if len(items) <= NEAR_CAP else near_rand.sample(items, NEAR_CAP)
    for n, c, x, y in pick:
        blocks[(x // 100, y // 100)].append([n, c, x % 100, y % 100])
os.makedirs(os.path.join(OUT, "near"), exist_ok=True)
for (bx, by), items in blocks.items():
    dump(f"near/{bx}_{by}.json", items)

# 간판 끝말잇기: 첫 글자별로 전국에 많은 간판 이름
starts = collections.defaultdict(list)
for n, c in name_count.most_common():
    if c < 3:
        break
    if re.fullmatch(r"[가-힣]{2,8}", n) and not GENERIC.search(n) and len(starts[n[0]]) < 12:
        starts[n[0]].append([n, c])
dump("kkeut.json", starts)

print("rows", total, "names", len(name_count), "bigrams", len(post), "near blocks", len(blocks))
