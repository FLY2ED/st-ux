<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { nameCount, signPool } from '../data.js'
import { react } from '../mood.js'
import { sfx } from '../sound.js'

// 간판 복권: 은박을 긁으면 전국 어딘가에 진짜 있는 간판 세 장이 나온다
const TICKET = new URL('../assets/ticket.webp', import.meta.url).href
const FOIL = new URL('../assets/foil.webp', import.meta.url).href
const SLOTS = 3
// 다 긁었다고 보는 비율
const DONE = 0.5

const cards = ref([])
const opened = ref([])
const busy = ref(false)
const canvases = ref([])
const tries = ref(0)
let foil

const prize = computed(() => {
  if (opened.value.length < SLOTS || cards.value.length < SLOTS) return null
  const c = cards.value
  if (c.every((s) => s.cat === c[0].cat)) return { rank: '1등', text: `같은 업종(${c[0].cat}) 세 장! 대박!`, face: 'proud' }
  const unique = c.filter((s) => s.count <= 1)
  if (unique.length >= 2) return { rank: '2등', text: '전국에 하나뿐인 간판을 두 장이나!', face: 'proud' }
  if (unique.length === 1) return { rank: '행운상', text: `'${unique[0].name}'${eun(unique[0].name)} 전국에 딱 한 곳뿐!`, face: 'happy' }
  const common = c.reduce((a, b) => (b.count > a.count ? b : a))
  return { rank: '꽝', text: `'${common.name}'${eun(common.name)} 전국에 ${common.count.toLocaleString()}곳이나 있어요`, face: 'sleepy' }
})

// 받침이 있으면 '은', 없으면 '는'
function eun(word) {
  const c = word.charCodeAt(word.length - 1) - 0xac00
  return c >= 0 && c < 11172 && c % 28 ? '은' : '는'
}

function grade(n) {
  if (n <= 1) return '전설'
  if (n < 10) return '희귀'
  if (n < 100) return '보통'
  return '흔함'
}

// 전국에 하나뿐인 간판은 다섯 장에 한 장꼴로만 나오게 한다 (그냥 뽑으면 거의 다 하나뿐이라 매번 당첨)
async function pickCard(rows, cat) {
  const rare = Math.random() < 0.2
  const pool = cat ? rows.filter((r) => r.cat === cat) : rows
  let card
  for (let k = 0; k < 10 && pool.length; k++) {
    const s = pool[Math.floor(Math.random() * pool.length)]
    const count = Math.max(1, (await nameCount(s.name)) || 1)
    card = { ...s, count }
    if (rare === (count <= 1)) break
  }
  return card
}

async function draw() {
  busy.value = true
  opened.value = []
  tries.value++
  // 한 조각 안의 간판은 업종이 몰려 있어서 칸마다 다른 조각에서 뽑는다
  const pools = await Promise.all(Array.from({ length: SLOTS }, signPool))
  const first = await pickCard(pools[0])
  // 가끔은 같은 업종으로 맞춰 1등 기회를 준다
  const same = Math.random() < 0.12
  const rest = await Promise.all(pools.slice(1).map((rows) => pickCard(same ? pools[0] : rows, same ? first.cat : undefined)))
  cards.value = [first, ...rest].map((s) => s || first)
  busy.value = false
  await nextTick()
  canvases.value.forEach(cover)
}

function loadFoil() {
  return new Promise((ok) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.src = FOIL
  })
}

function cover(cv) {
  if (!cv || !foil) return
  const r = cv.getBoundingClientRect()
  cv.width = Math.round(r.width * devicePixelRatio)
  cv.height = Math.round(r.height * devicePixelRatio)
  const g = cv.getContext('2d')
  g.globalCompositeOperation = 'source-over'
  g.fillStyle = g.createPattern(foil, 'repeat')
  g.fillRect(0, 0, cv.width, cv.height)
  const size = Math.round(Math.min(cv.width * 0.26, cv.height * 0.22))
  g.font = `700 ${size}px Gaegu`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#fffdf6'
  g.strokeStyle = 'rgb(27 27 27 / 0.6)'
  g.lineWidth = size * 0.12
  for (const [t, dy] of [['긁어', -0.6], ['보세요', 0.6]]) {
    g.strokeText(t, cv.width / 2, cv.height / 2 + dy * size)
    g.fillText(t, cv.width / 2, cv.height / 2 + dy * size)
  }
  cv.dataset.left = '1'
}

let last = null
let sound = 0

function scrape(e, i) {
  if (opened.value.includes(i) || busy.value) return
  if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId)
  if (!(e.buttons & 1) && e.pointerType === 'mouse') {
    last = null
    return
  }
  const cv = e.currentTarget
  const r = cv.getBoundingClientRect()
  const x = (e.clientX - r.left) * devicePixelRatio
  const y = (e.clientY - r.top) * devicePixelRatio
  const g = cv.getContext('2d')
  g.globalCompositeOperation = 'destination-out'
  g.lineCap = 'round'
  g.lineWidth = 26 * devicePixelRatio
  g.beginPath()
  g.moveTo(last?.i === i ? last.x : x, last?.i === i ? last.y : y)
  g.lineTo(x, y)
  g.stroke()
  last = { i, x, y }
  const now = performance.now()
  if (now - sound > 70) {
    sound = now
    sfx.scratch(1, 0, 0.05, 4200 + Math.random() * 1200)
  }
}

