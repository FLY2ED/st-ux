<script setup>
// 이야기 속 타자왕: 강남역 밤거리, 전광판 거인이 붙잡아 둔 간판 이름을 전광판에 흘려보낸다.
// 이름이 화면 밖으로 흘러가기 전에 그대로 쳐서 읽어 주면 그 이름이 빠져나와 거리로 돌아오고 거인이 흔들린다.
// 놓치면 거인이 그 이름을 삼키고 목숨이 준다. goal 개를 되찾으면 이긴다
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { signPool } from '../../data.js'
import { pastelOf } from '../../shops.js'
import { sfx } from '../../sound.js'
import Hearts from './Hearts.vue'
import Hero from './Hero.vue'
import './stage.css'

const props = defineProps({ goal: { type: Number, default: 8 }, boss: { type: String, default: '' }, bossName: { type: String, default: '전광판 거인' } })
const LIVES = 3
// 되찾을수록 이름이 길어진다
const BANDS = [
  [3, 5],
  [4, 6],
  [5, 7],
  [6, 9],
  [7, 11],
]
const TAUNT = ['광고! 광고! 아무도 안 읽었지?', '키키, 이 이름은 이제 내 광고야!', '너무 느려! 다음 광고!']

const phase = ref('play') // play | win | over
const lives = ref(LIVES)
const hits = ref(0)
const target = ref(null)
const run = ref(0) // 전광판에 새 이름이 뜰 때마다 1씩: 흐르는 애니메이션을 다시 건다
const typed = ref('')
const composing = ref(false)
const errors = ref(0)
const saved = ref([])
const banner = ref('')
const bossFx = ref('')
const heroPose = ref('idle')
const say = ref(null) // { who: 'boss' | 'me', text }
const floats = ref([])
const shake = ref(false)
const field = ref(null)

let pool = []
let used = new Set()
let shownAt = 0
let strokesDone = 0
let typingMs = 0
let accepting = false
let lastWrong = -1
const timers = new Set()
const later = (fn, ms) => {
  const t = setTimeout(() => {
    timers.delete(t)
    fn()
  }, ms)
  timers.add(t)
}

// 한글 한 글자를 치는 데 드는 자판 수(타자왕과 같은 셈): 초성 1 + 중성 1~2 + 종성 0~2
const DOUBLE_JUNG = new Set([9, 10, 11, 14, 15, 16, 19])
const DOUBLE_JONG = new Set([3, 5, 6, 9, 10, 11, 12, 13, 14, 15, 18])
function strokes(text) {
  let n = 0
  for (const ch of text) {
    const c = ch.charCodeAt(0) - 0xac00
    if (c < 0 || c > 11171) {
      n += 1
      continue
    }
    const jung = Math.floor((c % 588) / 28)
    const jong = c % 28
    n += 1 + (DOUBLE_JUNG.has(jung) ? 2 : 1) + (jong ? (DOUBLE_JONG.has(jong) ? 2 : 1) : 0)
  }
  return n
}

const score = computed(() => {
  const min = typingMs / 60000
  if (!min) return 0
  const acc = strokesDone / (strokesDone + errors.value * 3)
  return Math.round((strokesDone / min) * acc)
})

const chars = computed(() => {
  const t = target.value?.name || ''
  const v = typed.value
  return [...t].map((ch, i) => {
    let state = ''
    if (v[i] != null) state = v[i] === ch ? 'ok' : i === v.length - 1 && composing.value ? 'now' : 'bad'
    else if (i === v.length) state = 'next'
    return { ch, state }
  })
})
const wrongAt = computed(() => {
  const v = typed.value
  const t = target.value?.name || ''
  const upto = composing.value ? v.length - 1 : v.length
  for (let i = 0; i < upto; i++) if (v[i] !== t[i]) return i
  return -1
})
// 흐르는 시간: 이름이 길수록 길고, 되찾을수록 조금씩 빨라진다
const dur = computed(() => {
  const n = target.value?.name.length || 4
  return (4.2 + n * 0.62) * Math.max(0.7, 1 - hits.value * 0.035)
})

