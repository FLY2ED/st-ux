<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { randomNames, search } from '../data.js'
import { closeCamera, faceTracker, openCamera } from '../face.js'
import CameraGate from './CameraGate.vue'
import Leaderboard from './Leaderboard.vue'
import { sfx } from '../sound.js'
import './pixel.css'

// 점심 간판 피하기: 오늘 먹은 음식이 들어간 진짜 간판들이 쏟아진다. 피하고, 노란 그릇은 받아 먹는다
const art = (n) => new URL(`../assets/${n}.webp`, import.meta.url).href
const RUN = art('kid-run')
const EAT = art('kid-eat')
// 간판 색은 PICO-8 16색 중 글자가 잘 읽히는 짝만 쓴다
const TINTS = [
  ['#fff1e8', '#1d2b53'],
  ['#ff004d', '#fff1e8'],
  ['#29adff', '#1d2b53'],
  ['#00e436', '#1d2b53'],
  ['#ffa300', '#1d2b53'],
  ['#7e2553', '#fff1e8'],
]
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
const player = ref({ x: 200, flip: false, eat: false, hurt: false })
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
  player.value = { x: W / 2 - PW / 2, flip: false, eat: false, hurt: false }
  phase.value = 'play'
  t0 = performance.now()
  last = t0
  nextDrop = t0 + 900
  safeUntil = 0
  raf = requestAnimationFrame(tick)
}

// 맞은 뒤 잠깐은 다시 맞지 않는다
let safeUntil = 0

