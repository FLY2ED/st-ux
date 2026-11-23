// 서울 어디든: 주소 좌표 + 업종으로 리포트와 건물 데이터를 브라우저에서 만든다
// (scripts/build_report.py와 같은 계산 · 간판은 0.01도 칸 파일에서 필요한 칸만 읽는다)

const R = 300, FAR = 600
const SIGNS = '../midterm/data/signs/'
const once = f => { let p; return () => (p ??= f()) }
const json = u => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null)
export const loadCats = once(() => json('./data/cats.json'))
const loadCmp = once(() => json('./data/cmp.json'))
const tiles = new Map()
const tile = k => (tiles.has(k) ? tiles.get(k) : tiles.set(k, json(SIGNS + k + '.json').then(d => d || [])).get(k))

// 공릉로 232 · 카페는 미리 만든 리포트(Overture 건물)를 쓴다
export const BASE = { what: '카페', address: '서울 노원구 공릉로 232', near: '서울과기대 정문', dong: '공릉동', lon: 127.07655, lat: 37.62994 }
export const isBase = q => q.what === BASE.what && Math.abs(q.lon - BASE.lon) < 1e-5 && Math.abs(q.lat - BASE.lat) < 1e-5

export async function buildReport(q) {
  const [cats, cmp] = await Promise.all([loadCats(), loadCmp()])
  const cat = cats.indexOf(q.what)
  const kx = 111320 * Math.cos((q.lat * Math.PI) / 180), ky = 110540
  const dl = FAR / kx, dt = FAR / ky
  const keys = []
  for (let tx = Math.floor((q.lon - dl) * 100); tx <= Math.floor((q.lon + dl) * 100); tx++)
    for (let ty = Math.floor((q.lat - dt) * 100); ty <= Math.floor((q.lat + dt) * 100); ty++) keys.push(tx + '_' + ty)
  const parts = await Promise.all(keys.map(k => tile(k).then(rows => [k, rows])))
  const near = []
  for (const [k, rows] of parts) {
    const [tx, ty] = k.split('_').map(Number)
    for (const [n, c, f, ox, oy] of rows) {
      const x = ((tx * 1000 + ox) / 1e5 - q.lon) * kx, y = ((ty * 1000 + oy) / 1e5 - q.lat) * ky, d = Math.hypot(x, y)
      if (d <= FAR) near.push({ n, c, f, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, d: Math.round(d) })
    }
  }
  const inR = near.filter(s => Math.hypot(s.x, s.y) <= R)
  const comp = near.filter(s => s.c === cat).sort((a, b) => a.d - b.d)
  const count = (arr, key) => { const m = new Map(); for (const s of arr) m.set(key(s), (m.get(key(s)) || 0) + 1); return [...m].sort((a, b) => b[1] - a[1]) }
  const here = inR.filter(s => s.c === cat).length
  const share = inR.length ? here / inR.length : 0
  const C = cmp.cat[cat]
  const above = C.hist.reduce((a, [v, n]) => a + (v > here ? n : 0), 0)
  const sAbove = C.q.filter(v => v > share).length
  return {
    query: { ...q, cat }, radius: R, total: inR.length, count: here, share: Math.round(share * 1e4) / 1e4,
    compare: { cells: cmp.cells, medianCount: C.mc, medianShare: C.ms, topPct: Math.round((100 * above) / cmp.cells),
      sharePct: Math.round(sAbove * (100 / 101)), seoulShare: Math.round((C.n / cmp.shops) * 1e4) / 1e4, seoulCount: C.n, seoulShops: cmp.shops },
    floors: count(comp.filter(s => s.d <= R), s => s.f),
    mix: count(inR, s => cats[s.c]).slice(0, 8),
    competitors: comp.map(s => ({ name: s.n, dist: s.d, x: s.x, y: s.y, floor: s.f })),
    shops: near.map(s => [s.x, s.y, s.c, s.n, s.f]),
    cats: Object.fromEntries([...new Set(near.map(s => s.c))].sort((a, b) => a - b).map(c => [c, cats[c]])),
    source: '소상공인시장진흥공단 상가(상권)정보 · 서울 · 2026년 6월',
  }
}

