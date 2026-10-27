<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { BOTTOMS, DEFAULT_LOOK, EXTRAS, HAIRS, HAIR_STYLES, HATS, SKINS, TOPS, avatarURL, drawAvatar, readLook, saveLook } from '../avatar.js'
import { sfx } from '../sound.js'
import hardhat from '../assets/intro/hardhat.webp'

// 수리공 스튜디오: 처음 간판 수리공을 시작하면 셸이 전체 화면으로 띄운다. 고른 모습은 saveLook 으로 저장하고 done 으로 알린다.
// 나가기(Esc)는 저장하지 않고 exit 로 알린다
// 간판 수리공 인트로와 같은 검은 무대·픽셀 글자·노란 ▶ 로 꾸민다
const props = defineProps({ name: { type: String, default: '' } })
const emit = defineEmits(['done', 'exit'])

const HAT_COLORS = ['#ffcf3a', '#ff7a2f', '#f4f4f4', '#2f6fff', '#e8483f', '#2fb36a']
const look = reactive(readLook())
const nick = ref(props.name || look.name || '')

const PARTS = [
  { key: 'skin', label: '피부', opts: SKINS.map((c, i) => ({ v: i, c })) },
  { key: 'hairStyle', label: '머리 모양', opts: HAIR_STYLES.map(([v, t]) => ({ v, t })) },
  { key: 'hair', label: '머리색', opts: HAIRS.map((c, i) => ({ v: i, c })) },
  { key: 'top', label: '윗옷', opts: TOPS.map((c, i) => ({ v: i, c })) },
  { key: 'bottom', label: '바지', opts: BOTTOMS.map((c, i) => ({ v: i, c })) },
  { key: 'hat', label: '모자', opts: HATS.map(([v, t]) => ({ v, t })) },
  { key: 'hatColor', label: '안전모 색', opts: HAT_COLORS.map((c) => ({ v: c, c })), when: () => look.hat === 'helmet' },
  { key: 'extra', label: '소품', opts: EXTRAS.map(([v, t]) => ({ v, t })) },
]
const parts = computed(() => PARTS.filter((r) => !r.when || r.when()))
const curKey = ref('skin')
const part = computed(() => parts.value.find((p) => p.key === curKey.value) || parts.value[0])
watch(parts, (ps) => !ps.some((p) => p.key === curKey.value) && (curKey.value = 'hat'))

const idxOf = (p) => Math.max(0, p.opts.findIndex((o) => o.v === look[p.key]))
const valueOf = (p) => p.opts[idxOf(p)].t || null
const colorOf = (p) => p.opts[idxOf(p)].c

function step(p, d) {
  const n = p.opts.length
  curKey.value = p.key
  look[p.key] = p.opts[(idxOf(p) + d + n) % n].v
  sfx.click?.()
}
function pick(p, o) {
  look[p.key] = o.v
  sfx.click?.()
}
function select(p) {
  if (curKey.value === p.key) return
  curKey.value = p.key
  sfx.tick?.()
}
function movePart(d) {
  const ps = parts.value
  const i = ps.indexOf(part.value)
  curKey.value = ps[(i + d + ps.length) % ps.length].key
  sfx.tick?.()
}

// 모양 카드: 지금 모습에 그 선택지만 바꿔 그린 작은 그림
const cards = computed(() => {
  const p = part.value
  if (p.opts[0].c) return []
  const base = { ...look }
  return p.opts.map((o) => ({ ...o, src: avatarURL({ ...base, [p.key]: o.v }, { scale: 4 }) }))
})

