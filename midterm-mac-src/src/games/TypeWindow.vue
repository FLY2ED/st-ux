<script setup>
// 간판 타자왕: 전국에서 가장 긴 축에 드는 실제 간판 이름 다섯 개를 누가 더 빨리 치나.
// 오늘의 문제는 날짜로 고르므로 그날은 모두 같은 간판을 친다. 점수는 타수(분당 자모 수) × 정확도
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { load } from '../data.js'
import { pastelOf } from '../shops.js'
import { sfx } from '../sound.js'
import { useCountUp } from './countUp.js'
import Leaderboard from './Leaderboard.vue'
import Hero from './stage/Hero.vue'
import './pixel.css'

// embed: 거리 이야기 안에서 열린 판. 창 대신 전광판 거인과 맞서는 장면(TypeDuel)을 띄운다
const props = defineProps({ embed: Boolean, goal: { type: Number, default: 8 }, boss: { type: String, default: '' }, bossName: { type: String, default: '' } })
const TypeDuel = defineAsyncComponent(() => import('./stage/TypeDuel.vue'))

const ICON = new URL('../assets/mac/type.webp', import.meta.url).href
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

// 거리 그림: 뒤쪽 빌딩 숲. 창마다 불빛 색이 조금씩 다르다
const BUILDINGS = [
  { x: 0, w: 9, h: 62, lit: '#ffd84d' },
  { x: 8, w: 7, h: 84, lit: '#7fd1d1' },
  { x: 14, w: 11, h: 54, lit: '#f6a5c0' },
  { x: 24, w: 8, h: 92, lit: '#ffd84d' },
  { x: 31, w: 10, h: 66, lit: '#c69be0' },
  { x: 40, w: 7, h: 78, lit: '#f2b46b' },
  { x: 46, w: 12, h: 58, lit: '#7fd1d1' },
  { x: 57, w: 8, h: 88, lit: '#ffd84d' },
  { x: 64, w: 10, h: 60, lit: '#f6a5c0' },
  { x: 73, w: 7, h: 80, lit: '#9fd8a8' },
  { x: 79, w: 11, h: 64, lit: '#ffd84d' },
  { x: 89, w: 11, h: 86, lit: '#c69be0' },
]

// 업종별 가게 앞모습(간판 자리는 비어 있다). 업종 판정은 간판 닦기(SignClean)와 같은 규칙
const FRONT = import.meta.glob('../assets/storefront/*.webp', { eager: true, import: 'default' })
const KINDS = [
  ['conv', /편의점|슈퍼|마트|식료품|반찬|GS25|CU|세븐일레븐|이마트24|미니스톱/],
  ['pharm', /약국|약방/],
  ['laundry', /세탁|빨래/],
  ['hair', /미용|헤어|이용원|네일|뷰티|피부/],
  ['cafe', /카페|커피|다방|찻집|디저트|아이스크림|빙수/],
  ['bread', /빵|베이커리|제과|도넛|케이크/],
  ['chicken', /치킨|통닭|호프|주점|술집|포차|맥주|고기|갈비|삼겹|족발/],
  ['snack', /분식|김밥|떡볶이|만두|국수|식당|한식|백반|중식|중국|일식|돈가스|음식|반점/],
  ['clinic', /의원|병원|치과|한의|학원|교습|부동산|중개|사무소|세무|법무/],
]
const kindOf = (s) => (s ? KINDS.find(([, re]) => re.test(`${s.cat} ${s.name}`))?.[0] || 'store' : 'store')
const frontOf = (s) => FRONT[`../assets/storefront/${kindOf(s)}.webp`]

// 내 캐릭터: 간판 하나를 끝내면 만세, 틀리면 움찔
const heroPose = ref('idle')
let poseTimer = 0
function pose(p, ms) {
  heroPose.value = p
  clearTimeout(poseTimer)
  poseTimer = setTimeout(() => (heroPose.value = 'idle'), ms)
}
watch(() => laps.value.length, (n) => n && pose('cheer', 700))
watch(errors, (n, o) => n > o && pose('hurt', 400))

