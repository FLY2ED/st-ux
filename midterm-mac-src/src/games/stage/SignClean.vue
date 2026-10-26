<script setup>
// 간판 청소: 그을음·새똥·전단지로 뒤덮여 꺼진 간판을 문질러 닦는다.
// 다 닦으면 간판에 불이 들어오고, 빨리 닦을수록 점수가 높다. 세 개를 닦으면 끝
// embed(이야기 속 부탁): 사장님이 옆에 서서 말을 걸고, 첫 간판은 그 가게 간판이다
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { signPool } from '../../data.js'
import { pastelOf } from '../../shops.js'
import { sfx } from '../../sound.js'
import Hero from './Hero.vue'
import './stage.css'

const props = defineProps({
  embed: Boolean,
  ownerName: { type: String, default: '' },
  ownerArt: { type: String, default: '' },
  shopName: { type: String, default: '' },
})
const ROUNDS = 3
const CELL = 4 // 때 한 칸 = 화면 4px (픽셀 느낌 + 가벼운 계산)
const CLEAN = 0.9 // 이만큼 닦이면 나머지는 저절로 떨어진다
const BEST_KEY = 'gp-clean-best'
const ASK = ['우리 간판이에요! 박박 문질러 주세요', '옆집 간판도 새까매요. 부탁해요!', '마지막 하나! 이것만 닦으면 골목이 환해져요']
const CHEER = ['와, 불이 들어왔어요!', '반짝반짝하네요!', '글자가 숨을 쉬어요!']

const phase = ref('loading') // loading | scrub | lit | done
const round = ref(0)
const signs = ref([])
const clean = ref(0)
const score = ref(0)
const gained = ref(0)
const secs = ref(0)
const best = ref(Number(localStorage.getItem(BEST_KEY)) || 0)
const say = ref('')
const heroPose = ref('idle')
const sponge = ref({ x: 0.5, y: 0.5, on: false })
const sparks = ref([])
const box = ref(null)
const cv = ref(null)

const sign = computed(() => signs.value[round.value] || null)
const nameSize = computed(() => {
  const n = [...(sign.value?.name || '')].length
  return `clamp(26px, ${Math.max(4.2, 15 - n * 1.2)}cqi, ${Math.max(40, 104 - n * 8)}px)`
})

let ctx = null
let cols = 0
let rows = 0
let last = null
let started = 0
let clock = 0
let lastCheck = 0
let lastSound = 0
let spaceDown = false
const timers = new Set()
const later = (fn, ms) => {
  const t = setTimeout(() => {
    timers.delete(t)
    fn()
  }, ms)
  timers.add(t)
}
const rnd = (a, b) => a + Math.random() * (b - a)

async function pickSigns() {
  const out = []
  if (props.shopName) out.push({ name: props.shopName, cat: '', region: '' })
  for (let k = 0; k < 4 && out.length < ROUNDS; k++) {
    const rows = await signPool().catch(() => [])
    const ok = rows.filter((r) => /^[가-힣0-9A-Za-z]{2,9}$/.test(r.name) && /[가-힣]/.test(r.name) && !out.some((o) => o.name === r.name))
    while (ok.length && out.length < ROUNDS) out.push(ok.splice(Math.floor(Math.random() * ok.length), 1)[0])
  }
  while (out.length < ROUNDS) out.push({ name: ['행복슈퍼', '골목분식', '달빛세탁'][out.length], cat: '', region: '' })
  return out
}

