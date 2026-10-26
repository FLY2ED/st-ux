import { useEffect, useRef, useState } from 'react'
import { nearby } from '../data.js'
import { boards, player, where } from '../arcade.js'
import { drawAvatar, readLook } from '../avatar.js'
import laundry from '../assets/shop-laundry.webp'

const fmt = (n) => n.toLocaleString('ko-KR')
// 위젯은 좁으니 큰 수는 만 단위로 줄인다 (2,772,484 → 277만)
const short = (n) => (n >= 10000 ? `${fmt(Math.floor(n / 10000))}만` : fmt(n))

const STORY_KEY = 'gp-story-now'
const TIMES = ['night', 'dusk', 'day', 'dawn']

function readStory() {
  try {
    return JSON.parse(localStorage.getItem(STORY_KEY)) || null
  } catch {
    return null
  }
}

// 이야기 시간이 없으면 지금 시각으로 고른다
function clockTime() {
  const h = new Date().getHours()
  return h >= 5 && h < 8 ? 'dawn' : h >= 8 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'dusk' : 'night'
}

function useStory() {
  const [story, setStory] = useState(readStory)
  useEffect(() => {
    const on = (e) => setStory(e.detail || readStory())
    const onStore = (e) => e.key === STORY_KEY && setStory(readStory())
    window.addEventListener('story:progress', on)
    window.addEventListener('storage', onStore)
    return () => {
      window.removeEventListener('story:progress', on)
      window.removeEventListener('storage', onStore)
    }
  }, [])
  return story
}

// 위젯 속 장면: 가게 한 채 앞 사다리에서 수리공이 간판을 고치고, 옆 나무 팻말에 할 일을 적는다
const BULB_MAX = 12

// 바닥 소품은 글자 하나를 픽셀 하나로 찍고 화면에서 두 배로 키운다
const PAL = { G: '#008751', g: '#00b543', l: '#6fdc5c' }
const TUFT = [' l    l      l   ', 'lg l lg  l  lg l ', 'gglgggg lgl gggg ']

function Pixels({ rows, className }) {
  const cv = useRef(null)
  useEffect(() => {
    const x = cv.current.getContext('2d')
    rows.forEach((r, y) => [...r].forEach((ch, i) => PAL[ch] && ((x.fillStyle = PAL[ch]), x.fillRect(i, y, 1, 1))))
  }, [rows])
  return <canvas ref={cv} className={className} width={Math.max(...rows.map((r) => r.length))} height={rows.length} aria-hidden="true" />
}

function Ladder() {
  const cv = useRef(null)
  useEffect(() => {
    const x = cv.current.getContext('2d')
    x.fillStyle = '#9a6a3a'
    x.fillRect(1, 0, 2, 75)
    x.fillRect(10, 0, 2, 75)
    x.fillStyle = '#c48a4c'
    for (let y = 4; y < 75; y += 8) x.fillRect(1, y, 11, 2)
    x.fillStyle = '#5a3a1a'
    x.fillRect(3, 0, 1, 75)
    x.fillRect(12, 0, 1, 75)
  }, [])
  return <canvas ref={cv} className="r-ladder" width={13} height={75} aria-hidden="true" />
}

// 사다리 위 수리공은 뒷모습, 모습을 바꾸면 바로 따라 바꾼다
function Climber() {
  const cv = useRef(null)
  const [look, setLook] = useState(readLook)
  useEffect(() => {
    const on = (e) => setLook(e.detail || readLook())
    window.addEventListener('look:change', on)
    return () => window.removeEventListener('look:change', on)
  }, [])
  useEffect(() => {
    const c = cv.current
    const x = c.getContext('2d')
    x.clearRect(0, 0, c.width, c.height)
    drawAvatar(x, look, c.width / 2, c.height, { scale: 2, dir: 1, shadow: false })
  }, [look])
  return <canvas ref={cv} className="r-me" width={32} height={48} aria-hidden="true" />
}

// next 는 「가게」 불 켜기 / 「가게」 짓기 / 보스 물리치기 중 하나다
function task(story) {
  if (!story) return { shop: '간판 도감', what: '아직 이야기 전', lit: false }
  if (story.done) return { shop: '간판 도감', what: '모든 간판을 켰어요', lit: true }
  if (story.boss) return { shop: '???', what: `${story.boss} 물리치기`, lit: false }
  const m = /「(.+)」\s*(.+)/.exec(story.next || '')
  if (!m) return { shop: '???', what: '꺼진 간판 찾는 중', lit: false }
  return { shop: m[1], what: m[2] === '짓기' ? '가게 짓는 중' : '간판 고치는 중', lit: false }
}

