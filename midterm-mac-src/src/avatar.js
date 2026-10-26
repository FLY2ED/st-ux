// 내 캐릭터: 16×24 픽셀 인형을 부위별 색·모양으로 조립한다.
// 거리(2D), 건물 안, 상태 막대, 위젯이 모두 이 한 벌을 그려서 어디서든 같은 사람으로 보인다
export const LOOK_KEY = 'gp-look'

export const SKINS = ['#ffd9b8', '#f2c094', '#d99a6c', '#a86b43']
export const HAIRS = ['#2a2230', '#5b3a29', '#a8683a', '#e8c46a', '#d9534f', '#7a8cff', '#f2f2f2']
export const TOPS = ['#2f6fff', '#e8483f', '#ffb020', '#2fb36a', '#8a5cf6', '#ff6fae', '#f4f4f4', '#2b2f3a']
export const BOTTOMS = ['#2b3d6b', '#3a3a44', '#6b4a2a', '#d8d0bf']
export const HAIR_STYLES = [
  ['short', '짧은 머리'],
  ['long', '긴 머리'],
  ['bob', '단발'],
  ['spiky', '뻗친 머리'],
  ['bun', '똥머리'],
]
export const HATS = [
  ['helmet', '안전모'],
  ['none', '없음'],
  ['cap', '모자'],
  ['beanie', '비니'],
]
export const EXTRAS = [
  ['none', '없음'],
  ['glasses', '안경'],
  ['bag', '공구 가방'],
]

export const DEFAULT_LOOK = { skin: 0, hair: 0, hairStyle: 'short', top: 0, bottom: 0, hat: 'helmet', hatColor: '#ffcf3a', extra: 'bag' }

export function hasLook() {
  try {
    return !!localStorage.getItem(LOOK_KEY)
  } catch {
    return false
  }
}

export function readLook() {
  try {
    return { ...DEFAULT_LOOK, ...JSON.parse(localStorage.getItem(LOOK_KEY) || '{}') }
  } catch {
    return { ...DEFAULT_LOOK }
  }
}

export function saveLook(look) {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look))
  } catch {
    // 저장이 막히면 이번 방문 동안만
  }
  cache.clear()
  window.dispatchEvent(new CustomEvent('look:change', { detail: look }))
}

// 앞모습. O 테두리 · S 피부 · E 눈 · T 윗옷 · B 바지 · F 신발 · (머리·모자는 따로 덮는다)
const FRONT = [
  '................',
  '................',
  '.....OOOOOO.....',
  '....OSSSSSSO....',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '...OSESSSSESO...',
  '...OSSSSSSSSO...',
  '...OSSSMMSSSO...',
  '....OSSSSSSO....',
  '....OOTTTTOO....',
  '...OTTTTTTTTO...',
  '..OSOTTTTTTOSO..',
  '..OSOTTTTTTOSO..',
  '..OSOTTTTTTOSO..',
  '..OOOTTTTTTOOO..',
  '....OBBBBBBO....',
  '....OBBBBBBO....',
  '....OBBOOBBO....',
  '....OBBOOBBO....',
  '....OFFOOFFO....',
  '....OOO..OOO....',
]
// 옆모습(오른쪽을 본다). 왼쪽은 좌우를 뒤집는다
const SIDE = [
  '................',
  '................',
  '.....OOOOOO.....',
  '....OSSSSSSO....',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '...OSSSSSSSSO...',
  '...OSSSSSSESO...',
  '...OSSSSSSSSSO..',
  '...OSSSSSSSMO...',
  '....OSSSSSSO....',
  '.....OTTTTO.....',
  '....OTTTTTTO....',
  '....OTTSSTTO....',
  '....OTTSSTTO....',
  '....OTTTTTTO....',
  '....OOTTTTOO....',
  '.....OBBBBO.....',
  '.....OBBBBO.....',
  '.....OBBBBO.....',
  '.....OBBBBO.....',
  '.....OFFFFFO....',
  '.....OOOOOOO....',
]
// 다리 두 박자: 앞·뒤모습은 한쪽 다리를 짧게, 옆모습은 다리를 벌린다
const LEGS_FRONT = [
  ['....OBBOOBBO....', '....OBBOOBBO....', '....OFFOOFFO....', '....OOO..OOO....'],
  ['....OBBOOBBO....', '....OFFOOBBO....', '....OOOOOFFO....', '.........OOO....'],
  ['....OBBOOBBO....', '....OBBOOFFO....', '....OFFOOOOO....', '....OOO.........'],
]
const LEGS_SIDE = [
  ['.....OBBBBO.....', '.....OBBBBO.....', '.....OFFFFFO....', '.....OOOOOOO....'],
  ['....OBBOOBBO....', '...OBBO..OBBO...', '...OFFO..OFFFO..', '...OOOO..OOOOO..'],
]

