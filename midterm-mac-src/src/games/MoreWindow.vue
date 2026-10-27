<script setup>
// 더 많을까?: 두 간판 이름 중 전국에 더 많은 쪽을 맞힌다. 틀릴 때까지 연승을 이어 간다
// 한낮 골목에 가게 두 채가 나란히 선다. 간판은 나사 박힌 파스텔 판, 개수는 가게 앞 전광판에 뜬다
// 가운데에는 캐릭터 만들기에서 고른 내 모습(Hero)이 서서 맞히면 만세, 틀리면 움찔한다. 틀린 가게는 셔터가 내려간다
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref } from 'vue'
import { randomNames } from '../data.js'
import { SHOP_STYLE, pastelOf } from '../shops.js'
import { sfx } from '../sound.js'
import { useCountUp } from './countUp.js'
import Leaderboard from './Leaderboard.vue'
import Hero from './stage/Hero.vue'
import './pixel.css'

// embed: 거리 이야기 안에서 열린 판. 종이 대신 숫자 도깨비와 내기하는 장면(MoreDuel)을 띄운다
const props = defineProps({ embed: Boolean, goal: { type: Number, default: 6 }, boss: { type: String, default: '' }, bossName: { type: String, default: '' } })
const MoreDuel = defineAsyncComponent(() => import('./stage/MoreDuel.vue'))

const phase = ref('ready') // ready | loading | ask | reveal | over
const left = ref(null)
const right = ref(null)
const shown = ref(0)
const streak = ref(0)
const verdict = ref('')
const best = ref(Number(localStorage.getItem('gp-more-best')) || 0)
const sliding = ref(false) // 맞히면 오른쪽 간판이 왼쪽 자리로 밀려 가고
const snap = ref(false) // 자리를 바꾸는 한 프레임은 움직임 없이 갈아 끼운다
// 끝 화면 연승 숫자는 0 부터 올라간다
const shownStreak = useCountUp(() => (phase.value === 'over' ? streak.value : 0), { ms: 1200, steps: 12, tick: () => sfx.tick() })

// 가운데 선 내 캐릭터: 묻는 동안 오른쪽 가게를 보고, 맞히면 만세, 틀리면 움찔, 다음 간판으로 갈 땐 걷는다
const heroPose = computed(() => (sliding.value ? 'walk' : verdict.value === 'ok' ? 'cheer' : verdict.value === 'no' ? 'hurt' : 'idle'))
const heroDir = computed(() => (verdict.value && !sliding.value ? 0 : 3))

// 상호에 업종 낱말이 들어 있으면 그 업종 가게처럼 벽·차양 색을 칠하고 업종 꼬리표를 단다
const CAT_WORDS = [
  ['snack', /김밥|분식|떡볶이|만두/, '분식집'],
  ['hair', /헤어|미용|살롱|커트/, '미용실'],
  ['cafe', /카페|커피|다방|로스터/, '카페'],
  ['bread', /빵|베이커리|제과|도넛|브레드/, '빵집'],
  ['chicken', /치킨|통닭/, '치킨집'],
  ['pharm', /약국/, '약국'],
  ['flower', /꽃|플라워|화원/, '꽃집'],
  ['ricecake', /떡|한과/, '떡집'],
  ['laundry', /세탁|크리닝|클리닝/, '세탁소'],
  ['karaoke', /노래/, '노래방'],
  ['book', /서점|문고|책방/, '서점'],
  ['hardware', /철물|공구/, '철물점'],
]
const AWNINGS = Object.values(SHOP_STYLE).map((st) => st.sign)
const catOf = (name) => CAT_WORDS.find(([, re]) => re.test(name)) || null
function shopOf(name) {
  const cat = catOf(name)
  const st = cat && SHOP_STYLE[cat[0]]
  let h = 0
  for (const ch of name) h = (h * 7 + ch.charCodeAt(0)) >>> 0
  return { '--plate': pastelOf(name), '--wall': st?.wall || '#f4ead8', '--awn': st?.sign || AWNINGS[h % AWNINGS.length] }
}
const catLabel = (name) => catOf(name)?.[2] || ''

let pool = []
let raf = 0
let timer = 0
const seen = new Set()

async function refill() {
  const rows = await randomNames(10)
  pool.push(...rows.filter((r) => /^[가-힣A-Za-z0-9]{2,10}$/.test(r.name) && /[가-힣]/.test(r.name) && !seen.has(r.name)))
}

// 연승이 길수록 두 개수 차이가 좁은 문제를 낸다 (처음엔 8배 차이, 나중엔 1.3배 안쪽)
async function draw(against) {
  if (pool.length < 60) await refill()
  const target = Math.log(Math.max(1.3, 8 - streak.value * 0.45))
  let pick = null
  let gap = Infinity
  for (let k = 0; k < 40; k++) {
    const i = Math.floor(Math.random() * pool.length)
    const c = pool[i]
    if (!c || seen.has(c.name) || (against && c.count === against.count)) continue
    const d = against ? Math.abs(Math.abs(Math.log(c.count / against.count)) - target) : 0
    if (d < gap) {
      gap = d
      pick = i
    }
  }
  const [c] = pool.splice(pick ?? 0, 1)
  seen.add(c.name)
  return c
}

