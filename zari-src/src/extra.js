// 상권분석서비스 밖의 실제 자료로 리포트 칸을 채운다
// spend.json: 동별 지출(소비-행정동) · 구별 소득(국세청) — scripts/build_spend.py
// lic/: 인허가 개업·폐업 이력 — scripts/build_license.py
// rent.json: 부동산원 조사 상권 임대료·공실률 · 서울시 실태조사 권리금 — scripts/build_rent.py
const base = () => import.meta.env.BASE_URL + 'data/'
const cache = {}
const get = p => (cache[p] ??= fetch(base() + p).then(r => { if (!r.ok) throw new Error(p); return r.json() }).catch(e => { delete cache[p]; throw e }))
const rnd = x => Math.round(x)
const r1 = x => Math.round(x * 10) / 10

// 동 지출과 구 소득. homeCode: 내 자리 상권 코드, gu: 구 이름
async function spend(homeCode, gu) {
  const D = await get('spend.json')
  const dc = D.a2d[homeCode], d = D.dong[dc]
  const guPay = D.gu[gu]
  const pays = Object.values(D.gu)
  const out = {
    income: guPay ? rnd(guPay / 12) : null, incomeSeoul: rnd(pays.reduce((a, b) => a + b, 0) / pays.length / 12),
    incomeAsOf: D.guAsOf, spendAsOf: D.asOf, dc,
  }
  if (d) {
    const v = d.slice(1, 1 + D.keys.length), t = v.reduce((a, b) => a + b, 0)
    const food = v[D.keys.indexOf('음식')], ago = d[1 + D.keys.length]
    Object.assign(out, {
      dong: d[0], spendTotal: t, food,
      foodGrow: ago ? rnd((food / ago - 1) * 100) : null,
      // 항목, 이 동 비중, 서울 동 가운데 비중 (큰 순 6개)
      shares: t ? D.keys.map((k, i) => [k, r1(v[i] / t * 100), D.med[i]]).sort((a, b) => b[1] - a[1]).slice(0, 6) : [],
    })
  }
  return out
}

// 생존율 · 문 연 지: 인허가 이력(lic/, scripts/build_license.py)으로 반경 R 안 같은 업종 가게를 센다
const R = 500
async function survive(lon, lat, code) {
  const I = await get('lic/index.json')
  const ci = I.codes.indexOf(code)
  if (ci < 0) return null
  const T = I.tile, tx = Math.floor(lon / T), ty = Math.floor(lat / T), has = new Set(I.tiles)
  const names = []
  for (let x = tx - 1; x <= tx + 1; x++) for (let y = ty - 1; y <= ty + 1; y++) if (has.has(`${x}_${y}`)) names.push(`${x}_${y}`)
  const tiles = await Promise.all(names.map(n => get(`lic/t/${n}.json`).then(a => [n, a])))
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540
  const rs = []
  for (const [n, a] of tiles) {
    const [x0, y0] = n.split('_').map(Number)
    for (let i = 0; i < a.length; i += 5) {
      if (a[i] !== ci) continue
      const lo = (x0 * 1000 + a[i + 1]) / 1e5, la = (y0 * 1000 + a[i + 2]) / 1e5
      if (Math.hypot((lo - lon) * kx, (la - lat) * ky) <= R) rs.push([a[i + 3], a[i + 4]])
    }
  }
  const now = (+I.asOf.slice(0, 4) - 2000) * 12 + +I.asOf.slice(4) - 1, from = (I.from - 2000) * 12
  const sv = [1, 3, 5].map(k => {
    const co = rs.filter(([o]) => o >= from && o <= now - k * 12)
    return [co.length ? rnd(co.filter(([o, c]) => !c || c - o >= k * 12).length / co.length * 100) : null, co.length]
  })
  const age = [0, 0, 0, 0]
  for (const [o, c] of rs) if (!c) { const y = (now - o) / 12; age[y < 1 ? 0 : y < 3 ? 1 : y < 5 ? 2 : 3]++ }
  const open = age.reduce((a, b) => a + b, 0)
  const SE = I.seoul[code], AG = ['1년 미만', '1–3년', '3–5년', '5년 넘음']
  return {
    r: R, asOf: `${I.asOf.slice(0, 4)}년 ${+I.asOf.slice(4)}월`, from: I.from, open,
    // [기간, 이 자리, 서울, 표본 수]
    s: ['1년', '3년', '5년'].map((t, k) => [t, sv[k][0], SE.s[k], sv[k][1]]),
    ages: open ? AG.map((t, k) => [t, rnd(age[k] / open * 100)]) : null,
    agesSeoul: SE.ages,
  }
}

