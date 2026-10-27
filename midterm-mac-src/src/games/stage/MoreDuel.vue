<script setup>
// 이야기 속 '더 많을까?': 홍대 밤거리에서 숫자 도깨비와 내기를 한다.
// 도깨비가 진짜 간판 두 개를 치켜들면, 전국에 같은 이름 간판이 더 많은 쪽을 고른다(← →).
// 맞히면 도깨비가 휘청이고 자루에서 글자가 튀어나온다, 틀리면 도깨비가 웃고 목숨이 준다. goal 번 맞히면 이긴다
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { randomNames } from '../../data.js'
import { PASTEL, pastelOf } from '../../shops.js'
import { sfx } from '../../sound.js'
import Hearts from './Hearts.vue'
import Hero from './Hero.vue'
import './stage.css'

const props = defineProps({ goal: { type: Number, default: 6 }, boss: { type: String, default: '' }, bossName: { type: String, default: '숫자 도깨비' } })
const LIVES = 3
// 뒤쪽 가게 간판들: 도깨비가 글자를 숫자로 바꿔 놓았다
const SHOP_NUMS = ['0 0 0', '7 7', '4 0 4', '1 2 3', '9 9 9', '0 1', '8 8 8']
const ASK = ['자, 어느 간판이 전국에 더 많게?', '이번엔 어렵다! 더 많은 쪽을 골라 봐!', '크크, 숫자는 거짓말을 안 하지. 골라!']
const LAUGH = ['크하하! 틀렸다! 숫자가 이긴다!', '키키, 그 간판은 생각보다 적다고!', '내 자루가 더 무거워지는구나!']
const OUCH = ['크윽! 맞혔잖아…!', '으악, 자루가 찢어진다!', '이, 이럴 수가…']

const phase = ref('loading') // loading | ask | reveal | win | over
const pair = ref([])
const shown = ref([0, 0])
const picked = ref(-1)
const verdict = ref('')
const hits = ref(0)
const lives = ref(LIVES)
const bossFx = ref('')
const heroPose = ref('idle')
const line = ref('')
const letters = ref([])

let pool = []
const seen = new Set()
let raf = 0
const timers = new Set()
const later = (fn, ms) => {
  const t = setTimeout(() => {
    timers.delete(t)
    fn()
  }, ms)
  timers.add(t)
}
const pick = (list) => list[Math.floor(Math.random() * list.length)]

async function refill() {
  const rows = await randomNames(10)
  pool.push(...rows.filter((r) => /^[가-힣A-Za-z0-9]{2,10}$/.test(r.name) && /[가-힣]/.test(r.name) && !seen.has(r.name)))
}

// 더 많을까와 같은 규칙: 맞힐수록 두 개수 차이가 좁은 문제를 낸다 (처음엔 8배 차이, 나중엔 1.3배 안쪽)
async function draw(against) {
  if (pool.length < 60) await refill()
  const target = Math.log(Math.max(1.3, 8 - hits.value * 0.9))
  let best = null
  let gap = Infinity
  for (let k = 0; k < 40; k++) {
    const i = Math.floor(Math.random() * pool.length)
    const c = pool[i]
    if (!c || seen.has(c.name) || (against && c.count === against.count)) continue
    const d = against ? Math.abs(Math.abs(Math.log(c.count / against.count)) - target) : 0
    if (d < gap) {
      gap = d
      best = i
    }
  }
  const [c] = pool.splice(best ?? 0, 1)
  seen.add(c.name)
  return c
}

async function round() {
  phase.value = 'loading'
  picked.value = -1
  verdict.value = ''
  shown.value = [0, 0]
  if (pool.length < 60) await refill()
  // 첫 간판은 너무 드물지 않은 이름에서 고른다
  pool.sort((a, b) => b.count - a.count)
  const a = pool.splice(Math.floor(Math.random() * Math.min(80, pool.length)), 1)[0]
  seen.add(a.name)
  pool.sort(() => Math.random() - 0.5)
  const b = await draw(a)
  pair.value = Math.random() < 0.5 ? [a, b] : [b, a]
  line.value = pick(ASK)
  phase.value = 'ask'
  sfx.flip?.()
}

function countUp(ms = 800) {
  return new Promise((done) => {
    const t0 = performance.now()
    let ticks = 0
    const step = (t) => {
      const p = Math.min(1, (t - t0) / ms)
      const e = 1 - (1 - p) ** 3
      shown.value = pair.value.map((s) => Math.round(s.count * e))
      if (p < 1 && Math.floor(p * 10) > ticks) {
        ticks = Math.floor(p * 10)
        sfx.tick()
      }
      if (p < 1) raf = requestAnimationFrame(step)
      else done()
    }
    raf = requestAnimationFrame(step)
  })
}

