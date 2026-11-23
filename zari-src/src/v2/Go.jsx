import { useEffect, useRef, useState } from 'react'
import { DEMO } from '../demo.js'
import { plan, fits } from '../Report.jsx'
import { shortAddr } from '../LineMap.jsx'
import { fmt } from './data.js'

// 리포트로 넘어가는 띠: 어두운 띠 위로 좌표·숫자 줄이 옆으로 흐르고, 바퀴가 옆으로 누운 듯한 파란 점들이 떠오른다
// 점: 메인 바퀴(바깥 12 · 안 12)를 옆으로 눕혀 본 모양. 시안 묶음 안 좌표 기준 타원(가운데 500,400 · 판 기준 +290,+50)
// 각도 a에서 x = 가운데 - 가로반지름·cos a, y = 가운데 + 세로반지름·sin a, 가까운 쪽(cos a > 0)은 띠 앞, 먼 쪽은 띠 뒤
const RINGS = [{ rx: 169.5, ry: 340, s: 36, ds: 11 }, { rx: 85, ry: 170, s: 28, ds: 8 }]
const SPOKES = RINGS.flatMap((r, o) => Array.from({ length: 12 }, (_, j) => ({ ...r, a: j * Math.PI / 6, o })))
function put(el, d, rot, C = HOME) {
  const a = d.a + rot, c = Math.cos(a), s = (d.s + d.ds * c) * (.5 + C.k / 2)
  el.style.left = C.x - d.rx * C.k * c + 'px'
  el.style.top = C.y + d.ry * C.k * Math.sin(a) + 'px'
  el.style.width = el.style.height = s + 'px'
  el.classList.toggle('lo', c < 0)
}
// 처음 자리(띠 위)와, 띠가 걷힌 뒤 파란 점만 남아 도는 화면 가운데 자리
const HOME = { x: 790, y: 450, k: 1 }
function mid() {
  if (innerWidth <= 760) return { x: innerWidth / 2 + 290, y: innerHeight * .56, k: .5 }
  return { x: 720, y: 450, k: .8 }
}
const SOLO = 1400, MOVE = 1500
const inOut = p => (p < .5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)

const EN = { 카페: 'CAFE', 베이커리: 'BAKERY', 꽃집: 'FLOWER SHOP', 분식: 'SNACK BAR', 네일숍: 'NAIL SALON', 음식점: 'RESTAURANT', 미용실: 'HAIR SALON', 편의점: 'CONVENIENCE STORE', 술집: 'PUB' }
// 동 이름 로마자 (자주 쓰는 동은 표, 나머지는 소리 나는 대로 간단히)
const DONG_EN = { 공릉동: 'GONGNEUNG-DONG', 익선동: 'IKSEON-DONG', 망원동: 'MANGWON-DONG', 연남동: 'YEONNAM-DONG', 성수동: 'SEONGSU-DONG', 문래동: 'MULLAE-DONG', 서교동: 'SEOGYO-DONG', 동교동: 'DONGGYO-DONG', 창전동: 'CHANGJEON-DONG' }
const I = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
const V = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
const F = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't']
function roman(s) {
  const out = []
  for (const ch of s) {
    const c = ch.charCodeAt(0) - 0xac00
    if (c < 0 || c > 11171) { out.push(ch); continue }
    const f = c % 28, v = ((c - f) / 28) % 21, i = Math.floor(c / 588)
    out.push([I[i], V[v], F[f]])
  }
  // 받침 ㅇ 뒤 ㄹ은 n, 받침 ㄹ 뒤 ㄹ은 l
  return out.map((p, j) => {
    if (typeof p === 'string') return p
    const prev = out[j - 1]
    let a = p[0]
    if (a === 'r' && Array.isArray(prev)) a = prev[2] === 'l' ? 'l' : prev[2] ? 'n' : 'r'
    if (j === 0 && a === 'r') a = 'r'
    return a + p[1] + p[2]
  }).join('')
}
const dongEn = d => (!d ? '' : DONG_EN[d] || (/동$/.test(d) ? roman(d.slice(0, -1)) + '-dong' : roman(d)).toUpperCase())

