<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DEFAULT_LOOK, drawAvatar } from '../../avatar.js'

// 건물 안: 옆에서 본 점프맵. 층마다 가게 문을 찾아가 간판을 고친다.
// 계단(경사)·엘리베이터로 오르내리고, 바닥 틈·발판·상자는 건물 이름으로 시드를 고정해 늘 같은 모양
const props = defineProps({
  building: { type: Object, required: true }, // { name, floors, basement }
  signs: { type: Array, default: () => [] }, // [{ id, name, cat, floor, color, lit }]
  look: { type: Object, default: null },
  target: { type: [String, Number], default: null },
  night: { type: Boolean, default: false },
})
const emit = defineEmits(['pick', 'exit'])

// 세계 단위: 캐릭터 한 칸 = 1. 화면에서는 Z 배로 키운다
const FH = 72 // 한 층 높이
const SLAB = 8 // 바닥판 두께
const SHOP_W = 112 // 가게 한 칸 폭
const SW = 104 // 계단칸 폭
const EW = 44 // 엘리베이터 폭
const LOBBY = 72 // 엘리베이터 옆 빈칸(1층은 출입문)
const WALL = 8
const HW = 5 // 몸 반폭
const PH = 22 // 키
const SPEED = 92
const JUMP_V = 250
const G = 900
const FALL_MAX = 420
const COYOTE = 0.1
const BUFFER = 0.12
const STEP_UP = 5
const STEP_DOWN = 7
const DT = 1 / 120
const FONT = 'Galmuri11, sans-serif'

const wrap = ref(null)
const cv = ref(null)
const hudFloor = ref('1층')
const panel = ref(null) // { from, sel }
const touch = ref(false)

