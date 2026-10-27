<script setup>
// 간판 어디게: 진짜 간판 하나를 보고 전국 지도에서 어디 있는지 찍는다. 정답은 그 간판이 있는 시·군·구의 가운데다
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { load, nameCount, signPool } from '../data.js'
import { sfx } from '../sound.js'
import { catColor } from './catColor.js'
import { useCountUp } from './countUp.js'
import Leaderboard from './Leaderboard.vue'
import GuessShop from './stage/GuessShop.vue'
import Hero from './stage/Hero.vue'
import './pixel.css'

// embed: 거리 이야기 안에서 열린 판. 지도 창 대신 사장님 옆 픽셀 지도에 길 잃은 간판의 동네를 찍는다(GuessFavor)
const props = defineProps({ embed: Boolean, ownerName: { type: String, default: '' }, ownerArt: { type: String, default: '' } })
const GuessFavor = defineAsyncComponent(() => import('./stage/GuessFavor.vue'))

const ROUNDS = 5
const ICON = new URL('../assets/mac/guess.webp', import.meta.url).href
const KOREA = [
  [124.6, 33.0],
  [130.9, 38.7],
]
const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

const phase = ref('ready') // ready | loading | guess | reveal | over
const round = ref(0)
const sign = ref(null)
const guess = ref(null)
const km = ref(0)
const got = ref(0)
const total = ref(0)
const log = ref([])
const error = ref('')
const mapEl = ref(null)
// 라운드 점수와 최종 총점은 결과가 뜰 때 0 부터 올라간다
const shownGot = useCountUp(() => (phase.value === 'reveal' ? got.value : 0), { ms: 650, steps: 12, tick: () => sfx.tick() })
const shownTotal = useCountUp(() => (phase.value === 'over' ? total.value : 0), { ms: 900, steps: 16, tick: () => sfx.tick() })
// 효과음과 같은 기준으로 한마디
const cheer = (pts) => (pts >= 4000 ? '거의 정답!' : pts >= 1500 ? '아깝다!' : '많이 멀었어요')
// 지도 위에 선 내 캐릭터: 결과가 가까우면 만세, 멀면 움찔
const heroPose = computed(() => (phase.value === 'reveal' ? (got.value >= 1500 ? 'cheer' : 'hurt') : 'idle'))

let maplibre = null
let map = null
let guessMarker = null
let answerMarker = null
let regionAt = null
let observer

// 시·군·구 이름에서 간판에 자주 들어가는 지명 조각: '강원특별자치도 춘천시' → 강원, 춘천
function placeWords(region) {
  const [sido, ...rest] = region.split(' ')
  const words = [sido.slice(0, 2)]
  for (const r of rest) {
    const w = r.replace(/(특별자치시|특별자치도|특별시|광역시|시|군|구)$/, '')
    if (w.length >= 2) words.push(w)
  }
  return words
}

// 재미있는 문제: 동네 이름이 든 간판(힌트가 있다)을 먼저 찾고, 없으면 아무 간판
async function pickSign(used) {
  let fallback = null
  for (let t = 0; t < 8; t++) {
    const rows = (await signPool()).filter((r) => r.name.length >= 3 && r.name.length <= 12 && !used.has(r.name))
    if (!rows.length) continue
    const local = rows.filter((r) => placeWords(r.region).some((w) => r.name.includes(w) && w.length >= 2 && !r.region.startsWith(r.name)))
    if (local.length) return local[Math.floor(Math.random() * local.length)]
    fallback ||= rows[Math.floor(Math.random() * rows.length)]
  }
  return fallback
}

const used = new Set()

async function next() {
  phase.value = 'loading'
  error.value = ''
  guess.value = null
  clearMarks()
  try {
    const s = await pickSign(used)
    if (!s) throw new Error('간판을 고르지 못했어요')
    used.add(s.name)
    const [lng, lat] = regionAt.get(s.region)
    const count = await nameCount(s.name).catch(() => null)
    sign.value = { ...s, lng, lat, count, color: catColor(s.cat) }
    round.value++
    phase.value = 'guess'
    map?.fitBounds(KOREA, { padding: 30, duration: 600 })
  } catch (e) {
    error.value = e.message
    phase.value = 'ready'
  }
}

function start() {
  round.value = 0
  total.value = 0
  log.value = []
  used.clear()
  sfx.tick()
  next()
}

function haversine(a, b) {
  const R = 6371
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function pin(cls, text) {
  const el = document.createElement('div')
  el.className = `gw-pin ${cls}`
  el.innerHTML = `<span>${text}</span>`
  return el
}

function place(lngLat) {
  if (phase.value !== 'guess') return
  guess.value = { lng: lngLat.lng, lat: lngLat.lat }
  if (!guessMarker) {
    guessMarker = new maplibre.Marker({ element: pin('me', '나'), anchor: 'bottom', draggable: true }).setLngLat(lngLat).addTo(map)
    guessMarker.on('dragend', () => {
      const p = guessMarker.getLngLat()
      guess.value = { lng: p.lng, lat: p.lat }
    })
  } else guessMarker.setLngLat(lngLat)
  sfx.pop()
}

function confirm() {
  if (!guess.value) return
  const s = sign.value
  km.value = haversine(guess.value, s)
  got.value = Math.round(5000 * Math.exp(-km.value / 150))
  total.value += got.value
  log.value.push({ name: s.name, region: s.region, km: km.value, score: got.value })
  phase.value = 'reveal'
  guessMarker.setDraggable(false)
  answerMarker = new maplibre.Marker({ element: pin('ans', '★'), anchor: 'bottom' }).setLngLat([s.lng, s.lat]).addTo(map)
  map.getSource('gw-line')?.setData({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [[guess.value.lng, guess.value.lat], [s.lng, s.lat]] },
  })
  const b = new maplibre.LngLatBounds([guess.value.lng, guess.value.lat], [guess.value.lng, guess.value.lat]).extend([s.lng, s.lat])
  map.fitBounds(b, { padding: { top: 150, bottom: 120, left: 60, right: 60 }, maxZoom: 9, duration: 900 })
  if (got.value >= 4000) sfx.right()
  else if (got.value >= 1500) sfx.flip()
  else sfx.wrong()
}