async function start() {
  phase.value = 'loading'
  streak.value = 0
  seen.clear()
  pool = []
  await refill()
  // 첫 문제는 개수가 너무 적지 않은 이름을 왼쪽에 둔다
  pool.sort((a, b) => b.count - a.count)
  const first = pool.splice(Math.floor(Math.random() * Math.min(80, pool.length)), 1)[0]
  seen.add(first.name)
  left.value = first
  pool.sort(() => Math.random() - 0.5)
  right.value = await draw(left.value)
  shown.value = 0
  phase.value = 'ask'
}

function countUp(to, ms = 900) {
  return new Promise((done) => {
    const t0 = performance.now()
    let ticks = 0
    const step = (t) => {
      const p = Math.min(1, (t - t0) / ms)
      shown.value = Math.round(to * (1 - (1 - p) ** 3))
      // 숫자가 오르는 동안 또각또각 소리를 낸다
      if (p < 1 && Math.floor(p * 12) > ticks) {
        ticks = Math.floor(p * 12)
        sfx.tick()
      }
      if (p < 1) raf = requestAnimationFrame(step)
      else done()
    }
    raf = requestAnimationFrame(step)
  })
}

async function answer(more) {
  if (phase.value !== 'ask') return
  phase.value = 'reveal'
  verdict.value = ''
  await countUp(right.value.count)
  const right_ = right.value.count > left.value.count === more
  verdict.value = right_ ? 'ok' : 'no'
  if (right_) {
    streak.value = Math.min(10000, streak.value + 1)
    sfx.right()
    timer = setTimeout(async () => {
      const nextRight = await draw(right.value)
      verdict.value = ''
      sliding.value = true
      sfx.whoosh()
      await new Promise((r) => (timer = setTimeout(r, 460)))
      // 새 간판은 오른쪽 밖에서 들어온다(:key 가 바뀌어 등장 애니메이션이 다시 돈다)
      snap.value = true
      left.value = right.value
      right.value = nextRight
      shown.value = 0
      sliding.value = false
      phase.value = 'ask'
      await nextTick()
      requestAnimationFrame(() => (snap.value = false))
    }, 900)
  } else {
    sfx.lose()
    if (streak.value > best.value) {
      best.value = streak.value
      localStorage.setItem('gp-more-best', String(best.value))
    }
    timer = setTimeout(() => (phase.value = 'over'), 1300)
  }
}

function key(e) {
  if (props.embed || phase.value !== 'ask') return
  if (e.key === 'ArrowUp') answer(true)
  else if (e.key === 'ArrowDown') answer(false)
  else return
  e.preventDefault()
}
window.addEventListener('keydown', key)

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  clearTimeout(timer)
  window.removeEventListener('keydown', key)
})
</script>

