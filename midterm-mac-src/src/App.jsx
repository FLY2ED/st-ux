import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { APPS, appOf } from './apps.js'
import { load } from './data.js'
import { playBgm, setMuted, sfx, sound } from './sound.js'
import Boot from './shell/Boot.jsx'
import Login from './shell/Login.jsx'
import MenuBar from './shell/MenuBar.jsx'
import Dock from './shell/Dock.jsx'
import Window from './shell/Window.jsx'
import VueIsland from './shell/VueIsland.jsx'
import Spotlight from './shell/Spotlight.jsx'
import Launchpad, { LaunchpadIcon } from './shell/Launchpad.jsx'
import Widgets from './shell/Widgets.jsx'
import Desktop from './shell/Desktop.jsx'
import Notice from './shell/Notice.jsx'
import About from './shell/About.jsx'
import Intro from './shell/Intro.jsx'
import { usePixelWall, WallLights } from './shell/PixelWall.jsx'
import Phone from './shell/Phone.jsx'
import { FACES, MSG_ICON, PHONE_STORIES, markPhone, phoneSeen } from './shell/phone-story.js'
import CharMaker from './games/CharMaker.vue'
import { hasLook } from './avatar.js'
import { player } from './arcade.js'
import './shell/shell.css'

const SHOWN = APPS.filter((a) => a.kind !== 'hidden')
// 여러 개 띄우는 창(Finder 폴더, 훑어보기 파일)은 'finder:photos' 처럼 앱 id 뒤에 열린 대상이 붙는다
const baseOf = (id) => appOf(String(id).split(':')[0])
const MY_KEY = 'gp-my-shops'
const RECENT_KEY = 'gp-recent'
const MENU_H = 24

function readShops() {
  try {
    return JSON.parse(localStorage.getItem(MY_KEY)) || []
  } catch {
    return []
  }
}

