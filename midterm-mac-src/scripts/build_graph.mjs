// 이름 찾기 별자리에 쓸 말별 간판 점을 만든다. 검색 색인(search/)은 두 글자 조각마다 이름 24곳만 담아 별자리가 성기다
// 사용법: node scripts/build_graph.mjs <signs.tsv> ../midterm/data [점 수=4000]
//   signs.tsv 는 scripts/dump_tiles.mjs 로 지도 타일에서 푼 것(277만 곳 전부)
// 말 = 간판 문서(words/)에 있는 한글 2~4글자 말. 말마다 간판을 고르게 뽑아(같은 입력이면 같은 표본) 동네·업종·글자 자리로 센다
// graph/<조각번호>.json: {말: {n: 전체 간판 수, d: "칸 칸 …"}}
//   칸 = 36진수 "열쇠" 또는 "열쇠.곳수"(1곳이면 생략), 열쇠 = (동네 번호 × 1000 + 업종 번호) × 4 + 자리
//   자리: 0 이름 전체, 1 맨 앞, 2 가운데, 3 맨 끝
import { createReadStream, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const [src, out, k = '4000'] = process.argv.slice(2)
const K = Number(k)
const BUCKETS = 1024
const bucket = (w) => (w.charCodeAt(0) * 31 + w.charCodeAt(1)) % BUCKETS

const words = new Map()
for (const f of readdirSync(join(out, 'words'))) for (const w of Object.keys(JSON.parse(readFileSync(join(out, 'words', f), 'utf8')))) words.set(w, { seen: 0, keys: [] })

// 동네 = 가장 가까운 시군구 중심 (build_words.py 와 같은 셈)
const regions = JSON.parse(readFileSync(join(out, 'regions.json'), 'utf8'))
const nearest = (lng, lat) => {
  let best = 0
  let bd = Infinity
  regions.forEach(([, x, y], i) => {
    const d = (x - lng) ** 2 + ((y - lat) * 1.25) ** 2
    if (d < bd) ((bd = d), (best = i))
  })
  return best
}

let seed = 0x9e3779b9
const rand = (n) => {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return (seed >>> 0) % n
}

const H = /[가-힣]+/g
for await (const line of createInterface({ input: createReadStream(src) })) {
  const [, name, cat, , lng, lat] = line.split('\t')
  const found = new Set()
  for (const [run] of name.matchAll(H))
    for (let i = 0; i < run.length; i++) for (let size = 2; size <= 4 && i + size <= run.length; size++) found.add(run.slice(i, i + size))
  let region = -1
  for (const w of found) {
    const e = words.get(w)
    if (!e) continue
    if (region < 0) region = nearest(+lng, +lat)
    const at = name.indexOf(w)
    const spot = name === w ? 0 : at === 0 ? 1 : at + w.length === name.length ? 3 : 2
    const key = (region * 1000 + Number(cat)) * 4 + spot
    e.seen++
    if (e.keys.length < K) e.keys.push(key)
    else {
      const j = rand(e.seen)
      if (j < K) e.keys[j] = key
    }
  }
}

const shards = Array.from({ length: BUCKETS }, () => ({}))
for (const [w, e] of words) {
  const count = new Map()
  for (const key of e.keys) count.set(key, (count.get(key) || 0) + 1)
  const d = [...count].map(([key, c]) => (c > 1 ? `${key.toString(36)}.${c.toString(36)}` : key.toString(36))).join(' ')
  shards[bucket(w)][w] = { n: e.seen, d }
}
mkdirSync(join(out, 'graph'), { recursive: true })
let bytes = 0
shards.forEach((s, i) => {
  const text = JSON.stringify(s)
  bytes += Buffer.byteLength(text)
  writeFileSync(join(out, 'graph', `${i}.json`), text)
})
console.log('words', words.size, 'MB', (bytes / 1e6).toFixed(1))
