// 간판 거리 2D: 위에서 내려다본 동네를 칸마다 CELL px 로 한 번 그려 둔다
import { B } from '../../world/build.js'
import { GROUND_ID } from '../../world/textures.js'

export const CELL = 8

const GROUND_COLOR = ['#ddd6c6', '#5d606a', '#d9bf9f', '#93c46f', '#5f9edb', '#62ad5c', '#8d8f96', '#8f877c', '#a3cf7f', '#5d606a']
// 벽 번호(textures.js WALLS) → 지붕 색. 밝은 보도와 확실히 갈리게 진하고 따뜻하게
const ROOF = ['#8a6f62', '#9b7d5d', '#a4553f', '#6f7f8f', '#8c7a5c', '#7d6a58', '#5f7896', '#7a8aa0', '#9a8f80', '#857b70', '#a07d48', '#8d4a3c', '#7c705e', '#6e6152', '#7f98ad', '#8b7666']

const hash = (i, k) => (((i * 73856093) ^ (k * 19349663)) >>> 0) % 997

const shades = new Map()
export function shade(hex, f) {
  const key = hex + f
  if (!shades.has(key)) {
    const n = Number.parseInt(hex.slice(1), 16)
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)))
    shades.set(key, `rgb(${ch(n >> 16)} ${ch((n >> 8) & 255)} ${ch(n & 255)})`)
  }
  return shades.get(key)
}

export function makeLayer(N) {
  const c = document.createElement('canvas')
  c.width = N * CELL
  c.height = N * CELL
  return c
}

// 땅: 보도 타일, 잔디 풀, 물결, 주차선, 횡단보도, 찻길 차선
export function paintGround(layer, grid, world) {
  const { N, half, ground } = grid
  const ctx = layer.getContext('2d')
  const g = (i, k) => (i < 0 || k < 0 || i >= N || k >= N ? -1 : ground[k * N + i])
  const roadish = (v) => v === GROUND_ID.road || v === GROUND_ID.cross
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      const t = ground[k * N + i]
      const h = hash(i, k)
      const x = i * CELL
      const y = k * CELL
      ctx.fillStyle = shade(GROUND_COLOR[t] || GROUND_COLOR[0], 1 + ((h % 7) - 3) * 0.008)
      ctx.fillRect(x, y, CELL, CELL)
      if (t === GROUND_ID.pave || t === GROUND_ID.path) {
        ctx.fillStyle = shade(GROUND_COLOR[t], 0.94)
        ctx.fillRect(x, y, CELL, 1)
        ctx.fillRect(x, y, 1, CELL)
      } else if (t === GROUND_ID.grass || t === GROUND_ID.campus || t === GROUND_ID.pitch) {
        ctx.fillStyle = shade(GROUND_COLOR[t], 0.86)
        if (h % 3 === 0) ctx.fillRect(x + (h % 6), y + ((h >> 2) % 6), 1, 2)
        if (h % 5 === 0) ctx.fillRect(x + ((h >> 3) % 6) + 1, y + (h % 5) + 2, 1, 2)
      } else if (t === GROUND_ID.water) {
        ctx.fillStyle = shade(GROUND_COLOR[t], 1.12)
        if (h % 4 === 0) ctx.fillRect(x + (h % 5), y + ((h >> 2) % 7), 3, 1)
      } else if (t === GROUND_ID.parking) {
        if (i % 3 === 0) {
          ctx.fillStyle = '#e8e8e8'
          ctx.fillRect(x, y + 1, 1, CELL - 2)
        }
      } else if (t === GROUND_ID.rail) {
        ctx.fillStyle = '#6e6052'
        ctx.fillRect(x, y + 2, CELL, 1)
        ctx.fillRect(x, y + 6, CELL, 1)
      }
      // 찻길 가장자리 연석
      if (t === GROUND_ID.road) {
        ctx.fillStyle = '#9b9a95'
        if (!roadish(g(i, k - 1)) && g(i, k - 1) >= 0) ctx.fillRect(x, y, CELL, 1)
        if (!roadish(g(i, k + 1)) && g(i, k + 1) >= 0) ctx.fillRect(x, y + CELL - 1, CELL, 1)
        if (!roadish(g(i - 1, k)) && g(i - 1, k) >= 0) ctx.fillRect(x, y, 1, CELL)
        if (!roadish(g(i + 1, k)) && g(i + 1, k) >= 0) ctx.fillRect(x + CELL - 1, y, 1, CELL)
      }
    }
  }
  // 넓은 찻길 가운데 노란 중앙선, 좀 좁은 길은 흰 점선
  const px = (v) => (v / B + half) * CELL
  const py = (v) => (-v / B + half) * CELL
  ctx.lineCap = 'butt'
  for (const [kind, width, flat] of world.w) {
    if (kind !== 'road' || width < 7) continue
    ctx.strokeStyle = width >= 12 ? '#e9c44a' : 'rgba(255,255,255,0.7)'
    ctx.lineWidth = width >= 12 ? 1.5 : 1
    ctx.setLineDash(width >= 12 ? [] : [4, 4])
    ctx.beginPath()
    for (let p = 0; p + 1 < flat.length; p += 2) ctx[p ? 'lineTo' : 'moveTo'](px(flat[p]), py(flat[p + 1]))
    ctx.stroke()
  }
  ctx.setLineDash([])
  paintCrossings(ctx, grid, world, px, py, g, roadish)
}