// ── 시드 난수 ──
function seedOf(str) {
  let h = 2166136261
  for (const ch of str) {
    h ^= ch.codePointAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
function hashRnd(seed, a, b, c) {
  let t = (seed ^ Math.imul(a + 7, 374761393) ^ Math.imul(b + 13, 668265263) ^ Math.imul(c + 3, 2246822519)) >>> 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

// ── 색 ──
const probe = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
const rgbCache = new Map()
function rgbOf(css) {
  if (rgbCache.has(css)) return rgbCache.get(css)
  let out = [200, 80, 60]
  if (probe && css) {
    probe.fillStyle = '#c85040'
    probe.fillStyle = css
    const v = probe.fillStyle
    if (v[0] === '#') {
      const n = parseInt(v.slice(1), 16)
      out = [n >> 16, (n >> 8) & 255, n & 255]
    } else {
      const m = v.match(/[\d.]+/g)
      if (m) out = [+m[0], +m[1], +m[2]]
    }
  }
  rgbCache.set(css, out)
  return out
}
const rgb = (c) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const lum = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255

// ── 층 이름 ──
function normFloor(f) {
  const n = Math.trunc(Number(f))
  return !n ? 1 : n
}
const floorName = (L) => (L > 0 ? `${L}층` : `지하${-L}층`)
const floorShort = (L) => (L > 0 ? `${L}F` : `B${-L}`)

// ── 건물 만들기 ──
function buildWorld(b, signs) {
  let floors = clamp(Math.trunc(Number(b?.floors)) || 1, 1, 25)
  let basement = clamp(Math.trunc(Number(b?.basement)) || 0, 0, 3)
  const list = (signs || []).filter((s) => s && s.id != null).map((s) => ({ ...s, L: normFloor(s.floor) }))
  for (const s of list) {
    if (s.L > floors) floors = Math.min(25, s.L)
    if (s.L < -basement) basement = Math.min(3, -s.L)
    s.L = clamp(s.L, -basement, floors) || 1
  }
  const n = basement + floors
  const idxOf = (L) => (L > 0 ? basement + L - 1 : basement + L)
  const LOf = (i) => (i < basement ? i - basement : i - basement + 1)
  const per = Array.from({ length: n }, () => [])
  for (const s of list) per[idxOf(s.L)].push(s)
  const N = Math.max(4, ...per.map((a) => a.length))
  const seed = seedOf(`${b?.name || ''}|${floors}|${basement}`)
  const rnd = (i, k, salt) => hashRnd(seed, i, k, salt)

  const EX = WALL + SW
  const LOB0 = EX + EW
  const M0 = LOB0 + LOBBY
  const M1 = M0 + N * SHOP_W
  const W = M1 + SW + WALL
  const zone = (i) => (i % 2 === 0 ? 'R' : 'L') // i → i+1 계단이 있는 쪽

  const stairs = []
  for (let i = 0; i < n - 1; i++) {
    const fy0 = -i * FH
    const fy1 = -(i + 1) * FH
    if (zone(i) === 'R') stairs.push({ i, side: 'R', x0: M1 + 6, y0: fy1, x1: W - WALL - 10, y1: fy0 })
    else stairs.push({ i, side: 'L', x0: WALL + 10, y0: fy0, x1: EX - 6, y1: fy1 })
  }

  const WALLS = ['#f3e3c8', '#efd8bd', '#ebdcc2', '#f2dfcf', '#e8d6bb', '#f0e4cc']
  const levels = []
  for (let i = 0; i < n; i++) {
    const fy = -i * FH
    const L = LOf(i)
    const holes = []
    if (i > 0) holes.push(zone(i - 1) === 'R' ? [M1 + 6, W - WALL] : [WALL, EX - 6])
    const plats = []
    const boxes = []
    let gaps = 0
    for (let k = 1; k < N; k++) {
      const bx = M0 + k * SHOP_W
      const f = rnd(i, k, 1)
      if (i > 0 && f < 0.16 && gaps < 2) {
        holes.push([bx - 15, bx + 15])
        gaps++
      } else if (f < 0.4) {
        const w = 18 + Math.floor(rnd(i, k, 2) * 6)
        plats.push({ x0: bx - w, x1: bx + w, y: fy - 26 - Math.floor(rnd(i, k, 3) * 4) })
      } else if (f < 0.58) {
        boxes.push({ x0: bx - 7, x1: bx + 7, y0: fy - 14, y1: fy, kind: 'crate' })
        if (rnd(i, k, 4) < 0.35) boxes.push({ x0: bx - 6, x1: bx + 8, y0: fy - 28, y1: fy - 14, kind: 'crate' })
      } else if (f < 0.74) {
        boxes.push({ x0: bx - 6, x1: bx + 6, y0: fy - 10, y1: fy, kind: 'pot' })
      }
    }
    holes.sort((a, c) => a[0] - c[0])
    const segs = []
    let x = WALL
    for (const [a, c] of holes) {
      if (a > x) segs.push([x, a])
      x = Math.max(x, c)
    }
    if (x < W - WALL) segs.push([x, W - WALL])

    const shops = []
    const deco = []
    const here = per[i]
    const used = new Set()
    here.forEach((s, j) => {
      let k = Math.round(((j + 0.5) * N) / here.length - 0.5)
      while (used.has(k)) k++
      used.add(k)
      shops.push({ ...s, k, cx: M0 + (k + 0.5) * SHOP_W, fy, i })
    })
    for (let k = 0; k < N; k++) if (!used.has(k)) deco.push({ k, cx: M0 + (k + 0.5) * SHOP_W, kind: ['rent', 'window', 'bench', 'window', 'rent'][Math.floor(rnd(i, k, 5) * 5)] })
    const lamps = []
    for (let k = 0; k <= N; k++) lamps.push({ x: M0 + k * SHOP_W, on: rnd(i, k, 6) < 0.8 })
    lamps.push({ x: LOB0 + 8, on: true })
    // 계단칸 전등: 위층 바닥에 구멍이 뚫린 쪽에는 달지 않는다
    if (i === n - 1 || zone(i) !== 'L') lamps.push({ x: EX - SW / 2, on: rnd(i, 99, 6) < 0.7 })
    if (i === n - 1 || zone(i) !== 'R') lamps.push({ x: M1 + SW / 2, on: rnd(i, 98, 6) < 0.7 })
    const wall = L < 0 ? (i % 2 ? '#c4c0b6' : '#bdb9af') : WALLS[Math.floor(rnd(i, 0, 7) * WALLS.length)]
    levels.push({ i, L, fy, segs, holes, plats, boxes, shops, deco, lamps, wall, label: floorName(L), short: floorShort(L) })
  }
  const one = idxOf(1)
  return { n, N, W, EX, LOB0, M0, M1, levels, stairs, one, liftX: EX + EW / 2, exitX: LOB0 + LOBBY / 2, basement, floors, top: -(n - 1) * FH - FH }
}

let world = buildWorld(props.building, props.signs)
const fyOf = (i) => -i * FH

// ── 플레이어·엘리베이터 상태 ──
const p = { x: 0, y: 0, vx: 0, vy: 0, grounded: true, coyote: 0, buffer: 0, drop: 0, dir: 3, walk: 0, riding: false, lock: false }
const lift = { car: 0, open: 0, mode: 'idle', from: 0, to: 0, t: 0, d: 0, start: 0, wait: 0 }
const cam = { x: 0, y: 0, ready: false }
function spawn() {
  p.x = world.exitX
  p.y = fyOf(world.one)
  p.vx = p.vy = 0
  p.grounded = true
  p.riding = p.lock = false
  p.dir = 3
  lift.car = world.one
  lift.open = 0
  lift.mode = 'idle'
  cam.ready = false
  panel.value = null
}
spawn()

const buildingKey = () => `${props.building?.name}|${props.building?.floors}|${props.building?.basement}`
let lastKey = buildingKey()
watch(
  () => [props.building, props.signs],
  () => {
    world = buildWorld(props.building, props.signs)
    fitCache.clear()
    const key = buildingKey()
    if (key !== lastKey) {
      lastKey = key
      spawn()
    } else {
      p.x = clamp(p.x, WALL + HW, world.W - WALL - HW)
      lift.car = clamp(lift.car, 0, world.n - 1)
    }
  },
  { deep: true },
)

// 엘리베이터 판의 층 단추(위층부터). world 는 반응형이 아니라 그릴 때마다 계산
function panelFloors() {
  const t = targetShop()
  return world.levels.map((lv) => ({ i: lv.i, short: lv.short, star: t && t.i === lv.i })).reverse()
}
// 단추를 누른 뒤 포커스를 풀어 Space·Enter 가 단추를 다시 누르지 않게
function tap(e, fn) {
  e.currentTarget?.blur?.()
  fn()
}

function targetShop() {
  if (props.target == null) return null
  for (const lv of world.levels) for (const s of lv.shops) if (String(s.id) === String(props.target)) return s
  return null
}

// ── 충돌 ──
function stairY(s, x) {
  return s.y0 + ((s.y1 - s.y0) * (x - s.x0)) / (s.x1 - s.x0)
}
function groundAt(x, top, bot, noPlat) {
  let best = null
  const take = (y) => {
    if (y >= top && y <= bot && (best === null || y < best)) best = y
  }
  for (const lv of world.levels) {
    if (lv.fy >= top - 1 && lv.fy <= bot + 1) for (const [a, b] of lv.segs) if (x >= a && x <= b) take(lv.fy)
    if (lv.fy < top - FH || lv.fy > bot + FH) continue
    if (!noPlat) for (const q of lv.plats) if (x >= q.x0 && x <= q.x1) take(q.y)
    for (const q of lv.boxes) if (x + HW > q.x0 && x - HW < q.x1) take(q.y0)
  }
  for (const s of world.stairs) if (x >= s.x0 && x <= s.x1) take(stairY(s, x))
  return best
}
function ceilingAt(x, headOld, headNew) {
  let hit = null
  for (const lv of world.levels) {
    const bottom = lv.fy + SLAB
    if (bottom <= headOld + 0.01 && bottom >= headNew) for (const [a, b] of lv.segs) if (x + HW > a && x - HW < b) hit = hit === null ? bottom : Math.max(hit, bottom)
    for (const q of lv.boxes) if (q.y1 <= headOld + 0.01 && q.y1 >= headNew && x + HW > q.x0 && x - HW < q.x1) hit = hit === null ? q.y1 : Math.max(hit, q.y1)
  }
  return hit
}
const levelAt = (y) => clamp(Math.floor((-y + 2) / FH), 0, world.n - 1)

// ── 입력 ──
const keys = { left: false, right: false, jump: false, down: false }
function nearby() {
  if (!p.grounded || p.riding || p.lock) return null
  const i = levelAt(p.y)
  if (Math.abs(p.y - fyOf(i)) > 0.5) return null
  if (i === world.one && Math.abs(p.x - world.exitX) < 16) return { kind: 'exit' }
  if (Math.abs(p.x - world.liftX) < 16) return { kind: 'lift', i }
  for (const s of world.levels[i].shops) if (Math.abs(p.x - s.cx) < 18) return { kind: 'shop', s }
  return null
}
function interact() {
  const n = nearby()
  if (!n) return false
  if (n.kind === 'exit') emit('exit')
  else if (n.kind === 'lift') panel.value = { from: n.i, sel: n.i }
  else emit('pick', n.s.id)
  return true
}
function pressJump() {
  if (keys.down && p.grounded && onPlatform()) {
    p.drop = 0.25
    p.grounded = false
    p.y += 0.5
    return
  }
  p.buffer = BUFFER
}
function onPlatform() {
  for (const lv of world.levels) for (const q of lv.plats) if (Math.abs(p.y - q.y) < 0.5 && p.x >= q.x0 && p.x <= q.x1) return true
  return false
}
function ride(to) {
  const from = panel.value ? panel.value.from : levelAt(p.y)
  panel.value = null
  if (to === from || to < 0 || to >= world.n || lift.mode === 'call' || lift.mode === 'move' || p.riding) return
  lift.from = from
  lift.to = to
  lift.mode = lift.car === from ? 'open1' : 'call'
  p.lock = true
  p.vx = 0
}

const isTyping = (e) => {
  const t = e.target
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}
function onKeyDown(e) {
  if (isTyping(e)) return
  const k = e.key
  const code = e.code
  const up = k === 'ArrowUp' || code === 'KeyW'
  const down = k === 'ArrowDown' || code === 'KeyS'
  const act = code === 'KeyE' || k === 'Enter'
  const space = code === 'Space' || k === ' '
  if (k === 'ArrowLeft' || k === 'ArrowRight' || up || down || space) e.preventDefault()
  if (panel.value) {
    const pv = panel.value
    if (up) pv.sel = Math.min(world.n - 1, pv.sel + 1)
    else if (down) pv.sel = Math.max(0, pv.sel - 1)
    else if ((act || space) && !e.repeat) ride(pv.sel)
    else if (k === 'Escape') panel.value = null
    return
  }
  if (k === 'Escape') {
    emit('exit')
    return
  }
  if (k === 'ArrowLeft' || code === 'KeyA') keys.left = true
  if (k === 'ArrowRight' || code === 'KeyD') keys.right = true
  if (down) keys.down = true
  if (e.repeat) return
  const n = nearby()
  if ((up || down) && n && n.kind === 'lift') {
    ride(n.i + (up ? 1 : -1))
    return
  }
  if (act) {
    interact()
    return
  }
  // Space 는 가게 문 앞에서만 들어가기, 그 밖엔 점프
  if (space && n && n.kind === 'shop') {
    interact()
    return
  }
  if (up || space) {
    keys.jump = true
    pressJump()
  }
}
function onKeyUp(e) {
  const k = e.key
  const code = e.code
  if (k === 'ArrowLeft' || code === 'KeyA') keys.left = false
  if (k === 'ArrowRight' || code === 'KeyD') keys.right = false
  if (k === 'ArrowDown' || code === 'KeyS') keys.down = false
  if (k === 'ArrowUp' || code === 'KeyW' || code === 'Space' || k === ' ') keys.jump = false
}
function onBlur() {
  keys.left = keys.right = keys.jump = keys.down = false
}
// 터치 버튼
function pad(k, on) {
  if (k === 'left') keys.left = on
  else if (k === 'right') keys.right = on
  else if (k === 'jump') {
    keys.jump = on
    if (on) pressJump()
  } else if (k === 'act' && on) interact()
}
function onTouchStart() {
  touch.value = true
}

// ── 한 걸음 ──
function step(dt) {
  if (lift.mode !== 'idle') stepLift(dt)
  if (p.riding) {
    p.x = world.liftX
    p.y = fyOf(lift.car)
    return
  }
  const free = !p.lock && !panel.value
  const dirX = free ? (keys.right ? 1 : 0) - (keys.left ? 1 : 0) : 0
  if (dirX) p.dir = dirX > 0 ? 3 : 2
  const acc = p.grounded ? 1100 : 700
  const want = dirX * SPEED
  p.vx = p.vx < want ? Math.min(want, p.vx + acc * dt) : Math.max(want, p.vx - acc * dt)
  if (p.drop > 0) p.drop -= dt
  if (p.buffer > 0) p.buffer -= dt
  if (p.coyote > 0) p.coyote -= dt

  // 옆으로
  let nx = clamp(p.x + p.vx * dt, WALL + HW, world.W - WALL - HW)
  const lv0 = levelAt(p.y)
  for (let j = Math.max(0, lv0 - 1); j <= Math.min(world.n - 1, lv0 + 1); j++) {
    for (const q of world.levels[j].boxes) {
      if (p.y > q.y0 + 0.01 && p.y - PH < q.y1 && nx + HW > q.x0 && nx - HW < q.x1) {
        nx = p.x <= (q.x0 + q.x1) / 2 ? q.x0 - HW : q.x1 + HW
        p.vx = 0
      }
    }
  }
  p.x = nx

  // 위아래
  if (p.grounded) {
    const g = groundAt(p.x, p.y - STEP_UP, p.y + STEP_DOWN, p.drop > 0)
    if (g !== null) p.y = g
    else {
      p.grounded = false
      p.coyote = COYOTE
      p.vy = 0
    }
  }
  if (free && p.buffer > 0 && (p.grounded || p.coyote > 0)) {
    p.vy = -JUMP_V
    p.grounded = false
    p.coyote = 0
    p.buffer = 0
  }
  if (!p.grounded) {
    p.vy = Math.min(FALL_MAX, p.vy + G * (p.vy < 0 && !keys.jump ? 2.6 : 1) * dt)
    let ny = p.y + p.vy * dt
    if (p.vy > 0) {
      const land = groundAt(p.x, p.y - 0.01, ny, p.drop > 0)
      if (land !== null) {
        ny = land
        p.vy = 0
        p.grounded = true
      }
    } else if (p.vy < 0) {
      const c = ceilingAt(p.x, p.y - PH, ny - PH)
      if (c !== null) {
        ny = c + PH
        p.vy = 0
      }
    }
    p.y = ny
  }
  if (p.grounded && Math.abs(p.vx) > 4) p.walk += dt
  else p.walk = 0
}

function stepLift(dt) {
  const L = lift
  if (L.mode === 'call') {
    const d = L.from - L.car
    const mv = Math.sign(d) * Math.min(Math.abs(d), 4 * dt)
    L.car += mv
    if (Math.abs(L.from - L.car) < 1e-4) {
      L.car = L.from
      L.mode = 'open1'
    }
  } else if (L.mode === 'open1') {
    L.open = Math.min(1, L.open + dt * 4)
    if (L.open >= 1) {
      p.riding = true
      p.dir = 1
      L.mode = 'close1'
      L.wait = 0.25
    }
  } else if (L.mode === 'close1') {
    if ((L.wait -= dt) > 0) return
    L.open = Math.max(0, L.open - dt * 4)
    if (L.open <= 0) {
      L.mode = 'move'
      L.start = L.car
      L.t = 0
      L.d = 0.5 + 0.22 * Math.abs(L.to - L.car)
    }
  } else if (L.mode === 'move') {
    L.t += dt
    const u = clamp(L.t / L.d, 0, 1)
    L.car = L.start + (L.to - L.start) * (u * u * (3 - 2 * u))
    if (u >= 1) {
      L.car = L.to
      L.mode = 'open2'
    }
  } else if (L.mode === 'open2') {
    L.open = Math.min(1, L.open + dt * 4)
    if (L.open >= 1) {
      p.riding = false
      p.lock = false
      p.x = world.liftX
      p.y = fyOf(L.to)
      p.vx = p.vy = 0
      p.grounded = true
      p.dir = 0
      L.mode = 'hold'
      L.wait = 0.8
    }
  } else if (L.mode === 'hold') {
    if ((L.wait -= dt) <= 0) L.mode = 'close2'
  } else if (L.mode === 'close2') {
    L.open = Math.max(0, L.open - dt * 4)
    if (L.open <= 0) L.mode = 'idle'
  }
}

// ── 그리기 ──
let ctx = null
let dark = null
let dctx = null
let cw = 0
let ch = 0
let dpr = 1
let Z = 3
const fitCache = new Map()

function resize() {
  const el = wrap.value
  const c = cv.value
  if (!el || !c) return
  const r = el.getBoundingClientRect()
  dpr = Math.min(3, window.devicePixelRatio || 1)
  cw = Math.max(1, r.width)
  ch = Math.max(1, r.height)
  c.width = Math.round(cw * dpr)
  c.height = Math.round(ch * dpr)
  if (!dark) {
    dark = document.createElement('canvas')
    dctx = dark.getContext('2d')
  }
  dark.width = c.width
  dark.height = c.height
  // 위아래 층이 살짝 보이게, 너무 좁은 화면에서는 가게 두 칸은 보이게
  Z = clamp(Math.floor((ch / (FH * 3.1)) * 2) / 2, 1.5, 4)
  Z = Math.max(1.25, Math.min(Z, Math.floor((cw / 200) * 4) / 4))
  fitCache.clear()
}

// 간판 글씨: 칸에 맞게 줄이고, 최소 크기(화면 12px)보다 작아지면 말줄임
function fitText(text, maxW, base) {
  const minSize = Math.max(12 / Z, 4)
  const key = `${text}|${maxW}|${base}|${minSize}`
  if (fitCache.has(key)) return fitCache.get(key)
  ctx.font = `700 ${base}px ${FONT}`
  const w = ctx.measureText(text).width
  let size = base
  let out = text
  if (w > maxW) {
    size = Math.max(minSize, (base * maxW) / w)
    ctx.font = `700 ${size}px ${FONT}`
    if (ctx.measureText(out).width > maxW) {
      const chars = [...text]
      while (chars.length > 1 && ctx.measureText(chars.join('') + '…').width > maxW) chars.pop()
      out = chars.join('') + '…'
    }
  }
  const r = { size, text: out }
  fitCache.set(key, r)
  return r
}

function rect(x, y, w, h, c) {
  ctx.fillStyle = c
  ctx.fillRect(x, y, w, h)
}

function signStyle(s) {
  const base = rgbOf(s.color || '#d9534f')
  const lit = !!s.lit
  const board = lit ? base : mix(base, [110, 104, 98], 0.55)
  const text = lum(board) > 0.6 ? [28, 22, 30] : lit ? [255, 250, 232] : [222, 214, 200]
  return { base, board: rgb(board), edge: rgb(mix(board, [20, 16, 24], 0.45)), text: rgb(text), glow: rgb(mix(base, [255, 255, 255], 0.25)), tint: base }
}

function drawSign(s, night, glowPass, t) {
  const st = signStyle(s)
  const x = s.cx - 49
  const y = s.fy - 61
  if (glowPass && night && s.lit) {
    ctx.shadowColor = st.glow
    ctx.shadowBlur = 14 * Z * dpr
  }
  rect(x - 1, y - 1, 100, 18, st.edge)
  rect(x, y, 98, 16, st.board)
  ctx.shadowBlur = 0
  rect(x, y, 98, 1, 'rgba(255,255,255,0.25)')
  rect(x, y + 15, 98, 1, 'rgba(0,0,0,0.2)')
  const f = fitText(s.name || '', 90, 10)
  ctx.font = `700 ${f.size}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (night && s.lit) {
    ctx.shadowColor = st.glow
    ctx.shadowBlur = 6 * Z * dpr
  }
  // 켜진 간판은 아주 살짝 깜박
  const flick = s.lit && night && Math.sin(t * 7 + s.cx) > 0.985 ? 0.6 : 1
  ctx.globalAlpha = flick
  ctx.fillStyle = st.text
  ctx.fillText(f.text, s.cx, y + 8.5)
  ctx.globalAlpha = 1
  ctx.shadowBlur = 0
}

function drawShop(s, lv, night) {
  const st = signStyle(s)
  const { cx, fy } = s
  // 가게 앞면
  rect(cx - 53, fy - 63, 106, 63, rgb(mix(st.tint, [240, 232, 218], 0.82)))
  rect(cx - 53, fy - 63, 2, 63, rgb(mix(st.tint, [60, 50, 50], 0.6)))
  rect(cx + 51, fy - 63, 2, 63, rgb(mix(st.tint, [60, 50, 50], 0.6)))
  // 진열창
  const glass = night ? (s.lit ? '#ffe7a3' : '#1c2130') : rgb(mix(st.tint, [205, 232, 240], 0.75))
  for (const gx of [cx - 46, cx + 18]) {
    rect(gx - 1, fy - 39, 30, 31, '#4a3a30')
    rect(gx, fy - 38, 28, 29, glass)
    rect(gx + 3, fy - 35, 2, 10, 'rgba(255,255,255,0.45)')
    rect(gx, fy - 24, 28, 1, 'rgba(0,0,0,0.15)')
  }
  rect(cx - 47, fy - 8, 30, 8, '#7a5a44')
  rect(cx + 17, fy - 8, 30, 8, '#7a5a44')
  // 문
  rect(cx - 14, fy - 41, 28, 41, '#3a2a22')
  rect(cx - 12, fy - 39, 24, 39, '#7b4f33')
  rect(cx - 9, fy - 35, 18, 16, night ? (s.lit ? '#ffd27a' : '#232634') : '#bfe0e8')
  rect(cx + 6, fy - 20, 2, 4, '#ffd34d')
  // 차양
  const aw = rgb(mix(st.tint, [255, 255, 255], 0.15))
  for (let k = 0; k < 13; k++) rect(cx - 52 + k * 8, fy - 44, 8, 3, k % 2 ? aw : '#f7f1e6')
}

function drawDeco(d, lv, night) {
  const { cx } = d
  const fy = lv.fy
  if (d.kind === 'rent') {
    rect(cx - 44, fy - 44, 88, 44, '#8e8a84')
    for (let y = fy - 42; y < fy; y += 4) rect(cx - 43, y, 86, 1, '#6e6a64')
    rect(cx - 22, fy - 34, 44, 14, '#f6f1e3')
    ctx.font = `700 ${Math.max(8, 12 / Z)}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#c0392b'
    ctx.fillText('임대', cx, fy - 27)
  } else if (d.kind === 'window') {
    windowAt(cx - 22, fy - 52, 44, 30, night, lv.i * 31 + d.k)
    rect(cx - 26, fy - 22, 52, 3, '#9c8a76')
  } else {
    windowAt(cx - 18, fy - 52, 36, 24, night, lv.i * 17 + d.k)
    rect(cx - 20, fy - 12, 40, 3, '#6b4a33')
    rect(cx - 18, fy - 9, 2, 9, '#4a3226')
    rect(cx + 16, fy - 9, 2, 9, '#4a3226')
    rect(cx - 20, fy - 18, 40, 2, '#6b4a33')
  }
}

function windowAt(x, y, w, h, night, seed) {
  rect(x - 2, y - 2, w + 4, h + 4, '#5a4a3e')
  rect(x, y, w, h, night ? '#141a36' : '#9fd3f5')
  if (night) {
    for (let k = 0; k < 4; k++) {
      const r = hashRnd(seed, k, 1, 2)
      rect(x + Math.floor(r * (w - 2)), y + Math.floor(hashRnd(seed, k, 2, 3) * (h / 2)), 1, 1, '#fff6d8')
    }
    rect(x + 2, y + h - 8, w - 4, 8, '#0c0f22')
    for (let k = 0; k < w - 6; k += 5) if (hashRnd(seed, k, 3, 4) < 0.5) rect(x + 3 + k, y + h - 6, 2, 2, '#ffd36b')
  } else {
    rect(x + 3, y + h - 7, w - 6, 7, '#b9c7d2')
    rect(x + w / 2 - 1, y, 2, h, 'rgba(255,255,255,0.35)')
    rect(x, y + h / 2, w, 1, 'rgba(90,74,62,0.4)')
  }
}

function drawLevelBack(lv, night) {
  const w = world
  const fy = lv.fy
  const ceil = fy - FH + SLAB
  rect(WALL, ceil, w.W - WALL * 2, FH - SLAB, lv.wall)
  // 걸레받이
  rect(WALL, fy - 6, w.W - WALL * 2, 6, 'rgba(90,60,40,0.18)')
  rect(WALL, ceil, w.W - WALL * 2, 2, 'rgba(0,0,0,0.12)')
  // 계단칸 벽
  const sw = lv.L < 0 ? '#aaa69d' : '#d6cdbd'
  // 계단칸은 바닥판 구멍까지 벽을 이어 그린다
  const sTop = lv.i === w.n - 1 ? ceil : fy - FH
  rect(WALL, sTop, SW, fy - sTop, sw)
  rect(w.M1, sTop, SW, fy - sTop, sw)
  for (let y = ceil + 8; y < fy; y += 12) {
    rect(WALL, y, SW, 1, 'rgba(0,0,0,0.06)')
    rect(w.M1, y, SW, 1, 'rgba(0,0,0,0.06)')
  }
  // 엘리베이터 통로(뒤)
  rect(w.EX, ceil, EW, FH - SLAB, '#2a2d33')
  rect(w.EX + 8, ceil, 2, FH - SLAB, '#454a52')
  rect(w.EX + EW - 10, ceil, 2, FH - SLAB, '#454a52')
  // 엘리베이터 옆 칸: 1층은 출입문, 나머지는 창
  if (lv.i === w.one) {
    const x = w.LOB0 + LOBBY / 2
    rect(x - 20, fy - 46, 40, 46, '#4a5560')
    rect(x - 18, fy - 44, 17, 44, night ? '#1b2a44' : '#a8dcec')
    rect(x + 1, fy - 44, 17, 44, night ? '#1b2a44' : '#a8dcec')
    rect(x - 15, fy - 40, 2, 14, 'rgba(255,255,255,0.4)')
    rect(x - 4, fy - 24, 2, 6, '#d0d6dc')
    rect(x + 2, fy - 24, 2, 6, '#d0d6dc')
    rect(x - 16, fy - 60, 32, 11, '#1f8f50')
    ctx.font = `700 ${Math.max(7, 12 / Z)}px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#eafff0'
    ctx.fillText('출입문', x, fy - 54.5)
  } else {
    windowAt(w.LOB0 + 30, fy - 52, 34, 28, night, lv.i * 7 + 3)
  }
  // 층 표시(벽에 크게)
  ctx.font = `700 14px ${FONT}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = 'rgba(60,40,30,0.28)'
  ctx.fillText(lv.short, w.LOB0 + 6, fy - 10)
  for (const d of lv.deco) drawDeco(d, lv, night)
  for (const s of lv.shops) drawShop(s, lv, night)
  // 전등
  for (const l of lv.lamps) {
    rect(l.x, ceil, 1, 5, '#3a3030')
    rect(l.x - 4, ceil + 5, 9, 3, '#5a4a40')
    rect(l.x - 2, ceil + 8, 5, 2, l.on ? '#fff1b8' : '#8a8378')
  }
}

function drawLift(lv, night) {
  const w = world
  const fy = lv.fy
  const x0 = w.EX + 6
  const dw = EW - 12
  const here = Math.abs(lift.car - lv.i) < 0.01
  const o = here ? lift.open : 0
  rect(x0 - 3, fy - 47, dw + 6, 3, '#5d6670')
  rect(x0 - 3, fy - 44, 3, 44, '#5d6670')
  rect(x0 + dw, fy - 44, 3, 44, '#5d6670')
  const half = dw / 2
  const sl = half * o
  ctx.fillStyle = '#a9b1ba'
  ctx.fillRect(x0, fy - 44, half - sl, 44)
  ctx.fillRect(x0 + half + sl, fy - 44, half - sl, 44)
  ctx.fillStyle = '#7b848e'
  if (half - sl > 1) ctx.fillRect(x0 + half - sl - 1, fy - 44, 1, 44)
  if (half - sl > 1) ctx.fillRect(x0 + half + sl, fy - 44, 1, 44)
  // 층 표시등
  rect(w.liftX - 10, fy - 58, 20, 9, '#14161c')
  const carL = world.levels[clamp(Math.round(lift.car), 0, w.n - 1)].short
  ctx.font = `700 ${Math.max(7, 12 / Z)}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffb347'
  ctx.fillText(carL, w.liftX, fy - 53.5)
  // 호출 버튼
  rect(w.EX + EW + 1, fy - 28, 4, 8, '#5d6670')
  rect(w.EX + EW + 2, fy - 27, 2, 2, lift.mode !== 'idle' && lift.from === lv.i ? '#ffb347' : '#cfd5da')
  rect(w.EX + EW + 2, fy - 23, 2, 2, '#cfd5da')
}

function drawCar() {
  const w = world
  const fy = fyOf(lift.car)
  rect(w.EX + 3, fy - 46, EW - 6, 46, '#8d959e')
  rect(w.EX + 5, fy - 44, EW - 10, 44, '#e6eaec')
  rect(w.EX + 5, fy - 44, EW - 10, 3, '#fff6d0')
  rect(w.EX + 5, fy - 14, EW - 10, 1, '#c3c9ce')
  rect(w.liftX, fy - 46 - 40, 1, 40, '#1a1c20')
}

function drawStair(s, night) {
  const steps = 8
  const dx = (s.x1 - s.x0) / steps
  const up = s.y0 > s.y1 // 오른쪽으로 오르는지
  ctx.fillStyle = night ? '#6f675e' : '#8f857a'
  // 옆판
  ctx.beginPath()
  ctx.moveTo(s.x0, s.y0)
  ctx.lineTo(s.x1, s.y1)
  ctx.lineTo(s.x1, s.y1 + 6)
  ctx.lineTo(s.x0, s.y0 + 6)
  ctx.closePath()
  ctx.fill()
  for (let j = 0; j < steps; j++) {
    const xa = s.x0 + j * dx
    const ya = stairY(s, xa + (up ? dx : 0))
    rect(Math.round(xa), Math.round(ya) - 1, Math.ceil(dx), 3, '#b3a898')
    rect(Math.round(xa), Math.round(ya) - 1, Math.ceil(dx), 1, '#d2c8b8')
  }
  // 난간
  ctx.strokeStyle = '#5a4a3a'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(s.x0, s.y0 - 18)
  ctx.lineTo(s.x1, s.y1 - 18)
  ctx.stroke()
  for (let j = 0; j <= steps; j += 2) {
    const xa = s.x0 + j * dx
    rect(Math.round(xa), stairY(s, xa) - 18, 1, 18, '#6a5a4a')
  }
}

function drawSlabs(lv) {
  for (const [a, b] of lv.segs) {
    rect(a, lv.fy, b - a, SLAB, lv.L < 0 ? '#6c6760' : '#7d746b')
    rect(a, lv.fy, b - a, 2, lv.L < 0 ? '#8a8379' : '#a0673d')
    rect(a, lv.fy + 2, b - a, 1, 'rgba(0,0,0,0.25)')
    rect(a, lv.fy + SLAB - 1, b - a, 1, 'rgba(0,0,0,0.3)')
  }
  for (const [a, b] of lv.holes) {
    // 틈 가장자리 경고 줄무늬
    if (a > WALL + SW && b < world.M1) {
      for (const x of [a - 4, b]) for (let k = 0; k < 4; k += 2) rect(x + k, lv.fy, 2, 2, '#ffcf3a')
    }
  }
}

function drawProps(lv) {
  for (const q of lv.plats) {
    rect(q.x0, q.y, q.x1 - q.x0, 4, '#6b4a33')
    rect(q.x0, q.y, q.x1 - q.x0, 1, '#a8774f')
    rect(q.x0 + 3, q.y + 4, 2, 4, '#4a3226')
    rect(q.x1 - 5, q.y + 4, 2, 4, '#4a3226')
  }
  for (const q of lv.boxes) {
    const w = q.x1 - q.x0
    const h = q.y1 - q.y0
    if (q.kind === 'crate') {
      rect(q.x0, q.y0, w, h, '#5e3f24')
      rect(q.x0 + 1, q.y0 + 1, w - 2, h - 2, '#b07b45')
      rect(q.x0 + 1, q.y0 + Math.floor(h / 2), w - 2, 1, '#7a5230')
      rect(q.x0 + 1, q.y0 + 1, w - 2, 1, '#d29a5e')
    } else {
      // 화분
      rect(q.x0 + 1, q.y0 + 3, w - 2, h - 3, '#b4553a')
      rect(q.x0, q.y0 + 3, w, 2, '#d0694b')
      rect(q.x0 + 2, q.y0 - 8, 3, 11, '#3f9b4a')
      rect(q.x0 + 5, q.y0 - 12, 3, 15, '#2f8a3e')
      rect(q.x0 + 8, q.y0 - 7, 3, 10, '#4cae58')
    }
  }
}

function drawOuter(top, bottom, night) {
  const w = world
  // 바깥(하늘·땅)
  ctx.fillStyle = night ? '#0b0e22' : '#8ec5ef'
  ctx.fillRect(-2000, top - 2000, w.W + 4000, bottom - top + 4000)
  // 건물 몸통
  rect(0, w.top - 6, w.W, -w.top + 6 + SLAB, '#3b2f2a')
  for (let x = 0; x < WALL; x += 4) {
    rect(x, w.top - 6, 1, -w.top + 6 + SLAB, '#2c2320')
    rect(w.W - WALL + x, w.top - 6, 1, -w.top + 6 + SLAB, '#2c2320')
  }
  // 옥상과 이름판
  rect(-4, w.top - 6, w.W + 8, 6 + SLAB, '#5a4d45')
  const name = props.building?.name || '건물'
  const f = fitText(name, Math.min(240, w.W - 40), 14)
  ctx.font = `700 ${f.size}px ${FONT}`
  const tw = ctx.measureText(f.text).width + 16
  rect(w.W / 2 - tw / 2, w.top - 30, tw, 20, '#1c1a22')
  rect(w.W / 2 - tw / 2 + 1, w.top - 29, tw - 2, 18, night ? '#2b2440' : '#f6efe0')
  rect(w.W / 2 - tw / 2 + 6, w.top - 10, 2, 4, '#1c1a22')
  rect(w.W / 2 + tw / 2 - 8, w.top - 10, 2, 4, '#1c1a22')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = night ? '#ffe9a8' : '#2a2230'
  ctx.fillText(f.text, w.W / 2, w.top - 20)
  // 땅
  rect(-2000, SLAB, w.W + 4000, 2000, world.basement ? '#5b4636' : '#6f7a5a')
  rect(-2000, SLAB, w.W + 4000, 2, '#3b2f28')
}

function screenOf(x, y, k, ox, oy) {
  return [x * k + ox, y * k + oy]
}

function render(t) {
  if (!ctx) return
  const w = world
  const night = props.night
  const k = Z * dpr
  const W = cv.value.width
  const H = cv.value.height
  const viewW = cw / Z
  const viewH = ch / Z
  // 카메라
  let tx = p.x
  let ty = p.y - 28
  tx = w.W + 40 < viewW ? w.W / 2 : clamp(tx, viewW / 2 - 24, w.W + 24 - viewW / 2)
  const yTop = w.top - 44
  const yBot = SLAB + 30
  ty = yBot - yTop < viewH ? (yTop + yBot) / 2 : clamp(ty, yTop + viewH / 2, yBot - viewH / 2)
  if (!cam.ready) {
    cam.x = tx
    cam.y = ty
    cam.ready = true
  }
  const ox = Math.round(W / 2 - cam.x * k)
  const oy = Math.round(H / 2 - cam.y * k)
  const vy0 = cam.y - viewH / 2
  const vy1 = cam.y + viewH / 2

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, W, H)
  ctx.setTransform(k, 0, 0, k, ox, oy)
  drawOuter(vy0, vy1, night)
  const vis = w.levels.filter((lv) => lv.fy + SLAB >= vy0 - 4 && lv.fy - FH <= vy1 + 4)
  for (const lv of vis) drawLevelBack(lv, night)
  // 엘리베이터 칸과 탄 사람
  drawCar()
  if (p.riding) drawPlayer(k, ox, oy, night, t)
  ctx.setTransform(k, 0, 0, k, ox, oy)
  for (const lv of vis) drawLift(lv, night)
  for (const s of w.stairs) if (Math.min(s.y0, s.y1) - 20 <= vy1 && Math.max(s.y0, s.y1) + 8 >= vy0) drawStair(s, night)
  for (const lv of vis) drawSlabs(lv)
  for (const lv of vis) drawProps(lv)
  // 낮엔 간판을 여기서, 밤엔 어둠 위에
  for (const lv of vis) for (const s of lv.shops) if (!night || !s.lit) drawSign(s, night, false, t)

  if (night) {
    drawDark(vis, k, ox, oy)
    ctx.setTransform(k, 0, 0, k, ox, oy)
    for (const lv of vis) for (const s of lv.shops) if (s.lit) drawSign(s, night, true, t)
  }
  if (!p.riding) drawPlayer(k, ox, oy, night, t)

  // 찾을 간판 표시
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const ts = targetShop()
  if (ts) drawTarget(ts, k, ox, oy, t)
  drawPrompt(k, ox, oy)
}

function drawPlayer(k, ox, oy, night, t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const [sx, sy] = screenOf(p.x, p.y, k, ox, oy)
  let frame = 0
  if (!p.grounded) frame = 1
  else if (p.walk > 0) frame = 1 + (Math.floor(p.walk * 8) % 2)
  drawAvatar(ctx, props.look || DEFAULT_LOOK, sx, sy, { scale: k, dir: p.dir, frame, night, shadow: p.grounded })
}

function drawDark(vis, k, ox, oy) {
  const W = dark.width
  const H = dark.height
  dctx.globalCompositeOperation = 'source-over'
  dctx.clearRect(0, 0, W, H)
  dctx.fillStyle = 'rgba(6, 8, 24, 0.76)'
  dctx.fillRect(0, 0, W, H)
  dctx.globalCompositeOperation = 'destination-out'
  const hole = (x, y, r, a) => {
    const [sx, sy] = screenOf(x, y, k, ox, oy)
    const R = r * k
    if (sx < -R || sy < -R || sx > W + R || sy > H + R) return
    const g = dctx.createRadialGradient(sx, sy, 0, sx, sy, R)
    g.addColorStop(0, `rgba(0,0,0,${a})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    dctx.fillStyle = g
    dctx.fillRect(sx - R, sy - R, R * 2, R * 2)
  }
  for (const lv of vis) {
    const ceil = lv.fy - FH + SLAB
    for (const l of lv.lamps) if (l.on) hole(l.x, ceil + 14, 40, 0.75)
    for (const s of lv.shops) if (s.lit) hole(s.cx, s.fy - 40, 66, 0.95)
    if (lv.i === world.one) hole(world.exitX, lv.fy - 50, 26, 0.8)
    hole(world.liftX, lv.fy - 54, 14, 0.7)
  }
  if (lift.open > 0) hole(world.liftX, fyOf(lift.car) - 22, 30 * lift.open, 0.8)
  hole(p.x, p.y - 12, 30, 0.45)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(dark, 0, 0)
  // 켜진 간판 둘레 색 번짐
  ctx.globalCompositeOperation = 'lighter'
  for (const lv of vis) {
    for (const s of lv.shops) {
      if (!s.lit) continue
      const [sx, sy] = screenOf(s.cx, s.fy - 50, k, ox, oy)
      const R = 60 * k
      const c = rgbOf(s.color || '#d9534f')
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, R)
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.28)`)
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`)
      ctx.fillStyle = g
      ctx.fillRect(sx - R, sy - R, R * 2, R * 2)
    }
  }
  ctx.globalCompositeOperation = 'source-over'
}

