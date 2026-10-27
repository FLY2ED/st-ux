<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { randomNames, search } from '../data.js'
import { closeCamera, faceTracker, openCamera } from '../face.js'
import CameraGate from './CameraGate.vue'
import Leaderboard from './Leaderboard.vue'
import Hero from './stage/Hero.vue'
import { pastelOf } from '../shops.js'
import { sfx } from '../sound.js'
import './pixel.css'

// 점심 간판 피하기: 오늘 먹은 음식이 들어간 진짜 간판들이 쏟아진다. 피하고, 노란 그릇은 받아 먹는다
// 피하는 사람은 캐릭터 만들기에서 고른 내 모습(Hero), 간판 판 색은 이름마다 정해진 파스텔
const FOODS = ['김밥', '국밥', '짜장', '떡볶이', '치킨', '마라탕', '돈까스', '냉면']
// 간판 수리공 이야기 안에서 열리면 embed 와 부탁한 사장님·가게 이름을 받는다. 판이 끝나면 game:over 로 알린다
defineProps({ embed: Boolean, word: { type: String, default: '' }, ownerName: { type: String, default: '' }, ownerArt: { type: String, default: '' }, shopName: { type: String, default: '' } })
const LIVES = 3
const PW = 74
const PH = 98
// 배경 한 칸 = 화면 3px
const DOT = 3

const phase = ref('menu')
const food = ref('')
const info = ref('')
const items = ref([])
const pops = ref([])
const player = ref({ x: 200, flip: false, eat: false, hurt: false, walk: false })
const score = ref(0)
const lives = ref(LIVES)
const eaten = ref(0)
const camOn = ref(false)
const camMsg = ref('')
const mouth = ref(0)
const field = ref(null)
const city = ref(null)
const video = ref(null)

let names = []
let raf = 0
let last = 0
let t0 = 0
let nextDrop = 0
let id = 0
let W = 400
let H = 420
let keys = { left: false, right: false }
let target = null
let stream = null
let tracker = null

const pad = (n) => String(n).padStart(6, '0')
// 맞으면 hurt, 먹으면 만세, 움직이면 걷기. 서 있을 땐 앞을 본다
const pose = (p) => (p.hurt ? 'hurt' : p.eat ? 'cheer' : p.walk ? 'walk' : 'idle')
const dirOf = (p) => (p.eat || (!p.walk && !p.hurt) ? 0 : p.flip ? 2 : 3)
const snap = (v) => Math.round(v / 2) * 2

async function choose(word) {
  const w = (word ?? food.value).trim()
  if (!/[가-힣]{2}/.test(w)) {
    info.value = '음식 이름을 한글 두 글자 이상으로 적어 주세요'
    return
  }
  food.value = w
  phase.value = 'loading'
  const found = await search(w).catch(() => null)
  const exact = [...new Set((found?.rows || []).filter((r) => r.exact).map((r) => r.name))]
  names = exact
  if (names.length < 12) names.push(...(await randomNames(3)).map((n) => n.name).slice(0, 30))
  info.value = found?.count ? `전국에 '${w}' 들어간 간판 ${found.count.toLocaleString()}곳 중 일부가 떨어집니다` : `'${w}' 간판이 별로 없어서 동네 간판을 섞었어요`
  start()
}

function start() {
  const r = field.value.getBoundingClientRect()
  W = r.width
  H = r.height
  paintCity()
  items.value = []
  pops.value = []
  score.value = 0
  lives.value = LIVES
  eaten.value = 0
  player.value = { x: W / 2 - PW / 2, flip: false, eat: false, hurt: false, walk: false }
  phase.value = 'play'
  t0 = performance.now()
  last = t0
  nextDrop = t0 + 900
  safeUntil = 0
  raf = requestAnimationFrame(tick)
}

// 맞은 뒤 잠깐은 다시 맞지 않는다
let safeUntil = 0
// 멈춘 뒤에도 잠깐은 걷는 모습을 유지해 발이 깜빡이지 않게 한다
let walkUntil = 0

function spawn(now) {
  const lvl = 1 + (now - t0) / 15000
  const bowl = Math.random() < 0.12
  const name = bowl ? `${food.value} 한 그릇` : names[Math.floor(Math.random() * names.length)]
  const w = Math.min(W * 0.6, 24 + name.length * 20)
  items.value.push({
    id: ++id,
    name,
    bowl,
    bg: bowl ? '#ffec27' : pastelOf(name),
    x: Math.random() * (W - w),
    y: -50,
    w,
    h: 46,
    vy: (120 + lvl * 40) * (0.8 + Math.random() * 0.5),
  })
}

// 점수가 머리 위로 튀어 오른다
function pop(text, x, kind) {
  const p = { id: ++id, text, x, kind }
  pops.value.push(p)
  setTimeout(() => (pops.value = pops.value.filter((q) => q !== p)), 700)
}