async function refill() {
  const parts = await Promise.all([signPool(), signPool()])
  for (const rows of parts) for (const r of rows) if (/^[가-힣]{3,11}$/.test(r.name) && !used.has(r.name)) pool.push(r)
}

async function nextName() {
  const [lo, hi] = BANDS[Math.min(BANDS.length - 1, Math.floor((hits.value / Math.max(1, props.goal)) * BANDS.length))]
  if (pool.filter((r) => r.name.length >= lo && r.name.length <= hi).length < 3) await refill().catch(() => {})
  const fit = pool.filter((r) => r.name.length >= lo && r.name.length <= hi && !used.has(r.name))
  const list = fit.length ? fit : pool.filter((r) => !used.has(r.name))
  const pick = list[Math.floor(Math.random() * list.length)] || { name: '간판수리공', cat: '', region: '' }
  used.add(pick.name)
  pool = pool.filter((r) => r !== pick)
  return pick
}

async function show() {
  if (phase.value !== 'play') return
  const t = await nextName()
  if (phase.value !== 'play') return
  target.value = t
  run.value++
  lastWrong = -1
  clearField()
  shownAt = performance.now()
  sfx.neon?.()
}

function clearField() {
  accepting = true
  const el = field.value
  el?.blur()
  if (el) el.value = ''
  typed.value = ''
  composing.value = false
  requestAnimationFrame(() => {
    accepting = false
    if (phase.value === 'play') el?.focus()
  })
}

function float(text, x, y, bad = false) {
  const f = { id: Math.random(), text, x, y, bad }
  floats.value = [...floats.value, f]
  later(() => (floats.value = floats.value.filter((q) => q !== f)), 1000)
}

function talk(who, text, ms = 1600) {
  const s = { who, text }
  say.value = s
  later(() => say.value === s && (say.value = null), ms)
}

function onInput(e) {
  if (accepting || phase.value !== 'play' || !target.value) return
  typed.value = e.target.value.trimStart().replace(/\s+$/, '')
  sfx.key()
  const w = wrongAt.value
  if (w >= 0 && w !== lastWrong) {
    errors.value++
    sfx.wrong()
    shake.value = false
    requestAnimationFrame(() => (shake.value = true))
  }
  lastWrong = w
  check()
}

function onCompEnd(e) {
  composing.value = false
  if (accepting) return
  typed.value = e.target.value.trim()
  check()
}

function check() {
  const t = target.value
  if (!t || typed.value !== t.name) return
  // 읽었다: 이름이 전광판에서 빠져나와 거리로 내려온다
  const now = performance.now()
  typingMs += now - shownAt
  strokesDone += strokes(t.name)
  hits.value++
  saved.value = [...saved.value, { ...t, id: run.value }].slice(-7)
  target.value = null
  sfx.right()
  sfx.combo?.(hits.value)
  bossFx.value = ''
  requestAnimationFrame(() => (bossFx.value = 'hit'))
  heroPose.value = 'cheer'
  later(() => phase.value === 'play' && (heroPose.value = 'idle'), 700)
  float(`「${t.name}」 되찾음!`, 50, 46)
  talk('me', `「${t.name}」!`, 1100)
  clearField()
  if (hits.value >= props.goal) return win()
  later(show, 650)
}

// 이름이 전광판 왼쪽 끝으로 빠져나갔다
function missed() {
  if (phase.value !== 'play' || !target.value) return
  const t = target.value
  target.value = null
  lives.value--
  sfx.hurt?.()
  heroPose.value = 'hurt'
  later(() => phase.value === 'play' && (heroPose.value = 'idle'), 450)
  bossFx.value = ''
  requestAnimationFrame(() => (bossFx.value = 'laugh'))
  talk('boss', TAUNT[Math.floor(Math.random() * TAUNT.length)], 1500)
  float(`「${t.name}」 삼켜짐`, 50, 46, true)
  clearField()
  if (lives.value <= 0) return lose()
  later(show, 1100)
}