// 손을 뗄 때 얼마나 긁혔는지 세어 보고 반 넘게 긁혔으면 나머지를 걷어 낸다
function lift(i) {
  last = null
  const cv = canvases.value[i]
  if (!cv || opened.value.includes(i)) return
  const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
  let clear = 0
  for (let k = 3; k < data.length; k += 64) if (data[k] === 0) clear++
  if (clear / (data.length / 64) < DONE) return
  cv.getContext('2d').clearRect(0, 0, cv.width, cv.height)
  opened.value.push(i)
  const card = cards.value[i]
  if (card.count <= 1) sfx.bell()
  else sfx.tick()
  if (opened.value.length === SLOTS) setTimeout(() => {
    react(prize.value.face, 2600)
    if (prize.value.rank === '꽝') sfx.wrong()
    else sfx.right()
  }, 200)
}

function openAll() {
  for (let i = 0; i < SLOTS; i++) {
    if (opened.value.includes(i)) continue
    canvases.value[i]?.getContext('2d').clearRect(0, 0, 9999, 9999)
    opened.value.push(i)
  }
  setTimeout(() => react(prize.value.face, 2600), 100)
}

onMounted(async () => {
  foil = await loadFoil()
  await document.fonts.load('700 20px Gaegu', '긁어 보세요')
  draw()
})
</script>

<template>
  <div class="lotto">
    <p class="rule">
      <b>1등</b> 같은 업종 세 장 · <b>2등</b> 전국에 하나뿐인 간판 두 장 · <b>행운상</b> 하나뿐인 간판 한 장
    </p>
    <div class="ticket">
      <img class="bg" :src="TICKET" alt="" draggable="false" />
      <div class="window">
        <div v-for="i in SLOTS" :key="`${tries}-${i}`" class="slot">
          <div class="prize" :class="{ shown: opened.includes(i - 1) }">
            <template v-if="cards[i - 1]">
              <span class="grade" :class="grade(cards[i - 1].count)">{{ grade(cards[i - 1].count) }}</span>
              <b class="hand">{{ cards[i - 1].name }}</b>
              <small>{{ String(cards[i - 1].region || '').split(' ').slice(-1)[0] }} · {{ String(cards[i - 1].cat || '').split('/')[0] }}</small>
              <small class="n">전국 {{ cards[i - 1].count.toLocaleString() }}곳</small>
            </template>
          </div>
          <canvas
            :ref="(el) => (canvases[i - 1] = el)"
            class="foil"
            :class="{ gone: opened.includes(i - 1) }"
            @pointerdown="scrape($event, i - 1)"
            @pointermove="scrape($event, i - 1)"
            @pointerup="lift(i - 1)"
            @pointercancel="lift(i - 1)"
            @pointerleave="lift(i - 1)"
          ></canvas>
        </div>
      </div>
    </div>

    <div class="result">
      <p v-if="prize" class="hand" :class="{ win: prize.rank !== '꽝' }"><b>{{ prize.rank }}</b> {{ prize.text }}</p>
      <p v-else class="muted">동전으로 긁듯이 은박을 문질러 보세요</p>
      <div class="row">
        <button v-if="!prize" :disabled="busy" @click="openAll">한 번에 다 긁기</button>
        <button class="again" :disabled="busy" @click="draw">{{ busy ? '복권 뽑는 중…' : '한 장 더 사기' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lotto {
  display: grid;
  gap: 10px;
}

.rule {
  margin: 0;
  font-size: 12.5px;
}

.rule b {
  font-family: var(--hand);
  font-size: 15px;
}

.ticket {
  position: relative;
  aspect-ratio: 1000 / 544;
}

.bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* ticket.webp 의 가운데 빈 창 (그림 기준 %) */
.window {
  position: absolute;
  left: 14.8%;
  top: 29.6%;
  width: 69.3%;
  height: 49.1%;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 3%;
  padding: 2.4% 2.4%;
}

.slot {
  position: relative;
  min-width: 0;
}

.prize {
  position: absolute;
  inset: 0;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 0;
  padding: 3px;
  text-align: center;
  border: 2px dashed rgb(27 27 27 / 0.35);
  border-radius: var(--wob2);
  background: #fff;
  line-height: 1.15;
  overflow: hidden;
}

.prize b {
  max-width: 100%;
  font-size: clamp(12px, 1.6vw, 16px);
  word-break: break-all;
}

.prize small {
  font-size: 9px;
  line-height: 1.1;
  color: var(--ink-soft);
}

.prize .n {
  font-size: 11px;
  color: var(--ink);
}

.prize.shown {
  animation: pop 0.35s cubic-bezier(0.3, 1.6, 0.5, 1);
}

.grade {
  font: 700 11px var(--hand);
  padding: 0 5px;
  border: 1.5px solid var(--ink);
  border-radius: 10px;
}

.grade.전설 {
  background: var(--hl);
}

.grade.희귀 {
  background: var(--hl-soft);
}

.foil {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--wob2);
  touch-action: none;
  cursor: grab;
}

.foil.gone {
  pointer-events: none;
}

.result {
  display: grid;
  gap: 8px;
  justify-items: center;
  text-align: center;
}

.result p {
  margin: 0;
  font-size: 19px;
}

.result .win b {
  background: var(--hl);
  padding: 0 6px;
}

.again {
  background: var(--hl);
}

@keyframes pop {
  from {
    transform: scale(0.85);
  }
}
</style>