function spawn(now) {
  const lvl = 1 + (now - t0) / 15000
  const bowl = Math.random() < 0.12
  const name = bowl ? `${food.value} 한 그릇` : names[Math.floor(Math.random() * names.length)]
  const w = Math.min(W * 0.6, 24 + name.length * 20)
  const [bg, fg] = TINTS[id % TINTS.length]
  items.value.push({
    id: ++id,
    name,
    bowl,
    bg,
    fg,
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

// 픽셀 점심 거리: 하늘, 구름, 먼 빌딩, 간판 달린 가게, 보도블록. 같은 씨앗이라 늘 같은 거리
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
  const box = (x, y, bw, bh, c) => {
    g.fillStyle = c
    g.fillRect(x, y, bw, bh)
  }

  box(0, 0, w, h, '#29adff')
  // 아래로 갈수록 옅은 하늘: 체크 무늬로 섞는다
  const band = Math.floor(h * 0.42)
  for (let y = band; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y > band + 8 || (x + y) % 2 === 0) box(x, y, 1, 1, '#8fd8ff')
    }
  }
  // 해
  const sx = Math.floor(w * 0.3)
  box(sx, 22, 8, 8, '#ffec27')
  box(sx - 1, 23, 10, 6, '#ffec27')
  box(sx + 1, 21, 6, 10, '#ffec27')
  // 구름
  for (const [cx, cy, s] of [[10, 14, 1], [w * 0.45, 8, 1.4], [w * 0.7, 24, 0.9]]) {
    const x = Math.floor(cx)
    const k = (n) => Math.round(n * s)
    box(x, cy + k(3), k(22), k(4), '#fff1e8')
    box(x + k(4), cy, k(10), k(4), '#fff1e8')
    box(x + k(12), cy + k(1), k(6), k(3), '#fff1e8')
    box(x + k(2), cy + k(7), k(18), 1, '#c2c3c7')
  }

  const ground = h - 11
  // 먼 빌딩
  for (let x = -4; x < w; ) {
    const bw = 10 + Math.floor(rnd() * 14)
    const bh = Math.floor(h * (0.3 + rnd() * 0.32))
    box(x, ground - bh, bw, bh, '#83769c')
    for (let y = ground - bh + 3; y < ground - 4; y += 4) {
      for (let wx = x + 2; wx < x + bw - 2; wx += 3) if (rnd() < 0.35) box(wx, y, 1, 2, '#c2c3c7')
    }
    x += bw + 1
  }
  // 가까운 가게: 지붕선, 창문, 간판, 문
  const walls = ['#5f574f', '#ab5236', '#1d2b53', '#7e2553', '#008751']
  const signs = ['#ff004d', '#ffa300', '#fff1e8', '#00e436', '#29adff', '#ffec27']
  for (let x = -3; x < w; ) {
    const bw = 18 + Math.floor(rnd() * 16)
    const bh = Math.floor(h * (0.16 + rnd() * 0.2))
    const top = ground - bh
    const wall = walls[Math.floor(rnd() * walls.length)]
    box(x, top, bw, bh, wall)
    box(x, top, bw, 1, '#000')
    box(x, top + 1, bw, 1, 'rgba(255,255,255,0.18)')
    for (let y = top + 4; y < ground - 14; y += 5) {
      for (let wx = x + 2; wx < x + bw - 3; wx += 4) box(wx, y, 2, 3, rnd() < 0.7 ? '#ffccaa' : '#1d2b53')
    }
    // 1층 간판과 출입문
    const sy = ground - 12
    const sc = signs[Math.floor(rnd() * signs.length)]
    box(x + 1, sy, bw - 2, 5, '#000')
    box(x + 2, sy + 1, bw - 4, 3, sc)
    const ink = sc === '#fff1e8' || sc === '#ffec27' ? '#1d2b53' : '#fff1e8'
    for (let tx = x + 4; tx < x + bw - 5; tx += 3) box(tx, sy + 2, 2, 1, ink)
    box(x + Math.floor(bw / 2) - 2, ground - 6, 4, 6, '#000')
    box(x + 2, ground - 6, Math.floor(bw / 2) - 5, 4, '#c2c3c7')
    x += bw
  }
  // 보도블록과 연석
  box(0, ground, w, h - ground, '#c2c3c7')
  box(0, ground, w, 1, '#000')
  box(0, ground + 1, w, 1, '#fff1e8')
  for (let y = ground + 4; y < h; y += 4) box(0, y, w, 1, '#83769c')
  for (let y = ground + 1; y < h; y += 4) {
    for (let x = (y / 4) % 2 ? 0 : 4; x < w; x += 8) box(x, y + 1, 1, 3, '#83769c')
  }
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
          :style="{ transform: `translate(${snap(it.x)}px, ${snap(it.y)}px)`, width: `${it.w}px`, height: `${it.h}px`, '--bg': it.bowl ? '#ffec27' : it.bg, '--fg': it.bowl ? '#1d2b53' : it.fg }"
        >
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
        <img
          class="me"
          :class="{ hurt: player.hurt }"
          :src="player.eat ? EAT : RUN"
          :style="{ transform: `translateX(${snap(player.x)}px) scaleX(${player.flip ? -1 : 1})`, width: `${PW}px`, height: `${PH}px` }"
          alt="나"
          draggable="false"
        />
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
  inset: 8px 10px auto;
  z-index: 3;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  pointer-events: none;
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
  padding-top: 8px;
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
  padding-top: 6px;
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

/* 떨어지는 간판: 검은 2px 테두리, 딱 떨어지는 그림자, 나사 두 개 */
.item {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  overflow: hidden;
  padding: 0 8px;
  font-family: Galmuri9, Galmuri11, sans-serif;
  color: var(--fg);
  background: var(--bg);
  box-shadow:
    inset 0 0 0 2px #000,
    inset 0 -6px 0 0 rgba(0, 0, 0, 0.18),
    4px 4px 0 0 rgba(0, 0, 0, 0.35);
  will-change: transform;
}

.item::before,
.item::after {
  content: '';
  position: absolute;
  top: 5px;
  width: 2px;
  height: 2px;
  background: rgba(0, 0, 0, 0.55);
}

.item::before {
  left: 5px;
}

.item::after {
  right: 5px;
}

.item span {
  max-width: 100%;
  overflow: hidden;
  font-size: 20px;
  text-overflow: clip;
  white-space: nowrap;
}

.item.bowl {
  animation: glow 0.4s steps(1) infinite;
}

.item.bowl span {
  font-size: 12px;
  font-family: Galmuri11, sans-serif;
  font-weight: 700;
}

.item .bowl-ico {
  flex: none;
  width: 18px;
  height: 12px;
}

.me {
  position: absolute;
  left: 0;
  bottom: 10px;
  z-index: 2;
  object-fit: contain;
  image-rendering: pixelated;
}

.playing .me {
  animation: bob 0.3s steps(1) infinite;
}

.me.hurt,
.playing .me.hurt {
  animation: blink 0.15s steps(1) 3;
}

.shadow {
  position: absolute;
  left: 0;
  bottom: 8px;
  z-index: 1;
  width: 50px;
  height: 6px;
  background: rgba(0, 0, 0, 0.28);
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
      inset 0 0 0 2px #000,
      inset 0 0 0 4px var(--px-white),
      4px 4px 0 0 rgba(0, 0, 0, 0.35);
  }
}

@keyframes rise {
  to {
    transform: translate(-50%, -42px);
    opacity: 0;
  }
}
</style>