function onKey(e) {
  if (phase.value === 'over' && e.key === 'Enter') {
    e.preventDefault()
    start()
  }
}

function win() {
  phase.value = 'win'
  bossFx.value = 'gone'
  heroPose.value = 'cheer'
  field.value?.blur()
  sfx.win?.()
  window.dispatchEvent(new CustomEvent('game:over', { detail: { game: 'type', score: score.value, won: true } }))
}

function lose() {
  phase.value = 'over'
  field.value?.blur()
  sfx.lose?.()
}

function start() {
  for (const t of timers) clearTimeout(t)
  timers.clear()
  phase.value = 'play'
  lives.value = LIVES
  hits.value = 0
  errors.value = 0
  saved.value = []
  target.value = null
  bossFx.value = ''
  heroPose.value = 'idle'
  strokesDone = 0
  typingMs = 0
  banner.value = `${props.bossName}이 이름을 번쩍인다!`
  later(() => (banner.value = ''), 1500)
  later(show, 1300)
  nextTick(() => field.value?.focus())
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  refill().catch(() => {})
  start()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  for (const t of timers) clearTimeout(t)
})
</script>

<template>
  <div class="sg td" @pointerdown="phase === 'play' && field?.focus()">
    <div class="td-sky" aria-hidden="true"></div>
    <div class="sg-stars" aria-hidden="true"></div>
    <div class="td-rain" aria-hidden="true"></div>

    <header class="sg-hud">
      <span class="sg-chip"><Hearts :lives="lives" :max="LIVES" /></span>
      <span class="sg-chip"><small>되찾은 이름</small><b>{{ hits }} / {{ goal }}</b></span>
      <span class="sg-chip"><small>오타</small><b>{{ errors }}</b></span>
      <span class="sg-hp">
        <span>{{ bossName }} 체력</span>
        <b><i :style="{ width: `${Math.max(0, 1 - hits / goal) * 100}%` }"></i></b>
      </span>
    </header>

    <!-- 전광판 거인: 머리 위 커다란 전광판에 붙잡힌 이름이 흐른다 -->
    <div class="td-giant">
      <div class="td-board" :class="{ off: phase === 'win' }">
        <span class="td-board-tag">LIVE · 광고</span>
        <div class="td-led">
          <p v-if="target && phase === 'play'" :key="run" class="td-name" :style="{ animationDuration: `${dur}s` }" @animationend="missed">
            <span v-for="(c, i) in chars" :key="i" :class="c.state">{{ c.ch }}</span>
          </p>
          <p v-else-if="phase === 'win'" class="td-name still">꺼짐</p>
        </div>
        <small v-if="target && phase === 'play'" class="td-cat">{{ target.cat }} · {{ target.region.split(' ').slice(0, 2).join(' ') }}</small>
      </div>
      <img v-if="boss" :key="bossFx + hits + lives" class="sg-boss td-boss" :class="bossFx" :src="boss" alt="" draggable="false" />
      <p v-if="say?.who === 'boss'" class="sg-say boss td-boss-say px-pop">{{ say.text }}</p>
    </div>

    <div class="td-city" aria-hidden="true">
      <i v-for="n in 9" :key="n" :style="{ '--h': `${[46, 70, 38, 88, 54, 30, 76, 44, 62][n - 1]}%` }"></i>
    </div>

    <!-- 거리: 되찾은 이름이 간판으로 돌아와 줄지어 선다 -->
    <div class="td-street">
      <div class="td-hero">
        <p v-if="say?.who === 'me'" class="sg-say td-me-say px-pop">{{ say.text }}</p>
        <Hero :scale="4" :dir="0" :pose="heroPose" />
      </div>
      <ul class="td-saved" aria-label="되찾은 간판">
        <li v-for="s in saved" :key="s.id" class="sg-sign td-plate" :style="{ '--plate': pastelOf(s.cat) }">{{ s.name }}</li>
      </ul>
    </div>

    <label class="td-type" :class="{ bad: wrongAt >= 0, 'px-shake': shake }" @animationend="shake = false">
      <span class="td-type-label">읽어 주기</span>
      <input
        ref="field"
        :value="typed"
        :disabled="phase !== 'play'"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="done"
        placeholder="전광판에 흐르는 이름을 그대로 치세요"
        aria-label="간판 이름 입력"
        @input="onInput"
        @compositionstart="composing = true"
        @compositionend="onCompEnd"
      />
    </label>

    <span v-for="f in floats" :key="f.id" class="sg-float" :class="{ bad: f.bad }" :style="{ left: `${f.x}%`, top: `${f.y}%` }">{{ f.text }}</span>
    <span v-if="banner" class="sg-banner boss px-pop">{{ banner }}</span>

    <div v-if="phase === 'win'" class="sg-end">
      <h1 class="px-pop">전광판이 꺼졌다!</h1>
      <p>붙잡혀 있던 간판 이름 <b>{{ hits }}개</b>를 되찾았다 · <b>{{ score }}타</b></p>
    </div>
    <div v-else-if="phase === 'over'" class="sg-end lost">
      <h1 class="px-shake">광고 속에 갇혔다…</h1>
      <p>{{ bossName }} 체력이 <b>{{ Math.max(0, goal - hits) }}</b>만큼 남았어요</p>
      <button class="sg-btn go" @click="start">다시 맞서기 ▶</button>
    </div>
  </div>
