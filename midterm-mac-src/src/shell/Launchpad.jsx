import { useState } from 'react'
import { motion } from 'framer-motion'

// 전체 앱 보기. 바탕을 흐리게 깔고 아이콘을 격자로 늘어놓는다
export default function Launchpad({ apps, onOpen, onClose }) {
  const [q, setQ] = useState('')
  const shown = apps.filter((a) => `${a.title} ${a.keys}`.includes(q.trim()))
  return (
    <motion.div
      className="launchpad"
      onClick={onClose}
      initial={{ opacity: 0, scale: 1.06 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.06 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.3, 1] }}
    >
      <input
        className="lp-search"
        value={q}
        autoFocus
        placeholder="검색"
        aria-label="앱 검색"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      />
      <ul className="lp-grid">
        {shown.map((a, i) => (
          <motion.li key={a.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i }}>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onOpen(a.id)
              }}
            >
              <img src={a.img} alt="" />
              <span>{a.title}</span>
            </button>
          </motion.li>
        ))}
      </ul>
    </motion.div>
  )
}

// Dock 의 Launchpad 단추: 앱 아이콘 아홉 칸을 작게 모은 타일
export function LaunchpadIcon({ apps }) {
  return (
    <span className="lp-icon">
      {apps.slice(0, 9).map((a) => (
        <img key={a.id} src={a.img} alt="" />
      ))}
    </span>
  )
}
