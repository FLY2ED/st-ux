<script setup>
// 간판 어디게: 진짜 간판 하나를 보고 전국 지도에서 어디 있는지 찍는다. 정답은 그 간판이 있는 시·군·구의 가운데다
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue'
import { load, nameCount, signPool } from '../data.js'
import { sfx } from '../sound.js'
import { catColor } from './catColor.js'
import { useCountUp } from './countUp.js'
import Leaderboard from './Leaderboard.vue'
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
        <span>북</span>
        <svg viewBox="0 0 32 32"><path d="m16 3 7 23-7-5-7 5Z" fill="currentColor" /><path d="m16 3 0 18-7 5Z" fill="#f1f6f8" /></svg>
      </div>

      <section v-if="sign && (phase === 'guess' || phase === 'reveal')" class="gw-question">
        <div class="gw-hud">
          <span class="gw-hud-chip"><span class="gw-mini-pin" aria-hidden="true"></span>라운드 <b>{{ round }}<small> / {{ ROUNDS }}</small></b></span>
          <span class="gw-hud-chip">총점 <b>{{ total.toLocaleString() }}<small>점</small></b></span>
        </div>
        <div class="gw-clue">
          <span class="gw-eyebrow">이 간판의 동네를 찾아보세요</span>
          <div class="gw-board" :style="{ '--c': sign.color }">{{ sign.name }}</div>
          <p class="gw-category">{{ sign.cat }}<template v-if="sign.count > 1"> · 전국에 같은 이름 {{ sign.count.toLocaleString() }}곳</template></p>
        </div>
        <p v-if="phase === 'guess'" class="gw-hint">{{ guess ? '핀을 드래그해 위치를 조정할 수 있어요' : '지도를 눌러 예상 위치에 핀을 꽂으세요' }}</p>
        <div v-else class="gw-round-result px-panel" aria-live="polite">
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
        <button v-if="phase === 'guess'" class="gw-button" :disabled="!guess" @click="confirm">추측하기 <span aria-hidden="true">↗</span></button>
        <button v-else class="gw-button" @click="after">{{ round >= ROUNDS ? '결과 보기' : '다음 라운드' }} <span aria-hidden="true">→</span></button>
      </div>
    </div>

    <div v-if="phase === 'ready' || phase === 'loading' || phase === 'over'" class="gw-sheet">
      <template v-if="phase === 'over'">
        <header class="gw-summary">
          <span class="gw-eyebrow"><span class="gw-mini-pin" aria-hidden="true"></span>{{ round }} / {{ ROUNDS }} 라운드 완료</span>
          <h1 class="px-pop">간판 여행 완주!</h1>
          <p>이름만 보고 찾아간 동네, 얼마나 가까웠을까요?</p>
          <div class="gw-total"><span>총점</span><b>{{ shownTotal.toLocaleString() }}<small>점</small></b></div>
          <div class="gw-score-track" role="progressbar" aria-label="최종 총점" :aria-valuenow="total" :aria-valuemax="ROUNDS * 5000" aria-valuemin="0">
            <span :style="{ width: (total / (ROUNDS * 5000) * 100) + '%' }"></span>
          </div>
          <p class="gw-total-max">최대 {{ (ROUNDS * 5000).toLocaleString() }}점</p>
        </header>
        <section class="gw-history">
          <div class="gw-section-heading"><h2>이번 여행의 발자국</h2><span>{{ log.length }}개 간판</span></div>
          <ol class="gw-log">
            <li v-for="(l, i) in log" :key="i">
              <span class="gw-log-round">{{ i + 1 }}</span>
              <div class="gw-log-place">
                <span class="gw-log-name">{{ l.name }}</span>
                <span class="gw-log-detail">{{ shortRegion(l.region) }} · {{ kmText(l.km) }}</span>
                <div class="gw-score-track gw-log-track" aria-hidden="true"><span :style="{ width: (l.score / 5000 * 100) + '%' }"></span></div>
              </div>
              <b>{{ l.score.toLocaleString() }}<small>점</small></b>
            </li>
          </ol>
        </section>
        <button class="gw-button gw-start" @click="start">한 번 더 여행하기 <span aria-hidden="true">↗</span></button>
        <Leaderboard game="guess" :score="total" />
      </template>
      <template v-else>
        <header class="gw-intro-hero">
          <svg class="gw-terrain" viewBox="0 0 540 360" fill="none" aria-hidden="true">
            <g stroke="currentColor" stroke-width="1">
              <path d="M150-20C35 50 175 110 90 192S15 300 100 390M192-20C77 50 217 110 132 192S57 300 142 390M234-20C119 50 259 110 174 192S99 300 184 390M276-20C161 50 301 110 216 192S141 300 226 390M318-20C203 50 343 110 258 192S183 300 268 390M360-20C245 50 385 110 300 192S225 300 310 390M402-20C287 50 427 110 342 192S267 300 352 390M444-20C329 50 469 110 384 192S309 300 394 390M486-20C371 50 511 110 426 192S351 300 436 390M528-20C413 50 553 110 468 192S393 300 478 390M570-20C455 50 595 110 510 192S435 300 520 390" />
              <circle cx="330" cy="170" r="80" /><circle cx="330" cy="170" r="108" />
            </g>
            <path d="M245 285c-35-92 158-55 107-147" stroke="#c8ee69" stroke-width="2" stroke-dasharray="5 7" />
            <circle cx="245" cy="285" r="5" fill="#c8ee69" />
            <g transform="translate(332 96)">
              <path d="M20 0C9 0 0 9 0 20c0 15 20 31 20 31s20-16 20-31C40 9 31 0 20 0Z" fill="#c8ee69" />
              <circle cx="20" cy="19" r="7" fill="#101d2a" />
            </g>
          </svg>
          <div class="gw-intro-copy">
            <span class="gw-eyebrow"><span class="gw-mini-pin" aria-hidden="true"></span>전국 간판 위치 퀴즈</span>
            <h1>간판 이름 하나로,<br /><em>여긴 어디게?</em></h1>
            <p>익숙한 이름 속에 숨은 동네의 단서.<br />진짜 간판을 보고 지도 위에 찍어 보세요.</p>
          </div>
          <div class="gw-trip-facts">
            <span><b>{{ ROUNDS }}</b> 라운드</span>
            <span>라운드당 최대 <b>5,000</b>점</span>
          </div>
        </header>
        <section class="gw-guide">
          <div class="gw-guide-heading">
            <img :src="ICON" alt="" draggable="false" />
            <div><span class="gw-eyebrow">여행 안내</span><h2>가까이 찍을수록 높은 점수</h2></div>
          </div>
          <div class="gw-guide-steps">
            <p><b>간판 읽기</b><span>이름과 업종에서 동네의 단서를 찾아요.</span></p>
            <p><b>핀 놓기</b><span>지도를 누르고, 핀을 드래그해 옮겨요.</span></p>
            <p><b>추측하기</b><span>선택한 위치와 정답 사이의 거리를 확인해요.</span></p>
          </div>
          <p class="gw-guide-note">정답은 간판이 있는 시·군·구의 가운데예요.</p>
        </section>
        <button class="gw-button gw-start" :disabled="phase === 'loading'" @click="start">{{ phase === 'loading' ? '간판 고르는 중…' : '간판 여행 시작하기' }} <span aria-hidden="true">↗</span></button>
        <p v-if="error" class="gw-error" role="alert">{{ error }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.guess {
  --gw-bg: #0c1723;
  --gw-panel: #142432;
  --gw-glass: rgba(10, 23, 35, 0.93);
  --gw-line: rgba(182, 208, 218, 0.18);
  --gw-text: #f1f6f8;
  --gw-muted: #b2c3ce;
  --gw-accent: #c8ee69;
  position: relative;
  min-width: 0;
  padding: 12px;
  color: var(--gw-text);
  background: var(--gw-bg);
  font-family: 'Pretendard Variable', Pretendard, sans-serif;
  line-height: 1.5;
  overflow-wrap: anywhere;
  -webkit-font-smoothing: antialiased;
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

.gw-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  color: var(--gw-accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.gw-mini-pin {
  display: inline-block;
  flex: none;
  width: 10px;
  height: 13px;
  border: 2px solid currentColor;
  border-radius: 7px 7px 7px 0;
  transform: rotate(-45deg);
}

/* 지도는 계속 살아 있고, 대기 화면에서는 완전히 숨긴다 */
.map-stage {
  position: relative;
  min-width: 0;
  height: clamp(600px, 76vh, 720px);
  overflow: hidden;
  border: 1px solid var(--gw-line);
  border-radius: 16px;
  background: #253c4b;
  isolation: isolate;
}

.map-stage.parked {
  position: absolute;
  inset: 12px 12px auto;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
}

.map {
  position: absolute;
  inset: 0;
}

.map :deep(.maplibregl-canvas) {
  filter: saturate(0.65) brightness(0.86);
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
  border-radius: 8px 0 0;
  color: #d7e3eb;
  background: var(--gw-glass);
  font-size: 10px;
}

.map :deep(.maplibregl-ctrl-attrib a) {
  color: #d7e3eb;
}

.map :deep(.maplibregl-ctrl-attrib-button::before) {
  filter: invert(1);
}

.gw-map-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(6, 18, 29, 0.4), transparent 32%, transparent 62%, rgba(6, 18, 29, 0.5));
  pointer-events: none;
}

.gw-compass {
  position: absolute;
  top: 16px;
  right: 16px;
  display: grid;
  justify-items: center;
  width: 42px;
  padding: 5px;
  border: 1px solid var(--gw-line);
  border-radius: 24px;
  color: var(--gw-accent);
  background: var(--gw-glass);
  font-size: 10px;
  pointer-events: none;
}

.gw-compass svg {
  width: 26px;
  height: 28px;
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
  gap: 8px;
  margin-right: 56px;
}

.gw-hud-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 8px 14px;
  border: 1px solid var(--gw-line);
  border-radius: 10px;
  color: var(--gw-muted);
  background: var(--gw-glass);
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(14px);
  font-size: 11px;
}