// 긴 간판일수록 글씨를 줄여 판 하나에 들어가게
const plateFont = computed(() => {
  const n = target.value.length
  return n > 26 ? 19 : n > 20 ? 23 : n > 14 ? 28 : n > 10 ? 32 : 38
})
const hudStep = computed(() => (phase.value === 'play' ? `${step.value + 1}/${signs.value.length}` : phase.value === 'over' ? '완주' : '-'))

onBeforeUnmount(() => {
  clearInterval(timer)
  clearTimeout(poseTimer)
})
</script>


<template>
  <TypeDuel v-if="props.embed" :goal="props.goal" :boss="props.boss" :boss-name="props.bossName || '전광판 거인'" />
  <div v-else class="tw px" :class="`is-${phase}`">
    <div class="tw-program">
      <img :src="ICON" alt="" draggable="false" />
      <span>간판 타자왕 · {{ mode === 'today' ? '오늘의 간판' : '연습' }}</span>
      <span class="tw-program-hint">{{ todayKey() }}</span>
    </div>

    <div class="tw-hud">
      <span class="tw-stat"><small>단계</small><b>{{ hudStep }}</b></span>
      <span class="tw-stat"><small>시간</small><b>{{ elapsed.toFixed(1) }}<span>초</span></b></span>
      <span class="tw-stat tw-speed"><small>타수</small><b>{{ speed }}<span>타/분</span></b></span>
      <span class="tw-stat"><small>오타</small><b :class="{ hot: errors }">{{ errors }}</b></span>
      <span class="tw-stat"><small>대결 최고</small><b>{{ best ? `${best}타` : '-' }}</b></span>
    </div>

    <div class="tw-stage" @click="phase === 'play' && field?.focus()">
      <div class="tw-stars" aria-hidden="true"></div>
      <i class="tw-moon" aria-hidden="true"></i>
      <div class="tw-city" aria-hidden="true">
        <i v-for="(b, n) in BUILDINGS" :key="n" :style="{ left: `${b.x}%`, width: `${b.w}%`, height: `${b.h}%`, '--lit': b.lit }"></i>
      </div>
      <div class="tw-ground" aria-hidden="true"></div>

      <!-- 첫 화면: 제목 간판과 오늘 맞설 가장 긴 간판 -->
      <template v-if="phase === 'ready'">
        <div class="tw-ready">
          <header class="tw-logo">
            <p class="tw-eyebrow">전국의 진짜 간판 다섯 개로 타자 대결</p>
            <h1>간판 <em>타자왕</em></h1>
            <p class="tw-logo-sub">전국에서 가장 긴 축에 드는 진짜 간판 이름, 누가누가 더 빨리 칠까요?</p>
          </header>
          <figure v-if="longest" class="tw-teaser">
            <figcaption>이런 간판도 있어요 · {{ longest[0].length }}글자</figcaption>
            <div class="tw-hang">
              <p class="tw-plate small" :style="{ '--plate': pastelOf(longest[1]) }">{{ longest[0] }}</p>
            </div>
            <small>{{ longest[1] }} · {{ longest[2] }}</small>
          </figure>
          <ol class="tw-tiers" aria-label="단계">
            <li v-for="(t, i) in TIER_NAMES" :key="t"><b>{{ i + 1 }}</b>{{ t }}</li>
          </ol>
          <div class="tw-actions">
            <button class="tw-btn go" @click.stop="start('today')">오늘의 간판으로 대결 <span aria-hidden="true">▶</span></button>
            <button class="tw-btn" @click.stop="start('free')">아무 간판으로 연습</button>
          </div>
          <p class="tw-note">오늘의 간판은 날짜로 고르므로 오늘은 모두가 같은 다섯 개를 쳐요. 리더보드에는 대결 기록만 올라가요.</p>
          <p v-if="failed" class="tw-err">{{ failed }}</p>
        </div>
        <div class="tw-me ready" aria-hidden="true">
          <span class="tw-say">한 판 붙자!</span>
          <Hero :scale="3" :dir="3" pose="idle" />
        </div>
      </template>

      <div v-else-if="phase === 'count'" class="tw-count">
        <span class="tw-eyebrow">{{ mode === 'today' ? `${todayKey()} 오늘의 간판` : '연습' }}</span>
        <b :key="count" class="px-pop">{{ count }}</b>
        <div class="tw-me" aria-hidden="true">
          <Hero :scale="3" :dir="0" pose="cheer" />
        </div>
      </div>

      <!-- 대결: 가게 앞에 매달린 간판을 그대로 친다 -->
      <template v-else-if="phase === 'play'">
        <ol class="tw-rail" aria-hidden="true">
          <li v-for="(s, i) in signs" :key="i" :class="{ done: i < step, on: i === step }" :style="{ '--plate': pastelOf(s.cat) }">
            <span>{{ i < step ? '✓' : i + 1 }}</span>{{ s.tier }}
          </li>
        </ol>
        <div class="tw-shop" :style="{ '--plate': pastelOf(signs[step].cat) }">
          <div class="tw-hang">
            <p :key="step" class="tw-plate tw-lit" :style="{ fontSize: `${plateFont}px` }" :aria-label="target">
              <span v-for="(c, i) in chars" :key="`${step}-${i}`" :class="c.state">{{ c.ch }}</span>
            </p>
          </div>
          <p class="tw-tag">
            <span>{{ signs[step].tier }}</span>{{ signs[step].cat }} · {{ signs[step].region }} · <b>{{ okPrefix.length }}</b>/{{ target.length }}글자
          </p>
          <img :key="`f${step}`" class="tw-front" :src="frontOf(signs[step])" alt="" draggable="false" />
        </div>
        <div class="tw-me" aria-hidden="true">
          <span v-if="heroPose === 'cheer'" class="tw-say px-pop">다 쳤다!</span>
          <span v-else-if="heroPose === 'hurt'" class="tw-say bad px-pop">앗, 오타!</span>
          <Hero :scale="3" :dir="3" :pose="heroPose" />
        </div>
      </template>

      <!-- 끝: 95식 결과 대화상자 -->
      <div v-else class="tw-dialog px-pop">
        <div class="tw-dialog-bar">
          <span aria-hidden="true">▤</span>
          <strong>{{ mode === 'today' ? '오늘의 간판 다섯 개 완주!' : '연습 완주!' }}</strong>
        </div>
        <div class="tw-dialog-body">
          <section class="tw-result">
            <div class="tw-result-me" aria-hidden="true">
              <Hero :scale="3" :dir="0" pose="cheer" />
            </div>
            <p class="tw-result-score">{{ shownScore }}<small>타</small></p>
            <dl class="tw-result-stats">
              <div><dt>걸린 시간</dt><dd>{{ fmt(elapsed) }}</dd></div>
              <div><dt>정확도</dt><dd>{{ Math.round(accuracy * 100) }}%</dd></div>
              <div><dt>오타</dt><dd>{{ errors }}</dd></div>
            </dl>
            <div class="tw-actions">
              <button class="tw-btn go" @click.stop="start(mode)">한 판 더 <span aria-hidden="true">▶</span></button>
              <button class="tw-btn" @click.stop="phase = 'ready'">처음으로</button>
            </div>
          </section>
          <ol class="tw-recap">
            <li v-for="(s, i) in signs" :key="i">
              <small>{{ s.tier }}</small>
              <b class="tw-plate mini" :style="{ '--plate': pastelOf(s.cat) }">{{ s.name }}</b>
              <span class="t">{{ laps[i] != null ? fmt(laps[i]) : '' }}</span>
            </li>
          </ol>
          <Leaderboard v-if="mode === 'today'" class="tw-records" game="type" :score="score" unit="타" />
        </div>
        <p class="tw-note">타수 = 1분 동안 친 자판 수(겹모음·겹받침은 2타), 점수는 타수 × 정확도예요. 간판은 소상공인 상가정보 검색 표본에서 골랐어요.</p>
      </div>
    </div>

    <div v-if="phase === 'play' || phase === 'count'" class="tw-input-panel">
      <label class="tw-input-label">
        <span>간판 입력</span>
        <input
          ref="field"
          class="tw-type"
          :class="{ bad: wrongAt >= 0 }"
          :value="typed"
          :disabled="phase !== 'play'"
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
      </label>
      <p class="tw-input-help"><span>마지막 글자까지 똑같이 치면 다음 간판</span><span><kbd>Esc</kbd> 그만두기</span></p>
    </div>
  </div>