// 미리 만든 모습
const PRESETS = [
  { id: 'base', t: '기본 수리공', look: { ...DEFAULT_LOOK } },
  { id: 'night', t: '야간 조', look: { skin: 1, hair: 0, hairStyle: 'spiky', top: 7, bottom: 1, hat: 'beanie', hatColor: '#ffcf3a', extra: 'none' } },
  { id: 'elec', t: '전기 기사', look: { skin: 2, hair: 1, hairStyle: 'short', top: 2, bottom: 0, hat: 'helmet', hatColor: '#f4f4f4', extra: 'glasses' } },
  { id: 'design', t: '간판 디자이너', look: { skin: 0, hair: 4, hairStyle: 'bob', top: 5, bottom: 3, hat: 'none', hatColor: '#ffcf3a', extra: 'glasses' } },
  { id: 'rookie', t: '견습생', look: { skin: 0, hair: 3, hairStyle: 'bun', top: 3, bottom: 2, hat: 'cap', hatColor: '#ffcf3a', extra: 'bag' } },
  { id: 'boss', t: '반장님', look: { skin: 3, hair: 6, hairStyle: 'short', top: 1, bottom: 1, hat: 'helmet', hatColor: '#ff7a2f', extra: 'bag' } },
]
const presetCards = PRESETS.map((p) => ({ ...p, src: avatarURL(p.look, { scale: 4 }) }))
const presetOn = computed(() => PRESETS.find((p) => Object.keys(p.look).every((k) => p.look[k] === look[k]))?.id)
function applyPreset(p) {
  Object.assign(look, p.look)
  sfx.bell?.()
}

function shuffle() {
  for (const r of PARTS) look[r.key] = r.opts[Math.floor(Math.random() * r.opts.length)].v
  sfx.bell?.()
}

// 되돌리기: 모습이 바뀔 때마다 한 장씩 쌓는다
const snap = () => JSON.stringify(PARTS.map((p) => look[p.key]))
const hist = [snap()]
const at = ref(0)
let replaying = false
watch(
  () => snap(),
  (s) => {
    if (replaying) return
    hist.splice(at.value + 1)
    hist.push(s)
    if (hist.length > 60) hist.shift()
    at.value = hist.length - 1
  },
)
const histLen = ref(1)
watch(at, () => (histLen.value = hist.length))
function goHist(d) {
  const i = at.value + d
  if (i < 0 || i >= hist.length) return
  replaying = true
  JSON.parse(hist[i]).forEach((v, k) => (look[PARTS[k].key] = v))
  at.value = i
  queueMicrotask(() => (replaying = false))
  sfx.click?.()
}

// 무대 줌: 휠로만
const zoom = ref(85)
watch(zoom, () => drawStage())
function onWheel(e) {
  zoom.value = Math.max(60, Math.min(160, zoom.value + (e.deltaY < 0 ? 5 : -5)))
}

// 무대: 게임 속 거리와 같은 픽셀 인형 그림(drawAvatar)을 크게 세운다.
// 제자리걸음으로 앞·옆·뒤·옆을 돌고, 끌면 그쪽으로 돌려 본다
const stageEl = ref(null)
const cv = ref(null)
const DIRS = [0, 3, 1, 2]
let turn = 0
let tick = 0
let timer = 0
let holdUntil = 0
function drawStage() {
  const c = cv.value
  if (!c) return
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  const s = Math.max(4, Math.round(((c.height * 0.42) / 24) * (zoom.value / 100)))
  const frame = 1 + (tick % 2)
  drawAvatar(ctx, { ...look }, Math.round(c.width / 2), Math.round(c.height * 0.72), { scale: s, dir: DIRS[turn], frame, night: true })
}
function fit() {
  const el = stageEl.value
  const c = cv.value
  if (!el || !c) return
  c.width = el.clientWidth
  c.height = el.clientHeight
  drawStage()
}
let ro = null

let dragX = null
function onDown(e) {
  dragX = e.clientX
  e.currentTarget.setPointerCapture?.(e.pointerId)
}
function onMove(e) {
  if (dragX == null) return
  const d = e.clientX - dragX
  if (Math.abs(d) < 40) return
  turn = (turn + (d > 0 ? 1 : 3)) % 4
  dragX = e.clientX
  holdUntil = performance.now() + 3000
  drawStage()
}
const onUp = () => (dragX = null)

let rebuild = 0
watch(
  look,
  () => {
    cancelAnimationFrame(rebuild)
    rebuild = requestAnimationFrame(drawStage)
  },
  { deep: true },
)

const leaving = ref(false)
function finish() {
  if (leaving.value) return
  const out = { ...look }
  const n = nick.value.trim()
  if (n) out.name = n
  else delete out.name
  saveLook(out)
  sfx.coin?.()
  leaving.value = true
  setTimeout(() => emit('done', out), 420)
}
function exit() {
  if (leaving.value) return
  sfx.click?.()
  leaving.value = true
  setTimeout(() => emit('exit'), 420)
}

