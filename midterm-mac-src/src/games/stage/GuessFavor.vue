<script setup>
// 이야기 속 '간판 어디게': 글자가 자기 동네를 잊어버렸다. 간판 이름만 보고 픽셀 지도에 동네를 찍어 준다.
// 가까울수록 점수가 높고(5000 × e^(-거리/150km)), 세 간판을 집에 보내면 끝
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { load, signPool } from '../../data.js'
import { pastelOf } from '../../shops.js'
import { sfx } from '../../sound.js'
import Hero from './Hero.vue'
import PixelKorea from './PixelKorea.vue'
import { haversine } from './korea.js'
import './stage.css'

const props = defineProps({
  ownerName: { type: String, default: '' },
  ownerArt: { type: String, default: '' },
})
const ROUNDS = 3
const START = { lng: 127.8, lat: 36.3 }

const phase = ref('loading') // loading | guess | reveal | done
const round = ref(0)
const sign = ref(null)
const pin = ref(null)
const km = ref(0)
const got = ref(0)
const total = ref(0)
const heroPose = ref('idle')
const map = ref(null)

const say = computed(() => {
  if (phase.value === 'loading') return '잠깐만요, 길 잃은 글자를 데려올게요…'
  if (phase.value === 'guess') return `「${sign.value?.name}」${round.value ? '도' : ''} 어느 동네 간판인지 헷갈린대요. 어디쯤일까요?`
  if (phase.value === 'reveal') return got.value >= 4000 ? '거의 정답! 금방 돌아가겠어요!' : got.value >= 1500 ? '아깝다! 그래도 길은 찾았대요' : '많이 멀었지만… 천천히 걸어가 볼게요'
  return '글자들이 다 집에 갔어요. 고마워요!'
})

let regionAt = null
const used = new Set()

// 동네 이름이 든 간판(힌트가 있다)을 먼저 고르고, 없으면 아무 간판
function placeWords(region) {
  const [sido, ...rest] = region.split(' ')
  const words = [sido.slice(0, 2)]
  for (const r of rest) {
    const w = r.replace(/(특별자치시|특별자치도|특별시|광역시|시|군|구)$/, '')
    if (w.length >= 2) words.push(w)
  }
  return words
}

async function pickSign() {
  let fallback = null
  for (let t = 0; t < 8; t++) {
    const rows = (await signPool().catch(() => [])).filter((r) => r.name.length >= 3 && r.name.length <= 11 && !used.has(r.name) && regionAt.has(r.region))
    if (!rows.length) continue
    const local = rows.filter((r) => placeWords(r.region).some((w) => r.name.includes(w) && !r.region.startsWith(r.name)))
    if (local.length) return local[Math.floor(Math.random() * local.length)]
    fallback ||= rows[Math.floor(Math.random() * rows.length)]
  }
  return fallback
}

async function next() {
  phase.value = 'loading'
  pin.value = null
  heroPose.value = 'idle'
  const s = await pickSign()
  if (!s) return
  used.add(s.name)
  const [lng, lat] = regionAt.get(s.region)
  sign.value = { ...s, lng, lat }
  phase.value = 'guess'
  sfx.flip?.()
}

function place(p) {
  if (phase.value !== 'guess') return
  pin.value = p
  sfx.pop()
}

function confirm() {
  if (phase.value !== 'guess' || !pin.value) return
  const s = sign.value
  km.value = haversine(pin.value, s)
  got.value = Math.round(5000 * Math.exp(-km.value / 150))
  total.value += got.value
  phase.value = 'reveal'
  map.value?.drawLine()
  heroPose.value = got.value >= 1500 ? 'cheer' : 'hurt'
  if (got.value >= 4000) sfx.right()
  else if (got.value >= 1500) sfx.flip()
  else sfx.wrong()
}

function after() {
  if (phase.value !== 'reveal') return
  round.value++
  if (round.value >= ROUNDS) return finish()
  next()
}

function finish() {
  phase.value = 'done'
  pin.value = null
  heroPose.value = 'cheer'
  sfx.levelUp?.()
  window.dispatchEvent(new CustomEvent('game:over', { detail: { game: 'guess', score: total.value } }))
}

function onKey(e) {
  if (phase.value === 'guess') {
    const k = e.shiftKey ? 24 : 8
    const d = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] }[e.key]
    if (d) {
      e.preventDefault()
      pin.value = map.value?.nudge(pin.value || START, d[0], d[1]) || pin.value
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!pin.value) pin.value = { ...START }
      else confirm()
    }
  } else if (phase.value === 'reveal' && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault()
    after()
  }
}