// 임대료 · 공실률 · 권리금: 가장 가까운 부동산원 조사 상권 값(rent.json, scripts/build_rent.py)
async function rent(lon, lat) {
  const J = await get('rent.json')
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540
  const [a, d] = J.areas.map(a => [a, Math.hypot((a[2] - lon) * kx, (a[3] - lat) * ky)]).sort((p, q) => p[1] - q[1])[0]
  const [name, , , , r, vac, tr, , kind] = a
  return {
    area: name, dist: r1(d / 1000), rent: r1(r), vac, kind, asOf: J.asOf,
    trend: J.q.map((q, k) => [q, r1(tr[k])]),
    // 권리금: 1km 안 실태조사 상권이 있으면 그 값, 없으면 서울 평균
    ...(([k, kd]) => (kd <= 1000 ? { key: k[3], keyArea: k[0] } : { key: J.seoul.key, keyArea: null }))(
      J.keys.map(k => [k, Math.hypot((k[1] - lon) * kx, (k[2] - lat) * ky)]).sort((p, q) => p[1] - q[1])[0]),
    seoul: { rent: r1(J.seoul.rent), vac: J.seoul.vac, key: J.seoul.key },
  }
}

// 공릉로 232 미리 만든 리포트의 비교 후보 자리
const CMP_AT = { '공릉역 2번 출구': [127.0729, 37.6256], '하계역 1번 출구': [127.0688, 37.6364] }

// 리포트(S: seoulCalc 결과)에 실제 자료 칸을 붙인다. 실패한 자료는 빼고 나머지만
export async function addExtra(S, { lon, lat }) {
  let home = S.home
  if (!home) {   // 공릉로 232 미리 만든 리포트: 상권 이름으로 코드를 찾는다
    const ix = await get('sa/index.json')
    const a = ix.areas.find(x => x[1] === S.area?.home)
    home = { code: a?.[0], gu: '노원구' }
  }
  const code = S.cat?.code ?? 'CS100010'   // 미리 만든 리포트는 카페
  const pts = (S.compare ?? []).map((c, k) => (k === 0 ? [lon, lat] : CMP_AT[c.name]))
  const [sp, sv, rt, cmp] = await Promise.allSettled([spend(home.code, home.gu), survive(lon, lat, code), rent(lon, lat),
    Promise.all(pts.map(p => p ? Promise.all([rent(...p), survive(...p, code)]).then(([r, v]) => ({ rent: r.rent, survive: v?.s[1][1] ?? null })) : {}))])
  const real = {}
  if (sp.status === 'fulfilled') real.spend = sp.value
  if (sv.status === 'fulfilled' && sv.value) real.survive = sv.value
  if (rt.status === 'fulfilled') real.rent = rt.value
  if (cmp.status === 'fulfilled') real.cmp = cmp.value
  // 동별 계절 계수(pop/season.json, scripts/build_season.py): 각 달 평일 생활인구 ÷ 10월
  const dc = real.spend?.dc
  if (dc) {
    const se = await get('pop/season.json').catch(() => null)
    if (se?.dong[dc]) real.season = { m: se.dong[dc], asOf: se.asOf, dong: real.spend.dong }
  }
  // 공공 모집 공고(listings.json): 자리에서 1.5km 안, 공고에 적힌 조건만
  const L = await get('listings.json').catch(() => null)
  if (L) {
    const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540
    const items = L.items.filter(x => x.lon).map(x => ({ ...x, dist: rnd(Math.hypot((x.lon - lon) * kx, (x.lat - lat) * ky)) }))
      .filter(x => x.dist <= 1500).sort((a, b) => a.dist - b.dist)
    if (items.length) real.listings = { asOf: L.asOf, items }
  }
  return { ...S, real }
}