function label(text, x, y, align, bg, fg) {
  const fs = Math.round(12 * dpr)
  ctx.font = `700 ${fs}px ${FONT}`
  const tw = ctx.measureText(text).width
  const pad = 5 * dpr
  const bw = tw + pad * 2
  const bh = fs + pad * 2
  let lx = align === 'left' ? x : align === 'right' ? x - bw : x - bw / 2
  lx = clamp(lx, 4 * dpr, cv.value.width - bw - 4 * dpr)
  const ly = clamp(y - bh / 2, 4 * dpr, cv.value.height - bh - 4 * dpr)
  ctx.fillStyle = '#0a0812'
  ctx.fillRect(lx - dpr * 2, ly, bw + dpr * 4, bh)
  ctx.fillRect(lx, ly - dpr * 2, bw, bh + dpr * 4)
  ctx.fillStyle = bg
  ctx.fillRect(lx, ly, bw, bh)
  ctx.fillStyle = fg
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, lx + pad, ly + bh / 2 + dpr)
}

function drawTarget(s, k, ox, oy, t) {
  const W = cv.value.width
  const H = cv.value.height
  const [sx, sy] = screenOf(s.cx, s.fy - 66, k, ox, oy)
  const m = 30 * dpr
  const topM = 56 * dpr
  const botM = (touch.value ? 110 : 30) * dpr
  const nm = [...(s.name || '')]
  const text = `${world.levels[s.i].label} 「${nm.length > 10 ? nm.slice(0, 9).join('') + '…' : nm.join('')}」`
  if (sx > m && sx < W - m && sy > topM && sy < H - botM) {
    // 화면 안: 간판 위에서 통통 튀는 화살표
    const b = Math.round(Math.sin(t * 6) * 3 * dpr)
    const a = 7 * dpr
    ctx.fillStyle = '#0a0812'
    tri(sx, sy + b + dpr * 2, a + dpr * 2, Math.PI / 2)
    ctx.fillStyle = '#ffd23f'
    tri(sx, sy + b, a, Math.PI / 2)
    return
  }
  // 화면 밖: 가장자리 화살표 + 층 표시
  const cx = W / 2
  const cy = H / 2
  const dx = sx - cx
  const dy = sy - cy
  const ang = Math.atan2(dy, dx)
  const sxM = (W / 2 - m) / Math.abs(dx || 1e-6)
  const syM = (dy < 0 ? H / 2 - topM : H / 2 - botM) / Math.abs(dy || 1e-6)
  const f = Math.min(sxM, syM)
  const ax = cx + dx * f
  const ay = cy + dy * f
  const pulse = 1 + Math.sin(t * 6) * 0.12
  ctx.fillStyle = '#0a0812'
  tri(ax, ay, 13 * dpr * pulse, ang)
  ctx.fillStyle = '#ffd23f'
  tri(ax, ay, 10 * dpr * pulse, ang)
  const lx = ax - Math.cos(ang) * 22 * dpr
  const ly = ay - Math.sin(ang) * 22 * dpr
  const align = Math.cos(ang) > 0.5 ? 'right' : Math.cos(ang) < -0.5 ? 'left' : 'center'
  label(text, lx, ly, align, '#2a2040', '#ffe9a8')
}

