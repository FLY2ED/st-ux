<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { randomNames, search } from '../data.js'
import { closeCamera, faceTracker, openCamera } from '../face.js'
import { react } from '../mood.js'
import { sfx } from '../sound.js'

// 점심 간판 피하기: 오늘 먹은 음식이 들어간 진짜 간판들이 쏟아진다. 피하고, 노란 그릇은 받아 먹는다
const art = (n) => new URL(`../assets/${n}.webp`, import.meta.url).href
const BOARDS = [art('sign-plain'), art('sign-awning'), art('sign-broken')]
const BOWL = art('sign-hl')
const RUN = art('me-run')
const EAT = art('me-eat')
const FOODS = ['김밥', '국밥', '짜장', '떡볶이', '치킨', '마라탕', '돈까스', '냉면']
const LIVES = 3
const PW = 74
const PH = 98

const phase = ref('menu')
const food = ref('')
const info = ref('')
const items = ref([])
const player = ref({ x: 200, flip: false, eat: false, hurt: false })
const score = ref(0)
const lives = ref(LIVES)
const eaten = ref(0)
const camOn = ref(false)
const camMsg = ref('')
const mouth = ref(0)
const field = ref(null)
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
  items.value = []
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
  const w = Math.min(W * 0.6, 34 + name.length * 17)
  items.value.push({
    id: ++id,
    name,
    bowl,
    img: bowl ? BOWL : BOARDS[id % BOARDS.length],
    x: Math.random() * (W - w),
    y: -50,
    w,
    h: 46,
    vy: (120 + lvl * 40) * (0.8 + Math.random() * 0.5),
    rot: (Math.random() - 0.5) * 16,
  })
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
        sfx.right()
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
        sfx.wrong()
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
  cancelAnimationFrame(raf)
  phase.value = 'over'
  react('panic', 2400)
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
  camMsg.value = '카메라 켜는 중…'
  try {
    stream = await openCamera(video.value)
    tracker = await faceTracker(video.value)
    camOn.value = true
    camMsg.value = ''
  } catch {
    closeCamera(stream)
    stream = null
    camMsg.value = '카메라를 쓸 수 없어요. 방향키로 해 주세요'
  }
}

onMounted(() => {
  window.addEventListener('keydown', kd)
  window.addEventListener('keyup', ku)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  closeCamera(stream)
  window.removeEventListener('keydown', kd)
  window.removeEventListener('keyup', ku)
})
</script>

<template>
  <div class="dodge">
    <div class="hud hand">
      <span>점수 <b>{{ score }}</b></span>
      <span>먹은 그릇 {{ eaten }}</span>
      <span class="hearts">{{ '♥'.repeat(Math.max(lives, 0)) }}<i>{{ '♡'.repeat(LIVES - Math.max(lives, 0)) }}</i></span>
    </div>

    <div ref="field" class="field" @pointermove="point" @pointerdown="point">
      <div
        v-for="it in items"
        :key="it.id"
        class="item"
        :class="{ bowl: it.bowl }"
        :style="{ transform: `translate(${it.x}px, ${it.y}px) rotate(${it.rot}deg)`, width: `${it.w}px`, height: `${it.h}px` }"
      >
        <img :src="it.img" alt="" draggable="false" />
        <span class="hand">{{ it.name }}</span>
      </div>
      <img
        class="me"
        :class="{ hurt: player.hurt }"
        :src="player.eat ? EAT : RUN"
        :style="{ transform: `translateX(${player.x}px) scaleX(${player.flip ? 1 : -1})`, width: `${PW}px`, height: `${PH}px` }"
        alt="나"
        draggable="false"
      />
      <div class="ground" aria-hidden="true"></div>

      <video ref="video" class="cam" :class="{ on: camOn }" muted playsinline></video>
      <p v-if="camOn" class="mouth hand" :class="{ open: mouth > 0.35 }">{{ mouth > 0.35 ? '아~ 냠!' : '입 벌리면 먹어요' }}</p>

      <div v-if="phase !== 'play'" class="cover">
        <template v-if="phase === 'over'">
          <p class="t hand">간판에 맞았다…</p>
          <p class="hand">{{ score }}점 · {{ food }} {{ eaten }}그릇 먹음</p>
          <div class="row">
            <button class="go" @click="start">한 판 더</button>
            <button @click="phase = 'menu'">메뉴 바꾸기</button>
          </div>
        </template>
        <template v-else>
          <p class="t hand">오늘 점심 뭐 먹었어?</p>
          <p>그 음식이 들어간 <b>진짜 간판</b>들이 하늘에서 떨어져요.<br />← → 키나 마우스로 피하고, 노란 그릇은 받아 먹기!</p>
          <form class="row" @submit.prevent="choose()">
            <input v-model="food" class="food hand" placeholder="예: 국밥" maxlength="10" />
            <button class="go" :disabled="phase === 'loading'">{{ phase === 'loading' ? '간판 찾는 중…' : '시작' }}</button>
          </form>
          <div class="chips">
            <button v-for="f in FOODS" :key="f" class="chip" :disabled="phase === 'loading'" @click="choose(f)">{{ f }}</button>
          </div>
          <p v-if="info" class="muted">{{ info }}</p>
        </template>
      </div>
    </div>

    <div class="foot">
      <button :class="{ on: camOn }" @click="toggleCam">📷 {{ camOn ? '카메라 끄기' : '얼굴로 조종하기' }}</button>
      <span class="muted">{{ camMsg || (camOn ? '고개를 좌우로 움직이고, 노란 그릇 앞에서 입을 벌려요' : info) }}</span>
    </div>
  </div>