const OUT = '#1b1622'
const EYE = '#1b1622'
const MOUTH = '#c0605a'

const cache = new Map()

function dark(hex, f = 0.72) {
  const n = parseInt(hex.slice(1), 16)
  const c = (s) => Math.round(((n >> s) & 255) * f)
  return `rgb(${c(16)},${c(8)},${c(0)})`
}

function light(hex, f = 0.35) {
  const n = parseInt(hex.slice(1), 16)
  const c = (s) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * f)
  return `rgb(${c(16)},${c(8)},${c(0)})`
}

// dir: 0 앞 · 1 뒤 · 2 왼쪽 · 3 오른쪽, frame: 0 서기 · 1·2 걷기
function sprite(look, dir, frame) {
  const key = `${JSON.stringify(look)}|${dir}|${frame}`
  if (cache.has(key)) return cache.get(key)
  const side = dir >= 2
  const rows = (side ? SIDE : FRONT).slice()
  const legs = side ? LEGS_SIDE[frame ? 1 : 0] : LEGS_FRONT[frame]
  for (let j = 0; j < 4; j++) rows[20 + j] = legs[j]
  const g = rows.map((r) => [...r])
  const skin = SKINS[look.skin] || SKINS[0]
  const hair = HAIRS[look.hair] || HAIRS[0]
  const top = TOPS[look.top] || TOPS[0]
  const bottom = BOTTOMS[look.bottom] || BOTTOMS[0]
  const col = { O: OUT, S: skin, E: EYE, M: MOUTH, T: top, B: bottom, F: '#3b2b22' }
  const put = (x, y, c) => {
    if (y < 0 || y >= 24 || x < 0 || x >= 16) return
    g[y][x] = c
  }
  // 뒷모습: 얼굴 대신 머리카락
  if (dir === 1) for (let y = 3; y <= 10; y++) for (let x = 4; x <= 11; x++) if (g[y][x] !== 'O' && g[y][x] !== '.') put(x, y, 'H')
  // 머리 모양
  const st = look.hairStyle
  for (let x = 4; x <= 11; x++) put(x, 3, 'H')
  for (let x = 4; x <= 11; x++) put(x, 4, 'H')
  if (!side) {
    for (let x = 4; x <= 11; x++) if (x < 6 || x > 9 || st !== 'short') put(x, 5, 'H')
    put(4, 6, 'H'), put(11, 6, 'H')
  } else {
    for (let x = 4; x <= 8; x++) put(x, 5, 'H')
    for (let y = 5; y <= 8; y++) put(4, y, 'H'), put(5, y, 'H')
  }
  if (st === 'long' || st === 'bob') {
    const end = st === 'long' ? 14 : 11
    for (let y = 6; y <= end; y++) {
      if (!side || dir === 1) put(3, y, 'H'), put(12, y, 'H'), put(2, y, 'O'), put(13, y, 'O')
      else put(3, y, 'H'), put(2, y, 'O')
    }
  }
  if (st === 'spiky') for (const x of [4, 6, 8, 10]) put(x, 2, 'H'), put(x + 1, 1, 'O'), put(x, 1, 'O')
  if (st === 'bun') for (let x = 6; x <= 9; x++) put(x, 1, 'H'), put(x, 0, 'O')
  col.H = hair
  // 모자
  if (look.hat !== 'none') {
    const hc = look.hat === 'helmet' ? look.hatColor || '#ffcf3a' : look.hat === 'beanie' ? dark(top, 0.85) : top
    col.A = hc
    col.a = dark(hc)
    for (let y = 1; y <= 4; y++) for (let x = 4; x <= 11; x++) put(x, y, 'A')
    for (let x = 5; x <= 10; x++) put(x, 0, 'O')
    put(3, 1, 'O'), put(12, 1, 'O'), put(4, 0, 'O'), put(11, 0, 'O')
    if (look.hat === 'helmet') {
      for (let x = 3; x <= 12; x++) put(x, 5, 'a')
      if (!side || dir === 1) put(7, 2, 'a'), put(8, 2, 'a')
    } else if (look.hat === 'cap') {
      if (dir === 0) for (let x = 3; x <= 12; x++) put(x, 5, 'a')
      if (dir === 3) for (let x = 9; x <= 14; x++) put(x, 5, 'a')
      if (dir === 2) for (let x = 1; x <= 6; x++) put(x, 5, 'a')
    } else for (let x = 4; x <= 11; x++) put(x, 4, 'a')
  }
  if (look.extra === 'glasses' && dir !== 1) {
    col.G = '#1b1622'
    if (side) [8, 9, 10].forEach((x) => put(x, 8, 'G'))
    else [4, 5, 6, 9, 10, 11].forEach((x) => put(x, 8, 'G')), put(7, 8, 'G'), put(8, 8, 'G')
  }
  if (look.extra === 'bag') {
    col.K = '#8a5a2b'
    if (dir === 1) for (let y = 13; y <= 16; y++) for (let x = 6; x <= 9; x++) put(x, y, 'K')
    else if (dir === 0) [13, 14, 15, 16].forEach((y) => put(5 + (y - 13), y, 'K'))
    else for (let y = 13; y <= 16; y++) put(dir === 3 ? 4 : 11, y, 'K'), put(dir === 3 ? 5 : 10, y, 'K')
  }
  // 명암: 윗옷·바지는 오른쪽 가장자리를 어둡게, 머리는 정수리에 빛, 앞모습은 볼 터치
  col.t = dark(top, 0.78)
  col.b = dark(bottom, 0.75)
  col.h = light(hair)
  col.c = '#f08a7a'
  for (let y = 0; y < 24; y++) {
    for (let x = 1; x < 15; x++) {
      const k = g[y][x]
      if ((k === 'T' || k === 'B') && g[y][x + 1] === 'O') g[y][x] = k.toLowerCase()
    }
  }
  if (look.hat === 'none') for (const x of side ? [6, 7] : [5, 6]) if (g[3][x] === 'H') g[3][x] = 'h'
  if (dir === 0) for (const x of [4, 11]) if (g[9][x] === 'S') g[9][x] = 'c'
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 24
  const x2 = c.getContext('2d')
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 16; x++) {
      const k = g[y][x]
      if (k === '.') continue
      x2.fillStyle = col[k] || OUT
      x2.fillRect(dir === 2 ? 15 - x : x, y, 1, 1)
    }
  }
  // 밤에 쓰는 흰 테두리 판
  const glow = document.createElement('canvas')
  glow.width = 18
  glow.height = 26
  const gx = glow.getContext('2d')
  for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) gx.drawImage(c, dx, dy)
  gx.globalCompositeOperation = 'source-in'
  gx.fillStyle = '#fff6d8'
  gx.fillRect(0, 0, 18, 26)
  const out = { c, glow }
  cache.set(key, out)
  return out
}

