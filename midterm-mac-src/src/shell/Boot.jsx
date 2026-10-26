import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

// 진짜 맥처럼 검은 화면에 흰 사과와 진행 막대. 누르면 바로 넘어간다
const Apple = () => (
  <svg className="boot-logo" viewBox="0 0 24 24" width="76" height="76" aria-hidden="true">
    <path
      fill="currentColor"
      d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
    />
  </svg>
)

export default function Boot({ onDone }) {
  const [p, setP] = useState(0)
  useEffect(() => {
    let raf
    const t0 = performance.now()
    // 처음엔 빠르게, 끝에서 조금 머뭇거린다
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 2600)
      setP(1 - (1 - k) ** 2)
      if (k < 1) raf = requestAnimationFrame(step)
      else setTimeout(onDone, 300)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [onDone])
  return (
    <motion.div className="boot" onClick={onDone} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
      <Apple />
      <div className="boot-bar" role="progressbar" aria-valuenow={Math.round(p * 100)} aria-label="켜는 중">
        <i style={{ width: `${p * 100}%` }} />
      </div>
    </motion.div>
  )
}
