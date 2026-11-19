// 서울 상권분석서비스 자료(public/data/sa/)로 어느 자리·어느 업종이든 리포트 숫자를 계산한다.
// scripts/build_seoul.py 의 계산을 그대로 옮기고 자리·업종만 바꿀 수 있게 했다. 반환 모양은 src/seoul.json 과 같다.

const NEAR_M = 600           // 본 상권 중심에서 600m 안 상권을 묶어 본다
const DAYS = ['월', '화', '수', '목', '금', '토', '일']
const HB = ['06–11', '11–14', '14–17', '17–21', '21–24', '0–6']
const LEN = [5, 3, 3, 4, 3, 6]   // 시간대 길이(시간): 1시간 평균으로 나눔
const AG = ['10대', '20대', '30대', '40대', '50대', '60대+']
const CH = { HL: '줄어드는 중', HH: '그대로', LH: '커지는 중', LL: '자주 바뀜' }
const NOTE = {
  HL: '오래된 가게는 버티지만 새 가게가 잘 안 들어와요.', HH: '가게가 오래 버티고 바뀜이 적어요.',
  LH: '새 가게가 들어와 자리 잡고 있어요.', LL: '가게가 자주 열고 닫혀요. 새로 들어오기 쉽지만 오래 버티기는 어려워요.',
}

const defaultBase = () => ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || './') + 'data/sa/'
const cache = new Map()
function get(load, base, path) {
  const k = base + '|' + path
  if (!cache.has(k)) cache.set(k, Promise.resolve(load(path)).catch(e => { cache.delete(k); throw e }))
  return cache.get(k)
}

// 파이썬 round 와 같게(반올림 반은 짝수로)
function rnd(x) {
  const f = Math.floor(x), d = x - f
  return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1)
}
const r1 = x => Math.round(x * 10) / 10
const sum = a => a.reduce((s, v) => s + v, 0)
function share(vals) {
  const t = sum(vals) || 1
  return vals.map(v => rnd(v / t * 100))
}
function pctl(v, arr) {
  if (!arr || !arr.length) return 50
  let lo = 0, hi = arr.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m }
  return rnd(lo / arr.length * 100)
}
const qlab = q => `${q.slice(2, 4)}.${q[4]}Q`
const qname = q => `${q.slice(0, 4)}년 ${q[4]}분기`

// 경위도 거리(m), 작은 거리용
function meters(lon1, lat1, lon2, lat2) {
  return Math.hypot((lon2 - lon1) * 111320 * Math.cos(lat1 * Math.PI / 180), (lat2 - lat1) * 110540)
}

function inside(lon, lat, a) {
  const [, , clon, clat, , , , rings] = a
  let hit = false
  for (const r of rings) {
    const n = r.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = clon + r[2 * i] / 1e5, yi = clat + r[2 * i + 1] / 1e5
      const xj = clon + r[2 * j] / 1e5, yj = clat + r[2 * j + 1] / 1e5
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) hit = !hit
    }
  }
  return hit
}

// 점에서 상권 경계까지 거리(m)
function edgeDist(lon, lat, a) {
  const [, , clon, clat, , , , rings] = a
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540
  let best = Infinity
  for (const r of rings) {
    const n = r.length / 2
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = (clon + r[2 * j] / 1e5 - lon) * kx, ay = (clat + r[2 * j + 1] / 1e5 - lat) * ky
      const bx = (clon + r[2 * i] / 1e5 - lon) * kx, by = (clat + r[2 * i + 1] / 1e5 - lat) * ky
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy
      const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
    }
  }
  return best
}

// 점이 든 상권(넓이 작은 것 먼저), 없으면 경계가 가장 가까운 상권
function findHome(index, lon, lat) {
  for (const a of index.areas) if (inside(lon, lat, a)) return { a, inside: true, dist: 0 }
  let best = null, bd = Infinity
  for (const a of index.areas) {
    const d = edgeDist(lon, lat, a)
    if (d < bd) { bd = d; best = a }
  }
  return { a: best, inside: false, dist: Math.round(bd) }
}

/**
 * @param {{lon:number, lat:number, cat:string, base?:string, load?:(path:string)=>any}} o
 *   cat: 소상공인 소분류 이름(cats.json) 또는 서비스업종 코드(CS......)
 *   load: 파일 읽기 함수(기본 fetch(base + path)). 노드에서 시험할 때 바꿔 끼운다.
 */