// 때 그리기: 그을음 바탕 → 흘러내린 자국 → 새똥 → 전단지. 모두 낮은 해상도 칸으로 찍는다
function grime() {
  const el = box.value
  const c = cv.value
  if (!el || !c) return
  cols = Math.ceil(el.clientWidth / CELL)
  rows = Math.ceil(el.clientHeight / CELL)
  c.width = cols
  c.height = rows
  ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.fillStyle = '#2b2622'
  ctx.fillRect(0, 0, cols, rows)
  // 그을음 얼룩
  for (let k = 0; k < cols * rows * 0.35; k++) {
    const v = Math.floor(rnd(24, 70))
    ctx.fillStyle = `rgb(${v + 8} ${v + 2} ${v - 4})`
    ctx.fillRect(Math.floor(rnd(0, cols)), Math.floor(rnd(0, rows)), 1, 1)
  }
  // 흘러내린 빗물 자국
  for (let k = 0; k < cols / 4; k++) {
    const x = Math.floor(rnd(0, cols))
    ctx.fillStyle = 'rgb(20 17 15)'
    ctx.fillRect(x, 0, 1, Math.floor(rnd(rows * 0.3, rows)))
  }
  // 새똥
  for (let k = 0; k < 4; k++) {
    const x = Math.floor(rnd(4, cols - 4))
    const y = Math.floor(rnd(2, rows * 0.7))
    const r = Math.floor(rnd(2, 4))
    ctx.fillStyle = '#e9e6dc'
    ctx.fillRect(x - r, y - r + 1, r * 2, r * 2 - 2)
    ctx.fillRect(x - r + 1, y - r, r * 2 - 2, r * 2)
    ctx.fillRect(x - 1, y + r - 1, 2, Math.floor(rnd(2, 6)))
    ctx.fillStyle = '#9a968a'
    ctx.fillRect(x - 1, y - 1, 2, 2)
    ctx.fillStyle = '#f8f6ef'
    ctx.fillRect(x - r + 1, y - r + 1, 1, 1)
  }
  // 전단지 두 장: 테이프 붙인 종이에 가짜 글줄
  for (let k = 0; k < 2; k++) {
    const w = Math.floor(rnd(cols * 0.1, cols * 0.15))
    const h = Math.floor(Math.min(rows * 0.7, w * 1.4))
    const x = Math.floor(rnd(0, cols - w))
    const y = Math.floor(rnd(0, rows - h))
    ctx.fillStyle = ['#f1e7b8', '#f6c9c9', '#cfe3f3'][k % 3]
    ctx.fillRect(x, y, w, h)
    ctx.fillStyle = '#d7303a'
    ctx.fillRect(x + 2, y + 2, w - 4, Math.max(2, Math.floor(h * 0.16)))
    ctx.fillStyle = '#4a4440'
    for (let ly = y + Math.floor(h * 0.3); ly < y + h - 3; ly += 3) ctx.fillRect(x + 2, ly, Math.floor(rnd(w * 0.4, w - 4)), 1)
    ctx.fillStyle = 'rgb(255 255 240 / 0.7)'
    ctx.fillRect(x - 1, y - 1, 4, 2)
    ctx.fillRect(x + w - 3, y - 1, 4, 2)
  }
  clean.value = 0
}

// 걸레질: 지나간 자리를 반쯤 지운다 (여러 번 문질러야 깨끗해진다)
function wipe(x, y, r = 4) {
  if (!ctx) return
  ctx.globalCompositeOperation = 'destination-out'
  ctx.globalAlpha = 0.45
  const from = last || { x, y }
  const d = Math.hypot(x - from.x, y - from.y)
  const n = Math.max(1, Math.ceil(d / 2))
  for (let k = 1; k <= n; k++) {
    const px = from.x + ((x - from.x) * k) / n
    const py = from.y + ((y - from.y) * k) / n
    // 칸 단위 둥근 붓: 가운데 네모 + 위아래·양옆 한 줄씩
    const cx = Math.round(px)
    const cy = Math.round(py)
    ctx.fillRect(cx - r + 1, cy - r, r * 2 - 2, r * 2)
    ctx.fillRect(cx - r, cy - r + 1, r * 2, r * 2 - 2)
  }
  ctx.globalAlpha = 1
  last = { x, y }
  const now = performance.now()
  if (now - lastSound > 80) {
    lastSound = now
    sfx.scratch(1, 0, 0.05, 2400 + Math.random() * 1600)
  }
  if (now - lastCheck > 140) {
    lastCheck = now
    measure()
  }
}

function measure() {
  if (!ctx || phase.value !== 'scrub') return
  const data = ctx.getImageData(0, 0, cols, rows).data
  let ok = 0
  for (let k = 3; k < data.length; k += 4) if (data[k] < 60) ok++
  clean.value = ok / (cols * rows)
  if (clean.value >= CLEAN) light()
}

function toCell(e) {
  const r = cv.value.getBoundingClientRect()
  return { x: ((e.clientX - r.left) / r.width) * cols, y: ((e.clientY - r.top) / r.height) * rows, fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height }
}

function down(e) {
  if (phase.value !== 'scrub') return
  e.currentTarget.setPointerCapture?.(e.pointerId)
  last = null
  const p = toCell(e)
  sponge.value = { x: p.fx, y: p.fy, on: true }
  heroPose.value = 'walk'
  wipe(p.x, p.y)
}

function move(e) {
  const p = toCell(e)
  sponge.value = { x: p.fx, y: p.fy, on: sponge.value.on }
  if (phase.value !== 'scrub' || !(e.buttons & 1 || e.pointerType === 'touch')) return
  wipe(p.x, p.y)
}

