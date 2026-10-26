<script setup>
// 간판 타자왕: 전국에서 가장 긴 축에 드는 실제 간판 이름 다섯 개를 누가 더 빨리 치나.
// 오늘의 문제는 날짜로 고르므로 그날은 모두 같은 간판을 친다. 점수는 타수(분당 자모 수) × 정확도
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref } from 'vue'
import { load } from '../data.js'
import { pastelOf } from '../shops.js'
import { sfx } from '../sound.js'
import { useCountUp } from './countUp.js'
import Leaderboard from './Leaderboard.vue'
import './pixel.css'

// embed: 거리 이야기 안에서 열린 판. 창 대신 전광판 거인과 맞서는 장면(TypeDuel)을 띄운다
const props = defineProps({ embed: Boolean, goal: { type: Number, default: 8 }, boss: { type: String, default: '' }, bossName: { type: String, default: '' } })
const TypeDuel = defineAsyncComponent(() => import('./stage/TypeDuel.vue'))

const BEST_KEY = 'gp-type-best'
const TIER_NAMES = ['몸풀기', '조금 긴', '꽤 긴', '아주 긴', '괴물 간판']

const phase = ref('ready') // ready | count | play | over
const mode = ref('today') // today | free
const signs = ref([])
const step = ref(0)
const typed = ref('')
const count = ref(3)
const now = ref(0)
const laps = ref([])
const errors = ref(0)
const best = ref(Number(localStorage.getItem(BEST_KEY)) || 0)
const field = ref(null)
const longest = ref(null)
const failed = ref('')

let t0 = 0
let lapStart = 0
let timer = 0
const composing = ref(false)
let lastWrong = 0

// 한글 한 글자를 치는 데 드는 자판 수: 초성 1 + 중성 1~2 + 종성 0~2 (ㅘ·ㄺ처럼 겹친 건 2)
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

// 날짜로 정하는 씨앗: 같은 날이면 같은 다섯 간판
function seeded(seed) {
  let s = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32)
}
const todayKey = () => new Date().toLocaleDateString('sv-SE')

async function pickSigns(kind) {
  const data = await load('long.json')
  const rand = kind === 'today' ? seeded(todayKey()) : Math.random
  return data.tiers.map((t, i) => {
    const [name, cat, region] = t.names[Math.floor(rand() * t.names.length)]
    return { name, cat, region, tier: TIER_NAMES[i], strokes: strokes(name) }
  })
}

load('long.json')
  .then((d) => (longest.value = d.tiers.at(-1).names.reduce((a, b) => (b[0].length > a[0].length ? b : a))))
  .catch(() => (failed.value = '간판 목록을 불러오지 못했어요'))

const target = computed(() => signs.value[step.value]?.name || '')
const elapsed = computed(() => (phase.value === 'play' || phase.value === 'over' ? Math.max(0, now.value - t0) / 1000 : 0))
const doneStrokes = computed(() => signs.value.slice(0, step.value).reduce((a, s) => a + s.strokes, 0) + strokes(okPrefix.value))
const speed = computed(() => (elapsed.value > 0.5 ? Math.round((doneStrokes.value / elapsed.value) * 60) : 0))
const totalChars = computed(() => signs.value.reduce((a, s) => a + s.name.length, 0))
const accuracy = computed(() => (totalChars.value ? totalChars.value / (totalChars.value + errors.value) : 1))
const score = computed(() => Math.round(speed.value * accuracy.value))
// 끝 화면 점수는 0 부터 또각또각 올라간다
const shownScore = useCountUp(() => (phase.value === 'over' ? score.value : 0), { ms: 800, tick: () => sfx.tick() })

// 맞게 친 앞부분 (조합 중인 마지막 글자는 아직 판정하지 않는다)
const okPrefix = computed(() => {
  const t = target.value
  let i = 0
  while (i < typed.value.length && typed.value[i] === t[i]) i++
  return t.slice(0, i)
})
const wrongAt = computed(() => {
  const v = typed.value
  const t = target.value
  const upto = composing.value ? v.length - 1 : v.length
  for (let i = 0; i < upto; i++) if (v[i] !== t[i]) return i
  return -1
})
const chars = computed(() =>
  [...target.value].map((ch, i) => {
    const v = typed.value[i]
    let state = ''
    if (v != null) state = v === ch ? 'ok' : i === typed.value.length - 1 && composing.value ? 'now' : 'bad'
    else if (i === typed.value.length) state = 'next'
    return { ch, state }
  }),
)

async function start(kind = mode.value) {
  mode.value = kind
  failed.value = ''
  try {
    signs.value = await pickSigns(kind)
  } catch {
    failed.value = '간판 목록을 불러오지 못했어요'
    return
  }
  step.value = 0
  typed.value = ''
  laps.value = []
  errors.value = 0
  lastWrong = -1
  count.value = 3
  phase.value = 'count'
  sfx.countdown()
  const tick = setInterval(() => {
    count.value -= 1
    if (count.value > 0) return sfx.countdown()
    clearInterval(tick)
    go()
  }, 700)
}

