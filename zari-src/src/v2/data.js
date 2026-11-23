// v2 화면이 같이 쓰는 자리·업종 데이터 (지금 화면 App.jsx와 같은 흐름)
import { useEffect, useMemo, useState } from 'react'
import { DEMO, setDemo, BASE_SEOUL } from '../demo.js'
import { seoulReport } from '../seoulCalc.js'
import { addExtra, closures } from '../extra.js'
import { rebase } from '../place.js'
import { BASE, isBase, buildReport, buildBuildings } from '../report.js'
import { shortAddr } from '../LineMap.jsx'

export const PRESETS = [
  { label: '공릉로 232', sub: '서울과기대 정문 · 노원구', ...BASE },
  { label: '홍대입구역', sub: '마포구 양화로 160', address: '서울 마포구 양화로 160', near: '홍대입구역', dong: '서교동', lon: 126.9237, lat: 37.5571 },
  { label: '성수역', sub: '성동구 아차산로 100', address: '서울 성동구 아차산로 100', near: '성수역', dong: '성수동2가', lon: 127.0559, lat: 37.5446 },
  { label: '강남역', sub: '강남구 강남대로 396', address: '서울 강남구 강남대로 396', near: '강남역', dong: '역삼동', lon: 127.0276, lat: 37.4979 },
]
export const strip = ({ label, sub, ...p }) => p

// 받침 있으면 a, 없으면 b
const jong = w => { const c = String(w).trim().slice(-1).charCodeAt(0); if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 > 0; return /[013678]$/.test(w) }
export const pp = (w, a, b) => w + (jong(w) ? a : b)
export const fmt = n => Math.round(n).toLocaleString('ko-KR')

// place·what이 바뀌면 리포트·건물·서울시 숫자를 새로 읽는다. 다 읽으면 DEMO도 바뀐다
export function useZari(place, what) {
  const [st, setSt] = useState({ key: null, report: null, bld0: null })
  const key = place.lon + ',' + place.lat + ',' + what
  useEffect(() => {
    let off = false
    const q = { ...place, what }
    const base = isBase(q)
    const p = base
      ? Promise.all(['./data/report-gongneung-cafe.json', './data/buildings-gongneung.json'].map(u => fetch(u).then(r => r.json())))
      : buildReport(q).then(r => buildBuildings(r).then(b => [r, b]))
    const pc = p.then(([r, b]) => closures(b).catch(() => b).then(b2 => [r, b2]))
    const sp = (base ? Promise.resolve(BASE_SEOUL) : seoulReport({ lon: q.lon, lat: q.lat, cat: what }).catch(() => BASE_SEOUL))
      .then(S => addExtra(S, q).catch(() => S))
    Promise.all([pc, sp]).then(([[r, b], S]) => {
      if (off) return
      setDemo(S, shortAddr(q.address))
      setSt({ key, report: r, bld0: b })
    }).catch(e => console.error(e))
    return () => { off = true }
  }, [key])
  const { report, bld } = useMemo(() => (st.report ? rebase(st.report, st.bld0, null, DEMO.cost) : { report: null, bld: null }), [st])
  return { ready: st.key === key && !!report, report, bld }
}
