import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import PixelMap from './PixelMap.jsx'
import LineMap from './LineMap.jsx'
import Report from './Report.jsx'
import { DEMO, SEOUL, setDemo, BASE_SEOUL } from './demo.js'
import { seoulReport } from './seoulCalc.js'
import { addExtra, closures } from './extra.js'
import { rebase } from './place.js'
import Field from './Field.jsx'
import { search, reverse, findCat } from './search.js'
import { BASE, isBase, buildReport, buildBuildings, loadCats } from './report.js'
import { shortAddr } from './LineMap.jsx'
import { Pin, PIN, PIN_CELLS, SearchIcon, ArrowIcon } from './pin.jsx'
import { clamp, ioc, INTRO, makeClock, params } from './motion.js'

const COL = 460 // PC 왼쪽 칸 폭
// 메뉴 버튼이 그대로 늘어나 패널이 된다
const MORPH = { type: 'tween', duration: .6, ease: [.65, 0, .35, 1] }
const isMob = () => innerWidth < 760

// 메뉴 내용: 지금 화면에 있는 기능·데이터 기준
const NAV = {
  how: { k: 'HOW IT WORKS', t: '네 단계로 자리를 골라요', body: [
    ['01', '업종과 자리 입력', '“공릉로 232 카페”처럼 쓰면 서울 픽셀 지도가 그 자리로 확대되고, 선으로 그린 실제 지도로 바뀌어요.'],
    ['02', '지도에서 주변 보기', '걸어서 5분(300m) 안 카페는 큰 네모, 다른 가게는 작은 네모예요. 네모를 누르면 그 가게 업종·층·거리가, 건물을 누르면 그 안에 든 가게가 떠요. 유동인구를 켜면 시간대·월별로 사람이 몰리는 곳이 영상처럼 바뀌고, 주변 시설을 켜면 역·버스·학교·병원과 걸어서 5·10분 범위가 보여요. 3D를 누르면 건물이 세워져요.'],
    ['03', '리포트 읽기', '맨 위에서 매출 · 경쟁 · 비용 세 가지를 문장과 큰 숫자로 먼저 보여 줘요. 나머지(유동인구 · 주민 · 개폐업 · 손익 계산 · 추천)는 자세히를 눌러 펼쳐요. 공유로 링크를 복사해요.'],
    ['04', '후보 담고 비교', '비교함에 3곳까지 담아 매출·임대료·생존율을 나란히 보고, 줄마다 가장 좋은 값을 표시해요.'],
  ] },
  data: { k: 'DATA', t: '쓰는 데이터', body: [
    ['REAL', '소상공인시장진흥공단 상가(상권)정보', '서울 553,374곳 · 2026년 6월 · 가게 수, 업종 구성, 가까운 카페와 층, 프랜차이즈 비율'],
    ['REAL', '서울 200m 상권 4,797곳 비교', '가게 30곳 넘는 칸의 반경 300m와 견줘 경쟁 강도(적음·보통·많음)를 매겨요.'],
    ['REAL', 'OpenFreeMap · OpenStreetMap', '도로·건물·물길 선 지도, 건물 높이(3D), 지하철역·버스정류장·학교·병원 위치'],
    ['REAL', 'Overture Maps 건물', '가게를 건물에 맞춰 건물마다 든 가게·카페·층을 세요. 카페에 올리거나 건물을 누르면 보여요.'],
    ['REAL', '서울 열린데이터광장 상권분석서비스', `추정매출 ${SEOUL.asOf.sales} · 유동·상주·직장 인구 ${SEOUL.asOf.flow} · 집객 시설 · 아파트 · 점포 개폐업. 내 자리에서 600m 안 상권 ${SEOUL.area.n}곳을 합쳐 서울 상권과 견줘요.`],
    ['REAL', '한국부동산원 임대동향 · 서울시 상가임대차 실태조사', '임대료·공실률 2026년 3분기(가장 가까운 조사 상권) · 권리금 2023년 조사. 공실 월세도 이 임대료로 셈해요.'],
    ['REAL', '인허가 이력 · 서울 생활인구', '반경 500m 같은 업종 가게의 1·3·5년 생존율과 문 연 지 · 공실 후보 건물의 최근 3년 폐업 · 250m 칸 시간대별 사람 수(2026년 10월 평일) · 동별 달마다 변화(2025년)'],
    ['REAL', '국세청 · 소비-행정동', '구별 직장인 급여 · 동별 지출 구성'],
    ['REAL', '통계청 서비스업조사 2024', '매출 대비 인건비·임차료·영업비용 비율. 카페·한식·미용실은 서울 값, 다른 음식점은 전국 음식점 전체 값으로 손익을 셈해요.'],
    ['REAL', '노원구 청년가게 · SH 임대상가 공고', '공공 모집 공고에 적힌 층·넓이·보증금·월세·마감일. 지난 공고라 지금 비어 있는지는 확인이 필요해요.'],
    ['SAMPLE', '가게 하나하나의 매출 · 민간 공실 매물 조건 · 공사비', '공개 자료가 없어요. 가게 카드엔 주변 같은 업종 평균만 보여 주고, 공실 보증금은 월세 10달치, 인테리어·장비비는 예시 값으로 셈해요.'],
  ] },
  about: { k: 'ABOUT', t: 'ZARI', stats: [['553,374', '서울 가게'], ['4,797', '비교 상권'], ['799', '가게를 맞춘 건물']], body: [
    ['WHY', '서울에서 카페·식당 자리 고르기', '창업하려는 사람이 후보 자리 몇 곳을 같은 기준으로 비교하도록 돕는 서비스예요.'],
    ['HOW', '여러 서비스 기능을 한 화면에', '소상공인365, 서울시 상권분석, 오픈업 같은 서비스의 기능을 모으고, 지도와 리포트가 끊기지 않게 이어 붙였어요.'],
    ['NOW', '기획 시연', '서울 어느 주소·업종이든 리포트를 바로 만들어요. 매출·유동인구·주민·개폐업·임대료·생존율·업종 비용 비율은 공공 실제 데이터, “예시” 표시가 붙은 칸만 시연용 숫자예요.'],
  ] },
}