function tick(now) {
  const dt = Math.min(now - last, 50) / 1000
  last = now
  const lvl = 1 + (now - t0) / 15000
  if (now >= nextDrop) {
    spawn(now)
    nextDrop = now + Math.max(820 - lvl * 110, 260)
  }

  // 손·키보드·얼굴 중 마지막으로 움직인 것을 따라간다
  const p = player.value
  const was = p.x
  const face = tracker?.read()
  if (face) {
    target = face.x * W - PW / 2
    mouth.value = face.mouth
  }
  if (keys.left || keys.right) target = null
  if (keys.left) { p.x -= 380 * dt; p.flip = true }
  if (keys.right) { p.x += 380 * dt; p.flip = false }
  if (target !== null) {
    const d = target - p.x
    p.flip = d < -2 ? true : d > 2 ? false : p.flip
    p.x += d * Math.min(1, dt * 12)
  }
  p.x = Math.max(0, Math.min(W - PW, p.x))
  if (Math.abs(p.x - was) > 40 * dt) walkUntil = now + 140
  p.walk = now < walkUntil

  const px = p.x + 14
  const pw = PW - 28
  const py = H - PH + 16
  const keep = []
  for (const it of items.value) {
    it.y += it.vy * dt
    const hit = it.x < px + pw && it.x + it.w > px && it.y + it.h > py && it.y < H - 10
    if (hit) {
      // 카메라로 하면 입을 벌려야 먹는다
      if (it.bowl && (!camOn.value || mouth.value > 0.35)) {
        eaten.value++
        score.value += 50
        p.eat = true
        setTimeout(() => (p.eat = false), 700)
        pop('+50', p.x + PW / 2, 'good')
        sfx.coin()
        continue
      }
      if (!it.bowl && now < safeUntil) {
        keep.push(it)
        continue
      }
      if (!it.bowl) {
        safeUntil = now + 1000
        lives.value--
        p.hurt = true
        setTimeout(() => (p.hurt = false), 450)
        pop('아야!', p.x + PW / 2, 'bad')
        sfx.hurt()
        if (lives.value <= 0) return over()
        continue
      }
    }
    if (it.y > H) {
      if (!it.bowl) score.value += 10
      continue
    }
    keep.push(it)
  }
  items.value = keep
  raf = requestAnimationFrame(tick)
}

function over() {
  sfx.lose()
  cancelAnimationFrame(raf)
  phase.value = 'over'
  window.dispatchEvent(new CustomEvent('game:over', { detail: { game: 'dodge', score: score.value } }))
}

function key(e, down) {
  if (phase.value !== 'play') return
  if (e.key === 'ArrowLeft' || e.key === 'a') keys.left = down
  else if (e.key === 'ArrowRight' || e.key === 'd') keys.right = down
  else return
  e.preventDefault()
}
const kd = (e) => key(e, true)
const ku = (e) => key(e, false)

function point(e) {
  if (phase.value !== 'play' || camOn.value) return
  const r = field.value.getBoundingClientRect()
  target = e.clientX - r.left - PW / 2
}

async function toggleCam() {
  if (camOn.value) {
    closeCamera(stream)
    stream = null
    tracker = null
    camOn.value = false
    target = null
    return
  }
  gate.value = true
}

// 권한 안내와 오류는 CameraGate 가 맡는다. 열리면 얼굴 추적 모델을 받는다
const gate = ref(false)
const startCamera = (id) => openCamera(video.value, id)

async function camReady(s) {
  gate.value = false
  stream = s
  camMsg.value = '얼굴 인식 준비 중…'
  try {
    tracker = await faceTracker(video.value)
    camOn.value = true
    camMsg.value = ''
  } catch {
    closeCamera(stream)
    stream = null
    camMsg.value = '얼굴 인식 모델을 받지 못했어요. 방향키로 해 주세요'
  }
}

