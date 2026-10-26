// 2D 거리 땅·나무 타일: Kenney Tiny Town(CC0) 풀·흙길·나무 그림을 칸마다 입힌다
// 땅 버퍼를 한 번만 칠하므로 매 프레임 드는 값은 없다. 물·돌·그루터기는 같은 팔레트로 직접 찍는다
import atlasUrl from '../assets/tiles/tinytown-nature.png'
import { GROUND_ID } from './textures.js'

let atlas = null
let atlasPx = null
let loading = null
const sprites = {}

export const tilesReady = () => !!atlas

export function loadTileset() {
  loading ??= new Promise((res) => {
    const img = new Image()
    img.onload = () => {
      atlas = img
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const x = c.getContext('2d')
      x.drawImage(img, 0, 0)
      atlasPx = x.getImageData(0, 0, img.width, img.height)
      buildSprites()
      res(img)
    }
    img.onerror = () => res(null)
    img.src = atlasUrl
  })
  return loading
}

const rgb = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}
const hex6 = (d, o) => '#' + [d[o], d[o + 1], d[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')

// 아틀라스 한 조각을 캔버스로. swap: 색 바꾸기 { '#84c669': '#f6b8cc' }, 'clear' 로 바꾸면 투명
function cut(sx, sy, w, h, swap = null) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const x = c.getContext('2d')
  x.drawImage(atlas, sx, sy, w, h, 0, 0, w, h)
  if (swap) {
    const d = x.getImageData(0, 0, w, h)
    const map = Object.fromEntries(Object.entries(swap).filter(([, b]) => b !== 'clear').map(([a, b]) => [a, rgb(b)]))
    for (let o = 0; o < d.data.length; o += 4) {
      if (d.data[o + 3] < 128) continue
      const key = hex6(d.data, o)
      if (swap[key] === 'clear') d.data[o + 3] = 0
      else if (map[key]) [d.data[o], d.data[o + 1], d.data[o + 2]] = map[key]
    }
    x.putImageData(d, 0, 0)
  }
  return c
}

// 글자 한 개 = 점 한 개인 작은 그림
function dots(rows, pal) {
  const c = document.createElement('canvas')
  c.width = rows[0].length
  c.height = rows.length
  const x = c.getContext('2d')
  rows.forEach((row, y) => {
    for (let i = 0; i < row.length; i++) {
      if (!pal[row[i]]) continue
      x.fillStyle = pal[row[i]]
      x.fillRect(i, y, 1, 1)
    }
  })
  return c
}

const OUT = '#3f2631'
const LEAF = '#84c669'
const LEAF_D = '#479f4a'
// 잎 색 묶음: [밝은 잎, 어두운 잎]
const LEAVES = {
  green: null,
  spring: ['#a8d86a', '#6fae4a'],
  pink: ['#f6b8cc', '#d77f9f'],
  winter: ['#a7ad92', '#7b8470'],
}

function buildSprites() {
  for (const [name, pal] of Object.entries(LEAVES)) {
    const swap = pal ? { [LEAF]: pal[0], [LEAF_D]: pal[1] } : null
    sprites[name] = {
      tall: cut(64, 0, 16, 32, swap),
      small: cut(64, 32, 16, 16, swap),
      bush: cut(80, 0, 16, 16, swap),
    }
  }
  sprites.orange = { tall: cut(48, 0, 16, 32), small: cut(48, 32, 16, 16), bush: cut(80, 0, 16, 16, { [LEAF]: '#fdbe53', [LEAF_D]: '#e38628' }) }
  const bg = { [LEAF]: 'clear' }
  sprites.tuft = cut(18, 1, 5, 4, bg)
  // 꽃: 노랑(원래) · 파랑 · 분홍 · 보라
  sprites.flowers = [
    cut(33, 1, 6, 7, bg),
    cut(33, 1, 6, 7, { ...bg, '#fdbe53': '#7fb4ff', '#e38628': '#3f6fd8' }),
    cut(33, 1, 6, 7, { ...bg, '#fdbe53': '#ffb3c9', '#e38628': '#e0608a' }),
    cut(33, 1, 6, 7, { ...bg, '#fdbe53': '#c9a2ff', '#e38628': '#8656d8' }),
  ]
  sprites.shroom = cut(80 + 9, 32 + 7, 7, 7)
  sprites.shroomBig = cut(80, 32 + 2, 10, 11)
  sprites.sprout = cut(80, 16 + 2, 9, 12)
  const P = { o: OUT, a: '#e4ebf5', b: '#c0cbdc', c: '#8d98ad' }
  sprites.rock = dots([
    '..oooo..',
    '.oaabbo.',
    'oabbbbco',
    'obbbbcco',
    '.occcco.',
    '..oooo..',
  ], P)
  sprites.pebble = dots([
    '.ooo.',
    'oabbo',
    'obcco',
    '.ooo.',
  ], P)
  sprites.stump = dots([
    '.oooooo.',
    'oeffffeo',
    'ofeggefo',
    'oeffffeo',
    'ohhhhhho',
    'ohihhiho',
    '.oooooo.',
  ], { o: OUT, e: '#cf8254', f: '#eaa56c', g: '#bd6c4a', h: '#8f563b', i: '#6e3f2e' })
  sprites.bench = dots([
    'oooooooooo',
    'offffffffo',
    'oggggggggo',
    'oooooooooo',
    '.oh....ho.',
    '.oo....oo.',
  ], { o: OUT, f: '#eaa56c', g: '#bd6c4a', h: '#8f563b' })
}

// 정수 해시 · 값 잡음(0..1)
function h2(x, y) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}
function vnoise(x, y, s) {
  const gx = Math.floor(x / s)
  const gy = Math.floor(y / s)
  const fx = x / s - gx
  const fy = y / s - gy
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const a = h2(gx, gy) / 4294967296
  const b = h2(gx + 1, gy) / 4294967296
  const c = h2(gx, gy + 1) / 4294967296
  const d = h2(gx + 1, gy + 1) / 4294967296
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

// 풀·물 얼룩은 256px 마다 되풀이되는 잡음 판을 한 번 만들어 두고 읽는다 (칠할 때 매 점 계산하지 않게)
let noiseMap = null
function noiseAt(x, y) {
  if (!noiseMap) {
    noiseMap = new Float32Array(256 * 256)
    // 이음매가 안 보이게 주기를 256 의 약수로 맞춘 잡음
    const wrap = (x, y, s) => {
      const p = 256 / s
      const gx = Math.floor(x / s)
      const gy = Math.floor(y / s)
      const fx = x / s - gx
      const fy = y / s - gy
      const u = fx * fx * (3 - 2 * fx)
      const v = fy * fy * (3 - 2 * fy)
      const L = (a, b) => h2(((a % p) + p) % p, ((b % p) + p) % p) / 4294967296
      const a = L(gx, gy)
      const b = L(gx + 1, gy)
      const c = L(gx, gy + 1)
      const d = L(gx + 1, gy + 1)
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
    }
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) noiseMap[y * 256 + x] = wrap(x, y, 16) * 0.7 + wrap(x, y, 4) * 0.3
  }
  return noiseMap[(y & 255) * 256 + (x & 255)]
}

