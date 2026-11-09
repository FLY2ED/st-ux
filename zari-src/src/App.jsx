import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import PixelMap from './PixelMap.jsx'
import LineMap from './LineMap.jsx'
import Report from './Report.jsx'
import { DEMO } from './demo.js'
import { Pin, PIN, PIN_CELLS, SearchIcon, ArrowIcon } from './pin.jsx'
import { clamp, ioc, back, INTRO, makeClock, params } from './motion.js'

const COL = 460 // PC 왼쪽 칸 폭
// 메뉴 버튼이 그대로 늘어나 패널이 된다
const MORPH = { type: 'tween', duration: .6, ease: [.65, 0, .35, 1] }
const isMob = () => innerWidth < 760

// 메뉴 내용: 지금 화면에 있는 기능·데이터 기준
const NAV = {
  how: { k: 'HOW IT WORKS', t: '네 단계로 자리를 골라요', body: [
    ['01', '업종과 자리 입력', '“공릉로 232 카페”처럼 쓰면 서울 픽셀 지도가 그 자리로 확대되고, 선으로 그린 실제 지도로 바뀌어요.'],
    ['02', '지도에서 주변 보기', '반경 300m·500m 안 카페는 큰 네모, 다른 가게는 작은 네모예요. 네모를 누르면 그 가게 업종·층·거리가 떠요. 유동인구를 켜면 시간대·월별로 사람이 몰리는 곳이 영상처럼 바뀌고, 주변 시설을 켜면 역·버스·학교·병원과 걸어서 5·10분 범위가 보여요. 3D를 누르면 건물이 세워져요.'],
    ['03', '리포트 11개 탭 읽기', '요약 · 경쟁 · 매출 · 유동인구 · 배후 · 시설 · 개폐업 · 비용 · 계산 · 추천 · 체크. 좋은 점·조심할 점을 먼저 짚고, 계산 탭에서 창업 비용과 되찾는 기간까지 셈해요. 공유로 링크를 복사해요.'],
    ['04', '후보 담고 비교', '비교함에 3곳까지 담아 매출·임대료·생존율을 나란히 보고, 줄마다 가장 좋은 값을 표시해요.'],
  ] },
  data: { k: 'DATA', t: '쓰는 데이터', body: [
    ['REAL', '소상공인시장진흥공단 상가(상권)정보', '서울 553,374곳 · 2026년 6월 · 가게 수, 업종 구성, 가까운 카페와 층, 프랜차이즈 비율'],
    ['REAL', '서울 200m 상권 4,797곳 비교', '가게 30곳 넘는 칸의 반경 300m와 견줘 경쟁 강도(여유·보통·과밀)를 매겨요.'],
    ['REAL', 'OpenFreeMap · OpenStreetMap', '도로·건물·물길 선 지도, 건물 높이(3D), 지하철역·버스정류장·학교·병원 위치'],
    ['SAMPLE', '서울 열린데이터광장 상권분석 · 연결 예정', '추정매출·유동인구·상주/직장 인구·집객시설·아파트 세대·상권변화지표 (분기 갱신). 지금은 예시 숫자예요.'],
    ['SAMPLE', '가게별 매출·임대료·권리금', '카드사·부동산 등 민간 데이터라 기획 시연용 예시로만 보여 줘요.'],
  ] },
  about: { k: 'ABOUT', t: 'ZARI', stats: [['553,374', '서울 가게'], ['4,797', '비교 상권'], ['16', '리포트 칸']], body: [
    ['WHY', '서울에서 카페·식당 자리 고르기', '창업하려는 사람이 후보 자리 몇 곳을 같은 기준으로 비교하도록 돕는 서비스예요.'],
    ['HOW', '여러 서비스 기능을 한 화면에', '소상공인365, 서울시 상권분석, 오픈업 같은 서비스의 기능을 모으고, 지도와 리포트가 끊기지 않게 이어 붙였어요.'],
    ['NOW', '기획 시연', '예시 자리 1곳(공릉로 232 · 카페). “예시” 표시가 붙은 칸은 시연용 숫자예요.'],
  ] },
}

const SUGGEST = [
  ['WHAT', '카페', '서울 22,726곳'],
  ['WHERE', '서울 노원구 공릉로 232', '서울과기대 정문 · 도로명'],
  ['WHERE', '공릉동', '노원구 · 행정동'],
  ['WHERE', '공릉역 7호선', '노원구 동일로 1074'],
]