// 픽셀 점심 거리: 한낮 하늘, 해, 구름, 두 겹 빌딩, 차양 달린 식당가, 가로등·가로수, 보도블록.
// 같은 씨앗이라 늘 같은 거리
function paintCity() {
  const cv = city.value
  if (!cv) return
  const r = field.value.getBoundingClientRect()
  const w = Math.ceil(r.width / DOT)
  const h = Math.ceil(r.height / DOT)
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const pick = (list) => list[Math.floor(rnd() * list.length)]
  const box = (x, y, bw, bh, c) => {
    g.fillStyle = c
    g.fillRect(x, y, bw, bh)
  }

  // 하늘: 세 줄 띠를 체크 무늬로 이어 붙인다
  const skies = ['#29adff', '#5cc2ff', '#9ad9ff']
  box(0, 0, w, h, skies[0])
  for (let k = 1; k < skies.length; k++) {
    const band = Math.floor(h * (0.14 + k * 0.17))
    for (let y = band; y < h; y++) {
      for (let x = 0; x < w; x++) if (y > band + 3 || (x + y) % 2 === 0) box(x, y, 1, 1, skies[k])
    }
  }
  // 정오의 해와 짧은 햇살
  const sx = Math.floor(w * 0.3)
  const sy = 16
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2
    box(Math.round(sx + 4 + Math.cos(a) * 9), Math.round(sy + 4 + Math.sin(a) * 9), 1, 1, '#fff1e8')
  }
  box(sx, sy, 8, 8, '#ffec27')
  box(sx - 1, sy + 1, 10, 6, '#ffec27')
  box(sx + 1, sy - 1, 6, 10, '#ffec27')
  box(sx + 1, sy + 1, 2, 2, '#fff1e8')
  box(sx + 5, sy + 6, 3, 2, '#ffa300')
  // 구름
  for (const [cx, cy, s] of [[10, 12, 1], [w * 0.45, 7, 1.4], [w * 0.7, 22, 0.9], [w * 0.9, 9, 1.1]]) {
    const x = Math.floor(cx)
    const k = (n) => Math.round(n * s)
    box(x, cy + k(3), k(22), k(4), '#fff1e8')
    box(x + k(4), cy, k(10), k(4), '#fff1e8')
    box(x + k(12), cy + k(1), k(6), k(3), '#fff1e8')
    box(x + k(5), cy + 1, k(4), 1, '#ffffff')
    box(x + k(2), cy + k(7), k(18), 1, '#c2c3c7')
  }

  const ground = h - 14
  // 가장 먼 빌딩: 하늘에 묻힌 옅은 보라
  for (let x = -6; x < w; ) {
    const bw = 12 + Math.floor(rnd() * 16)
    const bh = Math.floor(h * (0.42 + rnd() * 0.3))
    box(x, ground - bh, bw, bh, '#a7b4dc')
    for (let y = ground - bh + 3; y < ground; y += 4) {
      for (let wx = x + 2; wx < x + bw - 2; wx += 3) box(wx, y, 1, 2, '#c4cff0')
    }
    x += bw + 2 + Math.floor(rnd() * 6)
  }
  // 먼 빌딩: 옥상 물탱크·안테나, 창문 몇 개는 햇빛에 반짝인다
  for (let x = -4; x < w; ) {
    const bw = 10 + Math.floor(rnd() * 14)
    const bh = Math.floor(h * (0.3 + rnd() * 0.3))
    const top = ground - bh
    box(x, top, bw, bh, '#83769c')
    box(x, top, bw, 1, '#a99cc0')
    box(x + bw - 1, top, 1, bh, '#6b5f86')
    const roof = rnd()
    if (roof < 0.3) {
      box(x + 2, top - 3, 5, 2, '#5f574f')
      box(x + 2, top - 1, 1, 1, '#5f574f')
      box(x + 6, top - 1, 1, 1, '#5f574f')
    } else if (roof < 0.55) {
      box(x + bw - 4, top - 6, 1, 6, '#5f574f')
      box(x + bw - 5, top - 4, 3, 1, '#5f574f')
      box(x + bw - 4, top - 7, 1, 1, '#ff004d')
    }
    for (let y = top + 3; y < ground - 4; y += 4) {
      for (let wx = x + 2; wx < x + bw - 2; wx += 3) {
        const q = rnd()
        if (q < 0.35) box(wx, y, 1, 2, '#c2c3c7')
        else if (q < 0.4) box(wx, y, 1, 2, '#fff1e8')
      }
    }
    x += bw + 1
  }
  // 가까운 식당가: 처마, 창틀 있는 창문, 간판, 줄무늬 차양, 불 켜진 진열창과 문
  const walls = [
    ['#ab5236', '#8a3f2a'],
    ['#5f574f', '#4a433d'],
    ['#1d2b53', '#141e3c'],
    ['#7e2553', '#62193f'],
    ['#008751', '#006a40'],
    ['#c27a4e', '#a3633d'],
  ]
  const signs = ['#ff004d', '#ffa300', '#fff1e8', '#00e436', '#29adff', '#ffec27']
  const awnings = ['#ff004d', '#29adff', '#00e436', '#ffa300', '#7e2553']
  const lots = []
  for (let x = -3; x < w; ) {
    const bw = 22 + Math.floor(rnd() * 14)
    const bh = Math.floor(h * (0.24 + rnd() * 0.16))
    const top = ground - bh
    const [wall, deep] = pick(walls)
    box(x, top, bw, bh, wall)
    box(x + bw - 1, top, 1, bh, deep)
    // 처마 돌림띠
    box(x - 1, top - 1, bw + 2, 2, '#000')
    box(x, top - 1, bw, 1, '#c2c3c7')
    box(x, top + 1, bw, 1, deep)
    // 위층 창문: 창틀·유리·반사, 가끔 화분이나 에어컨 실외기
    const floorTop = ground - 17
    for (let y = top + 4; y + 5 < floorTop; y += 7) {
      for (let wx = x + 3; wx + 4 < x + bw - 1; wx += 6) {
        box(wx - 1, y - 1, 5, 6, deep)
        const lit = rnd() < 0.25
        box(wx, y, 3, 4, lit ? '#ffccaa' : '#29adff')
        if (!lit) box(wx, y, 1, 2, '#c8ecff')
        box(wx - 1, y + 4, 5, 1, '#c2c3c7')
        const extra = rnd()
        if (extra < 0.1) {
          box(wx, y + 3, 3, 1, '#008751')
          box(wx + 1, y + 2, 1, 1, '#ff77a8')
        } else if (extra < 0.16) {
          box(wx + 3, y + 1, 3, 3, '#c2c3c7')
          box(wx + 4, y + 2, 1, 1, '#5f574f')
        }
      }
    }
    // 점심 장사 중인 집은 환풍구에서 김이 오른다
    if (rnd() < 0.5) {
      const vx = x + 3 + Math.floor(rnd() * (bw - 8))
      box(vx, top - 4, 2, 3, '#5f574f')
      box(vx - 1, top - 5, 4, 1, '#5f574f')
      for (const [dx, dy] of [[0, -7], [1, -8], [0, -10], [-1, -11], [0, -13]]) box(vx + dx, top + dy, 2, 1, 'rgba(255,241,232,0.8)')
    }
    // 1층 간판
    const sy = ground - 17
    const sc = pick(signs)
    box(x + 1, sy, bw - 2, 6, '#000')
    box(x + 2, sy + 1, bw - 4, 4, sc)
    box(x + 2, sy + 1, bw - 4, 1, 'rgba(255,255,255,0.35)')
    const ink = sc === '#fff1e8' || sc === '#ffec27' ? '#1d2b53' : '#fff1e8'
    for (let tx = x + 5; tx < x + bw - 6; tx += 3) box(tx, sy + 2, 2, 2, ink)
    // 줄무늬 차양: 아래 끝이 물결진다
    const aw = pick(awnings)
    const ay = sy + 6
    for (let ax = x + 1; ax < x + bw - 1; ax++) {
      const c = Math.floor((ax - x) / 3) % 2 ? '#fff1e8' : aw
      box(ax, ay, 1, 3, c)
      if ((ax - x) % 3 !== 2) box(ax, ay + 3, 1, 1, c)
    }
    // 진열창과 문
    const fy = ay + 4
    const door = x + Math.floor(bw / 2) - 2
    box(x + 2, fy, bw - 4, ground - fy, deep)
    box(x + 3, fy + 1, door - x - 4, ground - fy - 2, '#ffccaa')
    box(door + 5, fy + 1, x + bw - door - 8, ground - fy - 2, '#ffccaa')
    box(x + 3, fy + 1, 1, 2, '#fff1e8')
    box(door, fy, 4, ground - fy, '#000')
    box(door + 1, fy + 1, 2, ground - fy - 1, '#5f574f')
    box(door + 2, fy + 3, 1, 1, '#ffec27')
    lots.push(x)
    x += bw
  }

  // 보도블록: 두 톤 타일을 엇갈려 깔고, 맨 아래에 연석
  box(0, ground, w, h - ground, '#d6cfd9')
  box(0, ground, w, 1, '#000')
  box(0, ground + 1, w, 1, '#fff1e8')
  for (let y = ground + 2, row = 0; y < h - 3; y += 3, row++) {
    for (let x = row % 2 ? -3 : 0; x < w; x += 6) {
      box(x, y, 6, 3, (x / 3 + row) % 4 < 2 ? '#c2c3c7' : '#d6cfd9')
      box(x, y + 2, 6, 1, '#a39cb0')
      box(x + 5, y, 1, 3, '#a39cb0')
    }
  }
  box(0, h - 3, w, 1, '#5f574f')
  box(0, h - 2, w, 1, '#fff1e8')
  box(0, h - 1, w, 1, '#83769c')

  // 가로수와 가로등: 가게 사이마다 번갈아 선다
  lots.slice(1).forEach((lx, n) => {
    if (n % 2 === 0) {
      // 가로수 화단과 둥근 잎
      box(lx - 3, ground - 2, 7, 3, '#5f574f')
      box(lx - 2, ground - 2, 5, 1, '#ab5236')
      box(lx, ground - 12, 1, 10, '#5f3a24')
      box(lx - 4, ground - 20, 9, 7, '#008751')
      box(lx - 5, ground - 18, 11, 4, '#008751')
      box(lx - 3, ground - 21, 6, 1, '#008751')
      box(lx - 3, ground - 19, 3, 2, '#00e436')
      box(lx + 1, ground - 15, 3, 1, '#006a40')
    } else {
      // 가로등
      box(lx, ground - 26, 1, 26, '#1d2b53')
      box(lx - 1, ground - 2, 3, 2, '#1d2b53')
      box(lx, ground - 26, 4, 1, '#1d2b53')
      box(lx + 3, ground - 25, 3, 2, '#1d2b53')
      box(lx + 4, ground - 23, 1, 1, '#ffec27')
    }
  })
}

