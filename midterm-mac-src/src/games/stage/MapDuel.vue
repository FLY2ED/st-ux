<script setup>
// 이야기 속 '이름 찾기': 간판 도둑이 연막을 피워 도시의 간판을 훔쳐 가고 있다.
// 연막 속에서 간판 세 개가 떠오르면, 내 이름 글자가 들어간 간판만 골라 읽는다(1·2·3 또는 누르기).
// 읽은 간판은 지도에 불이 켜지고 도둑이 흐려진다. 엉뚱한 간판을 읽거나 내 이름 간판을 도둑맞으면 목숨이 준다
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { search, signPool } from '../../data.js'
import { pastelOf } from '../../shops.js'
import { sfx } from '../../sound.js'
import Hearts from './Hearts.vue'
import Hero from './Hero.vue'
import PixelKorea from './PixelKorea.vue'
import './stage.css'

const props = defineProps({
  goal: { type: Number, default: 5 },
  word: { type: String, default: '' },
  boss: { type: String, default: '' },
  bossName: { type: String, default: '간판 도둑' },
})
const LIVES = 3
const SLOTS = 3
const TAUNT = ['아무도 안 읽는 간판은 내 거야!', '연막 속에 숨기면 아무도 못 찾지', '네 이름 글자도 곧 내 자루에 들어간다']
const OUCH = ['으윽, 누가 그 이름을 읽었지…?', '불이… 다시 켜진다…', '안 돼, 읽힌 간판은 못 훔쳐…']

const phase = ref('loading') // loading | play | win | over | none
const name = ref('') // 실제로 찾는 글자
const total = ref(0) // 그 글자가 들어간 간판 수
const slots = ref(Array(SLOTS).fill(null))
const hits = ref(0)
const lives = ref(LIVES)
const found = ref([])
const bossFx = ref('')
const heroPose = ref('idle')
const line = ref('')
const floats = ref([])

let reals = []
let decoys = []
let uid = 0
const timers = new Set()
const later = (fn, ms) => {
  const t = setTimeout(() => {
    timers.delete(t)
    fn()
  }, ms)
  timers.add(t)
}
const pick = (list) => list[Math.floor(Math.random() * list.length)]
const life = computed(() => Math.max(3.2, 6.2 - hits.value * 0.55))
const dots = computed(() => found.value.map((r) => ({ lng: r.lng, lat: r.lat, color: pastelOf(r.name) })))

// 내 이름 → 그 글자가 든 간판. 너무 적으면 이름 끝 두 글자(보통 이름)로, 그래도 없으면 '수리'로 찾는다
async function gather() {
  const me = (props.word || '수리공').replace(/\s+/g, '')
  const tries = [me]
  // 기본 이름 '수리공'은 앞 두 글자로 줄인다
  if (me.length > 2) tries.push(...(me === '수리공' ? ['수리'] : [me.slice(-2), me.slice(0, 2)]))
  tries.push('수리')
  for (const w of tries) {
    const res = await search(w).catch(() => null)
    if (!res) continue
    const seen = new Set()
    const rows = res.rows.filter((r) => r.exact && r.name.length <= 12 && !seen.has(r.name) && seen.add(r.name))
    if (rows.length >= props.goal + 2 || w === tries.at(-1)) {
      name.value = w
      const all = new Set(res.rows.filter((r) => r.exact).map((r) => r.name + r.region))
      total.value = all.size
      return rows.sort(() => Math.random() - 0.5)
    }
  }
  return []
}

async function more() {
  const rows = await signPool().catch(() => [])
  const chars = [...name.value]
  // 헷갈리게: 내 이름 글자 하나쯤은 들어 있어도 되지만 이름 전체는 없는 간판
  decoys.push(...rows.filter((r) => r.name.length >= 2 && r.name.length <= 10 && !r.name.includes(name.value) && /[가-힣]/.test(r.name)))
  decoys.sort((a, b) => chars.some((c) => b.name.includes(c)) - chars.some((c) => a.name.includes(c)))
}

function spawn(i) {
  if (phase.value !== 'play' || slots.value[i]) return
  const active = slots.value.filter(Boolean)
  const needReal = !active.some((s) => s.real)
  const real = reals.length && (needReal || Math.random() < 0.45)
  let row = real ? reals.shift() : decoys.shift()
  if (!row) row = reals.shift() || decoys.shift()
  if (!row) return
  if (decoys.length < 10) more()
  const s = { id: ++uid, real: !!real && row.name.includes(name.value), row, life: life.value, state: '' }
  slots.value = slots.value.map((v, k) => (k === i ? s : v))
}