function tri(x, y, r, ang) {
  ctx.beginPath()
  ctx.moveTo(x + Math.cos(ang) * r, y + Math.sin(ang) * r)
  ctx.lineTo(x + Math.cos(ang + 2.4) * r, y + Math.sin(ang + 2.4) * r)
  ctx.lineTo(x + Math.cos(ang - 2.4) * r, y + Math.sin(ang - 2.4) * r)
  ctx.closePath()
  ctx.fill()
}

function drawPrompt(k, ox, oy) {
  if (panel.value) return
  const n = nearby()
  if (!n) return
  const key = touch.value ? '[들어가기]' : 'E'
  let text = ''
  if (n.kind === 'exit') text = `${key} 밖으로 나가기`
  else if (n.kind === 'lift') text = touch.value ? `${key} 엘리베이터 타기` : 'E 층 고르기 · ↑↓ 한 층'
  else text = `${key} 「${n.s.name}」`
  const [sx, sy] = screenOf(p.x, p.y - PH - 14, k, ox, oy)
  label(text, sx, sy, 'center', '#1c1830', '#fff6d8')
}

// ── 루프 ──
let raf = 0
let last = 0
let acc = 0
function frame(now) {
  raf = requestAnimationFrame(frame)
  const t = now / 1000
  let dt = last ? t - last : 0
  last = t
  if (dt > 0.1) dt = 0.1
  acc += dt
  let n = 0
  while (acc >= DT && n < 8) {
    step(DT)
    acc -= DT
    n++
  }
  if (n === 8) acc = 0
  // 카메라는 부드럽게 따라감
  const viewW = cw / Z
  const viewH = ch / Z
  const w = world
  let tx = w.W + 40 < viewW ? w.W / 2 : clamp(p.x, viewW / 2 - 24, w.W + 24 - viewW / 2)
  const yTop = w.top - 44
  const yBot = SLAB + 30
  let ty = yBot - yTop < viewH ? (yTop + yBot) / 2 : clamp(p.y - 28, yTop + viewH / 2, yBot - viewH / 2)
  const a = 1 - Math.exp(-dt * 7)
  if (cam.ready) {
    cam.x += (tx - cam.x) * a
    cam.y += (ty - cam.y) * a
  }
  const lbl = world.levels[levelAt(p.y)].label
  if (hudFloor.value !== lbl) hudFloor.value = lbl
  render(t)
}