// 생활인구 250m 칸(pop/, scripts/build_pop.py): 자리에서 R m 안 칸의 시간대별 사람 수
export async function popCells(lon, lat, R = 900) {
  const I = await get('pop/index.json')
  const T = I.tile, tx = Math.floor(lon / T), ty = Math.floor(lat / T), has = new Set(I.tiles)
  const names = []
  for (let x = tx - 1; x <= tx + 1; x++) for (let y = ty - 1; y <= ty + 1; y++) if (has.has(`${x}_${y}`)) names.push(`${x}_${y}`)
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110540
  const cells = (await Promise.all(names.map(n => get(`pop/${n}.json`)))).flat()
    .map(([lo, la, ...h]) => ({ lon: lo, lat: la, h, d: Math.hypot((lo - lon) * kx, (la - lat) * ky) }))
    .filter(c => c.d <= R)
  return { asOf: I.asOf, days: I.days, cells }
}

// 공실 후보 건물에 최근 3년 폐업 기록(lic/)을 붙인다: 건물 안이나 가운데서 15m 안에 있던 가게가 문을 닫았으면 공실일 가능성이 높다
const inRing = (r, x, y) => {
  let o = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o
  }
  return o
}
export async function closures(B) {
  const em = B?.features.filter(f => f.properties.empty)
  if (!em?.length) return B
  const I = await get('lic/index.json')
  const T = I.tile, has = new Set(I.tiles)
  const now = (+I.asOf.slice(0, 4) - 2000) * 12 + +I.asOf.slice(4) - 1, since = now - 36
  const box = em.map(f => {
    const r = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]
    const c = r.slice(1).reduce((a, q) => [a[0] + q[0] / (r.length - 1), a[1] + q[1] / (r.length - 1)], [0, 0])
    return { f, r, c, n: 0, last: 0 }
  })
  const names = [...new Set(box.map(b => `${Math.floor(b.c[0] / T)}_${Math.floor(b.c[1] / T)}`))].filter(n => has.has(n))
  const tiles = await Promise.all(names.map(n => get(`lic/t/${n}.json`).then(a => [n, a])))
  const lat0 = box[0].c[1], kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540
  for (const [n, a] of tiles) {
    const [x0, y0] = n.split('_').map(Number)
    for (let i = 0; i < a.length; i += 5) {
      const c = a[i + 4]
      if (!c || c < since) continue
      const lo = (x0 * 1000 + a[i + 1]) / 1e5, la = (y0 * 1000 + a[i + 2]) / 1e5
      for (const b of box) {
        if (Math.hypot((lo - b.c[0]) * kx, (la - b.c[1]) * ky) > 60) continue
        if (inRing(b.r, lo, la) || Math.hypot((lo - b.c[0]) * kx, (la - b.c[1]) * ky) <= 15) { b.n++; b.last = Math.max(b.last, c) }
      }
    }
  }
  const hit = new Map(box.filter(b => b.n).map(b => [b.f, b]))
  return { ...B, features: B.features.map(f => {
    const b = hit.get(f)
    return b ? { ...f, properties: { ...f.properties, closed: b.n, closedLast: `${2000 + Math.floor(b.last / 12)}년 ${(b.last % 12) + 1}월` } } : f
  }) }
}