async function answer(i) {
  if (phase.value !== 'ask') return
  phase.value = 'reveal'
  picked.value = i
  sfx.click?.()
  await countUp()
  const [a, b] = pair.value
  const more = a.count >= b.count ? 0 : 1
  const ok = i === more
  verdict.value = ok ? 'ok' : 'no'
  bossFx.value = ''
  if (ok) {
    hits.value++
    sfx.right()
    requestAnimationFrame(() => (bossFx.value = 'hit'))
    heroPose.value = 'cheer'
    line.value = pick(OUCH)
    burst()
    if (hits.value >= props.goal) return later(win, 900)
  } else {
    lives.value--
    sfx.wrong()
    requestAnimationFrame(() => (bossFx.value = 'laugh'))
    heroPose.value = 'hurt'
    line.value = pick(LAUGH)
    if (lives.value <= 0) return later(lose, 1200)
  }
  later(() => {
    heroPose.value = 'idle'
    round()
  }, 1700)
}

// 맞히면 도깨비 자루에서 숫자로 바뀌었던 글자가 튀어나온다
function burst() {
  const src = pair.value.map((s) => s.name).join('')
  const out = [...src].slice(0, 8).map((ch, k) => ({ id: `${Date.now()}-${k}`, ch, dx: (Math.random() - 0.7) * 260, dy: -60 - Math.random() * 120 }))
  letters.value = out
  later(() => letters.value === out && (letters.value = []), 1200)
}

function win() {
  phase.value = 'win'
  bossFx.value = 'gone'
  heroPose.value = 'cheer'
  line.value = ''
  sfx.win?.()
  window.dispatchEvent(new CustomEvent('game:over', { detail: { game: 'more', score: hits.value, won: true } }))
}

function lose() {
  phase.value = 'over'
  sfx.lose?.()
}

function start() {
  for (const t of timers) clearTimeout(t)
  timers.clear()
  hits.value = 0
  lives.value = LIVES
  bossFx.value = ''
  heroPose.value = 'idle'
  seen.clear()
  round()
}

function onKey(e) {
  if (phase.value === 'ask') {
    if (e.key === 'ArrowLeft' || e.key === '1') answer(0)
    else if (e.key === 'ArrowRight' || e.key === '2') answer(1)
    else return
    e.preventDefault()
  } else if (phase.value === 'over' && e.key === 'Enter') {
    e.preventDefault()
    start()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  start()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  cancelAnimationFrame(raf)
  for (const t of timers) clearTimeout(t)
})
</script>