onMounted(async () => {
  window.addEventListener('keydown', kd)
  window.addEventListener('keyup', ku)
  await nextTick()
  paintCity()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  closeCamera(stream)
  window.removeEventListener('keydown', kd)
  window.removeEventListener('keyup', ku)
})
</script>

<template>
  <div class="dodge px">
    <div class="arena px-box">
      <div ref="field" class="field" :class="{ shake: player.hurt, playing: phase === 'play' }" @pointermove="point" @pointerdown="point">
        <canvas ref="city" class="city" aria-hidden="true"></canvas>

        <div v-if="phase === 'play'" class="hud px-outline">
          <div class="hud-l">
            <small>SCORE</small>
            <b>{{ pad(score) }}</b>
          </div>
          <div class="hud-m">
            <svg class="bowl-ico" viewBox="0 0 9 6" shape-rendering="crispEdges" aria-hidden="true">
              <rect x="2" y="0" width="5" height="1" fill="#fff1e8" />
              <rect x="1" y="1" width="7" height="1" fill="#fff1e8" />
              <rect x="0" y="2" width="9" height="1" fill="#ff004d" />
              <rect x="1" y="3" width="7" height="1" fill="#ff004d" />
              <rect x="2" y="4" width="5" height="1" fill="#7e2553" />
              <rect x="3" y="5" width="3" height="1" fill="#7e2553" />
            </svg>
            <b>×{{ eaten }}</b>
          </div>
          <div class="hearts" :aria-label="`목숨 ${lives}`">
            <svg v-for="n in LIVES" :key="n" class="heart" :class="{ off: n > lives }" viewBox="0 0 7 6" shape-rendering="crispEdges" aria-hidden="true">
              <path d="M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z" />
              <rect class="shine" x="1" y="1" width="1" height="1" />
            </svg>
          </div>
        </div>

        <div
          v-for="it in items"
          :key="it.id"
          class="item"
          :class="{ bowl: it.bowl }"
          :style="{ transform: `translate(${snap(it.x)}px, ${snap(it.y)}px)`, width: `${it.w}px`, height: `${it.h}px`, '--plate': it.bg }"
        >
          <i class="hook" aria-hidden="true"></i>
          <svg v-if="it.bowl" class="bowl-ico" viewBox="0 0 9 6" shape-rendering="crispEdges" aria-hidden="true">
            <rect x="2" y="0" width="5" height="1" fill="#fff1e8" />
            <rect x="1" y="1" width="7" height="1" fill="#fff1e8" />
            <rect x="0" y="2" width="9" height="1" fill="#ff004d" />
            <rect x="1" y="3" width="7" height="1" fill="#ff004d" />
            <rect x="2" y="4" width="5" height="1" fill="#7e2553" />
            <rect x="3" y="5" width="3" height="1" fill="#7e2553" />
          </svg>
          <span>{{ it.name }}</span>
        </div>

        <i class="shadow" aria-hidden="true" :style="{ transform: `translateX(${snap(player.x + 12)}px)` }"></i>
        <div
          class="me"
          :class="{ hurt: player.hurt, walk: player.walk }"
          :style="{ transform: `translateX(${snap(player.x)}px)`, width: `${PW}px`, height: `${PH}px` }"
          role="img"
          aria-label="나"
        >
          <svg v-if="player.eat" class="yum bowl-ico" viewBox="0 0 9 6" shape-rendering="crispEdges" aria-hidden="true">
            <rect x="2" y="0" width="5" height="1" fill="#fff1e8" />
            <rect x="1" y="1" width="7" height="1" fill="#fff1e8" />
            <rect x="0" y="2" width="9" height="1" fill="#ff004d" />
            <rect x="1" y="3" width="7" height="1" fill="#ff004d" />
            <rect x="2" y="4" width="5" height="1" fill="#7e2553" />
            <rect x="3" y="5" width="3" height="1" fill="#7e2553" />
          </svg>
          <Hero :scale="4" :dir="dirOf(player)" :pose="pose(player)" />
        </div>
        <b v-for="p in pops" :key="p.id" class="pop px-outline" :class="p.kind" :style="{ left: `${snap(p.x)}px` }">{{ p.text }}</b>

        <video ref="video" class="cam" :class="{ on: camOn }" muted playsinline></video>
        <p v-if="camOn" class="mouth" :class="{ open: mouth > 0.35 }">{{ mouth > 0.35 ? '아~ 냠!' : '입 벌리면 먹어요' }}</p>

        <div v-if="phase !== 'play'" class="sheet" :class="phase">
          <template v-if="phase === 'over'">
            <p class="over-title px-outline">GAME OVER</p>
            <p class="over-sub">간판에 맞았어요! 다음 점심엔 더 오래 버텨 봐요</p>
            <div class="result px-box">
              <div><small>SCORE</small><b>{{ pad(score) }}</b></div>
              <div><small>{{ food }}</small><b>{{ eaten }}그릇</b></div>
            </div>
            <div class="actions">
              <button class="px-btn" @click="start">▶ 한 판 더</button>
              <button class="px-btn alt" @click="phase = 'menu'">메뉴 바꾸기</button>
            </div>
            <Leaderboard class="score-board px-box" game="dodge" :score="score" />
          </template>
          <template v-else>
            <p class="kicker px-outline">1P · LUNCH RUSH</p>
            <h1 class="title px-outline">점심 간판<br /><em>피하기</em></h1>
            <div class="rules px-box">
              <p><span class="tag red">간판</span> 피하면 <b>+10</b></p>
              <p><span class="tag yellow">그릇</span> 받아 먹으면 <b>+50</b></p>
              <p class="keys">← → · A D · 마우스 · 목숨 {{ LIVES }}개</p>
            </div>
            <form class="ask" @submit.prevent="choose()">
              <input id="dodge-food" v-model="food" type="text" class="px-input" placeholder="오늘 먹은 음식 (예: 국밥)" maxlength="10" aria-label="오늘 먹은 음식" />
              <button class="px-btn" :disabled="phase === 'loading'">{{ phase === 'loading' ? '찾는 중' : '▶ START' }}</button>
            </form>
            <div class="chips">
              <button v-for="f in FOODS" :key="f" class="px-btn chip" :disabled="phase === 'loading'" @click="choose(f)">{{ f }}</button>
            </div>
            <p v-if="phase === 'loading'" class="press px-blink">간판 찾는 중…</p>
            <p v-else-if="info" class="food-notice">{{ info }}</p>
            <p v-else class="press px-blink">음식을 고르면 시작!</p>
          </template>
        </div>
      </div>
    </div>

    <CameraGate v-if="gate" class="camera-gate" :open="startCamera" purpose="고개와 입으로 조종하기 위해" @ready="camReady" @cancel="gate = false" />
    <div class="foot">
      <button class="px-btn cam-btn" :class="{ on: camOn }" @click="toggleCam">{{ camOn ? '카메라 끄기' : '얼굴로 조종' }}</button>
      <span class="camera-note">{{ camMsg || (camOn ? '고개를 좌우로, 그릇 앞에서 입을 벌려요' : phase === 'play' ? info : '') }}</span>
    </div>
  </div>
