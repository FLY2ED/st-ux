<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import 'maplibre-gl/dist/maplibre-gl.css'
// Vite 가 maplibre 를 미리 묶으면 워커 주소를 잃어서 워커 파일을 따로 넘긴다
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { Protocol } from 'pmtiles'
import { graphDots, load, looksLikeName, nameCount, nearby, search } from '../data.js'
import { enter, openShop, player, shops as sharedShops, where } from '../arcade.js'
import { sfx } from '../sound.js'
import { signsInRadius, tileIndex, tileUrl } from '../tiles.js'
import HandControl from './HandControl.vue'
import NameGraph from './NameGraph.vue'
import PixelShop from './PixelShop.vue'

// mode: 처음 열 단계. '우리 동네'·'내 가게' 앱도 이 창을 그 단계로 연다
// word: 처음부터 찾아 둘 글자(간판 수리공 이야기에서 내 이름을 넣어 연다)
const props = defineProps({
  mode: { type: String, default: 'name' },
  word: { type: String, default: '' },
  // embed: 이야기 안에서 연 '이름 찾기'는 지도 창 대신 잊힘과 맞서는 장면(MapDuel)을 띄운다
  embed: Boolean,
  goal: { type: Number, default: 5 },
  boss: { type: String, default: '' },
  bossName: { type: String, default: '' },
})
const MapDuel = defineAsyncComponent(() => import('./stage/MapDuel.vue'))
const emit = defineEmits(['opened'])

// 탭 없이 지구본 동작으로 단계가 바뀐다: 이름을 찾으면 name, 땅을 누르면 near, '여기에 가게 차리기'를 누르면 shop
const STAGES = ['name', 'near', 'shop']
const validMode = (m) => (STAGES.includes(m) ? m : 'name')
const duel = props.embed && validMode(props.mode) === 'name'
const tab = ref(validMode(props.mode))
watch(
  () => props.mode,
  (m) => (tab.value = validMode(m)),
)

const MAX_FLOORS = 9
const KOREA = [
  [124.6, 33.0],
  [130.9, 38.7],
]
const inKorea = (lng, lat) => lng >= KOREA[0][0] && lng <= KOREA[1][0] && lat >= KOREA[0][1] && lat <= KOREA[1][1]
// 지구 전체가 보이는 자리. 한국이 가운데 오게 돌려 둔다
const WORLD = { center: [127.8, 30], zoom: 1.4 }
// 바탕 지도 없이 간판 점만으로 지구본을 그린다. 색은 흑백에 강조색 하나(찾은 간판·내 자리)
const HOT = '#ff4f00'
const isDark = () => document.documentElement.classList.contains('dark')
const ink = () => (isDark() ? '#f2f2f2' : '#111111')
// 공 표면 색. 공 밖(우주)은 CSS 바탕색이 비쳐서 둘을 조금 다르게 둔다
const paper = () => (isDark() ? '#151517' : '#ffffff')
// 글자 모양(글리프)만 OpenFreeMap에서 받는다. 한글은 localIdeographFontFamily로 브라우저 글꼴을 쓴다
const blankStyle = () => ({
  version: 8,
  projection: { type: 'globe' },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': paper() } }],
})

// 지구본에 15도마다 긋는 경위선. 땅 모양 없이도 공이 도는 게 보인다
function graticule() {
  const lines = []
  for (let lng = -180; lng < 180; lng += 15) {
    const c = []
    for (let lat = -80; lat <= 80; lat += 4) c.push([lng, lat])
    lines.push(c)
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const c = []
    for (let lng = -180; lng <= 180; lng += 4) c.push([lng, lat])
    lines.push(c)
  }
  return { type: 'FeatureCollection', features: lines.map((coordinates) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: {} })) }
}
const SUGGEST = ['민수', '지은', '행복', '사랑', '하늘']

const query = ref('')
const result = ref(null)
// 별자리 점(말마다 전국에서 고르게 뽑은 최대 1000곳). 색인에 없는 말이면 null
const dots = shallowRef(null)
const floors = ref([])
const busy = ref(false)
const error = ref('')
const view = ref('map')
const built = shallowRef([])
const picked = ref(null)
const mapEl = ref(null)
const ready = ref(false)
let map = null
let maplibre = null
let popup = null

const candidates = computed(() => {
  if (!result.value) return []
  const withFloor = result.value.rows.filter((r) => r.floor !== null)
  const exact = withFloor.filter((r) => r.exact)
  return exact.length >= 3 ? exact : withFloor
})

function build() {
  const byFloor = new Map()
  for (const row of [...candidates.value].sort(() => Math.random() - 0.5)) {
    if (!byFloor.has(row.floor)) byFloor.set(row.floor, row)
  }
  const chosen = [...byFloor.values()]
    .sort(() => Math.random() - 0.5)
    .slice(0, MAX_FLOORS)
    .sort((a, b) => b.floor - a.floor)
  built.value = chosen
  floors.value = []
  chosen
    .slice()
    .reverse()
    .forEach((row, i) => {
      setTimeout(() => {
        floors.value = [row, ...floors.value]
        sfx.build(i)
      }, i * 140)
    })
}

async function submit(word = query.value) {
  word = word.trim()
  query.value = word
  error.value = ''
  if (!/[가-힣]{2}/.test(word)) {
    error.value = '한글 두 글자 이상 넣어 주세요'
    return
  }
  busy.value = true
  picked.value = null
  tab.value = 'name'
  try {
    const [found, graph] = await Promise.all([search(word), graphDots(word).catch(() => null)])
    result.value = found
    dots.value = graph
    if (!listed.value.length) error.value = '그 글자가 들어간 간판을 못 찾았어요'
    // 찾으면 먼저 이름 별자리로 보여 준다. 지도는 '장소'에서
    else view.value = 'graph'
    if (candidates.value.length) build()
    window.dispatchEvent(new CustomEvent('game:over', { detail: { game: 'map', score: listed.value.length, word } }))
  } catch {
    error.value = '데이터를 못 불러왔어요'
  } finally {
    busy.value = false
  }
}

const listed = computed(() => {
  if (!result.value) return []
  const seen = new Set()
  return result.value.rows
    .filter((r) => r.exact && !seen.has(r.name + r.region) && seen.add(r.name + r.region))
    .map((r) => {
      const i = r.name.indexOf(result.value.word)
      return {
        ...r,
        key: r.name + r.region + r.floor,
        short: r.region.split(' ').slice(-1)[0],
        parts: [r.name.slice(0, i), result.value.word, r.name.slice(i + result.value.word.length)],
        accident: !looksLikeName(r.name, result.value.word),
      }
    })
    .sort((a, b) => a.accident - b.accident)
})

// 자료의 위치는 시·군·구 한가운데뿐이라 핀은 동네마다 하나씩 꽂는다
const towns = computed(() => {
  const by = new Map()
  for (const r of listed.value) {
    if (!by.has(r.region)) by.set(r.region, { region: r.region, short: r.short, lng: r.lng, lat: r.lat, rows: [] })
    by.get(r.region).rows.push(r)
  }
  return [...by.values()].sort((a, b) => b.rows.length - a.rows.length)
})

const floorLabel = (f) => (f === null || f === undefined ? '' : f < 0 ? `지하 ${-f}층` : `${f}층`)
const floorShort = (f) => (f < 0 ? `B${-f}` : `${f}F`)

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

// ── 이름 별자리: 찾은 동네마다 땅에서 실을 세워 공중에 별(카드)을 띄우고, 가까운 별끼리 선으로 잇는다 ──
const stars = shallowRef([])
const links = shallowRef([])
let starRaf = 0

// 가까운 동네끼리 잇는 최소 신장 트리(동네가 수십 곳이라 단순하게 Prim)
function linkTowns(list) {
  if (list.length < 2) return []
  const d = (a, b) => (a.lng - b.lng) ** 2 + (a.lat - b.lat) ** 2
  const inTree = [0]
  const edges = []
  while (inTree.length < list.length) {
    let best = null
    for (const i of inTree)
      for (let j = 0; j < list.length; j++) {
        if (inTree.includes(j)) continue
        const w = d(list[i], list[j])
        if (!best || w < best[2]) best = [i, j, w]
      }
    edges.push([best[0], best[1]])
    inTree.push(best[1])
  }
  return edges
}

// 화면 위치를 다시 잡는다. 지구 뒤편으로 넘어간 동네는 감춘다
function placeStars() {
  starRaf = 0
  if (!map || tab.value !== 'name' || !towns.value.length) {
    stars.value = []
    return
  }
  const c = map.getCenter()
  const z = map.getZoom()
  const cards = z < 4 ? 4 : z < 7 ? 8 : 14
  const r = Math.PI / 180
  // 이름 카드는 겹치거나 검색창 밑으로 들어가면 빼고 별만 남긴다
  const boxes = []
  const free = (x, y) => {
    const b = [x - 70, y - 46, x + 70, y + 4]
    if (b[1] < 64 || boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) return false
    boxes.push(b)
    return true
  }
  stars.value = towns.value.map((t, i) => {
    const facing = Math.sin(c.lat * r) * Math.sin(t.lat * r) + Math.cos(c.lat * r) * Math.cos(t.lat * r) * Math.cos((t.lng - c.lng) * r)
    const p = map.project([t.lng, t.lat])
    const lift = 30 + (i % 3) * 18
    const hidden = facing < 0.2
    const y = p.y - lift
    return { t, i, gx: p.x, gy: p.y, x: p.x, y, hidden, card: !hidden && i < cards && free(p.x, y) }
  })
}
const queueStars = () => (starRaf ||= requestAnimationFrame(placeStars))

function drawPins() {
  if (!map) return
  links.value = linkTowns(towns.value)
  placeStars()
  if (tab.value !== 'name') return
  popup?.remove()
  fitTowns()
}

function fitTowns() {
  if (!towns.value.length) return
  const b = new maplibre.LngLatBounds()
  for (const t of towns.value) b.extend([t.lng, t.lat])
  map.fitBounds(b, { padding: pad(80), maxZoom: 11, duration: 900 })
}

