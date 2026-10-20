<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import * as THREE from 'three'
import { load, signsAround } from '../data.js'
import { pastelOf } from '../shops.js'
import { sfx } from '../sound.js'
import { faceImg, mood, react } from '../mood.js'
import { B, meshWorld, plantStreetTrees, plantTrees, rasterize } from '../world/build.js'
import { MAX_LIT, fx, neonOf, patch } from '../world/fx.js'
import { makeInk } from '../world/ink.js'
import { buildLandmarks, describeSpot } from '../world/landmarks.js'
import { busArrivals, buildingsAround, cityData, toLocal, vworldBuildings, weatherNow } from '../world/live.js'
import { compact, fetchOSM } from '../world/osm.js'
import { guessCrowd, makePeople } from '../world/people.js'
import { PRESETS, RADIUS } from '../world/presets.js'
import { placeSigns, meshSigns } from '../world/signs.js'
import { CHAPTERS, ENDING, PROF, fill, readCleared, saveCleared } from '../world/story.js'
import { fixedTime, skyOf, sunPosition } from '../world/sun.js'
import { GROUND_ID, blockMaterials, leafColor, leafMaterials, makeMaterials } from '../world/textures.js'
import { LEVEL_COLOR, flowsFromCity, guessLevel, makeTraffic } from '../world/traffic.js'
import { WEATHERS, makeWeather } from '../world/weather.js'

const emit = defineEmits(['close'])

const DEX_KEY = 'gp-3d-dex'
const MAX_SIGNS = 3500
const EYE = 1.55
const TALL = 1.7
const R = 0.3
const REACH = 8
const TIMES = [
  { id: 'now', label: '지금' },
  { id: 'day', label: '낮' },
  { id: 'night', label: '밤' },
]

const box = ref(null)
const status = ref('위치를 확인하는 중…')
const notice = ref('')
const where = ref('')
const spot = ref('')
const lineBadges = shallowRef([])
const mini = ref(null)
const signCount = ref(0)
const dense = ref(true)
const paused = ref(true)
const timeMode = ref('now')
const clock = ref('')
const flying = ref(false)
// 포인터 잠금이 막힌 브라우저에서는 마우스를 끌어서 둘러본다
const dragLook = ref(false)
const slot = ref(0)
const hover = shallowRef(null)
const toast = shallowRef(null)
const dex = ref(readDex())
// 실시간: 날씨·도로 소통·혼잡도·가까운 역/정류장 도착 정보·길 찾기 미션
const weatherMode = ref('live')
const weather = shallowRef(null)
const city = shallowRef(null)
const roadText = ref('')
const crowdText = ref('')
const board = shallowRef(null)
const mission = shallowRef(null)
const missionText = ref('')
const missionArrow = ref(0)
// 꺼진 간판의 도시(스토리)와 서울 타임머신
const cleared = ref(readCleared())
const story = shallowRef(null)
const storyText = ref('')
const storyArrow = ref(0)
const dialog = shallowRef(null)
const chat = shallowRef(null)
const machine = shallowRef(null)
// 장 끝 연출 중에는 메뉴를 띄우지 않는다
const ending = ref(false)
const touch = matchMedia('(pointer: coarse)').matches
const blocks = blockMaterials()
const npcImg = (id) => (id ? new URL(`../assets/npc-${id}.webp`, import.meta.url).href : '')

function readDex() {
  try {
    return JSON.parse(localStorage.getItem(DEX_KEY)) || []
  } catch {
    return []
  }
}

const dexSet = computed(() => new Set(dex.value))
const ready = computed(() => !status.value)

// three.js 상태는 반응형으로 두지 않는다
let renderer, scene, camera, sun, ambient, stars, sunDisc, moonDisc, outline, ink
let mats, leafMats
let worldGroup = null
let signGroup = null
let signMeshes = []
let signPlaced = []
let landGroup = null
let landMeshes = []
let landInfos = []
let mapImage = null
let miniTimer = 0
let world = null
let grid = null
let lat = 37.63
let lng = 127.077
let raf = 0
let last = 0
let skyTimer = 0
let target = null
let traffic = null
let people = null
let weatherFx = null
let trafficGroup = null
let peopleGroup = null
let liveSeq = 0
let cityTimer = 0
let weatherTimer = 0
let boardTimer = 0
let cityAt = 0
let lastBurst = 0
// 불 켠 간판: { placed, x, y, z, R, t0, color, frame }
let litList = []
let neonGroup = null
let wave = null
let cine = null
let machineList = []
const voxels = new Map()
const voxelMeshes = []
const keys = new Set()
const player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, ground: false }
const ray = new THREE.Raycaster()
const center = new THREE.Vector2()

// --- 블록 판정 ---------------------------------------------------------------
const vkey = (i, y, k) => `${i},${y},${k}`

function solid(i, y, k) {
  if (y < 0) return true
  if (grid && i >= 0 && k >= 0 && i < grid.N && k < grid.N && y < grid.height[k * grid.N + i]) return true
  return voxels.has(vkey(i, y, k))
}

const cellOf = (x) => Math.floor(x / B + grid.half)

function hits(p) {
  const i0 = cellOf(p.x - R)
  const i1 = cellOf(p.x + R)
  const k0 = cellOf(p.z - R)
  const k1 = cellOf(p.z + R)
  const y0 = Math.floor(p.y / B)
  const y1 = Math.floor((p.y + TALL - 0.01) / B)
  for (let y = y0; y <= y1; y++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) if (solid(i, y, k)) return true
  return false
}

// 칸 단위로 시선을 따라가며 처음 닿는 블록을 찾는다
function march(origin, dir, max) {
  const o = [origin.x / B + grid.half, origin.y / B, origin.z / B + grid.half]
  const d = [dir.x, dir.y, dir.z]
  const c = o.map(Math.floor)
  const step = d.map((v) => (v > 0 ? 1 : -1))
  const delta = d.map((v) => Math.abs(1 / (v || 1e-9)))
  const side = d.map((v, a) => (v > 0 ? c[a] + 1 - o[a] : o[a] - c[a]) * delta[a])
  let t = 0
  let face = -1
  while (t * B <= max) {
    if (solid(c[0], c[1], c[2])) {
      const normal = [0, 0, 0]
      if (face >= 0) normal[face] = -step[face]
      return { cell: c, normal, dist: t * B }
    }
    face = side[0] < side[1] ? (side[0] < side[2] ? 0 : 2) : side[1] < side[2] ? 1 : 2
    t = side[face]
    side[face] += delta[face]
    c[face] += step[face]
  }
  return null
}

// --- 장면 ---------------------------------------------------------------------
function setupScene() {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
  box.value.appendChild(renderer.domElement)
  scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x8ec5ff, 60, 330)
  camera = new THREE.PerspectiveCamera(72, 1, 0.15, 1200)
  camera.rotation.order = 'YXZ'
  ambient = new THREE.AmbientLight(0xffffff, 0.6)
  sun = new THREE.DirectionalLight(0xffffff, 1.3)
  scene.add(ambient, sun, sun.target)

  // 마크처럼 네모난 해와 달
  sunDisc = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: 0xfff3b0, fog: false }))
  moonDisc = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0xe8eef8, fog: false }))
  const starPos = []
  for (let i = 0; i < 700; i++) {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.05, Math.random() - 0.5).normalize().multiplyScalar(900)
    starPos.push(v.x, v.y, v.z)
  }
  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))
  stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, transparent: true }))
  scene.add(sunDisc, moonDisc, stars)

  outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(B + 0.02, B + 0.02, B + 0.02)), new THREE.LineBasicMaterial({ color: 0x111111 }))
  outline.visible = false
  scene.add(outline)

  mats = makeMaterials()
  leafMats = leafMaterials(leafColor(new Date().getMonth() + 1))
  weatherFx = makeWeather()
  scene.add(weatherFx.group)
  const cube = new THREE.BoxGeometry(B, B, B)
  for (const m of [...blocks.map((b) => b.mat), leafMats.trunk, leafMats.leaf]) {
    const inst = new THREE.InstancedMesh(cube, m, 1)
    inst.count = 0
    voxelMeshes.push(inst)
    scene.add(inst)
    patch(m)
  }
  for (const m of mats.groundMats) patch(m, 'wet')
  for (const m of [...mats.wallMats, mats.shopMat, mats.roofMat]) patch(m, 'year')
  // 펜 선·빗금·종이 바탕으로 다시 그린다
  ink = makeInk(renderer)
  resize()
}

