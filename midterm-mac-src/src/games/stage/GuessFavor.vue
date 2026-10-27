<script setup>
// 이야기 속 '간판 어디게': 글자가 자기 동네를 잊어버렸다. 간판 이름만 보고 픽셀 지도에 동네를 찍어 준다.
// 가까울수록 점수가 높고(5000 × e^(-거리/150km)), 세 간판을 집에 보내면 끝
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { load, signPool } from '../../data.js'
import { sfx } from '../../sound.js'
import GuessShop from './GuessShop.vue'
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
const homes = ref([]) // 집에 보낸 간판들(끝 화면에 늘어놓는다)
const map = ref(null)

const say = computed(() => {
  if (phase.value === 'loading') return '잠깐만요, 길 잃은 글자를 데려올게요…'
  if (phase.value === 'guess') return `「${sign.value?.name}」${round.value ? '도' : ''} 자기 동네를 잊어버렸대요. 어디쯤일까요?`
  if (phase.value === 'reveal') return got.value >= 4000 ? '거의 정답! 금방 돌아가겠어요!' : got.value >= 1500 ? '아깝다! 그래도 길은 찾았대요' : '많이 멀었지만… 천천히 걸어가 볼게요'
  return '글자들이 다 집에 갔어요. 고마워요!'
})

// 내 캐릭터 머리 위 한 글자: 고민 중 ? · 가까우면 ! · 멀면 …
const think = computed(() => {
  if (phase.value === 'guess') return pin.value ? '!?' : '?'
  if (phase.value === 'reveal') return got.value >= 1500 ? '!' : '…'
  return ''
})
const catName = (c) => String(c || '').split('/')[0]

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
  homes.value.push({ name: s.name, cat: s.cat, region: s.region, km: km.value })
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
      <section class="gf-side">
        <!-- 왼쪽 위: 밤거리에 선 길 잃은 가게, 사장님과 나 -->
        <div class="gf-street">
          <span class="sg-tab">길 잃은 간판</span>
          <div class="gf-sky" aria-hidden="true">
            <i class="gf-moon"></i>
            <i v-for="n in 6" :key="n" class="gf-bld" :class="`b${n}`"></i>
          </div>
          <p v-if="sign && phase !== 'done' && phase !== 'loading'" :key="`${sign.name}-${phase}`" class="gf-note px-pop" :class="{ home: phase === 'reveal' }">
            <template v-if="phase === 'reveal'">집 찾았다! <b>{{ sign.region }}</b></template>
            <template v-else>{{ catName(sign.cat) }} 간판 · 우리 동네가 어디더라?</template>
          </p>
          <div v-if="sign" :key="sign.name" class="gf-lost" :class="phase">
            <i class="gf-glow" aria-hidden="true"></i>
            <GuessShop :name="sign.name" :cat="sign.cat" :width="168" />
          </div>
          <div class="gf-walk" aria-hidden="true"></div>
          <div v-if="ownerArt" class="gf-owner">
            <img :src="ownerArt" alt="" draggable="false" />
          </div>
          <div class="gf-me">
            <span v-if="think" :key="think" class="gf-think px-pop" :class="{ bad: think === '…' }">{{ think }}</span>
            <Hero :scale="4" :dir="0" :pose="heroPose" />
            <small>나</small>
          </div>
        </div>

        <!-- 사장님 한마디: 대화창 모양 -->
        <div class="gf-talk">
          <span class="sg-tab">{{ ownerName || '사장님' }}</span>
          <p :key="say" class="px-pop">{{ say }}</p>
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
        <div class="gf-sea" aria-hidden="true"></div>
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
        <span class="gf-compass" aria-hidden="true"><b>N</b><i></i></span>
        <p v-if="phase === 'guess' && !pin" class="gf-tip">지도를 눌러 핀을 꽂아요</p>
        <p class="gf-key" aria-hidden="true">
          <span><i class="me"></i>내 핀</span>
          <span><i class="ans"></i>우리 동네</span>
        </p>
      </section>
    </div>

    <div v-if="phase === 'done'" class="sg-end gf-end">
      <Hero :scale="4" :dir="0" pose="cheer" />
      <h1 class="px-pop">글자들이 집에 갔다!</h1>
      <ul class="gf-homes">
        <li v-for="h in homes" :key="h.name">
          <GuessShop :name="h.name" :cat="h.cat" :width="92" bare />
          <small>{{ h.region.split(' ').slice(-1)[0] }} · {{ kmText(h.km) }}</small>
        </li>
      </ul>
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
  grid-template-columns: minmax(300px, 0.9fr) minmax(0, 1.1fr);
}

.gf-side {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto auto;
  gap: 14px;
  padding: 36px 12px 16px 18px;
}