.gw-hud-chip b {
  color: var(--gw-text);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.gw-hud-chip small {
  color: var(--gw-muted);
  font-size: 11px;
  font-weight: 500;
}

.gw-hud-chip .gw-mini-pin {
  color: var(--gw-accent);
}

.gw-clue {
  width: fit-content;
  max-width: min(100%, 420px);
  margin-top: 12px;
  padding: 14px 18px;
  border: 1px solid var(--gw-line);
  border-radius: 12px;
  background: var(--gw-glass);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(14px);
  pointer-events: auto;
}

.gw-board {
  max-width: 100%;
  margin: 8px 0;
  padding-left: 12px;
  border-left: 3px solid var(--c);
  color: var(--gw-text);
  font-size: clamp(23px, 4cqi, 32px);
  font-weight: 800;
  line-height: 1.25;
  letter-spacing: -0.035em;
}

.guess .gw-category {
  color: var(--gw-muted);
  font-size: 11px;
}

.guess .gw-hint {
  position: absolute;
  right: 0;
  bottom: 92px;
  left: 0;
  width: fit-content;
  max-width: 100%;
  margin: auto;
  padding: 8px 14px;
  border: 1px solid var(--gw-line);
  border-radius: 8px;
  color: var(--gw-text);
  background: var(--gw-glass);
  font-size: 12px;
  text-align: center;
}

.gw-map-key {
  position: absolute;
  bottom: 44px;
  left: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  max-width: calc(100% - 220px);
  padding: 8px 12px;
  border: 1px solid var(--gw-line);
  border-radius: 8px;
  color: var(--gw-text);
  background: var(--gw-glass);
  font-size: 11px;
  pointer-events: none;
}

.gw-map-key span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.gw-map-key i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.gw-my-dot {
  background: #f1f6f8;
}

.gw-answer-dot {
  background: var(--gw-accent);
}

.gw-actions {
  position: absolute;
  right: 16px;
  bottom: 36px;
  z-index: 2;
  max-width: calc(100% - 32px);
}

.mac-win .guess .gw-button,
.mac-win .guess :deep(.lb-join button[type='submit']) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  min-width: 0;
  min-height: 50px;
  height: auto;
  padding: 12px 22px;
  border: 1px solid var(--gw-accent);
  border-radius: 10px;
  color: #13200a;
  background: var(--gw-accent);
  box-shadow: 0 5px 18px rgba(0, 0, 0, 0.2);
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  line-height: 1.5;
  white-space: normal;
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
}