function resize() {
  if (!renderer) return
  const { clientWidth: w, clientHeight: h } = box.value
  renderer.setSize(w, h)
  ink?.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

// 블록 종류마다 인스턴스 메시를 다시 채운다
const TRUNK = blocks.length
const LEAF = blocks.length + 1
function redrawVoxels() {
  const groups = voxelMeshes.map(() => [])
  for (const [key, type] of voxels) groups[type].push(key)
  const m = new THREE.Matrix4()
  groups.forEach((list, type) => {
    let inst = voxelMeshes[type]
    if (inst.instanceMatrix.count < list.length) {
      const bigger = new THREE.InstancedMesh(inst.geometry, inst.material, list.length + 256)
      scene.remove(inst)
      inst.dispose()
      scene.add(bigger)
      voxelMeshes[type] = inst = bigger
    }
    list.forEach((key, n) => {
      const [i, y, k] = key.split(',').map(Number)
      inst.setMatrixAt(n, m.makeTranslation((i - grid.half + 0.5) * B, (y + 0.5) * B, (k - grid.half + 0.5) * B))
    })
    inst.count = list.length
    inst.instanceMatrix.needsUpdate = true
    inst.computeBoundingSphere()
  })
}

function disposeGroup(g) {
  if (!g) return
  scene.remove(g)
  g.traverse((o) => {
    o.geometry?.dispose()
    if (o.material && !Object.values(mats).flat().includes(o.material)) {
      o.material.map?.dispose()
      o.material.dispose()
    }
  })
}

// --- 세계 만들기 --------------------------------------------------------------
async function loadHand(text) {
  const chars = [...new Set(text + '0123456789층호선역')].join('')
  await Promise.all(['400', '700'].map((w) => document.fonts.load(`${w} 20px Gaegu`, chars).catch(() => {})))
}

async function enter(next, label, area = '') {
  status.value = '간판을 세우는 중…'
  clearFx()
  disposeGroup(worldGroup)
  disposeGroup(signGroup)
  disposeGroup(landGroup)
  disposeGroup(trafficGroup)
  disposeGroup(peopleGroup)
  voxels.clear()
  mission.value = null
  board.value = null
  world = next
  lng = world.lng
  lat = world.lat
  grid = rasterize(world)
  worldGroup = meshWorld(grid, mats)
  scene.add(worldGroup)

  let seed = Math.round(lng * 1e4) ^ Math.round(lat * 1e4)
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  const trees = plantTrees(grid, rand)
  for (const [i, y, k] of trees.trunk) voxels.set(vkey(i, y, k), TRUNK)
  for (const [i, y, k] of trees.leaf) if (!voxels.has(vkey(i, y, k))) voxels.set(vkey(i, y, k), LEAF)
  const street = plantStreetTrees(grid, world, (i, k) => voxels.has(vkey(i, 0, k)))
  for (const [i, y, k] of street.trunk) voxels.set(vkey(i, y, k), TRUNK)
  for (const [i, y, k] of street.leaf) if (!voxels.has(vkey(i, y, k))) voxels.set(vkey(i, y, k), LEAF)
  redrawVoxels()
  traffic = makeTraffic(world, grid, rand)
  trafficGroup = traffic.group
  scene.add(trafficGroup)
  people = makePeople(grid, rand)
  peopleGroup = people.group
  scene.add(peopleGroup)

  const found = await signsAround(lng, lat, world.r).catch(() => ({ dense: false, rows: [] }))
  // 손글씨 글꼴은 글자 조각별로 받으므로 간판·지명에 쓰인 글자를 미리 다 받아 둔다
  await loadHand(found.rows.map((r) => r.name).join('') + JSON.stringify(world).replace(/[\x00-\x7f]/g, ''))
  dense.value = found.dense
  signPlaced = placeSigns(grid, found.rows.slice(0, MAX_SIGNS))
  const made = meshSigns(signPlaced)
  signGroup = made.group
  signMeshes = made.meshes
  scene.add(signGroup)
  signCount.value = signPlaced.length
  world.bk = []
  world.wk = []
  buildLand()
  for (const g of [worldGroup, trafficGroup, peopleGroup]) patchGroup(g)
  for (const m of signMeshes) patch(m.material, 'sign')
  patchGroup(signGroup)
  lineBadges.value = world.ln || []
  applyCity(null)

  spawn()
  where.value = label
  status.value = ''
  updateSky()
  loadLive(area)
}

function buildLand() {
  disposeGroup(landGroup)
  const land = buildLandmarks(world, grid)
  landGroup = land.group
  landMeshes = land.meshes
  landInfos = land.infos
  scene.add(landGroup)
  patchGroup(landGroup)
  if (machine.value) landGroup.visible = false
}

function patchGroup(g) {
  g?.traverse((o) => {
    if (o.isMesh) for (const m of [o.material].flat()) patch(m)
  })
}

// --- 실시간 자료 -------------------------------------------------------------
async function loadLive(area) {
  const seq = ++liveSeq
  clearInterval(cityTimer)
  clearInterval(weatherTimer)
  city.value = null
  refreshWeather(seq)
  weatherTimer = setInterval(() => refreshWeather(seq), 15 * 60 * 1000)
  if (!area) return
  const pull = async () => {
    const data = await cityData(area)
    if (seq !== liveSeq || !data) return
    city.value = data
    applyCity(data)
  }
  await pull()
  cityTimer = setInterval(pull, 5 * 60 * 1000)
}

async function refreshWeather(seq) {
  const w = await weatherNow(lng, lat).catch(() => null)
  if (seq !== liveSeq) return
  weather.value = w
  applyWeather()
}

// 도로 소통·혼잡도·따릉이·공사를 세계에 반영한다. 자료가 없으면 시간대로 어림한다
function applyCity(data) {
  const now = timeNow()
  const guess = guessLevel(now)
  const level = ['원활', '서행', '정체'].includes(data?.road.level) ? data.road.level : guess
  traffic.setFlow(data ? flowsFromCity(data) : new Map(), level)
  roadText.value = data ? `${level}${data.road.speed ? ` ${data.road.speed}km/h` : ''}` : `${guess} (추정)`
  const crowd = data?.people.level || guessCrowd(now)
  people.setCrowd(crowd)
  crowdText.value = data ? crowd : `${crowd} (추정)`
  const near = (x, y) => Math.abs(x) < world.r && Math.abs(y) < world.r
  const had = world.bk.length + world.wk.length
  world.bk = (data?.bike || []).map(([name, x, y, count, rack]) => [name, ...toLocal(world, x, y), count, rack]).filter(([, x, y]) => near(x, y))
  world.wk = (data?.works || []).map(([type, dtype, info, x, y]) => [dtype || type, info, ...toLocal(world, x, y)]).filter(([, , x, y]) => near(x, y))
  if (had || world.bk.length || world.wk.length) buildLand()
  cityAt = Date.now()
  mapImage = drawMap()
}

const weatherKind = () => (weatherMode.value === 'live' ? weather.value?.kind || 'clear' : weatherMode.value)

function applyWeather() {
  weatherFx.set(weatherKind())
  if (grid) updateSky()
}

function setWeather(id) {
  weatherMode.value = id
  sfx.click()
  applyWeather()
}

const WEATHER_ICON = { clear: '☀️', cloud: '☁️', rain: '🌧️', snow: '❄️' }
const weatherLabel = computed(() => {
  const kind = weatherKind()
  const temp = weatherMode.value === 'live' && weather.value ? ` ${weather.value.temp}°` : ''
  return `${WEATHER_ICON[kind]}${temp}${weatherMode.value === 'live' ? '' : ' (고정)'}`
})

// 가운데에서 가장 가까운 빈 바닥에 선다
function spawn() {
  const { N, half, height, ground } = grid
  let best = null
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      const c = k * N + i
      if (height[c] || ground[c] === GROUND_ID.water || voxels.has(vkey(i, 0, k)) || voxels.has(vkey(i, 1, k))) continue
      const d = (i - half) ** 2 + (k - half) ** 2 - (ground[c] === GROUND_ID.road || ground[c] === GROUND_ID.path ? 30 : 0)
      if (!best || d < best.d) best = { d, i, k }
    }
  }
  player.pos.set((best.i - half + 0.5) * B, 0, (best.k - half + 0.5) * B)
  player.vel.set(0, 0, 0)
  player.yaw = 0
  player.pitch = 0
}

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no geolocation'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords),
      reject,
      { timeout: 10000, maximumAge: 60000 },
    )
  })
}

const near = (a, b) => Math.hypot((a.lng - b.lng) * 88000, (a.lat - b.lat) * 110540)

// 내 위치 지도는 뒤에서 받는다: '' | loading | ready | failed
const hereWorld = shallowRef(null)
const hereState = ref('')
let hereSeq = 0

async function startHere() {
  notice.value = ''
  status.value = '위치를 확인하는 중…'
  let coords
  try {
    coords = await locate()
  } catch {
    // 브라우저는 https 주소에서만 위치를 알려 준다
    notice.value = window.isSecureContext ? '위치 권한이 없어서 서울과학기술대학교에서 시작해요' : '이 주소(http)에서는 위치를 못 받아서 서울과학기술대학교에서 시작해요'
    return goPreset(PRESETS[0], true)
  }
  const me = { lng: coords.longitude, lat: coords.latitude }
  const preset = PRESETS.find((p) => near(p, me) < 150)
  if (preset) return goPreset(preset)
  // 공개 OSM 서버를 기다리지 않는다: 가장 가까운 프리셋으로 바로 들어가고 내 위치 지도는 뒤에서 받는다
  const closest = [...PRESETS].sort((a, b) => near(a, me) - near(b, me))[0]
  const seq = ++hereSeq
  hereWorld.value = null
  hereState.value = 'loading'
  notice.value = '내 위치 지도는 뒤에서 받는 중이에요. 준비되면 메뉴에 📍 버튼이 생겨요'
  await goPreset(closest, true)
  // 길은 OpenStreetMap, 건물은 국토부 GIS건물통합정보(브이월드)에서 함께 받는다. OSM 이 죽어도 건물은 세운다
  const [osm, gis] = await Promise.all([
    fetchOSM(me.lng, me.lat, RADIUS, { timeout: 40000 }).catch(() => null),
    buildingsAround(me.lng, me.lat, RADIUS).catch(() => null),
  ])
  if (seq !== hereSeq) return
  const world = osm ? compact(osm, me.lng, me.lat, RADIUS) : { lng: me.lng, lat: me.lat, r: RADIUS, b: [], w: [], a: [], st: [], ex: [], bus: [], ln: [] }
  if (gis?.b?.length > 3) {
    const named = world.b.filter((b) => b[1])
    world.b = vworldBuildings(gis.b, me.lng, me.lat).map((b) => (b[1] ? b : [b[0], nameInside(b[2], named), ...b.slice(2)]))
    world.bsrc = 'gis'
  }
  if (!world.b.length && !world.w.length) {
    hereState.value = 'failed'
    notice.value = '지도 서버가 응답하지 않아서 내 위치 지도를 못 받았어요. 잠시 뒤 📍 내 위치를 다시 눌러 보세요'
    return
  }
  hereWorld.value = world
  hereState.value = 'ready'
  notice.value = osm ? '' : 'OpenStreetMap 서버가 응답하지 않아서 내 위치는 길 없이 건물만 세워요'
}

async function goHere() {
  const world = hereWorld.value
  if (!world) return
  hereWorld.value = null
  hereState.value = ''
  notice.value = ''
  status.value = '내 위치 지도를 펼치는 중…'
  await enter(world, '내 위치')
}

// GIS 건물에 이름이 없으면 그 안에 든 OSM 건물 이름을 빌린다
function nameInside(flat, named) {
  for (const [, name, f] of named) {
    let cx = 0
    let cy = 0
    for (let n = 0; n < f.length; n += 2) {
      cx += f[n]
      cy += f[n + 1]
    }
    cx /= f.length / 2
    cy /= f.length / 2
    let inside = false
    for (let i = 0, j = flat.length - 2; i < flat.length; j = i, i += 2) {
      if (flat[i + 1] > cy !== flat[j + 1] > cy && cx < ((flat[j] - flat[i]) * (cy - flat[i + 1])) / (flat[j + 1] - flat[i + 1]) + flat[i]) inside = !inside
    }
    if (inside) return name
  }
  return ''
}

