import { useRef } from 'react'
import { useRefraction } from './refract.jsx'
import { motion, useAnimationFrame, useMotionValue, useSpring, useTransform } from 'framer-motion'

// 확대 계산은 playground-macos(MIT, Renovamen)의 DockItem 을 따른다. 그쪽도 macos-web(MIT, PuruVJ)에서 가져온 것이다
function useMagnify(mouseX, ref, size, mag) {
  const limit = size * 6
  const input = [-limit, -limit / (mag * 0.65), -limit / (mag * 0.85), 0, limit / (mag * 0.85), limit / (mag * 0.65), limit]
  const output = [size, size * mag * 0.55, size * mag * 0.75, size * mag, size * mag * 0.75, size * mag * 0.55, size]
  const distance = useMotionValue(limit + 1)
  const width = useSpring(useTransform(distance, input, output), { stiffness: 1700, damping: 90 })

  useAnimationFrame(() => {
    const el = ref.current
    const x = mouseX.get()
    if (!el || x === null) return distance.set(limit + 1)
    const r = el.getBoundingClientRect()
    distance.set(x - (r.left + r.width / 2))
  })
  return width
}

function DockItem({ item, mouseX, size, mag, open, bounce, onClick, setRef }) {
  const img = useRef(null)
  const width = useMagnify(mouseX, img, size, mag)
  return (
    <li className="dock-item">
      <span className="dock-tip">{item.title}</span>
      <motion.button
        className="dock-btn"
        aria-label={item.title}
        onClick={onClick}
        animate={bounce ? { y: [0, -22, 0, -12, 0] } : { y: 0 }}
        transition={bounce ? { duration: 0.9, ease: 'easeOut' } : { duration: 0 }}
      >
        {item.node ? (
          <motion.span ref={img} className="dock-node" style={{ width, height: width }}>
            {item.node}
          </motion.span>
        ) : (
          <motion.img
            ref={(el) => {
              img.current = el
              setRef?.(el)
            }}
            src={item.img}
            alt=""
            draggable={false}
            style={{ width, height: width }}
          />
        )}
      </motion.button>
      <i className={`dock-dot ${open ? 'on' : ''}`} />
    </li>
  )
}

export default function Dock({ groups, size = 50, mag = 1.55, magnify = true, isOpen, bouncing, onOpen, iconRefs }) {
  const mouseX = useMotionValue(null)
  const bar = useRef(null)
  const glass = useRefraction(bar, { radius: 24, band: 16, scale: 40 })
  return (
    <nav className="dock-wrap" aria-label="Dock">
      {glass.filter}
      <ul
        ref={bar}
        className="dock glass lg"
        style={glass.style}
        onMouseMove={(e) => magnify && mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(null)}
      >
        {groups.map((items, gi) => [
          gi > 0 && <li key={`sep-${gi}`} className="dock-sep" aria-hidden="true" />,
          ...items.map((item) => (
            <DockItem
              key={item.id}
              item={item}
              mouseX={mouseX}
              size={size}
              mag={magnify ? mag : 1}
              open={isOpen(item.id)}
              bounce={bouncing === item.id}
              onClick={() => onOpen(item.id)}
              setRef={(el) => (iconRefs.current[item.id] = el)}
            />
          )),
        ])}
      </ul>
    </nav>
  )
}