.gw-button > span {
  font-size: 20px;
  line-height: 1;
}

.mac-win .guess .gw-button:hover:not(:disabled),
.mac-win .guess :deep(.lb-join button[type='submit']:hover:not(:disabled)) {
  background: #daf69b;
}

.mac-win .guess .gw-button:active:not(:disabled),
.mac-win .guess :deep(.lb-join button[type='submit']:active:not(:disabled)) {
  background: #b9df59;
  transform: translateY(1px);
}

.mac-win .guess .gw-button:disabled,
.mac-win .guess :deep(.lb-join button[type='submit']:disabled) {
  border-color: #526574;
  color: #c4d0d8;
  background: #314454;
  box-shadow: none;
  cursor: default;
}

.mac-win .guess .gw-button:focus-visible,
.mac-win .guess :deep(button:focus-visible),
.mac-win .guess :deep(input:focus-visible),
.guess .map :deep(a:focus-visible) {
  outline: 3px solid var(--gw-accent);
  outline-offset: 4px;
}

/* 거리와 점수를 실제 라운드 결과로 표시한다. 픽셀 테두리 상자(pixel.css 의 .px-panel) */
.gw-round-result {
  --line: var(--gw-accent);
  --bg: #0c1723;
  position: absolute;
  right: 3px;
  bottom: 94px;
  width: min(calc(100% - 6px), 350px);
  padding: 16px 18px;
  pointer-events: auto;
  animation: px-pop-in 0.36s steps(1) both;
}