async function goPreset(p, keepNotice = false) {
  if (!keepNotice) notice.value = ''
  status.value = `${p.label} 지도를 펼치는 중…`
  try {
    await enter(await load(`world/${p.id}.json`), p.label, p.area)
  } catch {
    status.value = ''
    notice.value = '지도를 못 불러왔어요. 잠시 뒤 다시 눌러 보세요'
  }
}

// --- 하늘과 밤낮 ---------------------------------------------------------------
function timeNow() {
  if (timeMode.value === 'day') return fixedTime(13)
  if (timeMode.value === 'night') return fixedTime(22)
  return new Date()
}

function updateSky() {
  const date = timeNow()
  const h = date.getHours()
  clock.value = `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')}`
  const { alt, az } = sunPosition(date, lat, lng)
  const { day, rgb } = skyOf(alt)
  const color = new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace)
  // 흐리거나 비·눈이 오면 하늘이 잿빛이 되고 멀리가 뿌옇다
  const wk = weatherKind()
  if (wk !== 'clear') {
    const grey = (color.r + color.g + color.b) / 3
    color.lerp(new THREE.Color(grey, grey, grey), 0.7).multiplyScalar(wk === 'rain' ? 0.7 : wk === 'snow' ? 1.08 : 0.92)
  }
  scene.fog.near = { rain: 18, snow: 22, cloud: 50 }[wk] || 60
  scene.fog.far = { rain: 170, snow: 150, cloud: 280 }[wk] || 330
  // 하늘에서 내려다보는 연출 중에는 동네 전체가 보이게 안개를 걷는다
  if (cine) {
    scene.fog.near = 200
    scene.fog.far = 900
  }
  scene.background = color
  scene.fog.color.copy(color)
  const dir = new THREE.Vector3(Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az))
  // 해가 지면 반대편 달빛
  sun.position.copy(day > 0.05 ? dir : dir.clone().negate()).multiplyScalar(100)
  sun.intensity = (0.2 + day * 1.2) * (wk === 'clear' ? 1 : 0.55)
  sun.color.setRGB(1, 0.92 + day * 0.08, 0.8 + day * 0.2)
  ambient.intensity = 0.22 + day * 0.45
  ambient.color.setRGB(0.55 + day * 0.45, 0.6 + day * 0.4, 0.85 + day * 0.15)
  const glow = Math.max(0, 1 - day * 1.4)
  for (const m of mats.wallMats) m.emissiveIntensity = glow
  mats.shopMat.emissiveIntensity = glow * 0.7
  stars.material.opacity = glow
  sunDisc.userData.dir = dir
  sunDisc.visible = alt > -0.1
  moonDisc.visible = alt < 0.1
  // 간판은 밤에 불이 들어온 듯 더 밝다
  for (const m of [...signMeshes, ...landMeshes]) m.material.color.setScalar(0.78 + glow * 0.22)
  fx.uNight.value = glow
  ink.uniforms.uNight.value = glow
  spot.value = describeSpot(world, player.pos.x, -player.pos.z)
}

// --- 미니맵 -------------------------------------------------------------------
const MAP_COLOR = ['#c9c4b6', '#55555d', '#c98d7a', '#79b357', '#3f76c9', '#5fa05a', '#77777d', '#8a8178', '#8cbf6a', '#f0efe8']

// 위에서 내려다본 지도를 한 칸 = 1px로 한 번 그려 둔다
function drawMap() {
  const { N, height, ground } = grid
  const c = document.createElement('canvas')
  c.width = N
  c.height = N
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(N, N)
  const rgb = MAP_COLOR.map((h) => [1, 3, 5].map((o) => Number.parseInt(h.slice(o, o + 2), 16)))
  for (let n = 0; n < N * N; n++) {
    const h = height[n]
    const v = h ? Math.max(70, 200 - h * 2) : 0
    const [r, g, b] = h ? [v, v, v + 12] : rgb[ground[n]] || rgb[0]
    img.data.set([r, g, b, 255], n * 4)
  }
  ctx.putImageData(img, 0, 0)
  const dot = (x, y, color, size) => {
    ctx.fillStyle = color
    ctx.fillRect(Math.round(x / B + grid.half - size / 2), Math.round(-y / B + grid.half - size / 2), size, size)
  }
  // 찻길 소통: 초록 원활 · 주황 서행 · 빨강 정체
  if (traffic) {
    ctx.globalAlpha = 0.75
    ctx.lineWidth = 1.5
    for (const lane of traffic.lanes) {
      ctx.strokeStyle = LEVEL_COLOR[traffic.levelOf(lane)]
      ctx.beginPath()
      lane.pts.forEach(([x, y], n) => ctx[n ? 'lineTo' : 'moveTo'](x / B + grid.half, -y / B + grid.half))
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
  for (const [, x, y] of world.bk || []) dot(x, y, '#2fa84f', 3)
  for (const [, , x, y] of world.wk || []) dot(x, y, '#ff6a13', 4)
  for (const [, x, y] of world.bus || []) dot(x, y, '#2fd0d0', 3)
  for (const [, x, y] of world.ex || []) dot(x, y, '#ffd200', 4)
  for (const [, x, y] of world.st || []) dot(x, y, world.ln?.[0]?.[1] || '#ffffff', 7)
  return c
}

function drawMini() {
  const el = mini.value
  if (!el || !mapImage) return
  const ctx = el.getContext('2d')
  const S = el.width
  const span = 120
  const pi = player.pos.x / B + grid.half
  const pk = player.pos.z / B + grid.half
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#c9c4b6'
  ctx.fillRect(0, 0, S, S)
  ctx.drawImage(mapImage, pi - span / 2, pk - span / 2, span, span, 0, 0, S, S)
  // 미션 목표: 지도 밖이면 가장자리에 붙여 깜빡인다
  if (mission.value) {
    const m = mission.value
    const mx = Math.max(6, Math.min(S - 6, ((m.x / B + grid.half - pi) / span) * S + S / 2))
    const my = Math.max(6, Math.min(S - 6, ((-m.y / B + grid.half - pk) / span) * S + S / 2))
    if (Math.floor(performance.now() / 300) % 2) {
      ctx.fillStyle = '#ff2fa0'
      ctx.fillRect(mx - 5, my - 5, 10, 10)
      ctx.strokeStyle = '#fff'
      ctx.strokeRect(mx - 5, my - 5, 10, 10)
    }
  }
  // 나: 보는 쪽을 가리키는 세모
  ctx.save()
  ctx.translate(S / 2, S / 2)
  ctx.rotate(-player.yaw)
  ctx.fillStyle = '#e8312f'
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(0, -8)
  ctx.lineTo(6, 6)
  ctx.lineTo(0, 3)
  ctx.lineTo(-6, 6)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
  ctx.fillStyle = '#1d1d2b'
  ctx.font = '700 13px Gaegu'
  ctx.textAlign = 'center'
  ctx.fillText('N', S / 2, 12)
}

// --- 조작 ---------------------------------------------------------------------
function update(dt) {
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight')
  const speed = flying.value ? (run ? 30 : 14) : run ? 7.5 : 4.6
  let fx = 0
  let fz = 0
  if (keys.has('KeyW') || keys.has('ArrowUp') || keys.has('touch-up')) fz -= 1
  if (keys.has('KeyS') || keys.has('ArrowDown') || keys.has('touch-down')) fz += 1
  if (keys.has('KeyA') || keys.has('ArrowLeft') || keys.has('touch-left')) fx -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight') || keys.has('touch-right')) fx += 1
  const len = Math.hypot(fx, fz) || 1
  const sin = Math.sin(player.yaw)
  const cos = Math.cos(player.yaw)
  const vx = ((fx * cos + fz * sin) / len) * speed
  const vz = ((-fx * sin + fz * cos) / len) * speed
  const p = player.pos

  const jump = keys.has('Space') || keys.has('touch-jump')
  if (flying.value) {
    player.vel.y = jump ? 9 : keys.has('KeyC') || keys.has('ControlLeft') ? -9 : 0
  } else {
    player.vel.y -= 26 * dt
    if (jump && player.ground) player.vel.y = 9.6
  }

  const old = p.clone()
  p.x += vx * dt
  if (hits(p)) p.x = old.x
  p.z += vz * dt
  if (hits(p)) p.z = old.z
  player.ground = false
  p.y += player.vel.y * dt
  if (hits(p)) {
    if (player.vel.y < 0) {
      p.y = Math.ceil(p.y / B - 1e-6) * B
      if (hits(p)) p.y = old.y
      player.ground = true
      // 마인크래프트처럼 날다가 땅에 닿으면 내려선다
      if (flying.value) flying.value = false
    } else {
      p.y = old.y
    }
    player.vel.y = 0
  }
  const edge = (grid.N / 2 - 1) * B
  p.x = Math.max(-edge, Math.min(edge, p.x))
  p.z = Math.max(-edge, Math.min(edge, p.z))
  p.y = Math.min(p.y, 260)

  camera.position.set(p.x, p.y + EYE, p.z)
  camera.rotation.set(player.pitch, player.yaw, 0)
}

const look = new THREE.Vector3()

// 화면 가운데(또는 누른 곳)가 가리키는 간판과 블록
function aim(at = center) {
  ray.setFromCamera(at, camera)
  ray.far = 70
  look.copy(ray.ray.direction)
  const block = march(camera.position, look, 70)
  const hit = ray.intersectObjects([...signMeshes, ...landMeshes], false)[0]
  const seen = hit && (!block || hit.distance <= block.dist + 0.2)
  const id = seen ? hit.object.userData.owner[hit.faceIndex] : -1
  const sign = seen && signMeshes.includes(hit.object) ? signPlaced[id] : null
  const land = seen && !sign ? landInfos[id] : null
  // 바라보는 건물 벽이면 그 건물 번호
  let bldg = 0
  if (!seen && block) {
    const [i, y, k] = block.cell
    const c = k * grid.N + i
    if (i >= 0 && k >= 0 && i < grid.N && k < grid.N && y < grid.height[c]) bldg = grid.owner[c]
  }
  return { sign, land, bldg, block: block && block.dist <= REACH ? block : null }
}

function act(button, at) {
  const { sign, land, block } = aim(at)
  if (button === 0 && sign) return story.value && !story.value.done ? repair(sign) : collect(sign.sign)
  if (button === 0 && land) return showLand(land)
  if (!block) return
  const [i, y, k] = block.cell
  if (button === 0) {
    if (voxels.delete(vkey(i, y, k))) {
      sfx.tick()
      redrawVoxels()
    }
    return
  }
  const [ni, ny, nk] = [i + block.normal[0], y + block.normal[1], k + block.normal[2]]
  if (solid(ni, ny, nk)) return
  voxels.set(vkey(ni, ny, nk), slot.value)
  if (hits(player.pos)) {
    voxels.delete(vkey(ni, ny, nk))
    return
  }
  sfx.build(slot.value)
  redrawVoxels()
}

let toastTimer = 0
function collect(s, quiet = false) {
  const key = `${s.name}|${s.cat}`
  const fresh = !dexSet.value.has(key)
  if (fresh) {
    dex.value = [...dex.value, key].slice(-3000)
    try {
      localStorage.setItem(DEX_KEY, JSON.stringify(dex.value))
    } catch {
      // 저장이 막히면 이번 방문 동안만 센다
    }
  }
  if (quiet) return
  fresh ? sfx.right() : (sfx.click(), react('think', 1200))
  toast.value = { ...s, fresh }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 3200)
}

function showLand(info) {
  sfx.click()
  toast.value = { land: info }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 3200)
}