const SPARKS = Array.from({ length: 6 }, (_, i) => ({
  left: 148 + (i % 3) * 3,
  top: 62 + (i % 2) * 4,
  '--dx': `${(i % 2 ? -1 : 1) * (8 + i * 3)}px`,
  '--dy': `${((i % 3) - 1) * 10}px`,
  animationDelay: `${i * 0.12}s`,
}))

function Repairer({ story, onOpen }) {
  const goal = Math.min(BULB_MAX, Math.max(1, story?.goal || BULB_MAX))
  const lit = Math.min(goal, story?.lit || 0)
  const t = task(story)
  const fixing = story && !story.done && !story.boss
  return (
    <button className={`widget medium repairer${t.lit ? ' all-lit' : ''}`} onClick={() => onOpen('street')} aria-label={`내 수리공: ${story?.chapter || ''} ${t.shop} ${t.what}. 불 켠 간판 ${lit}/${goal}. ${story ? '이어 하기' : '시작하기'}`}>
      <span className="r-shop" aria-hidden="true">
        <span className={`r-sign${fixing ? ' flick' : ''}`}>{t.shop}</span>
        <img src={laundry} alt="" />
      </span>
      <span className="r-walk" aria-hidden="true" />
      <Ladder />
      <Climber />
      {fixing && SPARKS.map((s, i) => <i key={i} className="r-spark" style={s} />)}
      <span className="r-post" aria-hidden="true" />
      <span className="r-board" aria-hidden="true">
        <span className="r-ch">{story?.chapter || '과기대 정문에서 시작'}</span>
        <span className="r-q">
          {t.shop === '???' ? '' : t.shop}
          {t.shop === '???' ? '' : <br />}
          {t.what}
        </span>
        <span className="r-bulbs">
          {Array.from({ length: goal }, (_, i) => (
            <i key={i} className={i < lit ? 'on' : ''} />
          ))}
        </span>
      </span>
      <span className="r-turf" aria-hidden="true" />
      <span className="r-lab" aria-hidden="true">
        눌러서<b>{story ? '이어 하기' : '시작하기'}</b>
      </span>
      <span className="r-press" aria-hidden="true">
        <span className="r-cap" />
        <span className="r-base" />
      </span>
      <Pixels rows={TUFT} className="r-tuft" />
    </button>
  )
}

async function around(spot) {
  const rows = await nearby(spot.lng, spot.lat, 500)
  const byCat = new Map()
  for (const r of rows) byCat.set(r.cat, (byCat.get(r.cat) || 0) + 1)
  const cats = [...byCat].sort((a, b) => b[1] - a[1]).slice(0, 3)
  return { spot, total: rows.length, cats, nearest: rows[0], sample: !!rows.sample }
}

const here = () =>
  new Promise((ok, no) =>
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition((p) => ok({ lng: p.coords.longitude, lat: p.coords.latitude, label: '내 위치', exact: true }), no, { timeout: 8000 })
      : no(new Error('no geolocation')),
  )

// 위치는 정직한 순서로 고른다: 이미 허용된 정확한 위치 → 접속 IP 로 본 대략 위치 → 없으면 켜 달라고 한다
async function firstSpot() {
  const state = await navigator.permissions?.query({ name: 'geolocation' }).then((s) => s.state, () => 'unknown')
  if (state === 'granted') return here().catch(() => null)
  const { approx } = await where().catch(() => ({}))
  if (approx) return { lng: approx.lng, lat: approx.lat, label: approx.city ? `${approx.city} 부근` : '접속 위치 부근', exact: false }
  return null
}

function Nearby({ onOpen }) {
  const [near, setNear] = useState(null)
  const [state, setState] = useState('loading')

  const show = (spot) =>
    spot
      ? around(spot).then((n) => (setNear(n), setState('ok')), () => setState('off'))
      : setState('off')

  useEffect(() => {
    firstSpot().then(show, () => setState('off'))
  }, [])

  const locate = () => {
    setState('asking')
    here().then(show, () => setState(near ? 'ok' : 'denied'))
  }

  return (
    <div className="widget medium tall">
      <div className="w-row">
        <span className="w-cap">
          {near ? `${near.spot.label} 500m` : '우리 동네 간판'}
          {near && !near.spot.exact && <em> · IP로 본 대략 위치</em>}
        </span>
        {near && !near.spot.exact && (
          <button className="w-link" onClick={locate} disabled={state === 'asking'}>
            {state === 'asking' ? '찾는 중…' : '정확한 위치'}
          </button>
        )}
      </div>
      {state === 'ok' && near ? (
        <>
          <strong className="w-mid">{near.sample ? '표본 ' : ''}간판 {fmt(near.total)}곳</strong>
          <ul className="w-bars">
            {near.cats.map(([cat, n]) => (
              <li key={cat}>
                <span>{cat}</span>
                <i style={{ width: `${(n / near.cats[0][1]) * 100}%` }} />
                <b>{n}</b>
              </li>
            ))}
          </ul>
          {near.nearest && (
            <button className="w-foot w-btn" onClick={() => onOpen('near')}>
              가장 가까운 간판 ‘{near.nearest.name}’ {near.nearest.dist}m
            </button>
          )}
        </>
      ) : state === 'loading' ? (
        <span className="w-foot">불러오는 중…</span>
      ) : (
        <div className="w-off">
          <span className="w-pin" aria-hidden>
            <svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" /></svg>
          </span>
          <p>
            {state === 'denied' ? '위치를 받지 못했어요. 브라우저 주소창의 위치 권한을 확인해 주세요.' : '위치를 켜면 내 주변 500m 간판을 세어 드려요. 위치는 이 기기에서만 써요.'}
          </p>
          <button className="w-pill" onClick={locate}>
            위치 켜기
          </button>
        </div>
      )}
    </div>
  )
}