// 리포트 원(렌즈)의 판 좌표: 가운데와 반지름. 모바일은 판을 줄이지 않고 점에 여백(-290px, -6vh)이 붙어 있다
function lensAt() {
  if (innerWidth <= 760) { const R = innerWidth * .44; return { cx: innerWidth / 2 + 290, cy: 64 + R + innerHeight * .06, R } }
  return { cx: 980, cy: 450, R: 372 }
}

// 원 안에 동심원 격자 점을 고르게 깔고, 점마다 그 자리 실제 지도(건물·빈 가게·내 자리)를 읽어 진하기를 정한다
// 5분 거리(300m) 줄은 비워 두고 굴러온 파란 점들이 큰 점 한 줄로 앉는다
function inRing(ring, x, y) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
export const RING5 = 11
function gridDots(bld, Q, L) {
  const s = (L.R * .8) / 300, gap = (L.R * .8) / RING5
  const polys = []
  if (bld && Q) {
    const kx = 111320 * Math.cos((Q.lat * Math.PI) / 180), ky = 110540
    for (const f of bld.features) {
      const g = f.geometry, src = g.type === 'MultiPolygon' ? g.coordinates[0]?.[0] : g.type === 'Polygon' ? g.coordinates[0] : null
      if (!src?.length) continue
      const ring = src.map(([lo, la]) => [(lo - Q.lon) * kx * s, -(la - Q.lat) * ky * s])
      const xs = ring.map(p => p[0]), ys = ring.map(p => p[1])
      const p = f.properties
      const k = p.empty && !p.tgt ? 'empty' : 'bld'
      polys.push({ ring, k, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) })
    }
  }
  const rank = { empty: 2, bld: 1 }
  const look = (x, y) => {
    let k = ''
    for (const q of polys) if (x >= q.x0 && x <= q.x1 && y >= q.y0 && y <= q.y1 && (rank[q.k] > (rank[k] || 0)) && inRing(q.ring, x, y)) k = q.k
    return k
  }
  const out = [{ x: L.cx, y: L.cy, k: 'tgt', i: 0 }]
  for (let i = 1; i * gap < L.R - 6; i++) {
    if (i === RING5) continue
    const r = i * gap, n = Math.round((2 * Math.PI * r) / gap), off = i % 2 ? Math.PI / n : 0
    for (let j = 0; j < n; j++) {
      const a = off + (j * 2 * Math.PI) / n, x = r * Math.cos(a), y = r * Math.sin(a)
      out.push({ x: L.cx + x, y: L.cy + y, k: look(x, y), i })
    }
  }
  return out.map(d => ({ ...d, w: Math.hypot(d.x - L.cx, d.y - L.cy) / L.R }))
}