const kmText = (v) => (v < 10 ? `${v.toFixed(1)}km` : `${Math.round(v).toLocaleString()}km`)

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  const regions = await load('regions.json')
  regionAt = new Map(regions.map(([n, lng, lat]) => [n, [lng, lat]]))
  next()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="sg gf">
    <div class="sg-stars" aria-hidden="true"></div>
    <header class="sg-hud">
      <span class="sg-chip"><small>길 잃은 간판</small><b>{{ Math.min(round + 1, ROUNDS) }} / {{ ROUNDS }}</b></span>
      <span class="sg-chip"><small>점수</small><b>{{ total.toLocaleString() }}</b></span>
    </header>

    <div class="gf-body">
      <!-- 왼쪽: 사장님과 길 잃은 간판, 그리고 나 -->
      <section class="gf-side">
        <div v-if="sign" :key="sign.name" class="gf-lost" :class="phase">
          <span class="sg-sign gf-plate" :style="{ '--plate': pastelOf(sign.name) }">{{ sign.name }}</span>
          <small v-if="phase === 'reveal'" class="gf-home">우리 동네 · {{ sign.region }}</small>
          <small v-else class="gf-cat">{{ String(sign.cat || '').split('/')[0] }} 간판</small>
        </div>
        <div class="gf-people">
          <div class="gf-owner">
            <p :key="say" class="sg-say gf-say px-pop">{{ say }}</p>
            <img v-if="ownerArt" :src="ownerArt" alt="" draggable="false" />
            <small v-if="ownerName">{{ ownerName }}</small>
          </div>
          <Hero :scale="4" :dir="2" :pose="heroPose" />
        </div>
        <div class="gf-ctrl">
          <template v-if="phase === 'guess'">
            <p><span class="sg-key">←</span><span class="sg-key">↑</span><span class="sg-key">↓</span><span class="sg-key">→</span> 핀 옮기기 (Shift 크게) · 지도 누르기</p>
            <button class="sg-btn go" :disabled="!pin" @click="confirm">여기예요! <span class="sg-key">Enter</span></button>
          </template>
          <template v-else-if="phase === 'reveal'">
            <p class="gf-result">
              <span>떨어진 거리 <b>{{ kmText(km) }}</b></span>
              <span>받은 점수 <b>+{{ got.toLocaleString() }}</b></span>
            </p>
            <button class="sg-btn go" @click="after">{{ round + 1 >= ROUNDS ? '다 보냈다!' : '다음 간판' }} <span class="sg-key">Enter</span></button>
          </template>
        </div>
      </section>

      <!-- 오른쪽: 픽셀 지도 -->
      <section class="gf-map">
        <span class="sg-tab">전국 지도</span>
        <PixelKorea
          ref="map"
          class="gf-korea"
          :pin="pin"
          :star="phase === 'reveal' ? sign : null"
          :dim="0.75"
          tint="#4b56a8"
          :clickable="phase === 'guess'"
          @pick="place"
        />
        <p v-if="phase === 'guess' && !pin" class="gf-tip">지도를 눌러 핀을 꽂아요</p>
      </section>
    </div>

    <div v-if="phase === 'done'" class="sg-end">
      <h1 class="px-pop">글자들이 집에 갔다!</h1>
      <p>간판 <b>{{ ROUNDS }}개</b>를 동네로 돌려보내 <b>{{ total.toLocaleString() }}점</b></p>
    </div>
  </div>
</template>

<style scoped>
.gf {
  background: linear-gradient(#141b3a, #0b1028 60%);
}

.gf-body {
  position: absolute;
  inset: 50px 0 0;
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.1fr);
}

.gf-side {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 10px;
  padding: 14px 18px 18px;
}

.gf-lost {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding-top: 8px;
  animation: gf-bob 1.6s steps(4) infinite alternate;
}

.gf-lost.reveal {
  animation: none;
}

@keyframes gf-bob {
  to {
    translate: 0 -6px;
  }
}

.gf-plate {
  font-size: clamp(22px, 3cqi, 34px);
  padding: 12px 20px;
}

.gf-cat,
.gf-home {
  padding: 3px 10px;
  background: #141b3a;
  font-size: 13px;
  color: #c2c3c7;
}

.gf-home {
  color: #ffec27;
}

.gf-people {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
  padding: 0 4px;
  border-bottom: 6px solid #2b3a78;
}

.gf-owner {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 2px;
}

.gf-owner img {
  height: clamp(96px, 12cqi, 140px);
}

.gf-owner small {
  padding: 3px 8px;
  font-size: 11px;
  color: #1d1d1f;
  background: #ffa300;
  box-shadow: 0 -3px 0 #fff1e8, 0 3px 0 #fff1e8, -3px 0 0 #fff1e8, 3px 0 0 #fff1e8;
}

.gf-say {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 0;
  width: max-content;
  max-width: min(300px, 30cqi);
}

.gf-ctrl {
  display: grid;
  gap: 10px;
  justify-items: center;
  min-height: 92px;
  font-size: 13px;
  color: #c2c3c7;
}

.gf-ctrl p {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin: 0;
}

.gf-ctrl .sg-btn .sg-key {
  margin-left: 6px;
}

.gf-result {
  gap: 16px !important;
  font-size: 15px;
}

.gf-result b {
  color: #ffec27;
  font-weight: 400;
  font-size: 20px;
}

.gf-map {
  position: relative;
  margin: 36px 18px 18px 6px;
  background: #0b1028;
  box-shadow: inset 0 0 0 3px #2b3a78, 0 -3px 0 #fff1e8, 0 3px 0 #fff1e8, -3px 0 0 #fff1e8, 3px 0 0 #fff1e8, 0 9px 0 rgb(0 0 0 / 0.45);
}

.gf-korea {
  position: absolute;
  inset: 0;
}

.gf-tip {
  position: absolute;
  top: 14px;
  left: 50%;
  margin: 0;
  padding: 4px 10px;
  translate: -50% 0;
  background: #141b3a;
  box-shadow: 0 -3px 0 #fff1e8, 0 3px 0 #fff1e8, -3px 0 0 #fff1e8, 3px 0 0 #fff1e8, 0 6px 0 rgb(0 0 0 / 0.45);
  font-size: 13px;
  pointer-events: none;
}
</style>