// 횡단보도: 건너는 선을 따라 0.5m 굵기 흰 막대를 1m 간격으로, 막대는 찻길 방향으로 눕힌다
// 찻길 위에만 칠하고, 막대마다 조금씩 닳은 듯 밝기를 다르게 한다
function paintCrossings(ctx, grid, world, px, py, g, roadish) {
  const { half } = grid
  const onRoad = (x, y) => roadish(g(Math.floor(x / B + half), Math.floor(-y / B + half)))
  const S = CELL / B
  ctx.lineCap = 'butt'
  for (const [kind, width, flat] of world.w) {
    if (kind !== 'cross') continue
    const L = Math.max(3, Math.min(5, width || 4))
    for (let p = 0; p + 3 < flat.length; p += 2) {
      const ax = flat[p]
      const ay = flat[p + 1]
      const dx = flat[p + 2] - ax
      const dy = flat[p + 3] - ay
      const len = Math.hypot(dx, dy)
      if (len < 0.5) continue
      const ux = dx / len
      const uy = dy / len
      for (let d = 0.5; d < len; d += 1) {
        const cx = ax + ux * d
        const cy = ay + uy * d
        if (!onRoad(cx, cy)) continue
        // 막대 양 끝이 인도로 삐져나가지 않게 줄인다
        let a = L / 2
        let b = L / 2
        while (a > 0.6 && !onRoad(cx - uy * a, cy + ux * a)) a -= 0.4
        while (b > 0.6 && !onRoad(cx + uy * b, cy - ux * b)) b -= 0.4
        const wear = hash(Math.round(cx * 7), Math.round(cy * 7)) % 5
        ctx.strokeStyle = `rgba(246, 245, 238, ${0.95 - wear * 0.05})`
        ctx.lineWidth = 0.5 * S
        ctx.beginPath()
        ctx.moveTo(px(cx - uy * a), py(cy + ux * a))
        ctx.lineTo(px(cx + uy * b), py(cy - ux * b))
        ctx.stroke()
      }
    }
  }
}

