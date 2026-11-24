import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import LineMap from '../LineMap.jsx'
import { useFacts, paras } from './facts.js'
import { words } from './write.jsx'
import { moreParts } from './More.jsx'

// 문장 + 원 지도. 문장이 바뀌면 원 안 지도도 그 문장에 맞는 층으로 바뀐다
const TABS = [['bcol', null, -118], ['shops', '모든 가게', -99], ['flow', '생활인구', -81], ['place', '역·학교', -62]]
const MODES = [['flat', '평면', 98], ['3d', '입체', 90], ['sat', '위성', 82]]
const noop = () => {}
// 넓게 보기 덮개: 가장자리가 구름처럼 일렁이는 흰 막(가운데가 뚫림). 필터가 무거워 처음 한 번만 1/4 크기 그림으로 굽는다
const VEIL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3160 1500" width="790" height="375"><defs><filter id="c" x="-40%" y="-40%" width="180%" height="180%"><feTurbulence type="fractalNoise" baseFrequency=".0032" numOctaves="3" seed="7"/><feDisplacementMap in="SourceGraphic" scale="240" xChannelSelector="R" yChannelSelector="G"/><feGaussianBlur stdDeviation="44"/></filter><mask id="m"><rect width="3160" height="1500" fill="#fff"/><circle cx="1580" cy="750" r="560" fill="#000" filter="url(#c)"/></mask></defs><rect width="3160" height="1500" fill="#F7F7F7" fill-opacity=".92" mask="url(#m)"/></svg>'
let veilUrl = null
function bakeVeil() {
  if (veilUrl) return Promise.resolve(veilUrl)
  return new Promise(ok => {
    const im = new Image()
    im.onload = () => { const c = document.createElement('canvas'); c.width = 790; c.height = 375; c.getContext('2d').drawImage(im, 0, 0, 790, 375); veilUrl = c.toDataURL('image/png'); ok(veilUrl) }
    im.onerror = () => ok(null)
    im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(VEIL)
  })
}
const TOUCH = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches

// 그림이 바뀔 때 점 잇기: 앞 화면(원 지도 또는 앞 그림)의 점 자리에서 다음 그림의 점 자리로 점들이 날아가 앉는다
const DOTS = '.pip .row i:not(.e),.col i:not(.e),.pgrid i,.calc .grid i,.dots .row i.on,.radar .vd,.ins li .bd,.near li .bd,.alt li .bd'
const MAXB = 64
function dotsIn(root, box) {
  if (!root) return []
  return [...root.querySelectorAll(DOTS)].slice(0, MAXB).map(el => {
    if (el instanceof SVGCircleElement) {
      const m = el.ownerSVGElement.getScreenCTM(), p = new DOMPoint(+el.getAttribute('cx'), +el.getAttribute('cy')).matrixTransform(m)
      return { el, x: (p.x - box.left) / box.k, y: (p.y - box.top) / box.k, s: 2 * el.r.baseVal.value * m.a / box.k, c: getComputedStyle(el).fill }
    }
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    // 속 빈 점은 바탕이 투명하니 테두리 색을 쓴다
    const sh = cs.boxShadow !== 'none' ? cs.boxShadow : ''
    const c = /rgba\(\d+, \d+, \d+, 0\)|transparent/.test(cs.backgroundColor) && sh ? (sh.match(/rgba?\([^)]*\)/) || ['#1E2433'])[0] : cs.backgroundColor
    return { el, x: (r.left + r.width / 2 - box.left) / box.k, y: (r.top + r.height / 2 - box.top) / box.k, s: el.offsetWidth, c, sh, bg: cs.backgroundColor }
  })
}
// 원 지도에서 출발할 때: 원 안에 고르게 깔린 점 자리 (지도 위 흰 점처럼)
function lensDots(lens, box, n) {
  const r = lens.getBoundingClientRect(), cx = (r.left + r.width / 2 - box.left) / box.k, cy = (r.top + r.height / 2 - box.top) / box.k, R = r.width / 2 / box.k
  const out = []
  for (let j = 0; j < n; j++) { const a = j * 2.39996, d = R * .88 * Math.sqrt((j + .5) / n); out.push({ x: cx + d * Math.cos(a), y: cy + d * Math.sin(a), s: 7, c: '#1E2433' }) }
  return out
}

