import { useEffect, useRef, useState } from 'react'
import { FILES } from '../desk.js'
import { sfx } from '../sound.js'

// 아이콘이 오른쪽으로 옮겨 가면서 예전 자리 기록은 버린다
const POS_KEY = 'gp-desk-pos-r'
const CW = 92 // 격자 한 칸
const CH = 108
const PAD = 14

function readPos() {
  try {
    return JSON.parse(localStorage.getItem(POS_KEY)) || {}
  } catch {
    return {}
  }
}

const cellOf = (p) => [Math.max(0, Math.round((p.x - PAD) / CW)), Math.max(0, Math.round((p.y - PAD) / CH))]
const atCell = ([c, r]) => ({ x: PAD + c * CW, y: PAD + r * CH })

// 처음 놓는 자리: macOS Finder 처럼 오른쪽 위에서 아래로, 넘치면 왼쪽 줄
function defaults(height) {
  const rows = Math.max(1, Math.floor((height - 100) / CH))
  const cols = Math.max(1, Math.floor((window.innerWidth - PAD * 2) / CW))
  return Object.fromEntries(FILES.map((f, i) => [f.id, atCell([cols - 1 - Math.floor(i / rows), i % rows])]))
}

// macOS 내장 디스크처럼 세로로 선 알루미늄 판. 가운데 사과 대신 매달린 간판을 찍는다
function Disk() {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <defs>
        <linearGradient id="disk-body" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#a9a9ad" />
          <stop offset=".12" stopColor="#d6d6d9" />
          <stop offset=".5" stopColor="#dededf" />
          <stop offset=".88" stopColor="#d2d2d5" />
          <stop offset="1" stopColor="#9d9da1" />
        </linearGradient>
        <linearGradient id="disk-base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8a8a8e" />
          <stop offset=".45" stopColor="#77777b" />
          <stop offset="1" stopColor="#5e5e62" />
        </linearGradient>
      </defs>
      <path d="M10 9a4.5 4.5 0 0 1 4.5-4.5h35A4.5 4.5 0 0 1 54 9v44H10z" fill="url(#disk-body)" />
      <path d="M14.5 5h35" stroke="#fff" strokeOpacity=".7" strokeWidth=".8" strokeLinecap="round" />
      <path d="M10 53h44v1.6a4.7 4.7 0 0 1-4.7 4.7H14.7A4.7 4.7 0 0 1 10 54.6z" fill="url(#disk-base)" />
      <path d="M10.4 53.2h43.2" stroke="#fff" strokeOpacity=".35" strokeWidth=".6" />
      <g fill="#8e8e93" transform="translate(0 4)">
        <path d="M27.4 20.5l4.6-4 4.6 4" fill="none" stroke="#8e8e93" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="21" y="21" width="22" height="13" rx="2.5" />
      </g>
      <g fill="#dcdcde" transform="translate(0 4)">
        <rect x="25" y="25.6" width="14" height="1.6" rx=".8" />
        <rect x="27.5" y="28.6" width="9" height="1.6" rx=".8" />
      </g>
    </svg>
  )
}

function Folder({ glyph }) {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <defs>
        <linearGradient id="fold-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fd0ff" />
          <stop offset="1" stopColor="#52adf7" />
        </linearGradient>
      </defs>
      <path d="M5 15a4 4 0 0 1 4-4h14.5a3 3 0 0 1 2.2 1l3.3 3.6h26a4 4 0 0 1 4 4V50a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="#3b97ea" />
      <rect x="5" y="20" width="54" height="34" rx="4" fill="url(#fold-front)" />
      <path d="M5 21.5h54" stroke="#ffffff" strokeOpacity=".45" />
      <g fill="none" stroke="#2f86d6" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" opacity=".8">
        {glyph === 'mine' && (
          <>
            <path d="M22 33h20l-1.5-5h-17z" />
            <path d="M24 33v11h16V33M29.5 44v-6h5v6" />
          </>
        )}
      </g>
    </svg>
  )
}

function Page({ children, badge }) {
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <path d="M15 4h24l13 13v40a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z" fill="#fff" stroke="#000" strokeOpacity=".16" />
      <path d="M39 4v10a3 3 0 0 0 3 3h10" fill="#e9e9ee" stroke="#000" strokeOpacity=".16" />
      {children}
      {badge && (
        <text x="32" y="55" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#8e8e93" fontFamily="-apple-system, sans-serif" letterSpacing=".04em">
          {badge}
        </text>
      )}
    </svg>
  )
}

function FileIcon({ file }) {
  if (file.type === 'disk') return <Disk />
  if (file.type === 'folder') return <Folder glyph={file.id} />
  return (
    <Page badge="TXT">
      <g stroke="#c7c7cc" strokeWidth="1.6" strokeLinecap="round">
        {[16, 21, 26, 31, 36, 41].map((y, i) => (
          <path key={y} d={`M19 ${y}h${i % 3 === 2 ? 16 : 26}`} />
        ))}
      </g>
    </Page>
  )
}

