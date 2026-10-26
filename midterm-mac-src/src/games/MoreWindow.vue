<script setup>
// 더 많을까?: 두 간판 이름 중 전국에 더 많은 쪽을 맞힌다. 틀릴 때까지 연승을 이어 간다
// 흰 종이에 먹 한 가지만 쓴다. 글자는 종이에 스민 듯 번지고, 채점은 붓으로 동그라미·빗금을 긋는다
import { defineAsyncComponent, nextTick, onBeforeUnmount, ref } from 'vue'
import { randomNames } from '../data.js'
import { sfx } from '../sound.js'
import { useCountUp } from './countUp.js'
import Leaderboard from './Leaderboard.vue'
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
    <!-- 먹 번짐 필터: 글자는 가장자리가 살짝 일그러지고 둘레에 옅은 번짐이 남는다, 얼룩은 크게 일렁인다 -->
    <svg class="more-defs" aria-hidden="true" focusable="false">
      <filter id="more-bleed" x="-10%" y="-25%" width="120%" height="150%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.32" numOctaves="2" seed="7" result="grain" />
        <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.8" xChannelSelector="R" yChannelSelector="G" result="rough" />
        <feGaussianBlur in="rough" stdDeviation="0.45" result="soft" />
        <feComponentTransfer in="soft" result="core">
          <feFuncA type="linear" slope="1.8" intercept="-0.15" />
        </feComponentTransfer>
        <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="wide" />
        <feComponentTransfer in="wide" result="halo">
          <feFuncA type="linear" slope="0.16" />
        </feComponentTransfer>
        <feMerge>
          <feMergeNode in="halo" />
          <feMergeNode in="core" />
        </feMerge>
      </filter>
      <filter id="more-blot" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.028" numOctaves="3" seed="2" result="flow" />
        <feDisplacementMap in="SourceGraphic" in2="flow" scale="46" xChannelSelector="R" yChannelSelector="G" result="spread" />
        <feGaussianBlur in="spread" stdDeviation="3.5" result="wet" />
        <feComponentTransfer in="wet">
          <feFuncA type="linear" slope="14" intercept="-6" />
        </feComponentTransfer>
      </filter>
      <filter id="more-brush" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="11" result="hair" />
        <feDisplacementMap in="SourceGraphic" in2="hair" scale="5" xChannelSelector="R" yChannelSelector="G" result="dry" />
        <feGaussianBlur in="dry" stdDeviation="0.5" />
      </filter>
    </svg>

    <header class="more-hud">
      <span class="more-brand">더 많을까?</span>
      <div class="more-stats">
        <span>연승 <b>{{ streak }}</b></span>
        <span>내 최고 <b>{{ best }}</b></span>
      </div>
    </header>

    <div v-if="phase === 'ready' || phase === 'loading' || phase === 'over'" class="more-sheet">
      <template v-if="phase === 'over'">
        <header class="more-result">
          <p class="more-eyebrow">이번 비교는 여기까지</p>
          <div class="more-result-mark">
            <span class="more-drop" aria-hidden="true"></span>
            <h1><b>{{ shownStreak }}</b><span>연승</span></h1>
          </div>
          <p class="more-result-note">맞힌 만큼 쌓인 기록, 다시 도전해 볼까요?</p>
        </header>
        <dl class="more-last-pair" aria-label="마지막 비교 결과">
          <div>
            <dt>기준 간판</dt>
            <dd><strong>{{ left.name }}</strong><span><b>{{ left.count.toLocaleString() }}</b>곳</span></dd>
          </div>
          <div class="more-last-miss">
            <dt>비교한 간판</dt>
            <dd><strong>{{ right.name }}</strong><span><b>{{ right.count.toLocaleString() }}</b>곳</span></dd>
          </div>
        </dl>
        <div class="more-sheet-action">
          <button class="more-button more-start" @click="start">한 판 더 <span aria-hidden="true">→</span></button>
        </div>
        <Leaderboard class="more-board" game="more" :score="streak" unit="연승" />
      </template>
      <template v-else>
        <header class="more-intro">
          <p class="more-eyebrow">전국 간판으로 겨루는 비교 게임</p>
          <h1 class="more-logo">
            <span class="more-ink">더 많을까?</span>
            <span class="more-ink more-logo-thin">더 적을까?</span>
          </h1>
          <span class="more-drop more-intro-drop" aria-hidden="true"></span>
          <div class="more-intro-copy">
            <p>오른쪽 간판, 왼쪽보다 더 많을까요?</p>
            <span>맞히면 다음 간판으로. 틀릴 때까지 연승 도전!</span>
          </div>
        </header>
        <div class="more-sheet-action">
          <button class="more-button more-start" :disabled="phase === 'loading'" @click="start">
            {{ phase === 'loading' ? '간판 모으는 중…' : '비교 시작' }}
            <span aria-hidden="true">→</span>
          </button>
          <p class="more-action-note" role="status">{{ phase === 'loading' ? '전국의 같은 이름 간판을 불러오고 있어요' : '이름은 익숙해도, 숫자는 의외일지도!' }}</p>
        </div>
      </template>
    </div>

    <div class="more-play-heading">
      <h2>오른쪽 간판은 더 많다, 더 적다?</h2>
      <p>왼쪽 숫자를 기준으로 골라 주세요</p>
    </div>

    <div class="more-duel" :class="[{ 'more-slide': sliding, 'more-snap': snap }, verdict]">
      <section v-if="left" :key="`l-${left.name}`" class="more-side more-left">
        <span class="more-side-label">기준 간판</span>
        <div class="more-name"><span class="more-ink">{{ left.name }}</span></div>
        <p class="more-count"><b class="more-ink">{{ left.count.toLocaleString() }}</b><span>곳</span></p>
        <p class="more-count-note">전국 같은 이름 간판</p>
      </section>

      <span class="more-vs" role="status" aria-live="polite">
        <span aria-hidden="true">vs</span>
        <span class="more-sr">{{ verdict === 'ok' ? '정답! 연승을 이어갑니다' : verdict === 'no' ? '오답! 도전 종료' : '두 간판 비교' }}</span>
      </span>
      <!-- 채점 순간 vs 자리에 찍히는 먹 도장 -->
      <span v-if="verdict" :key="verdict" class="more-stamp px-pop" :class="verdict" aria-hidden="true">{{ verdict === 'ok' ? '정답!' : '땡!' }}</span>

      <section v-if="right" :key="`r-${right.name}`" class="more-side more-right" :class="verdict">
        <!-- 틀리면 오른쪽 칸이 먹물에 잠긴다 -->
        <span class="more-flood" aria-hidden="true"></span>
        <span class="more-side-label">비교할 간판</span>
        <div class="more-name"><span class="more-ink">{{ right.name }}</span></div>
        <template v-if="phase === 'ask'">
          <p class="more-question">‘{{ left.name }}’보다</p>
          <div class="more-choices">
            <button class="more-button more-up" @click="answer(true)">더 많다 <span aria-hidden="true">↑</span></button>
            <button class="more-button more-down" @click="answer(false)">더 적다 <span aria-hidden="true">↓</span></button>
          </div>
        </template>
        <template v-else>
          <div class="more-figure">
            <p class="more-count"><b class="more-ink">{{ shown.toLocaleString() }}</b><span>곳</span></p>
            <!-- 채점: 맞으면 붓 동그라미, 틀리면 빗금 -->
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
  --paper: #faf9f5;
  --sumi: #111;
  --sumi-2: rgba(17, 17, 17, 0.62);
  --sumi-3: rgba(17, 17, 17, 0.38);
  --rule: rgba(17, 17, 17, 0.14);
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 480px;
  color: var(--sumi);
  /* 종이 결: 아주 옅은 잡음 한 겹 */
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .08 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23p)'/%3E%3C/svg%3E"),
    var(--paper);
  font-family: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont, sans-serif;
  container-type: inline-size;
  -webkit-font-smoothing: antialiased;
}