</template>

<style scoped>
.tw {
  --tw-panel: #c0c0c0;
  --tw-navy: #000080;
  --tw-cyan: #72f4ff;
  --tw-yellow: #ffec27;
  --tw-pink: #ff83ee;
  --tw-ink: #1d1b2e;
  --tw-edge: inset 1px 1px #fff, inset -1px -1px #181818, inset 2px 2px #dfdfdf, inset -2px -2px #808080;
  --tw-inset: inset 1px 1px #808080, inset -1px -1px #fff, inset 2px 2px #181818, inset -2px -2px #dfdfdf;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 8px;
  box-sizing: border-box;
  height: 100%;
  min-height: 560px;
  padding: 10px;
  color: #161616;
  background: var(--tw-panel);
  box-shadow: var(--tw-edge);
  font-size: 12px;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
}

.tw,
.tw :deep(*) {
  box-sizing: border-box;
}

.tw-program {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  font-weight: 700;
}

.tw-program img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.tw-program-hint {
  margin-left: auto;
  color: #454545;
  font-weight: 400;
}

/* 회색 계기판과 남색 숫자창 */
.tw-hud {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
  padding: 6px 8px 8px;
  box-shadow: var(--tw-edge);
}

.tw-stat {
  display: grid;
  gap: 2px;
  min-width: 0;
  text-align: center;
}