</template>

<style scoped>
.dodge {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
  padding: 10px 18px 18px;
  color: var(--px-white);
  background: #000;
}

.arena {
  --line: var(--px-silver);
  position: relative;
}

.field {
  position: relative;
  height: min(460px, 62dvh);
  overflow: hidden;
  touch-action: none;
  background: var(--px-blue);
}

.field.shake {
  animation: shake 0.3s steps(2) 1;
}

.city {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}

/* 머리 위 HUD */
.hud {
  position: absolute;
  inset: 10px 12px auto;
  z-index: 3;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  pointer-events: none;
}

/* 간판이 지나가도 숫자가 읽히게 어두운 판을 깐다 */
.hud-l,
.hud-m,
.hearts {
  padding: 4px 8px 6px;
  background: rgb(29 27 46 / 0.72);
  box-shadow: 0 0 0 2px #000, inset 0 2px rgb(255 255 255 / 0.12);
}

.hud small {
  display: block;
  font-size: 12px;
  color: var(--px-yellow);
}

.hud b {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 1px;
}

.hud-m {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.hud-m b {
  font-size: 12px;
}

.hud .bowl-ico {
  width: 27px;
  height: 18px;
}

.hearts {
  display: flex;
  gap: 4px;
  padding: 6px 8px;
}

.heart {
  width: 28px;
  height: 24px;
  fill: var(--px-red);
  filter: drop-shadow(2px 0 0 #000) drop-shadow(-2px 0 0 #000) drop-shadow(0 2px 0 #000) drop-shadow(0 -2px 0 #000);
}

.heart .shine {
  fill: var(--px-white);
}

.heart.off {
  fill: var(--px-ash);
}

.heart.off .shine {
  fill: var(--px-ash);
}

/* 떨어지는 간판: 파스텔 판에 짙은 3px 테두리, 네 귀퉁이 나사, 위쪽 반사광. 위에는 끊어진 걸이 두 가닥 */
.item {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 7px;
  border: 3px solid #1d1b2e;
  font-family: var(--game-font);
  -webkit-font-smoothing: none;
  color: #1d1b2e;
  background:
    radial-gradient(circle, #1d1b2e 0 1.5px, transparent 2px) 3px 3px / 4px 4px no-repeat,
    radial-gradient(circle, #1d1b2e 0 1.5px, transparent 2px) calc(100% - 3px) 3px / 4px 4px no-repeat,
    radial-gradient(circle, #1d1b2e 0 1.5px, transparent 2px) 3px calc(100% - 3px) / 4px 4px no-repeat,
    radial-gradient(circle, #1d1b2e 0 1.5px, transparent 2px) calc(100% - 3px) calc(100% - 3px) / 4px 4px no-repeat,
    var(--plate);
  box-shadow:
    inset 0 3px rgb(255 255 255 / 0.55),
    inset 0 -4px rgb(0 0 0 / 0.16),
    4px 4px 0 0 rgb(0 0 0 / 0.35);
  will-change: transform;
}

.item .hook {
  position: absolute;
  bottom: calc(100% + 3px);
  left: 12px;
  right: 12px;
  height: 9px;
  background:
    linear-gradient(#1d1b2e, #1d1b2e) 0 100% / 3px 9px no-repeat,
    linear-gradient(#1d1b2e, #1d1b2e) 100% 100% / 3px 9px no-repeat,
    linear-gradient(#5f574f, #5f574f) 3px 0 / 3px 3px no-repeat,
    linear-gradient(#5f574f, #5f574f) calc(100% - 3px) 3px / 3px 3px no-repeat;
}

.item span {
  max-width: 100%;
  overflow: hidden;
  font-size: 20px;
  line-height: 1;
  letter-spacing: 0;
  text-overflow: clip;
  white-space: nowrap;
  text-shadow: 0 2px rgb(255 255 255 / 0.45);
}

.item.bowl {
  animation: glow 0.4s steps(1) infinite;
}

.item.bowl span {
  font-size: 12px;
  font-weight: 700;
}

.item .bowl-ico {
  flex: none;
  width: 18px;
  height: 12px;
}

/* 내 캐릭터: 판정 상자(PW×PH) 바닥 가운데에 선다 */
.me {
  position: absolute;
  left: 0;
  bottom: 10px;
  z-index: 2;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.me :deep(canvas) {
  flex: none;
  margin-bottom: -2px;
  filter: drop-shadow(0 2px 0 rgb(0 0 0 / 0.25));
}

.playing .me:not(.walk) {
  animation: bob 0.6s steps(1) infinite;
}

.me.hurt,
.playing .me.hurt {
  animation: blink 0.15s steps(1) 3;
}

/* 받아 낸 그릇을 옆에 번쩍 든다 */
.me .yum {
  position: absolute;
  bottom: 52px;
  left: calc(100% - 8px);
  width: 27px;
  height: 18px;
  filter: drop-shadow(2px 0 0 #000) drop-shadow(-2px 0 0 #000) drop-shadow(0 2px 0 #000) drop-shadow(0 -2px 0 #000);
  animation: lift 0.3s steps(1) infinite;
}

.shadow {
  position: absolute;
  left: 0;
  bottom: 7px;
  z-index: 1;
  width: 50px;
  height: 6px;
  background:
    linear-gradient(rgb(0 0 0 / 0.3), rgb(0 0 0 / 0.3)) 6px 0 / calc(100% - 12px) 100% no-repeat,
    linear-gradient(rgb(0 0 0 / 0.3), rgb(0 0 0 / 0.3)) 0 2px / 100% 2px no-repeat;
}

.pop {
  position: absolute;
  bottom: 112px;
  z-index: 3;
  font-size: 24px;
  transform: translateX(-50%);
  animation: rise 0.7s steps(7) forwards;
  pointer-events: none;
}

.pop.good {
  color: var(--px-yellow);
}

.pop.bad {
  color: var(--px-red);
}

.cam {
  position: absolute;
  right: 10px;
  top: 64px;
  display: none;
  width: 120px;
  box-shadow: 0 0 0 4px #000;
  transform: scaleX(-1);
  z-index: 3;
}

.cam.on {
  display: block;
}

.mouth {
  position: absolute;
  right: 10px;
  top: 164px;
  z-index: 3;
  margin: 0;
  padding: 4px 8px;
  font-size: 12px;
  color: var(--px-white);
  background: var(--px-navy);
  box-shadow: 0 0 0 2px #000;
}

.mouth.open {
  color: var(--px-navy);
  background: var(--px-yellow);
}

/* 타이틀·게임오버 화면: 거리 위에 반투명 남색을 깔고 위에 쌓는다 */
.sheet {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: grid;
  align-content: start;
  justify-items: center;
  gap: 12px;
  overflow-y: auto;
  padding: 22px 18px 20px;
  text-align: center;
  background: rgba(29, 43, 83, 0.78);
}

.kicker {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--px-yellow);
}

.title {
  margin: 0;
  font-size: 36px;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: 0;
  color: var(--px-white);
}

.title em {
  font-style: normal;
  color: var(--px-yellow);
}

.rules {
  display: grid;
  gap: 6px;
  width: min(360px, 100%);
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.55);
}

.rules p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.rules b {
  color: var(--px-green);
}

.rules .keys {
  color: var(--px-silver);
}

.tag {
  display: inline-block;
  padding: 1px 6px;
  font-weight: 700;
  box-shadow: inset 0 0 0 2px #000;
}

.tag.red {
  color: var(--px-white);
  background: var(--px-red);
}

.tag.yellow {
  color: var(--px-navy);
  background: var(--px-yellow);
}

.ask {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  width: min(380px, 100%);
}

.chips {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px 8px;
  width: min(380px, 100%);
}

.mac-win .px .chip {
  --bg: var(--px-white);
  --fg: var(--px-navy);
  min-width: 0;
  height: 32px;
  padding: 0 4px;
}

.mac-win .px .chip:hover:not(:disabled) {
  --bg: var(--px-peach);
}

.mac-win .px .alt {
  --bg: var(--px-silver);
  --fg: var(--px-navy);
}

.press {
  margin: 2px 0 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--px-white);
}

.food-notice,
.camera-note {
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--px-silver);
  overflow-wrap: anywhere;
}

.food-notice {
  width: min(380px, 100%);
  color: var(--px-peach);
}

.over-title {
  margin: 8px 0 0;
  font-size: 48px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--px-red);
}

.over-sub {
  margin: 0;
  font-size: 12px;
  color: var(--px-white);
}

.result {
  display: grid;
  grid-template-columns: 1fr 1fr;
  width: min(360px, 100%);
  background: rgba(0, 0, 0, 0.6);
}

.result div {
  display: grid;
  gap: 2px;
  padding: 10px;
}

.result div + div {
  box-shadow: inset 4px 0 0 0 var(--px-white);
}

.result small {
  font-size: 12px;
  color: var(--px-yellow);
}

.result b {
  font-size: 24px;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  width: min(380px, 100%);
}

.dodge .sheet .score-board {
  --line: var(--px-white);
  width: min(360px, 100%);
  padding: 12px;
  border-radius: 0;
  color: var(--px-white);
  background: rgba(0, 0, 0, 0.6);
  font-size: 12px;
}

.score-board :deep(.lb-head) {
  flex-wrap: wrap;
  gap: 6px;
}

.score-board :deep(.lb-head strong) {
  color: var(--px-yellow);
}

.score-board :deep(.muted),
.score-board :deep(.lb-hint) {
  color: var(--px-silver);
}

.score-board :deep(.pts) {
  color: var(--px-green);
}

.score-board :deep(li),
.score-board :deep(.lb-me) {
  border-radius: 0;
}

.score-board :deep(.lb-me.rec) {
  color: var(--px-navy);
  background: var(--px-yellow);
}

.score-board :deep(.lb-join) {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
}

.score-board :deep(.lb-join input) {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 0;
  font: inherit;
  color: var(--px-black);
  background: var(--px-white);
  box-shadow: 0 0 0 2px #000;
  outline: none;
}

.score-board :deep(.lb-join button),
.camera-gate :deep(.btns button) {
  min-height: 36px;
  padding: 6px 14px;
  border: 0;
  border-radius: 0;
  font: inherit;
  font-weight: 700;
  color: var(--px-navy);
  background: var(--px-yellow);
  box-shadow: inset -3px -3px 0 rgba(0, 0, 0, 0.3), 0 0 0 2px #000;
  cursor: pointer;
}

.score-board :deep(.lb-join button:disabled) {
  color: var(--px-silver);
  background: var(--px-ash);
  cursor: default;
}

.foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;
  min-height: 52px;
}

.mac-win .px .cam-btn {
  --bg: var(--px-silver);
  --fg: var(--px-navy);
  flex: none;
  height: 36px;
}

.mac-win .px .cam-btn.on {
  --bg: var(--px-green);
}

.camera-note {
  flex: 1 1 180px;
}

.camera-note:empty {
  display: none;
}

.camera-gate {
  background: rgba(0, 0, 0, 0.88);
}

.dodge .camera-gate :deep(.card) {
  max-width: 100%;
  border-radius: 0;
  font-family: Galmuri11, sans-serif;
  color: var(--px-white);
  background: var(--px-navy);
  box-shadow: 0 0 0 4px var(--px-white), 0 0 0 8px #000;
}

.dodge .camera-gate :deep(.facts),
.dodge .camera-gate :deep(.steps) {
  border-radius: 0;
  background: rgba(0, 0, 0, 0.4);
}

.camera-gate :deep(.btns button:first-child) {
  color: var(--px-navy);
  background: var(--px-silver);
}

@keyframes blink {
  50% {
    opacity: 0.2;
  }
}

@keyframes lift {
  50% {
    translate: 0 -3px;
  }
}

@keyframes bob {
  50% {
    bottom: 13px;
  }
}

@keyframes shake {
  0% {
    transform: translate(4px, 0);
  }
  50% {
    transform: translate(-4px, 2px);
  }
}

@keyframes glow {
  50% {
    box-shadow:
      inset 0 0 0 3px var(--px-white),
      4px 4px 0 0 rgb(0 0 0 / 0.35),
      0 0 14px 3px rgb(255 236 39 / 0.75);
  }
}

@keyframes rise {
  to {
    transform: translate(-50%, -42px);
    opacity: 0;
  }
}
</style>