function up() {
  last = null
  sponge.value = { ...sponge.value, on: false }
  if (phase.value === 'scrub') heroPose.value = 'idle'
  measure()
}

// 자판: 화살표로 걸레를 옮기고, 스페이스를 누른 채 옮기거나 연타하면 문지른다
function onKey(e) {
  if (phase.value === 'done' && e.key === 'Enter' && !props.embed) {
    e.preventDefault()
    return start()
  }
  if (phase.value !== 'scrub') return
  const step = { ArrowLeft: [-0.04, 0], ArrowRight: [0.04, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[e.key]
  if (step) {
    e.preventDefault()
    const s = sponge.value
    const nx = Math.min(1, Math.max(0, s.x + step[0]))
    const ny = Math.min(1, Math.max(0, s.y + step[1]))
    sponge.value = { x: nx, y: ny, on: spaceDown }
    if (spaceDown) wipe(nx * cols, ny * rows, 7)
    else last = null
  } else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    spaceDown = true
    heroPose.value = 'walk'
    const s = sponge.value
    // 제자리에서 동그랗게 문지른다
    last = null
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) wipe(s.x * cols + Math.cos(a) * 4, s.y * rows + Math.sin(a) * 3, 7)
    sponge.value = { ...s, on: true }
  }
}

function onKeyUp(e) {
  if (e.key === ' ' || e.key === 'Enter') {
    spaceDown = false
    last = null
    sponge.value = { ...sponge.value, on: false }
    if (phase.value === 'scrub') heroPose.value = 'idle'
    measure()
  }
}

function light() {
  if (phase.value !== 'scrub') return
  phase.value = 'lit'
  clean.value = 1
  ctx?.clearRect(0, 0, cols, rows)
  const t = (performance.now() - started) / 1000
  gained.value = Math.round(200 + Math.max(0, 800 - t * 40))
  score.value += gained.value
  heroPose.value = 'cheer'
  say.value = CHEER[round.value % CHEER.length]
  sfx.neon?.()
  later(() => sfx.right(), 150)
  sparks.value = Array.from({ length: 14 }, (_, k) => ({ id: `${round.value}-${k}`, x: rnd(-4, 104), y: rnd(-20, 120), d: rnd(0, 0.5) }))
  later(next, 1900)
}

async function next() {
  sparks.value = []
  if (round.value + 1 >= ROUNDS) return finish()
  round.value++
  await begin()
}

async function begin() {
  phase.value = 'scrub'
  heroPose.value = 'idle'
  say.value = props.embed ? ASK[round.value % ASK.length] : ''
  sponge.value = { x: 0.5, y: 0.5, on: false }
  await nextTick()
  grime()
  started = performance.now()
  secs.value = 0
  sfx.flip?.()
}

function finish() {
  phase.value = 'done'
  heroPose.value = 'cheer'
  say.value = props.embed ? '세 간판이 다 반짝여요. 정말 고마워요!' : ''
  if (score.value > best.value) {
    best.value = score.value
    localStorage.setItem(BEST_KEY, String(best.value))
  }
  sfx.win?.()
  window.dispatchEvent(new CustomEvent('game:over', { detail: { game: 'scratch', score: score.value } }))
}

async function start() {
  for (const t of timers) clearTimeout(t)
  timers.clear()
  phase.value = 'loading'
  round.value = 0
  score.value = 0
  sparks.value = []
  signs.value = await pickSigns()
  await begin()
}

let observer = null
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKeyUp)
  clock = setInterval(() => phase.value === 'scrub' && (secs.value = Math.floor((performance.now() - started) / 1000)), 250)
  // 창 크기가 바뀌면 그 간판의 때를 새로 앉힌다 (닦는 중이 아닐 때만)
  observer = new ResizeObserver(() => phase.value === 'scrub' && clean.value < 0.02 && grime())
  start().then(() => box.value && observer.observe(box.value))
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKeyUp)
  clearInterval(clock)
  observer?.disconnect()
  for (const t of timers) clearTimeout(t)
})
</script>