let ro = null
onMounted(() => {
  ctx = cv.value.getContext('2d')
  resize()
  ro = new ResizeObserver(resize)
  ro.observe(wrap.value)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  touch.value = !!window.matchMedia?.('(pointer: coarse)').matches
  document.fonts?.load(`700 12px Galmuri11`).then(() => fitCache.clear()).catch(() => {})
  raf = requestAnimationFrame(frame)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  ro?.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', onBlur)
  window.removeEventListener('touchstart', onTouchStart)
})

// 테스트·디버그용으로 상태를 살짝 보여 준다
defineExpose({ state: () => ({ x: p.x, y: p.y, level: levelAt(p.y), grounded: p.grounded, riding: p.riding, lift: lift.mode, car: lift.car, W: world.W, n: world.n }), holes: (i) => world.levels[i]?.holes || [] })
</script>

<template>
  <div ref="wrap" class="inside" :class="{ night }">
    <canvas ref="cv" class="cv" />
    <div class="hud pxbox">
      <b class="name">{{ building?.name || '건물' }}</b>
      <span class="dot">·</span>
      <span class="fl">{{ hudFloor }}</span>
      <button class="out" type="button" tabindex="-1" @click="tap($event, () => emit('exit'))">출입문으로 나가기(Esc)</button>
    </div>
    <div v-if="panel" class="lift pxbox" @pointerdown.stop>
      <div class="lift-title">엘리베이터</div>
      <div class="lift-grid">
        <button
          v-for="f in panelFloors()"
          :key="f.i"
          type="button"
          tabindex="-1"
          :class="{ sel: f.i === panel.sel, here: f.i === panel.from }"
          @click="tap($event, () => ride(f.i))"
        >
          {{ f.short }}<i v-if="f.star">★</i>
        </button>
      </div>
      <div class="lift-help">↑↓ 고르기 · E 타기 · Esc 닫기</div>
      <button class="lift-x" type="button" tabindex="-1" @click="tap($event, () => (panel = null))">닫기</button>
    </div>
    <div v-if="touch" class="pad">
      <div class="pad-side">
        <button type="button" tabindex="-1" @pointerdown.prevent="pad('left', true)" @pointerup="pad('left', false)" @pointercancel="pad('left', false)" @pointerleave="pad('left', false)">◀</button>
        <button type="button" tabindex="-1" @pointerdown.prevent="pad('right', true)" @pointerup="pad('right', false)" @pointercancel="pad('right', false)" @pointerleave="pad('right', false)">▶</button>
      </div>
      <div class="pad-side">
        <button type="button" tabindex="-1" class="wide" @pointerdown.prevent="pad('jump', true)" @pointerup="pad('jump', false)" @pointercancel="pad('jump', false)" @pointerleave="pad('jump', false)">점프</button>
        <button type="button" tabindex="-1" class="wide act" @pointerdown.prevent="pad('act', true)">들어가기</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inside {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #8ec5ef;
  font-family: Galmuri11, sans-serif;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
.inside.night {
  background: #0b0e22;
}
.cv {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  image-rendering: pixelated;
}
/* 픽셀 테두리 상자 */
.pxbox {
  background: rgba(16, 12, 28, 0.84);
  color: #fff6d8;
  box-shadow:
    0 -3px 0 0 #0a0812,
    0 3px 0 0 #0a0812,
    -3px 0 0 0 #0a0812,
    3px 0 0 0 #0a0812,
    inset 0 0 0 2px #4b3f6e;
}
.hud {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  font-size: 13px;
  line-height: 1;
  max-width: calc(100% - 26px);
}
.hud .name {
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.hud .dot {
  opacity: 0.6;
}
.hud .fl {
  color: #ffd23f;
  font-weight: 700;
  white-space: nowrap;
}
.hud .out,
.lift button,
.pad button {
  font: inherit;
  cursor: pointer;
  border: 0;
  color: #fff6d8;
  background: #3a2f57;
  box-shadow:
    inset -2px -2px 0 0 #221a38,
    inset 2px 2px 0 0 #5d4d8a;
}
.hud .out {
  margin-left: 4px;
  padding: 4px 6px;
  font-size: 12px;
  white-space: nowrap;
}
.hud .out:active,
.lift button:active,
.pad button:active {
  box-shadow:
    inset 2px 2px 0 0 #221a38,
    inset -2px -2px 0 0 #5d4d8a;
}
.lift {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  padding: 10px;
  max-height: calc(100% - 40px);
  overflow: auto;
  min-width: 180px;
}
.lift-title {
  font-weight: 700;
  font-size: 14px;
  margin-bottom: 8px;
  color: #ffd23f;
}
.lift-grid {
  display: grid;
  grid-template-columns: repeat(4, 42px);
  gap: 6px;
}
.lift-grid button {
  height: 30px;
  font-size: 13px;
  font-weight: 700;
  position: relative;
}
.lift-grid button.here {
  color: #8fd3ff;
}
.lift-grid button.sel {
  background: #ffd23f;
  color: #1c1830;
  box-shadow:
    inset -2px -2px 0 0 #b8900f,
    inset 2px 2px 0 0 #fff0a0;
}
.lift-grid i {
  position: absolute;
  top: -4px;
  right: -3px;
  font-style: normal;
  color: #ff6fae;
  font-size: 12px;
}
.lift-help {
  margin-top: 8px;
  font-size: 12px;
  opacity: 0.8;
}
.lift-x {
  margin-top: 8px;
  padding: 4px 8px;
  font-size: 12px;
}
.pad {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 12px;
  display: flex;
  justify-content: space-between;
  padding: 0 12px;
  pointer-events: none;
}
.pad-side {
  display: flex;
  gap: 10px;
}
.pad button {
  pointer-events: auto;
  width: 58px;
  height: 58px;
  font-size: 20px;
  opacity: 0.9;
  touch-action: none;
}
.pad button.wide {
  width: 74px;
  font-size: 14px;
  font-weight: 700;
}
.pad button.act {
  background: #2f8a5a;
  box-shadow:
    inset -2px -2px 0 0 #1c5a3a,
    inset 2px 2px 0 0 #4cbf80;
}
</style>
