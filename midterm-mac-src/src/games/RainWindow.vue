<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { randomNames } from '../data.js'
import { sfx } from '../sound.js'
import { useCountUp } from './countUp.js'
import Leaderboard from './Leaderboard.vue'
import './pixel.css'

// 간판 산성비: 진짜 간판 이름이 비처럼 떨어진다. 이름을 쳐서 부수고, 못 부순 간판은 피한다.
// 바닥에 떨어진 간판은 잠깐 길을 막는 잔해가 되고, 사람 머리에 떨어지면 목숨이 준다
const ICON = new URL('../assets/mac/rain.webp', import.meta.url).href
const LIVES = 3
const BEST_KEY = 'gp-rain-best'
const GROUND = 90 // 땅 윗면(하늘 높이의 %)
const PERSON_W = 44 // 사람 폭(px)
const WALK = 46 // 걷는 속도(하늘 폭 %/초)
const DROP_H = 46 // 떨어지는 간판 높이(px)
const RUBBLE_MS = 7000
const SAFE_MS = 1400
// 맞히면 사람이 신나서 부서진 간판 쪽으로 뛰어가며 폴짝 뛴다
const JUMP_V = 560 // 뛰어오르는 속도(px/초)
const GRAVITY = 2400 // px/초²
const RUN = 1.7 // 걷기보다 몇 배 빨리 뛰는지
const RUN_MAX = 14 // 한 번에 뛰어가는 거리(하늘 폭 %)
const CHEERS = ['야호!', '좋아!', '나이스!', '최고!', '얏호!']
const CONFETTI = ['#ffec27', '#ff77a8', '#29adff', '#00e436', '#ffa300', '#fff1e8']

// embed: 거리 이야기 안에서 열린 판. 규칙 화면 없이 바로 시작하고, goal 개를 부수면 이긴다
const props = defineProps({ embed: Boolean, goal: { type: Number, default: 0 }, boss: { type: String, default: '' }, bossName: { type: String, default: '' } })
const phase = ref('ready')
const bossHit = ref(0)
const banner = ref('')
const drops = ref([])
const rubble = ref([])
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
const sky = ref(null)
const px = ref(50)
const facing = ref(1)
const walking = ref(false)
const hurtUntil = ref(0)
const clock = ref(0)
const finalScore = ref(null)
const hop = ref(0) // 땅에서 뜬 높이(px)
const cheer = ref(null)
const confetti = ref([])

const size = { w: 720, h: 520 }
const held = new Set()
let pool = []
let raf = 0
let last = 0
let started = 0
let nextDrop = 0
let id = 0
let ro = null
let vy = 0
let hopsLeft = 0
let runTo = null
let partyUntil = 0

const cpm = computed(() => {
  const min = (clock.value - started) / 60000
  return phase.value === 'play' || phase.value === 'over' ? Math.round(chars.value / Math.max(min, 0.1)) : 0
})
const personHalf = () => (PERSON_W / 2 / size.w) * 100
const hurt = computed(() => clock.value < hurtUntil.value)
const party = computed(() => clock.value < partyUntil)
// 끝 화면 점수는 또각또각 올라간다
const shownScore = useCountUp(() => finalScore.value, { ms: 800, tick: () => sfx.tick() })

// 간판 반폭(%). 글자 수로 어림한다(떨어지는 이름은 20px 픽셀 글꼴)
function halfOf(d) {
  const label = d.gold ? 6 : d.heart ? 5 : 0
  const w = Math.max(d.name.length * 20.5, label * 12.5) + 30
  return (w / 2 / size.w) * 100
}

// 단계가 오를수록 더 긴 이름이 더 빨리 내린다
function nextName() {
  const min = Math.min(2 + level.value, 8)
  const max = 5 + level.value * 2
  const fit = pool.filter((n) => n.name.length >= min && n.name.length <= max && /^[가-힣A-Za-z0-9]+$/.test(n.name))
  const list = fit.length ? fit : pool
  return list.splice(Math.floor(Math.random() * list.length), 1)[0] || { name: '김밥천국', count: 1 }
}

function spawn() {
  const n = nextName()
  pool = pool.filter((p) => p !== n)
  const r = Math.random()
  const d = {
    id: ++id,
    ...n,
    y: -14,
    // 초마다 하늘 높이의 몇 %를 내려오는지
    speed: (6 + level.value * 1.5) * (0.8 + Math.random() * 0.4),
    gold: r < 0.07,
    heart: r >= 0.07 && r < 0.11 && lives.value < LIVES,
    hw: 0,
    x: 50,
  }
  d.hw = halfOf(d)
  // 가끔은 사람 머리 위를 노린다
  const aim = Math.random() < 0.35
  const x = aim ? px.value + (Math.random() - 0.5) * 16 : d.hw + 2 + Math.random() * (96 - d.hw * 2)
  d.x = Math.min(Math.max(x, d.hw + 1), 99 - d.hw)
  drops.value.push(d)
}

async function start() {
  phase.value = 'loading'
  pool = await randomNames(10)
  drops.value = []
  rubble.value = []
  pops.value = []
  score.value = 0
  lives.value = LIVES
  level.value = 1
  cleared.value = 0
  chars.value = 0
  combo.value = 0
  typed.value = ''
  finalScore.value = null
  px.value = 50
  hurtUntil.value = 0
  calm()
  held.clear()
  phase.value = 'play'
  started = performance.now()
  last = started
  clock.value = started
  nextDrop = started + 400
  raf = requestAnimationFrame(tick)
  await nextTick()
  input.value?.focus()
}

// 잔해에 막히면 그 앞에서 멈춘다
function move(dx) {
  const half = personHalf()
  let next = Math.min(Math.max(px.value + dx, half), 100 - half)
  for (const r of rubble.value) {
    const left = r.x - r.hw
    const right = r.x + r.hw
    if (dx > 0 && px.value + half <= left + 0.01 && next + half > left) next = left - half
    if (dx < 0 && px.value - half >= right - 0.01 && next - half < right) next = right + half
  }
  px.value = next
}