function panelWidth() {
  return mapEl.value && mapEl.value.offsetWidth > 620 ? 320 : 0
}

// 넓은 창은 왼쪽 패널, 좁은 창은 아래 시트(높이 55%)를 비켜서 맞춘다
// 위쪽은 검색창(약 54px)만큼 더 비운다
function pad(n) {
  if (panelWidth()) return { top: n + 44, bottom: n, left: panelWidth() + n - 20, right: n }
  return { top: n + 44, bottom: (mapEl.value?.offsetHeight || 0) * 0.55 + n / 2, left: n / 2, right: n / 2 }
}

function pick(town) {
  picked.value = town.region
  sfx.click()
  if (!map) return
  map.flyTo({ center: [town.lng, town.lat], zoom: Math.max(map.getZoom(), 11.5), offset: [panelWidth() / 2, 40], duration: 900 })
  popup?.remove()
  const items = town.rows
    .slice(0, 6)
    .map((r) => `<li><i></i><b>${esc(r.name)}</b><small>${esc(r.cat)}${r.floor !== null ? ` · ${floorLabel(r.floor)}` : ''}</small></li>`)
    .join('')
  const more = town.rows.length > 6 ? `<p>외 ${town.rows.length - 6}곳</p>` : ''
  popup = new maplibre.Popup({ anchor: 'top', offset: 12, closeButton: false, className: 'am-pop', maxWidth: '260px' })
    .setLngLat([town.lng, town.lat])
    .setHTML(`<h4>${esc(town.region)}</h4><ul>${items}</ul>${more}`)
    .addTo(map)
}

// ── 지도 위 GeoJSON 도우미 ──────────────────────────────────────
const KX = (lat) => 111320 * Math.cos((lat * Math.PI) / 180)
const KY = 110540
const fc = (features) => ({ type: 'FeatureCollection', features })
const point = (lng, lat, properties = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties })
function ring(c, r) {
  const pts = []
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * 2 * Math.PI
    pts.push([c.lng + (Math.cos(a) * r) / KX(c.lat), c.lat + (Math.sin(a) * r) / KY])
  }
  return fc([{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} }])
}
function ringBounds(c, r) {
  const dx = r / KX(c.lat)
  const dy = r / KY
  return [
    [c.lng - dx, c.lat - dy],
    [c.lng + dx, c.lat + dy],
  ]
}
const setData = (id, data) => map?.getSource(id)?.setData(data)

// ── 전국 간판 277만 곳: 시도별 PMTiles. 멀리선 덜어 낸 점(overview), 골목까지 당기면(z14~) 한 곳도 빼지 않고 다 ──
const DETAIL_Z = 14
let signDots = []
let signLabels = []
const signsReady = ref(false)
const signTotal = ref(0)
const inView = ref(null)
const zoomed = ref(false)

// 지구본에서 볼 때(z5 아래)는 2km 칸마다 간판 수를 모은 점(map.json)으로 한국을 그린다. 멀리선 강조색으로 빛난다
let cellPts = []
const cellColor = () => ['interpolate', ['linear'], ['zoom'], 2, HOT, 4.2, ink()]

async function setupSigns() {
  const [idx, cats, grid] = await Promise.all([tileIndex(), load('cats.json'), load('map.json')])
  if (!map) return
  signTotal.value = idx.total
  const before = 'near-fill'
  const attribution = '소상공인시장진흥공단 상가(상권)정보'
  const half = grid.step / 2
  cellPts = grid.cells.map(([x, y, n]) => ({ lng: x * grid.step + half, lat: y * grid.step + half, n }))
  map.addSource('cells', { type: 'geojson', data: fc(cellPts.map((c) => point(c.lng, c.lat, { n: c.n }))), attribution })
  map.addLayer(
    {
      id: 'cells',
      type: 'circle',
      source: 'cells',
      maxzoom: 5.2,
      paint: {
        'circle-color': cellColor(),
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['interpolate', ['linear'], ['get', 'n'], 1, 0.5, 2000, 1.4], 4.5, ['interpolate', ['linear'], ['get', 'n'], 1, 0.8, 2000, 2.4]],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 4.2, 0.9, 5.2, 0],
      },
    },
    before,
  )
  map.addSource('sign-ov', { type: 'vector', url: 'pmtiles://' + tileUrl('overview'), attribution })
  map.addLayer(
    {
      id: 'sign-ov',
      type: 'circle',
      source: 'sign-ov',
      'source-layer': 's',
      maxzoom: DETAIL_Z,
      paint: { 'circle-color': ink(), 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 8, 0.9, 11, 1.5, 13.9, 2.2] },
    },
    before,
  )
  Object.keys(idx.regions).forEach((name, i) => {
    const src = `sign-${i}`
    map.addSource(src, { type: 'vector', url: 'pmtiles://' + tileUrl(name), bounds: idx.regions[name].bounds, attribution })
    map.addLayer({ id: `${src}-dot`, type: 'circle', source: src, 'source-layer': 's', minzoom: DETAIL_Z }, before)
    map.addLayer(
      {
        id: `${src}-name`,
        type: 'symbol',
        source: src,
        'source-layer': 's',
        minzoom: 16,
        layout: {
          'text-field': ['get', 'n'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-anchor': 'top',
          'text-offset': [0, 0.6],
          'text-max-width': 8,
          'text-optional': true,
        },
        paint: { 'text-halo-width': 1.4 },
      },
      before,
    )
    signDots.push(`${src}-dot`)
    signLabels.push(`${src}-name`)
  })
  for (const id of signDots) {
    map.on('click', id, (e) => {
      if (tab.value === 'shop') return
      const f = e.features?.[0]
      if (!f) return
      const cat = cats[f.properties.c] || ''
      const fl = f.properties.f
      showPop(f.geometry.coordinates, `<h4>${esc(f.properties.n)}</h4><p>${esc(cat)}${fl != null ? ` · ${floorLabel(fl)}` : ''}</p>`, 8)
    })
    map.on('mouseenter', id, () => tab.value !== 'shop' && (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', id, () => (map.getCanvas().style.cursor = tab.value === 'shop' ? 'crosshair' : ''))
  }
  map.on('moveend', countView)
  map.on('idle', countView)
  signsReady.value = true
  applySigns()
}

// 이름 찾기 중이면 그 글자가 든 간판만 강조색으로 띄우고 나머지 점은 흐린 전국 윤곽으로 남긴다.
// 덜어 낸 전국 점(overview)엔 이름이 없어서 동네까지 당겨야 찾은 간판이 다 보인다
// 왼쪽 패널은 보여 줄 것이 있을 때만 뜬다
const graphOn = computed(() => tab.value === 'name' && view.value === 'graph' && !!(result.value && listed.value.length))
const showPanel = computed(() => (tab.value === 'name' ? !!(result.value && listed.value.length) && !graphOn.value : true))

const signWord = computed(() => (tab.value === 'name' && result.value?.word) || '')
function applySigns() {
  if (!signsReady.value || !map) return
  const w = signWord.value
  const hit = ['in', w, ['get', 'n']]
  const on = (a, b) => (w ? ['case', hit, a, b] : b)
  map.setPaintProperty('sign-ov', 'circle-opacity', ['interpolate', ['linear'], ['zoom'], 4.2, 0, 5, w ? 0.22 : 0.5, 11, w ? 0.3 : 0.85])
  for (const id of signLabels) {
    map.setFilter(id, w ? hit : null)
    map.setLayerZoomRange(id, w ? 14 : 16, 24)
    map.setPaintProperty(id, 'text-color', w ? HOT : ink())
    map.setPaintProperty(id, 'text-halo-color', paper())
  }
  for (const id of signDots) {
    map.setLayoutProperty(id, 'circle-sort-key', on(1, 0))
    map.setPaintProperty(id, 'circle-color', on(HOT, ink()))
    map.setPaintProperty(id, 'circle-opacity', on(1, w ? 0.25 : 0.9))
    map.setPaintProperty(id, 'circle-radius', ['interpolate', ['linear'], ['zoom'], 14, on(5, 2.2), 16, on(7, 3.4), 18, on(9, 5.5)])
    map.setPaintProperty(id, 'circle-stroke-color', paper())
    map.setPaintProperty(id, 'circle-stroke-width', ['interpolate', ['linear'], ['zoom'], 14, on(1.5, 0.4), 16, on(1.5, 1)])
  }
  countView()
}
watch(signWord, applySigns)

// 다크·라이트가 바뀌면 바탕과 점 색만 갈아 끼운다
function applyTheme() {
  if (!map || !ready.value) return
  map.setPaintProperty('bg', 'background-color', paper())
  map.setPaintProperty('grid', 'line-color', ink())
  if (signsReady.value) {
    map.setPaintProperty('sign-ov', 'circle-color', ink())
    map.setPaintProperty('cells', 'circle-color', cellColor())
  }
  for (const id of ['near-fill', 'near-line']) map.setPaintProperty(id, id.endsWith('fill') ? 'fill-color' : 'line-color', ink())
  for (const id of ['near-dot', 'rival-dot', 'near-me']) map.setPaintProperty(id, 'circle-stroke-color', paper())
  map.setPaintProperty('rival-dot', 'circle-color', ink())
  paintNearDots()
  applySigns()
}

// 지금 화면에 보이는 '그 글자' 간판 수. 칸 가장자리에 겹쳐 담긴 점은 자리로 한 번만 센다
function countView() {
  if (!map) return
  zoomed.value = map.getZoom() >= DETAIL_Z
  if (!signsReady.value || !signWord.value || !zoomed.value) {
    inView.value = null
    return
  }
  const seen = new Set()
  for (const f of map.queryRenderedFeatures({ layers: signDots, filter: ['in', signWord.value, ['get', 'n']] })) {
    const [x, y] = f.geometry.coordinates
    seen.add(`${f.properties.n}|${x.toFixed(5)}|${y.toFixed(5)}`)
  }
  inView.value = seen.size
}

// 핀은 시·군·구 한가운데라 거기로 당기면 빈 들판일 수 있다. 핀 둘레 3km 타일을 읽어 진짜 그 간판 자리로 날아간다
const jumping = ref(false)
async function zoomInto() {
  const w = result.value?.word
  if (!w || !map) return
  jumping.value = true
  const first = towns.value.find((x) => x.region === picked.value)
  const order = [first, ...towns.value.filter((t) => t !== first)].filter(Boolean).slice(0, 4)
  let hit = null
  for (const t of order) {
    const rows = await signsInRadius(t.lng, t.lat, 3000).catch(() => [])
    const found = rows.filter((r) => r.name.includes(w))
    if (found.length) {
      const d = (r) => (r.lng - t.lng) ** 2 + (r.lat - t.lat) ** 2
      hit = found.sort((a, b) => d(a) - d(b))[0]
      picked.value = t.region
      break
    }
  }
  jumping.value = false
  if (!map) return
  popup?.remove()
  if (hit) {
    map.flyTo({ center: [hit.lng, hit.lat], zoom: 15.5, offset: [panelWidth() / 2, 0], duration: 1100 })
    map.once('moveend', () => showPop([hit.lng, hit.lat], `<h4>${esc(hit.name)}</h4><p>${esc(hit.floor != null ? floorLabel(hit.floor) : '진짜 자리')}</p>`, 10))
  } else if (order[0]) map.flyTo({ center: [order[0].lng, order[0].lat], zoom: DETAIL_Z, offset: [panelWidth() / 2, 0], duration: 1000 })
}

const NEAR_LAYERS = ['near-fill', 'near-line', 'near-dot', 'near-me-halo', 'near-me']
const SHOP_LAYERS = ['rival-fill', 'rival-line', 'rival-dot']

function setupLayers() {
  map.addSource('grid', { type: 'geojson', data: graticule() })
  map.addLayer({
    id: 'grid',
    type: 'line',
    source: 'grid',
    maxzoom: 7,
    paint: { 'line-color': ink(), 'line-width': 0.6, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 1, 0.16, 5, 0.1, 7, 0] },
  })
  for (const id of ['near-area', 'near-dots', 'near-me', 'rival-area', 'rival-dots']) map.addSource(id, { type: 'geojson', data: fc([]) })
  const dot = (id, source, extra = {}) =>
    map.addLayer({
      id,
      type: 'circle',
      source,
      paint: {
        'circle-color': ink(),
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 2.2, 16, 4.5],
        'circle-stroke-color': paper(),
        'circle-stroke-width': 1,
        ...extra,
      },
    })
  map.addLayer({ id: 'near-fill', type: 'fill', source: 'near-area', paint: { 'fill-color': ink(), 'fill-opacity': 0.04 } })
  map.addLayer({ id: 'near-line', type: 'line', source: 'near-area', paint: { 'line-color': ink(), 'line-opacity': 0.5, 'line-width': 1.2, 'line-dasharray': [2, 2] } })
  dot('near-dot', 'near-dots')
  map.addLayer({ id: 'near-me-halo', type: 'circle', source: 'near-me', paint: { 'circle-color': HOT, 'circle-opacity': 0.22, 'circle-radius': 16 } })
  map.addLayer({ id: 'near-me', type: 'circle', source: 'near-me', paint: { 'circle-color': HOT, 'circle-radius': 6.5, 'circle-stroke-color': paper(), 'circle-stroke-width': 2.5 } })
  map.addLayer({ id: 'rival-fill', type: 'fill', source: 'rival-area', paint: { 'fill-color': HOT, 'fill-opacity': 0.05 } })
  map.addLayer({ id: 'rival-line', type: 'line', source: 'rival-area', paint: { 'line-color': HOT, 'line-width': 1.2, 'line-dasharray': [2, 2] } })
  dot('rival-dot', 'rival-dots', { 'circle-radius': 6 })

  map.on('click', 'near-dot', (e) => {
    const id = e.features?.[0]?.properties?.id
    const s = nearItems.value.find((x) => x.id === id)
    if (s) focusNear(s, false)
  })
  for (const id of ['near-dot', 'rival-dot']) {
    map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''))
  }
  map.on('click', 'rival-dot', (e) => {
    const p = e.features?.[0]?.properties
    if (p) showPop([e.lngLat.lng, e.lngLat.lat], `<h4>${esc(p.name)}</h4><p>${esc(p.cat)} · ${p.dist}m</p>`, 10)
  })
}

