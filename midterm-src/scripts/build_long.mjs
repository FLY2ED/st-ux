// 간판 타자왕: 검색 조각에 담긴 실제 간판 이름 가운데 긴 것을 길이 단계별로 고른다.
// 사용법: node scripts/build_long.mjs ../midterm/data
import fs from 'node:fs'
import path from 'node:path'

const DATA = process.argv[2]
const TIERS = [
  [12, 15],
  [16, 19],
  [20, 24],
  [25, 29],
  [30, 99],
]
const PER = 120
const cats = JSON.parse(fs.readFileSync(path.join(DATA, 'cats.json')))
const regions = JSON.parse(fs.readFileSync(path.join(DATA, 'regions.json')))

const seen = new Map()
for (const f of fs.readdirSync(path.join(DATA, 'search'))) {
  const shard = JSON.parse(fs.readFileSync(path.join(DATA, 'search', f)))
  for (const k in shard) for (const [name, cat, region] of shard[k].r) seen.set(name, [name, cats[cat], regions[region][0]])
}

// 같은 씨앗이면 같은 표본
let s = 7
const rand = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const ok = [...seen.values()].filter(([n]) => /^[가-힣0-9]+$/.test(n) && /[가-힣]{4}/.test(n) && !/(.)\1\1/.test(n))
const tiers = TIERS.map(([lo, hi]) => {
  const pool = ok.filter(([n]) => n.length >= lo && n.length <= hi).sort((a, b) => (a[0] < b[0] ? -1 : 1))
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return { lo, hi, pool: pool.length, names: pool.slice(0, PER) }
})
fs.writeFileSync(path.join(DATA, 'long.json'), JSON.stringify({ source: '검색 조각 표본', tiers }))
console.log(tiers.map((t) => `${t.lo}-${t.hi}: ${t.pool}`).join(' · '))