<template>
  <div class="sg md">
    <div class="md-sky" aria-hidden="true"></div>
    <div class="sg-stars" aria-hidden="true"></div>
    <div class="md-shops" aria-hidden="true">
      <i v-for="n in 7" :key="n" :data-n="SHOP_NUMS[n - 1]" :style="{ '--plate': PASTEL[n % PASTEL.length] }"></i>
    </div>

    <header class="sg-hud">
      <span class="sg-chip"><Hearts :lives="lives" :max="LIVES" /></span>
      <span class="sg-chip"><small>맞힌 내기</small><b>{{ hits }} / {{ goal }}</b></span>
      <span class="sg-hp">
        <span>{{ bossName }} 체력</span>
        <b><i :style="{ width: `${Math.max(0, 1 - hits / goal) * 100}%` }"></i></b>
      </span>
    </header>

    <!-- 도깨비가 두 간판을 치켜들고 서 있다 -->
    <div class="md-ring">
      <div class="md-me">
        <p v-if="phase === 'ask'" class="sg-say md-me-say">어느 쪽이 더 많지…?</p>
        <Hero :scale="5" :dir="3" :pose="heroPose" />
      </div>

      <div class="md-boss">
        <p v-if="line" :key="line" class="sg-say boss md-boss-say px-pop">{{ line }}</p>
        <div class="md-pair">
          <button
            v-for="(s, i) in pair"
            :key="s.name"
            class="md-sign"
            :class="{ picked: picked === i, ok: verdict && s.count >= pair[1 - i].count, no: verdict === 'no' && picked === i }"
            :disabled="phase !== 'ask'"
            :aria-label="`${s.name} 고르기`"
            @click="answer(i)"
          >
            <span class="sg-sign md-plate" :style="{ '--plate': pastelOf(s.name) }">{{ s.name }}</span>
            <span class="md-pole" aria-hidden="true"></span>
            <span class="md-count">
              <template v-if="phase === 'reveal' || verdict">전국 <b>{{ shown[i].toLocaleString() }}</b>곳</template>
              <template v-else><span class="sg-key">{{ i ? '→' : '←' }}</span> 전국 ?곳</template>
            </span>
          </button>
        </div>
        <img v-if="boss" :key="bossFx + hits + lives" class="sg-boss md-goblin" :class="bossFx" :src="boss" alt="" draggable="false" />
        <span v-for="l in letters" :key="l.id" class="md-letter" :style="{ '--dx': `${l.dx}px`, '--dy': `${l.dy}px` }">{{ l.ch }}</span>
        <span v-if="verdict" :key="verdict + hits + lives" class="md-stamp px-pop" :class="verdict">{{ verdict === 'ok' ? '맞혔다!' : '땡!' }}</span>
      </div>
    </div>

    <footer class="md-foot">
      <span><span class="sg-key">←</span><span class="sg-key">→</span> 또는 간판을 눌러 고르기</span>
      <span>상호가 글자 하나까지 같은 간판만 셉니다</span>
    </footer>

    <div v-if="phase === 'win'" class="sg-end">
      <h1 class="px-pop">도깨비가 자루를 열었다!</h1>
      <p>내기 <b>{{ hits }}번</b>을 맞혀 숫자로 바뀐 글자를 되찾았다</p>
    </div>
    <div v-else-if="phase === 'over'" class="sg-end lost">
      <h1 class="px-shake">내기에 졌다…</h1>
      <p>{{ bossName }} 체력이 <b>{{ Math.max(0, goal - hits) }}</b>만큼 남았어요</p>
      <button class="sg-btn go" @click="start">다시 내기하기 ▶</button>
    </div>
  </div>
</template>

<style scoped>
.md {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
}