<template>
  <div class="sg sc" :class="{ embed }">
    <header class="sg-hud">
      <span class="sg-chip"><small>간판</small><b>{{ Math.min(round + 1, ROUNDS) }} / {{ ROUNDS }}</b></span>
      <span class="sg-chip"><small>시간</small><b>{{ secs }}초</b></span>
      <span class="sg-chip sc-meter">
        <small>깨끗함</small>
        <span class="sc-bar"><i :style="{ width: `${Math.round(clean * 100)}%` }"></i></span>
        <b>{{ Math.round(clean * 100) }}%</b>
      </span>
      <span class="sg-chip sc-score"><small>점수</small><b>{{ score.toLocaleString() }}</b></span>
    </header>

    <p v-if="!embed" class="sc-title">
      <b>간판 청소</b>
      <span>그을음·새똥·전단지를 문질러 벗기면 간판에 불이 들어와요</span>
    </p>

    <!-- 가게 앞: 벽돌 벽에 간판, 그 아래 셔터 -->
    <div class="sc-front">
      <div ref="box" class="sc-sign" :class="{ lit: phase === 'lit' || phase === 'done' }" :style="{ '--plate': pastelOf(sign?.name || '') }">
        <span class="sc-name" :style="{ fontSize: nameSize }">{{ sign?.name || '' }}</span>
        <canvas
          ref="cv"
          class="sc-grime"
          :class="{ off: phase !== 'scrub' }"
          aria-label="간판을 덮은 때. 문질러서 닦기"
          @pointerdown="down"
          @pointermove="move"
          @pointerup="up"
          @pointercancel="up"
          @pointerleave="up"
        ></canvas>
        <span
          v-if="phase === 'scrub'"
          class="sc-sponge"
          :class="{ on: sponge.on }"
          :style="{ left: `${sponge.x * 100}%`, top: `${sponge.y * 100}%` }"
          aria-hidden="true"
        ></span>
        <span v-for="s in sparks" :key="s.id" class="sc-spark" :style="{ left: `${s.x}%`, top: `${s.y}%`, animationDelay: `${s.d}s` }" aria-hidden="true"></span>
        <span v-if="phase === 'lit'" class="sg-float" :style="{ left: '50%', top: '-10%' }">+{{ gained }}</span>
      </div>
      <div class="sc-shutter" aria-hidden="true"></div>
    </div>

    <!-- 길: 사장님(부탁일 때)과 나 -->
    <div class="sc-walk">
      <div v-if="embed" class="sc-owner">
        <p v-if="say" :key="say" class="sg-say sc-say px-pop">{{ say }}</p>
        <img v-if="ownerArt" class="sc-owner-img" :src="ownerArt" alt="" draggable="false" />
        <small v-if="ownerName">{{ ownerName }}</small>
      </div>
      <p class="sc-help">
        <span>마우스·손가락으로 문질러 닦기</span>
        <span><span class="sg-key">←</span><span class="sg-key">→</span><span class="sg-key">↑</span><span class="sg-key">↓</span> 걸레 옮기기 · <span class="sg-key">스페이스</span> 문지르기</span>
      </p>
      <Hero class="sc-me" :scale="4" :dir="embed ? 2 : 1" :pose="heroPose" />
    </div>

    <div v-if="phase === 'done'" class="sg-end">
      <h1 class="px-pop">{{ embed ? '골목이 환해졌다!' : '반짝반짝!' }}</h1>
      <p>간판 <b>{{ ROUNDS }}개</b>를 닦아 <b>{{ score.toLocaleString() }}점</b></p>
      <p v-if="!embed">최고 기록 <b>{{ best.toLocaleString() }}점</b></p>
      <button v-if="!embed" class="sg-btn go" @click="start">다시 닦기 ▶</button>
    </div>
  </div>
</template>