const GAMES = [
  ['rain', '간판 산성비', '점'],
  ['type', '간판 타자왕', '점'],
  ['dodge', '점심 간판 피하기', '점'],
  ['guess', '간판 어디게', '점'],
  ['more', '더 많을까?', '연승'],
]

function Arcade({ onOpen }) {
  const [data, setData] = useState(null)
  const [me, setMe] = useState(player())
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const pull = () => {
      boards().then((d) => (setData(d), setFailed(false)), () => setFailed(true))
    }
    const onPlayer = (e) => (setMe(e.detail), pull())
    pull()
    const t = setInterval(pull, 60_000)
    window.addEventListener('arcade:score', pull)
    window.addEventListener('arcade:player', onPlayer)
    return () => {
      clearInterval(t)
      window.removeEventListener('arcade:score', pull)
      window.removeEventListener('arcade:player', onPlayer)
    }
  }, [])

  const byGame = Object.fromEntries((data?.games || []).map((g) => [g.game, g]))

  return (
    <div className="widget medium tall arcade">
      <div className="w-row">
        <span className="w-cap">
          오락실 순위 <em>{data ? `· ${fmt(data.players)}명 참가` : ''}</em>
        </span>
        <span className="w-me">{me ? me.name : '닉네임 없음'}</span>
      </div>
      {failed && !data ? (
        <span className="w-foot">순위 서버에 닿지 않아요</span>
      ) : (
        <ol className="w-rank">
          {GAMES.map(([id, title, unit]) => {
            const g = byGame[id]
            const first = g?.top[0]
            return (
              <li key={id}>
                <button onClick={() => onOpen(id)}>
                  <span className="w-game">{title}</span>
                  {first ? (
                    <span className="w-lead">
                      <b>👑 {first.name}</b> {fmt(first.score)}
                      {unit}
                    </span>
                  ) : (
                    <span className="w-lead muted">첫 기록 도전</span>
                  )}
                  {g?.me && <span className="w-mine">내 {g.me.rank}위</span>}
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

function Score({ meta, onOpen }) {
  return (
    <button className="widget medium score" onClick={() => onOpen('building')} title={meta?.source}>
      <span className="w-row">
        <span className="w-cap">전국 간판</span>
        {meta && (
          <span className="s-date">
            {meta.date.slice(0, 4)}년 {+meta.date.slice(5, 7)}월 기준
          </span>
        )}
      </span>
      <span className="s-body">
        <span className="s-main">
          <strong className="w-big">
            {meta ? short(meta.total) : '…'}
            <span className="w-unit">곳</span>
          </strong>
          <span className="s-exact">{meta ? `정확히 ${fmt(meta.total)}곳` : ''}</span>
        </span>
        {meta && (
          <span className="s-stats">
            <span>
              <i>서로 다른 이름</i>
              <b>{short(meta.uniqueNames)}개</b>
            </span>
            <span>
              <i>업종</i>
              <b>{fmt(meta.categories)}가지</b>
            </span>
          </span>
        )}
      </span>
      <span className="s-src">{meta ? '소상공인시장진흥공단 상가정보 · 공공데이터포털' : ''}</span>
    </button>
  )
}

export default function Widgets({ meta, onOpen }) {
  const story = useStory()
  const time = TIMES.includes(story?.time) ? story.time : clockTime()
  return (
    <aside className={`widgets t-${time}`} aria-label="위젯">
      <Repairer story={story} onOpen={onOpen} />

      <Score meta={meta} onOpen={onOpen} />

      <Nearby onOpen={onOpen} />
      <Arcade onOpen={onOpen} />
    </aside>
  )
}