function after() {
  if (round.value >= ROUNDS) {
    phase.value = 'over'
    sfx.levelUp()
    clearMarks()
    map?.fitBounds(KOREA, { padding: 30, duration: 600 })
  } else next()
}

function clearMarks() {
  guessMarker?.remove()
  answerMarker?.remove()
  guessMarker = answerMarker = null
  map?.getSource('gw-line')?.setData({ type: 'FeatureCollection', features: [] })
}

function koreanLabels(m) {
  for (const layer of m.getStyle().layers) {
    if (layer.type === 'symbol' && m.getLayoutProperty(layer.id, 'text-field')) {
      m.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name']])
    }
  }
}

const kmText = (v) => (v < 10 ? `${v.toFixed(1)}km` : `${Math.round(v).toLocaleString()}km`)
const shortRegion = (r) => r.split(' ').slice(-2).join(' ')

onMounted(async () => {
  if (props.embed) return
  const regions = await load('regions.json')
  regionAt = new Map(regions.map(([n, lng, lat]) => [n, [lng, lat]]))
  const mod = await import('maplibre-gl')
  maplibre = mod.default || mod
  maplibre.setWorkerUrl(workerUrl)
  if (!mapEl.value) return
  map = new maplibre.Map({
    container: mapEl.value,
    style: STYLE,
    bounds: KOREA,
    fitBoundsOptions: { padding: 30 },
    attributionControl: { compact: true },
    localIdeographFontFamily: getComputedStyle(document.body).fontFamily,
    dragRotate: false,
    pitchWithRotate: false,
  })
  map.on('style.load', () => koreanLabels(map))
  map.on('load', () => {
    map.addSource('gw-line', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    map.addLayer({
      id: 'gw-line',
      type: 'line',
      source: 'gw-line',
      paint: { 'line-color': '#1d1d1f', 'line-width': 2.5, 'line-dasharray': [1.5, 1.5] },
    })
  })
  map.on('click', (e) => place(e.lngLat))
  observer = new ResizeObserver(() => map?.resize())
  observer.observe(mapEl.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  map?.remove()
})
</script>

<template>
  <GuessFavor v-if="props.embed" :owner-name="props.ownerName" :owner-art="props.ownerArt" />
  <div v-else class="guess">
    <div class="map-stage" :class="{ parked: phase === 'ready' || phase === 'loading' || phase === 'over' }">
      <div ref="mapEl" class="map" :class="{ aim: phase === 'guess' }"></div>
      <div class="gw-map-shade" aria-hidden="true"></div>
      <div class="gw-compass" aria-hidden="true">
        <span>N</span>
        <i></i>
      </div>

      <section v-if="sign && (phase === 'guess' || phase === 'reveal')" class="gw-question">
        <div class="gw-hud">
          <span class="gw-hud-chip"><small>라운드</small><b>{{ round }}<small> / {{ ROUNDS }}</small></b></span>
          <span class="gw-hud-chip"><small>총점</small><b>{{ total.toLocaleString() }}<small>점</small></b></span>
        </div>
        <div :key="sign.name" class="gw-clue px-pop">
          <span class="gw-tab">이 간판의 동네는?</span>
          <GuessShop class="gw-board" :name="sign.name" :cat="sign.cat" :width="132" />
          <p class="gw-category">{{ sign.cat }}<template v-if="sign.count > 1"><br />전국에 같은 이름 <b>{{ sign.count.toLocaleString() }}</b>곳</template></p>
        </div>
        <!-- 지도 위의 나: 말풍선으로 안내하고 결과에 따라 만세·움찔 -->
        <div class="gw-me">
          <Hero :scale="3" :dir="0" :pose="heroPose" />
          <p v-if="phase === 'guess'" :key="guess ? 'drag' : 'tap'" class="gw-hint px-pop">{{ guess ? '핀을 드래그해 위치를 조정할 수 있어요' : '지도를 눌러 예상 위치에 핀을 꽂으세요' }}</p>
        </div>
        <div v-if="phase === 'reveal'" class="gw-round-result px-panel" aria-live="polite">
          <p class="gw-cheer px-pop">{{ cheer(got) }}</p>
          <div class="gw-distance">
            <span>정답과의 거리</span>
            <b>{{ kmText(km) }}</b>
          </div>
          <p class="gw-where"><b>{{ shortRegion(sign.region) }}</b>에 있어요</p>
          <p class="gw-round-points">+{{ shownGot.toLocaleString() }}<small>점</small><span> / 5,000점</span></p>
          <div class="gw-score-track" role="progressbar" aria-label="이번 라운드 점수" :aria-valuenow="got" :aria-valuemax="5000" aria-valuemin="0">
            <span :style="{ width: (got / 5000 * 100) + '%' }"></span>
          </div>
          <p class="gw-footnote">정답 핀은 시·군·구의 가운데예요. 간판의 정확한 주소는 아니에요.</p>
        </div>
      </section>

      <div class="gw-map-key" aria-hidden="true">
        <span><i class="gw-my-dot"></i>내 선택</span>
        <span><i class="gw-answer-dot"></i>정답</span>
      </div>
      <div v-if="phase === 'guess' || phase === 'reveal'" class="gw-actions">
        <button v-if="phase === 'guess'" class="gw-button" :disabled="!guess" @click="confirm">추측하기 <span aria-hidden="true">▶</span></button>
        <button v-else class="gw-button" @click="after">{{ round >= ROUNDS ? '결과 보기' : '다음 라운드' }} <span aria-hidden="true">▶</span></button>
      </div>
    </div>

    <div v-if="phase === 'ready' || phase === 'loading' || phase === 'over'" class="gw-sheet">
      <template v-if="phase === 'over'">
        <header class="gw-summary">
          <span class="gw-tab">{{ round }} / {{ ROUNDS }} 라운드 완료</span>
          <div class="gw-summary-top">
            <div>
              <h1 class="px-pop">간판 여행 완주!</h1>
              <p>이름만 보고 찾아간 동네, 얼마나 가까웠을까요?</p>
            </div>
            <Hero class="gw-summary-hero" :scale="4" :dir="0" pose="cheer" />
          </div>
          <div class="gw-total"><span>총점</span><b>{{ shownTotal.toLocaleString() }}<small>점</small></b></div>
          <div class="gw-score-track" role="progressbar" aria-label="최종 총점" :aria-valuenow="total" :aria-valuemax="ROUNDS * 5000" aria-valuemin="0">
            <span :style="{ width: (total / (ROUNDS * 5000) * 100) + '%' }"></span>
          </div>
          <p class="gw-total-max">최대 {{ (ROUNDS * 5000).toLocaleString() }}점</p>
        </header>
        <section class="gw-history">
          <span class="gw-tab">이번 여행의 발자국</span>
          <div class="gw-section-heading"><h2>찾아간 간판</h2><span>{{ log.length }}개 간판</span></div>
          <ol class="gw-log">
            <li v-for="(l, i) in log" :key="i">
              <span class="gw-log-round">{{ i + 1 }}</span>
              <div class="gw-log-place">
                <GuessShop class="gw-log-name" :name="l.name" :width="84" bare />
                <span class="gw-log-detail">{{ shortRegion(l.region) }} · {{ kmText(l.km) }}</span>
                <div class="gw-score-track gw-log-track" aria-hidden="true"><span :style="{ width: (l.score / 5000 * 100) + '%' }"></span></div>
              </div>
              <b>{{ l.score.toLocaleString() }}<small>점</small></b>
            </li>
          </ol>
        </section>
        <button class="gw-button gw-start" @click="start">한 번 더 여행하기 <span aria-hidden="true">▶</span></button>
        <Leaderboard game="guess" :score="total" />
      </template>
      <template v-else>
        <header class="gw-intro-hero">
          <div class="gw-intro-sky" aria-hidden="true">
            <i class="gw-moon"></i>
            <i v-for="n in 5" :key="n" class="gw-bld" :class="`b${n}`"></i>
            <i class="gw-walk"></i>
          </div>
          <div class="gw-intro-copy">
            <span class="gw-eyebrow"><span class="gw-mini-pin" aria-hidden="true"></span>전국 간판 위치 퀴즈</span>
            <h1>간판 이름 하나로,<br /><em>여긴 어디게?</em></h1>
            <p>익숙한 이름 속에 숨은 동네의 단서.<br />진짜 간판을 보고 지도 위에 찍어 보세요.</p>
            <div class="gw-trip-facts">
              <span><b>{{ ROUNDS }}</b> 라운드</span>
              <span>라운드당 최대 <b>5,000</b>점</span>
            </div>
          </div>
          <div class="gw-intro-scene" aria-hidden="true">
            <GuessShop name="춘천닭갈비" cat="닭/오리고기 구이/찜" :width="150" />
            <div class="gw-intro-me">
              <span class="gw-think">?</span>
              <Hero :scale="4" :dir="0" pose="idle" />
            </div>
          </div>
        </header>
        <section class="gw-guide">
          <span class="gw-tab">여행 안내</span>
          <div class="gw-guide-heading">
            <img :src="ICON" alt="" draggable="false" />
            <h2>가까이 찍을수록 높은 점수</h2>
          </div>
          <div class="gw-guide-steps">
            <p><b><i>1</i>간판 읽기</b><span>이름과 업종에서 동네의 단서를 찾아요.</span></p>
            <p><b><i>2</i>핀 놓기</b><span>지도를 누르고, 핀을 드래그해 옮겨요.</span></p>
            <p><b><i>3</i>추측하기</b><span>선택한 위치와 정답 사이의 거리를 확인해요.</span></p>
          </div>
          <p class="gw-guide-note">정답은 간판이 있는 시·군·구의 가운데예요.</p>
        </section>
        <button class="gw-button gw-start" :disabled="phase === 'loading'" @click="start">{{ phase === 'loading' ? '간판 고르는 중…' : '간판 여행 시작하기' }} <span aria-hidden="true">▶</span></button>
        <p v-if="error" class="gw-error" role="alert">{{ error }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 놀이판 공용 말씨(남색 판 + 크림 3px 계단 테두리, 주황 이름표, 노랑 강조)에 맞춘 지도 퀴즈 */
.guess {
  --gw-bg: #0b1028;
  --gw-panel: #141b3a;
  --gw-raise: #1d2550;
  --gw-cream: #fff1e8;
  --gw-text: #fff1e8;
  --gw-muted: #b4b8d6;
  --gw-accent: #ffec27;
  --gw-orange: #ffa300;
  --gw-edge: #5f6aa8;
  --gw-frame: 0 -3px 0 var(--gw-cream), 0 3px 0 var(--gw-cream), -3px 0 0 var(--gw-cream), 3px 0 0 var(--gw-cream);
  --gw-drop: 0 9px 0 rgb(0 0 0 / 0.45);
  position: relative;
  min-width: 0;
  padding: 14px;
  color: var(--gw-text);
  background: linear-gradient(#141b3a, #0b1028 420px);
  font-family: var(--game-font, 'Galmuri11 Game', 'Galmuri11', sans-serif);
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-font-smoothing: none;
  container-type: inline-size;
}

.guess *,
.guess *::before,
.guess *::after {
  box-sizing: border-box;
}

.guess h1,
.guess h2,
.guess p {
  margin: 0;
}

.guess img {
  image-rendering: pixelated;
}

.gw-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--gw-orange);
  font-size: 12px;
}

.gw-mini-pin {
  display: inline-block;
  flex: none;
  width: 10px;
  height: 12px;
  background: currentColor;
  clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%);
}

/* 판 위에 걸친 주황 이름표 */
.gw-tab {
  position: absolute;
  bottom: 100%;
  left: 12px;
  z-index: 2;
  margin-bottom: 3px;
  padding: 4px 11px 3px;
  color: #1d1d1f;
  background: var(--gw-orange);
  font-size: 12px;
  line-height: 1.3;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 -3px 0 var(--gw-cream), -3px 0 0 var(--gw-cream), 3px 0 0 var(--gw-cream);
}

/* 지도는 계속 살아 있고, 대기 화면에서는 완전히 숨긴다 */
.map-stage {
  position: relative;
  min-width: 0;
  height: clamp(580px, 76vh, 720px);
  margin: 3px;
  overflow: hidden;
  background: #253c4b;
  box-shadow: var(--gw-frame), var(--gw-drop);
  isolation: isolate;
}

.map-stage.parked {
  position: absolute;
  inset: 14px 14px auto;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}

.map {
  position: absolute;
  inset: 0;
}

.map :deep(.maplibregl-canvas) {
  filter: saturate(0.7) brightness(0.88) contrast(1.05);
}

.map.aim :deep(canvas) {
  cursor: crosshair;
}

.map :deep(.maplibregl-ctrl-bottom-right) {
  max-width: 100%;
}

.map :deep(.maplibregl-ctrl-attrib) {
  max-width: 100%;
  padding-right: 25px;
  border-radius: 0;
  color: #d7dcf0;
  background: rgb(11 16 40 / 0.9);
  font-family: 'Pretendard Variable', Pretendard, sans-serif;
  font-size: 10px;
}

.map :deep(.maplibregl-ctrl-attrib a) {
  color: #d7dcf0;
}

.map :deep(.maplibregl-ctrl-attrib-button::before) {
  filter: invert(1);
}

/* 위아래를 밤빛으로 살짝 덮어 판이 잘 읽히게 */
.gw-map-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgb(11 16 40 / 0.45), transparent 30%, transparent 64%, rgb(11 16 40 / 0.55));
  pointer-events: none;
}

