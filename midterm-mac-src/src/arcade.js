// 간판 오락실 서버(st-arcade Worker + D1)와 이야기한다. 개발 서버에서는 vite.config.js 의 로컬 SQLite 가 대신 받는다
const BASE = import.meta.env.DEV ? './arcade' : 'https://st-arcade.naldadev.com'
const KEY = 'gp-player'

export const GAME_TITLES = {
  rain: '간판 산성비',
  dodge: '점심 간판 피하기',
  guess: '간판 어디게',
  more: '더 많을까?',
  type: '간판 타자왕',
}

export function player() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null
  } catch {
    return null
  }
}

function setPlayer(p) {
  if (p) localStorage.setItem(KEY, JSON.stringify(p))
  else localStorage.removeItem(KEY)
  window.dispatchEvent(new CustomEvent('arcade:player', { detail: p }))
}

async function call(path, { method = 'GET', body, keepalive = false } = {}) {
  const me = player()
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(me ? { Authorization: `Bearer ${me.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      keepalive,
    })
  } catch {
    throw Object.assign(new Error('서버에 닿지 않아요. 잠시 뒤 다시 해 주세요'), { status: 0 })
  }
  const data = await res.json().catch(() => ({}))
  // 다른 기기에서 지워졌거나 서버가 새로 시작된 경우: 저장된 이름을 잊는다
  if (res.status === 401 && me) setPlayer(null)
  if (!res.ok) throw Object.assign(new Error(data.error || '잠시 뒤 다시 해 주세요'), { status: res.status })
  return data
}

// 새 이름이면 만들고, 있던 이름이면 암호로 이어서 들어간다
export async function enter(name, pass) {
  let p
  try {
    p = await call('/player', { method: 'POST', body: { name, pass } })
  } catch (e) {
    if (e.status !== 409) throw e
    p = await call('/login', { method: 'POST', body: { name, pass } })
  }
  setPlayer(p)
  return p
}

// 암호 없이 만든 이름에 암호를 붙인다(이미 있으면 old 로 지금 암호를 같이 보낸다)
export async function setPass(pass, old) {
  await call('/me/pass', { method: 'POST', body: { pass, old } })
  const me = player()
  if (me) setPlayer({ ...me, pass: true })
}

// 예전에 저장된 이름은 암호가 있는지 모른다: 서버에 한 번 물어 둔다
export async function refreshMe() {
  const me = player()
  if (!me) return null
  const info = await call('/me')
  const next = { ...me, pass: !!info.pass }
  setPlayer(next)
  return next
}

export function forget() {
  setPlayer(null)
}

// 점수 올리기. 등록 전이면 null 을 돌려주고 화면이 등록을 권한다
export async function submit(game, score) {
  if (!player()) return null
  const out = await call('/score', { method: 'POST', body: { game, score } })
  window.dispatchEvent(new CustomEvent('arcade:score', { detail: { game, ...out } }))
  return out
}

export const board = (game, limit = 10) => call(`/board?game=${game}&limit=${limit}`)
export const boards = () => call('/boards')
export const where = () => call('/where')
export const lottoToday = () => call('/lotto')
export const lottoBuy = () => call('/lotto', { method: 'POST' })
export const shops = () => call('/shops')
export const openShop = (shop) => call('/shops', { method: 'POST', body: shop })

// 간판 거리 같이 하기: 동네 조각(0.01°)마다 담은 사람 수·쪽지·순위를 한 번에 읽고, 담은 간판은 모아서 한 번에 올린다
export const streetRead = (tiles) => call(`/street?t=${tiles.slice(0, 4).join(',')}`)
export const streetFound = (tile, found) => call('/street', { method: 'POST', body: { t: tile, found }, keepalive: true })
export const streetNote = (key, text) => call('/street/note', { method: 'POST', body: { key, text } })