.md-sky {
  position: absolute;
  inset: 0;
  background: linear-gradient(#1a0f3a 0 40%, #2b1450 40% 62%, #3c1d5a 62%);
}

/* 숫자 도깨비가 사는 골목: 보름달이 숫자 모양으로 떠 있다 */
.md-sky::after {
  content: '0';
  position: absolute;
  top: 9%;
  left: 14%;
  width: 92px;
  height: 92px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #ffe9a8;
  color: #e7c56a;
  font-size: 64px;
  box-shadow: 0 0 0 8px rgb(255 233 168 / 0.12), 0 0 60px rgb(255 233 168 / 0.35);
}

/* 홍대 가게들: 문 닫힌 셔터와 숫자로 바뀐 간판 */
.md-shops {
  position: absolute;
  inset: auto 0 64px;
  height: 34%;
  display: flex;
  gap: 8px;
  padding: 0 8px;
  opacity: 0.55;
}

.md-shops i {
  position: relative;
  flex: 1;
  background:
    linear-gradient(#5b2a6e 0 22px, transparent 22px),
    repeating-linear-gradient(#2a1840 0 6px, #3a2456 6px 9px);
  box-shadow: inset 0 -4px 0 #140a24;
}

/* 셔터 위 간판: 글자를 뺏겨 숫자만 남은 파스텔 판, 하나 걸러 불이 깜박인다 */
.md-shops i::before {
  content: attr(data-n);
  position: absolute;
  top: -30px;
  left: 50%;
  min-width: 64%;
  padding: 2px 6px;
  translate: -50% 0;
  border: 3px solid #140a24;
  background: var(--plate, #f6a5c0);
  color: #1d1b2e;
  font-size: 13px;
  text-align: center;
  box-shadow: inset 0 3px rgb(255 255 255 / 0.4), 0 0 14px rgb(255 200 240 / 0.35);
}

.md-shops i:nth-child(2n)::before {
  animation: md-flicker 2.6s steps(1) infinite;
}

.md-shops i:nth-child(3n)::before {
  animation-delay: 1.1s;
}

@keyframes md-flicker {
  0%,
  60%,
  64%,
  100% {
    opacity: 1;
  }
  62% {
    opacity: 0.35;
  }
}

.md-ring {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(140px, 0.6fr) minmax(0, 2fr);
  align-items: end;
  gap: 12px;
  padding: 70px 4% 0;
}

.md-ring::after {
  content: '';
  position: absolute;
  inset: auto 0 0;
  z-index: -1;
  height: 26px;
  /* 보도블록 */
  background:
    repeating-linear-gradient(90deg, rgb(0 0 0 / 0.25) 0 3px, transparent 3px 44px),
    #241536;
  box-shadow: inset 0 4px 0 #3a2456;
}

.md-me {
  position: relative;
  justify-self: center;
  padding-bottom: 14px;
}

.md-me-say {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  white-space: nowrap;
}

.md-boss {
  position: relative;
  display: grid;
  justify-items: center;
}

.md-boss-say {
  position: absolute;
  top: -68px;
  right: 2%;
  z-index: 4;
  --tail: calc(100% - 50px);
}

.md-pair {
  position: relative;
  z-index: 2;
  display: flex;
  justify-content: center;
  gap: clamp(30px, 14cqi, 220px);
  margin-bottom: -40px;
}

.md-sign {
  display: grid;
  justify-items: center;
  gap: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  animation: md-raise 0.4s steps(4) both;
}

.md-sign:nth-child(2) {
  animation-delay: 0.12s;
}

@keyframes md-raise {
  from {
    translate: 0 60px;
    opacity: 0;
  }
}

.md-sign:disabled {
  cursor: default;
}

.md-sign:hover:not(:disabled) .md-plate,
.md-sign:focus-visible .md-plate {
  translate: 0 -6px;
}

/* 간판판 네 귀퉁이에 나사 */
.md-plate {
  min-width: 150px;
  max-width: 280px;
  padding: 14px 20px;
  background:
    radial-gradient(circle, #141b3a 0 40%, transparent 50%) 5px 5px / 5px 5px no-repeat,
    radial-gradient(circle, #141b3a 0 40%, transparent 50%) calc(100% - 5px) 5px / 5px 5px no-repeat,
    radial-gradient(circle, #141b3a 0 40%, transparent 50%) 5px calc(100% - 5px) / 5px 5px no-repeat,
    radial-gradient(circle, #141b3a 0 40%, transparent 50%) calc(100% - 5px) calc(100% - 5px) / 5px 5px no-repeat,
    var(--plate, #ffd84d);
  font-size: clamp(20px, 2.6cqi, 30px);
  transition: translate 0.1s steps(2);
}

.md-sign.picked .md-plate {
  box-shadow:
    inset 0 0 0 3px rgb(255 255 255 / 0.35),
    0 0 0 3px #0b1028,
    0 0 0 7px #ffec27,
    0 10px 0 rgb(0 0 0 / 0.35);
}

.md-sign.ok .md-plate {
  box-shadow:
    inset 0 0 0 3px rgb(255 255 255 / 0.35),
    0 0 0 3px #0b1028,
    0 0 0 7px #00e436,
    0 0 30px rgb(0 228 54 / 0.6);
}

.md-sign.no .md-plate {
  filter: grayscale(0.7) brightness(0.7);
}

.md-pole {
  width: 8px;
  height: 46px;
  background: #6b4a2a;
  box-shadow: inset -3px 0 0 #3b2b22;
}

.md-count {
  min-height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: #0b1028;
  box-shadow: 0 0 0 2px #0b1028;
  font-size: 15px;
}

.md-count b {
  color: #ffec27;
  font-size: 22px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.md-goblin {
  position: relative;
  z-index: 1;
  height: clamp(190px, 40cqh, 330px);
}

.md-letter {
  position: absolute;
  bottom: 30%;
  left: 50%;
  z-index: 5;
  color: #ffec27;
  font-size: 26px;
  pointer-events: none;
  text-shadow: 2px 2px 0 #000;
  animation: md-letter 1.1s steps(9) forwards;
}

@keyframes md-letter {
  60% {
    opacity: 1;
  }
  to {
    translate: var(--dx) var(--dy);
    opacity: 0;
  }
}

.md-stamp {
  position: absolute;
  top: 34%;
  left: 50%;
  z-index: 6;
  padding: 6px 14px;
  translate: -50% 0;
  rotate: -8deg;
  background: #00e436;
  color: #04170b;
  font-size: 26px;
  box-shadow: 0 0 0 3px #0b1028;
}

.md-stamp.no {
  background: #ff004d;
  color: #fff;
}

.md-foot {
  position: relative;
  z-index: 3;
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 16px;
  padding: 10px 16px;
  background: #141b3a;
  box-shadow: 0 -3px 0 #fff1e8;
  color: #fff1e8;
  font-size: 12px;
}

.md-foot > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
</style>
