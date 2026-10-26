import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { enter, player, refreshMe, setPass } from '../arcade.js'

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])
  return now
}

const Arrow = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// 맥 잠금 화면처럼: 위에 날짜·시각, 아래에 사용자. 여기서 정한 이름을 게임·쪽지가 그대로 쓴다
export default function Login({ onDone, ready = true }) {
  const now = useNow()
  const [me, setMe] = useState(player)
  const [typing, setTyping] = useState(!me)
  const [name, setName] = useState('')
  const [pass, setPassText] = useState('')
  // 저장된 이름에 암호를 붙이는 중
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef(null)
  const passInput = useRef(null)

  // 부팅 화면 뒤에 깔려 있는 동안은 입력을 받지 않는다
  useEffect(() => {
    if (ready) input.current?.focus()
  }, [typing, ready])
  useEffect(() => {
    if (adding) passInput.current?.focus()
  }, [adding])

  // 예전에 저장된 이름은 암호가 있는지 모르니 서버에 한 번 묻는다
  useEffect(() => {
    if (!me || me.pass !== undefined) return
    refreshMe()
      .then((p) => setMe(p))
      .catch(() => setMe(player()))
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (!ready) return
    if (!typing && !adding) return onDone()
    if (adding) {
      if (pass.length < 4) return setErr('암호는 4자 이상으로 정해 주세요')
      setBusy(true)
      setErr('')
      try {
        await setPass(pass)
        onDone()
      } catch (x) {
        setErr(x.message)
        setBusy(false)
      }
      return
    }
    const n = name.trim()
    if (!n) return setErr('닉네임을 적어 주세요')
    if (pass.length < 4) {
      passInput.current?.focus()
      return setErr('암호를 4자 이상 적어 주세요')
    }
    setBusy(true)
    setErr('')
    try {
      const p = await enter(n, pass)
      setMe(p)
      onDone()
    } catch (x) {
      setErr(x.message)
      setPassText('')
      setBusy(false)
      passInput.current?.focus()
    }
  }

  const day = '일월화수목금토'[now.getDay()]
  const h = now.getHours() % 12 || 12
  const shown = typing ? name.trim() : me?.name

  return (
    <motion.div className="login" inert={!ready} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 1.04 }} transition={{ duration: 0.45 }}>
      <div className="login-time">
        <p>{`${now.getMonth() + 1}월 ${now.getDate()}일 ${day}요일`}</p>
        <strong>{`${h}:${String(now.getMinutes()).padStart(2, '0')}`}</strong>
      </div>

      <form className="login-user" onSubmit={submit}>
        <div className="login-avatar" aria-hidden="true">
          {shown ? [...shown][0] : (
            <svg viewBox="0 0 24 24" width="44" height="44"><circle cx="12" cy="8.5" r="4.2" fill="currentColor" /><path d="M3.5 21c.8-4.4 4.3-6.6 8.5-6.6s7.7 2.2 8.5 6.6z" fill="currentColor" /></svg>
          )}
        </div>
        {typing ? (
          <>
            <p className="login-name">새 사용자</p>
            <label className="login-field">
              <input
                ref={input}
                value={name}
                maxLength={10}
                placeholder="닉네임 (한글·영문·숫자 2~10자)"
                aria-label="닉네임"
                autoComplete="username"
                disabled={busy}
                onChange={(e) => (setName(e.target.value), setErr(''))}
              />
            </label>
            <label className="login-field">
              <input
                ref={passInput}
                type="password"
                value={pass}
                maxLength={32}
                placeholder="암호 (4자 이상)"
                aria-label="암호"
                autoComplete="current-password"
                disabled={busy}
                onChange={(e) => (setPassText(e.target.value), setErr(''))}
              />
              <button type="submit" aria-label="시작" disabled={busy}>
                <Arrow />
              </button>
            </label>
          </>
        ) : adding ? (
          <>
            <p className="login-name">{me.name}</p>
            <label className="login-field">
              <input
                ref={passInput}
                type="password"
                value={pass}
                maxLength={32}
                placeholder="새 암호 (4자 이상)"
                aria-label="새 암호"
                autoComplete="new-password"
                disabled={busy}
                onChange={(e) => (setPassText(e.target.value), setErr(''))}
              />
              <button type="submit" aria-label="암호 정하고 시작" disabled={busy}>
                <Arrow />
              </button>
            </label>
          </>
        ) : (
          <>
            <p className="login-name">{me.name}</p>
            <button ref={input} type="submit" className="login-go">
              눌러서 시작 <Arrow />
            </button>
          </>
        )}
        <p className="login-hint" role="status">
          {err ||
            (typing
              ? '처음이면 새로 만들고, 있던 이름이면 암호로 이어서 해요'
              : adding
                ? '이 암호로 다른 기기에서도 이 이름을 쓸 수 있어요'
                : me?.pass === false
                  ? '암호가 없어서 이 브라우저에서만 쓸 수 있어요'
                  : ' ')}
        </p>
      </form>

      <nav className="login-more">
        {typing && me && (
          <button type="button" onClick={() => (setTyping(false), setPassText(''), setErr(''))}>
            {me.name}(으)로 돌아가기
          </button>
        )}
        {!typing && !adding && me?.pass === false && (
          <button type="button" onClick={() => (setAdding(true), setPassText(''), setErr(''))}>
            암호 정하기
          </button>
        )}
        {adding && (
          <button type="button" onClick={() => (setAdding(false), setPassText(''), setErr(''))}>
            나중에 하기
          </button>
        )}
        {!typing && !adding && (
          <button type="button" onClick={() => (setTyping(true), setPassText(''))}>
            다른 이름 쓰기
          </button>
        )}
        {!me && (
          <button type="button" onClick={onDone}>
            게스트로 둘러보기
          </button>
        )}
      </nav>
    </motion.div>
  )
}