// 키보드: ↑↓ 부품 옮기기, ←→ 값 바꾸기, Enter 시작, R 무작위, Esc 나가기
function onKey(e) {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    return exit()
  }
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName)
  if (typing && e.key !== 'Enter' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
  if (e.key === 'ArrowLeft') step(part.value, -1)
  else if (e.key === 'ArrowRight') step(part.value, 1)
  else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') movePart(-1)
  else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') movePart(1)
  else if (e.key === 'Enter') finish()
  else if (e.key === 'r' || e.key === 'R') shuffle()
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') goHist(e.shiftKey ? 1 : -1)
  else return
  if (typing && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) document.activeElement.blur()
  e.preventDefault()
  e.stopPropagation()
}

onMounted(() => {
  fit()
  ro = new ResizeObserver(fit)
  ro.observe(stageEl.value)
  timer = setInterval(() => {
    tick++
    if (tick % 12 === 0 && performance.now() > holdUntil) turn = (turn + 1) % 4
    drawStage()
  }, 1000 / 6)
  window.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  clearInterval(timer)
  cancelAnimationFrame(rebuild)
  window.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <div class="cm" :class="{ leaving }" role="dialog" aria-label="수리공 스튜디오">
    <!-- 무대: 화면 전체. 위에서 떨어지는 노란 조명 아래 픽셀 인형 -->
    <section ref="stageEl" class="cm-stage" @wheel.prevent="onWheel">
      <i class="cm-beam" aria-hidden="true" />
      <canvas
        ref="cv"
        class="cm-cv"
        aria-label="수리공 미리보기 · 끌어서 돌리기"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
      />
    </section>

    <header class="cm-top">
      <h1>
        <img class="cm-hat" :src="hardhat" alt="" draggable="false" />
        <span>수리공 스튜디오</span>
      </h1>
      <p>오늘 밤 간판을 고칠 수리공을 꾸며 주세요</p>
    </header>
    <button class="cm-exit" @click="exit">나가기</button>

    <!-- 왼쪽: 부품 메뉴. 고른 줄만 노란색에 ▶ -->
    <nav class="cm-menu" aria-label="부품">
      <div
        v-for="(p, i) in parts"
        :key="p.key"
        class="cm-row"
        :class="{ on: part.key === p.key }"
        :style="{ '--i': i }"
        @pointerenter="select(p)"
        @click="select(p)"
      >
        <span class="cm-name">{{ p.label }}</span>
        <span class="cm-pick">
          <button class="cm-arw" :aria-label="`${p.label} 이전`" @click.stop="step(p, -1)">◀</button>
          <span :key="look[p.key]" class="cm-val">
            <template v-if="valueOf(p)">{{ valueOf(p) }}</template>
            <i v-else class="cm-sw" :style="{ background: colorOf(p) }" />
          </span>
          <button class="cm-arw" :aria-label="`${p.label} 다음`" @click.stop="step(p, 1)">▶</button>
        </span>
      </div>
      <div class="cm-tools">
        <button @click="shuffle">무작위</button>
        <button :disabled="at === 0" @click="goHist(-1)">되돌리기</button>
        <button :disabled="at >= histLen - 1" @click="goHist(1)">다시</button>
      </div>
    </nav>

    <!-- 오른쪽: 지금 부품의 선택지 + 추천 모습 -->
    <aside class="cm-side">
      <section class="cm-box">
        <h2>{{ part.label }}</h2>
        <div v-if="part.opts[0].c" class="cm-mats">
          <button
            v-for="(o, i) in part.opts"
            :key="o.v"
            class="cm-mat"
            :class="{ on: look[part.key] === o.v }"
            :aria-label="`${part.label} ${i + 1}`"
            :style="{ background: o.c }"
            @click="pick(part, o)"
          />
        </div>
        <div v-else class="cm-cards">
          <button v-for="o in cards" :key="o.v" class="cm-card" :class="{ on: look[part.key] === o.v }" @click="pick(part, o)">
            <img :src="o.src" alt="" />
            <span>{{ o.t }}</span>
          </button>
        </div>
      </section>
      <section class="cm-box">
        <h2>추천 모습</h2>
        <div class="cm-cards three">
          <button v-for="p in presetCards" :key="p.id" class="cm-card" :class="{ on: presetOn === p.id }" @click="applyPreset(p)">
            <img :src="p.src" alt="" />
            <span>{{ p.t }}</span>
          </button>
        </div>
      </section>
    </aside>

    <form class="cm-bar" @submit.prevent="finish">
      <label class="cm-nick">
        <span>이름</span>
        <input v-model="nick" maxlength="12" placeholder="손님" autocomplete="off" spellcheck="false" />
      </label>
      <button type="submit" class="cm-go">이대로 시작</button>
    </form>

    <p class="cm-press">↑↓ 부품 · ←→ 바꾸기 · R 무작위 · Enter 시작 · Esc 나가기 · 끌어서 돌리기</p>
  </div>
</template>

<style scoped>
.cm {
  --px: 'Galmuri11 Game', Galmuri11, sans-serif;
  --yel: #ffcf3a;
  --mute: #8e8ea0;
  --dim: #44444f;
  --line: #2c2c36;
  --ink: #1b1622;
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: minmax(250px, 300px) 1fr minmax(260px, 310px);
  grid-template-rows: auto 1fr auto;
  gap: 18px 4vw;
  padding: 5vh 4vw 9vh;
  overflow: hidden;
  background: #000;
  color: #e9e9ee;
  font: 13px 'Pretendard Variable', Pretendard, -apple-system, 'Apple SD Gothic Neo', sans-serif;
  pointer-events: none;
  transition: opacity 0.4s ease;
}

.cm.leaving {
  opacity: 0;
}

.cm > :not(.cm-stage, .cm-press) {
  position: relative;
  z-index: 1;
  pointer-events: auto;
}

.cm button {
  font: inherit;
  color: inherit;
  cursor: pointer;
}

/* ── 무대 ── */
.cm-stage {
  position: absolute;
  inset: 0;
  pointer-events: auto;
  animation: cm-fade 0.8s both;
}

/* 위에서 떨어지는 조명 기둥 */
.cm-beam {
  position: absolute;
  left: 50%;
  top: -10%;
  width: min(46vw, 640px);
  height: 100%;
  translate: -50% 0;
  background: radial-gradient(50% 100% at 50% 0%, rgb(255 214 120 / 0.13), rgb(255 214 120 / 0.04) 60%, transparent 100%);
  clip-path: polygon(38% 0, 62% 0, 100% 100%, 0 100%);
  pointer-events: none;
  animation: cm-flicker 6s steps(1) infinite;
}

@keyframes cm-flicker {
  0%,
  100% {
    opacity: 1;
  }
  41% {
    opacity: 0.55;
  }
  42% {
    opacity: 1;
  }
  44% {
    opacity: 0.7;
  }
  45% {
    opacity: 1;
  }
}

.cm-cv {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  cursor: grab;
  touch-action: none;
}

.cm-cv:active {
  cursor: grabbing;
}

/* ── 제목: 인트로의 블록 글자 ── */
.cm-top {
  grid-column: 1 / -1;
  grid-row: 1;
  pointer-events: none !important;
  animation: cm-in 0.5s 0.15s both;
}

.cm-top h1 {
  display: flex;
  align-items: center;
  gap: 2px;
  margin: 0;
  font: 700 clamp(22px, 3.4vh, 32px) / 1 var(--px);
  color: #fff;
  text-shadow:
    0.06em 0.06em 0 #5d5d6c,
    0.1em 0.1em 0 #5d5d6c;
}

.cm-hat {
  width: 1.6em;
  margin: -0.3em 0.1em -0.2em -0.2em;
  filter: drop-shadow(0 0.08em 0.16em rgb(255 190 20 / 0.3));
  animation: cm-bob 3.2s ease-in-out infinite;
}

@keyframes cm-bob {
  50% {
    transform: translateY(-5%) rotate(-5deg);
  }
}

.cm-top p {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--mute);
}

/* 오른쪽 위 나가기: 아래 도구 단추와 같은 픽셀 글자 */
.cm-exit {
  grid-column: 3;
  grid-row: 1;
  justify-self: end;
  align-self: start;
  padding: 6px 0;
  border: 0;
  background: none;
  font: 700 14px var(--px) !important;
  letter-spacing: 0.06em;
  color: var(--mute) !important;
  animation: cm-in 0.5s 0.15s both;
}

.cm-exit::before {
  content: '✕ ';
}

.cm-exit:hover,
.cm-exit:focus-visible {
  outline: none;
  color: var(--yel) !important;
}

/* ── 왼쪽 부품 메뉴 ── */
.cm-menu {
  grid-column: 1;
  grid-row: 2;
  align-self: center;
  display: grid;
  gap: 2px;
  font-family: var(--px);
}

.cm-row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 4px 8px 1.6em;
  color: var(--mute);
  font-size: clamp(14px, 2vh, 17px);
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  animation: cm-in 0.4s both;
  animation-delay: calc(0.35s + var(--i) * 0.06s);
}