export async function seoulReport({ lon, lat, cat, base, load }) {
  base = base ?? defaultBase()
  load = load ?? (p => fetch(base + p).then(r => { if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json() }))
  const L = p => get(load, base, p)
  const [index, S, catmap, stations] = await Promise.all([L('index.json'), L('seoul.json'), L('catmap.json'), L('../stations.json').catch(() => [])])

  const code = /^CS\d{6}$/.test(cat) ? cat : (catmap[cat] ?? null)
  const label = code ? (S.ind[code]?.[1] ?? cat) : cat
  const Y = S.years.length

  const home = findHome(index, lon, lat)
  const H = home.a
  const near = index.areas.map(a => [a, Math.hypot(a[5] - H[5], a[6] - H[6])]).filter(([, d]) => d <= NEAR_M)
    .sort((p, q) => p[1] - q[1]).map(([a]) => a)
  const files = await Promise.all(near.map(a => L(`a/${a[0]}.json`).catch(() => ({ i: {} }))))
  const AF = Object.fromEntries(near.map((a, k) => [a[0], files[k]]))
  const NEAR = near.map(a => a[0])
  const hf = AF[H[0]]

  // 업종 숫자: 매출은 원, 세부 칸은 천원(비율만 씀)
  const row = (c, i) => AF[c]?.i?.[i]
  const sales = (codes, i, qi) => sum(codes.map(c => row(c, i)?.[qi] ?? 0))
  const stores = (codes, i, qi) => sum(codes.map(c => row(c, i)?.[8 + qi] ?? 0))
  const cnt = (codes, i) => sum(codes.map(c => row(c, i)?.[16] ?? 0))
  const perStore = (codes, i, qi) => { const n = stores(codes, i, qi); return n ? sales(codes, i, qi) / n / 1e4 : 0 }
  const det = (codes, i, k) => sum(codes.map(c => { const r = row(c, i); return r && r.length > 17 + 2 * Y ? r[17 + 2 * Y + k] : 0 }))
  const QI = 7, YO = 3     // 최근 분기, 1년 전 분기(8분기 배열 안 위치)

  // 한 상권 묶음의 업종 숫자 (build_seoul.py cafe())
  function kpi(codes, i) {
    const n = stores(codes, i, QI)
    const m = perStore(codes, i, QI)
    const k = cnt(codes, i)
    const ago = sales(codes, i, YO)
    const grow = ago ? sales(codes, i, QI) / ago - 1 : 0
    const last4 = [4, 5, 6, 7].map(q => perStore(codes, i, q))
    const mx = Math.max(...last4)
    const fl = sum(codes.map(c => AF[c]?.f?.[0] ?? 0)) / 91
    const life = sum(codes.map(c => AF[c]?.g?.[1] ?? 0)) / Math.max(codes.length, 1)
    return {
      n, month: rnd(m), fsum: rnd(fl), ticket: k ? rnd(sales(codes, i, QI) / k) : 0, grow, even: mx ? Math.min(...last4) / mx : 0,
      flow: fl / Math.max(codes.length, 1), life, perDay: n ? rnd(k / 30 / n) : 0,
    }
  }

  const hasSales = !!code && stores(NEAR, code, QI) > 0 && sales(NEAR, code, QI) > 0
  const missing = !hasSales
  const K = code ? kpi(NEAR, code) : null

  let SC = null, G = null
  if (hasSales) {
    const SD = await L(`dist/${code}.json`).catch(() => null)
    SC = [['남는 돈', pctl(K.month, SD?.money)], ['고른 매출', pctl(K.even, SD?.even)], ['손님 모으기', pctl(K.flow, SD?.flow)],
      ['오래 버티기', pctl(K.life, SD?.life)], ['커지는 정도', pctl(K.grow, SD?.grow)]]
    const a = sum(SC.map(x => x[1])) / SC.length
    G = a >= 75 ? 'A' : a >= 62 ? 'B+' : a >= 50 ? 'B' : a >= 38 ? 'C+' : 'C'
  }
  const avg = code && S.avg[code]
  const seoulMonth = avg ? rnd(avg[0]) : null
  const seoulTicket = avg ? rnd(avg[1]) : null

  // 매출 쪼개 보기
  let salesOut = null, week = null, vac = 0
  if (hasSales) {
    week = share(DAYS.map((_, k) => det(NEAR, code, k)))
    const hours = share(LEN.map((h, k) => det(NEAR, code, 7 + k) / h))
    const age = share(AG.map((_, k) => det(NEAR, code, 13 + k)))
    const male = det(NEAR, code, 19), fem = det(NEAR, code, 20)
    const quarters = S.q8.map((q, k) => [qlab(q), rnd(perStore(NEAR, code, k))])
    const bq = {}
    S.q8.forEach((q, k) => { (bq[q[4]] ??= []).push(perStore(NEAR, code, k)) })
    const keys = Object.keys(bq).sort()
    const mean = a => sum(a) / a.length
    const av = sum(keys.map(k => mean(bq[k]))) / keys.length
    const season = keys.map(k => [`${k}분기`, av ? rnd(mean(bq[k]) / av * 100) : 0])
    vac = season.length >= 3 ? rnd(100 - (season[0][1] + season[2][1]) / 2) : 0
    salesOut = {
      month: K.month, seoul: seoulMonth, ticket: K.ticket, seoulTicket, perDay: K.perDay, stores: K.n,
      quarters, season, vac, week: DAYS.map((d, k) => [d, week[k]]), hours: HB.map((h, k) => [h, hours[k]]),
      age: AG.map((g, k) => [g, age[k]]), female: fem + male ? rnd(fem / (fem + male) * 100) : 50, grow: rnd(K.grow * 100),
    }
  }

  // 유동인구
  const F = NEAR.map(c => AF[c].f).filter(Boolean)
  const fs = k => sum(F.map(r => r[k]))
  const flowDay = rnd(fs(0) / 91)
  const flowSeoul = rnd(S.flowAvg * F.length)
  const fh = share(LEN.map((h, k) => fs(8 + k) / h))
  const fw = share(DAYS.map((_, k) => fs(14 + k)))
  const fa = share(AG.map((_, k) => fs(2 + k)))
  const peak = HB[fh.indexOf(Math.max(...fh))]

  // 사는·일하는 사람, 주변 시설
  const Lv = NEAR.map(c => AF[c].l).filter(Boolean)
  const Fc = NEAR.map(c => AF[c].x).filter(Boolean)
  const Ap = NEAR.map(c => AF[c].p).filter(Boolean)
  const ls = k => rnd(sum(Lv.map(r => r[k])))
  const fc = (...ks) => rnd(sum(Fc.map(r => sum(ks.map(k => r[k])))))
  const aptHouse = [1, 2, 3, 4, 5].map(k => sum(Ap.map(r => r[k])))
  const aptN = sum(aptHouse)
  const aptCx = sum(Ap.map(r => r[0]))
  const aptPrice = sum(Ap.map(r => r[6] * 1e4 * r[0])) / Math.max(aptCx, 1)

  // 지하철역: 곧은 거리 → 걸어서 분 (1.3배 돌아가는 길, 분속 75m)
  const st = stations.map(([n, l, x, y]) => [n, l, rnd(meters(lon, lat, x, y) * 1.3 / 75)]).sort((p, q) => p[2] - q[2]).slice(0, 3)

  // 상권 변화
  const ch = hf.g
  const years = S.years.map((y, k) => [y,
    code ? sum(NEAR.map(c => row(c, code)?.[17 + k] ?? 0)) : 0,
    code ? sum(NEAR.map(c => row(c, code)?.[17 + Y + k] ?? 0)) : 0])

  // 맞는 업종: 같은 대분류(CS1 먹고 마시는 가게 / CS2 서비스 / CS3 소매) 안에서
  const major = (code ?? 'CS1').slice(0, 3)
  const inds = new Set()
  for (const c of NEAR) for (const i of Object.keys(AF[c].i ?? {})) if (i.startsWith(major)) inds.add(i)
  const rec = []
  for (const i of [...inds].sort()) {
    const n = stores(NEAR, i, QI)
    const si = (S.avg[i]?.[0] ?? 0) * 1e4
    if (n < 2 || !si || !sales(NEAR, i, QI)) continue
    const r = perStore(NEAR, i, QI) * 1e4 / si
    const sc = Math.max(5, Math.min(95, rnd(50 + 22 * Math.log2(r) - 1.2 * Math.max(n - 8, 0))))
    rec.push([S.ind[i]?.[1] ?? i, sc, `1곳 매출 서울 같은 업종의 ${r.toFixed(1)}배 · 가게 ${n}곳`, i])
  }
  rec.sort((p, q) => q[1] - p[1])
  const mine = rec.find(x => x[3] === code)
  let fit = rec.slice(0, 5)
  if (mine && !fit.includes(mine)) fit = [...rec.slice(0, 4), mine]
  fit = fit.map(x => x.slice(0, 3))

  // 구 안 뜨는 상권: 같은 업종 매출 합 1년 증가율 (가게 3곳 넘는 상권)
  const trend = ((code && S.trend[H[4]]?.[code]) || []).map(([n, v, k]) => [n, `${v >= 0 ? '+' : ''}${v}%`, `${label} ${k}곳`])

  // 좋은 점 · 조심할 점
  const good = [], warn = []
  if (hasSales && seoulMonth) {
    const r = K.month / seoulMonth
    if (r >= 1) good.push(`${label} 1곳 월매출이 서울 평균의 ${r.toFixed(1)}배예요.`)
    else warn.push(`${label} 1곳 월매출이 서울 평균보다 ${rnd((1 - r) * 100)}% 적어요.`)
  }
  if (flowSeoul) {
    const r = flowDay / flowSeoul
    if (r >= 1) good.push(`유동인구가 서울 상권 평균의 ${r.toFixed(1)}배예요.`)
    else warn.push(`유동인구가 서울 상권 평균보다 ${rnd((1 - r) * 100)}% 적어요.`)
  }
  const oc = [sum(years.map(y => y[1])), sum(years.map(y => y[2]))]
  if (code && (oc[0] || oc[1])) (oc[0] >= oc[1] ? good : warn).push(`최근 ${Y}년 ${label} 개업 ${oc[0]}곳, 폐업 ${oc[1]}곳이에요.`)
  if (hasSales) {
    if (K.grow >= 0) good.push(`${label} 매출이 1년 전보다 ${rnd(K.grow * 100)}% 늘었어요.`)
    else warn.push(`${label} 매출이 1년 전보다 ${rnd(-K.grow * 100)}% 줄었어요.`)
  }
  const wk = week ?? fw
  const we = (wk[5] + wk[6]) / 2 / (sum(wk.slice(0, 5)) / 5)
  if (hasSales && we < 0.85) warn.push(`주말 하루 매출이 평일의 ${rnd(we * 100)}% 수준이에요.`)
  if (hasSales && vac >= 5) warn.push(`방학이 낀 1·3분기 매출이 다른 분기보다 ${vac}% 적어요.`)
  if (ch && ch[1] < ch[2]) warn.push(`가게 평균 영업 기간이 ${ch[1]}개월로 서울(${ch[2]}개월)보다 짧아요.`)

  let title = we < 0.85 ? '평일 장사 자리' : '주말에도 붐비는 자리'
  if (fa[1] >= 25 && fc(2) > 0) title = '대학가 ' + title   // 20대 많고 대학이 있을 때만

  return {
    cat: { name: cat, code, label },
    home: { code: H[0], name: H[1], gu: S.gu[H[4]] ?? H[4], inside: home.inside, dist: home.dist },
    missing, ...(missing ? { missingReason: code ? 'nodata' : 'nocode' } : {}),
    asOf: { sales: qname(S.qS), flow: qname(S.qF) },
    area: { home: H[1], near: near.map(a => a[1]), n: near.length },
    grade: { g: G, t: title, s: `${H[1]} 상권 등 걸어서 닿는 상권 ${near.length}곳 기준` },
    score: SC,
    insight: { good: good.slice(0, 3), warn: warn.slice(0, 3) },
    sales: salesOut,
    flow: {
      day: flowDay, seoul: flowSeoul, peak, hours: HB.map((h, k) => [h, fh[k]]), week: DAYS.map((d, k) => [d, fw[k]]),
      age: AG.map((g, k) => [g, fa[k]]), female: rnd(fs(1) / Math.max(fs(0), 1) * 100),
    },
    people: {
      live: ls(0), work: rnd(sum(NEAR.map(c => AF[c].w ?? 0))), house: ls(1), aptHouse: ls(2), otherHouse: ls(3),
    },
    place: {
      stations: st, bus: fc(0), subway: fc(1),
      schools: [['대학교', fc(2)], ['고등학교', fc(3)], ['중학교', fc(4)], ['초등학교', fc(5)]],
      etc: [['병원', fc(6, 7)], ['약국', fc(8)], ['은행', fc(9)], ['관공서', fc(10)], ['슈퍼마켓', fc(11)]],
      apt: {
        complex: rnd(aptCx), house: rnd(aptN), price: r1(aptPrice / 1e8),
        sizes: [['66㎡ 미만', rnd(aptHouse[0] / Math.max(aptN, 1) * 100)], ['66–99㎡', rnd(aptHouse[1] / Math.max(aptN, 1) * 100)],
          ['99㎡ 이상', rnd((aptHouse[2] + aptHouse[3] + aptHouse[4]) / Math.max(aptN, 1) * 100)]],
      },
    },
    change: {
      state: ch ? CH[ch[0]] : null, stateNote: ch ? NOTE[ch[0]] : null, states: ['줄어드는 중', '그대로', '커지는 중', '자주 바뀜'],
      years, life: ch ? r1(ch[1] / 12) : null, lifeSeoul: ch ? r1(ch[2] / 12) : null,
    },
    recommend: fit,
    trend,
    compare: [{ name: H[1], sub: '', cafes: K ? K.n : 0, stores: K ? K.n : 0, sales: hasSales ? K.month : null, flow: flowDay, grade: G }],
  }
}