function showPop(lngLat, html, offset = 12) {
  popup?.remove()
  popup = new maplibre.Popup({ offset, closeButton: false, className: 'am-pop', maxWidth: '240px' }).setLngLat(lngLat).setHTML(html).addTo(map)
}

// 탭마다 보이는 것만 남긴다
function showMarkers() {
  queueStars()
  for (const m of shopMarkers) m.getElement().style.display = tab.value === 'shop' ? '' : 'none'
  if (spotMarker) spotMarker.getElement().style.display = tab.value === 'shop' ? '' : 'none'
}

function applyTab() {
  if (!map || !ready.value) return
  for (const id of NEAR_LAYERS) map.setLayoutProperty(id, 'visibility', tab.value === 'near' ? 'visible' : 'none')
  for (const id of SHOP_LAYERS) map.setLayoutProperty(id, 'visibility', tab.value === 'shop' ? 'visible' : 'none')
  map.getCanvas().style.cursor = tab.value === 'shop' ? 'crosshair' : ''
  showMarkers()
}

// ── 우리 동네: 진짜 위치(허락했을 때) > 대략 위치(IP) > 예시 장소 ─────────
const SPOTS = [
  { label: '강남역', lng: 127.0276, lat: 37.4979 },
  { label: '홍대입구', lng: 126.9237, lat: 37.5572 },
  { label: '서면', lng: 129.0597, lat: 35.1579 },
  { label: '제주시청', lng: 126.5312, lat: 33.4996 },
]
const RADIUS = 800
const here = ref(null)
const nearItems = shallowRef([])
const nearBusy = ref(false)
const nearErr = ref('')
const approx = ref(null)
const geoGranted = ref(false)
const focus = ref(null)
const nearSample = ref(false)
const nearShown = ref(80)
const HERE_NOTE = {
  precise: '기기에서 받은 내 위치',
  ip: '인터넷 주소로 짐작한 대략 위치라 몇 km 어긋날 수 있어요',
  spot: '예시 장소예요. 내 위치가 아니에요',
  pick: '지도에서 고른 자리 둘레예요',
}

async function scanAt(spot) {
  nearBusy.value = true
  nearErr.value = ''
  focus.value = null
  popup?.remove()
  here.value = spot
  nearItems.value = []
  nearShown.value = 80
  tab.value = 'near'
  try {
    let rows = await nearby(spot.lng, spot.lat, RADIUS)
    // 지도에서 고른 자리는 점 묶음(약 2km 칸) 한가운데라 간판에서 비켜날 수 있다. 가장 가까운 간판 쪽으로 옮겨 다시 모은다
    if (!rows.length && spot.kind === 'pick') {
      const pts = await signsInRadius(spot.lng, spot.lat, 2000).catch(() => [])
      const kx0 = KX(spot.lat)
      const near = pts.reduce((b, s) => {
        const d = Math.hypot((s.lng - spot.lng) * kx0, (s.lat - spot.lat) * KY)
        return !b || d < b.d ? { s, d } : b
      }, null)
      if (near) {
        spot = { ...spot, lng: near.s.lng, lat: near.s.lat }
        here.value = spot
        rows = await nearby(spot.lng, spot.lat, RADIUS)
      }
    }
    const kx = KX(spot.lat)
    nearItems.value = rows.map((s, i) => ({ ...s, id: i, lng: spot.lng + s.dx / kx, lat: spot.lat + s.dy / KY }))
    nearSample.value = !!rows.sample
    if (!rows.length) nearErr.value = '이 근처엔 등록된 간판이 없어요. 예시 장소를 눌러 보세요'
    else sfx.bell()
  } catch {
    nearItems.value = []
    nearErr.value = '데이터를 못 불러왔어요'
  }
  nearBusy.value = false
  drawNear(true)
}

function locate() {
  if (!navigator.geolocation) {
    nearErr.value = '이 브라우저는 위치를 못 가져와요'
    return
  }
  nearBusy.value = true
  nearErr.value = ''
  tab.value = 'near'
  navigator.geolocation.getCurrentPosition(
    (p) => {
      geoGranted.value = true
      scanAt({ lng: p.coords.longitude, lat: p.coords.latitude, label: '내 위치', kind: 'precise' })
    },
    (e) => {
      nearBusy.value = false
      nearErr.value =
        e.code === 1
          ? '위치를 허용하지 않았어요. 주소창의 사이트 설정에서 위치를 켜거나 예시 장소를 눌러 보세요'
          : '위치를 못 잡았어요. 잠시 뒤 다시 해 주세요'
    },
    { timeout: 10000, enableHighAccuracy: true },
  )
}

function useApprox() {
  const a = approx.value
  if (a) scanAt({ lng: a.lng, lat: a.lat, label: a.city ? `${a.city} 부근` : '대략 위치', kind: 'ip' })
}

function drawNear(fly) {
  if (!ready.value) return
  const h = here.value
  setData('near-area', h ? ring(h, RADIUS) : fc([]))
  setData('near-me', h ? fc([point(h.lng, h.lat)]) : fc([]))
  setData('near-dots', fc(nearItems.value.map((s) => point(s.lng, s.lat, { id: s.id }))))
  if (fly && h && tab.value === 'near') map.fitBounds(ringBounds(h, RADIUS), { padding: pad(50), duration: 1000 })
}

function focusNear(s, fly = true) {
  focus.value = s.id
  sfx.click()
  if (fly) map?.easeTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 15.5), offset: [panelWidth() / 2, 30], duration: 700 })
  showPop([s.lng, s.lat], `<h4>${esc(s.name)}</h4><p>${esc(s.cat)} · ${s.dist}m</p>`)
}