// (x, y) 는 발밑 가운데. scale 은 픽셀 한 칸의 화면 크기
export function drawAvatar(ctx, look, x, y, { scale = 2, dir = 0, frame = 0, night = false, shadow = true } = {}) {
  const s = sprite(look, dir, frame)
  const w = 16 * scale
  const h = 24 * scale
  const left = Math.round(x - w / 2)
  const top = Math.round(y - h)
  const smooth = ctx.imageSmoothingEnabled
  ctx.imageSmoothingEnabled = false
  if (shadow) {
    ctx.fillStyle = 'rgba(10, 10, 20, 0.3)'
    ctx.beginPath()
    ctx.ellipse(x, y - scale * 0.5, 5.5 * scale, 1.6 * scale, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  if (night) ctx.drawImage(s.glow, left - scale, top - scale, 18 * scale, 26 * scale)
  ctx.drawImage(s.c, left, top, w, h)
  ctx.imageSmoothingEnabled = smooth
}

// 이미지 한 장(그림 태그·아이콘용)
export function avatarURL(look, { scale = 4, dir = 0, frame = 0 } = {}) {
  const c = document.createElement('canvas')
  c.width = 16 * scale
  c.height = 24 * scale
  drawAvatar(c.getContext('2d'), look, c.width / 2, c.height, { scale, dir, frame, shadow: false })
  return c.toDataURL()
}