export default function App() {
  const clock = useMemo(makeClock, [])
  const [grid, setGrid] = useState(null)
  const [report, setReport] = useState(null)
  const [phase, setPhase] = useState(params.get('view') === 'report' ? 'report' : 'home')
  const [mapOn, setMapOn] = useState(phase === 'report')
  const [nav, setNav] = useState(params.get('nav'))
  const [mob, setMob] = useState(isMob())
  const [q, setQ] = useState('공릉로 232 카페')
  const [open, setOpen] = useState(false)
  const [radius, setRadius] = useState(300)
  const [active, setActive] = useState(null)
  const [focus, setFocus] = useState(null)
  const [saved, setSaved] = useState(false)
  const tipRef = useRef(null), imRef = useRef(null), markRef = useRef(null), qRef = useRef(null), wordRef = useRef(null)

  useEffect(() => {
    fetch('./data/seoul-grid.json').then(r => r.json()).then(setGrid)
    fetch('./data/report-gongneung-cafe.json').then(r => r.json()).then(setReport)
    const rs = () => setMob(isMob())
    addEventListener('resize', rs)
    return () => removeEventListener('resize', rs)
  }, [])

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
        order.forEach((k, n) => (rects[k].style.opacity = t > n * (420 / order.length) ? 1 : 0))
        const drop = (1 - back(clamp(t / INTRO.land))) * -40
        const sq = t > 600 && t < 820 ? Math.sin(((t - 600) / 220) * Math.PI) * .1 : 0
        const hb = HM.getBoundingClientRect(), f = ioc(clamp((t - INTRO.fly) / 800))
        const sx = innerWidth / 2 - mw / 2, sy = innerHeight / 2 - mh / 2 - 30
        const sc = 1 - f + f * (hb.height / mh)
        const x = sx + (hb.left - sx) * f + (mw * (1 - (1 + sq * .6)) / 2) * (1 - f)
        const y = sy + drop + (hb.top - sy) * f + mh * sq * (1 - f)
        IM.style.transform = `translate(${x}px,${y}px) scale(${sc * (1 + sq * .6)},${sc * (1 - sq)})`
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

  const go = () => {
    if (!report) return
    if (!q.trim()) setQ('공릉로 232 카페')
    setOpen(false)
    setActive(null)
    setPhase('report')
    // 픽셀 지도 확대가 2/3쯤 왔을 때 선 지도가 받는다
    setTimeout(() => setMapOn(true), 900)
  }
  const home = () => {
    setNav(null)
    setMapOn(false)
    setPhase('home')
    setActive(null)
  }
  useEffect(() => {
    const key = e => {
      if (e.key !== 'Escape') return
      if (nav) setNav(null)
      else if (phase === 'report') home()
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [nav, phase])

  const camera = useMemo(() => ({
    z: phase === 'report' ? 1 : 0,
    lon: 127.07655, lat: 37.62994,
    cx: () => (isMob() ? innerWidth / 2 : COL + (innerWidth - COL) / 2),
    cy: () => (isMob() ? (100 + innerHeight * .44) / 2 : innerHeight / 2),
  }), [phase])

  const logo = () => {
    if (phase === 'report') home()
    else clock.replay()
  }

  return (
    <div className={`app ${phase} ${mob ? 'mob' : 'desk'}${mapOn ? ' mapon' : ''}`}>
      <PixelMap grid={grid} clock={clock} camera={camera} tipRef={tipRef} interactive={phase === 'home'} />
      {report && (
        <LineMap report={report} radius={radius} active={active} onActive={setActive} onPick={i => { setFocus(i); setActive(i) }}
          shown={mapOn} focus={focus} center={radius} />
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
          <motion.form layout transition={{ duration: .9, ease: [.65, 0, .35, 1] }} className="pill"
            onSubmit={e => { e.preventDefault(); go() }}>
            <span className="ic"><SearchIcon /></span>
            <input value={q} placeholder="공릉로 232 카페" autoComplete="off" aria-label="업종과 자리"
              onChange={e => setQ(e.target.value)} onFocus={() => phase === 'home' && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
            <button className="go" aria-label="리포트 보기"><ArrowIcon /></button>
          </motion.form>
          {open && phase === 'home' && (
            <div className="suggest glass">
              {SUGGEST.map(([k, t, s], n) => (
                <button key={n} className={n === 1 ? 'on' : ''} onMouseDown={() => { setQ(k === 'WHAT' ? '카페' : t.replace('서울 노원구 ', '') + ' 카페'); if (k === 'WHERE') setTimeout(go, 0) }}>
                  <span className="k m">{k}</span><span>{t}<small>{s}</small></span>
                </button>
              ))}
              <button className="act" onMouseDown={() => setTimeout(go, 0)}><span>리포트 보기 · 공릉로 232 × 카페</span><span className="m">↵</span></button>
            </div>
          )}
        </div>
      </div>

      {report && (
        <aside className="col" aria-hidden={phase !== 'report'}>
          {phase === 'report' && (
            <Report report={report} radius={radius} setRadius={setRadius} active={active} setActive={setActive}
              pick={i => { setFocus(i); setActive(i) }} saved={saved} onSave={() => setSaved(!saved)} />
          )}
        </aside>
      )}

      {saved && phase === 'report' && (
        <div className="tray glass sq m"><span>COMPARE 3/3</span><b>공릉로 232 · 공릉역 · 하계역</b><em>담아 둔 후보 자리 3곳 · 카페</em>
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
              {nav === 'compare' ? <Compare close={() => setNav(null)} /> : (
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
                      {phase === 'home' ? '예시 리포트 열기 · 공릉로 232 카페' : '리포트로 돌아가기'}<span className="m">→</span>
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
  ['카페 수', 'cafes', v => v + '곳', 'min'],
  ['경쟁 강도', 'crowd', v => v, null],
  ['카페 월매출', 'sales', v => v.toLocaleString() + '만', 'max'],
  ['유동인구/일', 'flow', v => v.toLocaleString(), 'max'],
  ['임대료 ㎡/월', 'rent', v => v + '만', 'min'],
  ['3년 생존율', 'survive', v => v + '%', 'max'],
  ['상권 등급', 'grade', v => v, null],
]
function Compare({ close }) {
  const P = DEMO.compare
  return (
    <div className="navin">
      <button className="x m" onClick={close} aria-label="닫기">CLOSE ✕</button>
      <span className="k m">COMPARE · CAFE · 300M<span className="eg">예시</span></span>
      <h2>후보 자리 3곳 비교</h2>
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
      <p className="fine" style={{ marginTop: 18 }}>네모 표시는 그 줄에서 가장 좋은 값이에요. 공릉로 232 줄은 이 리포트, 나머지 두 곳은 예시 후보예요.</p>
    </div>
  )
}