// 고른 가게 하나만 강조색, 나머지는 흑백 점
function paintNearDots() {
  if (!ready.value) return
  const hit = ['==', ['get', 'id'], focus.value ?? -1]
  map.setPaintProperty('near-dot', 'circle-color', ['case', hit, HOT, ink()])
  map.setPaintProperty('near-dot', 'circle-stroke-width', ['case', hit, 2.5, 1])
  map.setLayoutProperty('near-dot', 'circle-sort-key', ['case', hit, 1, 0])
  map.setPaintProperty('near-dot', 'circle-radius', ['interpolate', ['linear'], ['zoom'], 12, ['case', hit, 6, 2.2], 16, ['case', hit, 10, 4.5]])
}
watch(focus, paintNearDots)

// 지구본을 누른 자리. 멀리서 누르면 손가락 둘레(40px) 안에서 간판이 가장 많은 칸으로 붙여 준다
const notice = ref('')
let noticeTimer = 0
function say(text) {
  notice.value = text
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), 2600)
}

function snapToSigns(e) {
  if (map.getZoom() >= 11 || !cellPts.length) return e.lngLat
  let best = null
  for (const c of cellPts) {
    if (Math.abs(c.lng - e.lngLat.lng) > 3 || Math.abs(c.lat - e.lngLat.lat) > 3) continue
    const p = map.project([c.lng, c.lat])
    if (Math.hypot(p.x - e.point.x, p.y - e.point.y) > 40) continue
    if (!best || c.n > best.n) best = c
  }
  return best
}

function onMapClick(e) {
  if (tab.value === 'shop') {
    if (map.queryRenderedFeatures(e.point, { layers: ['rival-dot'] }).length) return
    setSpot(e.lngLat)
    return
  }
  if (map.queryRenderedFeatures(e.point, { layers: ['near-dot', ...signDots].filter((id) => map.getLayer(id)) }).length) return
  const { lng, lat } = e.lngLat
  if (!inKorea(lng, lat)) {
    say('간판 자료는 한국에만 있어요. 한국으로 데려갈게요')
    home()
    return
  }
  const at = snapToSigns(e)
  if (!at) {
    say('여긴 간판이 없어요. 점이 모인 곳을 눌러 보세요')
    return
  }
  scanAt({ lng: at.lng, lat: at.lat, label: '고른 곳', kind: 'pick' })
}

// 별자리에서 고른 동네를 지도로 연다
function graphTown(region) {
  view.value = 'map'
  const t = towns.value.find((x) => x.region === region)
  if (t) setTimeout(() => pick(t), 50)
}

// 동네에서 바로 가게 차리기로 넘어간다. 자리는 지금 보는 동네 한가운데
function goShop() {
  if (here.value) setSpot(here.value)
  tab.value = 'shop'
}

function clearName() {
  result.value = null
  query.value = ''
  error.value = ''
  picked.value = null
  view.value = 'map'
  popup?.remove()
}

const nearBars = computed(() => {
  const m = new Map()
  for (const s of nearItems.value) m.set(s.cat, (m.get(s.cat) || 0) + 1)
  const top = [...m].sort((a, b) => b[1] - a[1]).slice(0, 4)
  const max = top[0]?.[1] || 1
  return top.map(([cat, n]) => ({ cat, n, w: Math.max(6, (n / max) * 100) }))
})

// ── 내 가게: 업종·이름을 정하고 지도에서 자리를 골라 차린다 ──────────────
// 거리 업종(street.json)과 간판 자료 업종을 잇는다. 경쟁 가게를 셀 때 쓴다
const RIVAL = {
  flower: /꽃/,
  bread: /빵|제과/,
  cafe: /카페/,
  pharm: /약국/,
  ricecake: /떡/,
  laundry: /세탁|빨래/,
  karaoke: /노래/,
  hair: /미용/,
  chicken: /치킨/,
  book: /서점/,
  hardware: /철물/,
  snack: /분식|김밥/,
}
const RIVAL_R = 500
const street = ref([])
const shopKey = ref('bread')
const shopName = ref('')
const spot = ref(null)
const check = ref(null)
const shopBusy = ref(false)
const shopErr = ref('')
const opened = ref(null)
const shared = shallowRef([])
const me = ref(player())
const nick = ref('')
const nickPass = ref('')
const nickBusy = ref(false)
let spotMarker = null
let shopMarkers = []

load('street.json').then((v) => (street.value = v))
const kind = computed(() => street.value.find((s) => s.key === shopKey.value))
const cleanName = computed(() => shopName.value.trim().replace(/\s+/g, ''))
const nameOk = computed(() => /[가-힣]{2}/.test(cleanName.value) && /^[가-힣A-Za-z0-9]{2,12}$/.test(cleanName.value))

function setSpot(lngLat) {
  spot.value = { lng: lngLat.lng, lat: lngLat.lat }
  opened.value = null
  if (!spotMarker) {
    const el = document.createElement('div')
    el.className = 'am-spot'
    spotMarker = new maplibre.Marker({ element: el, anchor: 'bottom', draggable: true }).setLngLat(lngLat).addTo(map)
    spotMarker.on('dragend', () => setSpot(spotMarker.getLngLat()))
  } else spotMarker.setLngLat(lngLat)
  spotMarker.getElement().innerHTML = `<span><i>${esc(kind.value?.emoji || '🏠')}</i></span>`
  spotMarker.getElement().classList.remove('done')
  sfx.click()
}

let checkTimer = 0
let checkSeq = 0
function scheduleCheck() {
  clearTimeout(checkTimer)
  checkTimer = setTimeout(runCheck, 350)
}

async function runCheck() {
  const seq = ++checkSeq
  const n = cleanName.value
  shopErr.value = ''
  if (spotMarker && kind.value) spotMarker.getElement().innerHTML = `<span><i>${esc(kind.value.emoji)}</i></span>`
  let named = null
  if (nameOk.value) {
    try {
      const [count, found] = await Promise.all([nameCount(n), search(n)])
      const exactSeen = found.rows.some((r) => r.name === n)
      const similar = [...new Set(found.rows.filter((r) => r.name !== n && r.cat.match(RIVAL[shopKey.value])).map((r) => r.name))]
      const others = [...new Set(found.rows.filter((r) => r.name !== n).map((r) => r.name))]
      named = { count: count || (exactSeen ? 1 : 0), similar: (similar.length ? similar : others).slice(0, 3) }
    } catch {
      shopErr.value = '데이터를 못 불러왔어요'
    }
  }
  let rivals = null
  if (spot.value) {
    try {
      const rows = await nearby(spot.value.lng, spot.value.lat, RIVAL_R)
      const kx = KX(spot.value.lat)
      rivals = {
        known: rows.length > 0,
        list: rows
          .filter((r) => RIVAL[shopKey.value]?.test(r.cat))
          .map((r) => ({ ...r, lng: spot.value.lng + r.dx / kx, lat: spot.value.lat + r.dy / KY })),
      }
    } catch {
      rivals = { known: false, list: [] }
    }
  }
  if (seq !== checkSeq) return
  check.value = { named, rivals }
  drawRivals()
}

function drawRivals() {
  if (!ready.value) return
  const s = spot.value
  setData('rival-area', s ? ring(s, RIVAL_R) : fc([]))
  setData('rival-dots', fc((check.value?.rivals?.list || []).map((r) => point(r.lng, r.lat, { name: r.name, cat: r.cat, dist: r.dist }))))
}

watch([shopKey, cleanName, spot], scheduleCheck)

async function join() {
  shopErr.value = ''
  nickBusy.value = true
  try {
    me.value = await enter(nick.value.trim(), nickPass.value)
  } catch (e) {
    shopErr.value = e.message
  }
  nickBusy.value = false
}

async function openHere() {
  if (!nameOk.value) {
    shopErr.value = '간판 이름은 한글 두 글자 이상, 띄어쓰기 없이 12자까지예요'
    return
  }
  if (!spot.value) {
    shopErr.value = '지도를 눌러 가게 자리를 먼저 골라 주세요'
    return
  }
  shopBusy.value = true
  shopErr.value = ''
  try {
    const k = kind.value
    await openShop({ name: cleanName.value, cat: k.label, emoji: k.emoji, lng: spot.value.lng, lat: spot.value.lat })
    opened.value = { key: shopKey.value, label: cleanName.value, emoji: k.emoji }
    emit('opened', { ...opened.value })
    window.dispatchEvent(new CustomEvent('game:over', { detail: { game: 'open', score: 1, shop: { ...opened.value } } }))
    // 이제 모두의 가게 핀이 그 자리를 대신한다
    spotMarker?.getElement().classList.add('done')
    sfx.bell()
    await loadShared()
  } catch (e) {
    shopErr.value = e.message
    if (e.status === 401) me.value = null
  }
  shopBusy.value = false
}

async function loadShared() {
  try {
    shared.value = (await sharedShops()).shops
  } catch {
    shared.value = []
  }
  drawShared()
}

function drawShared() {
  if (!map) return
  for (const m of shopMarkers) m.remove()
  shopMarkers = shared.value.map((s) => {
    const el = document.createElement('button')
    el.className = 'am-shop' + (s.mine ? ' mine' : '')
    el.setAttribute('aria-label', `${s.name} · ${s.owner}`)
    el.innerHTML = `<span class="am-sign">${esc(s.emoji)} ${esc(s.name)}</span><span class="am-label">${esc(s.owner)}${s.mine ? ' (나)' : ''}</span>`
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      showPop([s.lng, s.lat], `<h4>${esc(s.emoji)} ${esc(s.name)}</h4><p>${esc(s.cat)} · ${esc(s.owner)} 님 가게</p>`, 30)
    })
    return new maplibre.Marker({ element: el, anchor: 'bottom' }).setLngLat([s.lng, s.lat]).addTo(map)
  })
  showMarkers()
}

const onPlayer = (e) => (me.value = e.detail)