const floorText = (f) => (f > 0 ? `${f}층` : f < 0 ? `지하 ${-f}층` : '층 정보 없음')

// 건물 정보: GIS 프리셋은 용도·층수·사용승인 연도까지 안다
function bldgInfo(o) {
  const b = world.b[o - 1]
  if (!b) return null
  const [h, name, , , floors, use, year] = b
  const parts = [use, floors ? `지상 ${floors}층` : `높이 ${h}m`, year ? `${year}년` : ''].filter(Boolean)
  if (!name && !use) return null
  return { title: name || use, sub: parts.join(' · ') }
}

function frame(now) {
  raf = requestAnimationFrame(frame)
  const dt = Math.min(0.05, (now - last) / 1000 || 0)
  last = now
  if (!grid || status.value) {
    ink.render(scene, camera, now)
    return
  }
  const t = now / 1000
  if (cine) runCine(t)
  else if (!paused.value || touch) update(dt)
  skyTimer -= dt
  if (skyTimer <= 0) {
    skyTimer = 1
    updateSky()
  }
  if (traffic.update(dt, player.pos) && (!paused.value || touch) && !fx.uSpreadOn.value) sfx.horn()
  people.update(dt, camera.position, t)
  weatherFx.update(dt, camera.position)
  if (fx.uSpreadOn.value) updateSpread(t)
  if (machine.value) updateMachine(dt)
  boardTimer -= dt
  if (boardTimer <= 0) {
    boardTimer = 0.5
    updateBoard()
    updateMission()
    updateStory()
  }
  const { sign, land, bldg, block } = aim()
  const seen = sign ? { sign: sign.sign, lit: litList.some((l) => l.placed === sign) } : land ? { land } : bldg ? { bldg } : null
  if (hover.value?.sign !== seen?.sign || hover.value?.land !== seen?.land || hover.value?.bldg !== seen?.bldg) hover.value = seen ? { ...seen, info: bldg ? bldgInfo(bldg) : null } : null
  target = block
  outline.visible = !!block && block.cell[1] >= 0
  if (outline.visible) outline.position.set((block.cell[0] - grid.half + 0.5) * B, (block.cell[1] + 0.5) * B, (block.cell[2] - grid.half + 0.5) * B)
  // 해와 달은 늘 카메라에서 같은 거리
  const dir = sunDisc.userData.dir
  if (dir) {
    sunDisc.position.copy(camera.position).addScaledVector(dir, 700)
    sunDisc.lookAt(camera.position)
    moonDisc.position.copy(camera.position).addScaledVector(dir, -700)
    moonDisc.lookAt(camera.position)
  }
  stars.position.copy(camera.position)
  miniTimer -= dt
  if (miniTimer <= 0) {
    miniTimer = 0.1
    drawMini()
  }
  ink.render(scene, camera, now)
}

// --- 꺼진 간판의 도시 -------------------------------------------------------------
const unlocked = (n) => n === 0 || cleared.value.includes(CHAPTERS[n - 1].id)

// 효과를 모두 걷어 낸다. 새 지도로 들어가거나 스토리·타임머신을 끝낼 때
function clearFx() {
  litList = []
  wave = null
  cine = null
  ending.value = false
  fx.uSpreadOn.value = 0
  fx.uSpreadN.value = 0
  fx.uWave.value.set(0, 0, 0)
  fx.uYear.value = 9999
  disposeGroup(neonGroup)
  neonGroup = null
  traffic?.setZone(null)
  people?.setZone(null)
  for (const g of [signGroup, landGroup, trafficGroup, peopleGroup]) if (g) g.visible = true
  story.value = null
  machine.value = null
  dialog.value = null
  chat.value = null
}

async function startStory(n) {
  const ch = CHAPTERS[n]
  const preset = PRESETS.find((p) => p.id === ch.id)
  await goPreset(preset)
  if (!grid || where.value !== preset.label) return
  timeMode.value = 'night'
  weatherMode.value = ch.weather
  applyWeather()
  fx.uSpreadOn.value = 1
  neonGroup = new THREE.Group()
  scene.add(neonGroup)
  traffic.setZone([])
  people.setZone([])
  // 부탁받은 가게: 출발점에서 25~120m 사이의 그 업종 간판, 없으면 가까운 아무 간판
  const px = player.pos.x
  const pz = player.pos.z
  const cand = signPlaced.map((p) => ({ p, d: Math.hypot(signAt(p).x - px, signAt(p).z - pz) }))
  const far = cand.filter((c) => c.d > 25 && c.d < 120).sort((a, b) => a.d - b.d)
  const pick = far.find((c) => ch.want.test(c.p.sign.cat)) || far[0] || cand[0]
  const goal = Math.min(ch.goal, signPlaced.length)
  story.value = { n, ch, goal, lit: 0, shop: pick?.p || null, shopLit: false, half: false, done: false }
  updateStory()
  say(ch.npc, ch.intro.map((l) => fill(l, { goal, shop: pick?.p.sign.name || '' })))
}

function exitStory() {
  clearFx()
  timeMode.value = 'now'
  weatherMode.value = 'live'
  applyWeather()
  sfx.click()
}

// 간판 면 가운데 (장면 좌표)
function signAt(p) {
  const [px, pz, qx, qz] = p.faces[0]
  return { x: (px + qx) / 2, y: p.y, z: (pz + qz) / 2 }
}

// 대화창: 다 읽으면 then 을 부르거나 다시 걷는다. choices 가 있으면 마지막 줄에서 고른다
function say(npc, lines, opts = {}) {
  if (document.pointerLockElement) document.exitPointerLock()
  dragLook.value = false
  paused.value = true
  keys.clear()
  dialog.value = { who: npc.name, face: npc.face, img: npcImg(npc.img), lines, i: 0, ...opts }
}

function nextLine(choice) {
  const d = dialog.value
  if (!d) return
  if (d.i + 1 < d.lines.length) {
    sfx.tick()
    dialog.value = { ...d, i: d.i + 1 }
    return
  }
  if (d.choices && !choice) choice = d.choices[0]
  dialog.value = null
  if (choice) return choice.fn()
  if (d.then) return d.then()
  lock()
}

// 걷는 동안 잠깐 뜨는 말풍선
let chatTimer = 0
function speak(npc, text) {
  chat.value = { who: npc.name, face: npc.face, img: npcImg(npc.img), text }
  clearTimeout(chatTimer)
  chatTimer = setTimeout(() => (chat.value = null), 4500)
}

// 간판 고치기: 네온이 지직거리다 켜지고 둘레로 색이 번진다
function repair(placed) {
  const st = story.value
  if (litList.some((l) => l.placed === placed) || litList.length >= MAX_LIT) return collect(placed.sign)
  const { x, y, z } = signAt(placed)
  const isShop = placed === st.shop
  const color = neonOf(pastelOf(placed.sign.cat))
  const frame = neonFrame(placed, color)
  litList.push({ placed, x, y, z, R: isShop ? 34 : 20, t0: performance.now() / 1000, color, frame })
  sfx.neon(litList.length - 1)
  react('proud')
  collect(placed.sign, true)
  hover.value = hover.value?.sign === placed.sign ? { ...hover.value, lit: true } : hover.value
  toast.value = { neon: placed.sign, n: litList.length, goal: st.goal }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 2600)
  const next = { ...st, lit: litList.length }
  if (isShop) {
    next.shopLit = true
    speak(st.ch.npc, st.ch.shop)
  } else if (!st.half && next.lit >= Math.ceil(st.goal / 2) && next.lit < st.goal) {
    next.half = true
    speak(st.ch.npc, st.ch.half)
  }
  story.value = next
  updateStory()
  if (next.lit >= st.goal) finishChapter()
}

// 간판 둘레를 형광펜으로 한 번 더 두른다
function neonFrame(placed, color) {
  const g = new THREE.Group()
  const mat = new THREE.MeshBasicMaterial({ color })
  const half = (B * 0.47 * placed.scale) / 2 + 0.05
  for (const [px, pz, qx, qz] of placed.faces) {
    const len = Math.hypot(qx - px, qz - pz)
    const w = (len * 0.94 * placed.scale) / 2 + 0.05
    const nx = -(qz - pz) / len
    const nz = (qx - px) / len
    const f = new THREE.Group()
    const bar = (cx, cy, sx, sy) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.05), mat)
      m.position.set(cx, cy, 0)
      f.add(m)
    }
    bar(0, half, w * 2 + 0.06, 0.06)
    bar(0, -half, w * 2 + 0.06, 0.06)
    bar(-w, 0, 0.06, half * 2)
    bar(w, 0, 0.06, half * 2)
    f.position.set((px + qx) / 2 + nx * 0.06, placed.y, (pz + qz) / 2 + nz * 0.06)
    f.rotation.y = Math.atan2(qx - px, qz - pz) - Math.PI / 2
    g.add(f)
  }
  neonGroup.add(g)
  return g
}

