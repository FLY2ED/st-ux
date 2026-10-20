<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { randomNames } from '../data.js'
import { sfx } from '../sound.js'

// 간판 산성비: 진짜 간판 이름이 비처럼 떨어진다. 바닥에 닿기 전에 똑같이 쳐서 없앤다
const SIGN = new URL('../assets/sign-plain.webp', import.meta.url).href
const GOLD = new URL('../assets/sign-gold.webp', import.meta.url).href
const LIVES = 3
const BEST_KEY = 'gp-rain-best'

const phase = ref('ready')
const drops = ref([])
const pops = ref([])
const typed = ref('')
const score = ref(0)
const lives = ref(LIVES)
const level = ref(1)
const cleared = ref(0)
const chars = ref(0)
const combo = ref(0)
const best = ref(Number(localStorage.getItem(BEST_KEY)) || 0)
const shake = ref(false)
const input = ref(null)

let pool = []
let raf = 0
let last = 0
let started = 0
let nextDrop = 0
let id = 0

const cpm = computed(() => {
  const min = (performance.now() - started) / 60000
  return phase.value === 'play' || phase.value === 'over' ? Math.round(chars.value / Math.max(min, 0.1)) : 0
})

// 단계가 오를수록 더 긴 이름이 더 빨리 내린다
function nextName() {
  const min = Math.min(3 + level.value, 9)
  const max = 6 + level.value * 2
  const fit = pool.filter((n) => n.name.length >= min && n.name.length <= max && /^[가-힣A-Za-z0-9]+$/.test(n.name))
  const list = fit.length ? fit : pool
  return list.splice(Math.floor(Math.random() * list.length), 1)[0] || { name: '김밥천국', count: 1 }
}

function spawn() {
  const n = nextName()
  pool = pool.filter((p) => p !== n)
  drops.value.push({
    id: ++id,
    ...n,
    x: 4 + Math.random() * 62,
    y: -12,
    // 1분에 화면 높이를 몇 번 지나가는지
    speed: (5.5 + level.value * 1.6) * (0.8 + Math.random() * 0.4),
    gold: Math.random() < 0.08,
  })
}

async function start() {
  phase.value = 'loading'
  pool = await randomNames(10)
  drops.value = []
  pops.value = []
  score.value = 0
  lives.value = LIVES
  level.value = 1
  cleared.value = 0
  chars.value = 0
  combo.value = 0
  typed.value = ''
  phase.value = 'play'
  started = performance.now()
  last = started
  nextDrop = started + 300
  raf = requestAnimationFrame(tick)
  await nextTick()
  input.value?.focus()
}

function tick(now) {
  const dt = Math.min(now - last, 60) / 1000
  last = now
  if (now >= nextDrop) {
    spawn()
    nextDrop = now + Math.max(2600 - level.value * 260, 900)
  }
  for (const d of drops.value) d.y += d.speed * dt
  const hit = drops.value.filter((d) => d.y >= 88)
  if (hit.length) {
    drops.value = drops.value.filter((d) => d.y < 88)
    lives.value -= hit.length
    combo.value = 0
    shake.value = true
    setTimeout(() => (shake.value = false), 300)
    sfx.wrong()
    if (lives.value <= 0) return over()
  }
  if (pool.length < 30) randomNames(4).then((more) => pool.push(...more))
  raf = requestAnimationFrame(tick)
}

function over() {
  phase.value = 'over'
  cancelAnimationFrame(raf)
  if (score.value > best.value) {
    best.value = score.value
    localStorage.setItem(BEST_KEY, String(best.value))
  }
}

function pop(d, text) {
  const p = { id: d.id, x: d.x, y: d.y, text }
  pops.value.push(p)
  setTimeout(() => (pops.value = pops.value.filter((q) => q !== p)), 700)
}

function clear(d) {
  drops.value = drops.value.filter((q) => q !== d)
  combo.value++
  cleared.value++
  chars.value += d.name.length
  score.value += d.name.length * 10 * level.value + combo.value * 5
  pop(d, `+${d.name.length * 10 * level.value}`)
  sfx.neon(combo.value)
  // 노란 간판은 화면의 간판을 모두 지운다
  if (d.gold) {
    for (const q of drops.value) {
      pop(q, '펑!')
      score.value += q.name.length * 5
      cleared.value++
    }
    drops.value = []
  }
  if (cleared.value >= level.value * 6) {
    level.value++
    sfx.bell()
  }
}

// 한글 입력기가 조합을 끝낸 뒤에만 비교한다
function check(e) {
  typed.value = e.target.value
  if (e.isComposing) return
  const word = typed.value.trim()
  const d = drops.value.find((q) => q.name === word)
  if (d) {
    clear(d)
    typed.value = ''
    e.target.value = ''
  }
}

function enter(e) {
  if (e.isComposing) return
  const word = e.target.value.trim()
  if (!word) return
  const d = drops.value.find((q) => q.name === word)
  if (d) clear(d)
  else {
    combo.value = 0
    sfx.click()
  }
  typed.value = ''
  e.target.value = ''
}