function go() {
  phase.value = 'play'
  t0 = lapStart = performance.now()
  now.value = t0
  timer = setInterval(() => (now.value = performance.now()), 100)
  nextTick(() => field.value?.focus())
}

function onInput(e) {
  let v = e.target.value
  if (v.startsWith(' ')) v = v.trimStart()
  typed.value = v
  sfx.key()
  const w = wrongAt.value
  if (w >= 0 && w !== lastWrong) {
    errors.value += 1
    sfx.wrong()
  }
  lastWrong = w
  if (!composing.value) check()
}

function onCompEnd(e) {
  composing.value = false
  typed.value = e.target.value.trimStart()
  check()
}

function check() {
  if (typed.value !== target.value) return
  const t = performance.now()
  laps.value = [...laps.value, (t - lapStart) / 1000]
  lapStart = t
  sfx.right()
  typed.value = ''
  if (field.value) field.value.value = ''
  lastWrong = -1
  if (step.value + 1 >= signs.value.length) return finish()
  step.value += 1
}

function finish() {
  clearInterval(timer)
  now.value = performance.now()
  step.value = signs.value.length
  phase.value = 'over'
  if (mode.value === 'today' && score.value > best.value) {
    best.value = score.value
    localStorage.setItem(BEST_KEY, String(score.value))
  }
  sfx.win()
  // 오늘의 간판은 순위표가 알린다. 자유 연습도 이야기 퀘스트에서는 끝으로 친다
  if (mode.value !== 'today') window.dispatchEvent(new CustomEvent('game:over', { detail: { game: 'type', score: score.value } }))
}

function quit() {
  clearInterval(timer)
  phase.value = 'ready'
}

const fmt = (s) => `${s.toFixed(1)}초`
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <TypeDuel v-if="props.embed" :goal="props.goal" :boss="props.boss" :boss-name="props.bossName || '전광판 거인'" />
  <div v-else class="type-app">
    <template v-if="phase === 'ready'">
      <div class="ink-hero type-hero">
        <span class="ink-bubble">실제 간판 다섯 개</span>
        <h1 class="ink-title">간판 <em>타자왕</em></h1>
        <p class="ink-lead">전국에서 가장 긴 축에 드는 진짜 간판 이름,<br />누가누가 더 빨리 칠까요?</p>
        <p class="ink-stats">
          <span>대결 내 최고<b>{{ best ? `${best}타` : '-' }}</b></span><i></i><span>몸풀기 → 괴물 간판<b>5단계</b></span>
        </p>
      </div>
      <figure v-if="longest" class="type-teaser ink-card">
        <figcaption class="ink-sub">이런 간판도 있어요 · {{ longest[0].length }}글자</figcaption>
        <p>{{ longest[0] }}</p>
        <small class="ink-sub">{{ longest[1] }} · {{ longest[2] }}</small>
      </figure>
      <div class="type-actions">
        <button class="ink-pill" @click="start('today')">오늘의 간판으로 대결</button>
        <button class="ink-pill ghost" @click="start('free')">아무 간판으로 연습</button>
      </div>
      <p class="ink-sub type-note">오늘의 간판은 날짜로 고르므로 오늘은 모두가 같은 다섯 개를 쳐요. 리더보드에는 대결 기록만 올라가요.</p>
      <p v-if="failed" class="m-err">{{ failed }}</p>
    </template>

    <div v-else-if="phase === 'count'" class="type-count">
      <span class="ink-sub">{{ mode === 'today' ? `${todayKey()} 오늘의 간판` : '연습' }}</span>
      <b :key="count" class="px-pop">{{ count }}</b>
    </div>

    <template v-else-if="phase === 'play'">
      <header class="type-hud">
        <span class="ink-chip on">{{ step + 1 }} / {{ signs.length }} · {{ signs[step].tier }}</span>
        <p class="ink-stats">
          <span>시간<b>{{ elapsed.toFixed(1) }}</b></span><i></i><span>타수<b>{{ speed }}</b></span><i></i><span>오타<b>{{ errors }}</b></span>
        </p>
      </header>
      <div class="type-board" :style="{ '--plate': pastelOf(signs[step].cat) }">
        <p class="type-plate" :aria-label="target">
          <span v-for="(c, i) in chars" :key="`${step}-${i}`" :class="c.state">{{ c.ch }}</span>
        </p>
        <small>{{ signs[step].cat }} · {{ signs[step].region }} · {{ target.length }}글자</small>
      </div>
      <input
        ref="field"
        class="ink-field type-field"
        :class="{ bad: wrongAt >= 0 }"
        :value="typed"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        placeholder="간판 이름을 그대로 치세요"
        aria-label="간판 이름 입력"
        @input="onInput"
        @compositionstart="composing = true"
        @compositionend="onCompEnd"
        @keydown.esc="quit"
      />
      <ol class="type-steps" aria-hidden="true">
        <li v-for="(s, i) in signs" :key="i" :class="{ done: i < step, on: i === step }">{{ s.tier }}</li>
      </ol>
    </template>

    <template v-else>
      <div class="ink-hero">
        <span class="ink-bubble px-pop">{{ mode === 'today' ? '오늘의 간판 다섯 개 완주!' : '연습 완주!' }}</span>
        <h1 class="ink-title type-score"><em>{{ shownScore }}</em>타</h1>
        <p class="ink-stats">
          <span>걸린 시간<b>{{ fmt(elapsed) }}</b></span><i></i><span>정확도<b>{{ Math.round(accuracy * 100) }}%</b></span><i></i><span>오타<b>{{ errors }}</b></span>
        </p>
      </div>
      <ol class="type-recap ink-card">
        <li v-for="(s, i) in signs" :key="i">
          <span class="ink-sub">{{ s.tier }}</span>
          <b>{{ s.name }}</b>
          <span class="t">{{ laps[i] != null ? fmt(laps[i]) : '' }}</span>
        </li>
      </ol>
      <div class="type-actions">
        <button class="ink-pill" @click="start(mode)">한 판 더</button>
        <button class="ink-pill ghost" @click="phase = 'ready'">처음으로</button>
      </div>
      <Leaderboard v-if="mode === 'today'" class="type-board-lb" game="type" :score="score" unit="타" />
      <p class="ink-sub type-note">타수 = 1분 동안 친 자판 수(겹모음·겹받침은 2타), 점수는 타수 × 정확도예요. 간판은 소상공인 상가정보 검색 표본에서 골랐어요.</p>
    </template>
  </div>