.cm-row.on {
  color: var(--yel);
  text-shadow: 3px 3px 0 var(--ink);
}

.cm-row.on::before {
  content: '▶';
  position: absolute;
  left: 0;
  animation: cm-nudge 0.6s steps(2) infinite;
}

@keyframes cm-nudge {
  50% {
    transform: translateX(4px);
  }
}

.cm-pick {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cm-arw {
  padding: 2px 4px;
  border: 0;
  background: none;
  font-size: 10px !important;
  color: var(--dim) !important;
  text-shadow: none;
}

.cm-row.on .cm-arw {
  color: var(--yel) !important;
}

.cm-arw:hover {
  color: #fff !important;
}

.cm-val {
  display: grid;
  place-items: center;
  min-width: 5.2em;
  font-size: 0.85em;
  color: #e9e9ee;
  text-shadow: none;
  animation: cm-pop 0.18s steps(3);
}

@keyframes cm-pop {
  from {
    transform: scale(1.25);
  }
}

.cm-sw {
  width: 16px;
  height: 16px;
  box-shadow:
    0 0 0 2px #000,
    0 0 0 4px var(--dim);
}

.cm-row.on .cm-sw {
  box-shadow:
    0 0 0 2px #000,
    0 0 0 4px var(--yel);
}

.cm-tools {
  display: flex;
  gap: 16px;
  margin-top: 18px;
  padding-left: 1.6em;
  animation: cm-in 0.4s 0.9s both;
}

.cm-tools button {
  padding: 4px 0;
  border: 0;
  background: none;
  font: 700 12px var(--px) !important;
  color: var(--mute) !important;
  letter-spacing: 0.04em;
}

.cm-tools button:hover:not(:disabled) {
  color: var(--yel) !important;
}

.cm-tools button:disabled {
  color: var(--line) !important;
  cursor: default;
}

/* ── 오른쪽 선택지 ── */
.cm-side {
  grid-column: 3;
  grid-row: 2;
  align-self: center;
  display: grid;
  gap: 16px;
  max-height: 100%;
  min-height: 0;
  overflow: auto;
  scrollbar-width: none;
  animation: cm-in 0.5s 0.55s both;
}

.cm-box {
  padding: 14px;
  border: 2px solid var(--line);
  background: rgb(0 0 0 / 0.72);
}

.cm-box h2 {
  margin: 0 0 12px;
  font: 700 13px var(--px);
  color: var(--yel);
  letter-spacing: 0.06em;
  text-shadow: 2px 2px 0 var(--ink);
}

.cm-mats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

/* 픽셀 물감 칸: 고르면 노란 테두리 */
.cm-mat {
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  box-shadow:
    inset -4px -4px 0 rgb(0 0 0 / 0.28),
    inset 4px 4px 0 rgb(255 255 255 / 0.22),
    0 0 0 2px #000,
    0 0 0 4px var(--line);
}

.cm-mat:hover {
  box-shadow:
    inset -4px -4px 0 rgb(0 0 0 / 0.28),
    inset 4px 4px 0 rgb(255 255 255 / 0.22),
    0 0 0 2px #000,
    0 0 0 4px var(--mute);
}

.cm-mat.on {
  box-shadow:
    inset -4px -4px 0 rgb(0 0 0 / 0.28),
    inset 4px 4px 0 rgb(255 255 255 / 0.22),
    0 0 0 2px #000,
    0 0 0 4px var(--yel);
}

.cm-cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.cm-cards.three {
  grid-template-columns: repeat(3, 1fr);
}

.cm-card {
  display: grid;
  justify-items: center;
  gap: 4px;
  padding: 8px 2px 6px;
  border: 2px solid var(--line);
  background: #0b0b10;
  font: 700 11px var(--px) !important;
  color: var(--mute) !important;
}

.cm-card img {
  width: 32px;
  height: 48px;
  image-rendering: pixelated;
}

.cm-card:hover {
  border-color: var(--mute);
}

.cm-card.on {
  border-color: var(--yel);
  color: var(--yel) !important;
}

/* ── 아래: 이름 + 시작 ── */
.cm-bar {
  grid-column: 2;
  grid-row: 3;
  justify-self: center;
  display: flex;
  align-items: flex-end;
  gap: 4vw;
  animation: cm-in 0.5s 0.75s both;
}

.cm-nick {
  display: grid;
  gap: 6px;
  font-family: var(--px);
}

.cm-nick span {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--mute);
}