</template>

<style scoped>
.td {
  background: #0b0d2a;
}

.td-sky {
  position: absolute;
  inset: 0;
  background: linear-gradient(#070820 0 30%, #191a4a 30% 55%, #2a1f5a 55% 70%, #3b2363 70%);
}

/* 비: 사선 줄무늬를 천천히 내린다 */
.td-rain {
  position: absolute;
  inset: 0;
  z-index: 6;
  background-image: repeating-linear-gradient(105deg, transparent 0 22px, rgb(160 190 255 / 0.13) 22px 24px, transparent 24px 61px);
  background-size: 200px 200px;
  animation: td-rain 0.6s linear infinite;
  pointer-events: none;
}

@keyframes td-rain {
  to {
    background-position: -40px 200px;
  }
}

.td-giant {
  position: absolute;
  top: 54px;
  left: 50%;
  z-index: 3;
  width: min(86%, 860px);
  translate: -50% 0;
  display: grid;
  justify-items: center;
}

/* 전광판: 검은 판에 LED 점 무늬 */
.td-board {
  position: relative;
  z-index: 2;
  width: 100%;
  padding: 10px 12px 8px;
  background: #121212;
  box-shadow: 0 0 0 4px #2b3a78, 0 0 0 7px #0b1028, 0 0 40px rgb(255 120 60 / 0.35);
  text-align: center;
}

.td-board.off {
  box-shadow: 0 0 0 4px #2b2f55, 0 0 0 7px #0b1028;
}

.td-board-tag {
  position: absolute;
  top: -12px;
  left: 14px;
  padding: 1px 8px;
  background: #ff004d;
  color: #fff;
  font-size: 11px;
}

.td-led {
  position: relative;
  height: clamp(64px, 9cqi, 96px);
  overflow: hidden;
  background:
    radial-gradient(circle, rgb(255 255 255 / 0.06) 1.2px, transparent 1.6px) 0 0 / 6px 6px,
    #050505;
}

.td-name {
  position: absolute;
  top: 50%;
  left: 100%;
  margin: 0;
  translate: 0 -50%;
  color: #ffb000;
  font-size: clamp(38px, 5.4cqi, 62px);
  line-height: 1;
  white-space: nowrap;
  text-shadow: 0 0 10px rgb(255 160 0 / 0.8), 0 0 2px #fff6c0;
  animation: td-flow linear forwards;
}

.td-name.still {
  left: 50%;
  translate: -50% -50%;
  color: #2b3a78;
  text-shadow: none;
  animation: none;
}

@keyframes td-flow {
  from {
    left: 100%;
    transform: translateX(0);
  }
  to {
    left: 0;
    transform: translateX(-100%);
  }
}

.td-name .ok {
  color: #00e436;
  text-shadow: 0 0 10px rgb(0 228 54 / 0.8);
}

.td-name .bad {
  color: #ff004d;
  text-shadow: 0 0 10px rgb(255 0 77 / 0.8);
}

.td-name .next,
.td-name .now {
  box-shadow: inset 0 -5px 0 #fff6c0;
}

.td-cat {
  display: block;
  margin-top: 5px;
  color: #ffa300;
  font-size: 12px;
}

.td-boss {
  position: relative;
  z-index: 1;
  height: clamp(170px, 34cqh, 300px);
  margin-top: -6px;
}

.td-boss-say {
  position: absolute;
  top: 46%;
  left: calc(50% + 120px);
  z-index: 4;
  --tail: 10px;
}

/* 빌딩 숲: 창문 불빛 무늬 */
.td-city {
  position: absolute;
  inset: auto 0 96px;
  z-index: 4;
  height: 30%;
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 0 8px;
  pointer-events: none;
}

.td-city i {
  flex: 1;
  height: var(--h);
  background:
    linear-gradient(90deg, #141738 55%, transparent 0) 6px 10px / 16px 18px,
    linear-gradient(#141738 50%, transparent 0) 6px 10px / 16px 18px,
    linear-gradient(170deg, #ffd84d 0 30%, #4a4378 30%);
  box-shadow: inset 0 3px 0 #23285c;
  opacity: 0.95;
}

.td-street {
  position: absolute;
  inset: auto 0 0;
  z-index: 5;
  height: 104px;
  display: flex;
  align-items: flex-end;
  gap: 18px;
  padding: 0 18px 10px;
  background: linear-gradient(#2a2d55 0 8px, #1a1c3c 8px);
}

.td-hero {
  position: relative;
  flex: none;
  margin-bottom: -6px;
}

.td-me-say {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 10px;
  white-space: nowrap;
}

.td-saved {
  display: flex;
  flex-wrap: wrap-reverse;
  align-items: flex-end;
  gap: 10px;
  margin: 0 0 50px;
  padding: 0;
  list-style: none;
  max-width: calc(100% - 420px);
}

.td-plate {
  padding: 4px 9px;
  font-size: 14px;
  animation: td-land 0.5s steps(5) both;
}

@keyframes td-land {
  from {
    translate: 0 -260px;
    opacity: 0.4;
  }
}

/* 입력 칸: 거리 위에 떠 있는 픽셀 칸 */
.td-type {
  position: absolute;
  right: 18px;
  bottom: 14px;
  z-index: 7;
  display: grid;
  gap: 3px;
  width: min(420px, 46%);
}

/* 대화창 이름표 같은 주황 탭 */
.td-type-label {
  justify-self: start;
  margin-left: 12px;
  padding: 5px 12px 4px;
  color: #1d1d1f;
  background: #ffa300;
  font-size: 13px;
  line-height: 1.2;
  box-shadow: 0 -3px 0 #fff1e8, -3px 0 0 #fff1e8, 3px 0 0 #fff1e8;
}

.td-type input {
  width: 100%;
  height: 48px;
  padding: 0 14px;
  border: 0;
  background: #141b3a;
  color: #ffec27;
  font: inherit;
  font-size: 20px;
  outline: none;
  caret-color: #ffa300;
  box-shadow: inset 0 0 0 3px #2b3a78, var(--sg-frame), 0 6px 0 rgb(0 0 0 / 0.45);
}

.td-type.bad input {
  box-shadow: inset 0 0 0 3px #7e2553, 0 -3px 0 #ff004d, 0 3px 0 #ff004d, -3px 0 0 #ff004d, 3px 0 0 #ff004d, 0 6px 0 rgb(0 0 0 / 0.45);
}

.td-type input::placeholder {
  color: #c2c3c7;
  font-size: 14px;
}
</style>