/* 밤거리 창: 지도 창과 같은 크림 테두리 */
.gf-street {
  position: relative;
  min-height: 0;
  background: linear-gradient(#1b2352, #2a2f6b 70%);
  box-shadow: var(--sg-frame), 0 9px 0 rgb(0 0 0 / 0.45);
}

.gf-sky {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background-image:
    radial-gradient(2px 2px at 18% 14%, #fff 50%, transparent 51%),
    radial-gradient(2px 2px at 42% 26%, #ffec27 50%, transparent 51%),
    radial-gradient(2px 2px at 64% 10%, #fff 50%, transparent 51%),
    radial-gradient(2px 2px at 88% 34%, #29adff 50%, transparent 51%),
    radial-gradient(2px 2px at 8% 40%, #fff 50%, transparent 51%);
}

.gf-moon {
  position: absolute;
  top: 18px;
  right: 22px;
  width: 26px;
  height: 26px;
  background: #fff1c8;
  box-shadow: 0 0 0 4px rgb(255 241 200 / 0.12), 0 0 0 10px rgb(255 241 200 / 0.06);
  clip-path: polygon(25% 0, 75% 0, 100% 25%, 100% 75%, 75% 100%, 25% 100%, 0 75%, 0 25%);
}

/* 뒤에 늘어선 건물들: 가로줄 벽 + 세로줄 창으로 불 켜진 창문 격자를 만든다 */
.gf-bld {
  --bc: #121a44;
  --lit: rgb(255 214 107 / 0.55);
  position: absolute;
  bottom: 30px;
  display: block;
  background:
    repeating-linear-gradient(180deg, var(--bc) 0 7px, transparent 7px 13px) 0 8px / 100% 100% no-repeat,
    repeating-linear-gradient(90deg, var(--bc) 0 6px, var(--lit) 6px 11px);
  box-shadow: inset 0 3px 0 #2f3a7c;
}

.gf-bld.b1 { left: 0; width: 18%; height: 46%; }
.gf-bld.b2 { left: 15%; width: 15%; height: 62%; --lit: rgb(124 205 255 / 0.4); }
.gf-bld.b3 { left: 33%; width: 20%; height: 38%; --bc: #161f4e; }
.gf-bld.b4 { left: 52%; width: 14%; height: 54%; --lit: rgb(255 214 107 / 0.3); }
.gf-bld.b5 { left: 68%; width: 18%; height: 42%; --bc: #161f4e; --lit: rgb(255 140 170 / 0.4); }
.gf-bld.b6 { right: 0; width: 15%; height: 58%; }

/* 보도블록 */
.gf-walk {
  position: absolute;
  inset: auto 0 0;
  height: 34px;
  background:
    linear-gradient(#9aa0c8 0 0) top / 100% 4px no-repeat,
    linear-gradient(#5d6397 0 0) 0 4px / 100% 3px no-repeat,
    repeating-linear-gradient(90deg, transparent 0 30px, #2c3266 30px 33px),
    linear-gradient(#444b80 0 50%, #3c4276 50%);
}

.gf-note {
  position: absolute;
  top: 12px;
  left: 50%;
  z-index: 3;
  max-width: calc(100% - 24px);
  margin: 0;
  padding: 4px 10px;
  translate: -50% 0;
  background: #0b1028;
  box-shadow: 0 0 0 2px #5f6aa8;
  color: #c2c3c7;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gf-note.home {
  color: #fff1e8;
  box-shadow: 0 0 0 2px #ffec27;
}

.gf-note b {
  color: #ffec27;
  font-weight: 400;
}

/* 가게: 고민하는 동안 간판이 살랑 흔들린다 */
.gf-lost {
  position: absolute;
  bottom: 26px;
  left: 50%;
  z-index: 1;
  translate: -50% 0;
  display: grid;
  justify-items: center;
}

.gf-lost.guess :deep(.gs-sign) {
  animation: gf-sway 1.6s steps(4) infinite alternate;
  transform-origin: 50% 100%;
}

.gf-lost.reveal :deep(.gs-sign) {
  animation: gf-home 0.5s steps(3) 2;
}

@keyframes gf-sway {
  from {
    rotate: -2deg;
  }
  to {
    rotate: 2deg;
  }
}

@keyframes gf-home {
  50% {
    translate: 0 -8px;
    filter: brightness(1.25);
  }
}

/* 간판 뒤 은은한 불빛 */
.gf-glow {
  position: absolute;
  top: -18px;
  left: 50%;
  width: 260px;
  height: 120px;
  translate: -50% 0;
  background: radial-gradient(closest-side, rgb(255 236 39 / 0.18), transparent);
  pointer-events: none;
}

.gf-lost.reveal .gf-glow {
  background: radial-gradient(closest-side, rgb(255 236 39 / 0.38), transparent);
}

.gf-owner,
.gf-me {
  position: absolute;
  bottom: 10px;
  z-index: 2;
  display: grid;
  justify-items: center;
}

.gf-owner {
  left: 8px;
}

.gf-owner img {
  display: block;
  height: 120px;
  filter: drop-shadow(0 4px 0 rgb(0 0 0 / 0.3));
}

.gf-me {
  right: 8px;
}

.gf-me small {
  margin-top: -2px;
  padding: 1px 7px;
  color: #1d1d1f;
  background: #ffec27;
  box-shadow: 0 0 0 2px #141b3a;
  font-size: 11px;
}

/* 머리 위 말풍선 한 글자 */
.gf-think {
  position: absolute;
  bottom: calc(100% + 2px);
  left: 50%;
  min-width: 26px;
  padding: 2px 6px;
  translate: -50% 0;
  background: #fff1e8;
  color: #141b3a;
  font-size: 15px;
  text-align: center;
  box-shadow: 0 -2px 0 #141b3a, 0 2px 0 #141b3a, -2px 0 0 #141b3a, 2px 0 0 #141b3a;
}

.gf-think::after {
  content: '';
  position: absolute;
  top: calc(100% + 2px);
  left: calc(50% - 4px);
  width: 6px;
  height: 6px;
  background: #fff1e8;
  box-shadow: 0 0 0 2px #141b3a;
}

.gf-think.bad {
  color: #7e2553;
}

/* 사장님 대화창 */
.gf-talk {
  position: relative;
  margin-top: 16px;
  padding: 12px 14px 10px;
  background: #141b3a;
  box-shadow: var(--sg-frame), 0 7px 0 rgb(0 0 0 / 0.45);
}

.gf-talk .sg-tab {
  left: 10px;
  font-size: 12px;
}

.gf-talk p {
  min-height: 2.9em;
  margin: 0;
  color: #fff1e8;
  font-size: 14px;
  line-height: 1.45;
  word-break: keep-all;
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
  margin: 36px 18px 18px 10px;
  background: #0b1028;
  box-shadow: inset 0 0 0 3px #2b3a78, var(--sg-frame), 0 9px 0 rgb(0 0 0 / 0.45);
}

/* 바다: 옅은 격자와 물결 점 */
.gf-sea {
  position: absolute;
  inset: 3px;
  background:
    repeating-linear-gradient(90deg, rgb(75 86 168 / 0.12) 0 1px, transparent 1px 32px),
    repeating-linear-gradient(0deg, rgb(75 86 168 / 0.12) 0 1px, transparent 1px 32px),
    radial-gradient(ellipse at 50% 45%, #121a45, #0b1028 70%);
  pointer-events: none;
}

.gf-korea {
  position: absolute;
  inset: 0;
}

.gf-compass {
  position: absolute;
  top: 12px;
  right: 12px;
  display: grid;
  justify-items: center;
  gap: 2px;
  padding: 4px 7px 6px;
  background: #141b3a;
  box-shadow: 0 0 0 2px #5f6aa8;
  pointer-events: none;
}

.gf-compass b {
  color: #ffec27;
  font-size: 11px;
  font-weight: 400;
  line-height: 1;
}

.gf-compass i {
  width: 10px;
  height: 14px;
  background: linear-gradient(90deg, #fff1e8 50%, #ff004d 50%);
  clip-path: polygon(50% 0, 100% 100%, 50% 75%, 0 100%);
}

.gf-tip {
  position: absolute;
  top: 14px;
  left: 50%;
  margin: 0;
  padding: 4px 10px;
  translate: -50% 0;
  background: #141b3a;
  box-shadow: var(--sg-frame), 0 6px 0 rgb(0 0 0 / 0.45);
  font-size: 13px;
  pointer-events: none;
  animation: gf-tip 0.8s steps(2) infinite alternate;
}

@keyframes gf-tip {
  to {
    translate: -50% 3px;
  }
}

.gf-key {
  position: absolute;
  bottom: 12px;
  left: 12px;
  display: flex;
  gap: 12px;
  margin: 0;
  padding: 4px 9px;
  background: #141b3a;
  box-shadow: 0 0 0 2px #5f6aa8;
  color: #c2c3c7;
  font-size: 11px;
  pointer-events: none;
}

.gf-key span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.gf-key i {
  width: 8px;
  height: 8px;
}

.gf-key i.me {
  background: #ff5a7a;
  box-shadow: 0 0 0 2px #fff1e8;
}

.gf-key i.ans {
  background: #ffec27;
  clip-path: polygon(50% 0, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0 50%, 38% 38%);
  width: 12px;
  height: 12px;
}

/* 끝 화면: 만세하는 나 + 집에 간 간판 세 개 */
.gf-end {
  gap: 10px;
}

.gf-homes {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 14px 18px;
  margin: 6px 0 4px;
  padding: 0;
  list-style: none;
}

.gf-homes li {
  display: grid;
  justify-items: center;
  gap: 10px;
}

.gf-homes small {
  color: #c2c3c7;
  font-size: 11px;
}

@media (prefers-reduced-motion: reduce) {
  .gf-lost :deep(.gs-sign),
  .gf-tip {
    animation: none !important;
  }
}
</style>