.cm-nick input {
  width: 9.5em;
  padding: 2px 0 6px;
  border: 0;
  border-bottom: 3px solid var(--dim);
  border-radius: 0;
  outline: 0;
  background: none;
  font: 700 clamp(17px, 2.4vh, 22px) var(--px);
  color: #fff;
  caret-color: var(--yel);
}

.cm-nick input::placeholder {
  color: var(--dim);
}

.cm-nick input:focus {
  border-bottom-color: var(--yel);
}

/* 인트로 시작 메뉴의 고른 줄과 같은 모양 */
.cm-go {
  position: relative;
  padding: 8px 4px 8px 1.6em;
  border: 0;
  background: none;
  font: 700 clamp(18px, 2.6vh, 24px) / 1 var(--px) !important;
  letter-spacing: 0.06em;
  white-space: nowrap;
  color: var(--yel) !important;
  text-shadow: 3px 3px 0 var(--ink);
}

.cm-go::before {
  content: '▶';
  position: absolute;
  left: 0;
  animation: cm-nudge 0.6s steps(2) infinite;
}

.cm-go:hover,
.cm-go:focus-visible {
  outline: none;
  color: #fff !important;
}

.cm-go:active {
  transform: translateY(2px);
}

.cm-press {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 3.5vh;
  margin: 0;
  text-align: center;
  font: 700 12px var(--px);
  letter-spacing: 0.08em;
  color: #6c6c7c;
  pointer-events: none !important;
  animation: cm-fade 0.4s 1.2s both;
}

