<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { nameCount, signPool } from '../data.js'
import { sfx } from '../sound.js'

// 간판 복권: 은박을 긁으면 전국 어딘가에 진짜 있는 간판 세 장이 나온다
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

// 은박: 회색 두 톤을 바둑판처럼 찍은 픽셀 무늬
function makeFoil() {
  const t = document.createElement('canvas')
  t.width = t.height = 8
  const g = t.getContext('2d')
  g.fillStyle = '#b9bcc8'
  g.fillRect(0, 0, 8, 8)
  g.fillStyle = '#d8dae3'
  for (let y = 0; y < 8; y += 2) for (let x = (y / 2) % 2 ? 2 : 0; x < 8; x += 4) g.fillRect(x, y, 2, 2)
  g.fillStyle = '#ffffff'
  g.fillRect(1, 1, 1, 1)
  return t
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
  g.font = `${size}px Galmuri14, Galmuri11, monospace`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#ffffff'
  g.strokeStyle = '#1d1d2b'
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
}

onMounted(async () => {
  foil = makeFoil()
  await document.fonts.load('20px Galmuri14', '긁어 보세요').catch(() => {})
  draw()
})
</script>

<template>
  <div class="lotto">
    <p class="rule">
      <b>1등</b> 같은 업종 세 장 · <b>2등</b> 전국에 하나뿐인 간판 두 장 · <b>행운상</b> 하나뿐인 간판 한 장
    </p>
    <div class="ticket">
      <p class="head"><span>★ 간판 복권 ★</span><small>No.{{ String(tries).padStart(4, '0') }}</small></p>
      <div class="slots">
        <div v-for="i in SLOTS" :key="`${tries}-${i}`" class="slot">
          <div class="prize" :class="{ shown: opened.includes(i - 1) }">
            <template v-if="cards[i - 1]">
              <span class="grade" :class="grade(cards[i - 1].count)">{{ grade(cards[i - 1].count) }}</span>
              <b>{{ cards[i - 1].name }}</b>
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
      <p v-if="prize" :class="{ win: prize.rank !== '꽝' }"><b>{{ prize.rank }}</b> {{ prize.text }}</p>
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
  gap: 8px;
}

.rule {
  margin: 0;
}

.ticket {
  padding: 10px 12px 14px;
  background:
    repeating-linear-gradient(45deg, transparent 0 6px, rgb(255 255 255 / 0.35) 6px 8px),
    var(--yellow);
  border: 3px solid var(--ink);
  box-shadow: 4px 4px 0 var(--ink);
  outline: 2px dashed var(--ink);
  outline-offset: -9px;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 2px 6px 8px;
}

.head span {
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-size: 18px;
  color: var(--red);
  text-shadow: 2px 2px 0 #fff;
}

.slots {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  aspect-ratio: 3 / 1.25;
}

.slot {
  position: relative;
  min-width: 0;
  border: 2px solid var(--ink);
  background: #fff;
}

.prize {
  position: absolute;
  inset: 0;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 2px;
  padding: 4px;
  text-align: center;
  line-height: 1.2;
  overflow: hidden;
}

.prize b {
  max-width: 100%;
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-weight: normal;
  font-size: clamp(12px, 1.6vw, 15px);
  word-break: break-all;
}

.prize small {
  font-size: 10px;
  color: #6b6b7b;
}

.prize .n {
  font-size: 11px;
  color: var(--ink);
}

.prize.shown {
  animation: pop 0.3s steps(3);
}

.grade {
  font-size: 10px;
  padding: 0 5px;
  border: 2px solid var(--ink);
  background: #fff;
}

.grade.전설 {
  background: var(--pink);
}

.grade.희귀 {
  background: var(--blue);
}

.foil {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
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
  font-size: 14px;
}

.result .win b {
  background: var(--pink);
  border: 2px solid var(--ink);
  padding: 0 6px;
}

@keyframes pop {
  from {
    transform: scale(0.85);
  }
}
</style>
