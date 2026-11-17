import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import PixelMap from './PixelMap.jsx'
import LineMap from './LineMap.jsx'
import Report from './Report.jsx'
import { DEMO, PICK } from './demo.js'
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
    ['SAMPLE', '서울 열린데이터광장 상권분석 · 연결 예정', '추정매출·유동인구·사는·일하는 사람·주변 시설·아파트 세대·상권 변화 (분기 갱신). 지금은 예시 숫자예요.'],
    ['SAMPLE', '가게별 매출·임대료·권리금', '카드사·부동산 등 민간 데이터라 기획 시연용 예시로만 보여 줘요.'],
  ] },
  about: { k: 'ABOUT', t: 'ZARI', stats: [['553,374', '서울 가게'], ['4,797', '비교 상권'], ['799', '가게를 맞춘 건물']], body: [
    ['WHY', '서울에서 카페·식당 자리 고르기', '창업하려는 사람이 후보 자리 몇 곳을 같은 기준으로 비교하도록 돕는 서비스예요.'],
    ['HOW', '여러 서비스 기능을 한 화면에', '소상공인365, 서울시 상권분석, 오픈업 같은 서비스의 기능을 모으고, 지도와 리포트가 끊기지 않게 이어 붙였어요.'],
    ['NOW', '기획 시연', '예시 자리 1곳(공릉로 232 · 카페). “예시” 표시가 붙은 칸은 시연용 숫자예요.'],
  ] },
}

// 받침이 있으면 '을', 없으면 '를'
const eul = w => ((w.charCodeAt(w.length - 1) - 0xac00) % 28 ? '을' : '를')

export default function App() {
  const clock = useMemo(makeClock, [])
  const [grid, setGrid] = useState(null)
  const [report, setReport] = useState(null)
  const [phase, setPhase] = useState(params.get('view') === 'report' ? 'report' : 'home')
  const [mapOn, setMapOn] = useState(phase === 'report')
  const [nav, setNav] = useState(params.get('nav'))
  const [mob, setMob] = useState(isMob())
  const [where, setWhere] = useState('공릉로 232')
  const [what, setWhat] = useState('카페')
  const [open, setOpen] = useState(null)
  const radius = 300 // 걸어서 5분 안으로 고정
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
  const go = () => {
    if (!report) return
    setOpen(null)
    setActive(null)
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
      if (open) setOpen(null)
      else if (nav) setNav(null)
      else if (phase === 'report') home()
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [nav, phase, open])
  // 고르는 창 밖을 누르면 닫는다
  useEffect(() => {
    if (!open) return
    const down = e => { if (!qRef.current?.contains(e.target)) setOpen(null) }
    addEventListener('pointerdown', down)
    return () => removeEventListener('pointerdown', down)
  }, [open])

  const camera = useMemo(() => ({
    z: phase === 'report' ? 1 : 0,
    lon: 127.07655, lat: 37.62994,
    cx: () => (isMob() ? innerWidth / 2 : COL + (innerWidth - COL) / 2),
    cy: () => (isMob() ? (100 + innerHeight * .44) / 2 : innerHeight / 2),
  }), [phase])

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
            <p className="sent" aria-label={`나는 ${where}에 ${what}${eul(what)} 차릴 거예요`}>
              <span className="w0">나는 </span>
              <button type="button" className={'chip' + (open === 'where' ? ' on' : '')} onClick={() => setOpen(open === 'where' ? null : 'where')} aria-haspopup="listbox" aria-expanded={open === 'where'}>{where}</button>에{' '}
              <button type="button" className={'chip' + (open === 'what' ? ' on' : '')} onClick={() => setOpen(open === 'what' ? null : 'what')} aria-haspopup="listbox" aria-expanded={open === 'what'}>{what}</button>{eul(what)}{' '}
              <span className="w1">차릴 거예요</span>
            </p>
            <button className="go" aria-label="리포트 보기"><ArrowIcon /></button>
          </motion.form>
          {open && (
            <div className={'suggest pick glass ' + open} role="listbox" aria-label={open === 'where' ? '어디에' : '무슨 가게'}>
              <span className="k m">{open === 'where' ? 'WHERE · 어디에' : 'WHAT · 무슨 가게'}</span>
              {PICK[open].map(([t, s, ok]) => (
                <button key={t} role="option" aria-selected={(open === 'where' ? where : what) === t} disabled={!ok}
                  className={(open === 'where' ? where : what) === t ? 'on' : ''}
                  onClick={() => { (open === 'where' ? setWhere : setWhat)(t); setOpen(open === 'where' ? 'what' : null) }}>
                  <span>{t}<small>{s}</small></span>{!ok && <em className="m">준비 중</em>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {report && (
        <aside className="col" aria-hidden={phase !== 'report'}>
          <a className="brand m" onClick={logo} title="처음으로">ZARI</a>
          {phase === 'report' && (
            <Report report={report} radius={radius} active={active} setActive={setActive}
              pick={i => { setFocus(i); setActive(i) }} saved={saved} onSave={() => setSaved(!saved)} />
          )}
        </aside>
      )}

      {saved && phase === 'report' && (
        <div className="tray glass m"><span>COMPARE 3/3</span><b>공릉로 232 · 공릉역 · 하계역</b><em>담아 둔 후보 자리 3곳 · 카페</em>
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
// 걸어서 5분(300m) 원 안 건물을 업종별로 칠한 작은 지도 + 업종별 가게 수
const LU = [['cafe', '카페', '#1b2340'], ['food', '음식점', '#e2683c'], ['retail', '소매', '#e8b737'], ['service', '서비스·학원·사무', '#6c8fd8'], ['none', '가게 없는 건물', '#d5d9e0']]
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

function Compare({ close }) {
  const P = DEMO.compare
  return (
    <div className="navin">
      <button className="x m" onClick={close} aria-label="닫기">CLOSE ✕</button>
      <span className="k m">COMPARE · CAFE · 걸어서 5분<span className="eg">예시</span></span>
      <h2>후보 자리 3곳 비교</h2>
      <Circles />
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