function useArea() {
  const get = () => ({ w: window.innerWidth, h: window.innerHeight - MENU_H })
  const [area, setArea] = useState(get)
  useEffect(() => {
    const on = () => setArea(get())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return area
}

export default function App() {
  const [booting, setBooting] = useState(true)
  const [locked, setLocked] = useState(true)
  const [meta, setMeta] = useState(null)
  const [wins, setWins] = useState([])
  const [spot, setSpot] = useState(false)
  const [pad, setPad] = useState(false)
  const [notice, setNotice] = useState(null)
  // 열려 있는 폰 문자 이야기(phone-story.js 의 키)
  const [phone, setPhone] = useState(null)
  const [muted, setMute] = useState(sound.muted)
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const [bouncing, setBouncing] = useState(null)
  const [myShops, setMyShops] = useState(readShops)
  // 처음 온 사람은 간판 수리공 인트로에서 시작을 고르면 캐릭터 꾸미기부터. 다 꾸미면 고른 것으로 게임을 연다
  const [maker, setMaker] = useState(false)
  const afterMaker = useRef(null)
  // 게임 인트로: 로그인하면 바탕화면부터. 간판 수리공 창을 새로 열 때마다 먼저 나온다
  const [intro, setIntro] = useState(false)
  // 인트로가 끝나면 열 창(open 에 들어온 그대로)
  const afterIntro = useRef(null)
  const afterPhone = useRef(null)
  // 시작 화면에서 고르면 held: 무너진 바탕 위로 게임이 전체 화면. 게임을 닫거나 내리면 release 로 바탕을 되돌린다
  const [held, setHeld] = useState(false)
  const [release, setRelease] = useState(false)
  const winsRef = useRef(wins)
  winsRef.current = wins
  const wall = usePixelWall(dark)
  const top = useRef(10)
  const iconRefs = useRef({})
  const area = useArea()
  const mobile = area.w < 700

  useEffect(() => {
    load('meta.json').then(setMeta).catch(() => {})
  }, [])

  // 켜지고 조금 뒤에 문자가 온다. 처음엔 간판 스티커 번호를 보고 연락한 모르는 번호,
  // 이야기를 시작한 뒤로는 분식 사장님이 이어서 와 달라고 한다
  useEffect(() => {
    if (booting || locked || maker || intro || phone) return
    if (winsRef.current.some((w) => w.id === 'street')) return
    const t = setTimeout(() => {
      if (!phoneSeen('start')) {
        setNotice({ phone: 'start', img: MSG_ICON, stay: true, ...PHONE_STORIES.start.notice })
      } else {
        let now = null
        try {
          now = JSON.parse(localStorage.getItem('gp-story-now'))
        } catch {
          // 진행 기록이 깨졌으면 처음처럼 부른다
        }
        if (now?.done) return
        setNotice({ app: 'street', img: FACES.bunsik, title: '공릉 분식 사장님', text: '아직 꺼진 간판이 남았어. 이어서 와 줄래?' })
      }
      sfx.bell()
    }, 1800)
    return () => clearTimeout(t)
  }, [booting, locked, maker, intro, phone])

  useEffect(() => {
    if (!notice || notice.stay) return
    const t = setTimeout(() => setNotice(null), 7000)
    return () => clearTimeout(t)
  }, [notice])

  const active = useMemo(() => wins.filter((w) => !w.min).reduce((a, w) => (!a || w.z > a.z ? w : a), null), [wins])

  const launch = useCallback(
    (asked, extra = {}, opt = {}) => {
      setPad(false)
      // 가게 차리기·우리 동네는 간판 지도 창의 탭으로 연다
      const alias = appOf(asked)
      const props = { ...(alias?.to ? alias.props : {}), ...extra }
      let id = alias?.to || asked
      const multi = appOf(id)?.multi
      if (multi && props[multi]) id = `${id}:${props[multi]}`
      setWins((ws) => {
        const found = ws.find((w) => w.id === id)
        if (found) return ws.map((w) => (w.id === id ? { ...w, title: props.winTitle || w.title, props: { ...w.props, ...props }, min: false, max: opt.max ?? w.max, z: ++top.current } : w))
        const app = id === 'about' ? { id, title: '간판 도감에 관하여', width: 340 } : baseOf(id)
        const n = ws.length
        const width = Math.min(app.width, area.w - 16)
        const x = Math.max(8, Math.min((area.w - width) / 2 - 80 + n * 32, area.w - width - 8))
        return [...ws, { id, title: props.winTitle || app.title, width, height: app.height, x, y: 36 + n * 26, z: ++top.current, min: false, max: !!opt.max, props: { ...app.props, ...props } }]
      })
      // 게임 앱의 '최근에 한 게임'에 쓴다
      if (appOf(id)?.kind === 'play') {
        try {
          const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((r) => r.id !== id)
          localStorage.setItem(RECENT_KEY, JSON.stringify([{ id, at: Date.now() }, ...list].slice(0, 8)))
          window.dispatchEvent(new Event('games:recent'))
        } catch {
          // 저장이 막혀도 게임은 열린다
        }
      }
      if (opt.quiet) return
      if (id !== 'about') {
        setBouncing(asked)
        setTimeout(() => setBouncing(null), 900)
      }
      sfx.open()
    },
    [area.w],
  )

  // 간판 수리공이 아직 안 열려 있으면 인트로부터 틀고, 끝나면 그 창을 연다.
  // 첫 문자를 아직 안 봤으면 문자부터 보여 주고, 문자 끝 버튼을 누르면 인트로로 간다
  const open = useCallback(
    (asked, extra = {}) => {
      const alias = appOf(asked)
      if ((alias?.to || asked) === 'street' && !winsRef.current.some((w) => w.id === 'street')) {
        setPad(false)
        setSpot(false)
        setNotice(null)
        if (!phoneSeen('start')) {
          afterPhone.current = [asked, extra]
          setPhone('start')
          return
        }
        afterIntro.current = [asked, extra]
        setIntro(true)
        return
      }
      launch(asked, extra)
    },
    [launch],
  )

  useEffect(() => {
    if (!held || release) return
    const w = wins.find((x) => x.id === 'street')
    if (!w || w.min || !w.max) setRelease(true)
  }, [held, release, wins])

  const close = (id) => {
    sfx.windowClose()
    setWins((ws) => ws.filter((w) => w.id !== id))
  }
  const patch = (id, change) => setWins((ws) => ws.map((w) => (w.id === id ? { ...w, ...change(w) } : w)))
  const focus = (id) => active?.id !== id && patch(id, () => ({ z: ++top.current }))
  const minimize = (id) => (sfx.minimize(), patch(id, () => ({ min: true })))
  const maximize = (id) => (sfx.maximize(), patch(id, (w) => ({ max: !w.max })))

  const dockClick = (id) => {
    if (id === 'launchpad') return sfx.whoosh(!pad), setPad((p) => !p)
    const w = wins.find((x) => x.id === id)
    if (w && !w.min && active?.id === id) return minimize(id)
    open(id)
  }

  const toggleDark = () => {
    document.documentElement.classList.toggle('dark', !dark)
    localStorage.setItem('gp-theme', dark ? 'light' : 'dark')
    setDark(!dark)
  }

  // 맨 앞 창의 곡을 튼다(assets/bgm/<앱>.mp3). 곡이 없는 앱(지도 등)과 바탕화면은 조용하다
  useEffect(() => {
    if (booting || locked || muted) return
    playBgm(active?.id)
  }, [active?.id, booting, locked, muted])

  const toggleMute = () => {
    if (muted) setTimeout(() => sfx.toggle(true), 0)
    setMuted(!muted)
    setMute(!muted)
  }

  // ⌘K / Ctrl+K 로 Spotlight, ⌘W 닫기, ⌘M 최소화
  useEffect(() => {
    const on = (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || booting || locked || maker || (intro && !held)) return
      const k = e.key.toLowerCase()
      if (k === 'k' || e.code === 'Space') {
        e.preventDefault()
        setSpot((s) => !s)
      } else if (k === 'w' && active && e.altKey === false && e.shiftKey === false && e.metaKey) {
        e.preventDefault()
        close(active.id)
      } else if (k === 'm' && active && e.metaKey) {
        e.preventDefault()
        minimize(active.id)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  const appName = active ? baseOf(active.id)?.appName || active.title : 'Finder'
  const menus = [
    {
      id: 'logo',
      items: [
        { label: '이 간판 도감에 관하여', run: () => open('about') },
        '-',
        { label: muted ? '소리 켜기' : '소리 끄기', run: toggleMute },
        { label: '다시 시작…', run: () => (setWins([]), setLocked(true), setBooting(true)) },
        { label: '로그아웃…', run: () => (setWins([]), setLocked(true)) },
      ],
    },
    {
      id: 'app',
      items: [
        { label: `${appName}에 관하여`, run: () => open('about') },
        '-',
        { label: `${appName} 종료`, key: '⌘Q', disabled: !active, run: () => active && close(active.id) },
      ],
    },
    {
      id: 'file',
      label: '파일',
      items: [
        { label: '새로운 놀이…', key: '⌘N', run: () => setPad(true) },
        { label: '찾기…', key: '⌘K', run: () => setSpot(true) },
        '-',
        { label: '윈도우 닫기', key: '⌘W', disabled: !active, run: () => active && close(active.id) },
      ],
    },
    {
      id: 'edit',
      label: '편집',
      items: [
        { label: '실행 취소', key: '⌘Z', disabled: true },
        '-',
        { label: '복사하기', key: '⌘C', run: () => document.execCommand('copy') },
        { label: '모두 선택', key: '⌘A', disabled: true },
      ],
    },
    {
      id: 'view',
      label: '보기',
      items: [
        { label: 'Spotlight', key: '⌘K', run: () => setSpot(true) },
        { label: 'Launchpad', run: () => setPad(true) },
        '-',
        { label: `${dark ? '✓ ' : ''}다크 모드`, run: toggleDark },
      ],
    },
    {
      id: 'window',
      label: '윈도우',
      items: [
        { label: '최소화', key: '⌘M', disabled: !active, run: () => active && minimize(active.id) },
        { label: '확대/축소', disabled: !active, run: () => active && maximize(active.id) },
        ...(wins.length ? ['-', ...wins.map((w) => ({ label: `${w.id === active?.id ? '✓ ' : ''}${w.title}`, run: () => open(w.id) }))] : []),
      ],
    },
    {
      id: 'help',
      label: '도움말',
      items: [
        { label: '간판 도감 도움말', run: () => open('about') },
        { label: '인트로 다시 보기', run: () => (setPad(false), setSpot(false), setIntro(true)) },
      ],
    },
  ]

  const dockTarget = (id) => {
    const el = iconRefs.current[id]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top - MENU_H + r.height / 2 }
  }

  const groups = [
    [{ id: 'launchpad', title: 'Launchpad' }, ...APPS.filter((a) => a.kind === 'hub' || (a.kind === 'play' && a.dock))],
    APPS.filter((a) => a.kind === 'look'),
  ]

  return (
    <div className="mac" style={{ '--wall': `url(${wall.url})` }}>
      <WallLights lights={wall.lights} />
      <AnimatePresence>{booting && <Boot key="boot" onDone={() => setBooting(false)} />}</AnimatePresence>
      {/* 잠금 화면은 부팅 화면 뒤에 미리 깔아 둔다: 부팅이 걷히는 동안 바탕화면이 비치지 않게 */}
      <AnimatePresence>{locked && <Login key="login" ready={!booting} onDone={() => setLocked(false)} />}</AnimatePresence>
      {maker && (
        <div className="cm-layer">
          <VueIsland
            comp={CharMaker}
            props={{ name: player()?.name || '' }}
            on={{
              done: () => {
                setMaker(false)
                const begin = afterMaker.current
                afterMaker.current = null
                if (begin) begin()
              },
              exit: () => {
                setMaker(false)
                if (!afterMaker.current) return
                // 게임에 들어가다 나가면 뒤에 띄워 둔 게임 창을 닫고 인트로를 걷어 바탕화면으로 돌아간다
                afterMaker.current = null
                setWins((ws) => ws.filter((w) => w.id !== 'street'))
                setRelease(true)
              },
            }}
          />
        </div>
      )}

      <MenuBar
        appName={appName}
        menus={menus}
        muted={muted}
        onMute={toggleMute}
        onSpotlight={() => setSpot(true)}
        pace={wins.some((w) => !w.min && baseOf(w.id)?.kind === 'play') ? 'run' : wins.some((w) => !w.min) ? 'jog' : 'walk'}
        onRun={() => open('street')}
      />

      <main className="desktop" onPointerDown={(e) => e.target === e.currentTarget && setSpot(false)}>
        {!mobile && <Desktop height={area.h} idle={!active && !spot && !pad && !locked && !maker} onOpen={open} onBlank={() => setSpot(false)} />}
        {!mobile && <Widgets meta={meta} onOpen={open} />}
        <AnimatePresence>
        {wins.map((w) => {
          const app = baseOf(w.id)
          const immersive = !!app?.immerse && (w.max || mobile)
          return (
          <Window
            key={w.id}
            win={w}
            area={area}
            mobile={mobile}
            immersive={immersive}
            fill={!!app?.fill}
            unified={!!app?.unified}
            ink={app?.ink}
            active={active?.id === w.id}
            dockTarget={w.min ? dockTarget(w.id) : null}
            onFocus={() => focus(w.id)}
            onClose={() => close(w.id)}
            onMin={() => minimize(w.id)}
            onMax={() => maximize(w.id)}
          >
            {w.id === 'about' ? (
              <About meta={meta} />
            ) : (
              <VueIsland
                comp={app.comp}
                props={{ ...w.props, ...(app.immerse ? { windowed: !immersive } : {}) }}
                on={{
                  open: (id, props) => open(id, props),
                  close: () => close(w.id),
                  retitle: (title) => patch(w.id, () => ({ title })),
                  unfull: () => patch(w.id, () => ({ max: false })),
                  opened: (shop) => {
                    const next = [...myShops.filter((s) => s.label !== shop.label), shop].slice(-8)
                    setMyShops(next)
                    try {
                      localStorage.setItem(MY_KEY, JSON.stringify(next))
                    } catch {
                      // 저장이 막혀도 이번 방문 동안은 보인다
                    }
                  },
                }}
              />
            )}
          </Window>
          )
        })}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {notice && !(mobile && wins.some((w) => !w.min)) && (
          <Notice
            key="notice"
            notice={notice}
            onClick={() => {
              if (notice.phone) setPhone(notice.phone)
              else open(notice.app)
              setNotice(null)
            }}
            onClose={() => setNotice(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {phone && (
          <Phone
            key="phone"
            story={phone}
            me={player()?.name || '수리공'}
            onGo={() => {
              markPhone(phone)
              setPhone(null)
              open(...(afterPhone.current || ['street']))
              afterPhone.current = null
            }}
            onClose={() => {
              afterPhone.current = null
              setPhone(null)
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{pad && <Launchpad key="pad" apps={SHOWN} onOpen={open} onClose={() => setPad(false)} />}</AnimatePresence>
      {spot && <Spotlight onClose={() => setSpot(false)} onOpen={open} />}

      {intro && (
        <Intro
          release={release}
          onReady={() => launch('street', {}, { max: true, quiet: true })}
          onStart={(begin) => {
            if (begin === 'exit') {
              setWins((ws) => ws.filter((w) => w.id !== 'street'))
              setRelease(true)
              return
            }
            const [asked, extra = {}] = afterIntro.current || ['street']
            const go = () => {
              launch(asked, { ...extra, begin, beginAt: Date.now() }, { max: true, quiet: true })
              setHeld(true)
            }
            if (hasLook()) return go()
            afterMaker.current = go
            setMaker(true)
          }}
          onDone={() => {
            afterIntro.current = null
            setIntro(false)
            setHeld(false)
            setRelease(false)
          }}
        />
      )}

      <Dock
        groups={groups.map((g) => g.map((a) => (a.id === 'launchpad' ? { ...a, node: <LaunchpadIcon apps={SHOWN} /> } : a)))}
        magnify={false}
        size={mobile ? 48 : 58}
        isOpen={(id) => wins.some((w) => w.id === id || (w.id === appOf(id)?.to && w.props?.mode === appOf(id).props.mode))}
        bouncing={bouncing}
        onOpen={dockClick}
        iconRefs={iconRefs}
      />
    </div>
  )
}
