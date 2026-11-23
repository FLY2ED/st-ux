import { useEffect, useRef, useState } from 'react'
import LineMap from '../LineMap.jsx'
import { useFacts, paras } from './facts.js'
import { words } from './write.jsx'
import { moreParts } from './More.jsx'

// 문장 + 원 지도. 문장이 바뀌면 원 안 지도도 그 문장에 맞는 층으로 바뀐다
const TABS = [['bcol', null, -118], ['shops', '모든 가게', -99], ['flow', '생활인구', -81], ['place', '역·학교', -62]]
const MODES = [['flat', '평면', 98], ['3d', '입체', 90], ['sat', '위성', 82]]
const noop = () => {}

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
  const ty = useRef(null)
  const touch = { onTouchStart: e => { ty.current = e.touches[0].clientY }, onTouchEnd: e => { if (ty.current == null) return; const dy = ty.current - e.changedTouches[0].clientY; if (Math.abs(dy) > 40) go(i + Math.sign(dy)); ty.current = null } }
  const cur = P[i]
  const layer = over ?? cur.layer
  // 넓게 보기에서 모든 가게·생활인구·역·학교: 지도를 끌고 확대해 둘러본다 (휠은 문장 넘기기 대신 지도 확대)
  // 작게 볼 때는 끌기·확대를 막아 휠이 늘 왼쪽 문장을 넘긴다
  const free = wide && (layer === 'shops' || layer === 'flow' || layer === 'place')
  const ctl = { layer, d3: mode !== 'flat', sat: mode === 'sat', fk: cur.fk || 'both', look: wide, off: hidden || veil }
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
      <div className={'lens' + (free ? ' free' : '')} onWheel={e => free && e.stopPropagation()}>
        <div className="disc">
          <LineMap report={report} bld={bld} radius={300} center={300} shown budget={budget} bare ctl={ctl} pts={F.pts}
            active={null} focus={null} onActive={noop} onPick={noop} onMove={noop} />
        </div>
        {/* 넓게 보기 덮개: 가장자리가 구름처럼 일렁이는 흰 막. 바깥에서부터 안으로 스르륵 덮인다 */}
        <i className="veil">
          <svg viewBox="0 0 3160 1500" aria-hidden="true">
            <defs>
              <filter id="cloud" x="-40%" y="-40%" width="180%" height="180%">
                <feTurbulence type="fractalNoise" baseFrequency=".0032" numOctaves="3" seed="7" />
                <feDisplacementMap in="SourceGraphic" scale="240" xChannelSelector="R" yChannelSelector="G" />
                <feGaussianBlur stdDeviation="44" />
              </filter>
              <mask id="vmask"><rect width="3160" height="1500" fill="#fff" /><circle cx="1580" cy="750" r="560" fill="#000" filter="url(#cloud)" /></mask>
            </defs>
            <rect width="3160" height="1500" fill="#F7F7F7" fillOpacity=".92" mask="url(#vmask)" />
          </svg>
        </i>
        <p className="look">끌어서 둘러보기 · 휠로 확대</p>
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
      <div className="ctrls">
        <button onClick={onBack}>← 원으로 돌아가기</button>
        {!cur.vis && <button onClick={() => setWide(w => !w)}>{wide ? '작게 보기 ↙' : '넓게 보기 ↗'}</button>}
        {cur.vis && <button onClick={() => go(P0.length - 1)}>↑ 지도로</button>}
      </div>
    </div>
  )
}