function tick(now) {
  const dt = Math.min(now - last, 60) / 1000
  last = now
  clock.value = now

  const dir = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0)
  walking.value = dir !== 0
  if (dir) {
    // 직접 움직이면 신나게 뛰어가던 것은 멈춘다(뛰어오르기는 이어진다)
    runTo = null
    facing.value = dir
    move(dir * WALK * dt)
  } else if (runTo != null && now < partyUntil) {
    const gap = runTo - px.value
    const step = Math.sign(gap) * Math.min(Math.abs(gap), WALK * RUN * dt)
    const before = px.value
    if (step) {
      facing.value = Math.sign(step)
      move(step)
    }
    // 잔해에 막혔거나 다 왔으면 그 자리에서 뛴다
    if (Math.abs(runTo - px.value) < 0.3 || px.value === before) runTo = null
    else walking.value = true
  }
  if (hop.value > 0 || vy) {
    vy -= GRAVITY * dt
    hop.value = Math.max(0, hop.value + vy * dt)
    if (hop.value === 0) vy = hopsLeft-- > 0 ? JUMP_V * 0.8 : 0
  }

  if (now >= nextDrop) {
    spawn()
    nextDrop = now + Math.max(2400 - level.value * 230, 850)
  }
  for (const d of drops.value) d.y += d.speed * dt

  const bottom = GROUND - (DROP_H / size.h) * 100
  const landed = drops.value.filter((d) => d.y >= bottom)
  if (landed.length) {
    drops.value = drops.value.filter((d) => d.y < bottom)
    for (const d of landed) land(d, now)
    if (lives.value <= 0) return over()
  }
  rubble.value = rubble.value.filter((r) => r.until > now)
  if (pool.length < 30) randomNames(4).then((more) => pool.push(...more))
  raf = requestAnimationFrame(tick)
}

const overPerson = (d) => Math.abs(d.x - px.value) < d.hw + personHalf() * 0.8

function land(d, now) {
  if (overPerson(d)) {
    // 하트는 받으면 목숨 하나
    if (d.heart) {
      lives.value = Math.min(LIVES, lives.value + 1)
      pop(d, '목숨 +1', GROUND - 14)
      sfx.lifeUp()
      return
    }
    if (now < hurtUntil.value) {
      pop(d, '휴!', GROUND - 14)
      return
    }
    lives.value--
    combo.value = 0
    hurtUntil.value = now + SAFE_MS
    shake.value = true
    setTimeout(() => (shake.value = false), 320)
    pop(d, '쿵!', GROUND - 14)
    sfx.hurt()
    return
  }
  if (d.heart) return
  // 땅에 떨어진 간판은 잠깐 길을 막는다. 이름을 치면 치울 수 있다
  rubble.value.push({ id: d.id, name: d.name, x: d.x, hw: d.hw, until: now + RUBBLE_MS, tilt: (Math.random() - 0.5) * 14 })
  combo.value = 0
  sfx.thud()
}

function over() {
  phase.value = 'over'
  sfx.lose()
  cancelAnimationFrame(raf)
  held.clear()
  walking.value = false
  calm()
  finalScore.value = score.value
  if (score.value > best.value) {
    best.value = score.value
    localStorage.setItem(BEST_KEY, String(best.value))
  }
}

function pop(d, text, y = d.y) {
  const p = { id: `${d.id}-${Math.random()}`, x: d.x, y, text }
  pops.value.push(p)
  setTimeout(() => (pops.value = pops.value.filter((q) => q !== p)), 750)
}

function calm() {
  hop.value = 0
  vy = 0
  hopsLeft = 0
  runTo = null
  partyUntil = 0
  cheer.value = null
  confetti.value = []
}

// 콤보가 쌓일수록 더 여러 번, 노란 간판이면 크게 뛴다
function celebrate(d) {
  const now = performance.now()
  const big = d.gold || combo.value >= 5
  partyUntil = now + 900 + Math.min(combo.value, 6) * 120 + (d.gold ? 600 : 0)
  if (hop.value === 0) vy = JUMP_V * (big ? 1.15 : 1)
  hopsLeft = Math.min(1 + Math.floor(combo.value / 3), 3) + (d.gold ? 1 : 0)
  const gap = d.x - px.value
  runTo = Math.abs(gap) < 3 ? px.value + (Math.random() < 0.5 ? -1 : 1) * 8 : px.value + Math.sign(gap) * Math.min(Math.abs(gap), RUN_MAX)
  const word = combo.value >= 3 ? `${combo.value}콤보!` : d.gold ? '싹쓸이!' : CHEERS[(Math.random() * CHEERS.length) | 0]
  cheer.value = { id: now, text: word }
  setTimeout(() => cheer.value?.id === now && (cheer.value = null), 900)
  const bits = Array.from({ length: big ? 18 : 10 }, (_, n) => ({
    id: `${now}-${n}`,
    color: CONFETTI[n % CONFETTI.length],
    dx: (Math.random() - 0.5) * 120,
    dy: -40 - Math.random() * 70,
  }))
  confetti.value = [...confetti.value.slice(-30), ...bits]
  setTimeout(() => (confetti.value = confetti.value.filter((b) => !bits.includes(b))), 800)
}

function clear(d) {
  drops.value = drops.value.filter((q) => q !== d)
  combo.value++
  cleared.value++
  chars.value += d.name.length
  const gain = d.name.length * 10 * level.value + combo.value * 5
  score.value += gain
  pop(d, combo.value > 2 ? `+${gain} · ${combo.value}콤보` : `+${gain}`)
  if (d.gold) sfx.blast()
  else if (d.heart) sfx.lifeUp()
  else sfx.combo(combo.value)
  if (d.heart) lives.value = Math.min(LIVES, lives.value + 1)
  celebrate(d)
  // 노란 간판은 하늘과 땅의 간판을 모두 지운다
  if (d.gold) {
    for (const q of drops.value) {
      pop(q, '펑!')
      score.value += q.name.length * 5
      cleared.value++
    }
    drops.value = []
    rubble.value = []
  }
  if (cleared.value >= level.value * 6) {
    level.value++
    sfx.levelUp()
  }
  if (props.goal) {
    bossHit.value = performance.now()
    if (cleared.value >= props.goal) win()
  }
}

