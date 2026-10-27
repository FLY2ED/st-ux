import { useState } from 'react'
import { Rnd } from 'react-rnd'
import { motion } from 'framer-motion'

// 창 틀은 playground-macos(MIT, Renovamen)의 AppWindow 구조를 따른다: react-rnd 로 끌고, 막대를 두 번 누르면 확대
function TrafficLights({ onClose, onMin, onMax, max }) {
  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn()
  }
  return (
    <div className="lights" onMouseDown={(e) => e.stopPropagation()}>
      <button className="light close" aria-label="닫기" onClick={stop(onClose)}>
        <svg viewBox="0 0 12 12"><path d="M3.6 3.6l4.8 4.8M8.4 3.6L3.6 8.4" /></svg>
      </button>
      <button className="light min" aria-label="최소화" onClick={stop(onMin)} disabled={max}>
        <svg viewBox="0 0 12 12"><path d="M3 6h6" /></svg>
      </button>
      <button className="light max" aria-label={max ? '원래 크기로' : '확대'} onClick={stop(onMax)}>
        <svg viewBox="0 0 12 12" className="fill">
          {max ? <path d="M6.6 2.2v3.2h3.2zM5.4 9.8V6.6H2.2z" /> : <path d="M3.2 8.8V4.4l4.4 4.4zM8.8 3.2v4.4L4.4 3.2z" />}
        </svg>
      </button>
    </div>
  )
}

// 메뉴바 높이. 몰입 창(3D 거리 전체 화면)은 이만큼 위로 올라가 메뉴바까지 덮는다
const MENU_H = 24
// 꽉 채운 창은 macOS 처럼 Dock 위에서 끝나고, Dock 둘레로는 배경화면이 보인다
const DOCK_SPACE = 74

export default function Window({ win, active, area, mobile, dockTarget, immersive, fill, unified, ink, onFocus, onClose, onMin, onMax, children }) {
  const width = Math.min(win.width, area.w - 16)
  const [pos, setPos] = useState({ x: win.x, y: win.y })
  const max = win.max || mobile

  const x = max ? 0 : Math.max(8 - width + 120, Math.min(pos.x, area.w - 120))
  const y = immersive ? -MENU_H : max ? 0 : Math.max(0, Math.min(pos.y, area.h - 60))
  const height = immersive ? area.h + MENU_H : max ? area.h - DOCK_SPACE : win.height ? Math.min(win.height, area.h - 16) : 'auto'

  // 최소화할 때 Dock 아이콘 쪽으로 빨려 들어간다
  const origin = dockTarget ? `${dockTarget.x - x}px ${dockTarget.y - y}px` : '50% 100%'

  return (
    <Rnd
      bounds="parent"
      size={{ width: max ? area.w : width, height }}
      position={{ x, y }}
      onDragStop={(e, d) => setPos({ x: d.x, y: d.y })}
      dragHandleClassName="drag"
      cancel="button, input, .no-drag"
      disableDragging={max}
      enableResizing={false}
      style={{ zIndex: immersive ? 6500 : win.z, pointerEvents: win.min ? 'none' : 'auto' }}
      onMouseDown={onFocus}
      onTouchStart={onFocus}
    >
      <motion.section
        className={`mac-win ${active ? 'on' : ''} ${max ? 'max' : ''} ${immersive ? 'immersive' : ''} ${ink ? 'ink' : ''} ${ink === 'paper' ? 'paper' : ''} ${unified ? 'unified' : ''}`}
        style={{ transformOrigin: origin, height }}
        initial={{ opacity: 0, scale: 0.94 }}
        // 닫을 때는 macOS 처럼 그 자리에서 살짝 작아지며 빠르게 사라진다
        exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
        animate={win.min ? { opacity: 0, scale: 0.08, y: 0 } : { opacity: 1, scale: 1 }}
        transition={win.min ? { duration: 0.42, ease: [0.5, 0, 0.75, 0] } : { type: 'spring', stiffness: 420, damping: 34 }}
        aria-label={win.title}
      >
        {!immersive && (
          // unified: Finder 처럼 막대 없이 신호등만 사이드바 위에 띄우고, 끄는 자리는 앱 안 툴바(.drag)가 맡는다
          <header className="titlebar drag" onDoubleClick={onMax}>
            <TrafficLights onClose={onClose} onMin={onMin} onMax={onMax} max={max} />
            {!unified && <h2>{win.title}</h2>}
          </header>
        )}
        <div className={`app-body ${fill ? 'fill' : ''}`}>{children}</div>
      </motion.section>
    </Rnd>
  )
}