<style scoped>
.sc {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  padding-top: 52px;
  background:
    linear-gradient(#0000 0 calc(100% - 70px), #2a2d52 calc(100% - 70px) calc(100% - 64px), #3a3e6a calc(100% - 64px)),
    /* 벽돌 */
    repeating-linear-gradient(0deg, #4a2b33 0 2px, transparent 2px 18px),
    repeating-linear-gradient(90deg, #4a2b33 0 2px, transparent 2px 36px),
    #6a3a40;
}

.sc.embed {
  grid-template-rows: minmax(0, 1fr) auto;
}

.sc-meter {
  flex: 1;
  max-width: 300px;
}

.sc-bar {
  position: relative;
  flex: 1;
  height: 10px;
  background: #0b1028;
}

.sc-bar i {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(#7fffa8 0 50%, #00c853 50%);
  transition: width 0.15s steps(3);
}

.sc-score {
  margin-left: auto;
}

.sc-title {
  position: relative;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  margin: 0 16px;
  padding: 6px 12px;
  background: #0b1028;
  box-shadow: 0 0 0 3px #0b1028;
  font-size: 13px;
  color: #c2c3c7;
}

.sc-title b {
  color: #ffec27;
  font-size: 18px;
  font-weight: 400;
}

.sc-front {
  display: grid;
  grid-template-rows: auto minmax(40px, 1fr);
  justify-items: center;
  gap: 0;
  padding: 18px 5% 0;
  min-height: 0;
}

/* 간판: 쇠틀 안의 판. 꺼져 있을 땐 칙칙하고, 다 닦으면 불이 들어온다 */
.sc-sign {
  position: relative;
  width: min(100%, 760px);
  height: clamp(120px, 24cqi, 260px);
  display: grid;
  place-items: center;
  padding: 0 4%;
  background: var(--plate);
  box-shadow:
    inset 0 0 0 6px rgb(0 0 0 / 0.18),
    0 0 0 6px #3b3f4a,
    0 0 0 10px #16161c,
    0 14px 0 6px rgb(0 0 0 / 0.35);
  filter: saturate(0.35) brightness(0.62);
  transition: filter 0.4s steps(4);
  touch-action: none;
}

.sc-sign.lit {
  filter: none;
  box-shadow:
    inset 0 0 0 6px rgb(255 255 255 / 0.3),
    0 0 0 6px #3b3f4a,
    0 0 0 10px #16161c,
    0 0 60px 14px color-mix(in srgb, var(--plate) 70%, transparent);
  animation: sc-flicker 0.6s steps(2);
}

@keyframes sc-flicker {
  0%,
  40% {
    filter: brightness(0.5);
  }
  20%,
  60% {
    filter: brightness(1.4);
  }
}

.sc-name {
  color: #1d1d2b;
  line-height: 1.1;
  white-space: nowrap;
  letter-spacing: 0.02em;
}

.sc-sign.lit .sc-name {
  color: #fff;
  text-shadow:
    3px 3px 0 #1d1d2b,
    -3px 3px 0 #1d1d2b,
    3px -3px 0 #1d1d2b,
    -3px -3px 0 #1d1d2b,
    0 0 18px #fff;
}

.sc-grime {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  cursor: none;
  touch-action: none;
}

.sc-grime.off {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s steps(3);
}

/* 걸레: 노란 스펀지 */
.sc-sponge {
  position: absolute;
  z-index: 3;
  width: 34px;
  height: 22px;
  translate: -50% -50%;
  background:
    radial-gradient(circle at 30% 40%, #c79a1c 0 2px, transparent 3px),
    radial-gradient(circle at 70% 60%, #c79a1c 0 2px, transparent 3px),
    linear-gradient(#ffe066 0 60%, #3fae5a 60%);
  box-shadow: 0 0 0 3px #0b1028;
  pointer-events: none;
}

.sc-sponge.on {
  animation: sc-rub 0.16s steps(2) infinite;
}

@keyframes sc-rub {
  50% {
    rotate: 14deg;
    scale: 0.92;
  }
}

.sc-spark {
  position: absolute;
  z-index: 4;
  width: 14px;
  height: 14px;
  background:
    linear-gradient(#fff, #fff) center / 4px 100% no-repeat,
    linear-gradient(#fff, #fff) center / 100% 4px no-repeat;
  pointer-events: none;
  animation: sc-spark 0.9s steps(6) both;
}

@keyframes sc-spark {
  0% {
    scale: 0;
  }
  50% {
    scale: 1.4;
  }
  100% {
    scale: 0;
    translate: 0 -16px;
  }
}

.sc-shutter {
  width: min(86%, 640px);
  margin-top: 22px;
  background: repeating-linear-gradient(#5b6170 0 8px, #474c59 8px 11px);
  box-shadow: 0 0 0 4px #16161c;
}

.sc-walk {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 16px;
  min-height: 120px;
  padding: 0 5% 10px;
}

.sc-owner {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 2px;
}

.sc-owner small {
  padding: 3px 8px;
  font-size: 11px;
  color: #1d1d1f;
  background: #ffa300;
  box-shadow: 0 -3px 0 #fff1e8, 0 3px 0 #fff1e8, -3px 0 0 #fff1e8, 3px 0 0 #fff1e8;
}

.sc-owner-img {
  height: clamp(96px, 16cqi, 144px);
}

.sc-say {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: max-content;
  max-width: min(320px, 40cqi);
}

.sc-help {
  display: grid;
  gap: 12px;
  flex: 1;
  margin: 0 0 14px;
  font-size: 12px;
  color: #c2c3c7;
  text-align: center;
  justify-items: center;
}

.sc-help > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  color: #fff1e8;
  background: #141b3a;
  box-shadow: 0 -3px 0 #fff1e8, 0 3px 0 #fff1e8, -3px 0 0 #fff1e8, 3px 0 0 #fff1e8, 0 6px 0 rgb(0 0 0 / 0.45);
}

.sc-me {
  margin-left: auto;
}
</style>