// 지금 치고 있는 글자로 시작하는 간판을 미리 깜빡여 준다
const target = computed(() => {
  const w = typed.value.trim()
  if (!w) return null
  return drops.value.filter((d) => d.name.startsWith(w)).sort((a, b) => b.y - a.y)[0]?.id
})

onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="rain">
    <div class="hud row">
      <span>점수 <b class="big-num">{{ score.toLocaleString() }}</b></span>
      <span>{{ level }}단계</span>
      <span>{{ cpm }}자/분</span>
      <span class="hearts" :aria-label="`목숨 ${lives}`">{{ '♥'.repeat(Math.max(lives, 0)) }}<i>{{ '♡'.repeat(LIVES - Math.max(lives, 0)) }}</i></span>
    </div>

    <div class="sky sunken-panel" :class="{ shake }" @click="input?.focus()">
      <div
        v-for="d in drops"
        :key="d.id"
        class="drop"
        :class="{ aim: d.id === target, gold: d.gold }"
        :style="{ left: `${d.x}%`, top: `${d.y}%` }"
      >
        <img class="pixel" :src="d.gold ? GOLD : SIGN" alt="" draggable="false" />
        <span>{{ d.name }}</span>
        <small>전국 {{ d.count }}곳</small>
      </div>
      <span v-for="p in pops" :key="`p${p.id}`" class="pop" :style="{ left: `${p.x + 8}%`, top: `${p.y}%` }">{{ p.text }}</span>
      <div class="ground" aria-hidden="true"></div>

      <div v-if="phase !== 'play'" class="cover">
        <template v-if="phase === 'over'">
          <p class="t">간판에 깔렸다…</p>
          <p>간판 {{ cleared }}개 · {{ score.toLocaleString() }}점 · 최고 {{ best.toLocaleString() }}점</p>
        </template>
        <template v-else>
          <p class="t">간판 산성비</p>
          <p>전국에 진짜 있는 간판 이름이 떨어져요.<br />바닥에 닿기 전에 <b>똑같이</b> 쳐서 지우세요. 노란 간판은 한 번에 싹 지워요.</p>
        </template>
        <button class="go" :disabled="phase === 'loading'" @click="start">{{ phase === 'over' ? '한 판 더' : phase === 'loading' ? '간판 모으는 중…' : '시작!' }}</button>
      </div>
    </div>

    <input
      ref="input"
      type="text"
      class="type"
      :disabled="phase !== 'play'"
      placeholder="떨어지는 간판 이름을 치고 Enter"
      autocomplete="off"
      spellcheck="false"
      @input="check"
      @keydown.enter="enter"
    />
  </div>
</template>

<style scoped>
.rain {
  display: grid;
  gap: 6px;
}

.hud {
  gap: 14px;
  font-size: 13px;
}

.hearts {
  margin-left: auto;
  color: var(--red);
  letter-spacing: 2px;
}

.hearts i {
  font-style: normal;
  opacity: 0.4;
}

.sky {
  position: relative;
  height: min(420px, 56dvh);
  overflow: hidden;
  background:
    radial-gradient(#ffffff 1px, transparent 1.5px) 0 0 / 24px 24px,
    linear-gradient(#bfe3f5, #e6f5f2);
}

.sky.shake {
  animation: shake 0.3s steps(3);
}

.drop {
  position: absolute;
  width: fit-content;
  min-width: 120px;
  padding: 8px 18px 12px;
  display: grid;
  justify-items: center;
  will-change: top;
}

.drop img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  z-index: 0;
}

.drop span {
  position: relative;
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-size: 16px;
  line-height: 1.2;
  white-space: nowrap;
}

.drop small {
  position: relative;
  font-size: 10px;
  color: #6b6b7b;
}

.drop.aim span {
  background: var(--pink);
  outline: 2px solid var(--ink);
  animation: blink 0.4s steps(2) infinite;
}

.pop {
  position: absolute;
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-size: 16px;
  color: var(--red);
  text-shadow: 1px 1px 0 #fff;
  pointer-events: none;
  animation: up 0.7s steps(6) forwards;
}

.ground {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 10%;
  border-top: 3px solid var(--ink);
  background: repeating-linear-gradient(90deg, #d9c9b8 0 30px, #cdbba8 30px 32px);
}

.cover {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 6px;
  padding: 20px;
  text-align: center;
  font-size: 13px;
  line-height: 1.6;
  background: rgb(255 255 255 / 0.82);
}

.cover p {
  margin: 0;
}

.cover .t {
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-size: 26px;
  padding: 2px 10px;
  background: var(--yellow);
  border: 3px solid var(--ink);
}

.go {
  margin-top: 8px;
  min-width: 120px;
  font-size: 14px;
}

.type {
  width: 100%;
  font-size: 16px;
  height: 32px;
}

@keyframes up {
  to {
    transform: translateY(-40px);
    opacity: 0;
  }
}

@keyframes blink {
  50% {
    background: var(--yellow);
  }
}

@keyframes shake {
  25% {
    transform: translateX(-6px);
  }
  75% {
    transform: translateX(6px);
  }
}
</style>