// 바탕화면: 파일 아이콘 끌어 옮기기, 빈 곳 끌어서 여러 개 고르기, 두 번 눌러 열기
export default function Desktop({ height, idle, onOpen, onBlank }) {
  const [pos, setPos] = useState(() => {
    const saved = readPos()
    const base = defaults(height)
    // 저장된 자리가 없는 새 아이템은 남은 빈 칸에 놓는다
    const taken = new Set(FILES.filter((f) => saved[f.id]).map((f) => cellOf(saved[f.id]).join()))
    const free = Object.values(base).filter((p) => !taken.has(cellOf(p).join()))
    const fresh = Object.fromEntries(FILES.filter((f) => !saved[f.id]).map((f) => [f.id, free.shift() || base[f.id]]))
    return { ...base, ...saved, ...fresh }
  })
  const [sel, setSel] = useState(() => new Set())
  const [band, setBand] = useState(null)
  const layer = useRef(null)
  const drag = useRef(null)

  const save = (next) => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(next))
    } catch {
      // 저장이 막혀도 이번 방문 동안은 그 자리에 있다
    }
  }

  const openFile = (f) => {
    sfx.click()
    if (f.type === 'disk' || f.type === 'folder') onOpen('finder', { at: f.id, winTitle: f.name })
    else onOpen('file', { file: f.id, winTitle: f.name })
  }

  // 빈 곳을 누르면 고르기 상자를 그린다
  const startBand = (e) => {
    if (e.target !== e.currentTarget || e.button !== 0) return
    onBlank()
    const box = layer.current.getBoundingClientRect()
    const x = e.clientX - box.left
    const y = e.clientY - box.top
    const keep = e.shiftKey || e.metaKey ? new Set(sel) : new Set()
    setSel(keep)
    drag.current = { kind: 'band', x, y, box, keep }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const startIcon = (e, f) => {
    if (e.button !== 0) return
    e.stopPropagation()
    onBlank()
    let next = sel
    if (e.shiftKey || e.metaKey) {
      next = new Set(sel)
      next.has(f.id) ? next.delete(f.id) : next.add(f.id)
    } else if (!sel.has(f.id)) next = new Set([f.id])
    setSel(next)
    if (!next.has(f.id)) return
    const from = Object.fromEntries([...next].map((id) => [id, pos[id]]))
    drag.current = { kind: 'move', sx: e.clientX, sy: e.clientY, from, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onMove = (e) => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'band') {
      const x = e.clientX - d.box.left
      const y = e.clientY - d.box.top
      const r = { l: Math.min(d.x, x), t: Math.min(d.y, y), r: Math.max(d.x, x), b: Math.max(d.y, y) }
      setBand(r)
      const hit = new Set(d.keep)
      for (const f of FILES) {
        const p = pos[f.id]
        if (p.x + 10 < r.r && p.x + CW - 10 > r.l && p.y + 4 < r.b && p.y + CH - 8 > r.t) hit.add(f.id)
      }
      setSel(hit)
    } else {
      const dx = e.clientX - d.sx
      const dy = e.clientY - d.sy
      if (!d.moved && Math.hypot(dx, dy) < 4) return
      d.moved = true
      setPos((p) => ({ ...p, ...Object.fromEntries(Object.entries(d.from).map(([id, o]) => [id, { x: o.x + dx, y: o.y + dy }])) }))
    }
  }

  // 놓으면 가까운 빈 칸에 맞춘다
  const onUp = () => {
    const d = drag.current
    drag.current = null
    setBand(null)
    if (d?.kind !== 'move' || !d.moved) return
    setPos((p) => {
      const next = { ...p }
      const taken = new Set(FILES.filter((f) => !d.from[f.id]).map((f) => cellOf(p[f.id]).join()))
      for (const id of Object.keys(d.from)) {
        const [c0, r0] = cellOf(p[id])
        let best = null
        for (let ring = 0; !best && ring < 20; ring++) {
          for (let dc = -ring; dc <= ring && !best; dc++) {
            for (let dr = -ring; dr <= ring && !best; dr++) {
              if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue
              const cell = [c0 + dc, r0 + dr]
              if (cell[0] >= 0 && cell[1] >= 0 && !taken.has(cell.join())) best = cell
            }
          }
        }
        taken.add(best.join())
        next[id] = atCell(best)
      }
      save(next)
      return next
    })
    sfx.click()
  }

  // 창이 앞에 없을 때: ⌘A 모두 고르기, Enter·⌘O 열기, Esc 풀기
  useEffect(() => {
    const on = (e) => {
      if (!idle || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSel(new Set(FILES.map((f) => f.id)))
      } else if (sel.size && (e.key === 'Enter' || (mod && e.key.toLowerCase() === 'o'))) {
        e.preventDefault()
        FILES.filter((f) => sel.has(f.id)).forEach(openFile)
      } else if (e.key === 'Escape') setSel(new Set())
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  return (
    <div ref={layer} className="desk" onPointerDown={startBand} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {FILES.map((f) => (
        <button
          key={f.id}
          className={`desk-item ${sel.has(f.id) ? 'on' : ''}`}
          style={{ transform: `translate(${pos[f.id].x}px, ${pos[f.id].y}px)` }}
          onPointerDown={(e) => startIcon(e, f)}
          onDoubleClick={() => openFile(f)}
          title={f.name}
        >
          <span className="desk-icon">
            <FileIcon file={f} />
          </span>
          <span className="desk-name">{f.name}</span>
        </button>
      ))}
      {band && <div className="desk-band" style={{ left: band.l, top: band.t, width: band.r - band.l, height: band.b - band.t }} />}
    </div>
  )
}