// 받침이 있으면 '을', 없으면 '를'
const eul = w => ((w.charCodeAt(w.length - 1) - 0xac00) % 28 ? '을' : '를')

// 입력칸이 비었을 때 보여 주는 자리
const PRESETS = [
  { label: '공릉로 232', sub: '서울과기대 정문 · 노원구', ...BASE },
  { label: '홍대입구역', sub: '마포구 양화로 160', address: '서울 마포구 양화로 160', near: '홍대입구역', dong: '서교동', lon: 126.92370, lat: 37.55710 },
  { label: '성수역', sub: '성동구 아차산로 100', address: '서울 성동구 아차산로 100', near: '성수역', dong: '성수동2가', lon: 127.05590, lat: 37.54460 },
  { label: '강남역', sub: '강남구 강남대로 396', address: '서울 강남구 강남대로 396', near: '강남역', dong: '역삼동', lon: 127.02760, lat: 37.49790 },
]
const strip = ({ label, sub, ...p }) => p
// 주소창으로 받은 자리: ?lon=&lat=&what=&addr=&near=&dong=
const fromUrl = () => {
  const lon = +params.get('lon'), lat = +params.get('lat')
  if (!lon || !lat) return null
  return { address: params.get('addr') || `서울 ${lat.toFixed(4)}, ${lon.toFixed(4)}`, near: params.get('near') || '', dong: params.get('dong') || '', lon, lat }
}
const labelOf = p => p.near && !/에서 \d+m$/.test(p.near) && /역$|입구$/.test(p.near) ? p.near : shortAddr(p.address)