<template>
  <MoreDuel v-if="props.embed" :goal="props.goal" :boss="props.boss" :boss-name="props.bossName || '숫자 도깨비'" />
  <div v-else class="more-hl" :class="{ 'more-sheet-open': phase === 'ready' || phase === 'loading' || phase === 'over' }">
    <header class="more-hud">
      <span class="more-brand more-plate">더 많을까?</span>
      <div class="more-stats">
        <span class="more-chip">연승 <b>{{ streak }}</b></span>
        <span class="more-chip">내 최고 <b>{{ best }}</b></span>
      </div>
    </header>

    <div v-if="phase === 'ready' || phase === 'loading' || phase === 'over'" class="more-sheet">
      <template v-if="phase === 'over'">
        <header class="more-result">
          <p class="more-eyebrow">이번 비교는 여기까지</p>
          <div class="more-result-mark">
            <Hero class="more-result-hero" :scale="4" :dir="0" :pose="streak ? 'cheer' : 'hurt'" />
            <h1 class="more-plate more-result-plate"><b>{{ shownStreak }}</b><span>연승</span></h1>
          </div>
          <p class="more-result-note">맞힌 만큼 쌓인 기록, 다시 도전해 볼까요?</p>
        </header>
        <dl class="more-last-pair" aria-label="마지막 비교 결과">
          <div>
            <dt>기준 간판</dt>
            <dd><strong class="more-plate" :style="shopOf(left.name)">{{ left.name }}</strong><span><b>{{ left.count.toLocaleString() }}</b>곳</span></dd>
          </div>
          <div class="more-last-miss">
            <dt>비교한 간판</dt>
            <dd><strong class="more-plate" :style="shopOf(right.name)">{{ right.name }}</strong><span><b>{{ right.count.toLocaleString() }}</b>곳</span></dd>
          </div>
        </dl>
        <div class="more-sheet-action">
          <button class="more-button more-start" @click="start">한 판 더 <span aria-hidden="true">▶</span></button>
        </div>
        <Leaderboard class="more-board" game="more" :score="streak" unit="연승" />
      </template>
      <template v-else>
        <header class="more-intro">
          <p class="more-eyebrow">전국 간판으로 겨루는 비교 게임</p>
          <h1 class="more-logo">
            <span class="more-plate more-logo-main">더 많을까?</span>
            <span class="more-plate more-logo-sub">더 적을까?</span>
          </h1>
          <!-- 가게 두 채 사이에서 내 캐릭터가 고민한다 -->
          <div class="more-intro-scene" aria-hidden="true">
            <span class="more-mini" :style="{ '--plate': '#ffd84d', '--wall': '#fde9d9', '--awn': '#e0884d' }"><b>?</b></span>
            <span class="more-intro-hero">
              <span class="more-think">?</span>
              <Hero :scale="4" :dir="0" pose="idle" />
            </span>
            <span class="more-mini" :style="{ '--plate': '#8fb3e6', '--wall': '#e2ebf8', '--awn': '#4a6fb5' }"><b>?</b></span>
          </div>
          <div class="more-intro-copy">
            <p>오른쪽 간판, 왼쪽보다 더 많을까요?</p>
            <span>맞히면 다음 간판으로. 틀릴 때까지 연승 도전!</span>
          </div>
        </header>
        <div class="more-sheet-action">
          <button class="more-button more-start" :disabled="phase === 'loading'" @click="start">
            {{ phase === 'loading' ? '간판 모으는 중…' : '비교 시작' }}
            <span aria-hidden="true">▶</span>
          </button>
          <p class="more-action-note" role="status">{{ phase === 'loading' ? '전국의 같은 이름 간판을 불러오고 있어요' : '이름은 익숙해도, 숫자는 의외일지도!' }}</p>
        </div>
      </template>
    </div>

    <div class="more-play-heading">
      <h2>오른쪽 간판은 더 많다, 더 적다?</h2>
      <p>왼쪽 숫자를 기준으로 골라 주세요</p>
    </div>

    <!-- 골목 한 칸: 뒤로 건물 실루엣, 앞으로 보도. 가게 두 채가 보도 위에 선다 -->
    <div class="more-duel" :class="[{ 'more-slide': sliding, 'more-snap': snap }, verdict]">
      <section v-if="left" :key="`l-${left.name}`" class="more-side more-left" :style="shopOf(left.name)">
        <span class="more-side-label">기준 간판</span>
        <div class="more-name more-plate">{{ left.name }}</div>
        <span class="more-awning" aria-hidden="true"></span>
        <div class="more-front">
          <span v-if="catLabel(left.name)" class="more-cat">{{ catLabel(left.name) }}</span>
          <p class="more-count"><b>{{ left.count.toLocaleString() }}</b><span>곳</span></p>
          <p class="more-count-note">전국 같은 이름 간판</p>
        </div>
      </section>

      <span class="more-vs" role="status" aria-live="polite">
        <span aria-hidden="true">VS</span>
        <span class="more-sr">{{ verdict === 'ok' ? '정답! 연승을 이어갑니다' : verdict === 'no' ? '오답! 도전 종료' : '두 간판 비교' }}</span>
      </span>
      <div class="more-hero" aria-hidden="true">
        <span v-if="!sliding" :key="verdict" class="more-think" :class="verdict">{{ verdict === 'ok' ? '!' : verdict === 'no' ? '…' : '?' }}</span>
        <Hero :scale="3" :dir="heroDir" :pose="heroPose" />
      </div>
      <!-- 채점 순간 가운데 찍히는 픽셀 도장 -->
      <span v-if="verdict" :key="verdict" class="more-stamp px-pop" :class="verdict" aria-hidden="true">{{ verdict === 'ok' ? '정답!' : '땡!' }}</span>

      <section v-if="right" :key="`r-${right.name}`" class="more-side more-right" :class="verdict" :style="shopOf(right.name)">
        <span class="more-side-label">비교할 간판</span>
        <div class="more-name more-plate">{{ right.name }}</div>
        <span class="more-awning" aria-hidden="true"></span>
        <div class="more-front">
          <!-- 틀리면 이 가게 셔터가 드르륵 내려온다 -->
          <span class="more-shutter" aria-hidden="true"></span>
          <span v-if="catLabel(right.name)" class="more-cat">{{ catLabel(right.name) }}</span>
          <template v-if="phase === 'ask'">
            <p class="more-question">‘{{ left.name }}’보다</p>
            <div class="more-choices">
              <button class="more-button more-up" @click="answer(true)">더 많다 <span aria-hidden="true">▲</span></button>
              <button class="more-button more-down" @click="answer(false)">더 적다 <span aria-hidden="true">▼</span></button>
            </div>
          </template>
          <template v-else>
            <div class="more-figure">
              <p class="more-count"><b>{{ shown.toLocaleString() }}</b><span>곳</span></p>
              <!-- 채점: 맞으면 빨간 동그라미, 틀리면 빗금 -->
              <svg v-if="verdict" class="more-mark" viewBox="0 0 240 140" aria-hidden="true">
                <path
                  v-if="verdict === 'ok'"
                  pathLength="1"
                  d="M190 30C150 6 62 10 30 52 6 86 50 128 128 126c74-2 106-40 92-74-10-24-48-38-90-38"
                />
                <path v-else pathLength="1" d="M34 118C88 86 150 50 210 18" />
              </svg>
            </div>
            <p class="more-count-note">전국 같은 이름 간판</p>
          </template>
        </div>
      </section>
    </div>

    <footer class="more-foot">
      <p>상호가 글자 하나까지 같은 간판만 셉니다</p>
      <span><kbd>↑</kbd> 더 많다 <kbd>↓</kbd> 더 적다</span>
    </footer>
  </div>
</template>

<style scoped>
.more-hl {
  --line: #1d1b2e;
  --cream: #fff6e6;
  --ink-2: #5a5468;
  --sky: #a9d8ff;
  --shadow: 0 4px 0 rgb(29 27 46 / 0.28);
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 480px;
  color: var(--line);
  /* 크림 바탕에 아주 옅은 픽셀 바둑판 */
  background:
    conic-gradient(rgb(29 27 46 / 0.035) 25%, transparent 0 50%, rgb(29 27 46 / 0.035) 0 75%, transparent 0) 0 0 / 16px 16px,
    #faf4e6;
  font-family: var(--game-font, 'Galmuri11 Game', 'Galmuri11', sans-serif);
  -webkit-font-smoothing: none;
  container-type: inline-size;
}