// 보스 판: 정한 만큼 부수면 구름이 걷힌다
function win() {
  phase.value = 'win'
  cancelAnimationFrame(raf)
  held.clear()
  walking.value = false
  drops.value = []
  calm()
  finalScore.value = score.value
  sfx.win?.()
  window.dispatchEvent(new CustomEvent('game:over', { detail: { game: 'rain', score: score.value, won: true } }))
}

function clearRubble(r) {
  rubble.value = rubble.value.filter((q) => q !== r)
  chars.value += r.name.length
  score.value += r.name.length * 3
  pop({ id: r.id, x: r.x }, `치움 +${r.name.length * 3}`, GROUND - 10)
  sfx.pop()
}

function hitWord(word) {
  const d = drops.value.filter((q) => q.name === word).sort((a, b) => b.y - a.y)[0]
  if (d) return clear(d), true
  const r = rubble.value.find((q) => q.name === word)
  if (r) return clearRubble(r), true
  return false
}

// 한글 입력기가 조합을 끝낸 뒤에만 비교한다
function check(e) {
  sfx.key()
  typed.value = e.target.value
  if (e.isComposing) return
  if (hitWord(typed.value.trim())) {
    typed.value = ''
    e.target.value = ''
  }
}

function enter(e) {
  if (e.isComposing) return
  const word = e.target.value.trim()
  if (!word) return
  if (!hitWord(word)) {
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

// 방향키는 입력칸 안에서도 사람을 움직인다. A/D 는 입력칸 밖에서만(영문 간판을 칠 수 있게)
const KEYS = { ArrowLeft: 'left', ArrowRight: 'right', a: 'left', A: 'left', d: 'right', D: 'right' }
function keydown(e) {
  if (phase.value !== 'play') return
  const k = KEYS[e.key]
  if (!k) return
  if (e.key.length === 1 && e.target === input.value) return
  e.preventDefault()
  held.add(k)
}
function keyup(e) {
  const k = KEYS[e.key]
  if (k) held.delete(k)
}
function blur() {
  held.clear()
}
const press = (k) => phase.value === 'play' && held.add(k)
const release = (k) => held.delete(k)

const shadowStyle = (d) => {
  const t = Math.min(Math.max((d.y + 14) / (GROUND + 4), 0), 1)
  return {
    left: `${d.x}%`,
    width: `${d.hw * 2 * (0.35 + 0.65 * t)}%`,
    opacity: 0.12 + 0.4 * t,
  }
}

onMounted(() => {
  window.addEventListener('keydown', keydown)
  window.addEventListener('keyup', keyup)
  window.addEventListener('blur', blur)
  ro = new ResizeObserver(([e]) => {
    size.w = e.contentRect.width || size.w
    size.h = e.contentRect.height || size.h
  })
  if (sky.value) ro.observe(sky.value)
  if (props.embed) {
    banner.value = props.bossName ? `${props.bossName}이 간판을 퍼붓는다!` : '간판이 쏟아진다!'
    setTimeout(() => (banner.value = ''), 1600)
    start()
  }
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('keydown', keydown)
  window.removeEventListener('keyup', keyup)
  window.removeEventListener('blur', blur)
  ro?.disconnect()
})
</script>

<template>
  <div class="rain-pc px" :class="{ embed }">
    <div v-if="!embed" class="rain-program">
      <img :src="ICON" alt="" draggable="false" />
      <span>간판 산성비 · 타자연습</span>
      <span class="rain-program-hint">치고, 피하고!</span>
    </div>

    <div class="rain-hud">
      <span class="rain-stat rain-score"><small>점수</small><b>{{ score.toLocaleString() }}</b></span>
      <span class="rain-stat"><small>단계</small><b>{{ level }}</b></span>
      <span class="rain-stat"><small>타수</small><b>{{ cpm }} <span>자/분</span></b></span>
      <span v-if="goal" class="rain-stat rain-hp"><small>{{ bossName || '보스' }} 체력</small><b><i :style="{ width: `${Math.max(0, 1 - cleared / goal) * 100}%` }"></i></b></span>
      <span v-else class="rain-stat"><small>최고 기록</small><b>{{ best.toLocaleString() }}</b></span>
      <span class="rain-stat rain-lives" :aria-label="`목숨 ${lives}`">
        <small>남은 목숨</small>
        <span class="rain-hearts">
          <svg v-for="n in LIVES" :key="n" :class="{ off: n > lives }" viewBox="0 0 7 6" shape-rendering="crispEdges" aria-hidden="true">
            <path d="M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z" />
          </svg>
        </span>
      </span>
    </div>

    <div ref="sky" class="rain-sky" :class="{ shake, resting: phase !== 'play' }" @click="input?.focus()">
      <div class="rain-stars" aria-hidden="true"></div>
      <div class="rain-moon" aria-hidden="true"></div>
      <img v-if="boss" :key="bossHit" class="rain-boss" :class="{ hit: bossHit, gone: phase === 'win' }" :src="boss" alt="" draggable="false" />
      <span v-if="banner" class="rain-banner px-pop">{{ banner }}</span>
      <div class="rain-city" aria-hidden="true"></div>

      <span v-if="combo > 1 && phase === 'play'" :key="combo" class="rain-combo px-text">{{ combo }} 콤보</span>

      <!-- 떨어질 자리: 사람 위에 떨어질 간판은 그림자가 붉다 -->
      <span
        v-for="d in drops"
        :key="`s${d.id}`"
        class="rain-shadow"
        :class="{ danger: !d.heart && overPerson(d), good: d.heart }"
        :style="shadowStyle(d)"
      ></span>

      <div
        v-for="d in drops"
        :key="d.id"
        class="rain-drop"
        :class="{ aim: d.id === target, gold: d.gold, heart: d.heart }"
        :style="{ left: `${d.x}%`, top: `${d.y}%` }"
      >
        <span>{{ d.name }}</span>
        <small>{{ d.gold ? '전부 지우기' : d.heart ? '♥ 목숨 +1' : `전국 ${d.count}곳` }}</small>
      </div>

      <div class="rain-ground" aria-hidden="true">
        <span v-for="n in LIVES" :key="n" :class="{ depleted: n > lives }"></span>
      </div>

      <div
        v-for="r in rubble"
        :key="`r${r.id}`"
        class="rain-rubble"
        :class="{ fading: r.until - clock < 1000 }"
        :style="{ left: `${r.x}%`, width: `${r.hw * 2}%`, '--tilt': `${r.tilt}deg` }"
      >
        {{ r.name }}
      </div>

      <div
        class="rain-person"
        :class="{ walking, hurt, party, air: hop > 0, left: facing < 0 }"
        :style="{ left: `${px}%`, '--hop': `${-hop}px` }"
        aria-hidden="true"
      >
        <span v-if="cheer" :key="cheer.id" class="rain-cheer px-outline">{{ cheer.text }}</span>
        <i v-for="b in confetti" :key="b.id" class="rain-confetti" :style="{ background: b.color, '--dx': `${b.dx}px`, '--dy': `${b.dy}px` }"></i>
        <svg viewBox="0 0 13 20" shape-rendering="crispEdges">
          <rect x="4" y="0" width="5" height="2" fill="#3a2a1e" />
          <rect x="3" y="1" width="1" height="3" fill="#3a2a1e" />
          <rect x="4" y="2" width="5" height="4" fill="#ffd2a6" />
          <rect x="7" y="3" width="1" height="1" fill="#1d1d1f" />
          <rect x="3" y="6" width="7" height="6" fill="#0a84ff" />
          <rect x="5" y="6" width="3" height="1" fill="#fff" />
          <g class="arm-a"><rect x="2" y="7" width="1" height="4" fill="#ffd2a6" /></g>
          <g class="arm-b"><rect x="10" y="7" width="1" height="4" fill="#ffd2a6" /></g>
          <g class="cheer-up">
            <rect x="2" y="3" width="1" height="4" fill="#ffd2a6" />
            <rect x="10" y="3" width="1" height="4" fill="#ffd2a6" />
            <rect x="6" y="5" width="2" height="1" fill="#7e2553" />
          </g>
          <rect x="4" y="12" width="5" height="2" fill="#2c3e66" />
          <g class="leg-a"><rect x="4" y="14" width="2" height="5" fill="#2c3e66" /><rect x="3" y="19" width="3" height="1" fill="#1d1d1f" /></g>
          <g class="leg-b"><rect x="7" y="14" width="2" height="5" fill="#2c3e66" /><rect x="7" y="19" width="3" height="1" fill="#1d1d1f" /></g>
        </svg>
      </div>

      <span v-for="p in pops" :key="`p${p.id}`" class="rain-pop px-text" :style="{ left: `${p.x}%`, top: `${p.y}%` }">{{ p.text }}</span>

      <div v-if="phase === 'play'" class="rain-pad" aria-hidden="true">
        <button class="rain-pad-btn" @pointerdown.prevent="press('left')" @pointerup="release('left')" @pointerleave="release('left')" @pointercancel="release('left')">◀</button>
        <button class="rain-pad-btn" @pointerdown.prevent="press('right')" @pointerup="release('right')" @pointerleave="release('right')" @pointercancel="release('right')">▶</button>
      </div>

      <div v-if="embed && phase === 'win'" class="rain-poster rain-win">
        <h1 class="px-pop">구름이 걷혔다!</h1>
        <p>{{ cleared }}개를 부수고 {{ shownScore.toLocaleString() }}점</p>
      </div>
      <div v-else-if="embed && phase === 'over'" class="rain-poster rain-win lost">
        <h1 class="px-shake">우산이 부서졌어요</h1>
        <p>{{ bossName || '구름' }} 체력이 {{ Math.max(0, goal - cleared) }}만큼 남았어요</p>
        <button class="rain-start" @click.stop="start">다시 맞서기 ▶</button>
      </div>
      <div v-else-if="phase !== 'play' && !embed" class="rain-poster" :class="{ 'rain-dialog px-shake': phase === 'over' }">
        <template v-if="phase === 'over'">
          <div class="rain-dialog-bar">
            <span aria-hidden="true">▤</span>
            <strong>간판 산성비 · 게임 끝</strong>
          </div>
          <div class="rain-dialog-body">
            <header class="rain-result-header">
              <p class="rain-eyebrow">목숨을 다 썼어요</p>
              <h1 class="rain-end-title px-pop">GAME OVER</h1>
              <p class="rain-result-score">{{ shownScore.toLocaleString() }}<small>점</small></p>
            </header>
            <dl class="rain-result-stats">
              <div><dt>부순 간판</dt><dd>{{ cleared }}개</dd></div>
              <div><dt>도달 단계</dt><dd>{{ level }}단계</dd></div>
              <div><dt>최고 기록</dt><dd>{{ best.toLocaleString() }}점</dd></div>
            </dl>
            <Leaderboard class="rain-records" game="rain" :score="finalScore" :limit="5" />
          </div>
        </template>
        <template v-else>
          <header class="rain-logo">
            <p class="rain-eyebrow">전국의 진짜 간판으로 타자연습</p>
            <h1>간판 <em>산성비</em></h1>
            <p class="rain-logo-sub">내리는 이름을 치고, 쏟아지는 간판을 피하자!</p>
            <span class="rain-ready-state">{{ phase === 'loading' ? '간판 모으는 중' : `목숨 ${LIVES}개로 시작` }}</span>
          </header>
          <section class="rain-rules" aria-label="게임 규칙">
            <h2>규칙</h2>
            <div class="rain-rules-copy">
              <p><b>입력</b><span>떨어지는 간판 이름을 똑같이 치면 부서져요. 마지막 글자까지 치면 바로 사라지고, Enter 로도 확인해요.</span></p>
              <p><b>← →</b><span>간판에 맞으면 목숨이 하나 줄어요. 바닥에 떨어진 잔해는 길을 막지만, 이름을 치면 치울 수 있어요.</span></p>
              <p class="rain-special"><span class="rain-rule-gold">노란 간판: 하늘과 바닥의 간판을 한꺼번에 치워요</span><span class="rain-rule-heart">하트 간판: 이름을 치거나 몸으로 받으면 목숨 +1</span></p>
            </div>
          </section>
          <Leaderboard class="rain-records" game="rain" :limit="3" />
        </template>
        <div class="rain-actions">
          <button class="rain-start" :disabled="phase === 'loading'" @click.stop="start">{{ phase === 'over' ? '한 판 더' : phase === 'loading' ? '간판 모으는 중…' : '시작' }} <span aria-hidden="true">▶</span></button>
        </div>
      </div>
    </div>

    <div class="rain-input-panel">
      <label class="rain-input-label">
        <span>간판 입력</span>
        <input
          ref="input"
          type="text"
          class="rain-type"
          :disabled="phase !== 'play'"
          placeholder="간판 이름을 입력하세요"
          autocomplete="off"
          spellcheck="false"
          @input="check"
          @keydown.enter="enter"
        />
      </label>
      <p class="rain-input-help"><span><kbd>Enter</kbd> 입력 확인</span><span><kbd>←</kbd> <kbd>→</kbd> 이동</span></p>
    </div>
  </div>
</template>

<style scoped>
.rain-pc {
  --rain-navy: #080b36;
  --rain-panel: #c0c0c0;
  --rain-cyan: #72f4ff;
  --rain-yellow: #ffff55;
  --rain-pink: #ff83ee;
  --rain-edge: inset 1px 1px #fff, inset -1px -1px #181818, inset 2px 2px #dfdfdf, inset -2px -2px #808080;
  --rain-inset: inset 1px 1px #808080, inset -1px -1px #fff, inset 2px 2px #181818, inset -2px -2px #dfdfdf;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  padding: 10px;
  color: #161616;
  background: var(--rain-panel);
  box-shadow: var(--rain-edge);
  font-size: 12px;
  line-height: 1.6;
  font-variant-numeric: tabular-nums;
  container-type: inline-size;
}

/* 거리 이야기 안: 창 테두리 없이 화면을 꽉 채운다 */
.rain-pc.embed {
  height: 100%;
  grid-template-rows: auto minmax(0, 1fr) auto;
  padding: 8px;
  background: #0d1030;
  box-shadow: none;
  color: #e9ecff;
}

.rain-pc.embed .rain-sky {
  height: 100%;
  min-height: 0;
}

.rain-hp b {
  position: relative;
  display: block;
  height: 14px;
  margin-top: 4px;
  background: #3a0d1a;
  box-shadow: inset 0 0 0 2px #180410;
}

.rain-hp i {
  position: absolute;
  inset: 2px auto 2px 2px;
  max-width: calc(100% - 4px);
  background: linear-gradient(#ff7a8a, #e03050);
  transition: width 0.25s steps(6);
}

.rain-boss {
  position: absolute;
  top: 2%;
  left: 50%;
  z-index: 2;
  width: min(180px, 26%);
  image-rendering: pixelated;
  translate: -50% 0;
  animation: rain-boss-drift 7s ease-in-out infinite alternate;
  pointer-events: none;
}

.rain-boss.hit {
  animation: rain-boss-drift 7s ease-in-out infinite alternate, rain-boss-hit 0.3s steps(3);
}

.rain-boss.gone {
  animation: rain-boss-gone 1.2s ease-in forwards;
}

@keyframes rain-boss-drift {
  from { left: 22%; }
  to { left: 78%; }
}

@keyframes rain-boss-hit {
  0%, 100% { filter: none; }
  50% { filter: brightness(2.4) saturate(0); transform: translateX(6px); }
}

@keyframes rain-boss-gone {
  to { opacity: 0; transform: translateY(-40px) scale(1.4); filter: blur(4px); }
}

.rain-banner {
  position: absolute;
  top: 38%;
  left: 50%;
  z-index: 6;
  padding: 8px 16px;
  translate: -50% 0;
  background: #0d1030;
  box-shadow: 0 0 0 3px #ffec27;
  color: #ffec27;
  font-size: 20px;
  white-space: nowrap;
}

.rain-poster.rain-win {
  position: absolute;
  inset: 0;
  width: auto;
  margin: 0;
  padding: 0;
  display: grid;
  place-content: center;
  gap: 8px;
  text-align: center;
  color: #fff;
  background: rgb(8 11 54 / 0.72);
}

.rain-win h1 {
  margin: 0;
  color: #ffec27;
  font-size: clamp(28px, 6cqw, 52px);
}

.rain-win.lost h1 {
  color: #ff83ee;
}

.rain-win p {
  margin: 0;
  font-size: 15px;
}

.rain-pc,
.rain-pc :deep(*) {
  box-sizing: border-box;
}

.rain-program {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  padding: 2px 4px;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.rain-program img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.rain-program-hint {
  margin-left: auto;
  color: #454545;
  font-weight: 400;
}

/* 회색 계기판과 남색 숫자창 */
.rain-hud {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(76px, 1fr);
  gap: 6px;
  padding: 8px;
  box-shadow: var(--rain-edge);
}

.rain-stat {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  gap: 4px;
  min-width: 0;
  text-align: center;
}

.rain-stat small {
  font-size: 12px;
  line-height: 1.5;
}

.rain-stat b,
.rain-hearts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 2px 4px;
  min-height: 34px;
  padding: 5px 4px;
  color: var(--rain-cyan);
  background: #090d27;
  box-shadow: var(--rain-inset);
  overflow-wrap: anywhere;
}

.rain-stat b {
  display: block;
  font-size: 12px;
  line-height: 24px;
}

.rain-score b {
  font-size: 24px;
  color: var(--rain-yellow);
}

.rain-stat b span {
  font-size: 12px;
  color: #c8d5ef;
}

.rain-hearts {
  gap: 5px;
}

.rain-hearts svg {
  width: 14px;
  height: 12px;
  fill: var(--rain-pink);
}

.rain-hearts svg.off {
  fill: #454864;
}

.rain-sky {
  position: relative;
  height: min(560px, 64dvh);
  min-height: 320px;
  overflow: hidden;
  border: 2px solid #080817;
  background: var(--rain-navy);
  box-shadow: 0 0 0 1px #808080, 1px 1px 0 1px #fff;
  touch-action: none;
}

.rain-sky.resting {
  height: auto;
  min-height: 0;
  touch-action: auto;
}

.rain-sky.shake {
  animation: rain-shake 0.32s steps(2);
}

.rain-stars {
  position: absolute;
  inset: 0 0 10%;
  opacity: 0.55;
  background:
    radial-gradient(circle at 9% 12%, #a5b5e6 0 1px, transparent 1px),
    radial-gradient(circle at 28% 29%, #a5b5e6 0 1px, transparent 1px),
    radial-gradient(circle at 65% 14%, #a5b5e6 0 1px, transparent 1px),
    radial-gradient(circle at 90% 40%, #a5b5e6 0 1px, transparent 1px),
    radial-gradient(circle at 49% 56%, #a5b5e6 0 1px, transparent 1px);
  background-size: 260px 210px;
  pointer-events: none;
}

.rain-moon {
  position: absolute;
  top: 24px;
  right: 24px;
  width: 24px;
  height: 28px;
  border: solid #a2aed3;
  border-width: 0 0 4px 8px;
  box-shadow: -4px -4px 0 -2px #a2aed3;
  opacity: 0.45;
  pointer-events: none;
}

.rain-city {
  position: absolute;
  inset: auto 0 10%;
  height: 17%;
  background:
    linear-gradient(#141845, #141845) 2% 100% / 12% 65% no-repeat,
    linear-gradient(#171c4d, #171c4d) 19% 100% / 9% 95% no-repeat,
    linear-gradient(#141845, #141845) 33% 100% / 16% 55% no-repeat,
    linear-gradient(#171c4d, #171c4d) 59% 100% / 13% 80% no-repeat,
    linear-gradient(#141845, #141845) 78% 100% / 12% 60% no-repeat,
    linear-gradient(#171c4d, #171c4d) 98% 100% / 8% 100% no-repeat;
  pointer-events: none;
}

.rain-combo {
  position: absolute;
  top: 12px;
  left: 50%;
  z-index: 3;
  padding: 2px 10px;
  color: var(--rain-yellow);
  font-size: 18px;
  transform: translateX(-50%);
  animation: rain-bump 0.25s steps(2);
}

/* 글자만 떨어지는 산성비: 굵은 픽셀 글꼴에 2px 검은 외곽선, 아래로 한 칸 그늘 */
.rain-drop {
  position: absolute;
  z-index: 2;
  display: grid;
  justify-items: center;
  gap: 0;
  max-width: calc(100% - 8px);
  min-height: 46px;
  padding: 0 14px;
  color: var(--rain-cyan);
  font-family: var(--game-font);
  text-align: center;
  -webkit-font-smoothing: none;
  transform: translateX(-50%);
  will-change: top;
}

.rain-drop span {
  font-size: 20px;
  line-height: 28px;
  letter-spacing: 0;
  white-space: nowrap;
  text-shadow:
    2px 0 0 #000, -2px 0 0 #000, 0 2px 0 #000, 0 -2px 0 #000,
    2px 2px 0 #000, -2px 2px 0 #000, 2px -2px 0 #000, -2px -2px 0 #000,
    0 4px 0 #000;
}

.rain-drop small {
  font-size: 12px;
  line-height: 16px;
  color: #d6ddff;
  overflow-wrap: anywhere;
  text-shadow: 1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000, 1px 1px 0 #000;
}

.rain-drop.gold,
.rain-drop.gold small {
  color: var(--rain-yellow);
}

.rain-drop.heart,
.rain-drop.heart small {
  color: var(--rain-pink);
}

.rain-drop.aim span {
  text-decoration: underline;
  text-decoration-thickness: 3px;
  text-underline-offset: 6px;
}

.rain-drop.aim:not(.gold):not(.heart) span {
  color: #fff;
}

.rain-shadow {
  position: absolute;
  bottom: calc(10% - 5px);
  z-index: 1;
  height: 6px;
  background: var(--rain-cyan);
  transform: translateX(-50%);
  pointer-events: none;
}

.rain-shadow.danger {
  background: #ff6666;
}

.rain-shadow.good {
  background: var(--rain-pink);
}

/* 잔디 세 칸은 남은 목숨과 함께 어두워진다 */
.rain-ground {
  position: absolute;
  inset: auto 0 0;
  display: flex;
  height: 10%;
}

.rain-ground span {
  flex: 1;
  border-top: 4px solid #78cf60;
  border-right: 2px solid #080b36;
  background:
    repeating-linear-gradient(0deg, transparent 0 13px, #322448 13px 15px),
    repeating-linear-gradient(90deg, transparent 0 30px, #322448 30px 32px),
    #765044;
  box-shadow: inset 0 4px #367d48;
}

.rain-ground span:last-child {
  border-right: 0;
}

.rain-ground span.depleted {
  border-top-color: #4d5864;
  background-color: #38394b;
  box-shadow: inset 0 4px #292e44;
}

.rain-rubble {
  position: absolute;
  bottom: 10%;
  z-index: 2;
  display: grid;
  place-items: center;
  height: 22px;
  padding: 0 6px;
  overflow: hidden;
  border: 1px solid #8d90aa;
  color: #e0e2ef;
  background: repeating-linear-gradient(135deg, #363953 0 6px, #252940 6px 12px);
  font-family: var(--game-font);
  font-size: 13px;
  white-space: nowrap;
  transform: translateX(-50%) rotate(var(--tilt));
  transform-origin: 50% 100%;
  animation: rain-thud 0.25s steps(2);
  transition: opacity 0.5s;
}

.rain-rubble.fading {
  opacity: 0.35;
}

.rain-person {
  position: absolute;
  bottom: 10%;
  z-index: 3;
  width: 44px;
  height: 68px;
  transform: translateX(-50%);
}

.rain-person svg {
  display: block;
  width: 100%;
  height: 100%;
}

.rain-person.left svg {
  scale: -1 1;
}

.rain-person.walking svg {
  animation: rain-step 0.32s steps(2) infinite;
}

.rain-person.walking .leg-a,
.rain-person.walking .arm-b {
  animation: rain-step 0.32s steps(1) infinite;
}

.rain-person.walking .leg-b,
.rain-person.walking .arm-a {
  animation: rain-step 0.32s steps(1) infinite reverse;
}

.rain-person.hurt {
  animation: rain-blink 0.14s steps(1) infinite;
}

/* 신날 때: 두 팔을 번쩍, 공중에서는 살짝 기울어진다 */
.rain-person {
  translate: 0 var(--hop, 0);
}

.rain-person .cheer-up {
  display: none;
}

.rain-person.party .cheer-up {
  display: inline;
}

.rain-person.party .arm-a,
.rain-person.party .arm-b {
  display: none;
}

.rain-person.air svg {
  rotate: 8deg;
}

.rain-person.air.left svg {
  rotate: -8deg;
}

.rain-cheer {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  font-family: var(--game-font);
  font-size: 14px;
  color: var(--px-yellow);
  white-space: nowrap;
  transform: translateX(-50%);
  animation: rain-cheer 0.9s steps(6) forwards;
}

.rain-confetti {
  position: absolute;
  left: 50%;
  top: 30%;
  width: 6px;
  height: 6px;
  animation: rain-confetti 0.8s cubic-bezier(0.2, 0.7, 0.4, 1) forwards;
}

.rain-person.hurt svg {
  filter: drop-shadow(2px 0 #ff6666) drop-shadow(-2px 0 #ff6666);
}

.rain-pop {
  position: absolute;
  z-index: 4;
  max-width: 100%;
  font-size: 16px;
  color: var(--rain-yellow);
  text-align: center;
  overflow-wrap: anywhere;
  transform: translateX(-50%);
  pointer-events: none;
  animation: rain-up 0.75s steps(8) forwards;
}

/* 손가락 조작 영역은 화면 양쪽 절반 */
.rain-pad {
  display: none;
  position: absolute;
  inset: 0;
  z-index: 4;
}

.mac-win .rain-pc .rain-pad-btn {
  flex: 1;
  display: flex;
  align-items: flex-end;
  height: 100%;
  padding: 0 18px 14px;
  border: 0;
  border-radius: 0;
  color: #fff;
  background: transparent;
  box-shadow: none;
  font: inherit;
  font-size: 24px;
  touch-action: none;
}

.mac-win .rain-pc .rain-pad-btn:last-child {
  justify-content: flex-end;
}

.mac-win .rain-pc .rain-pad-btn:active {
  background: #ffffff14;
}

.rain-poster {
  position: relative;
  z-index: 5;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
  width: min(540px, calc(100% - 32px));
  margin: 0 auto;
  padding: 28px 0 80px;
  overflow-wrap: anywhere;
}

.rain-logo,
.rain-result-header {
  text-align: center;
}

.rain-eyebrow {
  margin: 0;
  color: var(--rain-cyan);
  font-size: 12px;
}

.rain-logo h1 {
  margin: 12px 0;
  color: #fff;
  font-size: 48px;
  line-height: 1.25;
  letter-spacing: 0;
  text-shadow: 3px 3px #3c4eaa, 5px 5px #000;
}

.rain-logo em {
  color: var(--rain-yellow);
  font-style: normal;
}

.rain-logo-sub {
  margin: 0;
  color: #d6ddff;
}

.rain-ready-state {
  display: inline-block;
  margin-top: 12px;
  padding: 2px 12px;
  color: var(--rain-cyan);
  border: 1px dashed #626b9b;
}

.rain-rules {
  min-width: 0;
  padding: 3px;
  color: #161616;
  background: var(--rain-panel);
  box-shadow: var(--rain-edge);
}

.rain-rules h2 {
  margin: 0;
  padding: 2px 8px;
  color: #fff;
  background: #000080;
  font-size: 12px;
}

.rain-rules-copy {
  display: grid;
  gap: 10px;
  padding: 12px;
}

.rain-rules-copy p {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0;
}

.rain-rules-copy b {
  flex: 0 0 40px;
  color: #000080;
}

.rain-rules-copy p > span {
  min-width: 0;
}

.rain-rules-copy .rain-special {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  background: #11153d;
  box-shadow: var(--rain-inset);
}

.rain-rule-gold {
  color: var(--rain-yellow);
}

.rain-rule-heart {
  color: var(--rain-pink);
}

.rain-actions {
  display: flex;
  justify-content: center;
  padding: 0 12px;
}

.mac-win .rain-pc .rain-start,
.mac-win .rain-pc :deep(.lb-join button[type='submit']) {
  min-width: 0;
  min-height: 38px;
  padding: 8px 18px;
  border: 0;
  border-radius: 0;
  color: #161616;
  background: var(--rain-panel);
  box-shadow: var(--rain-edge);
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  overflow-wrap: anywhere;
}

.mac-win .rain-pc .rain-start {
  min-width: min(180px, 100%);
  outline: 1px solid #080817;
  outline-offset: 1px;
}

.rain-start span {
  margin-left: 12px;
  color: #000080;
}

.mac-win .rain-pc .rain-start:hover:not(:disabled),
.mac-win .rain-pc :deep(.lb-join button[type='submit']:hover:not(:disabled)) {
  background: #d6d6d6;
}

.mac-win .rain-pc .rain-start:active:not(:disabled),
.mac-win .rain-pc :deep(.lb-join button[type='submit']:active:not(:disabled)) {
  background: #b5b5b5;
  box-shadow: var(--rain-inset);
}

.mac-win .rain-pc .rain-start:disabled,
.mac-win .rain-pc :deep(.lb-join button[type='submit']:disabled) {
  color: #505050;
  background: #bcbcbc;
  cursor: default;
}

/* 95식 결과 대화상자 */
.rain-dialog {
  gap: 0;
  margin: 24px auto 80px;
  padding: 3px 3px 16px;
  background: var(--rain-panel);
  box-shadow: var(--rain-edge), 6px 6px #0008;
}

.rain-dialog-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  color: #fff;
  background: #000080;
}

.rain-dialog-bar span {
  color: var(--rain-cyan);
}

.rain-dialog-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
  padding: 18px 14px;
}

.rain-result-header .rain-eyebrow {
  color: #454545;
}

.rain-end-title {
  margin: 2px 0 12px;
  color: #000080;
  font-family: var(--game-font);
  font-size: 36px;
  line-height: 1.5;
  text-shadow: 3px 3px 0 #8f9bd6;
}

.rain-result-score {
  margin: 0;
  padding: 12px;
  color: var(--rain-cyan);
  background: #090d27;
  box-shadow: var(--rain-inset);
  font-family: var(--game-font);
  font-size: 36px;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}

.rain-result-score small {
  margin-left: 8px;
  font-size: 12px;
}

.rain-result-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px;
  margin: 0;
  padding: 8px;
  text-align: center;
  box-shadow: var(--rain-inset);
}

.rain-result-stats dt {
  color: #454545;
}

.rain-result-stats dd {
  margin: 4px 0 0;
  color: #000080;
  font-weight: 700;
}

/* 순위표도 같은 회색 프로그램 안에 */
.rain-pc .rain-poster .rain-records {
  width: 100%;
  min-width: 0;
  padding: 12px;
  border-radius: 0;
  color: #161616;
  background: var(--rain-panel);
  box-shadow: var(--rain-edge);
  font: inherit;
}

.rain-pc .rain-dialog .rain-records {
  padding: 0;
  box-shadow: none;
}

.rain-records :deep(.lb-head) {
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 12px;
}

.rain-records :deep(.lb-head strong) {
  color: #000080;
}

.rain-records :deep(.muted),
.rain-records :deep(.lb-hint) {
  color: #454545;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.rain-records :deep(.lb-list) {
  gap: 0;
  padding: 3px;
  background: #f5f5ef;
  box-shadow: var(--rain-inset);
}

.rain-records :deep(.lb-list li) {
  grid-template-columns: 24px minmax(0, 1fr) minmax(0, auto);
  padding: 5px 6px;
  border-radius: 0;
  font-size: 12px;
}

.rain-records :deep(.no) {
  width: 20px;
  height: 20px;
  border-radius: 0;
  color: #fff;
  background: #323977;
  font-size: 12px;
}

.rain-records :deep(.no.n1) {
  color: #161616;
  background: #e4cf65;
}

.rain-records :deep(.pts) {
  color: #000080;
  overflow-wrap: anywhere;
}

.rain-records :deep(.lb-list li.me),
.rain-records :deep(.lb-me) {
  border-radius: 0;
  color: #fff;
  background: #000080;
  font-size: 12px;
}

.rain-records :deep(.lb-list li.me .pts) {
  color: #fff;
}

.rain-records :deep(.lb-me.rec) {
  color: #fff;
  background: #15563c;
}

.rain-records :deep(.lb-join) {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 8px;
}

.mac-win .rain-pc :deep(.lb-join input),
.mac-win .rain-pc .rain-type {
  width: 100%;
  min-width: 0;
  height: 38px;
  padding: 6px 10px;
  border: 0;
  border-radius: 0;
  color: #161616;
  background: #fff;
  box-shadow: var(--rain-inset);
  font: inherit;
  font-size: 12px;
  outline: none;
}

.rain-records :deep(.lb-join input::placeholder),
.rain-type::placeholder {
  color: #575757;
  opacity: 1;
}

.rain-records :deep(.m-err) {
  margin: 0;
  color: #8d1022;
  font-size: 12px;
  overflow-wrap: anywhere;
}

.rain-input-panel {
  display: grid;
  gap: 8px;
  padding: 12px;
  background: var(--rain-panel);
  box-shadow: var(--rain-edge);
}

.rain-input-label {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

.rain-input-label > span {
  font-weight: 700;
}

.mac-win .rain-pc .rain-type {
  height: 44px;
}

.mac-win .rain-pc .rain-type:disabled {
  color: #505050;
  background: #d8d8d8;
  opacity: 1;
}

.rain-input-help {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin: 0;
  color: #454545;
}

.rain-input-help kbd {
  padding: 1px 4px;
  color: #161616;
  background: #cecece;
  box-shadow: var(--rain-edge);
  font: inherit;
}

.mac-win .rain-pc .rain-start:focus-visible,
.mac-win .rain-pc .rain-pad-btn:focus-visible,
.mac-win .rain-pc :deep(.lb-join button[type='submit']:focus-visible) {
  outline: 2px dashed #000080;
  outline-offset: -5px;
}

.mac-win .rain-pc .rain-pad-btn:focus-visible {
  outline-color: var(--rain-yellow);
}

.mac-win .rain-pc .rain-type:focus,
.mac-win .rain-pc :deep(.lb-join input:focus) {
  outline: 2px solid #000080;
  outline-offset: 2px;
}

@container (max-width: 560px) {
  .rain-score b {
    font-size: 12px;
  }

  .rain-records :deep(.lb-join) {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .rain-records :deep(.lb-join button) {
    grid-column: 1 / -1;
  }
}

@container (max-width: 400px) {
  .rain-program-hint {
    display: none;
  }

  .rain-hud {
    gap: 4px;
    padding: 6px;
  }

  .rain-logo h1 {
    font-size: 36px;
  }

  .rain-poster {
    width: calc(100% - 20px);
  }

  .rain-input-label {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }

  .rain-input-help {
    justify-content: flex-start;
  }

  .rain-records :deep(.lb-join) {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (pointer: coarse) {
  .rain-pad {
    display: flex;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rain-pc *,
  .rain-pc :deep(*) {
    animation: none !important;
    transition: none !important;
  }
}

@keyframes rain-up {
  to {
    transform: translate(-50%, -40px);
    opacity: 0;
  }
}

@keyframes rain-shake {
  25% {
    transform: translateX(-7px);
  }
  75% {
    transform: translateX(7px);
  }
}

@keyframes rain-step {
  50% {
    transform: translateY(-1px);
  }
}

@keyframes rain-cheer {
  from {
    transform: translate(-50%, 6px) scale(0.6);
  }
  25% {
    transform: translate(-50%, 0) scale(1.15);
  }
  to {
    transform: translate(-50%, -10px);
    opacity: 0;
  }
}

@keyframes rain-confetti {
  to {
    transform: translate(var(--dx), var(--dy)) rotate(180deg);
    opacity: 0;
  }
}

@keyframes rain-blink {
  50% {
    opacity: 0.25;
  }
}

@keyframes rain-thud {
  from {
    transform: translateX(-50%) rotate(0deg) scaleY(1.4);
  }
}

@keyframes rain-bump {
  from {
    transform: translateX(-50%) scale(1.25);
  }
}
</style>