const ease = (v) => 1 - (1 - v) ** 3

// 매 프레임: 번지는 반지름·깜빡임·사람과 차가 돌아올 구역
let zoneTimer = 0
function updateSpread(t) {
  const P = fx.uSpreadP.value
  const C = fx.uSpreadC.value
  litList.forEach((l, n) => {
    const age = t - l.t0
    // 처음 0.7초는 형광등처럼 지직거린다
    const on = age > 0.7 || Math.sin(age * 47) * Math.sin(age * 13) > 0
    l.frame.visible = on
    l.r = l.R * ease(Math.min(1, age / 1.8))
    P[n].set(l.x, l.y, l.z, on ? Math.max(0.3, l.r) : 0)
    C[n].set(l.color.r, l.color.g, l.color.b)
  })
  fx.uSpreadN.value = litList.length
  if (wave) {
    wave.r = 700 * ease(Math.min(1, (t - wave.t0) / 4.5)) * Math.min(1, (t - wave.t0) / 0.6)
    fx.uWave.value.set(wave.x, wave.z, wave.r)
  }
  zoneTimer -= 1 / 60
  if (zoneTimer > 0) return
  zoneTimer = 0.4
  const zone = wave && wave.r > 400 ? null : litList.map((l) => [l.x, -l.z, l.r * 0.9])
  if (wave && zone) zone.push([wave.x, -wave.z, wave.r])
  traffic.setZone(zone)
  people.setZone(zone)
}

function updateStory() {
  const st = story.value
  if (!st) return
  if (st.done || st.shopLit || !st.shop) {
    storyText.value = ''
    return
  }
  const { x, z } = signAt(st.shop)
  const dx = x - player.pos.x
  const dy = -(z - player.pos.z)
  storyArrow.value = Math.round(((Math.atan2(dx, dy) + player.yaw) * 180) / Math.PI)
  storyText.value = `${st.ch.npc.face} 「${st.shop.sign.name}」 간판 · ${Math.round(Math.hypot(dx, dy))}m`
}

// 장 끝: 동네 전체로 색이 번지고 카메라가 하늘로 올라간다
function finishChapter() {
  const st = story.value
  story.value = { ...st, done: true }
  if (!cleared.value.includes(st.ch.id)) {
    cleared.value = [...cleared.value, st.ch.id]
    saveCleared(cleared.value)
  }
  const t = performance.now() / 1000
  wave = { x: player.pos.x, z: player.pos.z, t0: t }
  const cx = litList.reduce((a, l) => a + l.x, 0) / litList.length
  const cz = litList.reduce((a, l) => a + l.z, 0) / litList.length
  if (document.pointerLockElement) document.exitPointerLock()
  dragLook.value = false
  paused.value = true
  keys.clear()
  cine = { t0: t, from: camera.position.clone(), yaw: player.yaw, pitch: player.pitch, cx, cz }
  ending.value = true
  setTimeout(() => sfx.dawn(), 600)
  setTimeout(() => {
    if (story.value?.ch !== st.ch) return
    const last = st.n + 1 >= CHAPTERS.length
    const stay = {
      label: '이 동네 더 둘러보기',
      fn: () => {
        cine = null
        ending.value = false
        lock()
      },
    }
    const next = last
      ? { label: '🕰️ 서울 타임머신', fn: () => say(PROF, ENDING, { then: startMachine }) }
      : { label: `▶ ${CHAPTERS[st.n + 1].title}`, fn: () => startStory(st.n + 1) }
    say(st.ch.npc, st.ch.done, { choices: [next, stay] })
  }, 5200)
}

// 장 끝 연출과 타임머신: 하늘에서 동네를 내려다보며 천천히 돈다
function runCine(t) {
  const age = t - cine.t0
  const k = ease(Math.min(1, age / 4))
  const ang = age * 0.06
  const dist = cine.orbit || 120
  const tx = cine.cx + Math.sin(ang) * dist * 0.7
  const tz = cine.cz + Math.cos(ang) * dist * 0.7
  const ty = cine.height || 95
  const pos = new THREE.Vector3(tx, ty, tz)
  if (cine.from) pos.lerp(cine.from, 1 - k)
  camera.position.copy(pos)
  const dx = cine.cx - pos.x
  const dz = cine.cz - pos.z
  const dy = 4 - pos.y
  const yaw = Math.atan2(-dx, -dz)
  const pitch = Math.atan2(dy, Math.hypot(dx, dz))
  if (cine.from) {
    let dyaw = yaw - cine.yaw
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw))
    camera.rotation.set(cine.pitch + (pitch - cine.pitch) * k, cine.yaw + dyaw * k, 0)
  } else camera.rotation.set(pitch, yaw, 0)
}

// --- 서울 타임머신 -----------------------------------------------------------------
function startMachine() {
  if (!grid) return
  const known = world.b.map(([h, name, , , floors, use, year]) => ({ h, name, floors, use, year })).filter((b) => b.year)
  if (!known.length) {
    notice.value = '이 지도에는 건물 사용승인 연도 자료가 없어요'
    paused.value = true
    return
  }
  clearFx()
  machineList = known.sort((a, b) => a.year - b.year)
  const min = Math.max(1900, machineList[0].year - 2)
  if (document.pointerLockElement) document.exitPointerLock()
  dragLook.value = false
  paused.value = true
  keys.clear()
  timeMode.value = 'day'
  weatherMode.value = 'clear'
  applyWeather()
  for (const g of [signGroup, landGroup, trafficGroup, peopleGroup]) g.visible = false
  cine = { t0: performance.now() / 1000, cx: 0, cz: 0, orbit: world.r * 0.5, height: world.r * 0.3 }
  machine.value = { min, max: 2026, year: min, playing: true, count: 0, total: world.b.length, unknown: world.b.length - machineList.length, recent: [] }
  fx.uYear.value = min
  machineYear = min
  lastTick = min
  sfx.click()
}

let machineYear = 0
let lastTick = 0
function updateMachine(dt) {
  const m = machine.value
  if (m.playing) {
    // 처음부터 끝까지 20초 남짓
    machineYear = Math.min(m.max + 0.99, machineYear + ((m.max - m.min) / 22) * dt)
    if (machineYear >= m.max + 0.99) setMachine({ playing: false })
  }
  fx.uYear.value = machineYear
  const y = Math.floor(machineYear)
  if (y === m.year && m.count) return
  const built = machineList.filter((b) => b.year <= y)
  const fresh = built.filter((b) => b.year > y - 3 && (b.name || b.use)).sort((a, b) => b.h - a.h)
  if (y > lastTick && built.some((b) => b.year === y)) sfx.build(y % 5)
  lastTick = y
  machine.value = { ...m, year: y, count: built.length, recent: fresh.slice(0, 3) }
}

function setMachine(patch) {
  machine.value = { ...machine.value, ...patch }
}

function scrubMachine(e) {
  machineYear = Number(e.target.value)
  setMachine({ playing: false, count: 0 })
}

function playMachine() {
  const m = machine.value
  if (m.playing) return setMachine({ playing: false })
  if (machineYear >= m.max) machineYear = m.min
  setMachine({ playing: true })
  sfx.click()
}

function endMachine() {
  clearFx()
  timeMode.value = 'now'
  weatherMode.value = 'live'
  applyWeather()
  paused.value = true
  sfx.click()
}

// --- 가까운 역·정류장 도착 정보 ----------------------------------------------
const secText = (sec) => (sec <= 0 ? '곧 도착' : sec < 60 ? `${sec}초 후` : `${Math.floor(sec / 60)}분 ${sec % 60 ? `${sec % 60}초 ` : ''}후`)
let busBusy = false
let busFor = ''

function updateBoard() {
  const x = player.pos.x
  const y = -player.pos.z
  // 역 이름판·출구 가까이: 실시간 열차 도착
  const subway = city.value?.subway || []
  const stationNear = subway.length && [...(world.st || []), ...(world.ex || []).map((e) => [e[3], e[1], e[2]])].some((s) => Math.hypot(s[1] - x, s[2] - y) < 45)
  if (stationNear) {
    const gone = Math.floor((Date.now() - cityAt) / 1000)
    const rows = []
    for (const [name, , , list] of subway) {
      for (const [line, route, sec, msg, info] of list.slice(0, 8)) {
        const left = sec ? sec - gone : null
        rows.push([line, route, left === null ? info || msg : secText(Math.max(0, left)), name])
        // 열차가 막 들어오면 가까운 출구에서 사람들이 쏟아져 나온다
        if (left !== null && left <= 0 && left > -30 && Date.now() - lastBurst > 20000) burstAtExit()
      }
    }
    board.value = { kind: 'subway', title: `🚇 ${subway.map((s) => s[0]).join(' · ')}역 도착 정보`, rows: rows.slice(0, 8), note: '서울 실시간 도시데이터' }
    return
  }
  // 버스 정류장 가까이: 정류소 도착 예정 버스
  const stop = (world.bus || []).map(([name, sx, sy]) => ({ name, sx, sy, d: Math.hypot(sx - x, sy - y) })).sort((a, b) => a.d - b.d)[0]
  if (stop && stop.d < 18) {
    const key = stop.name
    if (busFor !== key && !busBusy) {
      busBusy = true
      busFor = key
      const lngV = world.lng + stop.sx / (111320 * Math.cos((world.lat * Math.PI) / 180))
      const latV = world.lat + stop.sy / 110540
      board.value = { kind: 'bus', title: `🚌 ${stop.name}`, rows: [], note: '도착 정보를 받는 중…' }
      busArrivals(lngV, latV)
        .then((data) => {
          if (busFor !== key) return
          const rows = (data.buses || []).slice(0, 8).map(([no, a1, , dir]) => [no, dir ? `${dir} 방면` : '', a1, ''])
          board.value = { kind: 'bus', title: `🚌 ${data.stop?.name || stop.name}`, rows, note: rows.length ? '서울시 버스도착정보' : '지금 도착 예정 버스가 없어요' }
        })
        .catch(() => {
          if (busFor === key) board.value = { kind: 'bus', title: `🚌 ${stop.name}`, rows: [], note: '도착 정보를 못 받았어요' }
        })
        .finally(() => (busBusy = false))
    }
    return
  }
  busFor = ''
  if (board.value) board.value = null
}

