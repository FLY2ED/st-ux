const cache = new Map()

export function load(name) {
  if (!cache.has(name)) {
    cache.set(name, fetch(`./data/${name}`).then((res) => {
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