@keyframes cm-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

@keyframes cm-fade {
  from {
    opacity: 0;
  }
}

@media (max-height: 760px) {
  .cm {
    padding-top: 3vh;
  }

  .cm-row {
    padding-block: 5px;
  }

  .cm-box {
    padding: 10px;
  }
}

/* 좁은 화면: 무대를 위에 두고 메뉴·선택지·이름을 아래로 쌓는다 */
@media (max-width: 800px) {
  .cm {
    grid-template-columns: 1fr;
    grid-template-rows: auto 42vh;
    grid-auto-rows: max-content;
    align-content: start;
    gap: 14px;
    padding: 16px 16px 48px;
    overflow: auto;
  }

  .cm > .cm-exit {
    position: absolute;
    top: 16px;
    right: 16px;
  }

  .cm-stage {
    position: absolute;
    inset: 0 0 auto;
    height: calc(42vh + 80px);
  }

  .cm-menu,
  .cm-side,
  .cm-bar {
    grid-column: 1;
    grid-row: auto;
  }

  .cm-menu {
    grid-row: 3;
  }

  .cm-side {
    grid-row: 4;
    min-height: auto;
    max-height: none;
    overflow: visible;
  }

  .cm-bar {
    grid-row: 5;
    justify-self: stretch;
    justify-content: space-between;
  }

  .cm-mats {
    grid-template-columns: repeat(8, 1fr);
  }

  .cm-cards {
    grid-template-columns: repeat(4, 1fr);
  }

  .cm-press {
    display: none;
  }
}
</style>