watch(tab, (t) => {
  popup?.remove()
  if (t !== 'name') view.value = 'map'
  applyTab()
  if (t === 'name' && ready.value) fitTowns()
  if (t === 'near') {
    if (here.value) drawNear(true)
    else if (geoGranted.value && !nearBusy.value) locate()
  }
  if (t === 'shop') {
    loadShared()
    if (spot.value && ready.value) map.easeTo({ center: [spot.value.lng, spot.value.lat], zoom: Math.max(map.getZoom(), 14.5), offset: [panelWidth() / 2, 0] })
  }
})

let observer
let themeWatch
let protocolAdded = false
onMounted(async () => {
  if (duel) return
  window.addEventListener('arcade:player', onPlayer)
  navigator.permissions
    ?.query({ name: 'geolocation' })
    .then((s) => {
      geoGranted.value = s.state === 'granted'
      if (geoGranted.value && tab.value === 'near' && !here.value) locate()
    })
    .catch(() => {})
  where()
    .then((r) => (approx.value = r.approx))
    .catch(() => {})
  if (tab.value === 'shop') loadShared()
  if (props.word && tab.value === 'name') submit(props.word)
  if (props.word && tab.value === 'shop') shopName.value = props.word.replace(/\s+/g, '').slice(0, 12)

  const mod = await import('maplibre-gl')
  maplibre = mod.default || mod
  maplibre.setWorkerUrl(workerUrl)
  if (!protocolAdded) {
    maplibre.addProtocol('pmtiles', new Protocol().tile)
    protocolAdded = true
  }
  if (!mapEl.value) return
  // 처음엔 지구 전체를 보여 주고 한국으로 내려앉는다. 다른 앱이 특정 단계로 열면 바로 한국에서 시작한다
  const intro = tab.value === 'name' && !props.word
  map = new maplibre.Map({
    container: mapEl.value,
    style: blankStyle(),
    ...(intro ? WORLD : { bounds: KOREA, fitBoundsOptions: { padding: { top: 30, bottom: 30, left: panelWidth() + 20, right: 30 } } }),
    attributionControl: { compact: true },
    localIdeographFontFamily: getComputedStyle(document.body).fontFamily,
    dragRotate: false,
    pitchWithRotate: false,
  })
  map.on('load', () => {
    setupLayers()
    ready.value = true
    applyTab()
    drawPins()
    drawNear(true)
    drawShared()
    drawRivals()
    setupSigns().catch(() => {})
    // 잠깐 지구를 보여 준 뒤, 그사이 사람이 먼저 돌리지 않았으면 한국으로 내려간다
    if (intro) setTimeout(() => map && !map.isMoving() && !result.value && !here.value && home(2800), 1500)
  })
  map.on('click', onMapClick)
  // 전국을 볼 때는 핀 이름이 겹쳐서 숫자만 남긴다
  const near = () => mapEl.value?.classList.toggle('far', map.getZoom() < 7.5)
  map.on('zoom', near)
  near()
  map.on('move', queueStars)
  map.on('resize', queueStars)
  observer = new ResizeObserver(() => map?.resize())
  observer.observe(mapEl.value)
  themeWatch = new MutationObserver(applyTheme)
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

onBeforeUnmount(() => {
  window.removeEventListener('arcade:player', onPlayer)
  clearTimeout(checkTimer)
  clearTimeout(noticeTimer)
  observer?.disconnect()
  themeWatch?.disconnect()
  cancelAnimationFrame(starRaf)
  map?.remove()
  map = null
  signDots = []
  signLabels = []
})

watch(towns, drawPins)

const zoom = (d) => map?.easeTo({ zoom: map.getZoom() + d, duration: 250 })
// 한국 전체. 처음 안내 카드가 떠 있으면 넓은 창에선 그 오른쪽, 좁은 창에선 그 위에 맞춘다
const hintEl = ref(null)
function home(duration = 900) {
  if (!map) return
  const hint = hintEl.value?.offsetHeight || 0
  const wide = panelWidth() > 0
  const padding = { top: 70, bottom: 30, left: wide ? 340 : 20, right: 30 }
  if (!wide && hint) padding.bottom = hint + 24
  map.fitBounds(KOREA, { padding, duration })
}
const globe = () => map?.flyTo({ ...WORLD, duration: 1400 })

// 손 조작: 집어 끌면 지구본이 손을 따라 돌고, 두 손으로 벌리면 그 사이를 중심으로 당겨진다
const hand = ref(false)
const handPoint = ref(null)
const graphRef = ref(null)
const handDrag = (dx, dy) => (graphOn.value ? graphRef.value?.rotate(dx, dy) : map?.panBy([-dx, -dy], { duration: 0 }))
function handZoom(dz, x, y) {
  if (graphOn.value) return graphRef.value?.zoomBy(dz)
  if (!map || !dz) return
  map.zoomTo(map.getZoom() + dz, { around: map.unproject([x, y]), duration: 0 })
}
// 톡 집기는 그 자리를 마우스로 누른 것과 같게 친다(핀·단추·지도 모두)
function handTap(x, y) {
  const el = document.elementFromPoint(x, y)
  if (!el) return
  if (graphOn.value && el.tagName === 'CANVAS' && graphRef.value) return graphRef.value.choose(x, y)
  for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
}
</script>

<template>
  <MapDuel v-if="duel" :goal="props.goal" :word="props.word" :boss="props.boss" :boss-name="props.bossName || '잊힘'" />
  <div v-else class="amap" :class="[`tab-${tab}`, { 'has-panel': showPanel }]">
    <div ref="mapEl" class="map"></div>

    <!-- 이름 별자리. 별을 누르면(손으로 톡 집어도) 그 동네 간판을 펼친다 -->
    <div v-if="tab === 'name' && stars.length" :key="result?.word" class="stars">
      <svg aria-hidden="true">
        <template v-for="([a, b], k) in links" :key="'l' + k">
          <line v-if="!stars[a].hidden && !stars[b].hidden" class="link" :x1="stars[a].x" :y1="stars[a].y" :x2="stars[b].x" :y2="stars[b].y" />
        </template>
        <template v-for="st in stars" :key="'s' + st.i">
          <g v-if="!st.hidden">
            <line class="stem" :x1="st.gx" :y1="st.gy" :x2="st.x" :y2="st.y" />
            <circle class="ground" :cx="st.gx" :cy="st.gy" r="2" />
          </g>
        </template>
      </svg>
      <button
        v-for="st in stars"
        v-show="!st.hidden"
        :key="st.t.region"
        class="star"
        :class="{ card: st.card, on: picked === st.t.region }"
        :style="{ transform: `translate(${st.x}px, ${st.y}px)`, '--d': st.i * 45 + 'ms' }"
        :aria-label="`${st.t.region} ${st.t.rows.length}곳`"
        @click.stop="pick(st.t)"
      >
        <span class="float">
          <i class="node"></i>
          <span v-if="st.card" class="label">
            <b>{{ st.t.rows[0].parts[0] }}<em>{{ st.t.rows[0].parts[1] }}</em>{{ st.t.rows[0].parts[2] }}</b>
            <small>{{ st.t.short }}{{ st.t.rows.length > 1 ? ` · ${st.t.rows.length}곳` : '' }}</small>
          </span>
        </span>
      </button>
    </div>

    <NameGraph
      v-if="graphOn"
      ref="graphRef"
      :key="result.word"
      :word="result.word"
      :rows="listed"
      :dots="dots?.dots || []"
      :total="dots?.n || 0"
      :pointer="hand ? handPoint : null"
      :hand="hand"
      @hand="hand = !hand"
      @town="graphTown"
      @close="view = 'map'"
    />

    <!-- 늘 떠 있는 검색창. 이름을 넣으면 그 글자가 든 간판이 지구본 위에서 빛난다 -->
    <div class="top">
      <form class="sbar" role="search" @submit.prevent="submit()">
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.6" /><path d="M10.4 10.4L14 14" /></svg>
        <input v-model="query" type="search" placeholder="이름을 넣어 보세요 (예: 민수)" maxlength="10" aria-label="간판 이름 검색" />
        <span v-if="busy" class="spin" aria-label="찾는 중"></span>
      </form>
      <p v-if="error" class="m-err">{{ error }}</p>
      <Transition name="fade">
        <p v-if="notice" class="notice">{{ notice }}</p>
      </Transition>
    </div>

    <!-- 처음 화면: 무엇을 할 수 있는지 한 장으로 -->
    <Transition name="fade">
      <div v-if="!showPanel && !hand && !graphOn" ref="hintEl" class="hint">
        <p class="h">지구본을 돌려서 간판을 찾아요</p>
        <p class="d">
          점 하나하나가 진짜 간판이에요{{ signTotal ? ` (전국 ${signTotal.toLocaleString()}곳)` : '' }}. 이름을 검색하거나, <b>점이 모인 곳을 누르면</b> 그 동네 간판이 펼쳐져요.
        </p>
        <div class="chips">
          <span class="lab">이름</span>
          <button v-for="w in SUGGEST" :key="w" class="m-chip" @click="submit(w)">{{ w }}</button>
        </div>
        <div class="chips">
          <span class="lab">동네</span>
          <button class="m-chip" :disabled="nearBusy" @click="locate">📍 내 위치</button>
          <button v-for="s in SPOTS" :key="s.label" class="m-chip" :disabled="nearBusy" @click="scanAt({ ...s, kind: 'spot' })">{{ s.label }}</button>
        </div>
        <button class="handbtn" @click="hand = true">✋ 웹캠으로 손을 써서 돌려 보기</button>
      </div>
    </Transition>

    <aside v-if="showPanel" class="panel">
      <!-- 이름 찾기 결과 -->
      <template v-if="tab === 'name'">
        <header class="phead">
          <p>‘{{ result.word }}’ 찾기</p>
          <button class="x" aria-label="찾기 닫기" @click="clearName">×</button>
        </header>
        <div class="m-seg seg" role="tablist">
          <button role="tab" @click="view = 'graph'">별자리</button>
          <button :class="{ on: view === 'map' }" role="tab" @click="view = 'map'">장소</button>
          <button :class="{ on: view === 'building' }" role="tab" :disabled="!floors.length" @click="view = 'building'">이름 빌딩</button>
        </div>
        <p class="sum">
          ‘{{ result.word }}’ 들어간 간판 {{ result.exactCount ? '' : '최대 ' }}<b>{{ result.count.toLocaleString() }}곳</b><br />
          <span>그중 {{ listed.length }}곳 · 동네 {{ towns.length }}곳</span>
        </p>
        <ul class="results">
          <li v-for="r in listed.slice(0, 120)" :key="r.key">
            <button :class="{ on: picked === r.region, accident: r.accident }" @click="pick(towns.find((t) => t.region === r.region))">
              <i class="glyph">{{ r.cat[0] }}</i>
              <span class="txt">
                <span class="name">{{ r.parts[0] }}<b>{{ r.parts[1] }}</b>{{ r.parts[2] }}<em v-if="r.accident">우연</em></span>
                <small>{{ r.cat }} · {{ r.short }}{{ r.floor !== null ? ` · ${floorLabel(r.floor)}` : '' }}</small>
              </span>
            </button>
          </li>
        </ul>
        <p v-if="signsReady" class="live">
          <template v-if="inView !== null">지금 화면에 ‘{{ result.word }}’ 간판 <b>{{ inView.toLocaleString() }}곳</b> · 정확한 자리</template>
          <template v-else>골목까지 확대하면 ‘{{ result.word }}’ 들어간 간판이 정확한 자리에 전부 떠요 <button class="m-chip" :disabled="jumping" @click="zoomInto">{{ jumping ? '찾는 중…' : '한 곳 가 보기' }}</button></template>
        </p>
        <p class="note">목록·핀은 시·군·구별로 골라 담은 것 · 지도 점은 전국 전부 · ‘우연’ = 이름이 아니라 글자가 우연히 걸린 곳</p>
      </template>

      <!-- 누른 동네 -->
      <template v-else-if="tab === 'near'">
        <header class="phead">
          <p>{{ here ? here.label : '우리 동네' }}</p>
          <button class="x" aria-label="동네 닫기" @click="tab = 'name'">×</button>
        </header>
        <p v-if="nearBusy" class="sum"><span class="spin inline"></span> 둘레 {{ RADIUS }}m 간판을 모으는 중…</p>
        <p v-if="nearErr" class="m-err">{{ nearErr }}</p>

        <template v-if="here && nearItems.length">
          <p class="sum">
            반경 {{ RADIUS }}m 간판 <b>{{ nearItems.length.toLocaleString() }}곳</b><br />
            <span :class="{ warn: here.kind !== 'precise' && here.kind !== 'pick' }">{{ HERE_NOTE[here.kind] }}</span>
          </p>
          <button class="go openbtn" @click="goShop">🏠 여기에 내 가게 차리기</button>
          <div class="bars">
            <div v-for="b in nearBars" :key="b.cat" class="bar">
              <span class="bl">{{ b.cat }}</span>
              <span class="bt"><i :style="{ width: b.w + '%' }"></i></span>
              <span class="bn">{{ b.n }}</span>
            </div>
          </div>
          <ul class="results">
            <li v-for="s in nearItems.slice(0, nearShown)" :key="s.id">
              <button :class="{ on: focus === s.id }" @click="focusNear(s)">
                <i class="glyph">{{ s.cat[0] }}</i>
                <span class="txt">
                  <span class="name">{{ s.name }}</span>
                  <small>{{ s.cat }} · {{ s.dist }}m</small>
                </span>
              </button>
            </li>
          </ul>
          <button v-if="nearItems.length > nearShown" class="m-chip more" @click="nearShown += 200">가까운 순 {{ nearShown }}곳까지 봤어요 · 더 보기</button>
        </template>
        <div v-else-if="!here && !nearBusy" class="hello">
          <p class="d">위치를 허용하면 내 주변 {{ RADIUS }}m 안 진짜 간판을 지도에 찍어요. 위치는 이 화면에서만 쓰고 어디에도 저장하지 않아요.</p>
        </div>
        <div class="locbar">
          <button class="m-chip" :class="{ on: here?.kind === 'precise' }" :disabled="nearBusy" @click="locate">📍 {{ geoGranted ? '내 위치 다시' : '내 위치' }}</button>
          <button v-if="approx" class="m-chip" :class="{ on: here?.kind === 'ip' }" :disabled="nearBusy" @click="useApprox">대략 위치{{ approx.city ? ` · ${approx.city}` : '' }}</button>
          <button
            v-for="s in SPOTS"
            :key="s.label"
            class="m-chip"
            :class="{ on: here?.kind === 'spot' && here.label === s.label }"
            :disabled="nearBusy"
            @click="scanAt({ ...s, kind: 'spot' })"
          >
            {{ s.label }}
          </button>
        </div>
        <p class="note">
          지도 다른 곳을 눌러도 그 동네로 옮겨 가요 ·
          {{ nearSample ? '지도 타일을 못 받아 구역마다 고르게 추린 표본이에요(약 100m 단위 자리)' : '소상공인시장진흥공단 상가 정보에 등록된 가게 전부, 등록된 좌표 그대로예요' }}
        </p>
      </template>

      <!-- 내 가게 차리기 -->
      <template v-else>
        <header class="phead">
          <button class="x back" aria-label="뒤로" @click="tab = here ? 'near' : 'name'">‹</button>
          <p>내 가게 차리기</p>
        </header>
        <form class="group m-card" @submit.prevent="openHere">
          <label class="line">
            <span>업종</span>
            <select v-model="shopKey">
              <option v-for="s in street" :key="s.key" :value="s.key">{{ s.emoji }} {{ s.label }}</option>
            </select>
          </label>
          <label class="line">
            <span>간판 이름</span>
            <input v-model="shopName" type="text" placeholder="예: 꽈배기공화국" maxlength="12" />
          </label>
          <div class="line spotline">
            <span>자리</span>
            <em v-if="!spot">지도를 눌러 고르세요</em>
            <em v-else class="ok">골랐어요 · 지도를 누르거나 핀을 끌어 옮겨요</em>
          </div>
        </form>

        <div v-if="check && (check.named || check.rivals)" class="facts">
          <p v-if="check.named && !check.named.count" class="big">같은 이름 전국 0곳, 내가 처음이에요</p>
          <p v-else-if="check.named" class="big">같은 이름이 전국에 <b>{{ check.named.count.toLocaleString() }}곳</b></p>
          <p v-if="check.named?.similar.length" class="muted">비슷한 간판 · {{ check.named.similar.join(', ') }}</p>
          <template v-if="check.rivals">
            <p v-if="!check.rivals.known" class="muted">이 근처는 담아 둔 간판 자료가 없어 경쟁 가게를 못 셌어요</p>
            <p v-else-if="!check.rivals.list.length">{{ RIVAL_R }}m 안에 같은 업종 가게가 없어요. 블루오션!</p>
            <p v-else>
              {{ RIVAL_R }}m 안 같은 업종 <b class="rival">{{ check.rivals.list.length }}곳</b>
              <span class="muted">· 가장 가까운 {{ check.rivals.list[0].name }} {{ check.rivals.list[0].dist }}m</span>
            </p>
          </template>
        </div>

        <form v-if="!me" class="join" @submit.prevent="join">
          <p class="muted">지도에 가게를 올리려면 닉네임이 필요해요</p>
          <div class="row">
            <input v-model="nick" maxlength="10" placeholder="닉네임 (2~10자)" aria-label="닉네임" />
            <input v-model="nickPass" type="password" maxlength="32" placeholder="암호 (4자 이상)" aria-label="암호" autocomplete="current-password" />
            <button type="submit" :disabled="nickBusy || nick.trim().length < 2 || nickPass.length < 4">등록</button>
          </div>
        </form>
        <p v-if="shopErr" class="m-err">{{ shopErr }}</p>
        <button v-if="me" class="go openbtn" :disabled="shopBusy || !spot || !nameOk" @click="openHere">
          {{ shopBusy ? '차리는 중…' : '여기에 가게 차리기' }}
        </button>

        <div v-if="opened" class="result">
          <PixelShop :shop="opened" small />
          <p><b>개업!</b> 지도에 내 가게가 올라갔어요. 다른 사람도 이 핀을 봐요.</p>
        </div>
        <p class="note">모두가 차린 가게 {{ shared.length }}곳 · {{ me ? `${me.name}(으)로 참가 중 · 한 사람당 최근 3곳까지 남아요` : '한 사람당 최근 3곳까지 남아요' }}</p>
      </template>
    </aside>

    <div class="ctrl" role="group" aria-label="지도 조작">
      <button aria-label="확대" title="확대" @click="zoom(1)">+</button>
      <button aria-label="축소" title="축소" @click="zoom(-1)">−</button>
      <button aria-label="한국 전체" title="한국 전체" class="home" @click="home()">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.9 4.6 4.6 1.9-4.6 1.9L8 14.5 6.1 9.9 1.5 8l4.6-1.9z" /></svg>
      </button>
      <button aria-label="지구 전체" title="지구 전체" class="sm" @click="globe">🌐</button>
      <button aria-label="내 위치" title="내 위치" class="sm" :disabled="nearBusy" @click="locate">📍</button>
      <button aria-label="손으로 조작" title="웹캠 손 조작" class="sm" :class="{ on: hand }" @click="hand = !hand">✋</button>
    </div>

    <HandControl v-if="hand" @drag="handDrag" @zoom="handZoom" @tap="handTap" @point="handPoint = $event" @off="hand = false" />

    <Transition name="sheet">
      <div v-if="tab === 'name' && view === 'building' && floors.length" class="bsheet">
        <div class="sky">
          <div class="tower">
            <div class="roof">{{ result.word }} 빌딩</div>
            <TransitionGroup name="drop" tag="div" class="floors">
              <div v-for="f in floors" :key="f.name + f.floor + f.region" class="floor" :class="{ under: f.floor < 0 }">
                <span class="no">{{ floorShort(f.floor) }}</span>
                <span class="sign">{{ f.name }}</span>
                <span class="where">{{ f.region.split(' ').slice(-1)[0] }} · {{ f.cat }}</span>
              </div>
            </TransitionGroup>
            <div class="ground"></div>
          </div>
        </div>
        <div class="bfoot">
          <p>진짜 그 층에 있는 가게만 쌓았어요</p>
          <button @click="build(), sfx.click()">다시 짓기</button>
          <button class="go" @click="view = 'map'">지도로</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* 흑백 + 강조색 하나. 창 공용 변수도 여기서 덮어써서 단추·칩이 같은 색을 따른다 */
.amap {
  --mk-bg: #f7f7f5;
  --mk-card: rgb(255 255 255 / 0.86);
  --mk-ink: #111;
  --mk-ink-2: #6b6b6b;
  --mk-ink-3: #9a9a9a;
  --mk-line: rgb(0 0 0 / 0.1);
  --mk-fill: rgb(0 0 0 / 0.05);
  --mk-fill-2: rgb(0 0 0 / 0.09);
  --mk-hot: #ff4f00;
  --mk-space: #e6e6e2;
  --label: var(--mk-ink);
  --label-2: var(--mk-ink-2);
  --label-3: var(--mk-ink-3);
  --sep: var(--mk-line);
  --fill: var(--mk-fill);
  --fill-hover: var(--mk-fill-2);
  --window: var(--mk-bg);
  --window-2: var(--mk-fill);
  --panel: var(--mk-fill);
  --seg-on: var(--mk-ink);
  --control: var(--mk-fill);
  --control-ring: var(--mk-line);
  --accent: var(--mk-hot);
  position: relative;
  height: min(620px, calc(100vh - 150px));
  min-height: 420px;
  padding: 0 !important;
  overflow: hidden;
  background: var(--mk-bg);
  color: var(--mk-ink);
}

:global(html.dark) {
  .amap {
    --mk-bg: #0b0b0c;
    --mk-card: rgb(24 24 27 / 0.84);
    --mk-ink: #f2f2f2;
    --mk-ink-2: #9a9aa0;
    --mk-ink-3: #6c6c72;
    --mk-line: rgb(255 255 255 / 0.12);
    --mk-fill: rgb(255 255 255 / 0.06);
    --mk-fill-2: rgb(255 255 255 / 0.12);
    --mk-space: #050506;
  }
}

.amap :deep(.maplibregl-ctrl-attrib) {
  background: var(--mk-card) !important;
  color: var(--mk-ink-2);
}

.amap :deep(.maplibregl-ctrl-attrib a) {
  color: inherit;
}

.map {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 45%, var(--mk-bg), var(--mk-space) 75%);
}

/* 위 가운데 검색창. 패널이 뜨면 패널 오른쪽 가운데로 비킨다 */
.top {
  position: absolute;
  top: 12px;
  left: 0;
  right: 0;
  z-index: 3;
  display: grid;
  justify-items: center;
  gap: 6px;
  padding: 0 60px;
  pointer-events: none;
}

.amap.has-panel .top {
  left: 320px;
  padding: 0 56px 0 10px;
}

.top > * {
  pointer-events: auto;
}

.top .sbar {
  width: min(420px, 100%);
  height: 42px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--mk-card);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
  box-shadow: 0 0 0 1px var(--mk-line), 0 10px 28px rgb(0 0 0 / 0.2);
}

