import { useEffect, useRef, useState } from 'react'
import { drawAvatar, readLook } from '../avatar.js'

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])
  const day = '일월화수목금토'[now.getDay()]
  const h = now.getHours()
  return `${now.getMonth() + 1}월 ${now.getDate()}일 (${day}) ${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(now.getMinutes()).padStart(2, '0')}`
}

// 애플 로고 자리에 두는 간판 모양
export const SignLogo = (props) => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" {...props}>
    <rect x="1.5" y="2" width="13" height="8" rx="2.2" fill="currentColor" />
    <rect x="4" y="10" width="1.6" height="4.5" rx="0.6" fill="currentColor" />
    <rect x="10.4" y="10" width="1.6" height="4.5" rx="0.6" fill="currentColor" />
    <rect x="4.2" y="5.2" width="7.6" height="1.6" rx="0.8" fill="#fff" opacity="0.9" />
  </svg>
)

const Speaker = ({ muted }) => (
  <svg viewBox="0 0 20 16" width="18" height="14" aria-hidden="true">
    <path d="M2 5.5h3l4-3.5v12l-4-3.5H2z" fill="currentColor" />
    {muted ? (
      <path d="M12.5 5.5l5 5M17.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    ) : (
      <>
        <path d="M12 5.2a3.6 3.6 0 010 5.6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M14.6 2.8a7 7 0 010 10.4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </>
    )}
  </svg>
)

const Magnifier = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <circle cx="6.8" cy="6.8" r="4.8" stroke="currentColor" strokeWidth="1.7" fill="none" />
    <path d="M10.4 10.4L14.5 14.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
)