</template>

<style scoped>
.type-app {
  display: grid;
  gap: 18px;
  justify-items: center;
  padding: 28px 26px 24px;
  min-height: 460px;
  align-content: start;
}

.type-hero {
  margin-top: 6px;
}

.type-teaser {
  width: 100%;
  margin: 0;
  display: grid;
  gap: 6px;
  text-align: center;
}

.type-teaser p {
  margin: 0;
  font-size: 17px;
  font-weight: 800;
  line-height: 1.35;
  word-break: break-all;
}

.type-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}

.type-note {
  max-width: 440px;
  text-align: center;
  line-height: 1.5;
}

.type-count {
  display: grid;
  justify-items: center;
  gap: 6px;
  margin-top: 90px;
}

.type-count b {
  font-family: var(--game-font);
  font-size: 120px;
  font-weight: 400;
  line-height: 1;
  color: var(--neon);
  text-shadow: 6px 6px 0 #000;
}

/* 결과 점수는 픽셀 글꼴로 */
.type-score em {
  font-family: var(--game-font);
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.type-hud {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.type-board {
  width: 100%;
  display: grid;
  gap: 8px;
  justify-items: center;
}

/* 진짜 간판판: 업종 색 바탕에 굵은 글씨 */
.type-plate {
  margin: 0;
  width: 100%;
  padding: 18px 20px;
  border-radius: 14px;
  background: var(--plate);
  box-shadow:
    inset 0 0 0 3px rgba(0, 0, 0, 0.18),
    0 10px 30px rgba(0, 0, 0, 0.5);
  color: #1d1d2b;
  font-size: 30px;
  font-weight: 900;
  line-height: 1.3;
  letter-spacing: -0.02em;
  text-align: center;
  word-break: break-all;
}

.type-plate span {
  border-radius: 4px;
  transition: color 0.1s;
}

.type-plate .ok {
  color: rgba(29, 29, 43, 0.28);
}

.type-plate .bad {
  color: #fff;
  background: #ff375f;
}

.type-plate .now,
.type-plate .next {
  box-shadow: inset 0 -4px 0 #1d1d2b;
}

.type-board small {
  font-size: 12px;
  color: var(--ink-2);
}

.mac-win.ink .type-field {
  width: 100%;
  font-size: 20px;
  padding: 12px 14px;
  text-align: center;
}

.mac-win.ink .type-field.bad {
  box-shadow: 0 0 0 2px #ff375f;
}

.type-steps {
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 11px;
  color: var(--ink-3);
}

.type-steps li {
  padding: 3px 8px;
  border-radius: 999px;
  background: var(--ink-card);
}

.type-steps li.done {
  color: var(--neon-ink);
  background: var(--neon);
}

.type-steps li.on {
  color: #fff;
  box-shadow: inset 0 0 0 1px var(--neon);
}

.type-recap {
  width: 100%;
  margin: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.type-recap li {
  display: grid;
  grid-template-columns: 64px 1fr auto;
  gap: 10px;
  align-items: baseline;
}

.type-recap b {
  font-size: 13px;
  word-break: break-all;
}

.type-recap .t {
  font-size: 12px;
  color: var(--blue);
  font-variant-numeric: tabular-nums;
}
</style>
