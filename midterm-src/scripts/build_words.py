"""간판 문서(간판도감.kr 검색)에 쓰는 단어별 전수 통계를 만든다.

사용법: python3 -I scripts/build_words.py <signs.tsv> ../midterm/data
  signs.tsv 는 midterm-mac-src/scripts/dump_tiles.mjs 로 지도 타일에서 푼 것(277만 곳 전부)

단어 = 간판 이름 안의 한글 2·3·4글자 조각. 2글자 20곳·3글자 30곳·4글자 50곳 이상만 담는다.
한 간판에 같은 말이 두 번 나와도 한 곳으로 센다.
words/<조각번호>.json: {단어: {n, s, c, p, f, m, a, b, h, u, l}}
  n 간판 수, s 시도별 수(tiles/index.json 의 시도 순서), c 업종 [[번호,수]], p [맨 앞, 맨 뒤, 이름 전체],
  f [지하, 1층, 2층 이상, 모름], m 많이 쓰인 이름 [[이름,수]], a 뒤에 붙는 글자, b 앞에 붙는 글자 [[글자,수]],
  h 가장 몰린 1km 칸 [경도, 위도, 수, 시군구], u [서로 다른 이름 수, 그중 한 곳뿐인 이름 수], l 평균 이름 길이×10
"""
import collections
import json
import os
import re
import sys

SRC, OUT = sys.argv[1], sys.argv[2]
BUCKETS = 1024
MIN = {2: 20, 3: 30, 4: 50}
PASSES = 4

with open(os.path.join(OUT, "tiles", "index.json"), encoding="utf-8") as fh:
    SIDO = list(json.load(fh)["regions"])
sido_idx = {s: i for i, s in enumerate(SIDO)}
with open(os.path.join(OUT, "regions.json"), encoding="utf-8") as fh:
    REGIONS = json.load(fh)


def bucket(word):
    return (ord(word[0]) * 31 + ord(word[1])) % BUCKETS


H = re.compile(r"[가-힣]+")


def grams(name):
    out = set()
    for run in H.findall(name):
        for size in (2, 3, 4):
            for i in range(len(run) - size + 1):
                out.add(run[i : i + size])
    return out


def floor_slot(v):
    if v == "":
        return 3
    v = int(v)
    return 0 if v < 0 else 1 if v == 1 else 2


rows = []
names = collections.Counter()
with open(SRC, encoding="utf-8") as fh:
    for line in fh:
        sido, name, cat, floor, lng, lat = line.rstrip("\n").split("\t")
        rows.append((sido_idx[sido], name, int(cat), floor_slot(floor), float(lng), float(lat)))
        names[name] += 1
print("signs", len(rows), "names", len(names))

gram_of = {}
count = collections.Counter()
for name, k in names.items():
    g = grams(name)
    gram_of[name] = g
    for w in g:
        count[w] += k
keep = {w for w, n in count.items() if n >= MIN[len(w)]}
for name in gram_of:
    gram_of[name] = [w for w in gram_of[name] if w in keep]
print("words", len(keep))


def nearest_region(lng, lat):
    best = min(REGIONS, key=lambda r: (r[1] - lng) ** 2 + ((r[2] - lat) * 1.25) ** 2)
    return best[0]


def top(counter, k):
    return [[x, c] for x, c in counter.most_common(k)]


os.makedirs(os.path.join(OUT, "words"), exist_ok=True)
for part in range(PASSES):
    mine = lambda w: bucket(w) % PASSES == part
    acc = {}
    for sido, name, cat, fl, lng, lat in rows:
        for w in gram_of[name]:
            if not mine(w):
                continue
            d = acc.get(w)
            if d is None:
                d = acc[w] = [[0] * len(SIDO), collections.Counter(), [0, 0, 0, 0], collections.Counter()]
            d[0][sido] += 1
            d[1][cat] += 1
            d[2][fl] += 1
            d[3][(round(lng, 2), round(lat, 2))] += 1
    shards = collections.defaultdict(dict)
    for w, (s, cats, fl, cells) in acc.items():
        shards[bucket(w)][w] = {"n": count[w], "s": s, "c": top(cats, 6), "f": fl, "_cells": cells}
    # 이름 쪽 통계(앞뒤 글자·많이 쓰인 이름·위치)는 이름 단위로 센다
    for name, k in names.items():
        for w in gram_of[name]:
            if not mine(w):
                continue
            d = shards[bucket(w)][w]
            if "m" not in d:
                d.update(m=collections.Counter(), a=collections.Counter(), b=collections.Counter(), p=[0, 0, 0], u=[0, 0], l=0)
            d["m"][name] += k
            d["u"][0] += 1
            d["u"][1] += k == 1
            d["l"] += len(name) * k
            if name == w:
                d["p"][2] += k
            else:
                if name.startswith(w):
                    d["p"][0] += k
                if name.endswith(w):
                    d["p"][1] += k
            for m in re.finditer(re.escape(w), name):
                i, j = m.start(), m.end()
                if j < len(name) and "가" <= name[j] <= "힣":
                    d["a"][name[j]] += k
                if i > 0 and "가" <= name[i - 1] <= "힣":
                    d["b"][name[i - 1]] += k
    for b, docs in shards.items():
        for w, d in docs.items():
            cells = d.pop("_cells")
            (lng, lat), c = cells.most_common(1)[0]
            d["h"] = [lng, lat, c, nearest_region(lng, lat)]
            d["m"] = top(d["m"], 8)
            d["a"] = top(d["a"], 6)
            d["b"] = top(d["b"], 6)
            d["l"] = round(d["l"] * 10 / d["n"])
        with open(os.path.join(OUT, "words", f"{b}.json"), "w", encoding="utf-8") as fh:
            json.dump(docs, fh, ensure_ascii=False, separators=(",", ":"))
    print("pass", part + 1, "/", PASSES, len(acc))

# 문서가 하나도 없는 조각도 빈 파일을 둬서 브라우저가 404 를 받지 않게 한다
for b in range(BUCKETS):
    path = os.path.join(OUT, "words", f"{b}.json")
    if not os.path.exists(path):
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("{}")