.top .sbar:focus-within {
  box-shadow: 0 0 0 1.5px var(--mk-ink), 0 10px 28px rgb(0 0 0 / 0.2);
}

.top .m-err,
.notice {
  margin: 0;
  padding: 5px 12px;
  border-radius: 999px;
  background: var(--mk-card);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
  box-shadow: 0 0 0 1px var(--mk-line);
  font-size: 12px;
}

.notice {
  color: var(--mk-ink);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

/* 처음 화면 안내 카드 (아래 가운데) */
.hint {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 2;
  width: 320px;
  padding: 14px 16px;
  border-radius: 20px;
  background: var(--mk-card);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
  box-shadow: 0 0 0 1px var(--mk-line), 0 16px 40px rgb(0 0 0 / 0.22);
}

.hint p {
  margin: 0;
}

.hint .h {
  font-size: 15px;
  font-weight: 700;
}

.hint .d {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--label-2);
}

.hint .d b {
  color: var(--mk-hot);
}

.hint .chips {
  align-items: center;
  margin-top: 8px;
}

.hint .lab {
  width: 28px;
  font-size: 11px;
  color: var(--label-3);
}

.app-body .hint .handbtn {
  width: 100%;
  min-height: 32px;
  margin-top: 10px;
  border-radius: 10px;
  background: var(--mk-fill);
  box-shadow: none;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--mk-ink);
}