// 건물·그림자·나무. year 보다 늦게 지은 건물은 빼고(타임머신), 연도를 모르는 건물은 흐린 윤곽만
// lights 캔버스에는 밤에 켜질 창문을 따로 찍는다
export function paintBuildings(layer, lights, grid, { year = 9999, trees = [], leaf = '#3f8a3a' } = {}) {
  const { N, height, wall, owner } = grid
  const yearOf = grid.year
  const ctx = layer.getContext('2d')
  const lc = lights.getContext('2d')
  ctx.clearRect(0, 0, layer.width, layer.height)
  lc.clearRect(0, 0, lights.width, lights.height)
  const machine = year < 9999
  // 0 숨김 · 1 보임 · 2 연도 모름(유령)
  const show = new Uint8Array(N * N)
  for (let c = 0; c < N * N; c++) {
    if (!height[c]) continue
    const y = yearOf[owner[c]] || 0
    show[c] = !machine ? 1 : y ? (y <= year ? 1 : 0) : 2
  }
  const hOf = (i, k) => (i < 0 || k < 0 || i >= N || k >= N || show[k * N + i] !== 1 ? 0 : height[k * N + i])

  // 오른쪽 아래로 드리우는 그림자: 높을수록 길다
  ctx.fillStyle = 'rgba(28, 32, 52, 0.2)'
  const shadow = new Uint8Array(N * N)
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      const h = hOf(i, k)
      if (!h) continue
      const L = Math.min(7, Math.ceil(h / 5))
      for (let d = 1; d <= L; d++) {
        const ti = i + d
        const tk = k + d
        if (ti >= N || tk >= N) break
        if (hOf(ti, tk) >= h - d * 2) break
        shadow[tk * N + ti] = 1
        if (ti - 1 >= 0 && !hOf(ti - 1, tk)) shadow[tk * N + ti - 1] = 1
      }
    }
  }
  for (let c = 0; c < N * N; c++) if (shadow[c]) ctx.fillRect((c % N) * CELL, Math.floor(c / N) * CELL, CELL, CELL)

  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      const c = k * N + i
      const s = show[c]
      if (!s) continue
      const x = i * CELL
      const y = k * CELL
      const h = height[c]
      const o = owner[c]
      const base = ROOF[wall[c] % ROOF.length]
      const v = 1 + ((o * 37) % 9 - 4) * 0.012 + Math.min(0.08, h / 900)
      if (s === 2) {
        ctx.fillStyle = 'rgba(120, 130, 150, 0.18)'
        ctx.fillRect(x, y, CELL, CELL)
        ctx.fillStyle = 'rgba(80, 90, 110, 0.5)'
        if (owner[c - N] !== o) ctx.fillRect(x, y, CELL, 1)
        if (owner[c + N] !== o) ctx.fillRect(x, y + CELL - 1, CELL, 1)
        if (owner[c - 1] !== o) ctx.fillRect(x, y, 1, CELL)
        if (owner[c + 1] !== o) ctx.fillRect(x + CELL - 1, y, 1, CELL)
        continue
      }
      ctx.fillStyle = shade(base, v)
      ctx.fillRect(x, y, CELL, CELL)
      const same = (cc) => cc >= 0 && cc < N * N && owner[cc] === o && show[cc] === 1
      // 위·왼쪽 모서리는 밝게, 오른쪽은 어둡게
      ctx.fillStyle = shade(base, v * 1.1)
      if (!same(c - N)) ctx.fillRect(x, y, CELL, 1)
      if (!same(c - 1)) ctx.fillRect(x, y, 1, CELL)
      ctx.fillStyle = shade(base, v * 0.78)
      if (!same(c + 1)) ctx.fillRect(x + CELL - 1, y, 1, CELL)
      // 옥상 실외기
      const hh = hash(i, k)
      if (h > 6 && hh % 23 === 0 && same(c + 1) && same(c + N)) {
        ctx.fillStyle = '#e4e4e0'
        ctx.fillRect(x + 2, y + 2, 4, 3)
        ctx.fillStyle = '#9a9a96'
        ctx.fillRect(x + 3, y + 3, 2, 1)
      }
    }
  }

  paintFronts(ctx, lc, grid, show, hOf)

  // 나무: 작은 잎 뭉치 몇 개를 겹친 덩어리. 칸마다 모양이 조금씩 다르다
  const dark = shade(leaf, 0.7)
  const light = shade(leaf, 1.2)
  for (const [i, k] of trees) {
    const cx = (i + 0.5) * CELL
    const cy = (k + 0.5) * CELL
    let h = (i * 73856093) ^ (k * 19349663)
    const r = () => ((h = (h * 1103515245 + 12345) >>> 0) / 4294967296)
    const blobs = Array.from({ length: 5 }, (_, n) => {
      const a = (n / 5) * Math.PI * 2 + r()
      return [cx + Math.cos(a) * CELL * 0.55, cy + Math.sin(a) * CELL * 0.5, CELL * (0.5 + r() * 0.2)]
    })
    blobs.push([cx, cy, CELL * 0.7])
    ctx.fillStyle = 'rgba(28, 32, 52, 0.22)'
    for (const [x, y, rad] of blobs) {
      ctx.beginPath()
      ctx.arc(x + 3, y + 4, rad, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = dark
    for (const [x, y, rad] of blobs) {
      ctx.beginPath()
      ctx.arc(x, y, rad + 1, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = leaf
    for (const [x, y, rad] of blobs) {
      ctx.beginPath()
      ctx.arc(x - 0.5, y - 1, rad, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = light
    for (const [x, y, rad] of blobs.slice(0, 3)) ctx.fillRect(Math.round(x - rad * 0.5), Math.round(y - rad * 0.6), 2, 2)
  }
}

// 위에서 내려다본 작은 사람: 8×12 점. dir 0 아래 1 위 2 왼쪽 3 오른쪽
export function drawPerson(ctx, x, y, u, dir, step, look) {
  const r = (px, py, w, h, color) => {
    ctx.fillStyle = color
    ctx.fillRect(x + px * u, y + py * u, w * u, h * u)
  }
  ctx.fillStyle = 'rgba(20, 24, 40, 0.25)'
  ctx.beginPath()
  ctx.ellipse(x + 4 * u, y + 11.6 * u, 3.4 * u, 1.3 * u, 0, 0, Math.PI * 2)
  ctx.fill()
  const leg = step ? 1 : 0
  r(2, 8, 2, 3 + (dir < 2 ? leg : 0), look.pants)
  r(4, 8, 2, 3 + (dir < 2 ? 1 - leg : 0), look.pants)
  if (dir >= 2 && step) r(dir === 2 ? 1 : 5, 9, 2, 2, look.pants)
  r(1, 4, 6, 5, look.shirt)
  if (look.bag && dir !== 0) r(2, 4, 4, 4, look.bag)
  r(0, 5, 1, 3, look.skin)
  r(7, 5, 1, 3, look.skin)
  r(1, 0, 6, 5, look.skin)
  r(1, 0, 6, dir === 1 ? 5 : 2, look.hair)
  if (dir === 2) r(5, 0, 2, 4, look.hair)
  if (dir === 3) r(1, 0, 2, 4, look.hair)
  if (look.cap) {
    r(1, -1, 6, 2, look.cap)
    if (dir === 0) r(1, 1, 6, 1, look.cap)
    if (dir === 2) r(0, 1, 3, 1, look.cap)
    if (dir === 3) r(5, 1, 3, 1, look.cap)
  }
  if (dir === 0) {
    r(2, 3, 1, 1, '#1d1d2b')
    r(5, 3, 1, 1, '#1d1d2b')
  } else if (dir === 2) r(2, 3, 1, 1, '#1d1d2b')
  else if (dir === 3) r(5, 3, 1, 1, '#1d1d2b')
}

// 밤에 간판·창문 둘레를 밝히는 둥근 빛 (destination-out 으로 어둠에 구멍을 낸다)
export function glowSprite(size = 128) {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(0,0,0,1)')
  g.addColorStop(0.45, 'rgba(0,0,0,0.6)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return c
}

// 남쪽(화면 아래) 가장자리에 건물 앞면을 세운다: 1층 가게 유리·차양, 위로 창문 층. 바깥엔 진한 윤곽
const AWN = ['#ff004d', '#ffa300', '#29adff', '#00e436', '#ff77a8', '#ffec27']
function paintFronts(ctx, lc, grid, show, hOf) {
  const { N, height, wall, owner } = grid
  const same = (c, o) => c >= 0 && c < N * N && owner[c] === o && show[c] === 1
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      const c = k * N + i
      if (show[c] !== 1) continue
      const o = owner[c]
      const x = i * CELL
      const y = k * CELL
      const h = height[c]
      if (!same(c + N, o) && hOf(i, k + 1) < h) {
        // 앞면 깊이(칸): 낮으면 2칸, 높으면 4칸. 얕은 건물(3칸 미만)은 1칸만 세워 지붕이 남게
        let depth = 1
        while (depth < 6 && same(c - depth * N, o)) depth++
        const fd = depth < 3 ? 1 : Math.min(depth - 1, h < 10 ? 2 : h < 20 ? 3 : 4)
        const base = ROOF[wall[c] % ROOF.length]
        const hh = hash(i, k)
        for (let d = 0; d < fd; d++) {
          const yy = (k - d) * CELL
          ctx.fillStyle = shade(base, 0.62 + d * 0.03)
          ctx.fillRect(x, yy, CELL, CELL)
          if (d === 0) {
            // 1층 가게: 어두운 유리 + 문틀, 그 위 차양 줄무늬
            ctx.fillStyle = '#23283f'
            ctx.fillRect(x, yy + 3, CELL, CELL - 3)
            ctx.fillStyle = '#4b5878'
            ctx.fillRect(x + 1, yy + 4, CELL - 2, 1)
            lc.fillStyle = '#ffcf7a'
            lc.fillRect(x + 1, yy + 4, CELL - 2, CELL - 5)
            const aw = AWN[(o * 7) % AWN.length]
            ctx.fillStyle = aw
            ctx.fillRect(x, yy, CELL, 3)
            // 한 칸 걸러 어둡게 해서 줄무늬 차양
            ctx.fillStyle = shade(aw, 0.7)
            if (i % 2) ctx.fillRect(x, yy, CELL, 3)
          } else {
            for (let wx = x + 1; wx < x + CELL - 1; wx += 3) {
              ctx.fillStyle = '#3b4766'
              ctx.fillRect(wx, yy + 2, 2, 3)
              ctx.fillStyle = '#7f8fb0'
              ctx.fillRect(wx, yy + 2, 2, 1)
              if ((hh + wx * 3 + d * 7) % 5 < 3) {
                lc.fillStyle = (wx + d) % 2 ? '#ffd98a' : '#fff0c0'
                lc.fillRect(wx, yy + 2, 2, 3)
              }
            }
          }
        }
        // 앞면과 지붕 사이 난간(밝은 줄)
        const ty = (k - fd + 1) * CELL
        ctx.fillStyle = shade(base, 1.25)
        ctx.fillRect(x, ty - 2, CELL, 2)
      }
      // 바깥 윤곽: 건물이 땅과 갈리게 진한 1px
      ctx.fillStyle = '#2a2838'
      if (!same(c - N, o) && !hOf(i, k - 1)) ctx.fillRect(x, y, CELL, 1)
      if (!same(c + N, o)) ctx.fillRect(x, y + CELL - 1, CELL, 1)
      if (!same(c - 1, o) && !hOf(i - 1, k)) ctx.fillRect(x, y, 1, CELL)
      if (!same(c + 1, o) && !hOf(i + 1, k)) ctx.fillRect(x + CELL - 1, y, 1, CELL)
    }
  }
}