</template>

<style scoped>
.dodge {
  display: grid;
  gap: 8px;
}

.hud {
  display: flex;
  gap: 14px;
  font-size: 18px;
}

.hud b {
  background: linear-gradient(transparent 55%, var(--hl) 55% 90%, transparent 90%);
}

.hearts {
  margin-left: auto;
}

.hearts i {
  font-style: normal;
  opacity: 0.4;
}

.field {
  position: relative;
  height: min(440px, 58dvh);
  overflow: hidden;
  touch-action: none;
  border: 2px solid var(--ink);
  border-radius: var(--wob);
  background: repeating-linear-gradient(transparent 0 27px, var(--rule) 27px 28px), var(--paper);
}

.item {
  position: absolute;
  left: 0;
  top: 0;
  display: grid;
  place-items: center;
  will-change: transform;
}

.item img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
}

.item span {
  position: relative;
  font-size: 17px;
  white-space: nowrap;
}

.me {
  position: absolute;
  left: 0;
  bottom: 6px;
  object-fit: contain;
  z-index: 2;
}

.me.hurt {
  animation: blink 0.15s steps(1) 3;
}

.ground {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 12px;
  border-top: 2.5px solid var(--ink);
}

.cam {
  position: absolute;
  right: 8px;
  top: 8px;
  width: 120px;
  border: 2px solid var(--ink);
  border-radius: 8px;
  transform: scaleX(-1);
  filter: grayscale(1) contrast(1.6) brightness(1.1);
  display: none;
  z-index: 3;
}

.cam.on {
  display: block;
}

.mouth {
  position: absolute;
  right: 8px;
  top: 104px;
  margin: 0;
  padding: 0 6px;
  font-size: 15px;
  background: #fff;
  border: 1.5px solid var(--ink);
  border-radius: 10px;
  z-index: 3;
}

.mouth.open {
  background: var(--hl);
}

.cover {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 8px;
  padding: 20px;
  text-align: center;
  background: rgb(255 253 246 / 0.9);
  z-index: 5;
}

.cover p {
  margin: 0;
}

.cover .t {
  font-size: 34px;
  background: linear-gradient(transparent 58%, var(--hl) 58% 90%, transparent 90%);
}

.food {
  width: 150px;
  font-size: 20px;
  padding: 4px 10px;
  border: 2px solid var(--ink);
  border-radius: var(--wob2);
}

.go {
  background: var(--hl);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.chip {
  min-height: 28px;
  padding: 2px 10px;
  font-size: 15px;
  box-shadow: 1px 2px 0 var(--ink);
}

.foot {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12.5px;
}

@keyframes blink {
  50% {
    opacity: 0.2;
  }
}
</style>