export default function App() {
  const clock = useMemo(makeClock, [])
  const [grid, setGrid] = useState(null)
  const [report, setReport] = useState(null)
  const [phase, setPhase] = useState(params.get('view') === 'report' ? 'report' : 'home')
  const [mapOn, setMapOn] = useState(phase === 'report')
  const [nav, setNav] = useState(params.get('nav'))
  const [mob, setMob] = useState(isMob())
  const [place, setPlace] = useState(() => fromUrl() || strip(PRESETS[0]))
  const [where, setWhere] = useState(() => labelOf(place))
  const [what, setWhat] = useState(params.get('what') || BASE.what)
  const [busy, setBusy] = useState(false)
  const loadRef = useRef(null)
  const radius = 300 // 걸어서 5분 안으로 고정
  const [active, setActive] = useState(null)
  const [focus, setFocus] = useState(null)
  const [saved, setSaved] = useState(false)
  // 지도에서 옮긴 내 자리(건물 번호) · 공실 예산(처음 드는 돈, 만 원)
  const [bld0, setBld0] = useState(null)
  const [spot, setSpot] = useState(null)
  const [budget, setBudget] = useState({ start: 10000, month: 300 })
  const { report: R, bld } = useMemo(() => rebase(report, bld0, spot, DEMO.cost), [report, bld0, spot])
  const tipRef = useRef(null), imRef = useRef(null), markRef = useRef(null), qRef = useRef(null), wordRef = useRef(null)

  useEffect(() => {
    fetch('./data/seoul-grid.json').then(r => r.json()).then(setGrid)
    const rs = () => setMob(isMob())
    addEventListener('resize', rs)
    return () => removeEventListener('resize', rs)
  }, [])

  // 자리·업종이 바뀌면 리포트와 건물을 새로 만든다(공릉로 232 카페는 미리 만든 파일)
  useEffect(() => {
    let off = false
    const q = { ...place, what }
    const base = isBase(q)
    const p = base
      ? Promise.all(['./data/report-gongneung-cafe.json', './data/buildings-gongneung.json'].map(u => fetch(u).then(r => r.json())))
      : buildReport(q).then(r => buildBuildings(r).then(b => [r, b]))
    // 공실 후보 건물에 최근 3년 폐업 기록을 붙인다
    const pc = p.then(([r, b]) => closures(b).catch(() => b).then(b2 => [r, b2]))
    // 매출·유동인구 등 서울시 상권 숫자: 그 자리에서 걸어서 닿는 상권을 묶어 계산
    const sp = (base ? Promise.resolve(BASE_SEOUL) : seoulReport({ lon: q.lon, lat: q.lat, cat: what }).catch(() => BASE_SEOUL))
      .then(S => addExtra(S, q).catch(() => S))
    setBusy(true)
    loadRef.current = Promise.all([pc, sp]).then(([[r, b], S]) => {
      if (off) return
      setDemo(S, shortAddr(q.address)); setReport(r); setBld0(b); setSpot(null); setFocus(null); setBusy(false)
    })
      .catch(() => { if (!off) setBusy(false) })
    return () => { off = true }
  }, [place, what])
  // 지금 보는 자리를 주소창에 남겨 링크로 나눌 수 있게
  useEffect(() => {
    const u = new URLSearchParams(location.search)
    if (phase === 'report') Object.entries({ view: 'report', lon: place.lon.toFixed(5), lat: place.lat.toFixed(5), what, addr: place.address, near: place.near, dong: place.dong }).forEach(([k, v]) => (v ? u.set(k, v) : u.delete(k)))
    else ['view', 'lon', 'lat', 'what', 'addr', 'near', 'dong'].forEach(k => u.delete(k))
    const qs = u.toString()
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash)
  }, [phase, place, what])
  const pickPlace = it => { setPlace(strip(it)); setWhere(it.label) }
  const dropPin = async (lon, lat) => {
    const p = { lon, lat, address: '서울 · 찾는 중', near: '', dong: '' }
    setPlace(p); setWhere('지도에서 고른 자리')
    const r = await reverse(lon, lat)
    setPlace(cur => (cur === p ? r : cur)); setWhere(w => (w === '지도에서 고른 자리' ? shortAddr(r.address) : w))
  }

  // 인트로: 핀 찍힘 → 착지 → 물결이 퍼지는 동안 핀은 왼쪽 위 로고 자리로 → ZARI → 검색창
  useEffect(() => {
    let raf
    const cell = isMob() ? 16 : 22
    const mw = PIN[0].length * cell, mh = PIN.length * cell
    const rects = [...imRef.current.querySelectorAll('rect')]
    const order = rects.map((_, i) => i).sort(() => Math.random() - .5)
    let done = false
    const loop = () => {
      const t = clock.now()
      const IM = imRef.current, HM = markRef.current, letters = [...wordRef.current.children], Q = qRef.current
      if (t <= INTRO.end + 30) {
        done = false
        document.documentElement.classList.remove('ready')
        order.forEach((k, n) => (rects[k].style.opacity = t > n * (420 / order.length) ? 1 : 0))
        const drop = (1 - ioc(clamp(t / INTRO.land))) * -40
        const sq = 0
        const hb = HM.getBoundingClientRect(), f = ioc(clamp((t - INTRO.fly) / 800))
        const sx = innerWidth / 2 - mw / 2, sy = innerHeight / 2 - mh / 2 - 30
        const sc = 1 - f + f * (hb.height / mh)
        const x = sx + (hb.left - sx) * f + (mw * (1 - (1 + sq * .6)) / 2) * (1 - f)
        const y = sy + drop + (hb.top - sy) * f + mh * sq * (1 - f)
        IM.style.transform = `translate(${x}px,${y}px) scale(${sc * (1 + sq * .6)},${sc * (1 - sq)})`
        // 가운데(짙은 바탕)에선 흰 핀, 왼쪽 위(밝은 바탕)로 갈수록 로고 색으로
        IM.style.color = `rgb(${255 + (63 - 255) * f},${255 + (71 - 255) * f},${255 + (87 - 255) * f})`
        IM.style.display = t >= INTRO.flyEnd ? 'none' : ''
        HM.style.visibility = t >= INTRO.flyEnd ? 'visible' : 'hidden'
        letters.forEach((el, k) => {
          const p = ioc(clamp((t - INTRO.word - k * 80) / 500))
          el.style.opacity = p
          el.style.translate = `0 ${(1 - p) * 18}px`
        })
        const p = ioc(clamp((t - INTRO.pill) / 550))
        Q.style.opacity = p
        Q.style.translate = `0 ${(1 - p) * 18}px`
      } else if (!done) {
        done = true
        document.documentElement.classList.add('ready')
        IM.style.display = 'none'
        HM.style.visibility = 'visible'
        letters.forEach(el => { el.style.opacity = ''; el.style.translate = '' })
        Q.style.opacity = ''; Q.style.translate = ''
      }
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => cancelAnimationFrame(raf)
  }, [])

  // 로고 핀 ↔ 지도 핀: 같은 픽셀 핀이 왼쪽 위 로고 자리와 지도 위 내 자리 사이를 날아간다
  const flyRef = useRef(0)
  const pinAt = () => {
    const m = document.querySelector('.mapon .mpin svg')
    if (m) { const r = m.getBoundingClientRect(); if (r.width) return r }
    const h = markRef.current.getBoundingClientRect(), x = camera.cx(), y = camera.cy()
    return { left: x - h.width / 2, top: y - h.height, height: h.height }
  }
  const fly = (from, to, c0, c1, dur, end) => {
    const IM = imRef.current
    const id = ++flyRef.current, t0 = performance.now()
    IM.querySelectorAll('rect').forEach(r => (r.style.opacity = 1))
    IM.style.display = ''
    document.documentElement.classList.add('pinfly')
    const step = () => {
      if (id !== flyRef.current) return
      const f = ioc(clamp((performance.now() - t0) / dur)), a = from(), b = to()
      const x = a.left + (b.left - a.left) * f, y = a.top + (b.top - a.top) * f
      const sc = (a.height + (b.height - a.height) * f) / PIN.length / (mob ? 16 : 22)
      IM.style.transform = `translate(${x}px,${y}px) scale(${sc})`
      IM.style.color = `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * f)).join(',')})`
      if (f < 1) return requestAnimationFrame(step)
      IM.style.display = 'none'
      document.documentElement.classList.remove('pinfly')
      end?.()
    }
    step()
  }
  // 리포트가 다 만들어지면(서울 어디든 1초 안팎) 핀이 날아가며 확대된다
  const go = () => {
    document.activeElement?.blur?.()
    setActive(null)
    loadRef.current?.then(start)
  }
  const start = () => {
    const h0 = markRef.current.getBoundingClientRect()
    if (h0.width) fly(() => h0, pinAt, [63, 71, 87], [255, 255, 255], 1500)
    setPhase('report')
    // 픽셀 지도 확대가 2/3쯤 왔을 때 선 지도가 받는다
    setTimeout(() => setMapOn(true), 900)
  }
  const home = () => {
    const p0 = document.querySelector('.mapon .mpin svg')?.getBoundingClientRect()
    if (p0?.width) {
      markRef.current.style.visibility = 'hidden'
      fly(() => p0, () => markRef.current.getBoundingClientRect(), [255, 255, 255], [63, 71, 87], 900, () => (markRef.current.style.visibility = 'visible'))
    }
    setNav(null)
    setMapOn(false)
    setPhase('home')
    setActive(null)
  }
  useEffect(() => {
    const key = e => {
      if (e.key !== 'Escape') return
      if (document.activeElement?.closest?.('.fld')) return
      if (nav) setNav(null)
      else if (phase === 'report') home()
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [nav, phase])

  const camera = useMemo(() => ({
    z: phase === 'report' ? 1 : 0,
    lon: place.lon, lat: place.lat,
    cx: () => (isMob() ? innerWidth / 2 : COL + (innerWidth - COL) / 2),
    cy: () => (isMob() ? (100 + innerHeight * .44) / 2 : innerHeight / 2),
  }), [phase, place])

  // PC 리포트: 지도 위에서 굴려도 왼쪽 글이 내려간다(페이지 전체가 한 번에 스크롤되는 느낌, 원은 고정)
  useEffect(() => {
    if (phase !== 'report') return
    const on = e => {
      if (isMob() || !e.target.closest?.('.mapwrap') || e.ctrlKey || document.documentElement.classList.contains('sheeton')) return
      const col = document.querySelector('.col'); if (!col) return
      e.preventDefault(); e.stopPropagation(); col.scrollBy({ top: e.deltaY })
    }
    addEventListener('wheel', on, { capture: true, passive: false })
    return () => removeEventListener('wheel', on, { capture: true })
  }, [phase])

  const logo = () => {
    if (phase === 'report') home()
    else clock.replay()
  }

  return (
    <div className={`app ${phase} ${mob ? 'mob' : 'desk'}${mapOn ? ' mapon' : ''}`}>
      <PixelMap grid={grid} clock={clock} camera={camera} tipRef={tipRef} interactive={phase === 'home'} pin={place} onPick={dropPin} />
      {report && (
        <LineMap key={`${report.query.lon},${report.query.lat},${report.query.cat}:${spot ?? 'base'}`} report={R} bld={bld} radius={radius} active={active} onActive={setActive} onPick={i => { setFocus(i); setActive(i) }}
          shown={mapOn} focus={focus} center={radius} budget={budget} onMove={i => { setActive(null); setFocus(null); setSpot(i) }} />
      )}

      <header className="top m">
        <a className="mark" ref={markRef} onClick={logo} aria-label="ZARI 처음으로" title="처음으로"><Pin size={30} /></a>
        <nav>
          {Object.keys(NAV).map(k => (
            <button key={k} className={nav === k ? 'on' : ''} onClick={() => setNav(nav === k ? null : k)}>
              {nav !== k && <motion.span layoutId={'nav-' + k} className="navbg" transition={MORPH} />}
              <span className="lb">{NAV[k].k}</span>
            </button>
          ))}
        </nav>
      </header>

      <div className="stage">
        <div className="word m" ref={wordRef}>
          {'ZARI'.split('').map((c, k) => <span key={k} style={{ '--k': k }}>{c}</span>)}
        </div>
        <div className="qwrap" ref={qRef}>
          <motion.form layout transition={{ duration: .9, ease: [.65, 0, .35, 1] }} className={'pill' + (busy ? ' busy' : '')}
            onSubmit={e => { e.preventDefault(); go() }}>
            <span className="ic"><SearchIcon /></span>
            <div className="sent" aria-label={`나는 ${where}에 ${what}${eul(what)} 차릴 거예요`}>
              <span className="w0">나는 </span>
              <Field value={where} label="WHERE · 서울 주소나 장소" placeholder="주소·역 이름" empty="서울 주소나 장소 이름을 쳐 보세요. 지도를 눌러도 돼요"
                find={q => (q ? search(q) : Promise.resolve(PRESETS))} onPick={pickPlace} />에{' '}
              <Field value={what} label="WHAT · 무슨 가게" placeholder="업종" empty="업종 이름을 쳐 보세요"
                find={q => loadCats().then(c => findCat(q, c || []))} onPick={it => setWhat(it.label)} />{eul(what)}{' '}
              <span className="w1">차릴 거예요</span>
            </div>
            <button className="go" aria-label="리포트 보기" aria-busy={busy}><ArrowIcon /></button>
          </motion.form>
        </div>
      </div>

      {report && (
        <aside className="col" aria-hidden={phase !== 'report'}>
          <a className="brand m" onClick={logo} title="처음으로">ZARI</a>
          {phase === 'report' && (
            <Report report={R} bld={bld} budget={budget} setBudget={setBudget} radius={radius} active={active} setActive={setActive}
              pick={i => { setFocus(i); setActive(i) }} saved={saved} onSave={() => setSaved(!saved)} />
          )}
        </aside>
      )}

      {saved && phase === 'report' && (
        <div className="tray glass m"><span>COMPARE {DEMO.compare.length}/3</span><b>{DEMO.compare.map(c => c.name).join(' · ')}</b><em>담아 둔 후보 자리 {DEMO.compare.length}곳 · {what}</em>
          <span className="tbw">{nav !== 'compare' && <motion.span layoutId="nav-compare" className="navbg w" transition={MORPH} />}
            <button onClick={() => setNav('compare')}>나란히 보기 →</button></span></div>
      )}

      <footer className="foot m">
        <span>SEOUL · 553,374 SHOPS · DATA 2026.06</span>
        <span className="hint">CLICK THE MAP · TYPE A SHOP + PLACE</span>
      </footer>

      <div className={'dim' + (nav ? ' on' : '')} onClick={() => setNav(null)} />
      <AnimatePresence>
        {nav && (
          <motion.aside key={nav} layoutId={'nav-' + nav} transition={MORPH} className={'navp' + (nav === 'compare' ? ' cmp' : '')}>
            <motion.div className="navfade" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: .48, duration: .3 } }} exit={{ opacity: 0, transition: { duration: .12 } }}>
              {nav === 'compare' ? <Compare what={what} close={() => setNav(null)} /> : (
                <div className="navin">
                  <button className="x m" onClick={() => setNav(null)} aria-label="닫기">CLOSE ✕</button>
                  <span className="k m">{NAV[nav].k}</span>
                  <h2>{NAV[nav].t}</h2>
                  {NAV[nav].stats && <div className="nstats">{NAV[nav].stats.map(([v, l], i) => <div key={l} style={{ '--i': i }}><b className="m">{v}</b><small>{l}</small></div>)}</div>}
                  {NAV[nav].body.map(([a, b, c], i) => (
                    <div key={i} className={'item' + (a === 'SAMPLE' ? ' eg2' : '')} style={{ '--i': i }}><span className="m">{a}</span><b>{b}</b><p>{c}</p></div>
                  ))}
                  {nav === 'how' && (
                    <button className="cta" style={{ '--i': 5 }} onClick={() => { setNav(null); if (phase === 'home') setTimeout(go, 450) }}>
                      {phase === 'home' ? `리포트 열기 · ${where} ${what}` : '리포트로 돌아가기'}<span className="m">→</span>
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          </motion.aside>
        )}
      </AnimatePresence>

      <div id="tip" ref={tipRef} className="tip glass m" />
      <div className="imark" ref={imRef}>
        <svg width={PIN[0].length * (mob ? 16 : 22)} height={PIN.length * (mob ? 16 : 22)} viewBox={`0 0 ${PIN[0].length} ${PIN.length}`} shapeRendering="crispEdges" fill="currentColor">
          {PIN_CELLS.map(([x, y]) => <rect key={x + '-' + y} x={x} y={y} width="1" height="1" />)}
        </svg>
      </div>
    </div>
  )
}

// 후보 자리 나란히 비교 (예시 후보 2곳 포함)
const CMP = [
  ['가게 수', 'cafes', v => v + '곳', 'min'],
  ['경쟁 강도', 'crowd', v => v, null],
  ['1곳 월매출', 'sales', v => (v == null ? '—' : v.toLocaleString() + '만'), 'max'],
  ['유동인구/일', 'flow', v => v.toLocaleString(), 'max'],
  ['임대료 ㎡/월', 'rent', v => (v == null ? '—' : v + '만'), 'min'],
  ['3년 생존율', 'survive', v => (v == null ? '—' : v + '%'), 'max'],
  ['상권 등급', 'grade', v => v, null],
]
// 걸어서 5분(300m) 원 안 건물을 업종별로 칠한 작은 지도 + 업종별 가게 수
const LU = [['cafe', '카페', '#1b2340'], ['food', '음식점', '#c4577a'], ['retail', '소매', '#e8b737'], ['service', '서비스·학원·사무', '#6c8fd8'], ['none', '가게 없는 건물', '#d5d9e0']]
const LUC = Object.fromEntries(LU.map(([k, , c]) => [k, c]))
function Circles() {
  const [d, setD] = useState(null)
  useEffect(() => { fetch('./data/compare-circles.json').then(r => r.json()).then(setD) }, [])
  if (!d) return <div className="circles" />
  const max = Math.max(...d.flatMap(p => LU.slice(0, 4).map(([k]) => p.shops[k])))
  return (
    <div className="circles">
      {d.map((p, k) => (
        <figure key={p.name} className={k === 0 ? 'me' : ''}>
          <svg viewBox="-310 -310 620 620" role="img" aria-label={p.name + ' 반경 300m 건물'}>
            <defs><clipPath id={'cc' + k}><circle r="300" /></clipPath></defs>
            <circle r="300" fill="#2a3242" />
            <g clipPath={`url(#cc${k})`}>{p.b.map(([t, r], j) => <polygon key={j} points={r.join(' ')} fill={LUC[t]} />)}</g>
            <circle r="300" fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="3" />
            <circle r="9" fill="#fff" stroke="#3b6fe0" strokeWidth="5" />
          </svg>
          <figcaption><b>{p.name}</b></figcaption>
          <div className="lu">
            {LU.slice(0, 4).map(([t, n, c]) => (
              <div key={t}><span>{n}</span><i><s style={{ width: (p.shops[t] / max) * 100 + '%', background: c }} /></i><em className="m">{p.shops[t]}</em></div>
            ))}
          </div>
        </figure>
      ))}
      <p className="lukey"><span>막대는 300m 안 가게 수 ·</span>{LU.map(([t, n, c]) => <span key={t}><i style={{ background: c }} />{n}</span>)}</p>
    </div>
  )
}

function Compare({ what, close }) {
  const P = DEMO.compare, many = P.length > 1
  return (
    <div className="navin">
      <button className="x m" onClick={close} aria-label="닫기">CLOSE ✕</button>
      <span className="k m">COMPARE · 걸어서 5분</span>
      <h2>{many ? `후보 자리 ${P.length}곳 비교` : '담아 둔 자리'}</h2>
      {many && <Circles />}
      <table className="cmpt">
        <thead><tr><th />{P.map((p, k) => <th key={p.name} className={k === 0 ? 'me' : ''}><b>{p.name}</b><small>{p.sub}</small></th>)}</tr></thead>
        <tbody>
          {CMP.map(([l, key, f, best]) => {
            const vs = P.map(p => p[key])
            const b = best === 'max' ? Math.max(...vs) : best === 'min' ? Math.min(...vs) : null
            return <tr key={key}><th>{l}</th>{P.map((p, k) => <td key={k} className={(p[key] === b ? 'best ' : '') + (k === 0 ? 'me' : '')}>{f(p[key])}</td>)}</tr>
          })}
        </tbody>
      </table>
      <p className="fine" style={{ marginTop: 18 }}>네모 표시는 그 줄에서 가장 좋은 값이에요. {what} 가게 수·월매출·유동인구·등급은 서울시 상권분석서비스({DEMO.asOf.sales}) 실제 값이에요. 임대료는 가장 가까운 한국부동산원 조사 상권, 3년 생존율은 반경 500m 인허가 이력으로 셌어요.{many && ' 하계역은 따로 잡힌 상권이 없어 가장 가까운 노원 을지대병원 상권으로 셌어요.'}</p>
    </div>
  )
}
