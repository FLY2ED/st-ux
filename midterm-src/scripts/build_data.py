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
GENERIC = re.compile(r"(업소명없음|공인중개|컴퓨터수리|입주청소|학원$|컨설팅|업$|슈퍼마켓$|교습소?$|^약국$|^노래연습장$)")
HANGUL2 = re.compile(r"[가-힣]{2}")
# 지점명을 거의 안 적는 체인과 표기가 갈리는 체인
KNOWN_CHAINS = {"김밥천국", "김밥나라", "태후사랑", "아모레카운셀러", "신앙촌상회", "페리카나치킨", "큐사랑"}
ALIAS = {"파리바게트": "파리바게뜨", "베스킨라빈스": "배스킨라빈스", "이디야": "이디야커피", "페리카나치킨": "페리카나"}


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


def is_chain(name):
    return name in KNOWN_CHAINS or name in ALIAS or branch_count[name] / name_count[name] >= 0.2


def chain_top(counter, k):
    merged = collections.Counter()
    for n, c in counter.items():
        if is_chain(n) and not GENERIC.search(n) and name_count[n] >= 30:
            merged[ALIAS.get(n, n)] += c
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
    chain_rows = sum(c for n, c in counter.items() if is_chain(n) and name_count[n] >= 30)
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

print("rows", total, "names", len(name_count), "bigrams", len(post))
