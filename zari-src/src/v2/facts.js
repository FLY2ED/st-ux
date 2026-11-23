// 문장에 쓰는 숫자: 지금 화면 Report와 같은 계산(useStats · plan · 예산 맞춤)
import { useMemo } from 'react'
import { DEMO } from '../demo.js'
import { useStats, plan, fits } from '../Report.jsx'
import { shortAddr } from '../LineMap.jsx'
import { pp, fmt } from './data.js'

const pct = v => (v * 100).toFixed(1) + '%'
const LV = ['적은 편', '보통', '높은 편']

export function useFacts({ report: R, bld, what, budget }) {
  const S = useStats(R, 300)
  return useMemo(() => {
    const Q = R.query, C = R.compare, D = DEMO
    const W = what.t
    const vac = bld ? bld.features.map(f => f.properties).filter(p => p.empty === 1 && !p.tgt && p.dist <= 300) : []
    const fit = vac.filter(p => fits(p, budget))
    const near = [...S.near].sort((a, b) => a.dist - b.dist)
    const P = plan()
    const crowd = (100 - C.topPct + (100 - C.sharePct)) / 2
    const level = crowd >= 70 ? 2 : crowd >= 40 ? 1 : 0
    // 공공 모집 공고(1.5km 안): 같은 자리는 한 점으로, "청년가게 3·4호점"처럼
    const L = D.real?.listings
    const items = L?.items || []
    const closed = items.filter(x => x.until && x.until < L.asOf)
    const only = [...new Set(items.map(x => x.only).filter(Boolean))]
    const groups = new Map()
    for (const x of items) if (x.lon && x.lat) { const k = x.lon.toFixed(4) + ',' + x.lat.toFixed(4); groups.set(k, [...(groups.get(k) || []), x]) }
    const pts = [...groups.values()].map(g => {
      const nm = g[0].name.replace(/^\S+구?\s+(?=청년)/, '').replace(/^노원\s+/, '')
      const nos = g.map(x => x.name.match(/(\d+)호점/)?.[1]).filter(Boolean)
      return { lon: g[0].lon, lat: g[0].lat, t: nos.length > 1 ? nm.replace(/\d+호점/, nos.join('·') + '호점') : nm }
    })
    const kind = items.length && items.every(x => /청년가게/.test(x.name)) ? '청년가게 공고' : '공공 상가 공고'
    return { Q, C, D, S, W, vac, fit, near, P, level, LV: LV[level], items, closed, only, pts, kind, addr: shortAddr(Q.address), pct, fmt, vacOk: !D.sales.none && D.sales.vac >= 5 }
  }, [R, bld, what, budget, S])
}

// 왼쪽 문장들. 조각: [글, 'k'(진하게) | 'o'(공실 주황) | undefined(회색)]
// 문장마다 원 지도에 보일 것: layer(층) · fk(밝힐 건물)
export function paras(F) {
  const { W, S, C, D, near, vac, fit, P, items, closed, only, kind } = F
  const out = []
  out.push({ id: 'sum', layer: 'bcol', fk: 'both', segs: [
    [F.addr, 'k'], ['에 ' + pp(W, '을', '를') + ' 차리면, 걸어서 5분 안에 '], [pp(W, '이', '가') + ' ' + S.count + '곳', 'k'], [' 있어요. '],
    ['비어 있는 가게는 ' + vac.length + '곳', 'o'], [', 그중 '], [fit.length + '곳이 예산 안', 'k'], ['이에요.'],
  ] })
  out.push({ id: 'comp', layer: 'bcol', fk: 'cafe', segs: [
    ['걸어서 5분 안 가게 ' + fmt(S.total) + '곳 중 '], [pp(W, '은', '는') + ' ' + S.count + '곳, ' + F.pct(S.share), 'k'], ['이에요. 서울 평균 ' + F.pct(C.seoulShare) + '보다 '],
    [S.share > C.seoulShare ? '많아요' : '적어요', 'k'], ['. '],
    ...(near[0] ? [['가장 가까운 ' + pp(W, '은', '는') + ' '], [near[0].dist + 'm', 'k'], [' 거리에 있어요.']] : []),
  ] })
  if (!D.sales.none) out.push({ id: 'sales', layer: 'flow', segs: [
    ['주변 ' + pp(W, '은', '는') + ' 한 달에 평균 '], [fmt(D.sales.month) + '만 원', 'k'], ['을 벌어요. 서울 평균 ' + fmt(D.sales.seoul) + '만 원보다 '],
    [D.sales.month >= D.sales.seoul ? '많고' : '적고', 'k'],
    ...(F.vacOk ? [[', 방학이 낀 1·3분기엔 '], [D.sales.vac + '%쯤 줄어요', 'k'], ['.']] : [[', 하루 유동인구는 '], [fmt(D.flow.day) + '명', 'k'], ['이에요.']]),
  ] })
  else out.push({ id: 'sales', layer: 'flow', segs: [['이 업종은 서울시 매출 자료가 없어요. 대신 하루 유동인구는 '], [fmt(D.flow.day) + '명', 'k'], ['이에요.']] })
  const T = S.top
  if (T.length) out.push({ id: 'mix', layer: 'shops', segs: [
    ['이 근처에 가장 많은 건 '], [T[0][0] + ' ' + T[0][1] + '곳', 'k'], ['. 그다음이 '],
    ...T.slice(1, 4).flatMap(([c, n], j) => [[c + ' ' + n + '곳', c === F.Q.what ? 'k' : undefined], [j < Math.min(2, T.length - 2) ? ', ' : '']]),
    ['이에요.'],
  ] })
  const eok = v => (v >= 10000 ? (v / 10000).toFixed(1).replace(/\.0$/, '') + '억 원' : fmt(Math.round(v / 100) * 100) + '만 원')
  out.push({ id: 'cost', layer: 'bcol', fk: 'empty', segs: [
    ['10평 기준 처음 드는 돈은 '], [eok(P.total), 'k'], ['. '],
    ...(P.K && P.profit > 0 ? [['매달 '], [fmt(P.profit) + '만 원', 'k'], ['쯤 남아서, '], [P.payback + '개월', 'k'], ['이면 처음 든 돈을 다 벌어요.']]
      : P.K ? [['지금 값으로는 '], ['한 달에 남는 돈이 없어요', 'k'], ['.']]
      : [['월세는 약 '], [fmt(Math.round(P.C0.rent * 33)) + '만 원', 'k'], ['이에요.']]),
  ] })
  if (items.length) out.push({ id: 'list', layer: 'list', segs: [
    ['1.5km 안에 ' + kind + ' '], [items.length + '곳', 'k'], ['이 있었지만 '],
    ...(closed.length === items.length ? [['모두 마감됐고', 'k']] : [['그중 ' + (items.length - closed.length) + '곳은 아직 받고 있고', 'k']]),
    ...(only.length ? [[', '], [only[0].replace(/\s*제외$/, '') + '는 받지 않아요', 'k'], ['.']] : [['요.']]),
  ] })
  else out.push({ id: 'list', layer: 'list', segs: [['1.5km 안에 올라온 '], ['공공 상가 공고는 없어요', 'k'], ['.']] })
  return out
}