function burstAtExit() {
  lastBurst = Date.now()
  const x = player.pos.x
  const y = -player.pos.z
  const exit = (world.ex || []).map((e) => ({ e, d: Math.hypot(e[1] - x, e[2] - y) })).sort((a, b) => a.d - b.d)[0]
  if (exit && exit.d < 150) people.burst(exit.e[1], exit.e[2], 12)
}

// --- 길 찾기 미션 ---------------------------------------------------------------
function startMission() {
  const x = player.pos.x
  const y = -player.pos.z
  const goals = [
    ...(world.ex || []).map(([ref, gx, gy, desc]) => [`${(desc || world.st?.[0]?.[0] || '지하철').replace(/역$/, '')}역 ${ref ? `${ref}번 ` : ''}출구`, gx, gy]),
    ...(world.bus || []).map(([name, gx, gy]) => [`${name} 버스 정류장`, gx, gy]),
    ...(world.bk || []).map(([name, gx, gy]) => [`따릉이 ${name}`, gx, gy]),
  ].filter(([, gx, gy]) => Math.hypot(gx - x, gy - y) > 50)
  sfx.click()
  if (!goals.length) {
    notice.value = '여기에는 찾아갈 출구·정류장이 없어요'
    return
  }
  const [title, gx, gy] = goals[(Math.random() * goals.length) | 0]
  mission.value = { title, x: gx, y: gy, start: performance.now() }
  notice.value = ''
  updateMission()
  lock()
}

function updateMission() {
  const m = mission.value
  if (!m) return
  const dx = m.x - player.pos.x
  const dy = m.y + player.pos.z
  const d = Math.hypot(dx, dy)
  // 화면 기준 방향: 앞이 0도
  const ang = Math.atan2(dx, dy) + player.yaw
  missionArrow.value = Math.round((ang * 180) / Math.PI)
  missionText.value = `${m.title} · ${Math.round(d)}m`
  if (d < 6) {
    const sec = Math.round((performance.now() - m.start) / 1000)
    mission.value = null
    sfx.right()
    toast.value = { mission: { title: m.title, time: sec >= 60 ? `${Math.floor(sec / 60)}분 ${sec % 60}초` : `${sec}초` } }
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.value = null), 4500)
  }
}

function lock() {
  if (!ready.value) return
  sfx.click()
  if (touch) {
    paused.value = false
    return
  }
  const el = renderer.domElement
  const fallback = () => {
    if (document.pointerLockElement === el) return
    dragLook.value = true
    paused.value = false
  }
  try {
    const req = el.requestPointerLock?.()
    if (!el.requestPointerLock) return fallback()
    req?.catch?.(fallback)
  } catch {
    return fallback()
  }
  // 잠금 요청이 조용히 무시되는 브라우저도 있다
  setTimeout(fallback, 600)
}

function onLockChange() {
  const locked = document.pointerLockElement === renderer.domElement
  if (locked) dragLook.value = false
  if (dragLook.value) return
  paused.value = !locked
  if (paused.value) keys.clear()
}

function pause() {
  dragLook.value = false
  paused.value = true
  keys.clear()
}

function onMouseMove(e) {
  if (paused.value || touch || dragLook.value) return
  player.yaw -= e.movementX * 0.0022
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - e.movementY * 0.0022))
}

function onMouseDown(e) {
  if (paused.value || touch || dragLook.value) return
  act(e.button === 2 ? 2 : 0)
}

function onKeyDown(e) {
  if (dialog.value && (e.code === 'Enter' || e.code === 'Space')) {
    e.preventDefault()
    if (!e.repeat) nextLine()
    return
  }
  if (machine.value && e.code === 'Escape') return endMachine()
  if (paused.value) return
  if (e.code === 'Escape' && dragLook.value) return pause()
  keys.add(e.code)
  if (e.code === 'Space') {
    e.preventDefault()
    if (!e.repeat) tapJump()
  }
  if (/^Digit[1-5]$/.test(e.code)) slot.value = Number(e.code.slice(5)) - 1
  if (e.code === 'KeyF') toggleFly()
  if (e.code === 'KeyT') cycleTime()
}

function onKeyUp(e) {
  keys.delete(e.code)
}

function onWheel(e) {
  if (paused.value) return
  slot.value = (slot.value + (e.deltaY > 0 ? 1 : blocks.length - 1)) % blocks.length
}

// 점프를 빠르게 두 번 누르면 날기를 켜고 끈다
let lastJump = 0
function tapJump() {
  const now = performance.now()
  if (now - lastJump < 300) {
    toggleFly()
    lastJump = 0
  } else {
    lastJump = now
  }
}

function toggleFly() {
  flying.value = !flying.value
  player.vel.y = 0
  sfx.click()
}

function cycleTime() {
  const i = TIMES.findIndex((t) => t.id === timeMode.value)
  setTime(TIMES[(i + 1) % TIMES.length].id)
}

function setTime(id) {
  timeMode.value = id
  sfx.click()
  if (grid) updateSky()
}

// 터치: 화면을 끌면 둘러보고, 짧게 누르면 간판 담기·블록 부수기
let drag = null
function onPointerDown(e) {
  const mouse = e.pointerType === 'mouse'
  if (mouse ? !dragLook.value || paused.value : !touch) return
  drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), button: e.button }
  if (mouse) renderer.domElement.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e) {
  if (!drag) return
  player.yaw -= (e.clientX - drag.x) * 0.005
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - (e.clientY - drag.y) * 0.005))
  drag.x = e.clientX
  drag.y = e.clientY
}

function onPointerUp(e) {
  if (!drag) return
  const moved = Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy)
  if (moved < 8 && performance.now() - drag.t < 350) {
    // 끌어서 둘러보는 마우스는 잠금 때처럼 화면 가운데를 겨눈다
    if (e.pointerType === 'mouse') act(drag.button === 2 ? 2 : 0)
    else {
      const rect = renderer.domElement.getBoundingClientRect()
      act(0, new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1))
    }
  }
  drag = null
}

function hold(code, on) {
  on ? keys.add(code) : keys.delete(code)
}

function placeTouch() {
  if (target) act(2)
}

function close() {
  sfx.click()
  emit('close')
}

let observer
onMounted(() => {
  setupScene()
  observer = new ResizeObserver(resize)
  observer.observe(box.value)
  const el = renderer.domElement
  el.addEventListener('mousedown', onMouseDown)
  el.addEventListener('contextmenu', (e) => e.preventDefault())
  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerUp)
  el.addEventListener('pointercancel', () => (drag = null))
  document.addEventListener('pointerlockchange', onLockChange)
  document.addEventListener('mousemove', onMouseMove)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('wheel', onWheel, { passive: true })
  raf = requestAnimationFrame(frame)
  if (import.meta.env.DEV) window.__world3d = { player, flying, signs: () => signPlaced, traffic: () => traffic, people: () => people, city, board, mission, setWeather, startMission, story, dialog, machine, startStory, startMachine, repair, nextLine, fx }
  startHere()
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  clearTimeout(toastTimer)
  clearTimeout(chatTimer)
  clearInterval(cityTimer)
  clearInterval(weatherTimer)
  liveSeq++
  observer?.disconnect()
  if (document.pointerLockElement) document.exitPointerLock()
  document.removeEventListener('pointerlockchange', onLockChange)
  document.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('wheel', onWheel)
  disposeGroup(worldGroup)
  disposeGroup(signGroup)
  disposeGroup(landGroup)
  disposeGroup(trafficGroup)
  disposeGroup(peopleGroup)
  disposeGroup(neonGroup)
  fx.uSpreadOn.value = 0
  fx.uYear.value = 9999
  ink.dispose()
  weatherFx.dispose()
  renderer.dispose()
  renderer.forceContextLoss()
})
</script>

