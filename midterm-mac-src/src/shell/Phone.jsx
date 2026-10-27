import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { sfx } from '../sound.js'
import photo from '../assets/phone-photo.webp'
import { FACES, PHONE_STORIES } from './phone-story.js'
import './phone.css'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function Face({ who, small }) {
  const src = FACES[who]
  return (
    <span className={`ph-ava${small ? ' small' : ''}`}>
      {src ? (
        <img src={src} alt="" />
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8" r="4.2" />
          <path d="M3.5 21c.8-4.2 4.2-6.6 8.5-6.6s7.7 2.4 8.5 6.6z" />
        </svg>
      )}
    </span>
  )
}

// 간판이 꺼진 정문 앞 사진: 불 꺼진 분식집과 바닥에 떨어진 글자
function Photo() {
  return <img className="ph-photo" src={photo} alt="간판 불이 꺼지고 글자가 바닥에 떨어진 분식집 앞 사진" />
}

// 문자 화면. 대화를 차례로 틀고, 답장은 고르기만 하고, 마지막 버튼으로 게임에 들어간다
export default function Phone({ story = 'start', me, onGo, onClose }) {
  const data = PHONE_STORIES[story]
  const [ti, setTi] = useState(0)
  const [items, setItems] = useState([])
  const [typing, setTyping] = useState(false)
  const [choices, setChoices] = useState(null)
  const [go, setGo] = useState(null)
  const [banner, setBanner] = useState(null)
  const pick = useRef(null)
  const openNext = useRef(null)
  const list = useRef(null)
  const fill = (s) => s.replaceAll('{me}', me)
  const th = data.threads[ti]

  useEffect(() => {
    let off = false
    const say = (m) => setItems((xs) => [...xs, m])
    ;(async () => {
      setItems([])
      setGo(null)
      await wait(450)
      for (const m of th.script) {
        if (off) return
        if (m.choose) {
          setChoices(m.choose)
          const n = await new Promise((r) => (pick.current = r))
          if (off) return
          setChoices(null)
          sfx.whoosh(true, { dur: 0.16, peak: 0.08 })
          say({ me: true, t: m.choose[n] })
          await wait(800)
        } else if (m.read) {
          say({ read: m.read })
          await wait(900)
        } else if (m.next) {
          await wait(500)
          sfx.bell()
          setBanner(m.next)
          await Promise.race([new Promise((r) => (openNext.current = r)), wait(6000)])
          if (off) return
          setBanner(null)
          setTi((i) => i + 1)
          return
        } else if (m.go) {
          setGo(m)
          return
        } else {
          setTyping(true)
          await wait(Math.min(2000, 500 + (m.t?.length || 16) * 26))
          if (off) return
          setTyping(false)
          sfx.pop()
          say(m)
          await wait(m.photo ? 1000 : 600)
        }
      }
    })()
    return () => {
      off = true
      setTyping(false)
      setChoices(null)
    }
  }, [ti, th])

  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items, typing, choices, go])

  useEffect(() => {
    const on = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])

  return (
    <motion.div className="ph-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div
        className="ph"
        role="dialog"
        aria-label={`메시지: ${th.name}`}
        initial={{ y: '115%' }}
        animate={{ y: 0 }}
        exit={{ y: '115%' }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      >
        <div className="ph-screen">
          <i className="ph-island" />
          {banner && (
            <button className="ph-banner" onClick={() => openNext.current?.()}>
              <Face who={banner.who} small />
              <span>
                <b>{banner.title}</b>
                {fill(banner.text)}
              </span>
              <small>지금</small>
            </button>
          )}
          <div className="ph-status">
            <span>{data.clock}</span>
            <span className="ph-ind">
              <svg width="15" height="10" viewBox="0 0 15 10" aria-hidden="true">
                <path fill="currentColor" d="M1 7h2v3H1zM5 5h2v5H5zM9 3h2v7H9zM13 0h2v10h-2z" />
              </svg>
              <i className="ph-bat" />
            </span>
          </div>
          <div className="ph-head">
            <button className="ph-back" onClick={onClose} aria-label="닫기">
              ‹
            </button>
            <Face who={th.who} />
            <span className="ph-name">{th.name}</span>
          </div>
          <div className="ph-list" ref={list}>
            <div className="ph-when">{th.when}</div>
            {items.map((m, i) => {
              if (m.read) return <div key={i} className="ph-read">{m.read}</div>
              const side = m.me ? 'me' : 'them'
              const nextOne = items[i + 1]
              const tail = !nextOne || !!nextOne.me !== !!m.me || nextOne.read || nextOne.gap
              const gap = i === 0 || m.gap || !!items[i - 1].me !== !!m.me
              return (
                <div key={i} className={`ph-msg ${side}${tail ? ' tail' : ''}${gap ? ' gap' : ''}`}>
                  {m.photo ? <Photo /> : <div className="ph-bub">{fill(m.t)}</div>}
                </div>
              )
            })}
            {typing && (
              <div className="ph-typing" aria-label="입력 중">
                <i />
                <i />
                <i />
              </div>
            )}
          </div>
          <div className="ph-foot">
            {choices && (
              <div className="ph-choices">
                <span>답장 고르기</span>
                {choices.map((c, n) => (
                  <button key={c} onClick={() => pick.current?.(n)}>
                    {c}
                  </button>
                ))}
              </div>
            )}
            {go && (
              <button className="ph-go" onClick={onGo}>
                {go.go}
                <small>{go.sub}</small>
              </button>
            )}
            <div className="ph-input">
              <span className="plus">+</span>
              <span className="field">iMessage</span>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