export default function Go({ ready, drawn, report: R, bld, what, place, budget, onDone, out }) {
  const [t0] = useState(() => performance.now())
  // 바퀴가 눕은 채로 돈다: 처음엔 빨리 굴러 들어오고 천천히 이어서 돈다
  const dots = useRef([]), gather = useRef(false), root = useRef(null)
  const [phase, setPhase] = useState('')
  const [solo, setSolo] = useState(false)
  const [inner, setInner] = useState(null)
  useEffect(() => {
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf
    const tick = now => {
      const t = (now - t0) / 1000
      const rot = still ? 0 : Math.PI * 1.2 * (1 - Math.exp(-t * 1.5)) + t * .45
      if (gather.current) return
      // 잠깐 띠 위에서 돈 뒤, 띠가 걷히고 점만 화면 가운데로 천천히 옮겨 가 계속 돈다
      const p = still ? 1 : Math.min(1, Math.max(0, (now - t0 - SOLO) / MOVE)), e = inOut(p), M = mid()
      const C = { x: HOME.x + (M.x - HOME.x) * e, y: HOME.y + (M.y - HOME.y) * e, k: HOME.k + (M.k - HOME.k) * e }
      if (p > 0) setSolo(true)
      SPOKES.forEach((d, i) => dots.current[i] && put(dots.current[i], d, rot, C))
      if (!still) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  useEffect(() => {
    if (!ready || !drawn) return
    // 눕은 바퀴를 세워 리포트 원 둘레에 점을 고르게 놓은 뒤 넘어간다
    let id2
    const id = setTimeout(() => {
      gather.current = true
      // React가 클래스를 붙이기 전에 점 자리를 바꾸면 움직임 없이 건너뛰므로, 움직임 규칙부터 먼저 걸고 한 번 그린다
      root.current?.classList.add('gather')
      void root.current?.offsetWidth
      setPhase('gather')
      const L = lensAt()
      setInner({ L, dots: gridDots(bld, R?.query, L) })
      // 굴러온 점 24개는 5분 거리 줄에 큰 점으로 앉고, 하나만 살짝 바깥으로 비켜 앉는다
      const r5 = L.R * .8, gap = r5 / RING5
      dots.current.forEach((el, i) => {
        if (!el) return
        const a = (i % 12) * Math.PI / 6 + (i >= 12 ? Math.PI / 12 : 0)
        const r = r5 + (i === 16 ? gap * .75 : 0)
        el.style.left = L.cx - r * Math.cos(a) + 'px'
        el.style.top = L.cy + r * Math.sin(a) + 'px'
        el.style.width = el.style.height = '13px'
        el.style.setProperty('--w', (r / L.R).toFixed(3))
        el.classList.remove('lo')
      })
      id2 = setTimeout(onDone, 2100)
    }, Math.max(300, SOLO + MOVE + 300 - (performance.now() - t0)))
    return () => { clearTimeout(id); clearTimeout(id2) }
  }, [ready, drawn])
  const no = (place.address.match(/(\d+(?:-\d+)?)\s*$/) || [])[1]
  const en = EN[what.t] || 'SHOP'
  const L = [
    [en, dongEn(place.dong), '', place.lat.toFixed(4) + ' N', place.lon.toFixed(4) + ' E', no ? 'NO.' + no : ''].filter((v, j) => v || j === 2).join('      ').replace(/^(.+?)      /, '$1  —  '),
    [what.t, place.dong, shortAddr(place.address), '걸어서 5분 300m'].filter(Boolean).join(' · '),
  ]
  if (ready) {
    const vac = bld.features.filter(f => f.properties.empty === 1 && !f.properties.tgt && f.properties.dist <= 300)
    const fit = vac.filter(f => fits(f.properties, budget))
    const shops = R.shops.filter(([x, y]) => Math.hypot(x, y) <= 300), mine = shops.filter(s => s[2] === R.query.cat).length
    const P = plan()
    L[1] += ` · 공실 ${vac.length}곳 · ${what.t} ${mine}곳`
    L.push(`VACANT ${vac.length}      BUDGET ${fit.length}      ${en} ${mine} / ${shops.length}      WALK 5 MIN = 300M`)
    L.push([`FLOW ${fmt(DEMO.flow.day)}`, DEMO.sales.none ? '' : 'SALES ' + fmt(DEMO.sales.month), 'COST ' + (P.total / 10000).toFixed(1), P.payback ? P.payback + ' MONTHS' : ''].filter(Boolean).join('      '))
  } else L.push('LOADING')
  return (
    <div ref={root} className={'go ' + phase + (solo ? ' solo' : '') + (out ? ' out' : '')}>
      <div className="band" aria-live="polite">
        {L.map((l, i) => (
          <p key={i} className={(i === 1 ? 'ko' : 'mono') + (i % 2 ? ' rev' : '')} style={{ top: 22 + i * 55, animationDelay: i * .22 + 's' }}>
            <span>{l}{'      '}{l}{'      '}{l}{'      '}</span>
          </p>
        ))}
      </div>
      {inner && (
        <div className="gmap" aria-hidden="true">
          <i className="gcover" style={{ left: inner.L.cx, top: inner.L.cy, width: inner.L.R * 2 + 16, height: inner.L.R * 2 + 16 }} />
          {inner.dots.map((d, j) => <i key={j} className={'gd ' + (d.k || 'off')} style={{ left: d.x, top: d.y, '--d': (.7 + d.i * .05).toFixed(3) + 's', '--w': d.w.toFixed(3) }} />)}
        </div>
      )}
      {SPOKES.map((d, i) => <i key={i} ref={el => { dots.current[i] = el; if (el && !el.style.left) put(el, d, 0) }} className="fd" style={{ animationDelay: (.15 + (i % 12) * .05 + (Math.cos(d.a) >= 0 ? .25 : 0)) + 's' }} />)}
    </div>
  )
}