<template>
  <div class="world window">
    <div class="title-bar">
      <div class="title-bar-text">🧱 3D 간판 거리{{ where ? ` — ${where}` : '' }}</div>
      <div class="title-bar-controls">
        <button aria-label="Close" @click="close"></button>
      </div>
    </div>

    <div ref="box" class="stage">
      <div v-if="ready" class="hud">
        <span>📍 {{ where }}{{ spot ? ` · ${spot}` : '' }}</span>
        <span>🕒 {{ clock }}{{ timeMode === 'now' ? '' : ` (${timeMode === 'day' ? '낮' : '밤'} 고정)` }}</span>
        <span>🪧 간판 {{ signCount.toLocaleString() }}곳{{ dense ? '' : ' (표본)' }}</span>
        <span>📒 도감 {{ dex.length.toLocaleString() }}</span>
        <span>{{ weatherLabel }}</span>
        <span>🚗 {{ roadText }}</span>
        <span>👥 {{ crowdText }}</span>
        <span v-if="flying">🕊️ 나는 중</span>
        <span v-if="hereState === 'ready'">📍 내 위치 준비됨 · {{ touch ? '메뉴' : 'Esc' }}에서 이동</span>
      </div>
      <div v-if="ready && mission" class="goal">
        <span class="arrow" :style="{ transform: `rotate(${missionArrow}deg)` }">⬆</span>
        🎯 {{ missionText }}
      </div>
      <div v-if="ready && story" class="story-bar">
        <b>🌃 {{ story.ch.title }}</b>
        <span class="bulbs">💡 {{ story.lit }} / {{ story.goal }}</span>
        <span class="meter"><i :style="{ width: `${(story.lit / story.goal) * 100}%` }"></i></span>
      </div>
      <div v-if="ready && story && storyText" class="goal story-goal">
        <span class="arrow" :style="{ transform: `rotate(${storyArrow}deg)` }">⬆</span>
        {{ storyText }}
      </div>

      <div v-if="ready && !machine && (!paused || touch)" class="cross" aria-hidden="true"></div>
      <p v-if="ready && hover?.sign && (!paused || touch)" class="aim">
        <b>{{ hover.sign.name }}</b> · {{ hover.sign.cat }} · {{ floorText(hover.sign.floor) }}
        <small v-if="story && !story.done">{{ hover.lit ? '💡 불 켠 간판' : touch ? '🔧 눌러서 불 켜기' : '🔧 클릭해서 불 켜기' }}</small>
        <small v-else>{{ dexSet.has(`${hover.sign.name}|${hover.sign.cat}`) ? '담은 간판' : touch ? '눌러서 담기' : '클릭해서 담기' }}</small>
      </p>
      <p v-else-if="ready && hover?.land && (!paused || touch)" class="aim">
        <b>{{ hover.land.title }}</b> · {{ hover.land.sub }}
      </p>
      <p v-else-if="ready && hover?.info && (!paused || touch)" class="aim">
        🏢 <b>{{ hover.info.title }}</b> · {{ hover.info.sub }}
      </p>

      <div v-if="ready && board" class="board window">
        <div class="title-bar"><div class="title-bar-text">{{ board.title }}</div></div>
        <div class="window-body">
          <table v-if="board.rows.length">
            <tr v-for="(r, n) in board.rows" :key="n">
              <td class="line">{{ r[0] }}</td>
              <td>{{ r[1] }}</td>
              <td class="when">{{ r[2] }}</td>
            </tr>
          </table>
          <p class="note">{{ board.note }}</p>
        </div>
      </div>

      <div v-if="ready" class="mini" aria-hidden="true">
        <canvas ref="mini" width="150" height="150"></canvas>
        <div v-if="lineBadges.length" class="lines">
          <span v-for="[name, color] in lineBadges" :key="name" :style="{ background: color }">{{ name }}</span>
        </div>
      </div>

      <div v-if="toast?.neon" class="toast window neon">
        <div class="title-bar"><div class="title-bar-text">💡 불이 들어왔어요 · {{ toast.n }} / {{ toast.goal }}</div></div>
        <div class="window-body">
          <b>{{ toast.neon.name }}</b>
          <p>{{ toast.neon.cat }}</p>
        </div>
      </div>
      <div v-else-if="toast?.mission" class="toast window">
        <div class="title-bar"><div class="title-bar-text">🎯 미션 성공!</div></div>
        <div class="window-body">
          <b>{{ toast.mission.title }}</b>
          <p>{{ toast.mission.time }} 만에 찾았어요</p>
        </div>
      </div>
      <div v-else-if="toast?.land" class="toast window">
        <div class="title-bar"><div class="title-bar-text">{{ { exit: '🚇 지하철 출구', station: '🚉 지하철역', bus: '🚌 버스 정류장', road: '🪧 도로명', building: '🏢 건물', bike: '🚲 따릉이', work: '🚧 공사·통제' }[toast.land.kind] }}</div></div>
        <div class="window-body">
          <b>{{ toast.land.title }}</b>
          <p>{{ toast.land.sub }}</p>
        </div>
      </div>
      <div v-else-if="toast" class="toast window">
        <div class="title-bar"><div class="title-bar-text">{{ toast.fresh ? '📒 도감에 담았어요' : '📒 이미 담은 간판' }}</div></div>
        <div class="window-body">
          <b>{{ toast.name }}</b>
          <p>{{ toast.cat }} · {{ floorText(toast.floor) }}</p>
        </div>
      </div>

      <div v-if="chat" class="chat window">
        <div class="window-body"><img v-if="chat.img" class="npc" :src="chat.img" alt="" /><span v-else class="face">{{ chat.face }}</span><p><b>{{ chat.who }}</b>{{ chat.text }}</p></div>
      </div>

      <div v-if="dialog" class="dialog window" @click="nextLine()">
        <div class="title-bar"><div class="title-bar-text">{{ dialog.face }} {{ dialog.who }}</div></div>
        <div class="window-body">
          <div class="talk">
            <img v-if="dialog.img" class="npc boil" :src="dialog.img" alt="" />
            <span v-else class="face">{{ dialog.face }}</span>
            <p class="hand">{{ dialog.lines[dialog.i] }}</p>
          </div>
          <div class="actions">
            <template v-if="dialog.choices && dialog.i === dialog.lines.length - 1">
              <button v-for="c in dialog.choices" :key="c.label" @click.stop="nextLine(c)">{{ c.label }}</button>
            </template>
            <button v-else @click.stop="nextLine()">{{ dialog.i + 1 < dialog.lines.length ? '다음 ▶' : '좋아요!' }} <small>({{ touch ? '누르기' : 'Enter' }})</small></button>
          </div>
        </div>
      </div>

      <template v-if="ready && machine">
        <div class="year" aria-live="polite">
          <b>{{ machine.year }}</b>년
          <small v-if="machine.recent.length">{{ machine.recent.map((b) => `${b.name || b.use} (${b.year})`).join(' · ') }}</small>
        </div>
        <div class="machine window">
          <div class="title-bar"><div class="title-bar-text">🕰️ 서울 타임머신 — {{ where }}</div></div>
          <div class="window-body">
            <div class="row">
              <button @click="playMachine">{{ machine.playing ? '⏸' : '▶' }}</button>
              <input type="range" :min="machine.min" :max="machine.max" step="1" :value="machine.year" @input="scrubMachine" />
              <button @click="endMachine">나가기</button>
            </div>
            <p>건물 {{ machine.count.toLocaleString() }}채가 섰어요 · 사용승인 연도 순서 <span v-if="machine.unknown">· 연도를 모르는 {{ machine.unknown }}채는 그물로 보여요</span></p>
          </div>
        </div>
      </template>

      <img v-if="ready && !machine" class="me boil" :src="faceImg(mood)" alt="" aria-hidden="true" />

      <div v-if="ready && !machine" class="hotbar">
        <button v-for="(b, i) in blocks" :key="b.id" :class="{ on: slot === i }" :title="b.label" @click="slot = i">
          <img :src="b.icon" alt="" width="32" height="32" />
          <span>{{ i + 1 }}</span>
        </button>
      </div>

      <template v-if="ready && touch && !paused && !machine && !dialog">
        <div class="pad">
          <button class="up" @pointerdown="hold('touch-up', true)" @pointerup="hold('touch-up', false)" @pointerleave="hold('touch-up', false)">▲</button>
          <button class="left" @pointerdown="hold('touch-left', true)" @pointerup="hold('touch-left', false)" @pointerleave="hold('touch-left', false)">◀</button>
          <button class="down" @pointerdown="hold('touch-down', true)" @pointerup="hold('touch-down', false)" @pointerleave="hold('touch-down', false)">▼</button>
          <button class="right" @pointerdown="hold('touch-right', true)" @pointerup="hold('touch-right', false)" @pointerleave="hold('touch-right', false)">▶</button>
        </div>
        <div class="acts">
          <button @pointerdown="hold('touch-jump', true); tapJump()" @pointerup="hold('touch-jump', false)" @pointerleave="hold('touch-jump', false)">점프</button>
          <button @click="placeTouch">놓기</button>
          <button @click="paused = true">메뉴</button>
        </div>
      </template>

      <div v-if="(!ready || paused) && !dialog && !machine && !ending" class="scrim">
        <div class="window menu">
          <div class="title-bar"><div class="title-bar-text">3D 간판 거리</div></div>
          <div class="window-body">
            <template v-if="!ready">
              <p class="loading">{{ status }}</p>
              <div class="progress-indicator segmented"><span class="progress-indicator-bar" style="width: 60%"></span></div>
            </template>
            <template v-else>
              <p v-if="story" class="lead">🌃 <b>{{ story.ch.title }}</b> — 꺼진 간판을 눌러 불을 켜면 그 둘레로 색과 사람이 돌아와요. 💡 {{ story.lit }} / {{ story.goal }}</p>
              <p v-else class="lead">실제 지도의 건물과 길, 그 자리의 <b>진짜 간판</b>이 서 있는 블록 거리예요. 간판을 눌러 도감에 담아 보세요.</p>
              <button class="go" @click="lock">▶ {{ touch ? '시작하기' : '클릭해서 시작하기' }}</button>
            </template>
            <p v-if="notice" class="notice">⚠️ {{ notice }}</p>

            <fieldset class="tales">
              <legend>🌃 스토리 · 꺼진 간판의 도시</legend>
              <p>어느 밤 서울 간판이 한꺼번에 꺼졌어요. 간판 수리공이 되어 동네마다 불을 다시 켜 주세요.</p>
              <div class="chips">
                <button v-for="(c, n) in CHAPTERS" :key="c.id" :class="{ on: story?.ch === c }" :disabled="!ready || !unlocked(n)" @click="startStory(n)">
                  {{ cleared.includes(c.id) ? '✅' : unlocked(n) ? c.npc.face : '🔒' }} {{ c.title }}
                </button>
                <button :disabled="!ready" @click="startMachine">🕰️ 서울 타임머신</button>
                <button v-if="story" @click="exitStory">스토리 그만두기</button>
              </div>
            </fieldset>
            <fieldset>
              <legend>장소</legend>
              <div class="chips">
                <button v-if="hereState === 'ready'" class="on" :disabled="!ready" @click="goHere">📍 내 위치 준비됐어요 · 이동</button>
                <button v-else :disabled="!ready || hereState === 'loading'" @click="startHere">{{ hereState === 'loading' ? '📍 내 위치 받는 중…' : '📍 내 위치' }}</button>
                <button v-for="p in PRESETS" :key="p.id" :disabled="!ready" @click="goPreset(p)">{{ p.label }}</button>
              </div>
            </fieldset>
            <fieldset>
              <legend>시간</legend>
              <div class="chips">
                <button v-for="t in TIMES" :key="t.id" :class="{ on: timeMode === t.id }" @click="setTime(t.id)">{{ t.label }}</button>
              </div>
            </fieldset>
            <fieldset>
              <legend>날씨</legend>
              <div class="chips">
                <button v-for="w in WEATHERS" :key="w.id" :class="{ on: weatherMode === w.id }" @click="setWeather(w.id)">{{ w.label }}</button>
              </div>
            </fieldset>
            <fieldset>
              <legend>미션</legend>
              <div class="chips">
                <button :disabled="!ready" @click="startMission">🎯 길 찾기 미션</button>
                <button v-if="mission" @click="mission = null">그만두기</button>
              </div>
            </fieldset>
            <ul v-if="!touch" class="keys">
              <li><kbd>WASD</kbd> 걷기 · <kbd>Shift</kbd> 달리기 · <kbd>Space</kbd> 점프</li>
              <li><kbd>Space</kbd> 두 번 또는 <kbd>F</kbd> 날기 (<kbd>Space</kbd> 위 · <kbd>C</kbd> 아래 · <kbd>Shift</kbd> 빠르게) · <kbd>T</kbd> 시간 바꾸기</li>
              <li>왼쪽 클릭: 간판 담기·블록 부수기 · 오른쪽 클릭: 블록 놓기</li>
              <li><kbd>1</kbd>~<kbd>5</kbd>·휠: 블록 고르기 · <kbd>Esc</kbd> 메뉴</li>
              <li v-if="dragLook">마우스 잠금이 안 되는 브라우저라서 <b>끌어서</b> 둘러봐요</li>
            </ul>
            <p class="src">길 © OpenStreetMap 기여자 · 건물 © 국토교통부 GIS건물통합정보(브이월드) · 간판 소상공인시장진흥공단 상가정보 · 교통·혼잡도 서울 실시간 도시데이터 · 버스 서울시 버스도착정보 · 날씨 Open-Meteo</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.world {
  position: fixed;
  inset: 0;
  z-index: 15000;
  display: flex;
  flex-direction: column;
  padding: 2px;
}