function clear(i, delay = 500) {
  later(() => {
    slots.value = slots.value.map((v, k) => (k === i ? null : v))
    later(() => spawn(i), 300 + Math.random() * 700)
  }, delay)
}

function float(text, x, bad) {
  const f = { id: ++uid, text, x, bad }
  floats.value = [...floats.value, f]
  later(() => (floats.value = floats.value.filter((v) => v !== f)), 1000)
}

function read(i) {
  const s = slots.value[i]
  if (phase.value !== 'play' || !s || s.state) return
  s.state = s.real ? 'ok' : 'no'
  slots.value = [...slots.value]
  bossFx.value = ''
  if (s.real) {
    hits.value++
    found.value = [...found.value, s.row]
    sfx.right()
    heroPose.value = 'cheer'
    line.value = pick(OUCH)
    requestAnimationFrame(() => (bossFx.value = 'hit'))
    float(`${s.row.region.split(' ').slice(0, 2).join(' ')}에 불이 켜졌다!`, 22 + i * 28)
    if (hits.value >= props.goal) return later(win, 700)
  } else hurt(`「${name.value}」이(가) 없는 간판이야`, i)
  clear(i)
}

function expire(i) {
  const s = slots.value[i]
  if (phase.value !== 'play' || !s || s.state) return
  s.state = 'gone'
  slots.value = [...slots.value]
  if (s.real) hurt('내 이름 간판을 도둑맞았다', i)
  clear(i, 200)
}

function hurt(msg, i) {
  lives.value--
  sfx.wrong()
  heroPose.value = 'hurt'
  line.value = pick(TAUNT)
  requestAnimationFrame(() => (bossFx.value = 'laugh'))
  float(msg, 22 + i * 28, true)
  if (lives.value <= 0) later(lose, 900)
  else later(() => phase.value === 'play' && (heroPose.value = 'idle'), 600)
}

function win() {
  phase.value = 'win'
  bossFx.value = 'gone'
  heroPose.value = 'cheer'
  line.value = ''
  sfx.win?.()
  window.dispatchEvent(new CustomEvent('game:over', { detail: { game: 'map', score: total.value, word: name.value, won: true } }))
}

function lose() {
  phase.value = 'over'
  slots.value = Array(SLOTS).fill(null)
  sfx.lose?.()
}

async function start() {
  for (const t of timers) clearTimeout(t)
  timers.clear()
  phase.value = 'loading'
  hits.value = 0
  lives.value = LIVES
  found.value = []
  bossFx.value = ''
  heroPose.value = 'idle'
  slots.value = Array(SLOTS).fill(null)
  decoys = []
  const [rows] = await Promise.all([gather(), more()])
  if (!rows.length) {
    phase.value = 'none'
    return
  }
  // 이름 간판이 모자라면 같은 간판이 다시 떠오른다
  reals = rows.length >= props.goal * 2 ? rows : [...rows, ...rows, ...rows]
  line.value = `「${name.value}」? 그 글자는 벌써 내 자루에 있지`
  phase.value = 'play'
  for (let i = 0; i < SLOTS; i++) later(() => spawn(i), 500 + i * 700)
}

function onKey(e) {
  if (phase.value === 'play' && /^[1-3]$/.test(e.key)) {
    e.preventDefault()
    read(Number(e.key) - 1)
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
  for (const t of timers) clearTimeout(t)
})
</script>

