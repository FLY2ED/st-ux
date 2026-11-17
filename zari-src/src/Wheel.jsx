import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// 제목 속 [ 값 ]을 누르면 그 자리에서 열리는 돌림판. 뒤는 흐려지고, 굴리거나 눌러서 고른다.
// items: [[이름, 설명, 리포트 있음]]
export default function Wheel({ anchor, items, value, onPick, onClose, label, show = t => t }) {
  const box = useRef(null)
  const atRef = useRef(Math.max(0, items.findIndex(i => i[0] === value)))
  const [at, setAt] = useState(atRef.current)
  const [shut, setShut] = useState(false)
  const r = anchor.getBoundingClientRect()
  const cs = getComputedStyle(anchor)
  const fs = parseFloat(cs.fontSize)
  const H = Math.round(fs * 1.25)
  const ROWS = 5

  const paint = () => {
    const el = box.current
    if (!el) return
    const c = el.scrollTop / H
    el.querySelectorAll('li').forEach((li, k) => {
      const d = k - c
      li.style.transform = `rotateX(${Math.max(-80, Math.min(80, -d * 24))}deg)`
      li.style.opacity = Math.max(0, 1 - Math.abs(d) * 0.34)
    })
    const n = Math.min(items.length - 1, Math.max(0, Math.round(c)))
    if (n !== atRef.current) {
      atRef.current = n
      setAt(n)
      navigator.vibrate?.(4)
    }
  }
  useLayoutEffect(() => { box.current.scrollTop = atRef.current * H; paint(); box.current.focus() }, [])

  const close = () => {
    if (shut) return
    const it = items[atRef.current]
    if (it[2] && it[0] !== value) onPick?.(it[0])
    setShut(true)
    setTimeout(onClose, 220)
  }
  const go = k => box.current.scrollTo({ top: k * H, behavior: 'smooth' })
  const key = e => {
    e.stopPropagation()
    if (e.key === 'Escape') { atRef.current = Math.max(0, items.findIndex(i => i[0] === value)); close() }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); go(Math.min(items.length - 1, atRef.current + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(Math.max(0, atRef.current - 1)) }
  }
  useEffect(() => { addEventListener('resize', close); return () => removeEventListener('resize', close) })

  const cur = items[at]
  const top = r.top + r.height / 2 - (ROWS * H) / 2
  return createPortal(
    <div className={'wheel' + (shut ? ' shut' : '')} onClick={e => e.target === e.currentTarget && close()}>
      <div className="wheel-b" style={{ top, left: r.left, font: `${cs.fontWeight} ${fs}px/${H}px ${cs.fontFamily}`, letterSpacing: cs.letterSpacing, '--h': H + 'px' }}>
        <span className="wheel-k m">{label}</span>
        <i className="wheel-band" aria-hidden="true" />
        <ul ref={box} tabIndex={0} role="listbox" aria-label={label} aria-activedescendant={'wh-' + at} onScroll={paint} onKeyDown={key}
          style={{ height: ROWS * H, paddingBlock: ((ROWS - 1) / 2) * H }}>
          {items.map(([t, , ok], k) => (
            <li key={t} id={'wh-' + k} role="option" aria-selected={k === at} aria-disabled={!ok} className={(k === at ? 'on' : '') + (ok ? '' : ' off')}
              onClick={() => (k === atRef.current ? close() : go(k))}>
              <span className="wb">[</span>{show(t)}<span className="wb">]</span>
            </li>
          ))}
        </ul>
        <p className="wheel-s">{cur[2] ? cur[1] : `${cur[1]} · 준비 중이에요. 지금 리포트는 ${value}만 있어요`}</p>
      </div>
    </div>,
    document.body,
  )
}