.gw-compass {
  position: absolute;
  top: 14px;
  right: 14px;
  display: grid;
  justify-items: center;
  gap: 2px;
  padding: 5px 9px 7px;
  background: var(--gw-panel);
  box-shadow: var(--gw-frame), 0 6px 0 rgb(0 0 0 / 0.45);
  color: var(--gw-accent);
  font-size: 11px;
  line-height: 1;
  pointer-events: none;
}

.gw-compass i {
  width: 12px;
  height: 16px;
  background: linear-gradient(90deg, var(--gw-cream) 50%, #ff004d 50%);
  clip-path: polygon(50% 0, 100% 100%, 50% 75%, 0 100%);
}

.gw-question {
  position: absolute;
  inset: 16px;
  z-index: 1;
  pointer-events: none;
}

.gw-hud {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 3px 60px 0 3px;
}

.gw-hud-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 10px;
  background: var(--gw-panel);
  box-shadow: var(--gw-frame), 0 6px 0 rgb(0 0 0 / 0.45);
  font-size: 13px;
  white-space: nowrap;
}

.gw-hud-chip > small {
  color: var(--gw-orange);
  font-size: 11px;
}

.gw-hud-chip b {
  color: var(--gw-accent);
  font-size: 16px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.gw-hud-chip b small {
  color: var(--gw-muted);
  font-size: 11px;
}

/* 문제 간판: 남색 판 위에 진짜 가게처럼 선 간판 */
.gw-clue {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 10px;
  width: fit-content;
  min-width: 210px;
  max-width: min(100%, 300px);
  margin: 38px 0 0 3px;
  padding: 16px 16px 12px;
  background:
    linear-gradient(#444b80 0 0) bottom / 100% 34px no-repeat,
    linear-gradient(#1b2352, #2a2f6b);
  box-shadow: var(--gw-frame), var(--gw-drop);
  pointer-events: auto;
}

.gw-clue .gw-tab {
  left: 9px;
}

.guess .gw-category {
  width: 100%;
  padding: 4px 8px;
  background: var(--gw-bg);
  box-shadow: 0 0 0 2px var(--gw-edge);
  color: var(--gw-muted);
  font-size: 11px;
  line-height: 1.5;
  text-align: center;
  word-break: keep-all;
}

.gw-category b {
  color: var(--gw-accent);
  font-weight: 400;
}

/* 지도 위에 선 나와 말풍선 */
.gw-me {
  position: absolute;
  bottom: 70px;
  left: 4px;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  max-width: calc(100% - 230px);
}

.gw-me :deep(.sg-hero) {
  flex: none;
  filter: drop-shadow(0 3px 0 rgb(0 0 0 / 0.35));
}

.guess .gw-hint {
  position: relative;
  margin-bottom: 44px;
  padding: 7px 11px;
  background: var(--gw-cream);
  color: #1d1d2b;
  font-size: 12px;
  line-height: 1.45;
  word-break: keep-all;
  box-shadow: 0 -3px 0 var(--gw-panel), 0 3px 0 var(--gw-panel), -3px 0 0 var(--gw-panel), 3px 0 0 var(--gw-panel), 0 7px 0 rgb(0 0 0 / 0.3);
}

.guess .gw-hint::after {
  content: '';
  position: absolute;
  bottom: 6px;
  left: -12px;
  width: 9px;
  height: 10px;
  background: var(--gw-cream);
  clip-path: polygon(100% 0, 100% 100%, 0 100%);
  filter: drop-shadow(-3px 0 0 var(--gw-panel));
}

.gw-map-key {
  position: absolute;
  bottom: 40px;
  left: 19px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  max-width: calc(100% - 220px);
  padding: 4px 10px;
  background: var(--gw-panel);
  box-shadow: 0 0 0 2px var(--gw-edge);
  color: var(--gw-muted);
  font-size: 11px;
  pointer-events: none;
}

.gw-map-key span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.gw-map-key i {
  width: 9px;
  height: 9px;
  box-shadow: 0 0 0 2px var(--gw-panel);
}

.gw-my-dot {
  background: var(--gw-cream);
}

.gw-answer-dot {
  background: var(--gw-accent);
}

.gw-actions {
  position: absolute;
  right: 19px;
  bottom: 36px;
  z-index: 2;
  max-width: calc(100% - 38px);
}

/* 버튼: 주황 판 + 크림 계단 테두리, 누르면 한 칸 내려간다 */
.guess .gw-button,
.guess :deep(.lb-join button[type='submit']) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 18px;
  min-width: 0;
  min-height: 46px;
  height: auto;
  margin: 3px;
  padding: 10px 22px;
  border: 0;
  border-radius: 0;
  color: #1d1d1f;
  background: var(--gw-orange);
  box-shadow: var(--gw-frame), 0 6px 0 rgb(0 0 0 / 0.45);
  font: inherit;
  font-size: 15px;
  font-weight: 400;
  line-height: 1.4;
  white-space: normal;
  cursor: pointer;
}

.gw-button > span {
  font-size: 11px;
  line-height: 1;
}

.guess .gw-button:hover:not(:disabled),
.guess :deep(.lb-join button[type='submit']:hover:not(:disabled)) {
  background: var(--gw-accent);
  box-shadow: 0 -3px 0 var(--gw-accent), 0 3px 0 var(--gw-accent), -3px 0 0 var(--gw-accent), 3px 0 0 var(--gw-accent), 0 6px 0 rgb(0 0 0 / 0.45);
}

.guess .gw-button:active:not(:disabled),
.guess :deep(.lb-join button[type='submit']:active:not(:disabled)) {
  translate: 0 3px;
  box-shadow: var(--gw-frame);
}

.guess .gw-button:disabled,
.guess :deep(.lb-join button[type='submit']:disabled) {
  color: var(--gw-edge);
  background: var(--gw-panel);
  box-shadow: 0 -3px 0 var(--gw-edge), 0 3px 0 var(--gw-edge), -3px 0 0 var(--gw-edge), 3px 0 0 var(--gw-edge);
  cursor: default;
}

.guess .gw-button:focus-visible,
.guess :deep(button:focus-visible),
.guess :deep(input:focus-visible),
.guess .map :deep(a:focus-visible) {
  outline: 3px solid var(--gw-accent);
  outline-offset: 5px;
}

/* 거리와 점수를 실제 라운드 결과로 표시한다. 픽셀 테두리 상자(pixel.css 의 .px-panel) */
.gw-round-result {
  --line: var(--gw-cream);
  --bg: var(--gw-panel);
  position: absolute;
  right: 3px;
  bottom: 94px;
  width: min(calc(100% - 6px), 340px);
  padding: 14px 18px;
  pointer-events: auto;
  animation: px-pop-in 0.36s steps(1) both;
}

.guess .gw-cheer {
  margin-bottom: 8px;
  color: var(--gw-accent);
  font-size: 20px;
  text-shadow: 3px 3px 0 #000;
}

.gw-distance {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--gw-muted);
}

.gw-distance b {
  color: var(--gw-text);
  font-size: 19px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.guess .gw-where {
  margin-top: 4px;
  color: var(--gw-muted);
  font-size: 12px;
}

.gw-where b {
  color: var(--gw-orange);
  font-weight: 400;
}

.guess .gw-round-points {
  margin: 10px 0 8px;
  color: var(--gw-accent);
  font-size: 34px;
  line-height: 1.15;
  text-shadow: 3px 3px 0 #000;
  font-variant-numeric: tabular-nums;
}

.gw-round-points small {
  margin-left: 3px;
  font-size: 15px;
}

.gw-round-points > span {
  color: var(--gw-muted);
  font-size: 11px;
  text-shadow: none;
}

/* 점수 막대: 칸칸이 차오르는 픽셀 게이지 */
.gw-score-track {
  height: 12px;
  padding: 2px;
  background: #24091a;
  background: var(--gw-bg);
  box-shadow: 0 0 0 2px var(--gw-edge);
}

.gw-score-track > span {
  display: block;
  height: 100%;
  background:
    repeating-linear-gradient(90deg, transparent 0 8px, rgb(0 0 0 / 0.35) 8px 10px),
    linear-gradient(#fff69a 0 40%, var(--gw-accent) 40%);
  transform-origin: left;
  animation: gw-fill 0.65s steps(8) both;
}

.guess .gw-footnote {
  margin-top: 10px;
  color: var(--gw-muted);
  font-size: 10px;
  line-height: 1.6;
}

.gw-sheet {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 40px;
  width: min(100%, 700px);
  min-width: 0;
  margin: auto;
  padding: 34px 14px 14px;
}

/* 시작 화면: 밤거리 앞에 선 간판 가게와 나 */
.gw-intro-hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 18px;
  min-height: 300px;
  overflow: hidden;
  padding: 26px 26px 0;
  background: linear-gradient(#1b2352, #2a2f6b 75%);
  box-shadow: var(--gw-frame), var(--gw-drop);
  isolation: isolate;
}

.gw-intro-sky {
  position: absolute;
  inset: 0;
  z-index: -1;
  background-image:
    radial-gradient(2px 2px at 14% 12%, #fff 50%, transparent 51%),
    radial-gradient(2px 2px at 38% 30%, #ffec27 50%, transparent 51%),
    radial-gradient(2px 2px at 61% 9%, #fff 50%, transparent 51%),
    radial-gradient(2px 2px at 82% 22%, #29adff 50%, transparent 51%),
    radial-gradient(2px 2px at 50% 44%, #fff 50%, transparent 51%);
}

.gw-intro-sky i {
  position: absolute;
  display: block;
}

.gw-moon {
  top: 22px;
  right: 30px;
  width: 30px;
  height: 30px;
  background: #fff1c8;
  box-shadow: 0 0 0 5px rgb(255 241 200 / 0.12), 0 0 0 12px rgb(255 241 200 / 0.06);
  clip-path: polygon(25% 0, 75% 0, 100% 25%, 100% 75%, 75% 100%, 25% 100%, 0 75%, 0 25%);
}

/* 뒤에 늘어선 건물들: 가로줄 벽 + 세로줄 창으로 불 켜진 창문 격자 */
.gw-bld {
  --bc: #121a44;
  --lit: rgb(255 214 107 / 0.45);
  bottom: 34px;
  background:
    repeating-linear-gradient(180deg, var(--bc) 0 7px, transparent 7px 13px) 0 8px / 100% 100% no-repeat,
    repeating-linear-gradient(90deg, var(--bc) 0 6px, var(--lit) 6px 11px);
  box-shadow: inset 0 3px 0 #2f3a7c;
}

.gw-intro-sky .b1 { left: 4%; width: 9%; height: 16%; --lit: rgb(255 214 107 / 0.25); }
.gw-intro-sky .b2 { left: 48%; width: 10%; height: 34%; --bc: #161f4e; --lit: rgb(124 205 255 / 0.35); }
.gw-intro-sky .b3 { left: 57%; width: 13%; height: 56%; }
.gw-intro-sky .b4 { left: 74%; width: 14%; height: 40%; --bc: #161f4e; --lit: rgb(255 140 170 / 0.35); }
.gw-intro-sky .b5 { right: 0; width: 11%; height: 62%; }

.gw-intro-sky .gw-walk {
  inset: auto 0 0;
  height: 34px;
  background:
    linear-gradient(#9aa0c8 0 0) top / 100% 4px no-repeat,
    linear-gradient(#5d6397 0 0) 0 4px / 100% 3px no-repeat,
    repeating-linear-gradient(90deg, transparent 0 30px, #2c3266 30px 33px),
    linear-gradient(#444b80 0 50%, #3c4276 50%);
}

.gw-intro-copy {
  align-self: start;
  max-width: 400px;
  padding-bottom: 50px;
}

.gw-intro-copy h1 {
  margin: 16px 0 12px;
  font-size: clamp(26px, 5cqi, 38px);
  font-weight: 400;
  line-height: 1.25;
  text-shadow: 4px 4px 0 #000;
  word-break: keep-all;
}

.gw-intro-copy h1 em {
  color: var(--gw-accent);
  font-style: normal;
}

.gw-intro-copy p,
.gw-summary-top p {
  color: var(--gw-muted);
  font-size: 13px;
  line-height: 1.7;
}

.gw-trip-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 18px;
  font-size: 12px;
}

.gw-trip-facts span {
  padding: 3px 9px;
  background: var(--gw-bg);
  box-shadow: 0 0 0 2px var(--gw-edge);
  color: var(--gw-muted);
}

.gw-trip-facts b {
  color: var(--gw-accent);
  font-weight: 400;
}

.gw-intro-scene {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding-bottom: 16px;
}

.gw-intro-me {
  position: relative;
  margin-left: -6px;
}

.gw-think {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  min-width: 26px;
  padding: 2px 6px;
  translate: -50% 0;
  background: var(--gw-cream);
  color: var(--gw-panel);
  font-size: 15px;
  text-align: center;
  box-shadow: 0 -2px 0 var(--gw-panel), 0 2px 0 var(--gw-panel), -2px 0 0 var(--gw-panel), 2px 0 0 var(--gw-panel);
  animation: gw-bob 0.8s steps(2) infinite alternate;
}

@keyframes gw-bob {
  to {
    translate: -50% -4px;
  }
}

.gw-guide,
.gw-history,
.gw-summary {
  position: relative;
  padding: 22px;
  background: var(--gw-panel);
  box-shadow: var(--gw-frame), var(--gw-drop);
}

.gw-guide-heading {
  display: flex;
  align-items: center;
  gap: 14px;
}

.gw-guide-heading img {
  flex: none;
  width: 44px;
  height: 44px;
  object-fit: contain;
  image-rendering: auto;
}

.gw-guide-heading h2,
.gw-section-heading h2 {
  font-size: 16px;
  font-weight: 400;
}

.gw-guide-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 18px;
}

.gw-guide-steps p {
  display: grid;
  align-content: start;
  gap: 7px;
  padding: 10px 12px 12px;
  background: var(--gw-bg);
  box-shadow: 0 0 0 2px var(--gw-edge);
}

.gw-guide-steps b {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--gw-accent);
  font-size: 13px;
  font-weight: 400;
}

.gw-guide-steps b i {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  color: var(--gw-panel);
  background: var(--gw-cream);
  box-shadow: inset 0 -3px 0 #c2c3c7;
  font-size: 11px;
  font-style: normal;
}

.gw-guide-steps span {
  color: var(--gw-muted);
  font-size: 12px;
  line-height: 1.7;
  word-break: keep-all;
  overflow-wrap: anywhere;
}

.guess .gw-guide-note {
  margin-top: 16px;
  color: var(--gw-muted);
  font-size: 11px;
}

.guess .gw-start {
  width: calc(100% - 6px);
  justify-content: space-between;
  min-height: 52px;
}

.gw-summary-top {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.gw-summary h1 {
  margin: 4px 0 6px;
  color: var(--gw-accent);
  font-size: clamp(26px, 5cqi, 36px);
  font-weight: 400;
  text-shadow: 4px 4px 0 #000;
}

.gw-summary-hero {
  flex: none;
}

.gw-total {
  display: grid;
  gap: 2px;
  margin: 18px 0 14px;
}

.gw-total > span {
  color: var(--gw-orange);
  font-size: 12px;
}

.gw-total b {
  color: var(--gw-accent);
  font-size: clamp(40px, 8cqi, 58px);
  font-weight: 400;
  line-height: 1.1;
  text-shadow: 4px 4px 0 #000;
  font-variant-numeric: tabular-nums;
}

.gw-total small {
  margin-left: 6px;
  font-size: 18px;
}

.guess .gw-total-max {
  margin-top: 8px;
  color: var(--gw-muted);
  font-size: 11px;
  text-align: right;
}

.gw-section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}

.gw-section-heading > span {
  color: var(--gw-muted);
  font-size: 11px;
}

.gw-log {
  margin: 0;
  padding: 0;
  list-style: none;
}

.gw-log li {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 16px 0;
}

.gw-log li + li {
  border-top: 2px dashed #2b3a78;
}

.gw-log li:last-child {
  padding-bottom: 0;
}

.gw-log-round {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  color: var(--gw-panel);
  background: var(--gw-cream);
  box-shadow: inset 0 -3px 0 #c2c3c7;
  font-size: 12px;
}

.gw-log-place {
  display: grid;
  justify-items: start;
  gap: 6px;
  min-width: 0;
}

.gw-log-name {
  margin: 3px 0 8px 3px;
}

.gw-log-detail {
  color: var(--gw-muted);
  font-size: 11px;
}

.gw-log-track {
  width: 100%;
  max-width: 180px;
  height: 8px;
  margin-top: 2px;
}

.gw-log li > b {
  color: var(--gw-accent);
  font-size: 18px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}

.gw-log li > b small {
  margin-left: 3px;
  font-size: 11px;
}

/* 리더보드도 같은 픽셀 판에 맞춘다(다크 모드 .lb 배경보다 앞서게 두 번 쓴다) */
.guess.guess :deep(.lb) {
  width: calc(100% - 6px);
  min-width: 0;
  gap: 14px;
  margin: 3px;
  padding: 22px;
  border: 0;
  border-radius: 0;
  color: var(--gw-text);
  background: var(--gw-panel);
  box-shadow: var(--gw-frame), var(--gw-drop);
}

.guess :deep(.lb-head) {
  flex-wrap: wrap;
  gap: 6px 12px;
}

.guess :deep(.lb-head strong) {
  color: var(--gw-orange);
  font-size: 16px;
  font-weight: 400;
}

.guess :deep(.muted) {
  color: var(--gw-muted);
}

.guess :deep(.lb-me),
.guess :deep(.lb-me.rec) {
  padding: 10px 12px;
  border: 0;
  border-radius: 0;
  color: var(--gw-accent);
  background: var(--gw-bg);
  box-shadow: 0 0 0 2px var(--gw-accent);
}

.guess :deep(.lb-list li) {
  grid-template-columns: 24px minmax(0, 1fr) auto;
  padding: 9px 6px;
  border-radius: 0;
}

.guess :deep(.lb-list li.me) {
  background: rgb(255 236 39 / 0.1);
}

.guess :deep(.lb-list .no) {
  border-radius: 0;
  color: var(--gw-muted);
  background: var(--gw-raise);
}

.guess :deep(.lb-list .no.n1) {
  color: #1d1d1f;
  background: var(--gw-accent);
}

.guess :deep(.lb-list .who) {
  white-space: normal;
  overflow-wrap: anywhere;
}

.guess :deep(.lb-list .pts) {
  color: var(--gw-accent);
  font-weight: 400;
}

.guess :deep(.lb-join) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.guess :deep(.lb-join input) {
  width: 100%;
  min-width: 0;
  height: 42px;
  padding: 0 12px;
  border: 0;
  border-radius: 0;
  color: var(--gw-text);
  background: var(--gw-bg);
  box-shadow: 0 0 0 2px var(--gw-edge);
  font: inherit;
  font-size: 12px;
}

.guess :deep(.lb-join input::placeholder) {
  color: var(--gw-muted);
}

.guess :deep(.lb-join button[type='submit']) {
  grid-column: 1 / -1;
  width: calc(100% - 6px);
}

.guess :deep(.lb-hint) {
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.guess .gw-error,
.guess :deep(.m-err) {
  color: #ff9db0;
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
  overflow-wrap: anywhere;
}

/* 지도 핀: 깃발 모양 픽셀 표지. anchor 가 bottom 이라 꼬리 끝이 그 자리다 */
.guess :deep(.gw-pin) {
  position: relative;
  display: grid;
  place-items: center;
  width: 30px;
  height: 38px;
  padding-bottom: 8px;
  filter: drop-shadow(0 3px 0 rgb(0 0 0 / 0.45));
}

.guess :deep(.gw-pin span) {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: #1d1d2b;
  background: var(--gw-cream);
  box-shadow: inset 0 0 0 3px #1d1d2b, inset 0 -6px 0 rgb(0 0 0 / 0.15);
  font-family: var(--game-font, 'Galmuri11 Game', 'Galmuri11', sans-serif);
  font-size: 13px;
  line-height: 1;
}

.guess :deep(.gw-pin)::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: calc(50% - 5px);
  width: 10px;
  height: 11px;
  background: #1d1d2b;
  clip-path: polygon(0 0, 100% 0, 50% 100%);
}

.guess :deep(.gw-pin.me) {
  cursor: grab;
}

.guess :deep(.gw-pin.ans span) {
  background: var(--gw-accent);
}

@container (max-width: 560px) {
  .gw-intro-hero {
    grid-template-columns: minmax(0, 1fr);
  }

  .gw-intro-copy {
    padding-bottom: 0;
  }

  .gw-intro-scene {
    justify-self: end;
  }
}

@container (max-width: 500px) {
  .gw-sheet {
    padding: 30px 6px 6px;
  }

  .gw-intro-hero,
  .gw-summary {
    padding-inline: 18px;
  }

  .gw-guide,
  .gw-history,
  .guess :deep(.lb) {
    padding: 18px;
  }

  .gw-guide-steps {
    grid-template-columns: minmax(0, 1fr);
    gap: 12px;
    margin-top: 16px;
  }

  .gw-hud {
    gap: 10px;
  }

  .gw-hud-chip {
    gap: 6px;
    padding: 4px 8px;
  }

  .gw-me {
    display: none;
  }

  .gw-map-key {
    gap: 6px 10px;
    max-width: calc(100% - 190px);
  }

  .gw-log li {
    gap: 10px;
  }

  .gw-log li > b {
    font-size: 16px;
  }
}

@container (max-width: 340px) {
  .gw-hud-chip {
    font-size: 10px;
  }

  .gw-hud-chip b {
    font-size: 14px;
  }

  .gw-map-key {
    bottom: 105px;
    max-width: calc(100% - 38px);
  }

  .gw-round-result {
    bottom: 144px;
  }

  .guess :deep(.lb-join) {
    grid-template-columns: minmax(0, 1fr);
  }
}

@keyframes gw-fill {
  from {
    transform: scaleX(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .gw-round-result,
  .gw-score-track > span,
  .gw-think {
    animation: none;
  }
}
</style>