<template>
  <div class="sg mp">
    <div class="sg-stars" aria-hidden="true"></div>

    <header class="sg-hud">
      <span class="sg-chip"><Hearts :lives="lives" :max="LIVES" /></span>
      <span class="sg-chip"><small>되찾은 간판</small><b>{{ hits }} / {{ goal }}</b></span>
      <span class="sg-hp">
        <span>{{ bossName }} 체력</span>
        <b><i :style="{ width: `${Math.max(0, 1 - hits / goal) * 100}%` }"></i></b>
      </span>
    </header>

    <div class="mp-body">
      <!-- 왼쪽: 내 이름 글자가 남은 자리마다 불이 켜지는 지도 -->
      <section class="mp-map">
        <p class="mp-map-cap">
          <span>내 이름 글자</span>
          <b class="sg-sign mp-me" :style="{ '--plate': '#ffec27' }">{{ name || '…' }}</b>
        </p>
        <PixelKorea class="mp-korea" :dots="dots" tint="#5a5fa8" :dim="0.8" />
        <p class="mp-map-foot">불 켜진 곳 <b>{{ found.length }}</b></p>
      </section>

      <!-- 오른쪽: 연막 낀 거리, 간판 도둑이 떠 있고 간판 셋이 떠오른다 -->
      <section class="mp-street">
        <div class="mp-fog" aria-hidden="true"></div>
        <div class="mp-boss">
          <p v-if="line && phase === 'play'" :key="line" class="sg-say boss mp-boss-say px-pop">{{ line }}</p>
          <img v-if="boss" :key="bossFx + hits + lives" class="sg-boss mp-ghost" :class="bossFx" :src="boss" alt="" draggable="false" />
        </div>

        <div class="mp-slots">
          <div v-for="(s, i) in slots" :key="i" class="mp-slot">
            <button
              v-if="s"
              :key="s.id"
              class="mp-sign"
              :class="s.state"
              :style="{ '--life': `${s.life}s` }"
              :aria-label="`${i + 1}번 간판 ${s.row.name} 읽기`"
              @click="read(i)"
              @animationend.self="$event.animationName.includes('mp-fade') && expire(i)"
            >
              <span class="sg-sign mp-plate" :style="{ '--plate': pastelOf(s.row.name) }">{{ s.row.name }}</span>
              <small>{{ s.row.region.split(' ').slice(0, 2).join(' ') }}</small>
            </button>
            <span class="sg-key mp-num">{{ i + 1 }}</span>
          </div>
          <span v-for="f in floats" :key="f.id" class="sg-float" :class="{ bad: f.bad }" :style="{ left: `${f.x}%`, top: '18%' }">{{ f.text }}</span>
        </div>

        <div aria-hidden="true"></div>
        <div class="mp-ground">
          <Hero :scale="4" :dir="1" :pose="heroPose" />
          <p class="mp-hint">
            <span v-if="phase === 'loading'">내 이름 글자를 찾는 중…</span>
            <span v-else>「<b>{{ name }}</b>」이(가) 들어간 간판만 <span class="sg-key">1</span><span class="sg-key">2</span><span class="sg-key">3</span> 으로 읽기</span>
          </p>
        </div>
      </section>
    </div>

    <div v-if="phase === 'win'" class="sg-end">
      <h1 class="px-pop">간판 도둑을 물리쳤다!</h1>
      <p>전국 간판 <b>{{ total.toLocaleString() }}곳</b>에 「{{ name }}」 글자가 남아 있었어요</p>
    </div>
    <div v-else-if="phase === 'over'" class="sg-end lost">
      <h1 class="px-shake">도둑이 이름을 훔쳐 갔다…</h1>
      <p>간판 <b>{{ Math.max(0, goal - hits) }}개</b>만 더 읽으면 돼요</p>
      <button class="sg-btn go" @click="start">다시 찾기 ▶</button>
    </div>
    <div v-else-if="phase === 'none'" class="sg-end lost">
      <h1>간판을 못 불러왔어요</h1>
      <button class="sg-btn go" @click="start">다시 해 보기 ▶</button>
    </div>
  </div>
</template>

<style scoped>
.mp {
  background: linear-gradient(#0b0d26, #1b1f4a 70%, #262a5c);
}

.mp-body {
  position: absolute;
  inset: 50px 0 0;
  display: grid;
  grid-template-columns: minmax(220px, 34%) minmax(0, 1fr);
}

.mp-map {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 6px;
  margin: 6px 14px 16px 16px;
  padding: 10px 14px 14px;
  background: #0b1028;
  box-shadow: inset 0 0 0 3px #2b3a78, 0 -3px 0 #fff1e8, 0 3px 0 #fff1e8, -3px 0 0 #fff1e8, 3px 0 0 #fff1e8, 0 9px 0 rgb(0 0 0 / 0.45);
}

.mp-map-cap,
.mp-map-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  color: #ffa300;
  font-size: 13px;
}

.mp-map-foot b {
  color: #ffec27;
  font-weight: 400;
}

.mp-me {
  padding: 4px 12px;
  font-size: 22px;
  font-weight: 400;
}

.mp-korea {
  height: 100%;
}