const C_GRASS = [rgb('#84c669'), rgb('#7bbd61'), rgb('#8ccd70'), rgb('#74b65b')]
const C_RIM = rgb('#5f9f50')
const C_PITCH = [rgb('#74ba62'), rgb('#6aae59'), rgb('#62a453')]
const C_WATER = [rgb('#4f9fe3'), rgb('#4592d8'), rgb('#8fcdf5'), rgb('#d4f0ff')]
const C_PAVE = [rgb('#ddd6c6'), rgb('#e1dacb'), rgb('#d1c9b7'), rgb('#d8d0bf')]
const C_WALK = [rgb('#dcc6a4'), rgb('#e0caa9'), rgb('#ccb491'), rgb('#d6c09e')]

// 땅 칠하기: paintGround 가 그린 찻길·횡단보도·주차장·철길은 두고, 풀·물·보도·흙길만 타일로 덮는다
export function paintTiles(layer, grid, { treeCells = new Set(), cell = 8 } = {}) {
  if (!atlasPx) return
  const { N, ground, height } = grid
  const C = cell
  const ctx = layer.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const Wd = N * C
  const img = ctx.getImageData(0, 0, Wd, Wd)
  const d = img.data
  const A = atlasPx.data
  const AW = atlasPx.width
  const G = GROUND_ID
  const g = (i, k) => (i < 0 || k < 0 || i >= N || k >= N ? -1 : ground[k * N + i])
  const green = (v) => v === G.grass || v === G.campus || v === G.pitch
  // 공원 속 오솔길만 흙길로: 둘레 7×7 안에 풀이 넉넉하면
  const sum = new Int32Array((N + 1) * (N + 1))
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      sum[(k + 1) * (N + 1) + i + 1] = (green(ground[k * N + i]) ? 1 : 0) + sum[k * (N + 1) + i + 1] + sum[(k + 1) * (N + 1) + i] - sum[k * (N + 1) + i]
    }
  }
  const greenAround = (i, k, r) => {
    const i0 = Math.max(0, i - r)
    const k0 = Math.max(0, k - r)
    const i1 = Math.min(N, i + r + 1)
    const k1 = Math.min(N, k + r + 1)
    return sum[k1 * (N + 1) + i1] - sum[k0 * (N + 1) + i1] - sum[k1 * (N + 1) + i0] + sum[k0 * (N + 1) + i0]
  }
  const dirt = new Uint8Array(N * N)
  for (let c = 0; c < N * N; c++) if (ground[c] === G.path && greenAround(c % N, (c / N) | 0, 3) >= 12) dirt[c] = 1
  const isDirt = (i, k) => i >= 0 && k >= 0 && i < N && k < N && dirt[k * N + i] === 1
  const put = (o, col) => {
    d[o] = col[0]
    d[o + 1] = col[1]
    d[o + 2] = col[2]
    d[o + 3] = 255
  }

  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      const c = k * N + i
      const t = ground[c]
      const x0 = i * C
      const y0 = k * C
      if (t === G.grass || t === G.campus || t === G.pitch) {
        // 풀이 아닌 쪽 테두리는 한 줄 진하게 (흙길 쪽은 흙길 타일이 가장자리를 그린다)
        const edge = (v, ii, kk) => !green(v) && !isDirt(ii, kk) && v >= 0
        const eT = edge(g(i, k - 1), i, k - 1)
        const eB = edge(g(i, k + 1), i, k + 1)
        const eL = edge(g(i - 1, k), i - 1, k)
        const eR = edge(g(i + 1, k), i + 1, k)
        for (let y = 0; y < C; y++) {
          for (let x = 0; x < C; x++) {
            const px = x0 + x
            const py = y0 + y
            const o = (py * Wd + px) * 4
            if ((eT && y === 0) || (eB && y === C - 1) || (eL && x === 0) || (eR && x === C - 1)) {
              put(o, C_RIM)
              continue
            }
            const n = noiseAt(px, py)
            if (t === G.pitch) {
              // 운동장 잔디: 깎은 줄무늬에 얼룩을 조금
              const band = ((px / (C * 3)) | 0) % 2
              put(o, n > 0.82 ? C_PITCH[2] : C_PITCH[band])
              continue
            }
            put(o, h2(px, py) % 89 === 0 ? C_GRASS[3] : n > 0.64 ? C_GRASS[1] : n < 0.3 ? C_GRASS[2] : C_GRASS[0])
          }
        }
      } else if (t === G.water) {
        const shore = (v) => v !== G.water && v >= 0
        const sT = shore(g(i, k - 1))
        const sB = shore(g(i, k + 1))
        const sL = shore(g(i - 1, k))
        const sR = shore(g(i + 1, k))
        for (let y = 0; y < C; y++) {
          for (let x = 0; x < C; x++) {
            const px = x0 + x
            const py = y0 + y
            const o = (py * Wd + px) * 4
            const dEdge = Math.min(sT ? y : 9, sB ? C - 1 - y : 9, sL ? x : 9, sR ? C - 1 - x : 9)
            if (dEdge === 0) put(o, C_WATER[3])
            else if (dEdge === 1) put(o, C_WATER[2])
            else put(o, noiseAt(px + 97, py + 41) > 0.6 ? C_WATER[1] : C_WATER[0])
          }
        }
      } else if (dirt[c]) {
        // 흙길: 3×3 흙 조각 타일을 반 칸씩 잘라 풀 쪽 가장자리를 맞춘다
        const gL = green(g(i - 1, k))
        const gR = green(g(i + 1, k))
        const gT = green(g(i, k - 1))
        const gB = green(g(i, k + 1))
        const half = C >> 1
        for (let y = 0; y < C; y++) {
          let row
          let sy
          if (gT && gB) [row, sy] = y < half ? [0, y] : [2, 16 - C + y]
          else if (gT) [row, sy] = [0, y]
          else if (gB) [row, sy] = [2, 16 - C + y]
          else [row, sy] = [1, (k % 2) * (16 - C) + y]
          for (let x = 0; x < C; x++) {
            let col
            let sx
            if (gL && gR) [col, sx] = x < half ? [0, x] : [2, 16 - C + x]
            else if (gL) [col, sx] = [0, x]
            else if (gR) [col, sx] = [2, 16 - C + x]
            else [col, sx] = [1, (i % 2) * (16 - C) + x]
            const ax = col * 16 + sx
            const ay = 16 + row * 16 + sy
            const ao = (ay * AW + ax) * 4
            const o = ((y0 + y) * Wd + x0 + x) * 4
            d[o] = A[ao]
            d[o + 1] = A[ao + 1]
            d[o + 2] = A[ao + 2]
            d[o + 3] = 255
          }
        }
      } else if (t === G.pave || t === G.path) {
        // 보도: 칸마다 판석 한 장. 위·왼쪽 줄눈만 옅게, 판석마다 밝기를 조금씩 달리한다
        const P = t === G.pave ? C_PAVE : C_WALK
        const tint = h2(i, k) % 7
        const base = tint === 0 ? P[3] : tint === 1 ? P[1] : P[0]
        for (let y = 0; y < C; y++) {
          for (let x = 0; x < C; x++) {
            const px = x0 + x
            const py = y0 + y
            const o = (py * Wd + px) * 4
            if (x === 0 || y === 0) put(o, P[2])
            else put(o, h2(px, py) % 41 === 0 ? P[2] : base)
          }
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0)

  // 꾸밈: 풀숲에 풀포기·꽃·버섯·돌, 물에 반짝이는 물결, 흙길 옆 벤치
  const open = (i, k) => {
    for (let dk = -1; dk <= 1; dk++) {
      for (let di = -1; di <= 1; di++) {
        const v = g(i + di, k + dk)
        if (v !== G.grass && v !== G.campus) return false
        const cc = (k + dk) * N + i + di
        if (height[cc] || treeCells.has(cc)) return false
      }
    }
    return true
  }
  const stamp = (s, i, k, ox, oy) => ctx.drawImage(s, i * C + ox, k * C + oy)
  for (let k = 1; k < N - 1; k++) {
    for (let i = 1; i < N - 1; i++) {
      const c = k * N + i
      const t = ground[c]
      const hv = h2(i * 7 + 3, k * 13 + 5)
      const r = hv % 1000
      const ox = (hv >>> 10) % 4 - 1
      const oy = (hv >>> 14) % 4 - 1
      if (t === G.water) {
        if (r < 70 && g(i - 1, k) === G.water && g(i + 1, k) === G.water && g(i, k - 1) === G.water && g(i, k + 1) === G.water) {
          ctx.fillStyle = '#8fcdf5'
          ctx.fillRect(i * C + 1 + ox, k * C + 3 + oy, 5, 1)
          ctx.fillStyle = '#d4f0ff'
          ctx.fillRect(i * C + 2 + ox, k * C + 3 + oy, 2, 1)
        }
        continue
      }
      if (!open(i, k)) {
        // 공원 흙길 바로 옆 풀밭에 가끔 벤치
        if ((t === G.grass || t === G.campus) && !height[c] && !treeCells.has(c) && r < 25 && isDirt(i, k + 1) && open(i, k - 1)) stamp(sprites.bench, i, k, -1, 2)
        continue
      }
      // 꽃밭: 낮은 잡음이 높은 곳에 꽃이 모여 핀다
      const meadow = vnoise(i, k, 9)
      const flowerP = meadow > 0.66 ? 160 : meadow > 0.5 ? 40 : 12
      if (r < flowerP) {
        const kind = meadow > 0.8 ? 1 : (hv >>> 18) % 4
        stamp(sprites.flowers[kind], i, k, ox, oy)
      } else if (r < flowerP + 70) stamp(sprites.tuft, i, k, ox + 1, oy + 2)
      else if (r < flowerP + 78) stamp(sprites.pebble, i, k, ox + 1, oy + 2)
      else if (r < flowerP + 82) stamp(sprites.rock, i, k, ox, oy + 1)
      else if (r < flowerP + 85) stamp(sprites.shroom, i, k, ox, oy)
      else if (r < flowerP + 87) stamp(sprites.stump, i, k, ox, oy)
      else if (r < flowerP + 89) stamp(sprites.sprout, i, k, ox - 1, oy - 4)
    }
  }
}