// ── 건물: Overture 건물(0.01도 칸 파일) + 간판 위치를 맞춘다 ──
const BLDS = '../midterm/data/blds/'
const btiles = new Map()
const btile = k => (btiles.has(k) ? btiles.get(k) : btiles.set(k, json(BLDS + k + '.json')).get(k))
// 사무 건물은 1층 가게 자리가 아닌 경우가 많아 뺀다. 아주 작은 건물(60㎡ 미만)도 뺀다
const SHOPPY = new Set(['commercial', 'retail'])
function inside([x, y], ring) {
  let o = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o
  }
  return o
}
// 점에서 선분까지 거리(m)
function segD(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

export async function buildBuildings(report) {
  const Q = report.query
  const kx = 111320 * Math.cos((Q.lat * Math.PI) / 180), ky = 110540
  const M = 650, dl = M / kx, dt = M / ky
  const keys = []
  for (let tx = Math.floor((Q.lon - dl) * 100); tx <= Math.floor((Q.lon + dl) * 100); tx++)
    for (let ty = Math.floor((Q.lat - dt) * 100); ty <= Math.floor((Q.lat + dt) * 100); ty++) keys.push([tx, ty])
  const B = []
  for (const [[tx, ty], T] of await Promise.all(keys.map(k => btile(k.join('_')).then(T => [k, T])))) {
    if (!T) continue
    for (const [ci, h, ...xy] of T.b) {
      let x = xy[0], y = xy[1]
      const ring = [[tx / 100 + x / 1e6, ty / 100 + y / 1e6]]
      for (let j = 2; j < xy.length; j += 2) { x += xy[j]; y += xy[j + 1]; ring.push([tx / 100 + x / 1e6, ty / 100 + y / 1e6]) }
      ring.push(ring[0])
      const loc = ring.map(([lon, lat]) => [(lon - Q.lon) * kx, (lat - Q.lat) * ky])
      let a = 0
      for (let j = 1; j < loc.length; j++) a += loc[j - 1][0] * loc[j][1] - loc[j][0] * loc[j - 1][1]
      const c = loc.slice(1).reduce((s, p) => [s[0] + p[0] / (loc.length - 1), s[1] + p[1] / (loc.length - 1)], [0, 0])
      const d = Math.hypot(c[0], c[1])
      if (d > M) continue
      B.push({ g: { type: 'Polygon', coordinates: [ring] }, loc, c, d, area: Math.abs(a) / 2, h, cls: T.c[ci] })
    }
  }
  // 20m 칸 색인
  const G = 20, idx = new Map(), key = (a, b) => a + ',' + b
  B.forEach((o, i) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
    for (const [x, y] of o.loc) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    for (let a = Math.floor(x0 / G); a <= Math.floor(x1 / G); a++) for (let b = Math.floor(y0 / G); b <= Math.floor(y1 / G); b++) {
      const k = key(a, b); if (!idx.has(k)) idx.set(k, []); idx.get(k).push(i)
    }
  })
  // 점이 든 건물, 없으면 벽에서 12m 안 가장 가까운 건물
  const hit = (p, far = 12) => {
    const gx = Math.floor(p[0] / G), gy = Math.floor(p[1] / G), cand = new Set()
    const r = Math.ceil(far / G)
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (const i of idx.get(key(gx + a, gy + b)) || []) cand.add(i)
    let best = -1, bd = far
    for (const i of cand) {
      const L = B[i].loc
      if (inside(p, L)) return i
      for (let j = 1; j < L.length; j++) { const d = segD(p, L[j - 1], L[j]); if (d < bd) { bd = d; best = i } }
    }
    return best
  }
  const S = B.map(() => ({ n: 0, cafe: 0, f1: 0, fmax: 0, cats: new Map() }))
  for (const [x, y, c, , f] of report.shops) {
    const i = hit([x, y]); if (i < 0) continue
    const s = S[i]
    s.n++; if (c === Q.cat) s.cafe++; if (f === 1) s.f1++; if (f > s.fmax) s.fmax = f
    const nm = report.cats[c]; s.cats.set(nm, (s.cats.get(nm) || 0) + 1)
  }
  const cafe = {}
  report.competitors.forEach((s, k) => { const i = hit([s.x, s.y]); if (i >= 0) cafe[k] = i })
  const tgt = hit([0, 0], 60)
  // 공실 후보: 상가·사무 건물인데 등록된 가게가 하나도 없는 곳
  const features = B.map((o, i) => {
    const s = S[i], p = { i, dist: Math.round(o.d), h: Math.round(o.h) }
    if (s.n) {
      Object.assign(p, { n: s.n, f1: s.f1, fmax: s.fmax, top: [...s.cats].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + ' ' + v).join(' · ') })
      if (s.cafe) p.cafe = s.cafe
    } else if (i !== tgt && SHOPPY.has(o.cls) && o.area >= 60) { p.empty = 1; p.cls = o.cls }
    if (i === tgt) p.tgt = 1
    return { type: 'Feature', properties: p, geometry: o.g }
  })
  return { type: 'FeatureCollection', source: 'Overture Maps 건물 · 공실은 가게 없는 상가 건물', cafe, features }
}