export default function Read(ctx) {
  const { report, bld, budget, hidden, veil, onBack } = ctx
  const F = useFacts(ctx)
  // 리포트 문장 뒤로 자세히 문장이 이어진다. 그때는 원 지도 대신 오른쪽에 그 문장의 그림
  const P0 = paras(F), last = P0[P0.length - 1]
  const P = [...P0, ...moreParts(F).filter(m => m.id !== 'bubbles').map(m => ({ id: 'm-' + m.id, layer: last.layer, fk: last.fk, vis: m.id, node: m.txt, pic: m.pic }))]
  const [i, setI] = useState(0)
  const [over, setOver] = useState(null)
  const [mode, setMode] = useState('flat')
  const [wide, setWide] = useState(false)
  const lock = useRef(0)
  const go = j => { const k = Math.max(0, Math.min(P.length - 1, j)); if (k !== i) { setI(k); setOver(null) } }
  useEffect(() => {
    if (hidden) return
    const on = e => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { go(i + 1); e.preventDefault() }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') { go(i - 1); e.preventDefault() }
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  })
  const wheel = e => {
    const now = performance.now()
    if (now - lock.current < 650 || Math.abs(e.deltaY) < 6) return
    lock.current = now
    go(i + Math.sign(e.deltaY))
  }
  // 넓게 보기: 지도 칸이 화면만큼 커진 뒤(켤 때 바로, 끌 때 원이 다 줄어든 뒤) 지도 크기를 다시 잰다
  useEffect(() => { window.__map?.resize(); const t = setTimeout(() => window.__map?.resize(), 760); return () => clearTimeout(t) }, [wide])
  // 넓게 볼 때 지도 칸은 화면을 덮을 만큼만(원 가운데를 그대로 두고 위아래·좌우 같은 폭으로). 화면 밖까지 그리면 무겁다
  const lensRef = useRef(null)
  const [span, setSpan] = useState(null)
  const measure = () => {
    const el = lensRef.current; if (!el) return null
    const r = el.getBoundingClientRect(), s = r.width / el.offsetWidth || 1, R = el.offsetWidth / 2
    const wx = Math.ceil(Math.max(r.left, innerWidth - r.right, 0) / s) + 2, wy = Math.ceil(Math.max(r.top, innerHeight - r.bottom, 0) / s) + 2
    return { '--wx': wx + 'px', '--wy': wy + 'px', '--wm': Math.ceil(Math.hypot(wx + R, wy + R)) + 'px' }
  }
  const [veilImg, setVeilImg] = useState(veilUrl)
  useEffect(() => { bakeVeil().then(setVeilImg) }, [])
  const toggleWide = () => { if (!wide) setSpan(measure()); setWide(w => !w) }
  const ty = useRef(null)
  const touch = { onTouchStart: e => { ty.current = e.touches[0].clientY }, onTouchEnd: e => { if (ty.current == null) return; const dy = ty.current - e.changedTouches[0].clientY; if (Math.abs(dy) > 40) go(i + Math.sign(dy)); ty.current = null } }
  const cur = P[i]
  const layer = over ?? cur.layer
  // 넓게 보기에서 모든 가게·생활인구·역·학교: 지도를 끌고 확대해 둘러본다 (휠은 문장 넘기기 대신 지도 확대)
  // 작게 볼 때는 끌기·확대를 막아 휠이 늘 왼쪽 문장을 넘긴다
  const free = wide && (layer === 'shops' || layer === 'flow' || layer === 'place')
  // 문장이 바뀌어 새 그림이 뜨면 점을 잇는다 (원 지도 → 그림, 그림 → 그림)
  const prev = useRef(i), br = useRef(null), live = useRef([])
  useLayoutEffect(() => {
    const from = P[prev.current], to = P[i]
    prev.current = i
    const host = br.current
    live.current.forEach(f => f()); live.current = []
    if (!host || hidden || !to?.vis || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const hr = host.getBoundingClientRect(), box = { left: hr.left, top: hr.top, k: hr.width / host.offsetWidth || 1 }
    const root = host.parentNode
    const tgt = dotsIn(root.querySelector('.pv-' + to.vis), box)
    if (!tgt.length) return
    const lens = !from?.vis
    let src = lens ? [] : dotsIn(root.querySelector('.pv-' + from.vis), box)
    // 원 지도에서 올 때는 원 안 곳곳에서 점이 많이 일어나 그림 자리로 모인다
    if (!src.length) src = lensDots(root.querySelector('.lens'), box, Math.max(56, tgt.length))
    // 왼쪽 점은 왼쪽으로, 오른쪽 점은 오른쪽으로 가도록 가로 순서끼리 짝짓는다
    const so = [...src].sort((a, b) => a.x - b.x || a.y - b.y), to2 = [...tgt].sort((a, b) => a.x - b.x || a.y - b.y)
    // 출발 점이 더 많으면 남는 점도 함께 날아가 도착 점에 겹치며 사라진다
    const n = Math.max(so.length, to2.length)
    for (let j = 0; j < n; j++) {
      const t = to2[Math.min(to2.length - 1, Math.floor((j * to2.length) / n))]
      const s = so[Math.min(so.length - 1, Math.floor((j * so.length) / n))]
      const keep = !t.el.classList.contains('bt')
      t.el.classList.add('bt')
      const d = document.createElement('i')
      d.style.cssText = 'left:' + (t.x - t.s / 2) + 'px;top:' + (t.y - t.s / 2) + 'px;width:' + t.s + 'px;height:' + t.s + 'px;background:' + t.c + (t.sh ? ';box-shadow:' + t.sh : '')
      host.appendChild(d)
      const k = s.s / t.s || 1
      const a = d.animate([{ transform: 'translate(' + (s.x - t.x) + 'px,' + (s.y - t.y) + 'px) scale(' + k + ')', background: s.c, opacity: lens ? 0 : 1 },
        { opacity: 1, offset: .2 }, { transform: 'none', background: t.bg || t.c, opacity: keep ? 1 : 0 }],
        { duration: lens ? 1000 : 900, delay: 60 + (lens ? (j * 7) % 240 : j * 9), easing: 'cubic-bezier(.65,0,.25,1)', fill: 'both' })
      const end = () => { if (keep) t.el.classList.remove('bt'); d.remove() }
      a.onfinish = end
      live.current.push(() => { a.cancel(); end() })
    }
  }, [i, hidden])
  const ctl = { layer, d3: mode !== 'flat', sat: mode === 'sat', fk: cur.fk || 'both', home: i, look: wide, off: hidden || veil }
  return (
    <div className={'read' + (wide ? ' wide' : '') + (hidden ? ' off' : '') + (cur.vis ? ' pics' : '')} onWheel={wheel}>
      <div className="paras" aria-live="polite" {...touch}>
        {P.map((p, j) => {
          const d = j - i, o = {}
          const body = words(p.node ?? p.segs.map(([t, k], s) => (k ? <b key={s} className={k}>{t}</b> : <span key={s}>{t}</span>)), o)
          return (
            <div key={p.id} className={'para' + (d === 0 && !hidden ? ' on' : '')} style={{ '--d': d, '--n': Math.max(1, o.n - 1) }} data-d={Math.max(-2, Math.min(2, d))} onClick={() => d && go(j)} aria-hidden={d !== 0}>
              {body}
            </div>
          )
        })}
      </div>
      <div ref={lensRef} style={span || undefined} className={'lens' + (free ? ' free' : '')} onWheel={e => free && e.stopPropagation()}>
        <div className="disc">
          <LineMap report={report} bld={bld} radius={300} center={300} shown budget={budget} bare ctl={ctl} pts={F.pts}
            active={null} focus={null} onActive={noop} onPick={noop} onMove={noop} />
        </div>
        {/* 넓게 보기 덮개: 가장자리가 구름처럼 일렁이는 흰 막. 바깥에서부터 안으로 스르륵 덮인다 */}
        <i className="veil">{veilImg && <img src={veilImg} alt="" />}</i>
        <p className="look">{free ? '끌어서 둘러보기 · 휠로 확대' : TOUCH ? '끌어서 옮기기 · 두 손가락으로 돌리기' : '끌어서 옮기기 · 오른쪽 버튼으로 끌면 ' + (mode === 'flat' ? '돌려요' : '돌리고 기울여요')}</p>
        <div className="ring" role="group" aria-label="지도에 보이는 것">
          {TABS.map(([k, t, a]) => (
            <button key={k} className={'tab' + (layer === k ? ' on' : '')} style={{ '--a': a + 'deg' }} onClick={() => setOver(k === cur.layer ? null : k)}>
              <span>{t || F.W + '·공실'}</span>
            </button>
          ))}
          {MODES.map(([k, t, a]) => (
            <button key={k} className={'tab low' + (mode === k ? ' on' : '')} style={{ '--a': a + 'deg' }} onClick={() => setMode(k)} aria-pressed={mode === k}>
              <span>{t}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="rvis" aria-hidden={!cur.vis}>
        {P.filter(p => p.pic).map(p => <div key={p.id} className={'pv pv-' + p.vis + (cur.id === p.id ? ' seen' : '')}><div className="in">{p.pic}</div></div>)}
      </div>
      <div className="bridge" ref={br} aria-hidden="true" />
      <div className="ctrls">
        <button onClick={onBack}>← 원으로 돌아가기</button>
        {!cur.vis && <button onClick={toggleWide}>{wide ? '작게 보기 ↙' : '넓게 보기 ↗'}</button>}
        {cur.vis && <button onClick={() => go(P0.length - 1)}>↑ 지도로</button>}
      </div>
    </div>
  )
}