.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--paper);
  user-select: none;
}

.stage :deep(canvas) {
  display: block;
  touch-action: none;
}

.hud {
  position: absolute;
  top: 8px;
  left: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  pointer-events: none;
}

.hud span {
  padding: 1px 8px;
  font: 700 15px/1.4 var(--hand);
  background: rgb(255 253 246 / 0.92);
  border: 1.5px solid var(--ink);
  border-radius: var(--wob2);
}

.cross {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  pointer-events: none;
  background:
    linear-gradient(var(--ink), var(--ink)) center / 2px 100% no-repeat,
    linear-gradient(var(--ink), var(--ink)) center / 100% 2px no-repeat;
  filter: drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff);
}

.aim {
  position: absolute;
  top: calc(50% + 18px);
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: 3px 12px;
  white-space: nowrap;
  font: 400 17px/1.4 var(--hand);
  background: #fff;
  border: 2px solid var(--ink);
  border-radius: var(--wob);
  box-shadow: 2px 3px 0 var(--ink);
  pointer-events: none;
}

.aim small {
  margin-left: 6px;
  padding: 0 4px;
  font-size: 15px;
  background: var(--hl);
}

.mini {
  position: absolute;
  top: 8px;
  right: 8px;
  pointer-events: none;
}

.mini canvas {
  display: block;
  width: 150px;
  height: 150px;
  border: 2px solid var(--ink);
  border-radius: 6px 14px 8px 12px;
  box-shadow: 2px 3px 0 var(--ink);
  filter: grayscale(0.85) contrast(1.1) sepia(0.15);
}

.lines {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 2px;
  max-width: 154px;
  margin-top: 3px;
}

.lines span {
  padding: 0 6px;
  font: 700 13px/1.4 var(--hand);
  color: #fff;
  border: 1.5px solid var(--ink);
  border-radius: 8px;
}

.goal {
  position: absolute;
  top: 40px;
  left: 50%;
  transform: translateX(-50%);
  padding: 3px 14px;
  font: 700 18px/1.4 var(--hand);
  background: var(--hl);
  border: 2px solid var(--ink);
  border-radius: var(--wob2);
  box-shadow: 2px 3px 0 var(--ink);
  pointer-events: none;
}

.goal .arrow {
  display: inline-block;
  margin-right: 4px;
}

.board {
  position: absolute;
  left: 10px;
  bottom: 70px;
  width: min(330px, calc(100% - 20px));
  pointer-events: none;
}

.board table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.board td {
  padding: 2px 4px;
  border-bottom: 1.5px dashed #bbb3a0;
}

.board .line {
  font-weight: bold;
  white-space: nowrap;
}

.board .when {
  text-align: right;
  white-space: nowrap;
  font-family: var(--hand);
  font-weight: 700;
}

.board .note {
  margin: 4px 0 0;
  font-size: 10px;
  color: #555;
}

.toast {
  position: absolute;
  top: 190px;
  right: 10px;
  width: 220px;
  pointer-events: none;
}

.toast b {
  font-size: 15px;
}

.toast p {
  margin: 4px 0 0;
}

.hotbar {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  padding: 5px 8px;
  background: var(--paper);
  border: 2px solid var(--ink);
  border-radius: var(--wob);
  box-shadow: 2px 3px 0 var(--ink);
}

.hotbar button {
  position: relative;
  min-width: 0;
  width: 42px;
  height: 42px;
  padding: 0;
  display: grid;
  place-items: center;
  box-shadow: none;
}

.hotbar button.on {
  transform: translateY(-4px) rotate(-3deg);
}

.hotbar img {
  filter: grayscale(0.6) contrast(1.2);
}

.hotbar span {
  position: absolute;
  right: 2px;
  bottom: 0;
  font: 700 12px/1 var(--hand);
}

.pad {
  position: absolute;
  left: 12px;
  bottom: 64px;
  display: grid;
  grid-template: repeat(3, 44px) / repeat(3, 44px);
}

.pad button,
.acts button {
  min-width: 0;
  padding: 0;
  opacity: 0.85;
  touch-action: none;
}

.pad .up {
  grid-area: 1 / 2;
}

.pad .left {
  grid-area: 2 / 1;
}

.pad .right {
  grid-area: 2 / 3;
}

.pad .down {
  grid-area: 3 / 2;
}

.acts {
  position: absolute;
  right: 12px;
  bottom: 64px;
  display: grid;
  gap: 6px;
}

.acts button {
  width: 64px;
  height: 40px;
}

.story-bar {
  position: absolute;
  top: 40px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 14px;
  font: 700 17px/1.4 var(--hand);
  background: var(--paper);
  border: 2px solid var(--ink);
  border-radius: var(--wob);
  box-shadow: 2px 3px 0 var(--ink);
  pointer-events: none;
  white-space: nowrap;
}

.story-bar .meter {
  width: 90px;
  height: 10px;
  border: 1.5px solid var(--ink);
  border-radius: 6px;
  overflow: hidden;
}

.story-bar .meter i {
  display: block;
  height: 100%;
  background: var(--hl);
  transition: width 0.4s;
}

.story-goal {
  top: 80px;
  background: #fff;
}

.toast.neon .title-bar-text {
  background: linear-gradient(transparent 50%, var(--hl) 50% 92%, transparent 92%);
}

.chat {
  position: absolute;
  top: 110px;
  left: 50%;
  transform: translateX(-50%);
  width: min(420px, calc(100% - 20px));
  pointer-events: none;
}

.chat .window-body,
.dialog .talk {
  display: flex;
  align-items: center;
  gap: 10px;
}

.chat p,
.dialog p {
  margin: 0;
  line-height: 1.6;
}

.chat b {
  margin-right: 6px;
}

.face {
  font-size: 30px;
}

.npc {
  flex: none;
  height: 64px;
  width: auto;
}

.dialog .npc {
  height: 120px;
  margin: -46px 0 -6px;
}

/* 주인공: 오른쪽 아래에서 반응한다 */
.me {
  position: absolute;
  right: 14px;
  bottom: 12px;
  width: 92px;
  pointer-events: none;
}

.dialog {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  width: min(560px, calc(100% - 20px));
  cursor: pointer;
}

.dialog .face {
  font-size: 44px;
}

.dialog p {
  font-size: 21px;
  line-height: 1.4;
  min-height: 56px;
}

.dialog .actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}

.year {
  position: absolute;
  top: 40px;
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  justify-items: center;
  font: 700 24px/1.2 var(--hand);
  text-shadow: 0 0 6px var(--paper), 0 0 3px var(--paper);
  pointer-events: none;
}

.year b {
  font-size: 72px;
  line-height: 1;
  padding: 0 10px;
  background: linear-gradient(transparent 55%, var(--hl) 55% 90%, transparent 90%);
}

.year small {
  max-width: 80vw;
  margin-top: 4px;
  padding: 2px 8px;
  font-size: 15px;
  text-align: center;
  background: #fff;
  border: 1.5px solid var(--ink);
  border-radius: var(--wob2);
}

.machine {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  width: min(560px, calc(100% - 20px));
}

.machine .row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.machine input {
  flex: 1;
}

.machine button {
  min-width: 44px;
}

.machine p {
  margin: 6px 0 0;
  font-size: 12px;
}

.tales p {
  margin: 0 0 6px;
  font-size: 12px;
  line-height: 1.5;
}

.scrim {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(239 233 220 / 0.45);
}

.menu {
  width: min(420px, calc(100% - 24px));
  max-height: calc(100% - 24px);
  overflow: auto;
}

.lead {
  margin: 4px 0 10px;
  line-height: 1.6;
}

.loading {
  margin: 6px 0 8px;
}

/* 불러오는 동안 형광펜이 왔다 갔다 칠해진다 */
.progress-indicator {
  height: 14px;
  border: 2px solid var(--ink);
  border-radius: var(--wob2);
  overflow: hidden;
}

.progress-indicator-bar {
  display: block;
  height: 100%;
  background: var(--hl);
  animation: mark 1.4s ease-in-out infinite alternate;
}

@keyframes mark {
  from {
    width: 15% !important;
  }
}

.go {
  width: 100%;
  height: 34px;
  font-weight: bold;
}

.notice {
  margin: 8px 0 0;
  color: var(--ink-soft);
}

fieldset {
  margin-top: 10px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}



.keys {
  margin: 10px 0 0;
  padding-left: 16px;
  line-height: 1.8;
  font-size: 12px;
}

kbd {
  padding: 0 3px;
  font: 700 13px var(--hand);
  border: 1.5px solid var(--ink);
  border-radius: 5px;
  background: #fff;
  box-shadow: 1px 1.5px 0 var(--ink);
}

.src {
  margin: 10px 0 0;
  font-size: 10px;
  color: #555;
}
</style>