.more-hl *,
.more-hl :deep(*) {
  box-sizing: border-box;
}

.more-defs {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}

.more-ink {
  filter: url(#more-bleed);
}

.more-hud {
  order: -1;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 20px;
  margin: 0 22px;
  padding: 16px 0 12px;
  border-bottom: 1.5px solid var(--sumi);
}

.more-brand {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.more-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  color: var(--sumi-2);
  font-size: 12px;
}

.more-stats b {
  margin-left: 4px;
  color: var(--sumi);
  font-size: 20px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.more-sheet {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.more-eyebrow {
  margin: 0;
  color: var(--sumi-2);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

/* 첫 화면: 큰 제목 두 줄, 오른쪽 위에 떨어진 먹 한 방울 */
.more-intro {
  position: relative;
  padding: 34px 26px 10px;
  overflow: hidden;
}

.more-logo {
  display: grid;
  gap: 2px;
  margin: 18px 0 0;
  font-size: clamp(44px, 12.5cqi, 84px);
  font-weight: 900;
  line-height: 1.02;
  letter-spacing: -0.06em;
}

/* 둘째 줄은 물을 많이 탄 옅은 먹 */
.more-logo-thin {
  color: rgba(17, 17, 17, 0.22);
}

.more-drop {
  display: block;
  border-radius: 50%;
  background: var(--sumi);
  filter: url(#more-blot);
  animation: more-spread 1.4s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.more-intro-drop {
  position: absolute;
  top: 26px;
  right: 30px;
  width: clamp(80px, 22cqi, 140px);
  aspect-ratio: 1;
  animation-delay: 0.15s;
}

.more-intro-copy {
  margin-top: 26px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
}

.more-intro-copy p {
  margin: 0 0 4px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.more-intro-copy > span,
.more-action-note {
  color: var(--sumi-2);
  font-size: 12px;
  line-height: 1.7;
}

.more-sheet-action {
  display: grid;
  justify-items: start;
  gap: 10px;
  padding: 18px 26px 26px;
}

.more-action-note {
  margin: 0;
}

/* 버튼: 먹 한 덩이. 누르면 종이와 먹이 뒤바뀐다 */
.mac-win .more-hl .more-button,
.mac-win .more-hl :deep(.lb-join button[type='submit']) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-width: 0;
  min-height: 46px;
  padding: 10px 18px;
  border: 1.5px solid var(--sumi);
  border-radius: 2px;
  color: var(--paper);
  background: var(--sumi);
  box-shadow: none;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  line-height: 1.3;
  cursor: pointer;
  transition: background 0.18s, color 0.18s, transform 0.12s;
}

.mac-win .more-hl .more-start {
  width: min(300px, 100%);
  min-height: 52px;
}

.more-button > span {
  font-size: 18px;
  line-height: 1;
}

.mac-win .more-hl .more-down {
  color: var(--sumi);
  background: transparent;
}

.mac-win .more-hl .more-button:hover:not(:disabled),
.mac-win .more-hl :deep(.lb-join button[type='submit']:hover:not(:disabled)) {
  color: var(--sumi);
  background: var(--paper);
}

.mac-win .more-hl .more-down:hover:not(:disabled) {
  color: var(--paper);
  background: var(--sumi);
}

.mac-win .more-hl .more-button:active:not(:disabled),
.mac-win .more-hl :deep(.lb-join button[type='submit']:active:not(:disabled)) {
  transform: translateY(1px);
}

.mac-win .more-hl .more-button:disabled,
.mac-win .more-hl :deep(.lb-join button[type='submit']:disabled) {
  color: var(--sumi-3);
  background: transparent;
  border-color: var(--sumi-3);
  cursor: default;
}

.mac-win .more-hl .more-button:focus-visible,
.mac-win .more-hl :deep(.lb-join button:focus-visible),
.mac-win .more-hl :deep(.lb-join input:focus-visible) {
  outline: 2px solid var(--sumi);
  outline-offset: 3px;
}

.more-play-heading {
  padding: 16px 22px 4px;
  text-align: center;
}

.more-play-heading h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.more-play-heading p {
  margin: 4px 0 0;
  color: var(--sumi-2);
  font-size: 12px;
}

.more-sheet-open .more-play-heading,
.more-sheet-open .more-duel {
  display: none;
}

/* 대결: 가는 세로줄 하나로 나눈 두 칸 */
.more-duel {
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 0 22px;
  overflow: clip;
  isolation: isolate;
}

.more-duel::before {
  content: '';
  position: absolute;
  top: 28px;
  bottom: 28px;
  left: 50%;
  width: 1px;
  /* 가운데 vs 자리만 비운다 */
  background: linear-gradient(var(--rule) calc(50% - 18px), transparent 0 calc(50% + 18px), var(--rule) 0);
}

.more-side {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 380px;
  padding: 30px 22px;
  text-align: center;
  isolation: isolate;
  transition: transform 0.46s cubic-bezier(0.6, 0, 0.25, 1), opacity 0.46s, color 0.3s;
}

.more-side-label {
  margin-bottom: 22px;
  color: var(--sumi-2);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

/* 이름은 종이에 먹이 스미듯 흐릿하게 번져 나타난다 */
.more-name {
  width: 100%;
  margin-bottom: 18px;
  font-size: clamp(26px, 6cqi, 44px);
  font-weight: 900;
  line-height: 1.2;
  letter-spacing: -0.05em;
  word-break: keep-all;
  overflow-wrap: anywhere;
  animation: more-soak 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.more-side p {
  max-width: 100%;
  margin: 0;
  overflow-wrap: anywhere;
}

.more-figure {
  position: relative;
  width: 100%;
}

.more-count {
  width: 100%;
  font-variant-numeric: tabular-nums;
}

.more-count b {
  display: block;
  font-size: clamp(38px, 9.5cqi, 68px);
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.05em;
}

.more-count > span {
  display: block;
  margin: 4px 0 12px;
  font-size: 14px;
  font-weight: 600;
}

.more-count-note,
.more-question {
  color: var(--sumi-2);
  font-size: 12px;
  line-height: 1.6;
}

.more-choices {
  display: grid;
  gap: 8px;
  width: min(200px, 100%);
  margin-top: 16px;
}

/* 채점 붓질: 획을 따라 그어진다 */
.more-mark {
  position: absolute;
  top: 50%;
  left: 50%;
  width: min(118%, 280px);
  overflow: visible;
  transform: translate(-50%, -58%) rotate(-4deg);
  filter: url(#more-brush);
  pointer-events: none;
}

.more-mark path {
  fill: none;
  stroke: var(--sumi);
  stroke-width: 7;
  stroke-linecap: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: more-stroke 0.55s cubic-bezier(0.5, 0, 0.3, 1) forwards;
}

.no .more-mark path {
  stroke: var(--paper);
  stroke-width: 9;
  animation-delay: 0.25s;
}

/* 틀리면 먹물이 오른쪽 칸 가운데서 번져 칸을 덮는다 */
.more-flood {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: -1;
  width: 170%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: var(--sumi);
  filter: url(#more-blot);
  transform: translate(-50%, -50%) scale(0);
  pointer-events: none;
}

.more-right {
  overflow: clip;
}

.more-right.no {
  color: var(--paper);
  transition-delay: 0s, 0s, 0.18s;
}

.more-right.no .more-flood {
  animation: more-flood 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) forwards;
}

.more-right.no .more-side-label,
.more-right.no .more-count-note {
  color: rgba(250, 249, 245, 0.7);
}

.more-vs {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 2;
  padding: 6px 2px;
  color: var(--sumi-3);
  font-size: 13px;
  font-style: italic;
  font-weight: 600;
  transform: translate(-50%, -50%);
  transition: opacity 0.2s;
}

.more-duel.no .more-vs {
  opacity: 0;
}

/* 먹 한 가지로 찍는 픽셀 도장. 틀리면 종이 빛 도장이 흔들린다 */
.more-stamp {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 3;
  margin: -20px 0 0 -44px;
  width: 88px;
  padding: 8px 0 7px;
  color: var(--paper);
  background: var(--sumi);
  font-family: var(--game-font);
  font-size: 20px;
  line-height: 1.2;
  text-align: center;
  pointer-events: none;
  box-shadow:
    0 -3px 0 0 var(--sumi),
    0 3px 0 0 var(--sumi),
    -3px 0 0 0 var(--sumi),
    3px 0 0 0 var(--sumi),
    0 7px 0 0 rgba(0, 0, 0, 0.18);
}

.more-stamp.no {
  color: var(--sumi);
  background: var(--paper);
  animation:
    px-pop-in 0.36s steps(1) both,
    px-shake 0.32s 0.36s steps(1);
}

/* 맞히면 왼쪽 간판은 밀려 나가고 오른쪽 간판이 왼쪽 자리로 간다. 새 간판은 오른쪽에서 들어온다 */
.more-duel.more-slide .more-left {
  transform: translateX(-60%);
  opacity: 0;
}

.more-duel.more-slide .more-right {
  transform: translateX(-100%);
}

.more-duel.more-slide .more-vs {
  opacity: 0;
}

.more-duel.more-snap .more-side {
  transition: none;
}

.more-duel.more-snap .more-left .more-name {
  animation: none;
}

/* 끝 화면: 먹 방울 위에 흰 숫자 */
.more-result {
  padding: 30px 26px 8px;
  text-align: center;
}

.more-result-mark {
  position: relative;
  display: grid;
  place-items: center;
  margin: 14px auto 6px;
  width: clamp(170px, 42cqi, 230px);
  aspect-ratio: 1;
}

.more-result-mark .more-drop {
  position: absolute;
  inset: 0;
}

.more-result h1 {
  position: relative;
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin: 0;
  color: var(--paper);
  animation: more-soak 0.9s 0.35s cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.more-result h1 b {
  font-size: clamp(60px, 15cqi, 92px);
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.06em;
  font-variant-numeric: tabular-nums;
}

.more-result h1 > span {
  font-size: 18px;
  font-weight: 700;
}

.more-result-note {
  margin: 12px 0 0;
  color: var(--sumi-2);
  font-size: 13px;
  line-height: 1.6;
}

.more-last-pair {
  display: grid;
  margin: 10px 26px 0;
  border-top: 1.5px solid var(--sumi);
}

.more-last-pair > div {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr);
  align-items: baseline;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--rule);
}

.more-last-pair dt {
  color: var(--sumi-2);
  font-size: 11px;
}

.more-last-pair dd {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 12px;
  margin: 0;
  min-width: 0;
}

.more-last-pair strong {
  font-size: 17px;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.more-last-pair dd > span {
  font-size: 12px;
}

.more-last-pair b {
  margin-right: 3px;
  font-size: 20px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.more-last-miss strong {
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
  border-top: 1.5px solid var(--sumi);
  border-radius: 0;
  color: var(--sumi);
  background: transparent;
  box-shadow: none;
}

.more-board :deep(.lb-head) {
  flex-wrap: wrap;
  gap: 6px 12px;
}

.more-board :deep(.lb-head strong) {
  font-size: 15px;
  font-weight: 800;
}

.more-board :deep(.muted) {
  color: var(--sumi-2);
}

.more-board :deep(.lb-list li) {
  grid-template-columns: minmax(24px, max-content) minmax(0, 1fr) minmax(0, auto);
  padding: 9px 4px;
  border-bottom: 1px solid var(--rule);
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
  border-radius: 50%;
  color: var(--sumi);
  background: transparent;
  font-variant-numeric: tabular-nums;
}

.more-board :deep(.no.n1) {
  color: var(--paper);
  background: var(--sumi);
}

.more-board :deep(.pts) {
  color: var(--sumi);
  font-size: 17px;
  font-weight: 800;
}

.more-board :deep(.lb-list li.me),
.more-board :deep(.lb-me) {
  color: var(--sumi);
  background: rgba(17, 17, 17, 0.06);
}

.more-board :deep(.lb-me.rec) {
  color: var(--paper);
  background: var(--sumi);
}

.more-board :deep(.lb-join) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.mac-win .more-hl :deep(.lb-join input) {
  width: 100%;
  min-width: 0;
  height: 42px;
  padding: 0 10px;
  border: 0;
  border-bottom: 1.5px solid var(--sumi);
  border-radius: 0;
  color: var(--sumi);
  background: transparent;
  box-shadow: none;
  font: inherit;
  font-size: 13px;
}

.more-board :deep(.lb-join input::placeholder) {
  color: var(--sumi-3);
}

.mac-win .more-hl :deep(.lb-join button[type='submit']) {
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
  color: var(--sumi);
  font-weight: 700;
}

.more-foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px 16px;
  margin: auto 22px 0;
  padding: 12px 0 16px;
  border-top: 1px solid var(--rule);
  color: var(--sumi-2);
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
  width: 20px;
  height: 20px;
  border: 1px solid var(--sumi);
  border-radius: 2px;
  color: var(--sumi);
  background: transparent;
  font: inherit;
  font-size: 12px;
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

@container (max-width: 500px) {
  .more-intro-drop {
    top: 20px;
    right: 18px;
  }

  .more-duel {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 1fr 1fr;
  }

  .more-duel::before {
    top: 50%;
    right: 20px;
    bottom: auto;
    left: 20px;
    width: auto;
    height: 1px;
    background: linear-gradient(to right, var(--rule) calc(50% - 18px), transparent 0 calc(50% + 18px), var(--rule) 0);
  }

  .more-side {
    min-height: 260px;
    padding: 24px 18px;
  }

  .more-side-label {
    margin-bottom: 12px;
  }

  .more-name {
    margin-bottom: 10px;
    font-size: 30px;
  }

  .more-count b {
    font-size: 48px;
  }

  .more-choices {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    width: min(320px, 100%);
  }

  .more-duel.more-slide .more-left {
    transform: translateY(-60%);
  }

  .more-duel.more-slide .more-right {
    transform: translateY(-100%);
  }
}

@container (max-width: 350px) {
  .more-hud,
  .more-foot,
  .more-duel {
    margin-inline: 14px;
  }

  .more-board :deep(.lb-join) {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .more-side,
  .mac-win .more-hl .more-button {
    transition: none;
  }

  .more-name,
  .more-drop,
  .more-result h1,
  .more-stamp {
    animation: none;
  }

  .more-mark path {
    stroke-dashoffset: 0;
    animation: none;
  }

  .more-right.no .more-flood {
    animation: none;
    transform: translate(-50%, -50%) scale(1);
  }
}

@keyframes more-soak {
  from {
    opacity: 0;
    filter: blur(10px);
    transform: scale(1.04);
  }
  45% {
    opacity: 0.85;
  }
}

@keyframes more-spread {
  from {
    transform: scale(0.06);
  }
}

@keyframes more-flood {
  from {
    transform: translate(-50%, -50%) scale(0.04);
  }
  to {
    transform: translate(-50%, -50%) scale(1);
  }
}

@keyframes more-stroke {
  to {
    stroke-dashoffset: 0;
  }
}
</style>