.guess .gw-cheer {
  margin-bottom: 8px;
  color: var(--gw-accent);
  font-size: 18px;
  text-shadow: 0 3px 0 #000;
}

.gw-distance {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--gw-muted);
}

.gw-distance b {
  color: var(--gw-text);
  font-size: 19px;
  font-variant-numeric: tabular-nums;
}

.guess .gw-where {
  margin-top: 4px;
  color: var(--gw-muted);
  font-size: 12px;
}

.gw-where b {
  color: var(--gw-text);
}

.guess .gw-round-points {
  margin: 10px 0 8px;
  color: var(--gw-accent);
  font-family: var(--game-font);
  font-size: 36px;
  font-weight: 400;
  line-height: 1.15;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
}

.gw-round-points small {
  margin-left: 3px;
  font-size: 15px;
}

.gw-round-points > span {
  color: var(--gw-muted);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0;
}

.gw-score-track {
  height: 6px;
  overflow: hidden;
  border-radius: 99px;
  background: #344653;
}

.gw-score-track > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--gw-accent);
  transform-origin: left;
  animation: gw-fill 0.65s ease-out both;
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
  gap: 18px;
  width: min(100%, 700px);
  min-width: 0;
  margin: auto;
  padding: 12px;
}

.gw-intro-hero {
  position: relative;
  display: grid;
  align-content: space-between;
  min-height: 315px;
  overflow: hidden;
  padding: 28px;
  border: 1px solid var(--gw-line);
  border-radius: 16px;
  background: #142733;
  isolation: isolate;
}

.gw-terrain {
  position: absolute;
  top: -10%;
  right: -20%;
  z-index: -2;
  width: 95%;
  height: 120%;
  color: #36564d;
  opacity: 0.8;
}

.gw-intro-hero::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(90deg, #142733 10%, rgba(20, 39, 51, 0.94) 38%, rgba(20, 39, 51, 0.1));
}