.mp-street {
  position: relative;
  display: grid;
  grid-template-rows: minmax(130px, 1fr) auto minmax(0, 0.45fr) auto;
  overflow: hidden;
}

/* 도둑의 연막: 천천히 흘러가는 흰 띠 */
.mp-fog {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    repeating-linear-gradient(0deg, transparent 0 34px, rgb(200 210 255 / 0.06) 34px 52px),
    radial-gradient(ellipse at 70% 20%, rgb(190 200 255 / 0.22), transparent 60%);
  animation: mp-drift 8s steps(16) infinite alternate;
}

@keyframes mp-drift {
  to {
    background-position: 0 40px, 30px 0;
  }
}

.mp-boss {
  position: relative;
  display: grid;
  justify-items: end;
  align-items: start;
  padding: 0 6% 0 0;
}

.mp-ghost {
  height: clamp(150px, 30cqh, 260px);
  opacity: 0.88;
  animation: mp-hover 2.4s steps(8) infinite alternate;
}

@keyframes mp-hover {
  to {
    translate: 0 10px;
  }
}

.mp-boss-say {
  position: absolute;
  top: 24%;
  right: calc(6% + clamp(150px, 26cqh, 230px));
  --tail: calc(100% - 30px);
}

.mp-boss-say::after {
  bottom: 10px;
  left: auto;
  right: -12px;
  clip-path: polygon(0 0, 100% 50%, 0 100%);
}

.mp-slots {
  position: relative;
  z-index: 3;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  padding: 0 4%;
}

.mp-slot {
  min-height: 130px;
  display: grid;
  grid-template-rows: 1fr auto;
  justify-items: center;
  align-items: end;
  gap: 6px;
}

.mp-num {
  min-width: 30px;
  height: 30px;
  font-size: 15px;
}

.mp-sign {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 6px;
  border: 0;
  background: none;
  color: #c2c3c7;
  font: inherit;
  cursor: pointer;
  animation:
    mp-rise 0.4s steps(4) both,
    mp-fade var(--life, 6s) linear forwards;
}

.mp-sign small {
  font-size: 12px;
}

@keyframes mp-rise {
  from {
    translate: 0 30px;
    filter: blur(4px);
  }
}

/* 시간이 갈수록 안개에 묻힌다 */
@keyframes mp-fade {
  0%,
  55% {
    opacity: 1;
    filter: none;
  }
  100% {
    opacity: 0.15;
    filter: blur(5px) grayscale(1);
  }
}

.mp-plate {
  max-width: 100%;
  font-size: clamp(18px, 2.4cqi, 28px);
}

.mp-sign:hover .mp-plate,
.mp-sign:focus-visible .mp-plate {
  translate: 0 -4px;
}

.mp-sign.ok,
.mp-sign.no,
.mp-sign.gone {
  pointer-events: none;
  animation: none;
}

.mp-sign.ok .mp-plate {
  box-shadow:
    inset 0 0 0 3px rgb(255 255 255 / 0.4),
    0 0 0 3px #0b1028,
    0 0 0 7px #ffec27,
    0 0 36px #ffec27;
  animation: mp-lit 0.5s steps(4) forwards;
}

@keyframes mp-lit {
  to {
    translate: -60cqi -10px;
    scale: 0.3;
    opacity: 0;
  }
}

.mp-sign.no .mp-plate {
  filter: grayscale(1) brightness(0.6);
  animation: mp-no 0.4s steps(4);
}

@keyframes mp-no {
  25% {
    translate: -6px 0;
  }
  75% {
    translate: 6px 0;
  }
}

.mp-sign.gone {
  opacity: 0;
  transition: opacity 0.2s;
}

.mp-ground {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: flex-end;
  gap: 14px;
  padding: 6px 4% 0;
  background: linear-gradient(transparent 0 calc(100% - 22px), #141b3a calc(100% - 22px));
}

.mp-hint {
  margin: 0 0 30px;
  padding: 5px 12px;
  font-size: 14px;
  color: #fff1e8;
  background: #141b3a;
  box-shadow: 0 -3px 0 #fff1e8, 0 3px 0 #fff1e8, -3px 0 0 #fff1e8, 3px 0 0 #fff1e8, 0 6px 0 rgb(0 0 0 / 0.45);
}

.mp-hint b {
  color: #ffec27;
  font-weight: 400;
}

.mp-hint .sg-key {
  margin: 0 2px;
}
</style>
