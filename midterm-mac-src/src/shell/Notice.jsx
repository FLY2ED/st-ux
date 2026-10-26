import { motion } from 'framer-motion'

// 오른쪽 위로 미끄러져 들어오는 알림
export default function Notice({ notice, onClick, onClose }) {
  return (
    <motion.div
      className="notice glass"
      role="status"
      initial={{ x: 380, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 380, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
      onClick={onClick}
    >
      <img src={notice.img} alt="" />
      <div>
        <b>{notice.title}</b>
        <p>{notice.text}</p>
      </div>
      <time>지금</time>
      <button
        className="notice-x"
        aria-label="알림 닫기"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
      >
        ×
      </button>
    </motion.div>
  )
}