.more-hl *,
.more-hl :deep(*) {
  box-sizing: border-box;
}

/* 간판판: 파스텔 판, 진한 테두리, 네 귀퉁이 나사 */
.more-plate {
  --b: 4px;
  --bi: 3px;
  position: relative;
  display: inline-block;
  max-width: 100%;
  padding: 4px 16px 3px;
  border: 3px solid var(--line);
  color: var(--line);
  background:
    radial-gradient(circle, var(--line) 0 40%, transparent 50%) var(--bi) var(--bi) / var(--b) var(--b) no-repeat,
    radial-gradient(circle, var(--line) 0 40%, transparent 50%) calc(100% - var(--bi)) var(--bi) / var(--b) var(--b) no-repeat,
    radial-gradient(circle, var(--line) 0 40%, transparent 50%) var(--bi) calc(100% - var(--bi)) / var(--b) var(--b) no-repeat,
    radial-gradient(circle, var(--line) 0 40%, transparent 50%) calc(100% - var(--bi)) calc(100% - var(--bi)) / var(--b) var(--b) no-repeat,
    var(--plate, #ffd84d);
  box-shadow: inset 0 3px rgb(255 255 255 / 0.5), inset 0 -3px rgb(0 0 0 / 0.14), var(--shadow);
  font-family: var(--game-font, 'Galmuri11 Game', 'Galmuri11', sans-serif);
  font-weight: 400;
  line-height: 1.3;
  text-align: center;
  word-break: keep-all;
  overflow-wrap: anywhere;
}

/* 위 줄: 이름 간판과 기록 칩 */
.more-hud {
  order: -1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  margin: 0 18px;
  padding: 12px 0 10px;
  border-bottom: 3px solid var(--line);
}

.more-brand {
  --plate: #ffd84d;
  padding: 3px 14px 2px;
  font-size: 15px;
}

.more-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}

.more-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  margin: 3px;
  padding: 3px 10px 2px;
  color: #fff1e8;
  background: var(--line);
  box-shadow:
    0 -3px 0 var(--line),
    0 3px 0 var(--line),
    -3px 0 0 var(--line),
    3px 0 0 var(--line),
    0 6px 0 rgb(29 27 46 / 0.25);
  font-size: 12px;
  white-space: nowrap;
}