// 공원 풀밭에 덤불·작은 숲을 더 심는다: 낮은 잡음이 높은 곳에 모여 자라고, 풀밭 가장자리와 길은 비워 둔다
// 돌려준 칸은 나무처럼 막힌 칸으로 쓴다
export function plantGrove(grid, taken = new Set()) {
  const { N, ground, height } = grid
  const G = GROUND_ID
  const soft = (c) => (ground[c] === G.grass || ground[c] === G.campus) && !height[c]
  const out = []
  const used = new Set(taken)
  for (let k = 3; k < N - 3; k++) {
    for (let i = 3; i < N - 3; i++) {
      const c = k * N + i
      if (!soft(c) || used.has(c)) continue
      const wood = vnoise(i + 500, k + 500, 14)
      const p = wood > 0.7 ? 0.22 : wood > 0.58 ? 0.07 : 0.008
      if (h2(i * 5 + 1, k * 3 + 2) / 4294967296 > p) continue
      let ok = true
      for (let dk = -2; dk <= 2 && ok; dk++) {
        for (let di = -2; di <= 2; di++) {
          const cc = c + dk * N + di
          if (!soft(cc)) { ok = false; break }
          if (Math.abs(di) <= 1 && Math.abs(dk) <= 1 && used.has(cc)) { ok = false; break }
        }
      }
      if (!ok) continue
      used.add(c)
      out.push([i, k])
    }
  }
  return out
}

