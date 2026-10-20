const cache = new Map()
// 배포본은 원래 간판 도감의 데이터를 같이 쓴다
const BASE = import.meta.env.DEV ? './data' : '../midterm/data'

export function load(name) {
  if (!cache.has(name)) {
    cache.set(name, fetch(`${BASE}/${name}`).then((res) => {
      if (!res.ok) throw new Error(`${name} ${res.status}`)
      return res.json()
    }))
  }
  return cache.get(name)
}

const HANGUL2 = /^[가-힣]{2}$/

export function bigrams(word) {
  const out = new Set()
  for (let i = 0; i < word.length - 1; i++) {
    const g = word.slice(i, i + 2)
    if (HANGUL2.test(g)) out.add(g)
  }
  return [...out]
}

const bucket = (g) => (g.charCodeAt(0) * 31 + g.charCodeAt(1)) % 1024

// 두 글자 조각에서 단어가 들어간 간판을 찾는다. 두 글자면 개수가 정확하고, 더 길면 가장 드문 조각의 개수가 상한이다.
export async function search(word) {
  const grams = bigrams(word.trim())
  if (!grams.length) return null
  const [cats, regions, ...entries] = await Promise.all([
    load('cats.json'),
    load('regions.json'),
    ...grams.map((g) => load(`search/${bucket(g)}.json`).then((shard) => shard[g] || { n: 0, r: [] })),
  ])
  const rarest = entries.reduce((a, b) => (b.n < a.n ? b : a))
  const seen = new Set()
  const rows = []
  for (const entry of entries) {
    for (const [name, cat, region, floor] of entry.r) {
      const key = `${name}|${region}|${floor}`
      if (seen.has(key)) continue
      seen.add(key)
      const [regionName, lng, lat] = regions[region]
      rows.push({ name, cat: cats[cat], region: regionName, lng, lat, floor, exact: name.includes(word.trim()) })
    }
  }
  return { word: word.trim(), count: rarest.n, exactCount: grams.length === 1, rows }
}

// 전국에 같은 이름이 몇 곳인지. 두 곳 이상인 이름만 색인에 있어서, 없으면 0 또는 1곳이다.
export async function nameCount(name) {
  const m = name.match(/[가-힣]{2}/)
  if (!m) return null
  const shard = await load(`names/${bucket(m[0])}.json`)
  return shard[name] || 0
}

const SURNAMES = new Set('김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉사부가복태목형피두감호계'.split(''))

// 이름처럼 붙은 건지(맨 앞, 또는 성 바로 뒤) 우연히 걸린 건지 가른다
export function looksLikeName(shopName, word) {
  const i = shopName.indexOf(word)
  if (i < 0) return false
  return i === 0 || (i === 1 && SURNAMES.has(shopName[0]))
}

// 내 위치 반경 안의 간판. 0.1도 블록 파일을 필요한 만큼만 받고, 가까운 순으로 돌려준다.
export async function nearby(lng, lat, radius = 800) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110540
  const dx = radius / kx
  const dy = radius / ky
  const keys = new Set()
  for (const x of [lng - dx, lng + dx]) for (const y of [lat - dy, lat + dy]) keys.add(`${Math.floor(x * 10)}_${Math.floor(y * 10)}`)
  const cats = await load('cats.json')
  const out = []
  await Promise.all(
    [...keys].map(async (key) => {
      const [bx, by] = key.split('_').map(Number)
      const rows = await load(`near/${key}.json`).catch(() => [])
      for (const [name, cat, ox, oy] of rows) {
        const sx = (bx * 100 + ox) / 1000
        const sy = (by * 100 + oy) / 1000
        const dist = Math.hypot((sx - lng) * kx, (sy - lat) * ky)
        if (dist <= radius) out.push({ name, cat: cats[cat], dist: Math.round(dist), dx: (sx - lng) * kx, dy: (sy - lat) * ky })
      }
    }),
  )
  return out.sort((a, b) => a.dist - b.dist)
}

// 3D 거리용 촘촘한 간판(서울만 있다). 칸 파일이 없으면 전국 표본 nearby 로 대신한다
export async function signsAround(lng, lat, radius) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110540
  const keys = new Set()
  for (const x of [lng - radius / kx, lng + radius / kx]) for (const y of [lat - radius / ky, lat + radius / ky]) keys.add(`${Math.floor(x * 100)}_${Math.floor(y * 100)}`)
  const cats = await load('cats.json')
  const out = []
  let dense = false
  await Promise.all(
    [...keys].map(async (key) => {
      const [tx, ty] = key.split('_').map(Number)
      const rows = await load(`signs/${key}.json`).catch(() => null)
      if (!rows) return
      dense = true
      for (const [name, cat, floor, ox, oy] of rows) {
        const x = (((tx * 1000 + ox) / 100000) - lng) * kx
        const y = (((ty * 1000 + oy) / 100000) - lat) * ky
        const dist = Math.hypot(x, y)
        if (dist <= radius) out.push({ name, cat: cats[cat], floor, x, y, dist })
      }
    }),
  )
  if (!dense) {
    for (const s of await nearby(lng, lat, radius)) out.push({ name: s.name, cat: s.cat, floor: 0, x: s.dx, y: s.dy, dist: s.dist })
  }
  return { dense, rows: out.sort((a, b) => a.dist - b.dist) }
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// 이름 색인 조각 몇 개를 받아 실제 간판 이름과 전국 개수를 돌려준다 (두 곳 이상인 이름만)
export async function randomNames(shards = 6) {
  const ids = Array.from({ length: shards }, () => Math.floor(Math.random() * 1024))
  const parts = await Promise.all(ids.map((i) => load(`names/${i}.json`)))
  return parts.flatMap((p) => Object.entries(p)).map(([name, count]) => ({ name, count }))
}

// 상호 대신 들어간 자리표시 글자
const JUNK = /없음|미상|업소명|상호명|^[-.0-9 ]*$/

// 검색 색인 한 조각에 든 실제 간판들 → [{name, cat, region}]
export async function signPool() {
  const [cats, regions] = await Promise.all([load('cats.json'), load('regions.json')])
  const shard = await load(`search/${Math.floor(Math.random() * 1024)}.json`)
  return Object.values(shard)
    .flatMap((e) => e.r)
    .filter(([name]) => !JUNK.test(name))
    .map(([name, c, region]) => ({ name, cat: cats[c], region: regions[region][0] }))
}

// 실제 간판 한 줄을 고른다. 업종을 주면 그 업종만
export async function randomSign(cat) {
  for (let tries = 0; tries < 6; tries++) {
    const rows = await signPool()
    const pool = cat ? rows.filter((r) => r.cat === cat) : rows
    if (pool.length) return pick(pool)
  }
  return null
}