.gw-intro-copy {
  max-width: 440px;
}

.gw-intro-copy h1 {
  margin: 20px 0 14px;
  font-size: clamp(30px, 5.6cqi, 44px);
  font-weight: 800;
  line-height: 1.2;
  letter-spacing: -0.045em;
}

.gw-intro-copy h1 em {
  color: var(--gw-accent);
  font-style: normal;
}

.gw-intro-copy p,
.gw-summary > p {
  color: var(--gw-muted);
  font-size: 13px;
  line-height: 1.7;
}

.gw-trip-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 22px;
  margin-top: 26px;
  color: var(--gw-muted);
  font-size: 12px;
}

.gw-trip-facts b {
  color: var(--gw-text);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.gw-guide,
.gw-history {
  padding: 22px;
  border: 1px solid var(--gw-line);
  border-radius: 14px;
  background: var(--gw-panel);
}

.gw-guide-heading {
  display: flex;
  align-items: center;
  gap: 14px;
}

.gw-guide-heading img {
  flex: none;
  width: 48px;
  height: 48px;
  object-fit: contain;
}

.gw-guide-heading h2,
.gw-section-heading h2 {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.025em;
}

.gw-guide-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
  margin-top: 22px;
}

.gw-guide-steps p {
  display: grid;
  align-content: start;
  gap: 7px;
  padding-top: 12px;
  border-top: 2px solid #446344;
}

.gw-guide-steps b {
  color: var(--gw-accent);
  font-size: 12px;
}

.gw-guide-steps span {
  color: var(--gw-muted);
  font-size: 12px;
  line-height: 1.7;
  word-break: keep-all;
  overflow-wrap: anywhere;
}

.guess .gw-guide-note {
  margin-top: 18px;
  color: var(--gw-muted);
  font-size: 11px;
}

.mac-win .guess .gw-start {
  width: 100%;
  justify-content: space-between;
  min-height: 54px;
}

.gw-summary {
  padding: 26px;
  border: 1px solid var(--gw-line);
  border-radius: 16px;
  background: radial-gradient(ellipse at top right, rgba(200, 238, 105, 0.1), transparent 70%), var(--gw-panel);
}

.gw-summary h1 {
  margin: 14px 0 6px;
  font-size: clamp(28px, 5cqi, 38px);
  font-weight: 800;
  letter-spacing: -0.04em;
}

.gw-total {
  display: grid;
  gap: 2px;
  margin: 24px 0 16px;
}

.gw-total > span {
  color: var(--gw-muted);
  font-size: 12px;
}

.gw-total b {
  color: var(--gw-accent);
  font-family: var(--game-font);
  font-size: clamp(42px, 8cqi, 60px);
  font-weight: 400;
  line-height: 1.1;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
}

.gw-total small {
  margin-left: 6px;
  font-size: 18px;
}

.guess .gw-total-max {
  margin-top: 8px;
  font-size: 11px;
  text-align: right;
}

.gw-section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
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
  border-top: 1px solid var(--gw-line);
}

.gw-log li:last-child {
  padding-bottom: 0;
}

.gw-log-round {
  display: grid;
  place-items: center;
  width: 26px;
  height: 30px;
  border: 1px solid #506942;
  border-radius: 14px 14px 14px 3px;
  color: var(--gw-accent);
  background: rgba(200, 238, 105, 0.06);
  font-size: 11px;
}