// 와이파이: 실제 연결 상태(navigator.onLine)를 따른다
const Wifi = ({ on }) => (
  <svg viewBox="0 0 20 16" width="17" height="14" aria-hidden="true">
    <path d="M10 13.6l2.1-2.4a3 3 0 00-4.2 0z" fill="currentColor" />
    <path d="M5.6 8.9a6.2 6.2 0 018.8 0" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity={on ? 1 : 0.35} />
    <path d="M3 6.2a9.9 9.9 0 0114 0" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity={on ? 1 : 0.35} />
    {!on && <path d="M4 2l12 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
  </svg>
)

// 배터리: 브라우저가 알려 줄 때만(크롬 계열) 실제 잔량으로 보인다
const Battery = ({ level, charging }) => (
  <svg viewBox="0 0 27 13" width="25" height="12" aria-hidden="true">
    <rect x="0.75" y="0.75" width="22" height="11.5" rx="3.2" fill="none" stroke="currentColor" strokeWidth="1.1" opacity="0.5" />
    <rect x="24" y="4.3" width="1.6" height="4.4" rx="0.8" fill="currentColor" opacity="0.5" />
    <rect x="2.4" y="2.4" width={Math.max(1.5, 18.7 * level)} height="8.2" rx="1.8" fill={level <= 0.2 && !charging ? '#ff453a' : 'currentColor'} />
    {charging && <path d="M12.6 1.8L8.6 7h3l-1.1 4.2L14.6 6h-3z" fill="currentColor" stroke="rgba(0,0,0,0.55)" strokeWidth="0.6" />}
  </svg>
)

function useOnline() {
  const [on, setOn] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOn(true)
    const down = () => setOn(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return on
}

function useBattery() {
  const [bat, setBat] = useState(null)
  useEffect(() => {
    let b
    const read = () => setBat({ level: b.level, charging: b.charging })
    navigator.getBattery?.().then((x) => {
      b = x
      read()
      b.addEventListener('levelchange', read)
      b.addEventListener('chargingchange', read)
    }, () => {})
    return () => {
      b?.removeEventListener('levelchange', read)
      b?.removeEventListener('chargingchange', read)
    }
  }, [])
  return bat
}

// 메뉴 막대 아이콘처럼 흰색 한 가지로 칠하고, 원래 색의 밝기만 투명도로 남긴다(어두운 머리는 진하게, 밝은 얼굴은 옅게)
function template(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue
    const luma = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255
    const a = luma < 0.35 ? 1 : luma < 0.65 ? 0.72 : 0.45
    d[i] = d[i + 1] = d[i + 2] = 255
    d[i + 3] = Math.round(d[i + 3] * a)
  }
  ctx.putImageData(img, 0, 0)
}

// 상태 막대의 내 캐릭터(RunCat 처럼): 바탕화면만 있으면 걷고, 게임 창이 열려 있으면 달리고, 탭이 숨으면 멈춘다
const PACE = { walk: 260, jog: 160, run: 90 }

function RunCat({ pace, onRun }) {
  const cv = useRef(null)
  const look = useRef(readLook())
  const [hidden, setHidden] = useState(document.hidden)

  useEffect(() => {
    const onLook = (e) => (look.current = e.detail || readLook())
    const onVis = () => setHidden(document.hidden)
    window.addEventListener('look:change', onLook)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('look:change', onLook)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  useEffect(() => {
    const c = cv.current
    const s = Math.max(1, Math.round(window.devicePixelRatio || 1))
    c.width = 22 * s
    c.height = 24 * s
    const ctx = c.getContext('2d')
    let tick = 0
    const draw = () => {
      const run = pace === 'run'
      const frame = hidden ? 0 : tick % 2
      ctx.clearRect(0, 0, c.width, c.height)
      // 달릴 때는 뒤에 바람 줄
      if (run && !hidden) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
        ctx.fillRect(0, (9 + (tick % 2) * 4) * s, 4 * s, s)
        ctx.fillRect(1 * s, (15 - (tick % 2) * 3) * s, 3 * s, s)
      }
      drawAvatar(ctx, look.current, 13 * s, (24 - (run && frame ? 1 : 0)) * s, { scale: s, dir: 3, frame, shadow: false })
      template(ctx, c.width, c.height)
      tick++
    }
    draw()
    if (hidden) return
    const t = setInterval(draw, PACE[pace] || PACE.walk)
    return () => clearInterval(t)
  }, [pace, hidden])

  return (
    <button className="mb-item icon runcat" title="간판 수리공 열기" aria-label="간판 수리공 열기" onClick={onRun}>
      <canvas ref={cv} />
    </button>
  )
}

export default function MenuBar({ appName, menus, muted, onMute, onSpotlight, pace = 'walk', onRun }) {
  const clock = useClock()
  const online = useOnline()
  const battery = useBattery()
  const [openMenu, setOpenMenu] = useState(null)
  const bar = useRef(null)

  useEffect(() => {
    if (!openMenu) return
    const off = (e) => !bar.current?.contains(e.target) && setOpenMenu(null)
    const esc = (e) => e.key === 'Escape' && setOpenMenu(null)
    window.addEventListener('pointerdown', off)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', off)
      window.removeEventListener('keydown', esc)
    }
  }, [openMenu])

  const pick = (item) => {
    setOpenMenu(null)
    item.run?.()
  }

  return (
    <header className="menubar" ref={bar}>
      <nav className="mb-left">
        {menus.map((m, i) => (
          <div key={m.id} className="mb-slot">
            <button
              className={`mb-item ${i === 0 ? 'logo' : ''} ${i === 1 ? 'app' : ''} ${openMenu === m.id ? 'on' : ''}`}
              aria-haspopup="menu"
              aria-expanded={openMenu === m.id}
              onPointerDown={(e) => {
                e.preventDefault()
                setOpenMenu(openMenu === m.id ? null : m.id)
              }}
              onPointerEnter={() => openMenu && setOpenMenu(m.id)}
            >
              {i === 0 ? <SignLogo /> : i === 1 ? appName : m.label}
            </button>
            {openMenu === m.id && (
              <ul className="mb-menu glass" role="menu">
                {m.items.map((it, j) =>
                  it === '-' ? (
                    <li key={j} className="menu-sep" role="separator" />
                  ) : (
                    <li key={j} role="menuitem">
                      <button className="menu-row" disabled={it.disabled} onClick={() => pick(it)}>
                        <span>{it.label}</span>
                        {it.key && <kbd>{it.key}</kbd>}
                      </button>
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>
        ))}
      </nav>
      <div className="mb-right">
        <RunCat pace={pace} onRun={onRun} />
        <button className="mb-item icon" aria-label={muted ? '소리 켜기' : '소리 끄기'} onClick={onMute}>
          <Speaker muted={muted} />
        </button>
        {battery && (
          <span className="mb-item icon" role="img" aria-label={`배터리 ${Math.round(battery.level * 100)}%${battery.charging ? ', 충전 중' : ''}`} title={`${Math.round(battery.level * 100)}%`}>
            <Battery {...battery} />
          </span>
        )}
        <span className="mb-item icon" role="img" aria-label={online ? '인터넷 연결됨' : '인터넷 끊김'} title={online ? '연결됨' : '연결 끊김'}>
          <Wifi on={online} />
        </span>
        <button className="mb-item icon" aria-label="Spotlight" onClick={onSpotlight}>
          <Magnifier />
        </button>
        <span className="mb-item clock">{clock}</span>
      </div>
    </header>
  )
}