.more-chip b {
  color: #ffec27;
  font-size: 18px;
  font-weight: 400;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.more-sheet {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.more-eyebrow {
  margin: 0;
  color: var(--ink-2);
  font-size: 12px;
}

/* 첫 화면: 간판 두 장짜리 제목, 그 아래 가게 두 채 사이에서 고민하는 내 캐릭터 */
.more-intro {
  display: grid;
  justify-items: center;
  padding: 22px 26px 4px;
  text-align: center;
}

.more-logo {
  display: grid;
  justify-items: center;
  gap: 8px;
  margin: 12px 0 0;
  font-weight: 400;
}

.more-logo-main {
  --plate: #ffd84d;
  --b: 7px;
  --bi: 5px;
  padding: 8px 30px 6px;
  border-width: 4px;
  font-size: clamp(34px, 7.4cqi, 54px);
  rotate: -2deg;
  animation: more-hang 0.5s steps(5) both;
}

.more-logo-sub {
  --plate: #8fb3e6;
  padding: 3px 16px 2px;
  font-size: clamp(17px, 3.4cqi, 24px);
  rotate: 2deg;
  animation: more-hang 0.5s 0.15s steps(5) both;
}

.more-intro-scene {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: clamp(14px, 5cqi, 40px);
  width: min(480px, 100%);
  margin-top: 18px;
  padding: 0 18px 12px;
  background:
    linear-gradient(var(--line), var(--line)) left bottom 12px / 100% 3px no-repeat,
    repeating-linear-gradient(90deg, rgb(29 27 46 / 0.16) 0 3px, transparent 3px 30px) left bottom / 100% 12px no-repeat,
    linear-gradient(#d8cfbf, #c8bea9) left bottom / 100% 12px no-repeat;
}

.more-mini {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 108px;
}

.more-mini b {
  order: 0;
  position: relative;
  z-index: 1;
  padding: 0 22px;
  border: 3px solid var(--line);
  background:
    radial-gradient(circle, var(--line) 0 40%, transparent 50%) 3px 3px / 4px 4px no-repeat,
    radial-gradient(circle, var(--line) 0 40%, transparent 50%) calc(100% - 3px) 3px / 4px 4px no-repeat,
    var(--plate);
  font-size: 20px;
  font-weight: 400;
  line-height: 1.4;
}

.more-mini::before {
  content: '';
  order: 1;
  width: 100%;
  height: 16px;
  margin-top: -3px;
  border: 3px solid var(--line);
  background: repeating-linear-gradient(90deg, var(--awn) 0 12px, #fff6e6 12px 24px);
}

.more-mini::after {
  content: '';
  order: 2;
  width: 86%;
  height: 62px;
  border: 3px solid var(--line);
  border-top: 0;
  background:
    linear-gradient(var(--line), var(--line)) 60% 100% / 3px 40px no-repeat,
    linear-gradient(#bfe3ff, #e9f6ff) 14% 12px / 38% 30px no-repeat,
    linear-gradient(#8a6a4a, #6b4a2a) 82% 100% / 26% 40px no-repeat,
    var(--wall);
}

.more-intro-hero {
  display: grid;
  justify-items: center;
}

.more-intro-copy {
  margin-top: 16px;
}

.more-intro-copy p {
  margin: 0 0 4px;
  font-size: 16px;
}

.more-intro-copy > span,
.more-action-note {
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.7;
}

.more-sheet-action {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 14px 26px 22px;
}

.more-action-note {
  margin: 0;
}

/* 버튼: 눌리는 픽셀 버튼. 오른쪽 아래 그늘이 눌리면 왼쪽 위로 옮겨 간다 */
.more-hl button.more-button,
.more-hl :deep(.lb-join button[type='submit']) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  min-height: 42px;
  margin: 3px;
  padding: 8px 16px 6px;
  border: 0;
  border-radius: 0;
  color: var(--line);
  background: var(--bg, #ffd84d);
  box-shadow:
    inset -3px -3px 0 rgb(0 0 0 / 0.22),
    inset 3px 3px 0 rgb(255 255 255 / 0.45),
    0 -3px 0 var(--line),
    0 3px 0 var(--line),
    -3px 0 0 var(--line),
    3px 0 0 var(--line),
    0 7px 0 rgb(29 27 46 / 0.3);
  font: inherit;
  font-size: 14px;
  line-height: 1.3;
  cursor: pointer;
  transition: translate 0.08s steps(2), filter 0.08s;
}

.more-hl button.more-start {
  --bg: #9fd8a8;
  width: min(280px, 100%);
  min-height: 48px;
  font-size: 16px;
}

.more-button > span {
  font-size: 12px;
  line-height: 1;
}

.more-hl button.more-down {
  --bg: #9fd0ff;
}

.more-hl button.more-button:hover:not(:disabled),
.more-hl :deep(.lb-join button[type='submit']:hover:not(:disabled)) {
  translate: 0 -2px;
  filter: brightness(1.06);
}

.more-hl button.more-button:active:not(:disabled),
.more-hl :deep(.lb-join button[type='submit']:active:not(:disabled)) {
  translate: 0 2px;
  box-shadow:
    inset 3px 3px 0 rgb(0 0 0 / 0.22),
    0 -3px 0 var(--line),
    0 3px 0 var(--line),
    -3px 0 0 var(--line),
    3px 0 0 var(--line);
}

.more-hl button.more-button:disabled,
.more-hl :deep(.lb-join button[type='submit']:disabled) {
  --bg: #c2c3c7;
  color: #5f574f;
  cursor: default;
}

.more-hl button.more-button:focus-visible,
.more-hl :deep(.lb-join button:focus-visible),
.more-hl :deep(.lb-join input:focus-visible) {
  outline: 3px solid #29adff;
  outline-offset: 5px;
}

.more-play-heading {
  padding: 12px 22px 10px;
  text-align: center;
}

.more-play-heading h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 400;
}

.more-play-heading p {
  margin: 4px 0 0;
  color: var(--ink-2);
  font-size: 12px;
}

.more-sheet-open .more-play-heading,
.more-sheet-open .more-duel {
  display: none;
}

/* 대결: 하늘, 뒤쪽 건물 실루엣, 앞쪽 보도. 가게 두 채가 보도 위에 나란히 선다 */
.more-duel {
  --mid: 116px;
  --walk: 30px;
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  flex: 1;
  column-gap: var(--mid);
  align-items: stretch;
  margin: 0 18px;
  padding: 14px clamp(10px, 2.4cqi, 24px) calc(var(--walk) - 3px);
  border: 3px solid var(--line);
  background:
    linear-gradient(var(--line), var(--line)) left bottom var(--walk) / 100% 3px no-repeat,
    repeating-linear-gradient(90deg, rgb(29 27 46 / 0.16) 0 3px, transparent 3px 40px) left bottom / 100% var(--walk) no-repeat,
    linear-gradient(transparent 0 calc(100% - 6px), #a79d89 0) left bottom / 100% var(--walk) no-repeat,
    linear-gradient(#ddd4c3, #cfc5b1) left bottom / 100% var(--walk) no-repeat,
    linear-gradient(var(--sky), #e8f6ff 70%);
  box-shadow: 0 5px 0 rgb(29 27 46 / 0.2);
  overflow: clip;
  isolation: isolate;
}

/* 뒤쪽 건물 실루엣: 두 겹, 창문 몇 개 */
.more-duel::before {
  content: '';
  position: absolute;
  right: 0;
  bottom: var(--walk);
  left: 0;
  z-index: -1;
  height: 62%;
  background:
    repeating-linear-gradient(90deg, transparent 0 10px, rgb(255 255 255 / 0.55) 10px 16px, transparent 16px 26px) 4% 28% / 9% 6px no-repeat,
    repeating-linear-gradient(90deg, transparent 0 10px, rgb(255 255 255 / 0.55) 10px 16px, transparent 16px 26px) 4% 44% / 9% 6px no-repeat,
    repeating-linear-gradient(90deg, transparent 0 10px, rgb(255 255 255 / 0.55) 10px 16px, transparent 16px 26px) 50% 20% / 10% 6px no-repeat,
    repeating-linear-gradient(90deg, transparent 0 10px, rgb(255 255 255 / 0.55) 10px 16px, transparent 16px 26px) 50% 36% / 10% 6px no-repeat,
    repeating-linear-gradient(90deg, transparent 0 10px, rgb(255 255 255 / 0.55) 10px 16px, transparent 16px 26px) 93% 40% / 8% 6px no-repeat,
    linear-gradient(#9cbbe0, #9cbbe0) 0 100% / 14% 82% no-repeat,
    linear-gradient(#9cbbe0, #9cbbe0) 30% 100% / 10% 58% no-repeat,
    linear-gradient(#9cbbe0, #9cbbe0) 50% 100% / 13% 92% no-repeat,
    linear-gradient(#9cbbe0, #9cbbe0) 74% 100% / 11% 66% no-repeat,
    linear-gradient(#9cbbe0, #9cbbe0) 96% 100% / 12% 76% no-repeat,
    linear-gradient(#bcd3ee, #bcd3ee) 14% 100% / 16% 70% no-repeat,
    linear-gradient(#bcd3ee, #bcd3ee) 38% 100% / 14% 84% no-repeat,
    linear-gradient(#bcd3ee, #bcd3ee) 62% 100% / 12% 74% no-repeat,
    linear-gradient(#bcd3ee, #bcd3ee) 86% 100% / 14% 96% no-repeat;
  pointer-events: none;
}

/* 픽셀 구름 두 덩이 */
.more-duel::after {
  content: '';
  position: absolute;
  top: 18px;
  left: 30%;
  z-index: -1;
  width: 8px;
  height: 8px;
  background: #fff;
  box-shadow:
    8px 0 #fff, 16px 0 #fff, 24px 0 #fff, -8px 8px #fff, 0 8px #fff, 8px 8px #fff, 16px 8px #fff, 24px 8px #fff, 32px 8px #fff,
    8px -8px #fff, 16px -8px #fff,
    300px 22px #fff, 308px 22px #fff, 316px 22px #fff, 292px 30px #fff, 300px 30px #fff, 308px 30px #fff, 316px 30px #fff, 324px 30px #fff,
    308px 14px #fff;
  pointer-events: none;
}

.more-side {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  transition: transform 0.46s cubic-bezier(0.6, 0, 0.25, 1), opacity 0.46s;
}

.more-side-label {
  margin-bottom: 6px;
  padding: 2px 8px 1px;
  color: #fff1e8;
  background: var(--line);
  font-size: 11px;
}

/* 지붕 위 간판: 가게가 들어설 때 위에서 덜컹 내려앉는다 */
.more-name {
  z-index: 2;
  min-width: 60%;
  margin-bottom: -3px;
  padding: 7px 18px 5px;
  font-size: clamp(20px, 3.5cqi, 30px);
  animation: more-hang 0.5s steps(5) both;
}

.more-awning {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 22px;
  border: 3px solid var(--line);
  background: repeating-linear-gradient(90deg, var(--awn) 0 18px, #fff6e6 18px 36px);
  box-shadow: 0 5px 0 rgb(29 27 46 / 0.22);
}

/* 가게 벽: 업종 벽색에 옅은 벽돌 줄, 아래는 진한 걸레받이 */
.more-front {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: calc(100% - 18px);
  min-height: 236px;
  padding: 18px 12px 24px;
  border: 3px solid var(--line);
  border-top: 0;
  background:
    linear-gradient(var(--line), var(--line)) left bottom 10px / 100% 3px no-repeat,
    linear-gradient(#8f7d6a, #8f7d6a) left bottom / 100% 10px no-repeat,
    repeating-linear-gradient(transparent 0 15px, rgb(29 27 46 / 0.07) 15px 18px),
    var(--wall);
  text-align: center;
  isolation: isolate;
  overflow: clip;
}

.more-side p {
  max-width: 100%;
  margin: 0;
  overflow-wrap: anywhere;
}

.more-cat {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 1px 6px;
  border: 2px solid var(--line);
  color: var(--line);
  background: #fff6e6;
  font-size: 11px;
}

.more-figure {
  position: relative;
  display: grid;
  justify-items: center;
  width: 100%;
}

/* 가게 앞 전광판: 남색 판에 노란 숫자 */
.more-count {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  min-width: min(78%, 220px);
  padding: 8px 14px 6px;
  border: 3px solid var(--line);
  color: #fff1e8;
  background: #262342;
  box-shadow: inset 0 0 0 3px #3b3760, var(--shadow);
  font-variant-numeric: tabular-nums;
}

.more-count b {
  color: #ffec27;
  font-size: clamp(34px, 6.4cqi, 52px);
  font-weight: 400;
  line-height: 1.1;
  text-shadow: 0 0 10px rgb(255 236 39 / 0.45);
}

.more-count > span {
  font-size: 14px;
}

.more-count-note,
.more-question {
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.6;
}

.more-question {
  color: var(--line);
  font-size: 14px;
}

.more-choices {
  display: grid;
  gap: 12px;
  width: min(210px, 100%);
  margin-top: 6px;
}

/* 채점: 전광판 위에 빨간 동그라미 또는 빗금이 그어진다 */
.more-mark {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(112%, 270px);
  overflow: visible;
  transform: translate(-50%, -52%) rotate(-4deg);
  pointer-events: none;
}

.more-mark path {
  fill: none;
  stroke: #ff004d;
  stroke-width: 8;
  stroke-linecap: butt;
  stroke-linejoin: bevel;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  filter: drop-shadow(2px 2px 0 rgb(29 27 46 / 0.5));
  animation: more-stroke 0.5s steps(8) forwards;
}

.no .more-mark path {
  stroke-width: 10;
  animation-delay: 0.3s;
}

/* 틀리면 셔터가 위에서부터 드르륵 내려와 가게를 닫는다 */
.more-shutter {
  position: absolute;
  inset: 0 0 auto;
  z-index: -1;
  height: 0;
  background: repeating-linear-gradient(#c9c4ba 0 9px, #8f8a80 9px 12px);
  box-shadow: 0 3px 0 var(--line);
  pointer-events: none;
}

.more-right.no .more-shutter {
  animation: more-shutter 0.6s 0.1s steps(8) forwards;
}

.more-right.no .more-count-note {
  padding: 0 6px;
  color: var(--line);
  background: #fff6e6;
}

.more-right.no .more-name {
  filter: grayscale(0.6) brightness(0.85);
  transition: filter 0.3s steps(3);
}

/* 맞히면 오른쪽 간판에 불이 들어온다 */
.more-right.ok .more-name {
  box-shadow:
    inset 0 3px rgb(255 255 255 / 0.5),
    0 0 0 3px #fff6e6,
    0 0 0 6px var(--line),
    0 0 22px 8px rgb(255 236 39 / 0.85);
}

/* 가운데 길목: VS 딱지, 그 아래 내 캐릭터 */
.more-vs {
  position: absolute;
  top: 26%;
  left: 50%;
  z-index: 3;
  padding: 4px 8px 2px;
  border: 3px solid var(--line);
  color: #fff1e8;
  background: #ff77a8;
  box-shadow: var(--shadow);
  font-size: 16px;
  text-shadow: 2px 2px 0 var(--line);
  transform: translate(-50%, -50%) rotate(-6deg);
  transition: opacity 0.2s steps(2);
}

.more-duel.no .more-vs,
.more-duel.ok .more-vs,
.more-duel.more-slide .more-vs {
  opacity: 0;
}

.more-hero {
  position: absolute;
  bottom: calc(var(--walk) - 18px);
  left: 50%;
  z-index: 3;
  display: grid;
  justify-items: center;
  translate: -50% 0;
  pointer-events: none;
}

.more-think {
  position: relative;
  margin-bottom: 4px;
  padding: 1px 9px 0;
  border: 3px solid var(--line);
  background: #fff;
  font-size: 18px;
  line-height: 1.3;
  animation: more-bob 0.9s steps(2) infinite alternate;
}

.more-think.ok {
  background: #ffec27;
}

.more-think.no {
  color: #fff1e8;
  background: #5f574f;
}

.more-think::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  width: 6px;
  height: 6px;
  margin: 3px 0 0 -3px;
  background: var(--line);
}

/* 채점 도장: 맞으면 초록, 틀리면 빨강으로 흔들린다 */
.more-stamp {
  position: absolute;
  top: 44%;
  left: 50%;
  z-index: 4;
  margin: -22px 0 0 -48px;
  width: 96px;
  padding: 8px 0 6px;
  border: 3px solid var(--line);
  color: var(--line);
  background: #00e436;
  box-shadow: 0 5px 0 rgb(29 27 46 / 0.35);
  font-size: 20px;
  line-height: 1.2;
  text-align: center;
  pointer-events: none;
}

.more-stamp.no {
  color: #fff;
  background: #ff004d;
  text-shadow: 2px 2px 0 var(--line);
  animation:
    px-pop-in 0.36s steps(1) both,
    px-shake 0.32s 0.36s steps(1);
}

/* 맞히면 왼쪽 가게는 밀려 나가고 오른쪽 가게가 왼쪽 자리로 간다. 새 가게는 오른쪽에서 들어온다 */
.more-duel.more-slide .more-left {
  transform: translateX(-60%);
  opacity: 0;
}

.more-duel.more-slide .more-right {
  transform: translateX(calc(-100% - var(--mid)));
}

.more-duel.more-snap .more-side {
  transition: none;
}

.more-duel.more-snap .more-left .more-name {
  animation: none;
}

/* 끝 화면: 만세하는(또는 움찔한) 내 캐릭터 옆에 연승 간판 */
.more-result {
  padding: 22px 26px 6px;
  text-align: center;
}

.more-result-mark {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 18px;
  margin: 14px auto 6px;
  padding: 0 20px 10px;
  width: min(420px, 100%);
  background:
    linear-gradient(var(--line), var(--line)) left bottom 10px / 100% 3px no-repeat,
    linear-gradient(#d8cfbf, #c8bea9) left bottom / 100% 10px no-repeat;
}

.more-result-hero {
  margin-bottom: -8px;
}

.more-result-plate {
  --plate: #ffd84d;
  --b: 7px;
  --bi: 5px;
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0 0 22px;
  padding: 10px 26px 6px;
  border-width: 4px;
  rotate: -2deg;
  animation: more-hang 0.5s 0.2s steps(5) both;
}

.more-result-plate b {
  font-size: clamp(52px, 12cqi, 80px);
  font-weight: 400;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.more-result-plate > span {
  font-size: 18px;
}

.more-result-note {
  margin: 12px 0 0;
  color: var(--ink-2);
  font-size: 13px;
  line-height: 1.6;
}

.more-last-pair {
  display: grid;
  margin: 10px 26px 0;
  border-top: 3px solid var(--line);
}

.more-last-pair > div {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 2px dashed rgb(29 27 46 / 0.25);
}

.more-last-pair dt {
  color: var(--ink-2);
  font-size: 11px;
}

.more-last-pair dd {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  margin: 0;
  min-width: 0;
}

.more-last-pair strong {
  --shadow: 0 3px 0 rgb(29 27 46 / 0.25);
  padding: 3px 14px 2px;
  font-size: 16px;
}

.more-last-pair dd > span {
  font-size: 12px;
}

.more-last-pair b {
  margin-right: 3px;
  font-size: 20px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.more-last-miss strong {
  filter: grayscale(0.6);
  text-decoration: line-through;
  text-decoration-thickness: 2px;
}

.more-hl :deep(.more-board.lb) {
  width: auto;
  min-width: 0;
  margin: 0 26px 24px;
  padding: 16px 0 0;
  gap: 10px;
  border: 0;
  border-top: 3px solid var(--line);
  border-radius: 0;
  color: var(--line);
  background: transparent;
  box-shadow: none;
  font-family: var(--game-font, 'Galmuri11 Game', 'Galmuri11', sans-serif);
}

.more-board :deep(.lb-head) {
  flex-wrap: wrap;
  gap: 6px 12px;
}

.more-board :deep(.lb-head strong) {
  font-size: 15px;
  font-weight: 400;
}

.more-board :deep(.muted) {
  color: var(--ink-2);
}

.more-board :deep(.lb-list li) {
  grid-template-columns: minmax(24px, max-content) minmax(0, 1fr) minmax(0, auto);
  padding: 8px 4px;
  border-bottom: 2px dashed rgb(29 27 46 / 0.2);
  border-radius: 0;
  background: transparent;
}

.more-board :deep(.who) {
  white-space: normal;
  overflow-wrap: anywhere;
}

.more-board :deep(.no) {
  width: auto;
  min-width: 24px;
  border-radius: 0;
  color: var(--line);
  background: transparent;
  font-variant-numeric: tabular-nums;
}

.more-board :deep(.no.n1) {
  color: var(--line);
  background: #ffd84d;
  box-shadow: 0 0 0 2px var(--line);
}

.more-board :deep(.pts) {
  color: var(--line);
  font-size: 17px;
  font-weight: 400;
}

.more-board :deep(.lb-list li.me),
.more-board :deep(.lb-me) {
  color: var(--line);
  background: rgb(255 216 77 / 0.35);
}

.more-board :deep(.lb-me.rec) {
  color: #fff1e8;
  background: var(--line);
}

.more-board :deep(.lb-join) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.more-hl :deep(.lb-join input) {
  width: 100%;
  min-width: 0;
  height: 40px;
  margin: 3px;
  padding: 0 10px;
  border: 3px solid var(--line);
  border-radius: 0;
  color: var(--line);
  background: #fff;
  box-shadow: inset 3px 3px 0 rgb(0 0 0 / 0.1);
  font: inherit;
  font-size: 13px;
}

.more-board :deep(.lb-join input::placeholder) {
  color: #8a8496;
}

.more-hl :deep(.lb-join button[type='submit']) {
  grid-column: 1 / -1;
  justify-content: center;
  font-size: 14px;
}

.more-board :deep(.lb-hint),
.more-board :deep(.m-err) {
  margin: 0;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.more-board :deep(.m-err) {
  color: #c4003b;
}

.more-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px 16px;
  margin: auto 18px 0;
  padding: 12px 0 14px;
  color: var(--ink-2);
  font-size: 11px;
  line-height: 1.7;
}

.more-foot p {
  margin: 0;
}

.more-foot > span {
  display: flex;
  align-items: center;
  gap: 6px;
}

.more-foot kbd {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 20px;
  border: 2px solid var(--line);
  color: var(--line);
  background: #fff;
  box-shadow: 0 2px 0 var(--line);
  font: inherit;
  font-size: 11px;
}

.more-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@container (max-width: 560px) {
  .more-duel {
    --mid: 84px;
  }

  .more-name {
    font-size: 19px;
  }

  .more-count b {
    font-size: 34px;
  }
}

@container (max-width: 440px) {
  .more-duel {
    --mid: 0px;
    grid-template-columns: minmax(0, 1fr);
    row-gap: 16px;
  }

  .more-hero,
  .more-duel::after {
    display: none;
  }

  .more-vs {
    top: 50%;
    left: 15%;
  }

  .more-front {
    min-height: 170px;
  }

  .more-choices {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: min(320px, 100%);
  }

  .more-duel.more-slide .more-left {
    transform: translateY(-60%);
  }

  .more-duel.more-slide .more-right {
    transform: translateY(calc(-100% - 16px));
  }

  .more-hud,
  .more-foot,
  .more-duel {
    margin-inline: 12px;
  }

  .more-board :deep(.lb-join) {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .more-side,
  .more-hl button.more-button {
    transition: none;
  }

  .more-name,
  .more-logo-main,
  .more-logo-sub,
  .more-result-plate,
  .more-think,
  .more-stamp {
    animation: none;
  }

  .more-mark path {
    stroke-dashoffset: 0;
    animation: none;
  }

  .more-right.no .more-shutter {
    animation: none;
    height: 100%;
  }
}

@keyframes more-hang {
  0% {
    translate: 0 -18px;
    opacity: 0;
  }
  60% {
    translate: 0 3px;
    opacity: 1;
  }
  100% {
    translate: 0 0;
  }
}

@keyframes more-bob {
  to {
    translate: 0 -3px;
  }
}

@keyframes more-shutter {
  to {
    height: 100%;
  }
}

@keyframes more-stroke {
  to {
    stroke-dashoffset: 0;
  }
}
</style>