.app-body .hint .handbtn:hover {
  background: var(--mk-fill-2);
}

/* 패널 머리: 지금 무엇을 보는지 + 닫기 */
.phead {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 2px 0 6px;
}

.phead p {
  flex: 1;
  margin: 0;
  overflow: hidden;
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.app-body .phead .x {
  width: 28px;
  height: 28px;
  min-height: 0;
  padding: 0;
  border-radius: 50%;
  background: var(--mk-fill);
  box-shadow: none;
  font-size: 17px;
  line-height: 1;
  color: var(--mk-ink-2);
}

.app-body .phead .x:hover {
  background: var(--mk-fill-2);
  color: var(--mk-ink);
}

.phead .back {
  order: -1;
}

/* 왼쪽 위에 떠 있는 유리 검색 패널 (Apple 지도의 사이드바) */
.panel {
  position: absolute;
  top: 10px;
  left: 10px;
  bottom: 10px;
  z-index: 2;
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 20px;
  background: var(--mk-card);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
  box-shadow: 0 0 0 1px var(--mk-line), 0 16px 40px rgb(0 0 0 / 0.22);
}

.panel:not(:has(.results)) {
  bottom: auto;
}

.sbar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 10px;
  border-radius: 12px;
  background: var(--mk-fill);
}

.sbar svg {
  width: 15px;
  height: 15px;
  flex: none;
  fill: none;
  stroke: var(--label-2);
  stroke-width: 1.7;
  stroke-linecap: round;
}

.sbar input {
  flex: 1;
  min-width: 0;
  height: 100% !important;
  padding: 0 !important;
  border: 0;
  background: none !important;
  box-shadow: none !important;
  font-size: 14px !important;
  outline: none;
}

.spin.inline {
  display: inline-block;
  vertical-align: -2px;
  margin-right: 4px;
}

.spin {
  width: 14px;
  height: 14px;
  border: 2px solid var(--mk-line);
  border-top-color: var(--mk-ink);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(1turn);
  }
}

.seg {
  align-self: stretch;
}

.app-body .seg button {
  flex: 1;
}

.sum {
  margin: 2px 4px 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--label-2);
}

.sum b {
  color: var(--label);
  font-size: 15px;
  font-weight: 700;
}

.results {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0 -4px;
  padding: 0;
  list-style: none;
}

.app-body .results button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 0;
  padding: 7px 8px;
  border-radius: 10px;
  background: none;
  box-shadow: none;
  text-align: left;
}

.app-body .results button:hover {
  background: var(--mk-fill);
}

.app-body .results button.on {
  background: var(--mk-fill-2);
}

.glyph {
  width: 30px;
  height: 30px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--mk-ink);
  background: var(--mk-fill-2);
  font-size: 13px;
  font-style: normal;
  font-weight: 700;
}

.app-body .results button.on .glyph {
  color: #fff;
  background: var(--mk-hot);
}

.txt {
  display: grid;
  min-width: 0;
}

.name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.name b {
  color: var(--accent);
  font-weight: 700;
}

.name em {
  margin-left: 5px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 10px;
  font-style: normal;
  font-weight: 600;
  color: var(--mk-ink-2);
  box-shadow: inset 0 0 0 1px var(--mk-line);
}

.txt small {
  overflow: hidden;
  font-size: 11px;
  color: var(--label-2);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.note {
  margin: 0 4px;
  font-size: 10px;
  line-height: 1.4;
  color: var(--label-3);
}

.live {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  margin: 0 4px;
  padding: 6px 8px;
  border-radius: 10px;
  background: var(--mk-fill);
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--label-2);
}

.live b {
  color: var(--accent);
}

.live .m-chip,
.more {
  flex: none;
  align-self: center;
}

.hello {
  padding: 4px 4px 2px;
}

.hello p {
  margin: 0;
}

.hello .h {
  font-size: 15px;
  font-weight: 700;
}

.hello .d {
  margin-top: 3px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--label-2);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

/* 오른쪽 아래 확대 단추 */
.ctrl {
  position: absolute;
  right: 12px;
  bottom: 30px;
  z-index: 2;
  display: grid;
  overflow: hidden;
  border-radius: 12px;
  background: var(--mk-card);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
  box-shadow: 0 0 0 1px var(--mk-line), 0 6px 18px rgb(0 0 0 / 0.18);
}

.app-body .ctrl button {
  width: 34px;
  height: 32px;
  min-height: 0;
  padding: 0;
  border-radius: 0;
  background: none;
  box-shadow: none;
  font-size: 18px;
  line-height: 1;
  color: var(--label-2);
}

.app-body .ctrl button + button {
  border-top: 0.5px solid var(--sep);
}

.app-body .ctrl button.sm {
  font-size: 14px;
}

.app-body .ctrl button.on {
  background: var(--mk-ink);
}

.ctrl .home svg {
  width: 14px;
  height: 14px;
  fill: var(--mk-ink);
}

/* 이름 별자리: 땅의 점에서 실이 올라가 공중의 별(카드)에 닿는다 */
.stars {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  pointer-events: none;
}

.stars svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.stars .link {
  stroke: var(--mk-hot);
  stroke-width: 1;
  stroke-opacity: 0.55;
}

.stars .stem {
  stroke: var(--mk-ink);
  stroke-width: 0.8;
  stroke-opacity: 0.35;
  stroke-dasharray: 2 2;
}

.stars .ground {
  fill: var(--mk-ink);
  fill-opacity: 0.6;
}