.gw-log-place {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.gw-log-name {
  font-size: 14px;
  font-weight: 650;
}

.gw-log-detail {
  color: var(--gw-muted);
  font-size: 11px;
}

.gw-log-track {
  max-width: 180px;
  height: 3px;
  margin-top: 4px;
}

.gw-log li > b {
  color: var(--gw-accent);
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}

.gw-log li > b small {
  margin-left: 3px;
  font-size: 11px;
  font-weight: 500;
}

/* 리더보드도 여행 기록 패널에 맞춘다 */
.guess :deep(.lb) {
  width: 100%;
  min-width: 0;
  gap: 14px;
  padding: 22px;
  border: 1px solid var(--gw-line);
  border-radius: 14px;
  color: var(--gw-text);
  background: var(--gw-panel);
  box-shadow: none;
}

.guess :deep(.lb-head) {
  flex-wrap: wrap;
  gap: 6px 12px;
}

.guess :deep(.lb-head strong) {
  font-size: 16px;
}

.guess :deep(.muted) {
  color: var(--gw-muted);
}

.guess :deep(.lb-me),
.guess :deep(.lb-me.rec) {
  padding: 10px 12px;
  border: 1px solid #506942;
  border-radius: 8px;
  color: var(--gw-accent);
  background: rgba(200, 238, 105, 0.08);
}

.guess :deep(.lb-list li) {
  grid-template-columns: 24px minmax(0, 1fr) auto;
  padding: 9px 6px;
}

.guess :deep(.lb-list li.me) {
  background: rgba(200, 238, 105, 0.08);
}

.guess :deep(.lb-list .no) {
  color: var(--gw-muted);
  background: #293e4c;
}

.guess :deep(.lb-list .no.n1) {
  color: #13200a;
  background: var(--gw-accent);
}

.guess :deep(.lb-list .who) {
  white-space: normal;
  overflow-wrap: anywhere;
}

.guess :deep(.lb-list .pts) {
  color: var(--gw-accent);
  font-weight: 700;
}

.guess :deep(.lb-join) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.mac-win .guess :deep(.lb-join input) {
  width: 100%;
  min-width: 0;
  height: 44px;
  padding: 0 12px;
  border: 1px solid #4a606f;
  border-radius: 8px;
  color: var(--gw-text);
  background: var(--gw-bg);
  box-shadow: none;
  font: inherit;
  font-size: 12px;
}

.guess :deep(.lb-join input::placeholder) {
  color: var(--gw-muted);
}

.guess :deep(.lb-join button[type='submit']) {
  grid-column: 1 / -1;
  width: 100%;
}

.guess :deep(.lb-hint) {
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.guess .gw-error,
.guess :deep(.m-err) {
  color: #ffb9b2;
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
  overflow-wrap: anywhere;
}

.guess :deep(.gw-pin) {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 2px solid #0c1723;
  border-radius: 50% 50% 50% 0;
  transform: rotate(-45deg);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
}

.guess :deep(.gw-pin span) {
  transform: rotate(45deg);
  color: #0c1723;
  font-family: 'Pretendard Variable', Pretendard, sans-serif;
  font-size: 13px;
  font-weight: 800;
}

.guess :deep(.gw-pin.me) {
  background: #f1f6f8;
  cursor: grab;
}

.guess :deep(.gw-pin.ans) {
  background: var(--gw-accent);
}

@container (max-width: 500px) {
  .gw-sheet {
    padding: 4px;
  }

  .gw-intro-hero,
  .gw-summary {
    padding: 22px;
  }

  .gw-terrain {
    right: -35%;
    width: 120%;
    opacity: 0.55;
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

  .gw-guide-steps p {
    grid-template-columns: 60px minmax(0, 1fr);
    gap: 10px;
    padding-top: 10px;
    border-top-width: 1px;
  }

  .gw-clue {
    padding: 12px 14px;
  }

  .gw-hud {
    gap: 6px;
  }

  .gw-hud-chip {
    gap: 6px;
    padding: 7px 9px;
  }

  .gw-map-key {
    gap: 6px 10px;
    max-width: calc(100% - 190px);
    padding: 7px 9px;
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

  .gw-hud-chip .gw-mini-pin {
    display: none;
  }

  .gw-hud-chip b {
    font-size: 14px;
  }

  .gw-map-key {
    bottom: 105px;
    max-width: calc(100% - 32px);
  }

  .gw-round-result {
    bottom: 144px;
  }

  .guess .gw-hint {
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
  .gw-score-track > span {
    animation: none;
  }

  .mac-win .guess .gw-button,
  .mac-win .guess :deep(.lb-join button[type='submit']) {
    transition: none;
  }
}
</style>
