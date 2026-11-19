// 지도에서 내 자리를 다른 건물로 옮기기 · 공실 비용 추정
// 가게·건물 데이터는 공릉로 232에서 600m까지 있으므로, 옮긴 자리의 걸어서 5분(300m)이 그 안에 들도록 250m까지만 옮긴다
export const MOVE_MAX = 250

const ringOf = g => (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0])
export function centroid(f) {
  const r = ringOf(f.geometry).slice(1)
  return r.reduce((a, q) => [a[0] + q[0] / r.length, a[1] + q[1] / r.length], [0, 0])
}
// 건물 바닥 넓이(㎡)
function area(f, kx, ky) {
  const r = ringOf(f.geometry)
  let s = 0
  for (let k = 1; k < r.length; k++) s += r[k - 1][0] * kx * r[k][1] * ky - r[k][0] * kx * r[k - 1][1] * ky
  return Math.abs(s) / 2
}

// 공실 1칸 처음 드는 돈(만 원): 권리금이 없고, 보증금은 월세 10달치로 셈
// 1칸 넓이는 건물 바닥의 60%를 20~99㎡ 안으로 (1층 상가 한 칸 크기)
export function vacancyCost(m2, C) {
  const rent = Math.round(C.rent * m2)
  const deposit = rent * 10
  const py = m2 / 3.3
  const start = deposit + Math.round(C.interior * py) + C.equip
  // 매달 내는 돈 = 월세 + 관리비
  const fee = Math.round((C.fee ?? 1) * py)
  return { m2: Math.round(m2), py: Math.round(py), rent, deposit, start, fee, month: rent + fee }
}

// base 리포트를 건물 i로 옮긴 리포트·건물 데이터. i가 없으면 그대로
export function rebase(report, B, i, C) {
  if (!report || !B) return { report, bld: B }
  const Q = report.query
  const kx = 111320 * Math.cos((Q.lat * Math.PI) / 180), ky = 110540
  const tf = i == null ? B.features.find(f => f.properties.tgt) : B.features.find(f => f.properties.i === i)
  const [lon, lat] = i == null ? [Q.lon, Q.lat] : centroid(tf)
  const dx = (lon - Q.lon) * kx, dy = (lat - Q.lat) * ky
  const d0 = (x, y) => Math.round(Math.hypot(x, y))

  const features = B.features.map(f => {
    const [x, y] = centroid(f), p = { ...f.properties }
    p.base = d0((x - Q.lon) * kx, (y - Q.lat) * ky)
    if (i != null) { p.dist = d0((x - lon) * kx, (y - lat) * ky); p.tgt = f.properties.i === i ? 1 : 0 }
    if (p.empty) { p.cost = vacancyCost(Math.max(20, Math.min(99, area(f, kx, ky) * .6)), C); p.start = p.cost.start; p.month = p.cost.month }
    return { ...f, properties: p }
  })
  if (i == null) return { report, bld: { ...B, features } }

  // 카페 목록을 새 자리 기준 거리로 다시 세고, 카페 → 건물 연결도 새 순서로 바꾼다
  const comp = report.competitors.map((s, k) => ({ ...s, x: s.x - dx, y: s.y - dy, k }))
  comp.forEach(s => (s.dist = d0(s.x, s.y)))
  comp.sort((a, b) => a.dist - b.dist)
  const cafe = {}
  comp.forEach((s, n) => { if (B.cafe[s.k] != null) cafe[n] = B.cafe[s.k] })
  const name = tf.properties.name
  const query = { ...Q, lon, lat, moved: d0(dx, dy),
    address: '서울 노원구 ' + (name || `공릉로 232에서 ${d0(dx, dy)}m`), near: name ? `공릉로 232에서 ${d0(dx, dy)}m` : '지도에서 고른 건물' }
  return {
    report: { ...report, query, shops: report.shops.map(([x, y, ...r]) => [x - dx, y - dy, ...r]), competitors: comp.map(({ k, ...s }) => s) },
    bld: { ...B, cafe, features },
  }
}