// 계절에 따른 잎 묶음 고르기 (상록 큰 나무는 늘 푸르다)
function leafSet(month, hv) {
  if (month === 10) return hv % 3 ? 'green' : 'orange'
  if (month === 11) return hv % 3 ? 'orange' : 'green'
  if (month === 12 || month <= 2) return 'winter'
  if (month === 4) return 'pink'
  if (month === 3) return 'spring'
  return 'green'
}

// 나무: 위쪽 줄부터 차례로 찍어 아래 나무가 위 나무를 가린다. 밑동은 칸 아래쪽 가운데
export function paintTreeSprites(layer, trees, { cell = 8, month = new Date().getMonth() + 1 } = {}) {
  if (!atlas) return false
  const C = cell
  const ctx = layer.getContext('2d')
  ctx.imageSmoothingEnabled = false
  const list = [...trees].sort((a, b) => a[1] - b[1] || a[0] - b[0])
  for (const [i, k] of list) {
    const hv = h2(i * 31 + 7, k * 17 + 11)
    const shape = hv % 10 < 5 ? 'tall' : hv % 10 < 8 ? 'small' : 'bush'
    let set = leafSet(month, hv >>> 8)
    // 큰 나무는 상록수라 늘 푸르다 (가을엔 셋 중 하나만 물든다)
    if (shape === 'tall' && (set === 'winter' || set === 'pink' || (set === 'orange' && (hv >>> 12) % 3))) set = 'green'
    const s = sprites[set][shape]
    const cx = i * C + (C >> 1)
    const foot = (k + 1) * C
    // 오른쪽 아래로 드리운 그림자 (건물 그림자와 같은 방향)
    ctx.fillStyle = 'rgba(28, 32, 52, 0.24)'
    const sw = shape === 'tall' ? 6 : 5
    ctx.fillRect(cx - sw + 3, foot - 2, sw * 2, 1)
    ctx.fillRect(cx - sw + 2, foot - 1, sw * 2 + 2, 2)
    ctx.fillRect(cx - sw + 3, foot + 1, sw * 2, 1)
    ctx.drawImage(s, cx - 8, foot - s.height + (shape === 'bush' ? 1 : 1))
  }
  return true
}