.app-body .star {
  position: absolute;
  top: 0;
  left: 0;
  min-height: 0;
  padding: 0;
  border: 0;
  background: none;
  box-shadow: none;
  pointer-events: auto;
  cursor: pointer;
}

/* 이름 카드가 다른 별의 점에 가리지 않게 위로 */
.app-body .star.card {
  z-index: 1;
}

.app-body .star.on {
  z-index: 2;
}

.star .float {
  position: relative;
  display: block;
  animation: star-rise 0.7s var(--spring) backwards;
  animation-delay: var(--d);
}

@keyframes star-rise {
  from {
    opacity: 0;
    transform: translateY(26px) scale(0.6);
  }
}

.star .node {
  position: absolute;
  top: -5px;
  left: -5px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--mk-hot);
  box-shadow: 0 0 0 2px var(--mk-bg), 0 0 14px 3px rgb(255 79 0 / 0.55);
  transition: scale 0.15s;
}

.star:hover .node,
.star.on .node {
  scale: 1.4;
}

.star .label {
  position: absolute;
  bottom: 9px;
  left: 0;
  display: grid;
  translate: -50% 0;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--mk-card);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
  box-shadow: 0 0 0 1px var(--mk-line), 0 6px 16px rgb(0 0 0 / 0.25);
  text-align: center;
  white-space: nowrap;
}

.star .label b {
  font-size: 12px;
  font-weight: 600;
  color: var(--mk-ink);
}

.star .label em {
  font-style: normal;
  color: var(--mk-hot);
}

.star .label small {
  font-size: 10px;
  color: var(--mk-ink-2);
}

.star.on .label {
  box-shadow: 0 0 0 1.5px var(--mk-hot), 0 6px 16px rgb(0 0 0 / 0.25);
}

.map.far :deep(.am-label) {
  display: none;
}

.amap :deep(.am-label) {
  font-size: 11px;
  font-weight: 600;
  color: var(--mk-ink);
  text-shadow: 0 0 2px var(--mk-bg), 0 0 2px var(--mk-bg), 0 0 3px var(--mk-bg);
  white-space: nowrap;
}

.amap :deep(.am-pop .maplibregl-popup-content) {
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--mk-card);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
  box-shadow: 0 0 0 1px var(--mk-line), 0 8px 24px rgb(0 0 0 / 0.22);
  color: var(--mk-ink);
  font: inherit;
}

.amap :deep(.am-pop .maplibregl-popup-tip) {
  display: none;
}

.amap :deep(.am-pop h4) {
  margin: 0 0 6px;
  font-size: 13px;
}

.amap :deep(.am-pop ul) {
  margin: 0;
  padding: 0;
  list-style: none;
}

.amap :deep(.am-pop li) {
  display: grid;
  grid-template-columns: 8px 1fr;
  column-gap: 7px;
  align-items: center;
  padding: 3px 0;
}

.amap :deep(.am-pop li i) {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mk-ink);
}

.amap :deep(.am-pop li b) {
  font-size: 12px;
  font-weight: 600;
}

.amap :deep(.am-pop li small) {
  grid-column: 2;
  font-size: 11px;
  color: var(--label-2);
}

.amap :deep(.am-pop p) {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--label-2);
}

/* 이름 빌딩: 지도 오른쪽에 떠오르는 시트 */
.bsheet {
  position: absolute;
  top: 10px;
  right: 10px;
  bottom: 10px;
  left: 320px;
  z-index: 3;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 20px;
  background: var(--mk-bg);
  box-shadow: 0 0 0 1px var(--mk-line), 0 16px 40px rgb(0 0 0 / 0.24);
}

.sheet-enter-active,
.sheet-leave-active {
  transition: transform 0.35s var(--spring), opacity 0.2s;
}

.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(24px);
  opacity: 0;
}

.sky {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden auto;
  padding: 20px 12px 0;
  background: var(--mk-bg);
}

.tower {
  width: 100%;
  margin: auto auto 0;
  max-width: 300px;
}

.roof {
  margin: 0 22px;
  padding: 6px;
  border-radius: 10px 10px 0 0;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #fff;
  background: var(--mk-hot);
}

.floors {
  overflow: hidden;
  border-radius: 4px 4px 0 0;
  background: var(--mk-fill);
  box-shadow: 0 0 0 1px var(--mk-line);
}

.floor {
  display: grid;
  grid-template-columns: 32px 1fr;
  grid-template-rows: auto auto;
  column-gap: 8px;
  padding: 7px 10px;
}

.floor + .floor {
  border-top: 1px solid var(--mk-line);
}

.floor .no {
  grid-row: span 2;
  align-self: center;
  text-align: center;
  font-size: 11px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--mk-ink-2);
}

.floor .sign {
  justify-self: start;
  max-width: 100%;
  padding: 1px 8px;
  border-radius: 6px;
  font-weight: 600;
  color: var(--mk-bg);
  background: var(--mk-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.floor .where {
  font-size: 11px;
  color: var(--mk-ink-2);
}

.floor.under {
  background: var(--mk-fill);
}

.ground {
  height: 2px;
  margin: 0 -100vw 10px;
  background: var(--mk-ink);
}

.drop-enter-active {
  transition: transform 0.35s var(--spring), opacity 0.25s;
}

.drop-enter-from {
  transform: translateY(-30px);
  opacity: 0;
}

.bfoot {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border-top: 0.5px solid var(--sep);
}

.bfoot p {
  flex: 1;
  margin: 0;
  font-size: 11px;
  color: var(--label-2);
}

/* 고른 칩·탭·주 단추는 흑백 반전, 강조색은 지도 위 '찾은 것'에만 쓴다 */
.app-body .m-chip.on,
.app-body .amap .m-seg button.on {
  color: var(--mk-bg);
  background: var(--mk-ink);
  box-shadow: none;
}

.app-body .amap button.go,
.app-body .amap button[type='submit'] {
  color: var(--mk-bg);
  background: var(--mk-ink);
  box-shadow: none;
}

.app-body .amap button.go:disabled,
.app-body .amap button[type='submit']:disabled {
  opacity: 0.4;
}

.locbar {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.sum .warn {
  color: var(--mk-hot);
}

.bars {
  display: grid;
  gap: 4px;
  margin: 0 4px;
}

.bar {
  display: grid;
  grid-template-columns: 92px 1fr 28px;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.bl {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--label-2);
}

.bt {
  height: 6px;
  border-radius: 3px;
  background: var(--fill);
}

.bt i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--mk-ink);
}

.bn {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 내 가게 입력: 시스템 설정처럼 묶인 줄 */
.group {
  display: grid;
}

.line {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 5px 10px;
}

.line + .line {
  border-top: 0.5px solid var(--sep);
}

.line > span {
  flex: none;
  width: 56px;
  font-weight: 500;
}

.line select,
.line input {
  flex: 1;
  width: 0;
  min-width: 0;
}

.spotline em {
  font-size: 12px;
  font-style: normal;
  color: var(--label-2);
}

.spotline em.ok {
  color: var(--mk-ink);
}

.facts {
  display: grid;
  gap: 3px;
  margin: 0 4px;
  font-size: 12px;
}

.facts p,
.join p,
.result p {
  margin: 0;
}

.facts .big {
  font-size: 14px;
  font-weight: 600;
}

.facts b {
  color: var(--accent);
}

.facts b.rival {
  color: var(--mk-ink);
}

.join {
  display: grid;
  gap: 5px;
  font-size: 12px;
}

.join input {
  flex: 1;
  width: 0;
  min-width: 0;
}

.app-body .openbtn {
  min-height: 32px;
  border-radius: 9px;
  font-weight: 600;
}

.result {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 10px;
  border-radius: 12px;
  background: var(--mk-fill);
  color: var(--mk-ink);
  font-size: 12px;
}

/* 내 가게 자리 핀과 모두가 차린 가게 핀 */
.amap :deep(.am-spot) {
  display: grid;
  place-items: center;
  width: 38px;
  height: 46px;
  cursor: grab;
}

.amap :deep(.am-spot span) {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 3px solid var(--mk-bg);
  border-radius: 50% 50% 50% 4px;
  transform: rotate(-45deg);
  background: var(--accent);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
  font-size: 18px;
}

.amap :deep(.am-spot) {
  z-index: 2;
}

.amap :deep(.am-spot i) {
  font-style: normal;
  line-height: 1;
  transform: rotate(45deg);
}

.amap :deep(.am-spot.done) {
  display: none !important;
}

.amap :deep(.am-shop) {
  display: grid;
  justify-items: center;
  gap: 1px;
  padding: 0;
  border: 0;
  background: none;
  box-shadow: none;
  cursor: pointer;
}

.amap :deep(.am-sign) {
  padding: 3px 8px;
  border: 2px solid var(--mk-bg);
  border-radius: 8px;
  background: var(--mk-ink);
  color: var(--mk-bg);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.amap :deep(.am-shop.mine .am-sign) {
  color: #fff;
  background: var(--mk-hot);
}

/* 창을 최대화하면 메뉴 막대·제목 막대·Dock 여백만 빼고 화면을 다 쓴다 */
:global(.mac-win.max) {
  .amap {
    height: calc(100dvh - 136px);
  }
}

/* 좁은 창(휴대폰): 패널이 아래 시트가 된다 */
@media (max-width: 699px) {
  .amap {
    height: calc(100dvh - 140px);
  }

  .panel {
    top: auto;
    left: 8px;
    right: 8px;
    bottom: 8px;
    width: auto;
    max-height: 55%;
  }

  .panel:not(:has(.results)) {
    bottom: 8px;
  }

  .top,
  .amap.has-panel .top {
    left: 0;
    padding: 0 54px 0 10px;
    justify-items: stretch;
  }

  .top .sbar {
    width: 100%;
  }

  .hint {
    left: 8px;
    bottom: 8px;
    width: calc(100% - 16px);
  }

  .ctrl {
    top: 10px;
    bottom: auto;
  }

  .bsheet {
    left: 10px;
  }
}
</style>