.tw-stat b {
  display: block;
  padding: 3px 4px;
  color: var(--tw-cyan);
  background: #090d27;
  box-shadow: var(--tw-inset);
  font-size: 14px;
  line-height: 24px;
  white-space: nowrap;
  overflow: hidden;
}

.tw-stat b span {
  margin-left: 3px;
  font-size: 11px;
  color: #c8d5ef;
}

.tw-speed b {
  color: var(--tw-yellow);
  font-size: 18px;
}

.tw-stat b.hot {
  color: var(--tw-pink);
}

/* 밤 상가 거리: 별, 달, 불 켜진 빌딩, 보도블록 */
.tw-stage {
  position: relative;
  container-type: size;
  min-height: 0;
  overflow: hidden;
  border: 2px solid #080817;
  background: linear-gradient(#0a0b2a 0%, #1b1a4c 50%, #3a2462 82%, #5a2f5e 100%);
  box-shadow: 0 0 0 1px #808080, 1px 1px 0 1px #fff;
}

.tw-stars {
  position: absolute;
  inset: 0 0 30%;
  opacity: 0.7;
  background:
    radial-gradient(circle at 9% 12%, #c9d2ff 0 1px, transparent 1.5px),
    radial-gradient(circle at 34% 30%, #c9d2ff 0 1px, transparent 1.5px),
    radial-gradient(circle at 61% 9%, #fff6c0 0 1.5px, transparent 2px),
    radial-gradient(circle at 88% 36%, #c9d2ff 0 1px, transparent 1.5px),
    radial-gradient(circle at 48% 52%, #c9d2ff 0 1px, transparent 1.5px);
  background-size: 240px 180px;
  animation: tw-twinkle 3s steps(2) infinite;
}

@keyframes tw-twinkle {
  50% {
    opacity: 0.4;
  }
}

/* 계단 모양 초승달 */
.tw-moon {
  position: absolute;
  top: 6px;
  right: 6%;
  width: 36px;
  height: 36px;
  background: #fff1c4;
  clip-path: polygon(25% 0, 75% 0, 75% 12%, 88% 12%, 88% 25%, 100% 25%, 100% 75%, 88% 75%, 88% 88%, 75% 88%, 75% 100%, 25% 100%, 25% 88%, 12% 88%, 12% 75%, 0 75%, 0 25%, 12% 25%, 12% 12%, 25% 12%);
  box-shadow: inset -10px -6px 0 #f2c86a;
  opacity: 0.9;
}

.tw-city {
  position: absolute;
  inset: auto 0 56px;
  height: 46%;
  opacity: 0.9;
  pointer-events: none;
}

.tw-city i {
  position: absolute;
  bottom: 0;
  background:
    repeating-linear-gradient(90deg, #151638 0 7px, transparent 7px 15px),
    repeating-linear-gradient(#151638 0 10px, transparent 10px 19px),
    linear-gradient(transparent 0 18%, color-mix(in srgb, var(--lit) 60%, #151638) 18% 30%, #262a5a 30% 56%, color-mix(in srgb, var(--lit) 40%, #151638) 56% 66%, #262a5a 66%);
  box-shadow: inset 0 4px #34306e, inset 3px 0 #1c1d48;
}

/* 보도블록: 연석 한 줄과 네모 타일 */
.tw-ground {
  position: absolute;
  inset: auto 0 0;
  height: 56px;
  background:
    linear-gradient(#8a86a8 0 4px, #5d5a7e 4px 8px, transparent 8px),
    repeating-linear-gradient(90deg, transparent 0 46px, #3a3758 46px 48px),
    repeating-linear-gradient(transparent 0 22px, #3a3758 22px 24px),
    #4c4970;
}

/* 간판판: 업종 파스텔 바탕, 진한 3px 테두리, 네 모서리 나사, 위쪽 빛 */
.tw-plate {
  position: relative;
  margin: 0;
  padding: 10px 26px 8px;
  border: 3px solid var(--tw-ink);
  color: var(--tw-ink);
  background:
    radial-gradient(circle, var(--tw-ink) 0 2px, transparent 2.5px) 4px 4px / 6px 6px no-repeat,
    radial-gradient(circle, var(--tw-ink) 0 2px, transparent 2.5px) calc(100% - 4px) 4px / 6px 6px no-repeat,
    radial-gradient(circle, var(--tw-ink) 0 2px, transparent 2.5px) 4px calc(100% - 4px) / 6px 6px no-repeat,
    radial-gradient(circle, var(--tw-ink) 0 2px, transparent 2.5px) calc(100% - 4px) calc(100% - 4px) / 6px 6px no-repeat,
    var(--plate);
  box-shadow: inset 0 4px rgb(255 255 255 / 0.5), inset 0 -4px rgb(0 0 0 / 0.16), 0 6px 0 rgb(0 0 0 / 0.45);
  font-family: var(--game-font);
  font-weight: 400;
  line-height: 1.3;
  letter-spacing: 0;
  text-align: center;
  word-break: break-all;
  -webkit-font-smoothing: none;
}

.tw-plate.small {
  padding: 6px 18px 4px;
  font-size: 20px;
}

.tw-plate.mini {
  display: block;
  padding: 1px 10px 0;
  border-width: 2px;
  background:
    radial-gradient(circle, var(--tw-ink) 0 1px, transparent 1.5px) 2px 2px / 4px 4px no-repeat,
    radial-gradient(circle, var(--tw-ink) 0 1px, transparent 1.5px) calc(100% - 2px) 2px / 4px 4px no-repeat,
    var(--plate);
  box-shadow: inset 0 2px rgb(255 255 255 / 0.5), 0 2px 0 rgb(0 0 0 / 0.3);
  font-size: 13px;
  text-align: left;
}

/* 간판을 매단 쇠사슬 두 줄 */
.tw-hang {
  position: relative;
  padding-top: 18px;
}

.tw-hang::before,
.tw-hang::after {
  content: '';
  position: absolute;
  top: 0;
  width: 4px;
  height: 18px;
  background: repeating-linear-gradient(#c2c3c7 0 4px, #5f574f 4px 6px);
}

.tw-hang::before {
  left: 18%;
}

.tw-hang::after {
  right: 18%;
}

/* 친 글자는 옅어지고, 틀린 글자는 빨갛게, 칠 차례는 깜박이는 밑줄 */
.tw-plate span {
  position: relative;
}

.tw-plate .ok {
  color: rgb(29 27 46 / 0.3);
}

.tw-plate .bad {
  color: #fff;
  background: #ff004d;
}

.tw-plate .now {
  box-shadow: inset 0 -4px 0 var(--tw-ink);
}

.tw-plate .next::after {
  content: '';
  position: absolute;
  inset: auto 0 -2px;
  height: 4px;
  background: var(--tw-ink);
  animation: tw-blink 0.8s steps(1) infinite;
}

@keyframes tw-blink {
  50% {
    opacity: 0;
  }
}

/* ── 첫 화면 ── */
.tw-ready {
  position: relative;
  z-index: 2;
  display: grid;
  justify-items: center;
  align-content: start;
  gap: 12px;
  height: 100%;
  padding: 18px 24px 64px;
  overflow: auto;
}

.tw-logo {
  text-align: center;
}

.tw-eyebrow {
  margin: 0;
  color: var(--tw-cyan);
  font-size: 12px;
}

.tw-logo h1 {
  margin: 4px 0 6px;
  color: #fff;
  font-family: var(--game-font);
  font-size: 46px;
  font-weight: 400;
  line-height: 1.2;
  text-shadow: 3px 3px #3c4eaa, 5px 5px #000;
}

.tw-logo em {
  color: var(--tw-yellow);
  font-style: normal;
}

.tw-logo-sub {
  margin: 0;
  color: #d6ddff;
}

.tw-teaser {
  display: grid;
  justify-items: center;
  gap: 4px;
  max-width: 100%;
  margin: 0;
}

.tw-teaser figcaption {
  padding: 0 8px;
  color: var(--tw-ink);
  background: var(--tw-yellow);
  box-shadow: 0 3px 0 rgb(0 0 0 / 0.4);
}

.tw-teaser small {
  padding: 0 6px;
  color: #d6ddff;
  background: rgb(8 11 30 / 0.7);
}

.tw-tiers {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 0;
  margin: 0;
  padding: 0;
  list-style: none;
  color: #d6ddff;
}

.tw-tiers li {
  display: flex;
  align-items: center;
  gap: 4px;
}

.tw-tiers li + li::before {
  content: '▸';
  margin: 0 6px;
  color: #626b9b;
}

.tw-tiers b {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  color: var(--tw-ink);
  background: var(--tw-cyan);
  font-size: 11px;
}

.tw-tiers li:last-child b {
  background: var(--tw-pink);
}

.tw-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

/* 95식 회색 버튼 (창 기본 버튼 규칙보다 앞서도록 .tw 를 붙인다) */
.tw .tw-btn {
  min-height: 36px;
  padding: 6px 16px;
  border: 0;
  border-radius: 0;
  color: #161616;
  background: var(--tw-panel);
  box-shadow: var(--tw-edge);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.tw .tw-btn.go {
  outline: 1px solid #080817;
  outline-offset: 1px;
}

.tw-btn span {
  margin-left: 10px;
  color: var(--tw-navy);
}

.tw .tw-btn:hover {
  background: #d6d6d6;
}

.tw .tw-btn:active {
  background: #b5b5b5;
  box-shadow: var(--tw-inset);
}

.tw-note {
  max-width: 480px;
  margin: 0;
  padding: 2px 8px;
  color: #c8d0f0;
  background: rgb(8 11 30 / 0.75);
  font-size: 11px;
  text-align: center;
}

.tw-err {
  margin: 0;
  padding: 2px 10px;
  color: #fff;
  background: #7e2553;
}

/* 내 캐릭터: 보도 위에 서 있다 */
.tw-me {
  position: absolute;
  bottom: 14px;
  left: 4%;
  z-index: 3;
  display: grid;
  justify-items: center;
}

.tw-me.ready {
  left: 6%;
}

.tw-say {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  padding: 2px 8px;
  translate: -50% 0;
  color: var(--tw-ink);
  background: #fff1e8;
  box-shadow: 0 0 0 2px var(--tw-ink), 0 4px 0 2px rgb(0 0 0 / 0.35);
  white-space: nowrap;
}

.tw-say.bad {
  color: #fff;
  background: #ff004d;
}

/* ── 카운트다운 ── */
.tw-count {
  position: relative;
  z-index: 2;
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 6px;
  height: 100%;
  padding-bottom: 60px;
}

.tw-count b {
  display: grid;
  place-items: center;
  width: 140px;
  height: 140px;
  color: var(--tw-yellow);
  background: #090d27;
  box-shadow: 0 0 0 4px #2b3a78, 0 0 0 7px #080817, 0 0 40px rgb(255 200 60 / 0.35);
  font-family: var(--game-font);
  font-size: 96px;
  font-weight: 400;
  line-height: 1;
  text-shadow: 5px 5px 0 #000;
}

.tw-count .tw-me {
  left: 50%;
  translate: -50% 0;
}

/* ── 대결 화면 ── */
.tw-rail {
  position: absolute;
  top: 10px;
  left: 50%;
  z-index: 2;
  display: flex;
  gap: 6px;
  margin: 0;
  padding: 0;
  translate: -50% 0;
  list-style: none;
  white-space: nowrap;
}

.tw-rail li {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 1px 8px 1px 2px;
  color: #aab2dc;
  background: rgb(8 11 30 / 0.75);
  box-shadow: 0 0 0 2px #2b3a78;
}

.tw-rail li span {
  display: grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  color: var(--tw-ink);
  background: #454864;
  font-size: 11px;
}

.tw-rail li.done {
  color: #fff;
}

.tw-rail li.done span {
  background: var(--plate);
}

.tw-rail li.on {
  color: var(--tw-yellow);
  box-shadow: 0 0 0 2px var(--tw-yellow);
}

.tw-rail li.on span {
  background: var(--tw-yellow);
}

/* 가게 앞: 벽돌 벽에 간판을 달고 아래에는 업종별 1층 가게 그림. 그림은 3:1 이라 높이에 맞춰 폭을 정한다 */
.tw-shop {
  --front-h: min(calc(100cqh - 200px), calc(94cqw / 3));
  position: absolute;
  bottom: 26px;
  left: 50%;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: 8px;
  width: calc(var(--front-h) * 3);
  padding-top: 4px;
  translate: -50% 0;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='16' shape-rendering='crispEdges'%3E%3Crect width='24' height='16' fill='%23432a4d'/%3E%3Cpath d='M0 0h24v2H0zM0 8h24v2H0zM0 2h2v6H0zM12 10h2v6h-2z' fill='%232e1b36'/%3E%3C/svg%3E");
  box-shadow: inset 0 6px #5c3b66, 0 0 0 3px #1a1030;
}

.tw-shop .tw-hang {
  width: calc(100% - 32px);
}

.tw-shop .tw-plate {
  width: 100%;
  min-height: 72px;
  display: block;
  box-shadow: inset 0 4px rgb(255 255 255 / 0.5), inset 0 -4px rgb(0 0 0 / 0.16), 0 6px 0 rgb(0 0 0 / 0.45), 0 0 40px color-mix(in srgb, var(--plate) 45%, transparent);
}

.tw-tag {
  margin: 0;
  padding: 0 8px;
  color: #d6ddff;
  background: rgb(8 11 30 / 0.8);
}

.tw-tag span {
  margin-right: 8px;
  padding: 0 6px;
  color: var(--tw-ink);
  background: var(--tw-yellow);
}

.tw-tag b {
  color: var(--tw-cyan);
}

.tw-front {
  display: block;
  width: 100%;
  height: var(--front-h);
  image-rendering: pixelated;
  animation: tw-lit 0.7s steps(1) both;
}

/* 새 간판에 불이 들어온다: 어두웠다가 두어 번 깜박이고 켜진다 */
.tw-lit {
  animation: tw-lit 0.7s steps(1) both;
}

@keyframes tw-lit {
  0% {
    filter: brightness(0.35) saturate(0.6);
  }
  30% {
    filter: brightness(1.15);
  }
  45% {
    filter: brightness(0.5) saturate(0.7);
  }
  65%,
  100% {
    filter: none;
  }
}

/* ── 결과 ── */
.tw-dialog {
  position: relative;
  z-index: 2;
  display: grid;
  gap: 4px;
  width: calc(100% - 28px);
  max-height: calc(100% - 20px);
  margin: 10px auto;
  padding: 3px 3px 8px;
  overflow: auto;
  background: var(--tw-panel);
  box-shadow: var(--tw-edge), 6px 6px #0008;
}

.tw-dialog-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  color: #fff;
  background: var(--tw-navy);
}

.tw-dialog-bar span {
  color: var(--tw-cyan);
}

.tw-dialog-body {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr) minmax(0, 250px);
  align-items: start;
  gap: 12px;
  padding: 10px;
}

.tw-dialog .tw-note {
  max-width: none;
  background: none;
  padding: 0 12px;
  color: #454545;
}

.tw-result {
  display: grid;
  justify-items: center;
  gap: 8px;
}

.tw-result-me {
  height: 84px;
  display: grid;
  align-items: end;
}

.tw-result-score {
  width: 100%;
  margin: 0;
  padding: 6px;
  color: var(--tw-yellow);
  background: #090d27;
  box-shadow: var(--tw-inset);
  font-family: var(--game-font);
  font-size: 38px;
  line-height: 1.3;
  text-align: center;
}

.tw-result-score small {
  margin-left: 6px;
  color: var(--tw-cyan);
  font-size: 14px;
}

.tw-result-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: 100%;
  margin: 0;
  padding: 6px;
  text-align: center;
  box-shadow: var(--tw-inset);
}

.tw-result-stats dt {
  color: #454545;
  font-size: 11px;
}

.tw-result-stats dd {
  margin: 0;
  color: var(--tw-navy);
  font-weight: 700;
}

.tw-recap {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 8px;
  list-style: none;
  background: #2a2350;
  box-shadow: var(--tw-inset);
}

.tw-recap li {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 42px;
  align-items: center;
  gap: 6px;
}

.tw-recap small {
  color: #d6ddff;
  font-size: 11px;
}

.tw-recap .t {
  color: var(--tw-cyan);
  text-align: right;
}

/* 순위표도 같은 회색 창 안에 */
.tw .tw-dialog .tw-records {
  width: 100%;
  padding: 0;
  border-radius: 0;
  color: #161616;
  background: transparent;
  box-shadow: none;
  font: inherit;
}

.tw-records :deep(.lb-head strong) {
  color: var(--tw-navy);
}

.tw-records :deep(.muted),
.tw-records :deep(.lb-hint) {
  color: #454545;
  font-size: 11px;
}

.tw-records :deep(.lb-list) {
  gap: 0;
  padding: 3px;
  background: #f5f5ef;
  box-shadow: var(--tw-inset);
}

.tw-records :deep(.lb-list li) {
  padding: 3px 6px;
  border-radius: 0;
}

.tw-records :deep(.no) {
  border-radius: 0;
  color: #fff;
  background: #323977;
}

.tw-records :deep(.no.n1) {
  color: #161616;
  background: #e4cf65;
}

.tw-records :deep(.pts) {
  color: var(--tw-navy);
}

.tw-records :deep(.lb-list li.me),
.tw-records :deep(.lb-me) {
  border-radius: 0;
  color: #fff;
  background: var(--tw-navy);
}

.tw-records :deep(.lb-list li.me .pts) {
  color: #fff;
}

.tw-records :deep(.lb-me.rec) {
  color: #fff;
  background: #15563c;
}

.tw-records :deep(.lb-join) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
}

.tw .tw-records :deep(.lb-join input) {
  width: 100%;
  height: 30px;
  padding: 4px 8px;
  border: 0;
  border-radius: 0;
  color: #161616;
  background: #fff;
  box-shadow: var(--tw-inset);
  font: inherit;
  font-size: 12px;
}

.tw .tw-records :deep(.lb-join button[type='submit']) {
  grid-column: 1 / -1;
  min-height: 30px;
  border-radius: 0;
  color: #161616;
  background: var(--tw-panel);
  box-shadow: var(--tw-edge);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}

/* ── 입력 칸 ── */
.tw-input-panel {
  display: grid;
  gap: 4px;
  padding: 8px 12px;
  background: var(--tw-panel);
  box-shadow: var(--tw-edge);
}

.tw-input-label {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

.tw-input-label > span {
  font-weight: 700;
}

.tw .tw-input-label .tw-type {
  width: 100%;
  height: 40px;
  padding: 4px 12px;
  border: 0;
  border-radius: 0;
  color: var(--tw-ink);
  background: #fff;
  box-shadow: var(--tw-inset);
  font-family: var(--game-font);
  font-size: 20px;
  outline: none;
}

.tw .tw-input-label .tw-type.bad {
  background: #ffe3ea;
  box-shadow: var(--tw-inset), 0 0 0 2px #ff004d;
}

.tw .tw-input-label .tw-type::placeholder {
  color: #575757;
  font-size: 14px;
}

.tw-input-help {
  display: flex;
  justify-content: space-between;
  margin: 0;
  color: #454545;
  font-size: 11px;
}

.tw-input-help kbd {
  padding: 0 4px;
  background: var(--tw-panel);
  box-shadow: var(--tw-edge);
  font: inherit;
}
</style>
