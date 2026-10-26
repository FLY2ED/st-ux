<script setup>
// 간판 수리공 (2D): 3D 거리와 같은 동네·간판·이야기를 위에서 내려다보는 픽셀 거리로 푼다.
// 간판은 늘 똑바로 선 납작한 판으로 그려서 이름이 바로 읽힌다. 산성비·간판 청소·타자왕 같은 놀이는
// 사장님 부탁(퀘스트)·보스 대결로 이 안에서 열리고, 이야기에서 높이 쌓을 때가 되면 같은 동네를 3D 로 들어간다
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { load, signsAround } from '../data.js'
import { player as arcadePlayer, enter as arcadeEnter, streetFound, streetNote, streetRead } from '../arcade.js'
import { pastelOf } from '../shops.js'
import { sfx } from '../sound.js'
import {
  Bike, BookMarked, Building2, Bus, Car, CircleCheck, Clock, Cloud, CloudRain, Construction, History, Lightbulb,
  Lock, MapPin, MessageCircle, Signpost, Snowflake, Sun, Target, TrainFront, TrainFrontTunnel, TriangleAlert, Wrench,
} from 'lucide-vue-next'
import { B, plantStreetTrees, plantTrees, rasterize } from '../world/build.js'
import { MAX_LIT } from '../world/fx.js'
import { describeSpot } from '../world/landmarks.js'
import { busArrivals, buildingsAround, cityData, toLocal, vworldBuildings, weatherNow } from '../world/live.js'
import { fetchTilesArea, prefetchTiles } from '../world/mvt.js'
import { compact, fetchOSM } from '../world/osm.js'
import { guessCrowd } from '../world/people.js'
import { PRESETS, RADIUS } from '../world/presets.js'
import { placeSigns } from '../world/signs.js'
import { BOSSES, BUILD, CHAPTERS, ENDING, FOLKS, FOLK_IDLE, SCARED, TIMES as STORY_TIMES, fill, ownerOf, readCleared, rideOf, saveCleared, spriteOf } from '../world/story.js'
import { drawAvatar, readLook } from '../avatar.js'
import { joinTown } from '../world/presence.js'
import { loadLM } from '../signlm.js'
import { BLOCKS, GROUND_ID, leafColor } from '../world/textures.js'
import { LEVEL_COLOR, flowsFromCity, guessLevel } from '../world/traffic.js'
import { WEATHERS } from '../world/weather.js'
import { loadTileset, paintTiles, paintTreeSprites, plantGrove, tilesReady } from '../world/tileset.js'
import { makePeople2D, makeTraffic2D } from './street2d/life.js'
import { CELL, drawPerson, glowSprite, makeLayer, paintBuildings, paintGround, shade } from './street2d/paint.js'
import RpgDialog from './street2d/RpgDialog.vue'
import Cutscene from './street2d/Cutscene.vue'
import hardhat from '../assets/intro/hardhat.webp'
import Inside from './street2d/Inside.vue'
import './pixel.css'

// windowed: 맥 창 안에 들어갈 때. 창 테두리·신호등은 셸이 그리므로 위 막대를 숨기고 창을 채운다
// play: 바깥(순위표·위젯)에서 바로 열 퀘스트 이름
const props = defineProps({ windowed: { type: Boolean, default: false }, play: { type: String, default: '' }, begin: { type: String, default: '' }, beginAt: { type: Number, default: 0 } })
const emit = defineEmits(['close', 'unfull'])

// 사장님 부탁으로 여는 놀이: 바탕화면 앱을 그대로 게임 안 창에 띄운다. free 는 끝내지 않아도 돌아갈 수 있다
const QUESTS = {
  rain: { title: '간판 산성비', comp: defineAsyncComponent(() => import('./RainWindow.vue')), width: 760, ink: true },
  dodge: { title: '점심 간판 피하기', comp: defineAsyncComponent(() => import('./DodgeWindow.vue')), width: 560, ink: true },
  scratch: { title: '간판 청소', comp: defineAsyncComponent(() => import('./ScratchWindow.vue')), width: 460, ink: true },
  more: { title: '더 많을까?', comp: defineAsyncComponent(() => import('./MoreWindow.vue')), width: 620, ink: 'paper' },
  booth: { title: '간판 네컷', comp: defineAsyncComponent(() => import('./BoothWindow.vue')), width: 540, ink: true, skip: true },
  type: { title: '간판 타자왕', comp: defineAsyncComponent(() => import('./TypeWindow.vue')), width: 600, ink: true },
  guess: { title: '간판 어디게', comp: defineAsyncComponent(() => import('./GuessWindow.vue')), width: 860, ink: true },
  map: { title: '간판 지도', comp: defineAsyncComponent(() => import('./BuildingWindow.vue')), width: 920, mode: 'name' },
  open: { title: '내 가게 차리기', comp: defineAsyncComponent(() => import('./BuildingWindow.vue')), width: 920, mode: 'shop', free: true },
  atlas: { title: '간판 지도', comp: defineAsyncComponent(() => import('./BuildingWindow.vue')), width: 920, mode: 'name', free: true },
}
const World3D = defineAsyncComponent(() => import('./World3D.vue'))
const SHOP_KEY = 'gp-myshop'
const GUIDE_LOOK = { shirt: '#d9463b', pants: '#3a2f2a', hair: '#1d1d1d', skin: '#f2cfa8', cap: null, bag: null }
const OWNER_LOOK = { shirt: '#f4f1ea', pants: '#2f3a4a', hair: '#3a2a1e', skin: '#efc49b', cap: '#2f9e5a', bag: null }

// 인물 그림: c- 길잡이·보스 서 있는 모습, f- 동네 사람·사장님, p- 대화창 얼굴
const NPC_ART = import.meta.glob('../assets/npc/*.png', { eager: true, import: 'default' })
const art = (name) => NPC_ART[`../assets/npc/${name}.png`] || ''
const artImgs = new Map()
function artImg(name) {
  let im = artImgs.get(name)
  if (!im) {
    im = new Image()
    const src = art(name)
    if (src) im.src = src
    artImgs.set(name, im)
  }
  return im.complete && im.naturalWidth ? im : null
}
const FOLK_IDS = Object.keys(FOLKS)
// 대화창에 넘길 사람: 얼굴 그림을 붙인다
const whoOf = (npc, tone = 'npc') => ({ ...npc, portrait: npc.portrait || (npc.id ? art(`p-${npc.id}`) || art(`f-${npc.id}`) : ''), tone: npc.tone || tone })
const bossWho = (id) => whoOf({ id, name: BOSSES[id].name, face: BOSSES[id].face }, 'boss')
const ownerWho = (sign) => {
  const o = ownerOf(sign)
  return { ...o, sprite: spriteOf(sign.cat), portrait: art(`f-${spriteOf(sign.cat)}`) }
}
// 위젯에 넘기는 때: 이야기 속 때를 넷으로 줄인다
const COARSE_TIME = { midnight: 'night', late: 'night', night: 'night', predawn: 'dawn', dawn: 'dawn', dusk: 'dusk', morning: 'day', day: 'day' }

// 도감은 3D 거리와 같이 쓴다
const DEX_KEY = 'gp-3d-dex'
const MAX_SIGNS = 3500
const R = 0.3
const REACH = 5
const BLOCK_REACH = 6

const box = ref(null)
const cv = ref(null)
const status = ref('위치를 확인하는 중…')
const notice = ref('')
const where = ref('')
const spot = ref('')
const lineBadges = shallowRef([])
const mini = ref(null)
const signCount = ref(0)
const dense = ref(true)
const paused = ref(true)
// 게임 메뉴를 연 때만 true. 대화·로딩·연출로 잠깐 멈춘 동안에는 메뉴를 띄우지 않는다
const menu = ref(false)
const timeMode = ref('night')
const clock = ref('')
const flying = ref(false)
const slot = ref(0)
const hover = shallowRef(null)
const nearSign = shallowRef(null)
const toast = shallowRef(null)
const dex = ref(readDex())
const weatherMode = ref('live')
const weather = shallowRef(null)
const city = shallowRef(null)
const roadText = ref('')
const crowdText = ref('')
const board = shallowRef(null)
const mission = shallowRef(null)
const missionText = ref('')
const missionArrow = ref(0)
const cleared = ref(readCleared())
const story = shallowRef(null)
const storyText = ref('')
const storyArrow = ref(0)
const dialog = shallowRef(null)
// 간판이 많은 건물 안(층마다 걸어 다니며 간판 찾기)
const inside = shallowRef(null)
const chat = shallowRef(null)
const machine = shallowRef(null)
const ending = ref(false)
const touch = matchMedia('(pointer: coarse)').matches
// 같이 하기: 이 동네에서 다른 사람이 담은 간판·쪽지·순위(동네 들어올 때 한 번 받는다)
const shared = shallowRef(null)
const me = ref(arcadePlayer())
const noteFor = shallowRef(null)
const noteText = ref('')
const noteName = ref('')
const notePass = ref('')
const noteErr = ref('')
const noteBusy = ref(false)

const onTitle = ref(true)
const panel = ref(null)
// 부탁 놀이 창, 3D 로 들어간 동안의 정보, 장 사이 지하철 카드
const quest = shallowRef(null)
// 놀이로 넘어갈 때 화면이 한 줄씩 덮였다가 걷힌다
const wipe = ref('')
const WIPE_ROWS = 14
const WIPE_MS = 560
const view3d = shallowRef(null)
const ride = shallowRef(null)
const myShop = ref(readShop())
const myName = () => me.value?.name || '수리공'
// 이어서 할 장: 아직 못 깬 첫 장(다 깼으면 -1)
const nextCh = computed(() => CHAPTERS.findIndex((c) => !cleared.value.includes(c.id)))

const titleShown = computed(() => onTitle.value && paused.value && !dialog.value && !machine.value && !quest.value && !view3d.value)
watch(paused, (v) => {
  if (!v) onTitle.value = false
  panel.value = null
})

// 손으로 놓는 블록: 3D 거리와 같은 다섯 가지 그림
const blocks = BLOCKS.map((b) => {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 16
  b.draw(c.getContext('2d'))
  return { ...b, canvas: c, icon: c.toDataURL() }
})

function readDex() {
  try {
    return JSON.parse(localStorage.getItem(DEX_KEY)) || []
  } catch {
    return []
  }
}

function readShop() {
  try {
    return JSON.parse(localStorage.getItem(SHOP_KEY))
  } catch {
    return null
  }
}

const dexSet = computed(() => new Set(dex.value))
const ready = computed(() => !status.value)

// 그림 상태는 반응형으로 두지 않는다
let ctx = null
let buf = null
let bctx = null
let dark = null
let dctx = null
let W = 0
let H = 0
let dpr = 1
let groundLayer = null
let bldgLayer = null
let lightLayer = null
let glow = null
let mapImage = null
let world = null
let grid = null
let lat = 37.63
let lng = 127.077
let raf = 0
let last = 0
let skyTimer = 0
let miniTimer = 0
let traffic = null
let people = null
let liveSeq = 0
let cityTimer = 0
let weatherTimer = 0
let boardTimer = 0
let cityAt = 0
let lastBurst = 0
let lastHonk = 0
let signPlaced = []
let signGroups = []
let trees = []
let treeCells = new Set()
let litList = []
// 서버에 올릴 담은 간판(모아서 30초마다 한 번), 이번 방문에 이미 올린 간판, 방문 표시할 조각
let tiles = []
let homeTile = ''
let visitPending = false
let flushTimer = 0
const pending = new Set()
const sent = new Set()
let wave = null
let cine = null
// 택시: 손 흔들면 와서 서고, 고른 곳까지 태워 준다
let cab = null
// 손님 태우기: 손님이 말한 간판 앞까지 미터기 시간 안에 직접 몰고 간다
let fareRun = null
const fare = shallowRef(null)
let machineList = []
let night = 0
let dusk = 0
let mouse = null
let boardRects = []
// 「+N곳」 판: 누르면 그 건물 안으로
let moreRects = []
let landRects = []
let drops = []
const voxels = new Map()
// 3D 에서 쌓은 기둥: 'i,k' → [[y, 종류]…]. 2D 에는 맨 위 블록만 보인다
const tall = new Map()
const keys = new Set()
const player = { x: 0, y: 0, dir: 0, step: 0, moving: false }
// 내 캐릭터 표시: 시작하고 몇 초는 주변을 어둡게 하고 이름표를 크게 띄운다
let introAt = 0
// 카메라: 칸 좌표 가운데, 한 칸의 화면 크기(px)
const cam = { i: 0, k: 0, T: 16 }
// 건물 판은 한 칸 8px 로 그려 두므로 줌(한 칸의 화면 px)은 8 의 배수에서만 멈춘다: 픽셀이 고르게 커진다
const ZOOMS = [8, 16, 24, 32]
let zoom = 16
let wheelAcc = 0

const vkey = (i, k) => `${i},${k}`
const cellOf = (x, y) => [Math.floor(x / B + grid.half), Math.floor(-y / B + grid.half)]

// 걸을 수 없는 칸: 건물(날 때는 빼고), 물, 나무 밑동, 놓은 블록
function blocked(x, y) {
  const [i, k] = cellOf(x, y)
  const { N, height, ground } = grid
  if (i < 1 || k < 1 || i >= N - 1 || k >= N - 1) return true
  if (flying.value) return false
  const c = k * N + i
  return !!height[c] || ground[c] === GROUND_ID.water || treeCells.has(c) || voxels.has(vkey(i, k))
}

const hits = (x, y) => blocked(x - R, y - R) || blocked(x + R, y - R) || blocked(x - R, y + R) || blocked(x + R, y + R)

// --- 세계 만들기 --------------------------------------------------------------
// roam: 열린 세계로 이어 붙일 때. 간판을 미리 받아 두었으니 화면을 가리지 않고 바로 바꾼다
async function enter(next, label, area = '', start = null, roam = null) {
  // 땅·나무 타일 그림 (처음 한 번만 실제로 받는다)
  await loadTileset()
  if (!roam) status.value = '간판을 세우는 중…'
  cancelRoam()
  flushShared()
  shared.value = null
  clearFx()
  voxels.clear()
  tall.clear()
  mission.value = null
  board.value = null
  world = next
  lng = world.lng
  lat = world.lat
  grid = rasterize(world)

  let seed = Math.round(lng * 1e4) ^ Math.round(lat * 1e4)
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  const t1 = plantTrees(grid, rand).trunk.filter(([, y]) => y === 0)
  const t2 = plantStreetTrees(grid, world, (i, k) => t1.some(([ti, , tk]) => ti === i && tk === k)).trunk.filter(([, y]) => y === 0)
  trees = [...t1, ...t2].map(([i, , k]) => [i, k])
  treeCells = new Set(trees.map(([i, k]) => k * grid.N + i))
  // 2D 공원은 덤불·작은 숲을 더 심어 우거지게
  for (const [i, k] of plantGrove(grid, treeCells)) {
    trees.push([i, k])
    treeCells.add(k * grid.N + i)
  }

  groundLayer = makeLayer(grid.N)
  bldgLayer = makeLayer(grid.N)
  lightLayer = makeLayer(grid.N)
  paintGround(groundLayer, grid, world)
  // 풀·흙길·물·보도는 타일 그림으로 덮는다 (찻길·횡단보도는 그대로)
  paintTiles(groundLayer, grid, { treeCells, cell: CELL })
  paintMap()

  traffic = makeTraffic2D(world, grid, rand)
  people = makePeople2D(grid, rand)

  const found = roam ? roam.found : await signsAround(lng, lat, world.r).catch(() => ({ dense: false, rows: [] }))
  if (!roam) await document.fonts.load('12px Galmuri11').catch(() => {})
  dense.value = found.dense
  signPlaced = placeSigns(grid, found.rows.slice(0, MAX_SIGNS)).map(flatSign)
  tiles = found.tiles || []
  homeTile = `${Math.floor(lng * 100)}_${Math.floor(lat * 100)}`
  visitPending = true
  loadShared()
  signGroups = groupSigns(signPlaced)
  signCount.value = signPlaced.length
  world.bk = []
  world.wk = []
  lineBadges.value = world.ln || []
  applyCity(null)

  const dir = player.dir
  spawn(signPlaced, start)
  // 옆 동네를 이어 붙일 때는 시작 연출(주변을 어둡게 했다가 밝히기)을 다시 틀지 않는다
  if (roam) player.dir = dir
  else introAt = performance.now()
  where.value = label
  status.value = ''
  updateSky()
  loadLive(area)
}

function paintMap(year = 9999) {
  // 나무는 타일 그림으로 (그림을 못 불러왔으면 예전 잎 뭉치)
  const sprite = tilesReady()
  paintBuildings(bldgLayer, lightLayer, grid, { year, trees: sprite ? [] : trees, leaf: leafColor(new Date().getMonth() + 1) })
  if (sprite) paintTreeSprites(bldgLayer, trees, { cell: CELL })
}

// 같은 벽(같은 쪽을 보고 2.5m 안)에 붙은 간판을 한 묶음으로
function groupSigns(list) {
  const cells = new Map()
  const groups = []
  for (const p of list) {
    const key = `${Math.round(p.x / 3)},${Math.round(p.y / 3)}`
    let g = null
    for (let dx = -1; dx <= 1 && !g; dx++) {
      for (let dy = -1; dy <= 1 && !g; dy++) {
        const [ci, cj] = key.split(',').map(Number)
        g = (cells.get(`${ci + dx},${cj + dy}`) || []).find((o) => o.pole === p.pole && Math.abs(o.nx - p.nx) < 0.3 && Math.abs(o.nk - p.nk) < 0.3 && Math.hypot(o.x - p.x, o.y - p.y) < 2.5)
      }
    }
    if (!g) {
      g = { x: p.x, y: p.y, nx: p.nx, nk: p.nk, pole: p.pole, signs: [] }
      groups.push(g)
      cells.set(key, [...(cells.get(key) || []), g])
    }
    g.signs.push(p)
    p.group = g
  }
  return groups
}

// 3D 간판 면 → 2D 판: 벽 가운데(미터), 벽에서 나오는 쪽, 층
const tctx = document.createElement('canvas').getContext('2d')
function flatSign(p) {
  const [px, pz, qx, qz] = p.faces[0]
  const len = Math.hypot(qx - px, qz - pz) || 1
  const pole = p.faces.length > 1
  tctx.font = '12px Galmuri11'
  return {
    ...p,
    x: (px + qx) / 2,
    y: -(pz + qz) / 2,
    // 화면 기준(오른쪽 +, 아래 +)
    nx: pole ? 0 : -(qz - pz) / len,
    nk: pole ? 1 : (qx - px) / len,
    pole,
    tw: tctx.measureText(p.sign.name).width,
    tag: p.sign.floor > 1 ? `${p.sign.floor}F` : p.sign.floor < 0 ? `B${-p.sign.floor}` : '',
    key: p.sign.id ? `${p.sign.id}|${p.sign.name.slice(0, 40)}` : null,
    color: pastelOf(p.sign.cat),
  }
}

// --- 같이 하기 ---------------------------------------------------------------
// 읽기는 동네마다 한 번(서버가 30초 캐시), 쓰기는 모아서 30초마다 한 번. 실시간 연결은 쓰지 않는다
async function loadShared() {
  const want = tiles.join(',')
  if (!want) return
  const data = await streetRead(tiles).catch(() => null)
  if (data && tiles.join(',') === want) shared.value = data
  if (me.value) setFlush()
}

function setFlush() {
  clearInterval(flushTimer)
  flushTimer = setInterval(flushShared, 30_000)
}

function flushShared() {
  if (!me.value || (!pending.size && !visitPending)) return
  const found = [...pending].slice(0, 60)
  for (const k of found) pending.delete(k)
  visitPending = false
  streetFound(homeTile, found).catch(() => found.forEach((k) => (sent.delete(k), pending.add(k))))
}

const sharedOf = (p) => (p?.key && shared.value ? shared.value.signs[p.key] : null)
const noteOf = (p) => (p?.key && shared.value ? shared.value.notes[p.key] : null)

// 담으면 바로 내 화면에 숫자를 올리고, 서버에는 나중에 모아서 보낸다
function shareFound(p) {
  if (!me.value || !p?.key || sent.has(p.key)) return
  sent.add(p.key)
  pending.add(p.key)
  const sv = shared.value || { signs: {}, notes: {}, top: [], today: 0 }
  const [n, first] = sv.signs[p.key] || [0, me.value.name]
  shared.value = { ...sv, signs: { ...sv.signs, [p.key]: [n + 1, first] } }
  if (pending.size >= 60) flushShared()
}

function openNote(p) {
  if (!p?.key) return
  sfx.click()
  keys.clear()
  noteFor.value = p
  noteText.value = noteOf(p)?.[0] || ''
  noteErr.value = ''
}

async function sendNote() {
  const p = noteFor.value
  if (!p || noteBusy.value) return
  noteErr.value = ''
  noteBusy.value = true
  try {
    if (!me.value) me.value = await arcadeEnter(noteName.value.trim(), notePass.value)
    const out = await streetNote(p.key, noteText.value)
    const sv = shared.value || { signs: {}, notes: {}, top: [], today: 0 }
    const notes = { ...sv.notes }
    if (out.text) notes[p.key] = [out.text, out.by, out.at]
    else delete notes[p.key]
    shared.value = { ...sv, notes }
    sfx.right()
    noteFor.value = null
  } catch (e) {
    noteErr.value = e.message
  }
  noteBusy.value = false
}

const onPlayer = (e) => {
  me.value = e.detail
  if (e.detail) setFlush()
}
const onHide = () => document.visibilityState === 'hidden' && flushShared()

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
// 이야기 속 때를 시각으로 바꿔 자료가 없을 때 붐빔을 어림한다
const STORY_HOUR = { midnight: 0, late: 1, night: 21.7, predawn: 5.3, dawn: 6.2, dusk: 18.3, morning: 7.5, day: 13 }
function storyDate() {
  const d = new Date()
  const h = STORY_HOUR[timeMode.value] ?? 21.7
  d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0)
  return d
}

function applyCity(data) {
  const now = storyDate()
  const guess = guessLevel(now)
  const level = ['원활', '서행', '정체'].includes(data?.road.level) ? data.road.level : guess
  traffic.setFlow(data ? flowsFromCity(data) : new Map(), level)
  roadText.value = data ? `${level}${data.road.speed ? ` ${data.road.speed}km/h` : ''}` : `${guess} (추정)`
  const crowd = data?.people.level || guessCrowd(now)
  people.setCrowd(crowd)
  crowdText.value = data ? crowd : `${crowd} (추정)`
  const near = (x, y) => Math.abs(x) < world.r && Math.abs(y) < world.r
  world.bk = (data?.bike || []).map(([name, x, y, count, rack]) => [name, ...toLocal(world, x, y), count, rack]).filter(([, x, y]) => near(x, y))
  world.wk = (data?.works || []).map(([type, dtype, info, x, y]) => [dtype || type, info, ...toLocal(world, x, y)]).filter(([, , x, y]) => near(x, y))
  cityAt = Date.now()
  mapImage = drawMap()
}

const weatherKind = () => (weatherMode.value === 'live' ? weather.value?.kind || 'clear' : weatherMode.value)

function applyWeather() {
  drops = []
  if (grid) updateSky()
}

function setWeather(id) {
  weatherMode.value = id
  sfx.click()
  applyWeather()
}

const WEATHER_ICON = { clear: Sun, cloud: Cloud, rain: CloudRain, snow: Snowflake }
const WEATHER_NAME = { clear: '맑음', cloud: '흐림', rain: '비', snow: '눈' }
const weatherIcon = computed(() => WEATHER_ICON[weatherKind()])
const weatherLabel = computed(() => {
  const kind = weatherKind()
  const temp = weatherMode.value === 'live' && weather.value ? ` ${weather.value.temp}°` : ''
  return `${WEATHER_NAME[kind]}${temp}${weatherMode.value === 'live' ? '' : ' (고정)'}`
})
// 랜드마크 알림 제목
const LAND = {
  exit: [TrainFront, '지하철 출구'], station: [TrainFrontTunnel, '지하철역'], bus: [Bus, '버스 정류장'], road: [Signpost, '도로명'],
  building: [Building2, '건물'], bike: [Bike, '따릉이'], work: [Construction, '공사·통제'],
}

// 정한 자리(start, 미터)가 있으면 그 옆 빈 바닥에, 없으면 가운데에서 가장 가까운 간판 앞에 선다
function spawn(signs = [], start = null) {
  const { N, half, height, ground } = grid
  const first = start ? null : signs.reduce((m, p) => (!m || p.x ** 2 + p.y ** 2 < m.x ** 2 + m.y ** 2 ? p : m), null)
  const nearSign = first && first.x ** 2 + first.y ** 2 < 120 ** 2
  const oi = start ? start[0] / B + half : nearSign ? first.x / B + half + first.nx * 2 : half
  const ok = start ? -start[1] / B + half : nearSign ? -first.y / B + half + first.nk * 2 : half
  let best = null
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      const c = k * N + i
      if (height[c] || ground[c] === GROUND_ID.water || treeCells.has(c)) continue
      const d = (i - oi) ** 2 + (k - ok) ** 2 + (ground[c] === GROUND_ID.road ? 40 : 0)
      if (!best || d < best.d) best = { d, i, k }
    }
  }
  player.x = (best.i - grid.half + 0.5) * B
  player.y = -(best.k - grid.half + 0.5) * B
  player.dir = start ? 1 : 0
  cam.i = best.i + 0.5
  cam.k = best.k + 0.5
}

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no geolocation'))
    navigator.geolocation.getCurrentPosition((p) => resolve(p.coords), reject, { timeout: 10000, maximumAge: 60000 })
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
  const closest = [...PRESETS].sort((a, b) => near(a, me) - near(b, me))[0]
  const seq = ++hereSeq
  hereWorld.value = null
  hereState.value = 'loading'
  notice.value = '내 위치 지도는 뒤에서 받는 중이에요. 준비되면 메뉴에 ‘내 위치’ 버튼이 생겨요'
  await goPreset(closest, true)
  const { w, osm } = await fetchArea(me.lng, me.lat)
  if (seq !== hereSeq) return
  if (!w.b.length && !w.w.length) {
    hereState.value = 'failed'
    notice.value = '지도 서버가 응답하지 않아서 내 위치 지도를 못 받았어요. 잠시 뒤 ‘내 위치’를 다시 눌러 보세요'
    return
  }
  hereWorld.value = w
  hereState.value = 'ready'
  notice.value = osm ? '' : 'OpenStreetMap 서버가 응답하지 않아서 내 위치는 길 없이 건물만 세워요'
}

// 길은 OpenStreetMap 벡터 타일(OpenFreeMap, 한 칸 0.3초 남짓), 건물은 국토부 GIS건물통합정보(브이월드)에서 함께 받는다.
// 타일이 안 되면 느린 Overpass 로 다시 받고, 길이 모두 죽어도 건물은 세운다
async function fetchArea(lngV, latV, timeout = 40000) {
  const roads = fetchTilesArea(lngV, latV, RADIUS)
    .then((w) => ({ w, osm: true }))
    .catch(() =>
      fetchOSM(lngV, latV, RADIUS, { timeout })
        .then((osm) => ({ w: compact(osm, lngV, latV, RADIUS), osm }))
        .catch(() => ({ w: null, osm: null })),
    )
  const [{ w: got, osm }, gis] = await Promise.all([roads, buildingsAround(lngV, latV, RADIUS).catch(() => null)])
  const w = got || { lng: lngV, lat: latV, r: RADIUS, b: [], w: [], a: [], st: [], ex: [], bus: [], ln: [] }
  if (gis?.b?.length > 3) {
    const named = w.b.filter((b) => b[1])
    w.b = vworldBuildings(gis.b, lngV, latV).map((b) => (b[1] ? b : [b[0], nameInside(b[2], named), ...b.slice(2)]))
    w.bsrc = 'gis'
  }
  return { w, osm }
}

// --- 열린 세계 -----------------------------------------------------------------
// 가운데에서 반경의 절반쯤 벗어나면 지금 선 자리를 가운데로 둔 동네를 뒤에서 받아 두고,
// 다 받으면 같은 땅 위치에 그대로 서 있도록 옮겨 붙인다. 실패하면 20초 뒤에 다시 시도한다
let roaming = null
let roamSeq = 0
let roamRetry = 0
let prefetchAt = 0
const roamState = ref('')

function cancelRoam() {
  roamSeq++
  roaming = null
  roamState.value = ''
}

function checkRoam(now) {
  if (!world || roaming || now < roamRetry || cine || cab || machine.value || (story.value && !story.value.done)) return
  const off = Math.max(Math.abs(player.x), Math.abs(player.y))
  const kx = 111320 * Math.cos((lat * Math.PI) / 180)
  // 가장자리에 닿기 전에, 가던 쪽 동네 길 타일을 미리 받아 둔다
  if (off > world.r * 0.25 && now > prefetchAt) {
    prefetchAt = now + 1500
    const ahead = 1.6
    prefetchTiles(lng + (player.x * ahead) / kx, lat + (player.y * ahead) / 110540, RADIUS)
  }
  if (off < world.r * 0.45) return
  const at = { lng: lng + player.x / kx, lat: lat + player.y / 110540 }
  const seq = ++roamSeq
  const label = where.value.replace(/ 근처$/, '')
  roaming = at
  roamState.value = 'loading'
  Promise.all([fetchArea(at.lng, at.lat, 25000), signsAround(at.lng, at.lat, RADIUS).catch(() => ({ dense: false, rows: [] }))])
    .then(([{ w, osm }, found]) => {
      if (seq !== roamSeq) return
      if (!w.b.length && !w.w.length && !found.rows.length) throw new Error('empty')
      const k2 = 111320 * Math.cos((w.lat * Math.PI) / 180)
      // 길 서버가 안 되면 지금 동네의 길·공원 가운데 겹치는 부분이라도 옮겨 와 맨땅을 줄인다
      if (!osm) carryOver(w, (lng - w.lng) * k2, (lat - w.lat) * 110540)
      // 받는 사이 걸어간 만큼을 새 동네 좌표로 옮긴다
      const gx = lng + player.x / kx
      const gy = lat + player.y / 110540
      enter(w, `${label} 근처`, '', [(gx - w.lng) * k2, (gy - w.lat) * 110540], { found })
    })
    .catch(() => {
      if (seq !== roamSeq) return
      roaming = null
      roamState.value = 'failed'
      roamRetry = performance.now() + 20000
    })
}

// 옛 동네 좌표(dx, dy 만큼 어긋남)의 길·땅을 새 동네 반경 안에 든 것만 옮겨 담는다
function carryOver(w, dx, dy) {
  const move = (flat) => flat.map((v, n) => v + (n % 2 ? dy : dx))
  const inside = (flat) => {
    for (let n = 0; n < flat.length; n += 2) if (Math.abs(flat[n]) < w.r && Math.abs(flat[n + 1]) < w.r) return true
    return false
  }
  for (const [kind, width, flat, name] of world.w) {
    const f = move(flat)
    if (inside(f)) w.w.push([kind, width, f, name])
  }
  for (const [kind, flat] of world.a) {
    const f = move(flat)
    if (inside(f)) w.a.push([kind, f])
  }
}

async function goHere() {
  const w = hereWorld.value
  if (!w) return
  hereWorld.value = null
  hereState.value = ''
  notice.value = ''
  status.value = '내 위치 지도를 펼치는 중…'
  await enter(w, '내 위치')
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
    await enter(await load(`world/${p.id}.json`), p.label, p.area, p.start)
  } catch (e) {
    if (import.meta.env.DEV) console.error(e)
    status.value = ''
    notice.value = '지도를 못 불러왔어요. 잠시 뒤 다시 눌러 보세요'
  }
}

// --- 하늘과 밤낮 ---------------------------------------------------------------
// 실제 시각을 따르지 않고 이야기 속 때(TIMES)를 따른다. 때가 바뀌면 천천히 넘어간다
let nightTo = 1
let duskTo = 0
function updateSky() {
  const tm = STORY_TIMES[timeMode.value] || STORY_TIMES.night
  clock.value = tm.clock
  nightTo = tm.night
  duskTo = tm.dusk
  spot.value = describeSpot(world, player.x, player.y)
}

function easeSky(dt, snap = false) {
  const k = snap ? 1 : Math.min(1, dt * 0.8)
  night += (nightTo - night) * k
  dusk += (duskTo - dusk) * k
}

// --- 미니맵 -------------------------------------------------------------------
const MAP_COLOR = ['#c9c4b6', '#55555d', '#c98d7a', '#79b357', '#3f76c9', '#5fa05a', '#77777d', '#8a8178', '#8cbf6a', '#f0efe8']

function drawMap() {
  const { N, height, ground } = grid
  const c = document.createElement('canvas')
  c.width = N
  c.height = N
  const m = c.getContext('2d')
  const img = m.createImageData(N, N)
  const rgb = MAP_COLOR.map((hx) => [1, 3, 5].map((o) => Number.parseInt(hx.slice(o, o + 2), 16)))
  for (let n = 0; n < N * N; n++) {
    const h = height[n]
    const v = h ? Math.max(70, 200 - h * 2) : 0
    const [r, g, b] = h ? [v, v, v + 12] : rgb[ground[n]] || rgb[0]
    img.data.set([r, g, b, 255], n * 4)
  }
  m.putImageData(img, 0, 0)
  const dot = (x, y, color, size) => {
    m.fillStyle = color
    m.fillRect(Math.round(x / B + grid.half - size / 2), Math.round(-y / B + grid.half - size / 2), size, size)
  }
  // 찻길 소통: 초록 원활 · 주황 서행 · 빨강 정체
  m.globalAlpha = 0.75
  m.lineWidth = 1.5
  for (const lane of traffic.lanes) {
    m.strokeStyle = LEVEL_COLOR[traffic.levelOf(lane)]
    m.beginPath()
    lane.pts.forEach(([x, y], n) => m[n ? 'lineTo' : 'moveTo'](x / B + grid.half, -y / B + grid.half))
    m.stroke()
  }
  m.globalAlpha = 1
  for (const [, x, y] of world.bk || []) dot(x, y, '#2fa84f', 3)
  for (const [, , x, y] of world.wk || []) dot(x, y, '#ff6a13', 4)
  for (const [, x, y] of world.bus || []) dot(x, y, '#2fd0d0', 3)
  for (const [, x, y] of world.ex || []) dot(x, y, '#ffd200', 4)
  for (const [, x, y] of world.st || []) dot(x, y, world.ln?.[0]?.[1] || '#ffffff', 7)
  return c
}

const DIR_ANG = [Math.PI, 0, -Math.PI / 2, Math.PI / 2]
function drawMini() {
  const el = mini.value
  if (!el || !mapImage) return
  const m = el.getContext('2d')
  const S = el.width
  const span = 120
  const pi = player.x / B + grid.half
  const pk = -player.y / B + grid.half
  m.imageSmoothingEnabled = false
  m.fillStyle = '#c9c4b6'
  m.fillRect(0, 0, S, S)
  m.drawImage(mapImage, pi - span / 2, pk - span / 2, span, span, 0, 0, S, S)
  if (mission.value) {
    const g = mission.value
    const mx = Math.max(6, Math.min(S - 6, ((g.x / B + grid.half - pi) / span) * S + S / 2))
    const my = Math.max(6, Math.min(S - 6, ((-g.y / B + grid.half - pk) / span) * S + S / 2))
    if (Math.floor(performance.now() / 300) % 2) {
      m.fillStyle = '#ff2fa0'
      m.fillRect(mx - 5, my - 5, 10, 10)
      m.strokeStyle = '#fff'
      m.strokeRect(mx - 5, my - 5, 10, 10)
    }
  }
  m.save()
  m.translate(S / 2, S / 2)
  m.rotate(DIR_ANG[player.dir])
  m.fillStyle = '#e8312f'
  m.strokeStyle = '#fff'
  m.lineWidth = 1.5
  m.beginPath()
  m.moveTo(0, -8)
  m.lineTo(6, 6)
  m.lineTo(0, 3)
  m.lineTo(-6, 6)
  m.closePath()
  m.fill()
  m.stroke()
  m.restore()
  m.fillStyle = '#1d1d2b'
  m.font = 'bold 12px Galmuri11'
  m.textAlign = 'center'
  m.fillText('N', S / 2, 12)
}

// --- 조작 ---------------------------------------------------------------------
let walkTo = null
function update(dt) {
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight')
  const speed = cab?.phase === 'drive' ? (run ? 34 : 24) : flying.value ? (run ? 44 : 22) : run ? 16 : 9.5
  let mx = 0
  let my = 0
  if (keys.has('KeyW') || keys.has('ArrowUp') || keys.has('touch-up')) my += 1
  if (keys.has('KeyS') || keys.has('ArrowDown') || keys.has('touch-down')) my -= 1
  if (keys.has('KeyA') || keys.has('ArrowLeft') || keys.has('touch-left')) mx -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight') || keys.has('touch-right')) mx += 1
  // 사람을 누르면 그 앞까지 걸어간다. 방향키를 누르거나 막히면 멈춘다
  if (mx || my) walkTo = null
  else if (walkTo) {
    const dx = walkTo.x - player.x
    const dy = walkTo.y - player.y
    const dd = Math.hypot(dx, dy)
    if (dd < (walkTo.r || 2)) {
      const w = walkTo
      walkTo = null
      player.moving = false
      return w.then?.()
    }
    if (dd < walkTo.best - 0.25) {
      walkTo.best = dd
      walkTo.stall = 0
    } else if ((walkTo.stall += dt) > 1.2) {
      walkTo = null
      player.moving = false
      return
    }
    mx = dx / dd
    my = dy / dd
  }
  player.moving = !!(mx || my)
  if (!player.moving) return
  const len = Math.hypot(mx, my)
  const vx = (mx / len) * speed * dt
  const vy = (my / len) * speed * dt
  player.dir = Math.abs(mx) > Math.abs(my) ? (mx < 0 ? 2 : 3) : my > 0 ? 1 : 0
  // 축마다 따로 막아서 벽을 따라 미끄러진다
  if (!hits(player.x + vx, player.y)) player.x += vx
  if (!hits(player.x, player.y + vy)) player.y += vy
  player.step += dt * speed * 1.6
}

// 플레이어 앞 칸
function frontCell() {
  const [i, k] = cellOf(player.x, player.y)
  return [[i, k + 1], [i, k - 1], [i - 1, k], [i + 1, k]][player.dir]
}

const signDist = (p) => Math.hypot(p.x - player.x, p.y - player.y)

// 가장 가까운 벽의 간판 가운데 아직 안 담은(이야기 중이면 안 켠) 것부터, 위층부터
function nearestSign() {
  let best = null
  let bd = REACH
  for (const g of signGroups) {
    const d = Math.hypot(g.x - player.x, g.y - player.y)
    if (d < bd) {
      bd = d
      best = g
    }
  }
  if (!best) return null
  const storyOn = story.value && !story.value.done
  const done = (p) => (storyOn ? isLit(p) : dexSet.value.has(seenKey(p)))
  const list = [...best.signs].sort((a, b) => b.sign.floor - a.sign.floor)
  return list.find((p) => !done(p)) || list[0]
}

// 간판을 담거나(평소) 고친다(이야기 중)
function useSign(p) {
  if (story.value && !story.value.done) repair(p)
  else collect(p.sign, false, p)
}

// --- 택시 ----------------------------------------------------------------------
const TAXI = { name: '택시 기사님', face: '🚕', portrait: '', tone: 'npc' }
const lerp = (a, b, k) => a + (b - a) * k

function hailTaxi() {
  if (cab?.phase === 'drive' && !paused.value) return endFare(false)
  if (cab || paused.value || dialog.value || quest.value || view3d.value || inside.value || machine.value || cine || !grid) return
  if (story.value?.build && !story.value.build.done) return speak(TAXI, '공사 중에는 못 모셔요. 블록부터 쌓고 부르세요!')
  paused.value = true
  keys.clear()
  walkTo = null
  sfx.horn()
  // 왼쪽 바깥에서 달려와 내 앞에 선다
  cab = { phase: 'come', t0: performance.now() / 1000, x: player.x - 30, y: player.y - 1.4, from: [player.x - 30, player.y - 1.4], to: [player.x - 2.4, player.y - 1.4], dir: 1, hide: false }
}

// 갈 만한 곳: 이야기 중이면 부탁받은 가게, 아니면 멀리 있는 아직 안 담은 간판 둘과 다른 동네
function taxiChoices() {
  const st = story.value
  const out = []
  const go = (label, at, then = null) => out.push({ label, fn: () => taxiGo(at, then) })
  if (st && !st.done && st.shop) {
    const at = st.ownerAt || ownerSpot(st.shop)
    go(`「${st.shop.sign.name}」 앞으로 ▶`, freeSpot(at.x + 1.6, at.y))
  } else {
    const far = signPlaced
      .filter((p) => !dexSet.value.has(seenKey(p)))
      .map((p) => ({ p, d: Math.hypot(p.x - player.x, p.y - player.y) }))
      .filter((c) => c.d > 60 && c.d < 260)
    for (let n = 0; n < 2 && far.length; n++) {
      const { p } = far.splice(Math.floor(Math.random() * far.length), 1)[0]
      go(`「${p.sign.name}」 앞으로`, ownerSpot(p))
    }
    const here = PRESETS.findIndex((p) => p.label === where.value)
    const other = PRESETS[(here + 1) % PRESETS.length]
    if (other && other.label !== where.value) out.push({ label: `${other.label}(으)로 가 주세요`, fn: () => taxiGo(null, () => goPreset(other)) })
    out.push({ label: '제가 몰아 볼게요 (손님 태우기)', fn: startFare })
  }
  out.push({ label: '그냥 걸을게요', fn: taxiCancel })
  return out
}

function taxiAsk() {
  const st = story.value
  const line = st && !st.done && st.shop ? `어서 오세요! 「${st.shop.sign.name}」 가시죠? 거기 간판 꺼졌다고 다들 난리던데.` : '어서 오세요! 어디로 모실까요? 간판 이름만 말씀하세요.'
  say(TAXI, [line], { choices: taxiChoices() })
}

function taxiGo(at, then) {
  sfx.click()
  const t = performance.now() / 1000
  cab = { ...cab, phase: 'board', t0: t, at, then, hide: false }
}

const PASSENGER = { name: '손님', face: '🧳', portrait: '', tone: 'npc' }
const FARE_KEY = 'st-taxi-won'
const COMPASS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
const compassOf = (dx, dy) => COMPASS[Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) / 45) % 8]

function startFare() {
  const far = signPlaced
    .filter((p) => p.sign?.name)
    .map((p) => ({ p, d: Math.hypot(p.x - player.x, p.y - player.y) }))
    // 동네 끝을 넘으면 옆 동네로 갈아타므로 그 안쪽 간판만 고른다
    .filter((c) => c.d > 70 && c.d < 220 && Math.max(Math.abs(c.p.x), Math.abs(c.p.y)) < world.r * 0.4)
  if (!far.length) return say(TAXI, ['오늘은 손님이 없네요. 다음에 몰아 봐요!'], { then: taxiCancel })
  const { p, d } = far[Math.floor(Math.random() * far.length)]
  const at = ownerSpot(p)
  // 미터기 시간: 곧장 가면 넉넉하고, 헤매면 빠듯하다
  const limit = Math.round(d / 7 + 25)
  fareRun = { p, at, limit, el: 0, last: 0, started: false, hintT: 0, lastD: d }
  cab = { ...cab, phase: 'drive', hide: true, x: player.x, y: player.y, dir: 1, ang: 0 }
  const way = `${compassOf(at.x - player.x, at.y - player.y)}쪽으로 ${Math.round(d / 10) * 10}m쯤`
  say(PASSENGER, [`「${p.sign.name}」 앞에 내려 주세요. ${limit}초 안에 가면 팁 드릴게요!`, `내비가 고장이라… ${way}일 거예요. 간판 보고 찾아가요.`], {
    then: () => {
      fareRun.started = true
      resume()
    },
  })
}

function endFare(ok) {
  const f = fareRun
  if (!f) return
  fareRun = null
  fare.value = null
  const won = 4800 + Math.floor(f.el / 5) * 100
  cab = { ...cab, phase: 'wait', hide: false, x: player.x - 2.4, y: player.y - 1.4, ang: 0, dir: 1 }
  player.dir = 0
  if (!ok) return say(PASSENGER, ['시간이 다 됐네요… 여기서부터 걸어갈게요.', `미터기는 ${won.toLocaleString()}원이었어요.`], { then: taxiCancel })
  const tip = Math.max(0, Math.round((5 * (f.limit - f.el)) / f.limit)) * 1000
  let total = 0
  try {
    total = (Number(localStorage.getItem(FARE_KEY)) || 0) + won + tip
    localStorage.setItem(FARE_KEY, String(total))
  } catch {
    total = 0
  }
  sfx.win()
  collect(f.p.sign, true, f.p)
  const lines = [`도착! 미터기 ${won.toLocaleString()}원${tip ? `, 팁 ${tip.toLocaleString()}원 얹었어요` : ''}.`, `「${f.p.sign.name}」 간판은 도감에 담아 뒀어요.`]
  if (total) lines.push(`기사님이 지금까지 번 돈: ${total.toLocaleString()}원`)
  say(PASSENGER, lines, { then: taxiCancel })
}

// 손님 태우고 달리는 중: 택시가 나를 따라오고, 미터기가 돌고, 손님이 가끔 한마디 한다
function runFare(t) {
  const r = cab
  const f = fareRun
  r.x = player.x
  r.y = player.y
  r.ang = [Math.PI / 2, -Math.PI / 2, Math.PI, 0][player.dir]
  if (!f) return
  const dt = f.last ? t - f.last : 0
  f.last = t
  if (!f.started || paused.value) return
  f.el += dt
  const d = Math.hypot(f.at.x - player.x, f.at.y - player.y)
  const left = f.limit - f.el
  if (t - f.hintT > 6) {
    if (f.hintT) {
      const line = d < f.lastD - 20 ? '오, 가까워지는 것 같아요!' : d > f.lastD + 12 ? '어… 반대로 가는 거 아니에요?' : d < 40 ? '이 근처예요! 간판 잘 보세요.' : null
      if (line) speak(PASSENGER, line)
    }
    f.hintT = t
    f.lastD = d
  }
  const next = { name: f.p.sign.name, left: Math.max(0, Math.ceil(left)), won: 4800 + Math.floor(f.el / 5) * 100, hurry: left < 10 }
  const cur = fare.value
  if (!cur || cur.left !== next.left || cur.won !== next.won) fare.value = next
  if (d < 6) return endFare(true)
  if (left <= 0) endFare(false)
}

function taxiCancel() {
  cab = { ...cab, phase: 'off', t0: performance.now() / 1000, from: [cab.x, cab.y], to: [cab.x + 40, cab.y], hide: false }
}

function runRide(t) {
  const r = cab
  if (r.phase === 'drive') return runFare(t)
  const k = (d) => Math.min(1, (t - r.t0) / d)
  if (r.phase === 'come' || r.phase === 'arrive') {
    const v = ease(k(1.1))
    r.x = lerp(r.from[0], r.to[0], v)
    r.y = lerp(r.from[1], r.to[1], v)
    if (v < 1) return
    if (r.phase === 'come') {
      r.phase = 'wait'
      return taxiAsk()
    }
    // 내려 준다
    r.hide = false
    player.dir = 0
    return taxiCancel()
  }
  if (r.phase === 'board') {
    if (k(0.35) < 1) return
    Object.assign(r, { phase: 'leave', t0: t, hide: true, from: [r.x, r.y], to: [r.x + 34, r.y] })
    sfx.whoosh(true, { dur: 0.5 })
    return
  }
  if (r.phase === 'leave') {
    const v = k(0.9) ** 2
    r.x = lerp(r.from[0], r.to[0], v)
    if (v < 1 || r.wiping) return
    r.wiping = true
    rowWipe(() => {
      if (r.then && !r.at) {
        cab = null
        r.then()
        resume()
        return
      }
      player.x = r.at.x
      player.y = r.at.y
      cam.i = (player.x - 20) / B + grid.half
      cam.k = -player.y / B + grid.half
      Object.assign(r, { phase: 'arrive', t0: performance.now() / 1000, wiping: false, from: [r.at.x - 30, r.at.y - 1.4], to: [r.at.x - 0.6, r.at.y - 1.4], x: r.at.x - 30, y: r.at.y - 1.4 })
    })
    return
  }
  if (r.phase === 'off') {
    const v = k(1) ** 2
    r.x = lerp(r.from[0], r.to[0], v)
    if (v < 1) return
    cab = null
    if (!dialog.value) resume()
  }
}

function drawTaxi(c, wx, wy, dir, ang = 0) {
  const T = cam.T
  const x = sx(wx)
  const y = sy(wy)
  if (!onScreen(x, y, 80)) return
  const L = (4.4 / B) * T
  const Wd = (1.9 / B) * T
  c.save()
  c.translate(Math.round(x), Math.round(y))
  if (ang) c.rotate(ang)
  else if (dir < 0) c.scale(-1, 1)
  c.fillStyle = 'rgba(20,24,40,0.3)'
  c.fillRect(-L / 2 + 2, -Wd / 2 + 3, L, Wd)
  c.fillStyle = '#f08a1c'
  c.fillRect(-L / 2, -Wd / 2, L, Wd)
  c.fillStyle = '#2a3442'
  c.fillRect(L * 0.08, -Wd / 2 + 1, L * 0.18, Wd - 2)
  c.fillRect(-L * 0.36, -Wd / 2 + 1, L * 0.12, Wd - 2)
  c.fillStyle = '#fff6c0'
  c.fillRect(-L * 0.06, -Wd * 0.18, L * 0.1, Wd * 0.36)
  // 앞 전조등
  c.fillStyle = 'rgba(255,236,39,0.35)'
  c.beginPath()
  c.moveTo(L / 2, -Wd * 0.35)
  c.lineTo(L / 2 + L * 0.7, -Wd * 0.8)
  c.lineTo(L / 2 + L * 0.7, Wd * 0.8)
  c.lineTo(L / 2, Wd * 0.35)
  c.fill()
  c.restore()
  // 머리 위 TAXI 표지
  c.font = '10px Galmuri11'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillStyle = '#141b3a'
  c.fillRect(Math.round(x) - 17, Math.round(y - Wd / 2) - 16, 34, 12)
  c.fillStyle = '#ffec27'
  c.fillText('TAXI', Math.round(x), Math.round(y - Wd / 2) - 10)
}

// 손님이 말한 간판: 가까이 오면 머리 위에 깃발이 선다
function drawFareGoal(c, t) {
  const f = fareRun
  if (!f || Math.hypot(f.at.x - player.x, f.at.y - player.y) > 45) return
  const x = Math.round(sx(f.p.x))
  const y = Math.round(sy(f.p.y)) - 26 + Math.round(Math.sin(t * 5) * 3)
  if (!onScreen(x, y, 60)) return
  c.font = '12px Galmuri11'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  const w = Math.ceil(c.measureText(f.p.sign.name).width) + 16
  c.fillStyle = 'rgba(8,10,24,0.45)'
  c.fillRect(x - w / 2 + 2, y - 9 + 2, w, 18)
  c.fillStyle = '#ffa300'
  c.fillRect(x - w / 2, y - 9, w, 18)
  c.fillStyle = '#141b3a'
  c.fillText(f.p.sign.name, x, y)
  c.fillStyle = '#ffa300'
  c.fillRect(x - 3, y + 9, 6, 4)
  c.fillRect(x - 1, y + 13, 2, 3)
}

// 이야기 중에 보스·사장님·💡 사람 앞에 닿으면 E 없이도 바로 대화창이 뜬다.
// 한 번 뜬 상대는 멀어졌다가 다시 와야 또 뜬다
let autoKey = null
function autoTalk() {
  const st = story.value
  if (!st || st.done || paused.value || dialog.value || quest.value || view3d.value || inside.value || machine.value || cine || cab) return
  const d = (o) => (o ? Math.hypot(o.x - player.x, o.y - player.y) : 99)
  const f = st.folks?.find((o) => !o.done && d(o.at) < 2.6)
  const key = st.boss?.alive && d(st.boss.at) < 3.2 ? `boss:${st.boss.id}` : st.ownerAt && st.shop && d(st.ownerAt) < 2.4 ? `owner:${st.step}` : f ? `folk:${f.id}` : null
  if (key === autoKey) return
  autoKey = key
  if (key) interact()
}

function interact() {
  // 이야기 중이면 안내하는 사람·사장님과 먼저 말한다
  const st = story.value
  if (st && !st.done) {
    const d = (o) => (o ? Math.hypot(o.x - player.x, o.y - player.y) : 99)
    if (st.boss?.alive && d(st.boss.at) < 3.2) return askBoss()
    if (st.ownerAt && st.shop && d(st.ownerAt) < 2.4) {
      if (st.boss?.alive) return say(ownerWho(st.shop.sign), SCARED.map((l) => fill(l, vars(st.shop, null))))
      return useSign(st.shop)
    }
    const f = st.folks?.find((o) => !o.done && d(o.at) < 2.6)
    if (f) return talkFolk(f)
    if (st.guide && d(guidePos) < 2.4) return speak(st.ch.npc, hintOf(st))
  }
  const p = nearSign.value
  // 간판이 많이 붙은 건물은 안으로 들어가 층마다 찾아간다
  if (p && p.group?.signs.length > 3) return enterBuilding(p.group, story.value && !story.value.done && p.group.signs.includes(story.value.shop) ? story.value.shop : p)
  if (p) return useSign(p)
  const l = nearLand()
  if (l) return showLand(l.info)
  sfx.tick()
}

function placeBlock(cell = frontCell()) {
  const [i, k] = cell
  const { N, height, ground } = grid
  if (i < 1 || k < 1 || i >= N - 1 || k >= N - 1) return
  const c = k * N + i
  if (height[c] || ground[c] === GROUND_ID.water || treeCells.has(c) || voxels.has(vkey(i, k))) return
  voxels.set(vkey(i, k), slot.value)
  if (hits(player.x, player.y)) {
    voxels.delete(vkey(i, k))
    return
  }
  sfx.build(slot.value)
  checkBuild()
}

// 2D 에서 부수면 3D 로 쌓은 기둥도 통째로 없어진다
function breakBlock(cell = frontCell()) {
  tall.delete(vkey(...cell))
  if (voxels.delete(vkey(...cell))) {
    sfx.tick()
    checkBuild()
  }
}

let toastTimer = 0
function collect(s, quiet = false, p = null) {
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
  shareFound(p)
  if (quiet) return
  fresh ? sfx.right() : sfx.click()
  toast.value = { ...s, fresh, placed: p }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), sharedOf(p) || noteOf(p) ? 5000 : 3200)
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

// 역·출구·정류장·따릉이·공사: 지도 위 표지
function landmarks() {
  const out = []
  const lines = world.ln || []
  const station = world.st?.[0]?.[0] || ''
  for (const [name, x, y, en] of world.st || []) out.push({ x, y, label: `${name}역`, color: lines[0]?.[1] || '#3a3a44', info: { kind: 'station', title: `${name}역`, sub: [en, ...lines.map((l) => l[0])].filter(Boolean).join(' · ') } })
  for (const [ref, x, y, desc] of world.ex || []) {
    const name = (desc || station || '지하철').replace(/역$/, '')
    out.push({ x, y, label: ref || '출구', color: '#ffd200', ink: '#1d1d2b', small: true, info: { kind: 'exit', title: `${name}역 ${ref ? `${ref}번 ` : ''}출구`, sub: lines.map((l) => l[0]).join(' · ') || '지하철' } })
  }
  for (const [name, x, y] of world.bus || []) out.push({ x, y, label: 'BUS', color: '#1f8fd6', small: true, info: { kind: 'bus', title: name, sub: '버스 정류장' } })
  for (const [name, x, y, count, rack] of world.bk || []) out.push({ x, y, label: `🚲${count}`, color: '#2fa84f', small: true, info: { kind: 'bike', title: `따릉이 ${name}`, sub: `자전거 ${count}대 · 거치대 ${rack}개` } })
  for (const [type, info, x, y] of world.wk || []) out.push({ x, y, label: '공사', color: '#ff6a13', small: true, info: { kind: 'work', title: type, sub: info } })
  return out
}
let landList = []

function nearLand() {
  return landList.map((l) => ({ ...l, d: Math.hypot(l.x - player.x, l.y - player.y) })).filter((l) => l.d < REACH).sort((a, b) => a.d - b.d)[0] || null
}

// --- 그리기 -------------------------------------------------------------------
const sx = (x) => W / 2 + (x / B + grid.half - cam.i) * cam.T
const sy = (y) => H / 2 + (-y / B + grid.half - cam.k) * cam.T
const toWorld = (px, py) => [((px - W / 2) / cam.T + cam.i - grid.half) * B, -((py - H / 2) / cam.T + cam.k - grid.half) * B]

// 화면에 들어오는 부분만 잘라 늘려 그린다
function blit(c, layer) {
  const T = cam.T
  let x0 = cam.i - W / 2 / T
  let k0 = cam.k - H / 2 / T
  let w = W / T
  let h = H / T
  let dx = 0
  let dy = 0
  let dw = W
  let dh = H
  const N = grid.N
  if (x0 < 0) {
    dx = -x0 * T
    dw -= dx
    w += x0
    x0 = 0
  }
  if (k0 < 0) {
    dy = -k0 * T
    dh -= dy
    h += k0
    k0 = 0
  }
  if (x0 + w > N) {
    dw -= (x0 + w - N) * T
    w = N - x0
  }
  if (k0 + h > N) {
    dh -= (k0 + h - N) * T
    h = N - k0
  }
  if (w <= 0 || h <= 0) return
  c.drawImage(layer, x0 * CELL, k0 * CELL, w * CELL, h * CELL, dx, dy, dw, dh)
}

const onScreen = (x, y, m = 40) => x > -m && y > -m && x < W + m && y < H + m

function drawWorld(c, t) {
  const T = cam.T
  c.fillStyle = '#b9b3a4'
  c.fillRect(0, 0, W, H)
  c.imageSmoothingEnabled = false
  blit(c, groundLayer)
  drawLot(c, t)
  // 놓은 블록
  for (const [key, b] of voxels) {
    const [i, k] = key.split(',').map(Number)
    const x = W / 2 + (i - cam.i) * T
    const y = H / 2 + (k - cam.k) * T
    if (!onScreen(x, y)) continue
    c.fillStyle = 'rgba(28,32,52,0.25)'
    c.fillRect(x + T * 0.2, y + T * 0.25, T, T)
    c.drawImage(blocks[b].canvas, x, y - T * 0.25, T, T)
    c.fillStyle = 'rgba(0,0,0,0.25)'
    c.fillRect(x, y + T * 0.75, T, T * 0.25)
  }
  if (!machine.value) drawCars(c)
  blit(c, bldgLayer)
  if (machine.value) return
  drawLandmarks(c)
  // 길 가는 사람들: 아래쪽에 있는 것을 나중에. 가까이 보면 그림, 멀리 보면 작은 점 인형
  const u = T / 8
  const list = people.people.map((p) => ({ p, y: sy(p.y) })).sort((a, b) => a.y - b.y)
  for (const { p, y } of list) {
    const x = sx(p.x)
    if (!onScreen(x, y)) continue
    const dir = Math.abs(Math.cos(p.dir)) > Math.abs(Math.sin(p.dir)) ? (Math.cos(p.dir) < 0 ? 2 : 3) : Math.sin(p.dir) > 0 ? 1 : 0
    p.sprite ??= CROWD[Math.floor(Math.random() * CROWD.length)]
    const bob = p.stop ? 0 : Math.abs(Math.sin(p.step * Math.PI)) * u * 0.5
    if (T < 14 || !drawSprite(c, `f-${p.sprite}`, x, y - bob, 11 * u, dir === 2)) drawPerson(c, x - 4 * u * 0.85, y - 10 * u * 0.85, u * 0.85, dir, p.stop ? 0 : Math.floor(p.step) % 2, p.look)
  }
  // 미션 목표 깃발
  if (mission.value) {
    const x = sx(mission.value.x)
    const y = sy(mission.value.y)
    const bob = Math.sin(t * 5) * 3
    c.fillStyle = '#ff2fa0'
    c.beginPath()
    c.arc(x, y - 14 + bob, 7, 0, Math.PI * 2)
    c.fill()
    c.fillRect(x - 1, y - 14 + bob, 2, 14)
    c.strokeStyle = '#fff'
    c.lineWidth = 2
    c.beginPath()
    c.arc(x, y - 14 + bob, 7, 0, Math.PI * 2)
    c.stroke()
  }
}

// 그림 한 장을 발밑 (x, feet) 에 h 높이로. 아직 안 불러왔으면 false
const CROWD = ['uni', 'grandma', 'rider', 'jogger', 'kid', 'girl', 'suit', 'dogwalker']
function drawSprite(c, name, x, feet, h, flip = false, alpha = 1, shadow = true) {
  const im = artImg(name)
  if (!im) return null
  const w = (h * im.naturalWidth) / im.naturalHeight
  c.save()
  c.globalAlpha = alpha
  if (shadow) {
    c.fillStyle = 'rgba(10,10,20,0.32)'
    c.beginPath()
    c.ellipse(x, feet, w * 0.32, h * 0.05, 0, 0, Math.PI * 2)
    c.fill()
  }
  c.imageSmoothingEnabled = true
  c.imageSmoothingQuality = 'medium'
  if (flip) {
    c.translate(x, 0)
    c.scale(-1, 1)
    c.drawImage(im, -w / 2, feet - h, w, h)
  } else c.drawImage(im, x - w / 2, feet - h, w, h)
  c.restore()
  return { x0: x - w / 2, y0: feet - h, x1: x + w / 2, y1: feet }
}

// 나·길잡이·사장님·보스·동네 사람·같은 동네 사람들: 밤 어둠 위에 그려서 늘 또렷하다
let npcRects = []
function drawActors(c, t) {
  npcRects = []
  if (machine.value || !grid) return
  const T = cam.T
  // 멀리 볼 때도 사람은 알아볼 만한 크기로 그린다
  const u = Math.max(T / 8, 2.4)
  const st = story.value
  const on = st && !st.done
  const list = [{ y: player.y, kind: 'me' }]
  if (on) {
    const own = st.ch.steps[st.step]?.own
    if (st.guide) list.push({ y: guidePos.y, kind: 'guide' })
    if (st.shop && st.ownerAt && !own) list.push({ y: st.ownerAt.y, kind: 'owner' })
    if (st.boss && (st.boss.alive || t - st.boss.t0 < 1.4)) list.push({ y: st.boss.at.y, kind: 'boss' })
    for (const f of st.folks || []) list.push({ y: f.at.y, kind: 'folk', f })
  }
  for (const o of townView) list.push({ y: o.y, kind: 'other', o })
  list.sort((a, b) => b.y - a.y)
  const glow = night > 0.3
  for (const it of list) {
    if (it.kind === 'me') {
      if (cab?.hide) continue
      const lift = flying.value ? T * 0.9 : 0
      if (flying.value) {
        c.fillStyle = 'rgba(20,24,40,0.25)'
        c.beginPath()
        c.ellipse(sx(player.x), sy(player.y) + u, 3.4 * u, 1.3 * u, 0, 0, Math.PI * 2)
        c.fill()
      }
      drawMeRing(c, u)
      drawAvatar(c, myLook, sx(player.x), sy(player.y) + u * 0.6 - lift, { scale: u / 2, dir: player.dir, frame: player.moving ? 1 + (Math.floor(player.step) % 2) : 0, night: glow, shadow: false })
      continue
    }
    if (it.kind === 'other') {
      const o = it.o
      const x = sx(o.x)
      const y = sy(o.y)
      if (!onScreen(x, y)) continue
      drawAvatar(c, o.look || {}, x, y + u * 0.6, { scale: u / 2, dir: o.d || 0, frame: o.m ? 1 + (Math.floor(t * 6) % 2) : 0, night: glow })
      drawNameTag(c, x, y - 12 * u, o.name || '수리공')
      continue
    }
    let at
    let name
    let h = 13 * u
    let flip = false
    let mark = null
    let alpha = 1
    let bob = 0
    if (it.kind === 'guide') {
      at = guidePos
      name = `c-${st.ch.npc.id}`
      h = 14 * u
      flip = guidePos.dir === 2
      bob = guidePos.moving ? Math.abs(Math.sin(guidePos.step * Math.PI)) * u * 0.6 : 0
      mark = st.ch.steps[st.step]?.own && !st.boss?.alive ? '!' : st.ch.npc.face
    } else if (it.kind === 'owner') {
      at = st.ownerAt
      name = `f-${spriteOf(st.shop.sign.cat)}`
      flip = at.x > player.x
      mark = st.boss?.alive ? '…' : '!'
    } else if (it.kind === 'boss') {
      at = st.boss.at
      name = `c-${st.boss.id}`
      h = 24 * u
      flip = at.x < player.x
      bob = Math.sin(t * 2.2) * u * 1.2 + u * 1.5
      if (!st.boss.alive) {
        const k = Math.min(1, (t - st.boss.t0) / 1.4)
        alpha = 1 - k
        h *= 1 + k * 0.5
        bob += k * u * 8
      } else mark = 'boss'
    } else {
      at = it.f.at
      name = `f-${it.f.id}`
      flip = at.x > player.x
      mark = it.f.done ? null : '💡'
    }
    const x = sx(at.x)
    const y = sy(at.y)
    if (!onScreen(x, y, 80)) continue
    const r = drawSprite(c, name, x, y - bob, h, flip, alpha, it.kind !== 'boss' || st.boss.alive)
    const top = r ? r.y0 : y - 10 * u
    if (!r) drawPerson(c, x - 4 * u, y - 10 * u, u, 0, 0, it.kind === 'guide' ? GUIDE_LOOK : OWNER_LOOK)
    if (mark) drawMark(c, x, top + (it.kind === 'boss' ? h * 0.12 : 2), mark, t)
    if (alpha > 0.5) npcRects.push({ x0: (r?.x0 ?? x - 5 * u) - 6, y0: top - 26, x1: (r?.x1 ?? x + 5 * u) + 6, y1: y + 4, kind: it.kind, f: it.f, at })
  }
  drawMeTag(c, u)
}

// 같은 동네에 들어온 다른 수리공 이름표(작게)
function drawNameTag(c, x, top, label) {
  c.save()
  c.font = '11px "Galmuri11 Game", Galmuri11, sans-serif'
  const w = c.measureText(label).width + 10
  c.fillStyle = 'rgba(20,24,40,0.78)'
  c.fillRect(Math.round(x - w / 2), Math.round(top - 16), Math.round(w), 15)
  c.fillStyle = '#fff1e8'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(label, x, top - 8)
  c.restore()
}

// 머리 위 말풍선: 사장님은 노란 느낌표, 보스는 빨간 느낌표, 동네 사람은 전구, 길잡이는 얼굴
function drawMark(c, x, top, mark, t) {
  const bob = Math.sin(t * 4 + x) * 2.5
  const y = top - 16 + bob
  const boss = mark === 'boss'
  if (boss) mark = '!'
  c.save()
  c.fillStyle = boss ? '#ff3b4a' : mark === '!' ? '#ffd60a' : '#fff'
  c.strokeStyle = 'rgba(20,20,30,0.85)'
  c.lineWidth = 2
  c.beginPath()
  c.roundRect(x - 11, y - 11, 22, 20, 7)
  c.moveTo(x - 4, y + 9)
  c.lineTo(x, y + 14)
  c.lineTo(x + 4, y + 9)
  c.fill()
  c.stroke()
  c.fillStyle = '#1d1d2b'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.font = mark === '!' ? '900 15px -apple-system, sans-serif' : '13px -apple-system, sans-serif'
  if (boss) c.fillStyle = '#fff'
  c.fillText(mark, x, y - 1)
  c.restore()
}

// 내 가게 지을 빈터: 노란 점선이 천천히 돈다
function drawLot(c, t) {
  const b = story.value?.build
  if (!b || b.done || !b.lot) return
  const T = cam.T
  const x = W / 2 + (b.lot.i0 - cam.i) * T
  const y = H / 2 + (b.lot.k0 - cam.k) * T
  const n = b.lot.n * T
  c.save()
  c.fillStyle = 'rgba(255,214,10,0.14)'
  c.fillRect(x, y, n, n)
  c.setLineDash([6, 4])
  c.lineDashOffset = -t * 14
  c.strokeStyle = '#ffd60a'
  c.lineWidth = 2
  c.strokeRect(x + 1, y + 1, n - 2, n - 2)
  c.restore()
}

const introLeft = () => Math.max(0, 1 - (performance.now() - introAt) / 4200)

function drawMeRing(c, u) {
  const x = sx(player.x)
  const y = sy(player.y) + u * 0.6
  const pulse = (performance.now() / 1000) % 1.4 / 1.4
  c.save()
  c.fillStyle = 'rgba(10,132,255,0.28)'
  c.strokeStyle = '#fff'
  c.lineWidth = 1.5
  c.beginPath()
  c.ellipse(x, y, 5 * u, 2.1 * u, 0, 0, Math.PI * 2)
  c.fill()
  c.stroke()
  // 퍼지는 물결
  c.strokeStyle = `rgba(10,132,255,${0.7 * (1 - pulse)})`
  c.lineWidth = 2
  c.beginPath()
  c.ellipse(x, y, (5 + pulse * 6) * u, (2.1 + pulse * 2.5) * u, 0, 0, Math.PI * 2)
  c.stroke()
  c.restore()
}

// 머리 위 이름표. 시작할 때는 주변을 어둡게 하고 크게 통통 튄다
function drawMeTag(c, u) {
  const x = sx(player.x)
  const head = sy(player.y) - 10 * u - (flying.value ? cam.T * 0.9 : 0)
  const left = introLeft()
  if (left > 0) {
    const r = 11 * u + 40
    const g = c.createRadialGradient(x, head + 5 * u, r * 0.6, x, head + 5 * u, r * 2.4)
    g.addColorStop(0, 'rgba(8,10,20,0)')
    g.addColorStop(1, `rgba(8,10,20,${0.62 * Math.min(1, left * 1.6)})`)
    c.fillStyle = g
    c.fillRect(0, 0, W, H)
  }
  // 시작할 때만 노란 픽셀 표로 '나'. 그 뒤로는 머리 위를 비운다
  if (left <= 0) return
  const label = '나'
  const fs = 15
  c.save()
  c.font = `700 ${fs}px "Galmuri11 Game", Galmuri11, sans-serif`
  const w = c.measureText(label).width + 16
  const h = fs + 9
  const bob = left > 0 ? Math.abs(Math.sin(performance.now() / 180)) * 6 * left : 0
  const top = head - h - 9 - bob
  c.fillStyle = '#ffcf3a'
  c.strokeStyle = '#1b1622'
  c.lineWidth = 3
  c.beginPath()
  c.rect(x - w / 2, top, w, h)
  c.moveTo(x - 5, top + h)
  c.lineTo(x, top + h + 6)
  c.lineTo(x + 5, top + h)
  c.fill()
  c.stroke()
  c.fillStyle = '#ffcf3a'
  c.fillRect(x - 4, top + h - 2, 8, 3)
  c.fillStyle = '#1b1622'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(label, x, top + h / 2 + 0.5)
  c.restore()
}

function drawCars(c) {
  const T = cam.T
  for (const car of traffic.cars) {
    const x = sx(car.x)
    const y = sy(car.y)
    if (!onScreen(x, y, 60) || !traffic.visible(car)) continue
    const L = ((car.bus ? 10 : 4.4) / B) * T
    const Wd = ((car.bus ? 2.5 : 1.9) / B) * T
    c.save()
    c.translate(x, y)
    c.rotate(-car.ang)
    c.fillStyle = 'rgba(20,24,40,0.28)'
    c.fillRect(-L / 2 + 2, -Wd / 2 + 3, L, Wd)
    c.fillStyle = car.bus ? '#3fae4a' : car.color
    c.fillRect(-L / 2, -Wd / 2, L, Wd)
    c.fillStyle = '#2a3442'
    if (car.bus) {
      c.fillRect(L / 2 - L * 0.08, -Wd / 2 + 1, L * 0.06, Wd - 2)
    } else {
      c.fillRect(L * 0.08, -Wd / 2 + 1, L * 0.18, Wd - 2)
      c.fillRect(-L * 0.36, -Wd / 2 + 1, L * 0.12, Wd - 2)
    }
    if (car.taxi) {
      c.fillStyle = '#fff6c0'
      c.fillRect(-L * 0.06, -Wd * 0.18, L * 0.1, Wd * 0.36)
    }
    c.restore()
  }
}

function drawLandmarks(c) {
  landRects = []
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  for (const l of landList) {
    const x = sx(l.x)
    const y = sy(l.y)
    if (!onScreen(x, y)) continue
    const fs = l.small ? 10 : 12
    c.font = `${l.small ? '' : 'bold '}${fs}px Galmuri11`
    const w = Math.max(l.small ? 16 : 30, c.measureText(l.label).width + (l.small ? 8 : 14))
    const h = fs + (l.small ? 6 : 10)
    const bx = x - w / 2
    const by = y - h / 2
    c.fillStyle = 'rgba(20,24,40,0.3)'
    c.beginPath()
    c.roundRect(bx + 1, by + 2, w, h, l.small ? 4 : 6)
    c.fill()
    c.fillStyle = l.color
    c.beginPath()
    c.roundRect(bx, by, w, h, l.small ? 4 : 6)
    c.fill()
    c.strokeStyle = 'rgba(255,255,255,0.9)'
    c.lineWidth = l.small ? 1.5 : 2
    c.stroke()
    c.fillStyle = l.ink || '#fff'
    c.fillText(l.label, x, y + 1)
    landRects.push({ x: bx, y: by, w, h, l })
  }
}

// 간판판: 한 벽에 붙은 간판은 빌딩 간판처럼 층 순서대로 위로 쌓는다.
// 가까운 벽·고친 간판부터 겹치지 않게 자리를 잡고, 자리가 없으면 작은 점으로
const isLit = (p) => litList.some((l) => l.placed === p)
const seenKey = (p) => `${p.sign.name}|${p.sign.cat}`

// 이름판을 띄우는 거리(m)
const NAME_NEAR = 22

function layoutSigns() {
  const T = cam.T
  const fs = Math.round(Math.max(11, Math.min(15, T * 0.7)))
  const k = fs / 12
  const pad = 4
  const h = fs + 6
  const storyOn = story.value && !story.value.done
  const focus = cine || machine.value || onTitle.value ? toWorld(W / 2, H / 2) : [player.x, player.y]
  const hov = hover.value?.placed
  const near = nearSign.value
  const shop = story.value?.shop
  const rank = (p) => (p === hov ? 0 : p === near ? 1 : p === shop ? 2 : isLit(p) ? 3 : 4)
  const cand = []
  for (const g of signGroups) {
    const x = sx(g.x)
    const y = sy(g.y)
    if (!onScreen(x, y, 120)) continue
    let score = Math.hypot(g.x - focus[0], g.y - focus[1])
    const best = Math.min(...g.signs.map(rank))
    // 이름판은 내 둘레 건물과 이야기에 걸린 간판만. 나머지는 띄우지 않는다
    if (best === 4 && score > NAME_NEAR) continue
    if (best < 4) score -= 10 ** (9 - best)
    cand.push({ g, x, y, score })
  }
  cand.sort((a, b) => a.score - b.score)
  const limit = T < 12 ? 50 : T < 16 ? 110 : 200
  const taken = []
  const stacks = []
  const dots = []
  let rows = 0
  const overlaps = (r) => taken.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y)
  for (const it of cand) {
    const { g, x, y } = it
    // 건물마다 이름판 하나: 가장 눈에 띄어야 할 간판 이름 + 나머지 가게 수
    {
      const pick = [[...g.signs].sort((a, b) => rank(a) - rank(b) || b.sign.floor - a.sign.floor)[0]]
      const more = g.signs.length - 1
      const w = pick[0].tw * k + pad * 2 + 8 + (more ? (String(more).length + 1) * 7 * k + 4 : 0)
      const n = 1
      const tot = h
      // 벽에서 바깥쪽으로 띄운다. 기둥 간판은 기둥 위에
      const gap = g.pole ? T * 1.2 : 3
      const ext = Math.abs(g.nx) * (w / 2) + Math.abs(g.nk) * (tot / 2)
      const cx = g.pole ? x : x + g.nx * (ext + gap)
      const cy = g.pole ? y - gap - tot / 2 : y + g.nk * (ext + gap)
      const r = { x: cx - w / 2, y: cy - tot / 2, w, h: tot }
      if (rows + n > limit || overlaps(r)) continue
      taken.push({ x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 })
      rows += n
      stacks.push({ g, x, y, r, cx, cy, ext, pick, more, w, h, fs, k, pad })
    }
  }
  // 밤에 빛 구멍을 낼 자리: 이야기 중에는 불 켠 간판만
  const holes = stacks.filter((s) => !storyOn || s.pick.some(isLit)).map((s) => s.r)
  return { stacks, dots, holes, storyOn }
}

function drawSigns(c, t, { stacks, dots, storyOn }) {
  const hov = hover.value?.placed
  const near = nearSign.value
  const shop = story.value?.shop
  boardRects = []
  moreRects = []
  c.textBaseline = 'middle'
  for (const s of stacks) {
    const { g, x, y, r, cx, cy, ext, pick, more, w, h, fs, k, pad } = s
    // 벽에서 판까지 받침대
    c.strokeStyle = '#4a4d57'
    c.lineWidth = 1.5
    c.beginPath()
    if (g.pole) {
      c.fillStyle = '#6b6f78'
      c.fillRect(x - 1.5, r.y + r.h, 3, y - r.y - r.h)
    } else {
      c.moveTo(x, y)
      c.lineTo(cx - g.nx * ext, cy - g.nk * ext)
      c.stroke()
    }
    // 픽셀 이름판: 남색 판 + 크림 테두리, 왼쪽 네모는 업종 색, 불 켠 간판은 네온
    const p = pick[0]
    const by = r.y
    const lit = storyOn || story.value?.done ? litList.find((l) => l.placed === p) : null
    const off = storyOn && !lit
    const flicker = lit && t - lit.t0 < 0.7 && Math.sin((t - lit.t0) * 47) * Math.sin((t - lit.t0) * 13) < 0
    const focusOn = p === hov || p === near
    const target = p === shop && !story.value?.done
    c.fillStyle = 'rgba(8,10,24,0.45)'
    c.fillRect(Math.round(r.x) + 2, Math.round(by) + 2, Math.round(w), h)
    c.fillStyle = off ? '#1b1f33' : '#141b3a'
    c.fillRect(Math.round(r.x), Math.round(by), Math.round(w), h)
    if (lit && !flicker) {
      c.shadowColor = lit.neon
      c.shadowBlur = 10
    }
    c.strokeStyle = target ? '#ffa300' : focusOn ? '#ffec27' : lit && !flicker ? lit.neon : off ? '#3a3f58' : '#fff1e8'
    c.lineWidth = target || focusOn ? 2 : 1
    c.strokeRect(Math.round(r.x) + 0.5, Math.round(by) + 0.5, Math.round(w) - 1, h - 1)
    c.shadowBlur = 0
    c.fillStyle = off || flicker ? '#3a3f58' : p.color
    c.fillRect(Math.round(r.x) + pad, Math.round(by + h / 2 - 3), 6, 6)
    c.font = `${fs}px Galmuri11`
    c.textAlign = 'left'
    c.fillStyle = off || flicker ? '#6d7290' : '#fff1e8'
    c.fillText(p.sign.name, r.x + pad + 9, by + h / 2 + 1)
    if (more) {
      c.font = `${Math.round(fs * 0.8)}px Galmuri11`
      c.textAlign = 'right'
      c.fillStyle = off ? '#4d5270' : '#ffa300'
      c.fillText(`+${more}`, r.x + w - pad, by + h / 2 + 1)
      moreRects.push({ x: r.x + w - pad - (String(more).length + 1) * 7 * k, y: by, w: (String(more).length + 1) * 7 * k + pad, h, g })
    }
    // 이미 담은 간판은 귀퉁이에 초록 점, 쪽지가 붙은 간판은 노란 쪽지
    if (!storyOn && dexSet.value.has(seenKey(p))) {
      c.fillStyle = '#2fa84f'
      c.fillRect(Math.round(r.x + w) - 3, Math.round(by) - 1, 4, 4)
    }
    if (!storyOn && noteOf(p)) {
      c.fillStyle = '#ffd60a'
      c.fillRect(Math.round(r.x) - 3, Math.round(by) - 3, 7, 6)
    }
    boardRects.push({ x: r.x, y: by, w, h, p })
  }
  for (const { g, x, y } of dots) {
    c.fillStyle = storyOn && !g.signs.some(isLit) ? '#3a3c44' : g.signs[0].color
    c.beginPath()
    c.arc(x + g.nx * 3, y + g.nk * 3, Math.max(2, cam.T * 0.14) + Math.min(3, g.signs.length / 6), 0, Math.PI * 2)
    c.fill()
    c.strokeStyle = 'rgba(29,29,43,0.6)'
    c.lineWidth = 1
    c.stroke()
  }
}

// 이야기: 꺼진 동네는 잿빛, 불 켠 간판 둘레만 색이 돌아온다
function composeStory(t) {
  ctx.drawImage(buf, 0, 0, W, H)
  ctx.save()
  ctx.globalCompositeOperation = 'saturation'
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = 'rgba(10, 12, 24, 0.55)'
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
  const circles = litList.map((l) => [l.x, l.y, l.r || 0.3])
  if (wave) circles.push([wave.x, wave.y, wave.r])
  for (const [x, y, r] of circles) {
    const pr = (r / B) * cam.T
    if (pr < 1) continue
    ctx.save()
    ctx.beginPath()
    ctx.arc(sx(x), sy(y), pr, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(buf, 0, 0, W, H)
    ctx.restore()
  }
  for (const l of litList) {
    const pr = ((l.r || 0) / B) * cam.T
    if (pr < 4) continue
    ctx.strokeStyle = l.neon
    ctx.globalAlpha = 0.35
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(sx(l.x), sy(l.y), pr, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  void t
}

// 밤: 어둠을 깔고 간판·나 둘레에 빛 구멍을 낸 다음 창문 불을 얹는다
function drawNight(level, holes, storyOn) {
  if (level < 0.04) return
  const T = cam.T
  dctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  dctx.globalCompositeOperation = 'source-over'
  dctx.clearRect(0, 0, W, H)
  dctx.fillStyle = `rgba(10, 14, 40, ${0.62 * level})`
  dctx.fillRect(0, 0, W, H)
  dctx.globalCompositeOperation = 'destination-out'
  const hole = (x, y, r, a) => {
    dctx.globalAlpha = a
    dctx.drawImage(glow, x - r, y - r, r * 2, r * 2)
  }
  for (const r of holes) hole(r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h, T * 2.2), 0.75)
  hole(sx(player.x), sy(player.y), T * 4, 0.6)
  for (const car of traffic.cars) {
    if (!traffic.visible(car)) continue
    const x = sx(car.x) + Math.cos(car.ang) * T * 2.4
    const y = sy(car.y) - Math.sin(car.ang) * T * 2.4
    if (onScreen(x, y)) hole(x, y, T * 2.2, 0.5)
  }
  dctx.globalAlpha = 1
  dctx.globalCompositeOperation = 'source-over'
  ctx.drawImage(dark, 0, 0, W, H)
  if (!storyOn) {
    ctx.globalAlpha = Math.min(1, level * 1.1)
    ctx.imageSmoothingEnabled = false
    blit(ctx, lightLayer)
    ctx.globalAlpha = 1
  }
}

function drawWeather(dt) {
  const kind = weatherKind()
  if (kind === 'cloud' || kind === 'rain') {
    ctx.fillStyle = kind === 'rain' ? 'rgba(60, 70, 90, 0.18)' : 'rgba(120, 130, 145, 0.12)'
    ctx.fillRect(0, 0, W, H)
  }
  if (kind !== 'rain' && kind !== 'snow') return
  const want = kind === 'rain' ? 180 : 130
  while (drops.length < want) drops.push({ x: Math.random() * W, y: Math.random() * H, v: 0.6 + Math.random() * 0.6 })
  ctx.strokeStyle = 'rgba(200, 215, 240, 0.55)'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const d of drops) {
    if (kind === 'rain') {
      d.x -= 120 * dt * d.v
      d.y += 620 * dt * d.v
      ctx.moveTo(d.x, d.y)
      ctx.lineTo(d.x + 3, d.y - 12)
    } else {
      d.x += Math.sin(d.y * 0.02) * 20 * dt
      d.y += 60 * dt * d.v
    }
    if (d.y > H + 12) {
      d.y = -12
      d.x = Math.random() * (W + 120)
    }
    if (d.x < -20) d.x += W + 40
  }
  if (kind === 'rain') ctx.stroke()
  else for (const d of drops) ctx.fillRect(d.x, d.y, 2.5 * d.v, 2.5 * d.v)
}

function frame(now) {
  raf = requestAnimationFrame(frame)
  const dt = Math.min(0.05, (now - last) / 1000 || 0)
  last = now
  // 3D 로 들어가 있는 동안은 2D 를 그리지 않는다
  if (!ctx || view3d.value) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  if (!grid || status.value) {
    ctx.fillStyle = '#1d1f2a'
    ctx.fillRect(0, 0, W, H)
    return
  }
  const t = now / 1000
  if (cab) runRide(t)
  if (cine) runCine(t)
  else if (machine.value) fitAll(dt)
  else if (onTitle.value && paused.value) titleCam(t)
  else {
    if (!paused.value || (touch && !dialog.value)) update(dt)
    followCam(dt)
    checkRoam(now)
  }
  skyTimer -= dt
  if (skyTimer <= 0) {
    skyTimer = 1
    updateSky()
  }
  easeSky(dt)
  if (traffic.update(dt, player) && !paused.value && !story.value && now - lastHonk > 4000) {
    lastHonk = now
    sfx.horn()
  }
  people.update(dt, player)
  if (!paused.value) updateGuide(dt)
  updateTown(dt)
  if (litList.length || wave) updateSpread(t)
  if (machine.value) updateMachine(dt)
  boardTimer -= dt
  if (boardTimer <= 0) {
    boardTimer = 0.25
    updateBoard()
    updateMission()
    updateStory()
    autoTalk()
    const n = paused.value || machine.value ? null : nearestSign()
    if (n !== nearSign.value) nearSign.value = n
  }
  const storyDark = story.value && !story.value.done || (story.value?.done && wave && wave.r < 600)
  const target = storyDark ? bctx : ctx
  if (storyDark) bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  drawWorld(target, t)
  if (storyDark) composeStory(t)
  // 간판판은 어둠 위에 또렷하게 그린다
  const signs = machine.value ? null : layoutSigns()
  drawNight(night, signs?.holes || [], signs?.storyOn)
  if (signs) drawSigns(ctx, t, signs)
  if (dusk > 0.05) {
    ctx.fillStyle = `rgba(244, 150, 96, ${dusk * 0.12})`
    ctx.fillRect(0, 0, W, H)
  }
  drawActors(ctx, t)
  if (cab) drawTaxi(ctx, cab.x, cab.y, cab.dir, cab.ang)
  if (fareRun) drawFareGoal(ctx, t)
  drawWeather(dt)
  pickHover()
  miniTimer -= dt
  if (miniTimer <= 0) {
    miniTimer = 0.1
    drawMini()
  }
}

function followCam(dt) {
  const fx = cab?.hide ? cab.x : player.x
  const fy = cab?.hide ? cab.y : player.y
  const ti = fx / B + grid.half
  const tk = -fy / B + grid.half
  const k = Math.min(1, dt * 8)
  cam.i += (ti - cam.i) * k
  cam.k += (tk - cam.k) * k
  cam.T += (zoom - cam.T) * Math.min(1, dt * 10)
  if (Math.abs(zoom - cam.T) < 0.02) cam.T = zoom
}

const fitT = () => Math.min(W, H) / grid.N
function fitAll(dt) {
  const k = Math.min(1, dt * 3)
  cam.i += (grid.half - cam.i) * k
  cam.k += (grid.half - cam.k) * k
  cam.T += (fitT() * 1.05 - cam.T) * k
}

// 타이틀 화면 뒤에서 동네를 천천히 훑는다
function titleCam(t) {
  const r = grid.N * 0.18
  cam.i = grid.half + Math.cos(t * 0.04) * r
  cam.k = grid.half + Math.sin(t * 0.04) * r
  cam.T = 16
}

// 마우스가 가리키는 간판·표지·건물
function pickHover() {
  let seen = null
  if (mouse && !machine.value && !cine) {
    const [mx, my] = mouse
    const b = [...boardRects].reverse().find((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h)
    const l = !b && landRects.find((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h)
    if (b) seen = { placed: b.p, sign: b.p.sign, lit: litList.some((x) => x.placed === b.p) }
    else if (l) seen = { land: l.l.info }
    else {
      const [x, y] = toWorld(mx, my)
      const [i, k] = cellOf(x, y)
      const o = i >= 0 && k >= 0 && i < grid.N && k < grid.N ? grid.owner[k * grid.N + i] : 0
      if (o) seen = { bldg: o, info: bldgInfo(o) }
    }
  }
  if (!seen && nearSign.value && !paused.value) seen = { placed: nearSign.value, sign: nearSign.value.sign, lit: litList.some((x) => x.placed === nearSign.value), near: true }
  const cur = hover.value
  if (cur?.placed !== seen?.placed || cur?.land !== seen?.land || cur?.bldg !== seen?.bldg || cur?.lit !== seen?.lit) hover.value = seen
}

// --- 꺼진 간판의 도시 -------------------------------------------------------------
const unlocked = (n) => n === 0 || cleared.value.includes(CHAPTERS[n - 1].id)

function clearFx() {
  const wasMachine = !!machine.value
  litList = []
  wave = null
  cine = null
  ending.value = false
  traffic?.setZone(null)
  people?.setZone(null)
  story.value = null
  machine.value = null
  dialog.value = null
  chat.value = null
  if (wasMachine && grid) paintMap()
}

// 장 시작: 지하철 카드를 띄운 채 그 동네로 가서, 안내하는 사람을 내 옆에 세운다
let rideTimer = 0
async function startStory(n) {
  const ch = CHAPTERS[n]
  const preset = PRESETS.find((p) => p.id === ch.id)
  clearTimeout(rideTimer)
  ride.value = rideOf(n)
  sfx.whoosh(true)
  const shown = performance.now()
  await goPreset(preset)
  const rideLeft = Math.max(600, 2600 - (performance.now() - shown))
  rideTimer = setTimeout(() => (ride.value = null), rideLeft)
  if (!grid || where.value !== preset.label) return
  setTime(ch.time || 'night', true)
  weatherMode.value = ch.weather
  applyWeather()
  traffic.setZone([])
  people.setZone([])
  const shop = nextShop(player, ch.steps[0].want, [])
  const goal = Math.min(ch.steps.length, signPlaced.length)
  Object.assign(guidePos, freeSpot(player.x + 1.6 * B, player.y + 0.6 * B), { moving: false, dir: 0, step: 0 })
  const folks = placeFolks(ch.folks)
  story.value = { n, ch, step: 0, goal, lit: 0, shop, used: shop ? [shop] : [], done: false, guide: true, ownerAt: shop && ownerSpot(shop), boss: bossOf(ch.steps[0], shop), folks }
  updateStory()
  // 지하철 카드가 걷힌 뒤에 말을 건다
  setTimeout(() => story.value?.ch === ch && say(ch.npc, ch.intro.map((l) => fill(l, vars(null, shop)))), rideLeft + 300)
}

// --- 이야기 속 사람들 ---------------------------------------------------------------
// 길잡이는 내 뒤를 따라오다가, 길잡이 가게 차례면 먼저 가서 기다린다(반응형이 아닌 자리)
const guidePos = { x: 0, y: 0, moving: false, dir: 0, step: 0 }
function updateGuide(dt) {
  const st = story.value
  if (!st || st.done || !st.guide) return
  const own = st.ch.steps[st.step]?.own && st.ownerAt
  const tx = own ? st.ownerAt.x : player.x - Math.sin(DIR_ANG[player.dir]) * 1.8 * B
  const ty = own ? st.ownerAt.y : player.y - Math.cos(DIR_ANG[player.dir]) * 1.8 * B
  const dx = tx - guidePos.x
  const dy = ty - guidePos.y
  const d = Math.hypot(dx, dy)
  if (d > (own ? 70 : 30)) {
    // 너무 멀어지면 화면 밖에서 따라붙는다
    Object.assign(guidePos, own ? st.ownerAt : freeSpot(tx, ty))
    return
  }
  guidePos.moving = d > (own ? 0.3 : 1.2)
  if (!guidePos.moving) return
  const v = Math.min(d, (own ? 13 : Math.max(8, d * 2.4)) * dt)
  guidePos.x += (dx / d) * v
  guidePos.y += (dy / d) * v
  guidePos.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 2 : 3) : dy > 0 ? 1 : 0
  guidePos.step += v * 1.6
}

// 보스는 그 가게 앞길을 막고 선다(가게 사장님 옆)
function bossOf(step, shop) {
  if (!step?.boss || !shop || !BOSSES[step.boss]) return null
  const at = freeSpot(shop.x + (shop.nx * 3.2 + shop.nk * 2) * B, shop.y + (-shop.nk * 3.2 + shop.nx * 2) * B)
  return { id: step.boss, at, alive: true, t0: 0 }
}

// 동네 사람은 꺼진 간판 근처 길가에 흩어져 선다(서로 24m 넘게 떨어지게)
function placeFolks(ids = []) {
  const pool = signPlaced
    .filter((p) => !isLit(p) && !p.sign.mine)
    .map((p) => ({ p, d: Math.hypot(p.x - player.x, p.y - player.y) }))
    .filter((c) => c.d > 25 && c.d < 140)
    .sort(() => Math.random() - 0.5)
  const out = []
  for (const id of ids || []) {
    if (!FOLKS[id]) continue
    const c = pool.find((c) => out.every((f) => Math.hypot(f.at.x - c.p.x, f.at.y - c.p.y) > 24))
    if (!c) break
    out.push({ id, name: FOLKS[id].name, at: freeSpot(c.p.x + c.p.nx * 2.6 * B, c.p.y - c.p.nk * 2.6 * B), done: false })
  }
  return out
}

// 동네 사람에게 말 걸기: 근처 꺼진 간판 이름을 소리 내어 읽으면 그 간판에 불이 들어온다
function talkFolk(f) {
  const st = story.value
  const who = whoOf({ id: f.id, name: f.name, face: '💡' })
  const sign = signPlaced
    .filter((p) => !isLit(p) && p !== st.shop && !p.sign.mine)
    .map((p) => ({ p, d: Math.hypot(p.x - f.at.x, p.y - f.at.y) }))
    .filter((c) => c.d < 40)
    .sort((a, b) => a.d - b.d)[0]?.p
  story.value = { ...st, folks: st.folks.map((o) => (o === f ? { ...o, done: true } : o)) }
  sfx.click()
  if (!sign) return say(who, [fill(FOLK_IDLE[Math.floor(Math.random() * FOLK_IDLE.length)], vars(null, st.shop))])
  const [first, then] = FOLKS[f.id].lines.map((l) => fill(l, { ...vars(null, st.shop), sign: sign.sign.name }))
  say(who, [first], {
    then: () => {
      resume()
      repair(sign)
      speak(who, then)
    },
  })
}

// 보스와 마주치기
function askBoss() {
  const st = story.value
  const b = st?.boss
  if (!b?.alive) return
  const boss = BOSSES[b.id]
  const who = bossWho(b.id)
  sfx.thud()
  say(who, boss.intro.map((l) => fill(l, vars(st.shop, null))), {
    tone: 'boss',
    choices: [
      { label: `${boss.fight} ▶`, fn: () => openQuest(boss.game, { placed: st.shop, who, boss: b.id }) },
      { label: '아직은…', fn: resume },
    ],
  })
}

// 보스를 이기면 흩어지는 모습을 보여 주고, 막혀 있던 가게에 불을 켠다
function beatBoss(q) {
  const st = story.value
  story.value = { ...st, gameDone: true, score: q.score ?? 0, boss: st.boss && { ...st.boss, alive: false, t0: performance.now() / 1000 } }
  sfx.win()
  if (q.boss === 'cloud') {
    weatherMode.value = 'clear'
    applyWeather()
  }
  paused.value = true
  setTimeout(() => {
    if (story.value?.ch !== st.ch) return
    say(q.who, BOSSES[q.boss].win.map((l) => fill(l, vars(q.placed, null))), { tone: 'boss', cut: `${q.boss}-win`, then: () => repair(q.placed) })
  }, 900)
}

// 걸을 수 있는 칸(나는 중이어도 땅 기준)
function cellFree(i, k) {
  const { N, height, ground } = grid
  if (i < 1 || k < 1 || i >= N - 1 || k >= N - 1) return false
  const c = k * N + i
  return !height[c] && ground[c] !== GROUND_ID.water && !treeCells.has(c) && !voxels.has(vkey(i, k))
}

// (x, y) 가까이 서 있을 수 있는 칸 가운데(미터)
function freeSpot(x, y) {
  const [ci, ck] = cellOf(x, y)
  let best = null
  for (let dk = -8; dk <= 8; dk++) {
    for (let di = -8; di <= 8; di++) {
      if (!cellFree(ci + di, ck + dk)) continue
      const d = di * di + dk * dk
      if (!best || d < best.d) best = { d, i: ci + di, k: ck + dk }
    }
  }
  if (!best) return { x, y }
  return { x: (best.i - grid.half + 0.5) * B, y: -(best.k - grid.half + 0.5) * B }
}

// 사장님은 간판 앞 길가에 나와 서 있다
const ownerSpot = (p) => freeSpot(p.x + p.nx * 1.6 * B, p.y - p.nk * 1.6 * B)

function hintOf(st) {
  if (st.build && !st.build.done) return `노란 점선 빈터에 블록 ${BUILD.need}개를 쌓으면 「${st.build.name}」이 문을 열어요`
  if (!st.shop) return '이 동네는 거의 다 켰어요!'
  if (st.boss?.alive) return `「${st.shop.sign.name}」 앞을 ${BOSSES[st.boss.id].name}이(가) 막고 있어. 빨간 ! 앞에서 E`
  const folk = st.folks?.find((f) => !f.done)
  return `화살표를 따라가면 「${st.shop.sign.name}」 사장님이 기다려.${folk ? ' 💡 머리 위에 전구가 뜬 사람은 간판 이름을 읽어 줄 거야' : ''}`
}

// 다음에 갈 가게: 지금 자리에서 30~160m 사이, 아직 꺼진 그 업종 간판. 없으면 가까운 꺼진 아무 간판
function nextShop(from, want, used) {
  const cand = signPlaced
    .filter((p) => !used.includes(p) && !isLit(p))
    .map((p) => ({ p, d: Math.hypot(p.x - from.x, p.y - from.y) }))
    .sort((a, b) => a.d - b.d)
  const far = cand.filter((c) => c.d > 30 && c.d < 160)
  const pick = far.find((c) => want.test(c.p.sign.cat)) || cand.find((c) => c.d > 30 && want.test(c.p.sign.cat) && c.d < 260) || far[0] || cand[0]
  return pick?.p || null
}

const vars = (shop, next, score = '') => ({ shop: shop?.sign.name || '', next: next?.sign.name || '', nextCat: next?.sign.cat || '', me: myName(), score: score ?? '', need: BUILD.need })

function exitStory() {
  clearFx()
  setTime('morning')
  weatherMode.value = 'live'
  applyWeather()
  sfx.click()
}

function say(npc, lines, opts = {}) {
  paused.value = true
  keys.clear()
  walkTo = null
  const w = 'portrait' in npc ? npc : whoOf(npc)
  dialog.value = { who: w.name, face: w.face, portrait: w.portrait || '', tone: w.tone || 'npc', lines, i: 0, ...opts }
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
  resume()
}

let chatTimer = 0
function speak(npc, text) {
  const w = 'portrait' in npc ? npc : whoOf(npc)
  chat.value = { who: w.name, face: w.face, portrait: w.portrait || '', text }
  clearTimeout(chatTimer)
  chatTimer = setTimeout(() => (chat.value = null), 4500)
}

// 네온 색: 파스텔을 더 밝고 진하게
function neonOf(css) {
  return shade(css, 1.12)
}

// 간판 고치기: 판이 지직거리다 켜지고 둘레로 색이 번진다
function repair(placed) {
  const st = story.value
  const isShop = placed === st.shop
  // 부탁 놀이가 붙은 가게는 놀이를 끝내야 불이 들어온다
  const want = isShop ? st.ch.steps[st.step] : null
  if (isShop && st.boss?.alive) return askBoss()
  if (want?.game && want.game !== 'build' && !st.gameDone) return askQuest(placed, want)
  if (litList.some((l) => l.placed === placed) || (litList.length >= MAX_LIT && !isShop)) return collect(placed.sign, false, placed)
  litList.push({ placed, x: placed.x, y: placed.y, R: isShop ? 34 : 20, r: 0, t0: performance.now() / 1000, neon: neonOf(placed.color) })
  sfx.neon(litList.length - 1)
  collect(placed.sign, true, placed)
  toast.value = { neon: placed.sign, n: litList.length, shop: isShop }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 2600)
  const owner = ownerWho(placed.sign)
  if (!isShop) {
    story.value = { ...st, lit: litList.length }
    speak(owner, owner.line)
    return
  }
  // 부탁받은 가게에 불이 들어오면 그 사장님이 본 것을 들려주고 다음 가게를 알려 준다
  const step = st.ch.steps[st.step]
  const last = st.step + 1 >= st.goal
  const shop = last ? null : nextShop(placed, st.ch.steps[st.step + 1].want, st.used)
  story.value = { ...st, lit: litList.length, step: st.step + 1, shop, used: shop ? [...st.used, shop] : st.used, gameDone: false, score: null, ownerAt: shop && ownerSpot(shop), boss: last ? null : bossOf(st.ch.steps[st.step + 1], shop) }
  updateStory()
  if (step.time) setTime(step.time)
  const v = vars(placed, shop, st.score)
  // 놀이 점수가 0 이면(넘어갔거나 못 받았으면) 그에 맞는 말
  const after = st.gameDone ? (Number(st.score) > 0 || !step.afterNone ? step.after : step.afterNone) : null
  const lines = [...(after || []).map((l) => fill(l, v)), ...(step.own ? [] : [owner.line]), ...step.story.map((l) => fill(l, v))]
  // end: 'build' 인 걸음(1장 끝)은 내 가게 짓기
  const end = step.end === 'build' || step.game === 'build' ? startBuild : finishChapter
  setTimeout(() => {
    if (story.value?.ch !== st.ch) return
    chat.value = null
    say(step.own ? st.ch.npc : owner, lines, { then: last ? end : resume })
  }, 700)
}

// --- 부탁 놀이 ---------------------------------------------------------------
function askQuest(placed, step) {
  const st = story.value
  const who = step.own ? whoOf(st.ch.npc) : ownerWho(placed.sign)
  sfx.click()
  say(who, step.ask.map((l) => fill(l, vars(placed, null))), {
    choices: [
      { label: '도와줄게요 ▶', fn: () => openQuest(step.game, { placed, who }) },
      { label: '잠깐만요', fn: resume },
    ],
  })
}

// game: QUESTS 의 이름. opts.placed 가 있으면 끝낸 뒤 그 간판에 불을 켠다, opts.then 이 있으면 그걸 한다
function openQuest(game, opts = {}) {
  const q = QUESTS[game]
  if (!q) return
  paused.value = true
  keys.clear()
  const word = opts.word ?? (game === 'booth' || game === 'map' ? myName() : '')
  const props = { ...(q.mode ? { mode: q.mode } : {}), ...(word ? { word } : {}) }
  if (opts.placed) Object.assign(props, { embed: true })
  // 부탁 놀이: 부탁한 사람 그림·이름과 그 가게 간판을 장면에 세운다
  if (opts.placed && !opts.boss) {
    const w = opts.who || {}
    const ownerArt = w.sprite ? art(`f-${w.sprite}`) : w.id ? art(`c-${w.id}`) || art(`f-${w.id}`) : ''
    Object.assign(props, { ownerName: w.name || '', ownerArt, shopName: opts.placed.sign?.name || '' })
  }
  if (opts.boss) Object.assign(props, { goal: BOSS_GOAL[game] || 10, boss: art(`c-${opts.boss}`), bossName: BOSSES[opts.boss]?.name || '' })
  const next = { game, ...q, props, placed: opts.placed || null, who: opts.who || null, boss: opts.boss || null, then: opts.then || null, done: false, score: null }
  rowWipe(() => (quest.value = next))
}

const BOSS_GOAL = { rain: 12, type: 8, more: 6, map: 5 }

function rowWipe(mid) {
  if (wipe.value) return mid()
  sfx.whoosh(true, { dur: 0.3, to: 'game' })
  wipe.value = 'cover'
  setTimeout(() => {
    mid()
    wipe.value = 'reveal'
    setTimeout(() => (wipe.value = ''), WIPE_MS)
  }, WIPE_MS + 60)
}

function onGameOver(e) {
  const q = quest.value
  const g = e.detail?.game
  if (!q || !g || g !== (q.game === 'atlas' ? 'map' : q.game)) return
  if (q.game === 'open' && e.detail.shop) saveShop({ ...readShop(), real: e.detail.shop })
  // 보스 판은 이겨야 끝난다
  if (q.props.goal && !e.detail.won) return
  const done = { ...q, done: true, score: e.detail.score }
  quest.value = done
  // 이야기 속 놀이는 끝나면 잠깐 결과를 보여 주고 저절로 거리로 돌아간다
  if (q.placed) setTimeout(() => quest.value === done && questBack(), 2200)
}

function questBack(skipped = false) {
  const q = quest.value
  if (!q || wipe.value) return
  rowWipe(() => questAfter(q, skipped))
}

function questAfter(q, skipped) {
  quest.value = null
  if (q.then) return q.then(q)
  if (q.placed && story.value && (q.done || skipped)) {
    if (q.boss) return beatBoss(q)
    story.value = { ...story.value, gameDone: true, score: q.score ?? 0 }
    return repair(q.placed)
  }
  resume()
}

function questQuit() {
  const q = quest.value
  if (!q || wipe.value) return
  rowWipe(() => {
    quest.value = null
    if (q.then) return q.then(q)
    resume()
  })
}

function saveShop(v) {
  myShop.value = v
  try {
    localStorage.setItem(SHOP_KEY, JSON.stringify(v))
  } catch {
    // 저장이 막히면 이번 방문 동안만 남는다
  }
}

// --- 내 가게 짓기 --------------------------------------------------------------
// 간판 이름은 간판 이름 25만 개로만 배운 작은 언어 모델이 지어 준다(브라우저 안에서 계산)
const CAT_WORDS = [
  [/분식|떡볶이|김밥|튀김/, '분식'], [/빵|베이커리|제과/, '빵집'], [/카페|커피|디저트|케이크/, '카페'], [/치킨|닭/, '치킨'], [/세탁|빨래/, '세탁소'],
  [/미용|헤어|네일|뷰티/, '미용실'], [/약국/, '약국'], [/학원|교습|공부/, '학원'], [/노래/, '노래방'], [/꽃/, '꽃집'],
  [/마트|슈퍼|상회|상사|편의/, '슈퍼'], [/식당|밥|국|찌개|고기|갈비|면|반점|횟집|집$/, '식당'], [/술|포차|주점|호프/, '주점'],
]
const catOf = (name) => CAT_WORDS.find(([re]) => re.test(name))?.[1] || '가게'

async function startBuild() {
  const st = story.value
  if (!st) return
  notice.value = '남은 글자들이 이름을 짓는 중…'
  paused.value = true
  await new Promise((r) => setTimeout(r, 30))
  const lm = await loadLM().catch(() => null)
  const names = pickNames(lm)
  notice.value = ''
  if (story.value !== st) return
  say(st.ch.npc, BUILD.pick.map((l) => fill(l, vars(null, null))), {
    choices: [...names.map((n) => ({ label: `「${n}」`, fn: () => chooseName(n) })), { label: '다시 뽑기', fn: startBuild }],
  })
}

function pickNames(lm) {
  const who = myName().replace(/\s+/g, '').slice(0, 6)
  if (!lm) return [`${who}네 가게`, `${who} 상회`, `${who}네 분식`]
  const out = new Set()
  for (let n = 0; n < 9 && out.size < 3; n++) {
    const name = (out.size === 0 ? lm.sample(`${who}네`, 0.8) : lm.sample('', 0.9)).trim()
    const len = [...name].length
    if (len >= 2 && len <= 12 && name !== `${who}네`) out.add(name)
  }
  if (!out.size) out.add(`${who}네 가게`)
  return [...out]
}

function chooseName(name) {
  const st = story.value
  if (!st) return
  const lot = findLot()
  story.value = { ...st, build: { name, cat: catOf(name), lot, count: 0, done: false } }
  checkBuild()
  updateStory()
  say(st.ch.npc, BUILD.start.map((l) => fill(l, { ...vars(null, null), shop: name })), { then: open3D })
}

// 내 옆 10칸 안에서 4×4 가 모두 빈 땅인 자리. 찻길은 덜 고른다
function findLot(n = BUILD.lot) {
  const [pi, pk] = cellOf(player.x, player.y)
  const { N, ground } = grid
  let best = null
  for (let k0 = pk - 12; k0 <= pk + 12; k0++) {
    for (let i0 = pi - 12; i0 <= pi + 12; i0++) {
      if (pi >= i0 && pi < i0 + n && pk >= k0 && pk < k0 + n) continue
      let ok = true
      let road = 0
      for (let k = k0; k < k0 + n && ok; k++) {
        for (let i = i0; i < i0 + n; i++) {
          if (!cellFree(i, k)) {
            ok = false
            break
          }
          if (ground[k * N + i] === GROUND_ID.road) road++
        }
      }
      if (!ok) continue
      const d = (i0 + n / 2 - pi) ** 2 + (k0 + n / 2 - pk) ** 2 + road * 12
      if (!best || d < best.d) best = { d, i0, k0, n }
    }
  }
  if (best) return { i0: best.i0, k0: best.k0, n: best.n }
  return n > 2 ? findLot(n - 1) : null
}

// 빈터 안 블록 수(3D 로 쌓은 기둥은 높이만큼)
function checkBuild() {
  const st = story.value
  const b = st?.build
  if (!b || b.done) return
  let count = 0
  const inLot = (i, k) => !b.lot || (i >= b.lot.i0 && i < b.lot.i0 + b.lot.n && k >= b.lot.k0 && k < b.lot.k0 + b.lot.n)
  for (const key of voxels.keys()) {
    const [i, k] = key.split(',').map(Number)
    if (inLot(i, k)) count += tall.get(key)?.length || 1
  }
  if (count !== b.count) {
    if (count >= BUILD.need && b.count < BUILD.need) sfx.right()
    story.value = { ...st, build: { ...b, count } }
  }
}

// 다 지으면 빈터 앞에 내 간판을 달고 불을 켠다
function finishBuild() {
  const st = story.value
  const b = st?.build
  if (!b || b.done) return
  const lot = b.lot
  const x = lot ? (lot.i0 + lot.n / 2 - grid.half) * B : player.x
  const y = lot ? -(lot.k0 + lot.n - grid.half) * B : player.y
  tctx.font = '12px Galmuri11'
  const sign = { name: b.name, cat: b.cat, floor: 1, mine: true }
  const placed = { sign, x, y, nx: 0, nk: 1, pole: false, tw: tctx.measureText(b.name).width, tag: '', key: null, color: '#ffd60a' }
  signPlaced.push(placed)
  signGroups = groupSigns(signPlaced)
  signCount.value = signPlaced.length
  litList.push({ placed, x, y, R: 44, r: 0, t0: performance.now() / 1000, neon: neonOf(placed.color) })
  sfx.neon(litList.length - 1)
  const cells = [...voxels.keys()].filter((key) => {
    const [i, k] = key.split(',').map(Number)
    return !lot || (i >= lot.i0 && i < lot.i0 + lot.n && k >= lot.k0 && k < lot.k0 + lot.n)
  })
  saveShop({ name: b.name, cat: b.cat, place: where.value, blocks: b.count, cells: cells.length, at: new Date().toISOString() })
  story.value = { ...st, build: { ...b, done: true } }
  updateStory()
  toast.value = { neon: sign, n: litList.length, shop: true, mine: true }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 3200)
  setTimeout(() => {
    if (story.value?.ch !== st.ch) return
    say(st.ch.npc, BUILD.done.map((l) => fill(l, { ...vars(null, null), shop: b.name })), {
      choices: [
        { label: '진짜 지도에도 걸기 ▶', fn: () => openQuest('open', { word: b.name, then: finishChapter }) },
        { label: '이대로 좋아요', fn: finishChapter },
      ],
    })
  }, 900)
}

// --- 3D 로 들어가기 -------------------------------------------------------------
// 같은 동네·같은 자리로 3D 거리를 열고, 나오면 쌓은 블록을 2D 로 가져온다
function open3D() {
  if (!grid || view3d.value || machine.value) return
  paused.value = true
  keys.clear()
  sfx.whoosh(true)
  const cells = []
  for (const [key, type] of voxels) {
    const [i, k] = key.split(',').map(Number)
    const col = tall.get(key)
    if (col) for (const [y, t] of col) cells.push([i, y, k, t])
    else cells.push([i, 0, k, type])
  }
  const b = story.value?.build
  const lot = b && !b.done ? b.lot : null
  view3d.value = { world, label: where.value, cells, at: [player.x, player.y], lot, name: lot ? b.name : '', need: lot ? BUILD.need : 0, night: night > 0.5 }
}

function from3D(cells) {
  view3d.value = null
  if (cells) {
    voxels.clear()
    tall.clear()
    const cols = new Map()
    for (const [i, y, k, t] of cells) {
      const key = vkey(i, k)
      if (!cols.has(key)) cols.set(key, [])
      cols.get(key).push([y, t])
    }
    for (const [key, col] of cols) {
      col.sort((a, b) => a[0] - b[0])
      voxels.set(key, col[col.length - 1][1])
      if (col.length > 1 || col[0][0] !== 0) tall.set(key, col)
    }
    // 내 자리에 블록이 생겼으면 옆 빈칸으로
    if (hits(player.x, player.y) && !flying.value) Object.assign(player, freeSpot(player.x, player.y))
    checkBuild()
  }
  // 3D 에서 다 쌓고 나왔으면 바로 간판을 단다. 모자라면 다시 올라갈지 묻는다
  const b = story.value?.build
  if (b && !b.done) {
    if (b.count >= BUILD.need) return finishBuild()
    if (cells) {
      return say(story.value.ch.npc, BUILD.short, {
        choices: [
          { label: '다시 올라가기 ▶', fn: open3D },
          { label: '여기서 마저 놓기', fn: resume },
        ],
      })
    }
  }
  resume()
}

const ease = (v) => 1 - (1 - v) ** 3

let zoneTimer = 0
function updateSpread(t) {
  for (const l of litList) l.r = l.R * ease(Math.min(1, (t - l.t0) / 1.8))
  if (wave) wave.r = 700 * ease(Math.min(1, (t - wave.t0) / 4.5)) * Math.min(1, (t - wave.t0) / 0.6)
  zoneTimer -= 1 / 60
  if (zoneTimer > 0) return
  zoneTimer = 0.4
  const zone = wave && wave.r > 400 ? null : litList.map((l) => [l.x, l.y, l.r * 0.9])
  if (wave && zone) zone.push([wave.x, wave.y, wave.r])
  traffic.setZone(zone)
  people.setZone(zone)
}

function updateStory() {
  const st = story.value
  if (!st) return
  const b = st.build
  if (b && !b.done && !st.done && !b.lot) {
    storyText.value = `🏗️ ${Math.min(b.count, BUILD.need)} / ${BUILD.need}`
    return
  }
  if (b && !b.done && !st.done) {
    const cx = b.lot ? (b.lot.i0 + b.lot.n / 2 - grid.half) * B : player.x
    const cy = b.lot ? -(b.lot.k0 + b.lot.n / 2 - grid.half) * B : player.y
    storyArrow.value = Math.round((Math.atan2(cx - player.x, cy - player.y) * 180) / Math.PI)
    storyText.value = `🏗️ ${Math.min(b.count, BUILD.need)} / ${BUILD.need}${b.lot ? ` · ${Math.round(Math.hypot(cx - player.x, cy - player.y))}m` : ''}`
    return
  }
  if (st.done || !st.shop) {
    storyText.value = ''
    return
  }
  const dx = st.shop.x - player.x
  const dy = st.shop.y - player.y
  storyArrow.value = Math.round((Math.atan2(dx, dy) * 180) / Math.PI)
  const boss = st.boss?.alive ? `${BOSSES[st.boss.id].face} ${BOSSES[st.boss.id].name}이(가) 막고 있는 ` : `${ownerOf(st.shop.sign).face} `
  storyText.value = `${boss}${st.shop.sign.name} · ${Math.round(Math.hypot(dx, dy))}m`
}

// 장 끝: 동네 전체로 색이 번지고 카메라가 동네 전체를 내려다본다
function finishChapter() {
  const st = story.value
  story.value = { ...st, done: true }
  if (!cleared.value.includes(st.ch.id)) {
    cleared.value = [...cleared.value, st.ch.id]
    saveCleared(cleared.value)
  }
  const t = performance.now() / 1000
  wave = { x: player.x, y: player.y, t0: t }
  if (st.ch.doneTime) setTime(st.ch.doneTime)
  paused.value = true
  keys.clear()
  cine = { t0: t, i: cam.i, k: cam.k, T: cam.T }
  ending.value = true
  setTimeout(() => sfx.dawn(), 600)
  setTimeout(() => {
    if (story.value?.ch !== st.ch) return
    const lastCh = st.n + 1 >= CHAPTERS.length
    const stay = {
      label: '이 동네 더 둘러보기',
      fn: () => {
        cine = null
        ending.value = false
        resume()
      },
    }
    const next = lastCh
      ? { label: '서울 타임머신', fn: () => say({ name: '서울 타임머신', face: '🕰️', portrait: '' }, ENDING, { tone: 'system', then: startMachine }) }
      : { label: `▶ ${CHAPTERS[st.n + 1].title}`, fn: () => startStory(st.n + 1) }
    say(st.ch.npc, st.ch.done.map((l) => fill(l, vars(null, null))), { choices: [next, stay] })
  }, 5200)
}

function runCine(t) {
  const k = ease(Math.min(1, (t - cine.t0) / 4))
  cam.i = cine.i + (grid.half - cine.i) * k * 0.6
  cam.k = cine.k + (grid.half - cine.k) * k * 0.6
  cam.T = cine.T + (fitT() * 1.6 - cine.T) * k
}

// --- 서울 타임머신 -----------------------------------------------------------------
function startMachine() {
  if (!grid) return
  const known = world.b.map(([h, name, , , floors, use, year]) => ({ h, name, floors, use, year })).filter((b) => b.year)
  if (!known.length) {
    notice.value = '이 지도에는 건물 사용승인 연도 자료가 없어요'
    paused.value = true
    menu.value = true
    return
  }
  clearFx()
  machineList = known.sort((a, b) => a.year - b.year)
  const min = Math.max(1900, machineList[0].year - 2)
  paused.value = true
  keys.clear()
  setTime('day', true)
  weatherMode.value = 'clear'
  applyWeather()
  machine.value = { min, max: 2026, year: min, playing: true, count: 0, total: world.b.length, unknown: world.b.length - machineList.length, recent: [] }
  machineYear = min
  lastTick = min
  paintMap(min)
  sfx.click()
}

let machineYear = 0
let lastTick = 0
function updateMachine(dt) {
  const m = machine.value
  if (m.playing) {
    machineYear = Math.min(m.max + 0.99, machineYear + ((m.max - m.min) / 22) * dt)
    if (machineYear >= m.max + 0.99) setMachine({ playing: false })
  }
  const y = Math.floor(machineYear)
  if (y === m.year && m.count) return
  const built = machineList.filter((b) => b.year <= y)
  const fresh = built.filter((b) => b.year > y - 3 && (b.name || b.use)).sort((a, b) => b.h - a.h)
  if (y > lastTick && built.some((b) => b.year === y)) sfx.build(y % 5)
  lastTick = y
  paintMap(y)
  machine.value = { ...machine.value, year: y, count: built.length, recent: fresh.slice(0, 3) }
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
  setTime('morning', true)
  weatherMode.value = 'live'
  applyWeather()
  paused.value = true
  menu.value = true
  sfx.click()
}

// --- 가까운 역·정류장 도착 정보 ----------------------------------------------
const secText = (sec) => (sec <= 0 ? '곧 도착' : sec < 60 ? `${sec}초 후` : `${Math.floor(sec / 60)}분 ${sec % 60 ? `${sec % 60}초 ` : ''}후`)
let busBusy = false
let busFor = ''

function updateBoard() {
  landList = landmarks()
  const x = player.x
  const y = player.y
  const subway = city.value?.subway || []
  const stationNear = subway.length && [...(world.st || []), ...(world.ex || []).map((e) => [e[3], e[1], e[2]])].some((s) => Math.hypot(s[1] - x, s[2] - y) < 45)
  if (stationNear) {
    const gone = Math.floor((Date.now() - cityAt) / 1000)
    const rows = []
    for (const [name, , , list] of subway) {
      for (const [line, route, sec, msg, info] of list.slice(0, 8)) {
        const left = sec ? sec - gone : null
        rows.push([line, route, left === null ? info || msg : secText(Math.max(0, left)), name])
        if (left !== null && left <= 0 && left > -30 && Date.now() - lastBurst > 20000) burstAtExit()
      }
    }
    board.value = { kind: 'subway', title: `${subway.map((s) => s[0]).join(' · ')}역 도착 정보`, rows: rows.slice(0, 8), note: '서울 실시간 도시데이터' }
    return
  }
  const stop = (world.bus || []).map(([name, bx, by]) => ({ name, bx, by, d: Math.hypot(bx - x, by - y) })).sort((a, b) => a.d - b.d)[0]
  if (stop && stop.d < 18) {
    const key = stop.name
    if (busFor !== key && !busBusy) {
      busBusy = true
      busFor = key
      const lngV = world.lng + stop.bx / (111320 * Math.cos((world.lat * Math.PI) / 180))
      const latV = world.lat + stop.by / 110540
      board.value = { kind: 'bus', title: `${stop.name}`, rows: [], note: '도착 정보를 받는 중…' }
      busArrivals(lngV, latV)
        .then((data) => {
          if (busFor !== key) return
          const rows = (data.buses || []).slice(0, 8).map(([no, a1, , dir]) => [no, dir ? `${dir} 방면` : '', a1, ''])
          board.value = { kind: 'bus', title: `${data.stop?.name || stop.name}`, rows, note: rows.length ? '서울시 버스도착정보' : '지금 도착 예정 버스가 없어요' }
        })
        .catch(() => {
          if (busFor === key) board.value = { kind: 'bus', title: `${stop.name}`, rows: [], note: '도착 정보를 못 받았어요' }
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
  const exit = (world.ex || []).map((e) => ({ e, d: Math.hypot(e[1] - player.x, e[2] - player.y) })).sort((a, b) => a.d - b.d)[0]
  if (exit && exit.d < 150) people.burst(exit.e[1], exit.e[2], 12)
}

// --- 길 찾기 미션 ---------------------------------------------------------------
function startMission() {
  const goals = [
    ...(world.ex || []).map(([ref, gx, gy, desc]) => [`${(desc || world.st?.[0]?.[0] || '지하철').replace(/역$/, '')}역 ${ref ? `${ref}번 ` : ''}출구`, gx, gy]),
    ...(world.bus || []).map(([name, gx, gy]) => [`${name} 버스 정류장`, gx, gy]),
    ...(world.bk || []).map(([name, gx, gy]) => [`따릉이 ${name}`, gx, gy]),
  ].filter(([, gx, gy]) => Math.hypot(gx - player.x, gy - player.y) > 50)
  sfx.click()
  if (!goals.length) {
    notice.value = '여기에는 찾아갈 출구·정류장이 없어요'
    return
  }
  const [title, gx, gy] = goals[(Math.random() * goals.length) | 0]
  mission.value = { title, x: gx, y: gy, start: performance.now() }
  notice.value = ''
  updateMission()
  resume()
}

function updateMission() {
  const m = mission.value
  if (!m) return
  const dx = m.x - player.x
  const dy = m.y - player.y
  const d = Math.hypot(dx, dy)
  missionArrow.value = Math.round((Math.atan2(dx, dy) * 180) / Math.PI)
  missionText.value = `${m.title} · ${Math.round(d)}m`
  if (d < 6) {
    const sec = Math.round((performance.now() - m.start) / 1000)
    mission.value = null
    sfx.win()
    toast.value = { mission: { title: m.title, time: sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초` } }
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => (toast.value = null), 4000)
  }
}

// --- 같은 동네 사람들 ------------------------------------------------------------
// 같은 지도(같은 원점)를 연 사람끼리 한 방. 보이는 사람만 그린다
let myLook = readLook()
let town = null
let townKey = ''
let townView = []
let townTimer = 0
function updateTown(dt) {
  townTimer -= dt
  if (townTimer <= 0) {
    townTimer = 1
    const key = grid && !machine.value && !status.value ? `${lat.toFixed(4)}_${lng.toFixed(4)}` : ''
    if (key !== townKey) {
      town?.leave()
      town = null
      townView = []
      townKey = key
      if (key) {
        try {
          town = joinTown({ town: key, look: myLook, name: myName() })
        } catch {
          town = null
        }
      }
    }
  }
  if (!town) return
  if (!paused.value || touch) town.send(player.x, player.y, player.dir, player.moving ? 1 : 0)
  town.step(dt)
  const [x0, y0] = toWorld(0, 0)
  const [x1, y1] = toWorld(W, H)
  townView = town.visible({ x0, y0, x1, y1 }, 8)
}

function onLook(e) {
  myLook = e.detail || readLook()
  town?.setLook(myLook)
}

// --- 건물 안 ---------------------------------------------------------------------
// 간판이 넷 이상 붙은 벽은 건물 안으로 들어가 계단·엘리베이터로 층을 오르내리며 찾는다
function enterBuilding(g, target = null) {
  if (!g?.signs.length) return
  const storyOn = story.value && !story.value.done
  const floors = g.signs.map((p) => p.sign.floor || 1)
  const top = Math.max(2, Math.min(25, Math.max(...floors)))
  const base = Math.max(0, Math.min(3, -Math.min(0, ...floors)))
  const signs = g.signs.map((p, i) => ({ id: i, name: p.sign.name, cat: p.sign.cat, floor: p.sign.floor || 1, color: p.color, lit: storyOn ? isLit(p) : dexSet.value.has(seenKey(p)) }))
  const own = g.signs.find((p) => p.sign.name && p.sign.floor > 0)
  paused.value = true
  keys.clear()
  walkTo = null
  sfx.whoosh(true)
  inside.value = {
    group: g,
    building: { name: own ? `「${own.sign.name}」 있는 건물` : '간판 건물', floors: top, basement: base },
    signs,
    target: target ? g.signs.indexOf(target) : null,
  }
}

function insidePick(id) {
  const g = inside.value?.group
  const p = g?.signs[id]
  inside.value = null
  if (!p) return resume()
  paused.value = false
  useSign(p)
}

function insideExit() {
  inside.value = null
  sfx.whoosh(false)
  resume()
}

// --- 사람 누르기 -------------------------------------------------------------------
// 가까우면 바로 말을 걸고, 멀면 그 앞까지 걸어간 다음 말을 건다
function clickNpc(r) {
  const d = Math.hypot(r.at.x - player.x, r.at.y - player.y)
  const talk = () => {
    if (r.kind === 'folk') return talkFolk(r.f)
    if (r.kind === 'boss') return askBoss()
    if (r.kind === 'owner') return interactOwner()
    return speak(story.value.ch.npc, hintOf(story.value))
  }
  if (d < (r.kind === 'boss' ? 3.2 : 2.6)) return talk()
  sfx.tick()
  const back = freeSpot(r.at.x + (player.x - r.at.x) * (1.6 / d), r.at.y + (player.y - r.at.y) * (1.6 / d))
  walkTo = { x: back.x, y: back.y, r: r.kind === 'boss' ? 2.6 : 2, best: Infinity, stall: 0, then: () => story.value && !story.value.done && talk() }
}

function interactOwner() {
  const st = story.value
  if (!st?.shop) return
  if (st.boss?.alive) return say(ownerWho(st.shop.sign), SCARED.map((l) => fill(l, vars(st.shop, null))))
  useSign(st.shop)
}

// --- 바탕화면 위젯에 이야기 진행을 알린다 -----------------------------------------------
watch([story, timeMode], ([st, tm]) => {
  if (!st) return
  const step = st.ch.steps[st.step]
  const now = {
    chapter: st.ch.title,
    n: st.n,
    next: st.done ? '' : st.boss?.alive ? `${BOSSES[st.boss.id].name} 물리치기` : st.build && !st.build.done ? `「${st.build.name}」 짓기` : st.shop ? `「${st.shop.sign.name}」 불 켜기` : '',
    lit: st.lit,
    goal: Math.max(12, st.lit),
    step: st.step,
    steps: st.goal,
    time: COARSE_TIME[tm] || 'night',
    boss: st.boss?.alive ? BOSSES[st.boss.id].name : '',
    own: !!step?.own,
    done: !!st.done,
  }
  try {
    localStorage.setItem('gp-story-now', JSON.stringify(now))
  } catch {
    // 저장이 막히면 위젯만 못 본다
  }
  window.dispatchEvent(new CustomEvent('story:progress', { detail: now }))
})

// --- 입력 ---------------------------------------------------------------------
function resume() {
  if (!ready.value) return
  if (onTitle.value) introAt = performance.now()
  sfx.click()
  menu.value = false
  paused.value = false
}

function pause() {
  paused.value = true
  menu.value = true
  keys.clear()
  sfx.whoosh(false)
}

// 단계 하나씩: +1 가까이, -1 멀리
function stepZoom(d) {
  const n = ZOOMS.reduce((m, z, i) => (Math.abs(z - zoom) < Math.abs(ZOOMS[m] - zoom) ? i : m), 0)
  zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, n + d))]
}

function setZoom(z) {
  zoom = ZOOMS.reduce((m, v) => (Math.abs(v - z) < Math.abs(m - z) ? v : m), ZOOMS[0])
}

// 메뉴에선 마우스로 고른 단추와 ↑↓ 로 고른 단추가 같도록 올린 단추에 포커스를 준다
function menuHover(e) {
  e.target.closest?.('.mc-btn:not(:disabled)')?.focus({ preventScroll: true })
}
// 장 고르기·조작법에서 뒤로 나오면 Vue 가 '뒤로' 단추를 다른 단추로 재사용해 포커스가 엉뚱한 곳에 남으므로 첫 단추로 돌린다
watch(panel, (v, old) => {
  if (!v && old) nextTick(() => box.value?.querySelector('.scrim.mc .mc-btn')?.focus({ preventScroll: true }))
})

function onKeyDown(e) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  // 부탁 놀이 창과 3D 는 자기 키를 쓴다
  if (quest.value || view3d.value) return
  // 대화창은 자기 키(Enter·Space·↑↓)를 쓴다
  if (dialog.value || inside.value) return
  if (machine.value && e.code === 'Escape') return endMachine()
  if (paused.value && e.code === 'Escape') {
    if (panel.value) panel.value = null
    else if (!onTitle.value && !dialog.value && ready.value) resume()
    return
  }
  if (paused.value) {
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'KeyW' || e.code === 'KeyS') {
      e.preventDefault()
      const bs = [...(box.value?.querySelectorAll('.scrim.mc button:not(:disabled)') || [])]
      if (!bs.length) return
      const i = bs.indexOf(document.activeElement)
      const down = e.code === 'ArrowDown' || e.code === 'KeyS'
      bs[i < 0 ? 0 : (i + (down ? 1 : bs.length - 1)) % bs.length].focus()
      sfx.tick()
    }
    return
  }
  if (e.code === 'Escape') return pause()
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault()
  keys.add(e.code)
  if (e.repeat) return
  if (cab) {
    if (e.code === 'KeyT') hailTaxi()
    return
  }
  if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') interact()
  if (e.code === 'KeyQ') placeBlock()
  if (e.code === 'KeyX') breakBlock()
  if (/^Digit[1-5]$/.test(e.code)) slot.value = Number(e.code.slice(5)) - 1
  if (e.code === 'KeyF') toggleFly()
  if (e.code === 'KeyT') hailTaxi()
  // 방금 담은 간판 알림이 떠 있으면 그 간판에, 아니면 가까운 간판에 쪽지
  if (e.code === 'KeyN' && !(story.value && !story.value.done)) openNote(toast.value?.placed || nearSign.value)
  if (e.code === 'KeyM') openQuest('atlas')
  if (e.code === 'Equal' || e.code === 'NumpadAdd') stepZoom(1)
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') stepZoom(-1)
}

function onKeyUp(e) {
  keys.delete(e.code)
}

function onWheel(e) {
  if (paused.value || machine.value) return
  e.preventDefault()
  // 트랙패드처럼 잘게 오는 휠은 모아서 한 단계씩
  wheelAcc += e.deltaY
  if (Math.abs(wheelAcc) < 60) return
  stepZoom(wheelAcc > 0 ? -1 : 1)
  wheelAcc = 0
}

function toggleFly() {
  flying.value = !flying.value
  // 지붕 위에서 내리면 가장 가까운 길로
  if (!flying.value && hits(player.x, player.y)) {
    flying.value = true
    notice.value = '건물 위에서는 내릴 수 없어요'
    setTimeout(() => (notice.value = ''), 2000)
    return
  }
  sfx.click()
}

// 이야기가 정한 때로 바꾼다. snap 이면 바로(장 시작·타임머신), 아니면 천천히
function setTime(id, snap = false) {
  if (!STORY_TIMES[id]) return
  timeMode.value = id
  if (grid) updateSky()
  if (snap) easeSky(0, true)
}

// 누르기: 간판판이면 담기·고치기, 표지면 정보, 가까운 칸이면 블록 놓기(오른쪽)·부수기(왼쪽)
function onPointerDown(e) {
  if (!grid || status.value || dialog.value || machine.value) return
  const rect = cv.value.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  mouse = [mx, my]
  if (paused.value) return
  const n = e.button === 0 && [...npcRects].reverse().find((r) => mx >= r.x0 && mx <= r.x1 && my >= r.y0 && my <= r.y1)
  if (n) return clickNpc(n)
  const more = e.button === 0 && moreRects.find((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h)
  if (more) return enterBuilding(more.g, story.value && !story.value.done && more.g.signs.includes(story.value.shop) ? story.value.shop : null)
  const b = [...boardRects].reverse().find((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h)
  if (b && e.button === 0) return useSign(b.p)
  const l = landRects.find((r) => mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h)
  if (l && e.button === 0) return showLand(l.l.info)
  const [x, y] = toWorld(mx, my)
  if (Math.hypot(x - player.x, y - player.y) > BLOCK_REACH) return
  const cell = cellOf(x, y)
  if (e.button === 2 || (e.button === 0 && !voxels.has(vkey(...cell)) && touch)) placeBlock(cell)
  else if (e.button === 0) breakBlock(cell)
}

function onPointerMove(e) {
  if (e.pointerType !== 'mouse') return
  const rect = cv.value.getBoundingClientRect()
  mouse = [e.clientX - rect.left, e.clientY - rect.top]
}

function hold(code, on) {
  on ? keys.add(code) : keys.delete(code)
}

function close() {
  sfx.click()
  emit('close')
}

function unfull() {
  sfx.click()
  emit('unfull')
}

function openPanel(id) {
  sfx.click()
  panel.value = id
}

function toTitle() {
  sfx.click()
  panel.value = null
  onTitle.value = true
}

function menuStory(n) {
  onTitle.value = false
  startStory(n)
}

// 타이틀 첫 버튼: 하던 장이 있으면 이어서, 아니면 아직 못 깬 첫 장(다 깼으면 처음부터)
function playStory() {
  if (story.value && !story.value.done) return resume()
  menuStory(Math.max(0, nextCh.value))
}

function menuMachine() {
  onTitle.value = false
  startMachine()
}

function menuMission() {
  startMission()
}

function resize() {
  const el = box.value
  if (!el) return
  dpr = Math.min(2, window.devicePixelRatio || 1)
  W = el.clientWidth
  H = el.clientHeight
  for (const c of [cv.value, buf, dark]) {
    c.width = Math.round(W * dpr)
    c.height = Math.round(H * dpr)
  }
}

let observer
onMounted(() => {
  ctx = cv.value.getContext('2d')
  buf = document.createElement('canvas')
  bctx = buf.getContext('2d')
  dark = document.createElement('canvas')
  dctx = dark.getContext('2d')
  glow = glowSprite()
  resize()
  observer = new ResizeObserver(resize)
  observer.observe(box.value)
  const el = cv.value
  el.addEventListener('contextmenu', (e) => e.preventDefault())
  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerleave', () => (mouse = null))
  el.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('arcade:player', onPlayer)
  window.addEventListener('game:over', onGameOver)
  window.addEventListener('look:change', onLook)
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', flushShared)
  raf = requestAnimationFrame(frame)
  if (import.meta.env.DEV) window.__street2d = { player, cam, flying, signs: () => signPlaced, traffic: () => traffic, people: () => people, city, board, mission, setWeather, setTime, startMission, story, dialog, machine, startStory, startMachine, repair, nextLine, askBoss, enterBuilding, inside, guidePos, npcRects: () => npcRects, town: () => town, resume, setZoom, goPreset, shared, flushShared, nearSign, quest, openQuest, questBack, open3D, from3D, view3d, chooseName, finishBuild, startBuild, voxels, tall, placeBlock, hailTaxi, cab: () => cab, startFare, fare, fareRun: () => fareRun }
  // 이야기는 늘 서울과기대(공릉)에서 시작한다
  goPreset(PRESETS[0])
  if (props.play) playFromOutside()
})

// 이미 열린 창에서 다른 퀘스트를 고르면 하던 것을 접고 그것을 띄운다
watch(() => props.play, (g) => g && playFromOutside())
// 인트로 시작 화면에서 고른 것: 게임 시작은 바로 이야기로, 나머지는 타이틀의 그 패널을 연다
let begun = 0
watch(() => [props.beginAt, ready.value], ([at, ok]) => {
  if (!at || !ok || at === begun || props.play) return
  begun = at
  if (props.begin === 'play') playStory()
  else if (props.begin === 'story' || props.begin === 'keys') (onTitle.value = true), (panel.value = props.begin)
})
function playFromOutside() {
  if (!QUESTS[props.play] || quest.value?.game === props.play) return
  view3d.value = null
  openQuest(props.play)
}

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  clearTimeout(toastTimer)
  clearTimeout(chatTimer)
  clearInterval(cityTimer)
  clearInterval(weatherTimer)
  liveSeq++
  hereSeq++
  observer?.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('arcade:player', onPlayer)
  window.removeEventListener('game:over', onGameOver)
  window.removeEventListener('look:change', onLook)
  town?.leave()
  town = null
  clearTimeout(rideTimer)
  document.removeEventListener('visibilitychange', onHide)
  window.removeEventListener('pagehide', flushShared)
  clearInterval(flushTimer)
  flushShared()
  groundLayer = bldgLayer = lightLayer = null
})
</script>

<template>
  <div class="world" :class="{ windowed }">

    <div ref="box" class="stage">
      <canvas ref="cv"></canvas>
      <div v-if="ready && !titleShown && !machine" class="hud">
        <span v-if="!story" class="hud-main"><b>{{ spot || where }}</b><i></i>도감 {{ dex.length.toLocaleString() }}</span>
        <span v-if="roamState === 'loading'" class="hud-note">옆 동네 이어 붙이는 중…</span>
        <span v-else-if="roamState === 'failed'" class="hud-note">옆 동네를 못 받았어요 · 잠시 뒤 다시 시도</span>
        <span v-else-if="flying" class="hud-note">지붕 위를 나는 중 · F 로 내려오기</span>
      </div>
      <div v-if="ready && mission" class="goal">
        <span class="arrow" :style="{ transform: `rotate(${missionArrow}deg)` }">▲</span>
        <Target class="ic" />{{ missionText }}
      </div>
      <div v-if="ready && fare" class="goal fare" :class="{ hurry: fare.hurry }">
        <span class="meter">{{ fare.won.toLocaleString() }}원</span>「{{ fare.name }}」 · {{ fare.left }}초<small>T 내려 주기</small>
      </div>
      <div v-if="ready && story" class="story-bar">
        <b>{{ story.ch.title.split(' · ')[0] }}</b>
        <span class="pips"><i v-for="k in story.goal" :key="k" :class="{ on: k <= story.step }"></i></span>
        <span class="bulbs lit"><Lightbulb class="ic" />{{ story.lit }}</span>
      </div>
      <div v-if="ready && story && storyText" class="goal story-goal">
        <span class="arrow" :style="{ transform: `rotate(${storyArrow}deg)` }">▲</span>
        {{ storyText }}
        <template v-if="story.build && !story.build.done && !paused">
          <button v-if="story.build.count >= BUILD.need" class="goal-btn primary" @click="finishBuild">간판 달기 ▶</button>
        </template>
      </div>

      <p v-if="ready && hover?.sign && (!paused || touch)" class="aim">
        <b>{{ hover.sign.name }}</b>
        <small v-if="story && !story.done"><component :is="hover.lit ? Lightbulb : Wrench" class="ic" />{{ hover.lit ? '켜짐' : touch ? '눌러서 켜기' : hover.near ? 'E 켜기' : '클릭 켜기' }}</small>
        <small v-else>{{ dexSet.has(`${hover.sign.name}|${hover.sign.cat}`) ? '담음' : touch ? '눌러서 담기' : hover.near ? 'E 담기' : '클릭 담기' }}</small>
      </p>
      <p v-else-if="ready && hover?.land && (!paused || touch)" class="aim">
        <b>{{ hover.land.title }}</b>
      </p>
      <p v-else-if="ready && hover?.info && (!paused || touch)" class="aim">
        <Building2 class="ic" /><b>{{ hover.info.title }}</b>
      </p>

      <div v-if="ready && board && !titleShown && !machine" class="board window">
        <div class="title-bar"><div class="title-bar-text"><component :is="board.kind === 'bus' ? Bus : TrainFront" class="ic" />{{ board.title }}</div></div>
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

      <div v-if="ready && !titleShown" class="mini" aria-hidden="true">
        <canvas ref="mini" width="150" height="150"></canvas>
        <div v-if="lineBadges.length" class="lines">
          <span v-for="[name, color] in lineBadges" :key="name" :style="{ background: color }">{{ name }}</span>
        </div>
      </div>

      <div v-if="toast?.neon" class="toast window neon">
        <div class="window-body">
          <b><Lightbulb class="ic" />{{ toast.neon.name }}</b>
        </div>
      </div>
      <div v-else-if="toast?.mission" class="toast window">
        <div class="window-body">
          <b><Target class="ic" />{{ toast.mission.title }}</b>
          <p>{{ toast.mission.time }}</p>
        </div>
      </div>
      <div v-else-if="toast?.land" class="toast window">
        <div class="window-body">
          <b><component :is="LAND[toast.land.kind]?.[0] || Signpost" class="ic" />{{ toast.land.title }}</b>
        </div>
      </div>
      <div v-else-if="toast" class="toast window">
        <div class="window-body">
          <b><BookMarked class="ic" />{{ toast.name }}</b>
          <p v-if="toast.fresh">도감 +1</p>
          <button v-if="toast.placed?.key" class="note-btn" @click="openNote(toast.placed)"><MessageCircle class="ic" />쪽지{{ touch ? '' : ' N' }}</button>
        </div>
      </div>

      <form v-if="noteFor" class="note-box window" @submit.prevent="sendNote" @keydown.esc="noteFor = null">
        <div class="title-bar"><div class="title-bar-text"><MessageCircle class="ic" />{{ noteFor.sign.name }}에 쪽지</div></div>
        <div class="window-body">
          <p class="hint">간판마다 마지막 한 장만 남아요. 지나가는 사람이 모두 봐요</p>
          <input v-if="!me" v-model="noteName" maxlength="10" placeholder="닉네임 (2~10자)" aria-label="닉네임" />
          <input v-if="!me" v-model="notePass" type="password" maxlength="32" placeholder="암호 (4자 이상)" aria-label="암호" autocomplete="current-password" />
          <input v-model="noteText" maxlength="30" placeholder="한 줄 (30자까지)" aria-label="쪽지" autofocus />
          <p v-if="noteErr" class="err">{{ noteErr }}</p>
          <div class="row">
            <button type="button" @click="noteFor = null">닫기</button>
            <button type="submit" :disabled="noteBusy || (!me && (noteName.trim().length < 2 || notePass.length < 4))">{{ me ? '붙이기' : '등록하고 붙이기' }}</button>
          </div>
        </div>
      </form>

      <div v-if="chat" class="chat px-pop">
        <span class="chat-face"><img v-if="chat.portrait" :src="chat.portrait" alt="" /><template v-else>{{ chat.face }}</template></span>
        <p><b>{{ chat.who }}</b>{{ chat.text }}</p>
      </div>

      <Cutscene v-if="dialog?.cut && /^\(/.test(dialog.lines[dialog.i] || '')" :id="dialog.cut" />
      <RpgDialog
        v-if="dialog"
        :key="`${dialog.who}-${dialog.i}-${dialog.lines.length}`"
        :who="dialog.who"
        :face="dialog.face"
        :portrait="dialog.portrait"
        :tone="dialog.tone"
        :text="dialog.lines[dialog.i]"
        :choices="(dialog.i === dialog.lines.length - 1 && dialog.choices) || []"
        @next="nextLine()"
        @choose="(n) => nextLine(dialog.choices[n])"
      />

      <div v-if="inside" class="inside-wrap">
        <Inside :building="inside.building" :signs="inside.signs" :look="myLook" :target="inside.target" :night="night > 0.5" @pick="insidePick" @exit="insideExit" />
      </div>

      <template v-if="ready && machine">
        <div class="year" aria-live="polite">
          <b>{{ machine.year }}</b>년
          <small v-if="machine.recent.length">{{ machine.recent.map((b) => `${b.name || b.use} (${b.year})`).join(' · ') }}</small>
        </div>
        <div class="machine window">
          <div class="title-bar"><div class="title-bar-text"><History class="ic" />서울 타임머신 — {{ where }}</div></div>
          <div class="window-body">
            <div class="row">
              <button @click="playMachine">{{ machine.playing ? '⏸' : '▶' }}</button>
              <input type="range" :min="machine.min" :max="machine.max" step="1" :value="machine.year" @input="scrubMachine" />
              <button @click="endMachine">나가기</button>
            </div>
            <p>건물 {{ machine.count.toLocaleString() }}채가 섰어요 · 사용승인 연도 순서 <span v-if="machine.unknown">· 연도를 모르는 {{ machine.unknown }}채는 점선으로 보여요</span></p>
          </div>
        </div>
      </template>

      <div v-if="ready && !machine && !titleShown && !dialog && !quest && (!story || story.build)" class="hotbar">
        <button v-for="(b, i) in blocks" :key="b.id" :class="{ on: slot === i }" :title="b.label" @click="slot = i">
          <img :src="b.icon" alt="" width="32" height="32" />
          <span>{{ i + 1 }}</span>
        </button>
      </div>

      <template v-if="ready && touch && !paused && !machine && !dialog && !quest">
        <div class="pad">
          <button class="up" @pointerdown="hold('touch-up', true)" @pointerup="hold('touch-up', false)" @pointerleave="hold('touch-up', false)">▲</button>
          <button class="left" @pointerdown="hold('touch-left', true)" @pointerup="hold('touch-left', false)" @pointerleave="hold('touch-left', false)">◀</button>
          <button class="down" @pointerdown="hold('touch-down', true)" @pointerup="hold('touch-down', false)" @pointerleave="hold('touch-down', false)">▼</button>
          <button class="right" @pointerdown="hold('touch-right', true)" @pointerup="hold('touch-right', false)" @pointerleave="hold('touch-right', false)">▶</button>
        </div>
        <div class="acts">
          <button @click="interact">{{ story && !story.done ? '말걸기' : '담기' }}</button>
          <button @click="placeBlock()">놓기</button>
          <button @click="hailTaxi">택시</button>
          <button @click="pause">메뉴</button>
        </div>
      </template>

      <div v-if="quest && quest.placed" class="stage" :class="{ boss: quest.boss }" @pointerdown.stop>
        <header class="stage-bar">
          <img v-if="quest.who?.portrait" class="stage-face" :src="quest.who.portrait" alt="" />
          <span class="stage-who">{{ quest.boss ? `VS ${quest.who.name}` : `${quest.who?.name || ''}의 부탁` }}</span>
          <b>{{ quest.title }}</b>
          <span class="stage-state" :class="{ ok: quest.done }">{{ quest.done ? (quest.boss ? '이겼다!' : '해냈다!') : quest.boss ? '이기면 길이 열린다' : '끝내면 불이 들어온다' }}</span>
          <span class="stage-acts">
            <button v-if="quest.skip && !quest.done" @click="questBack(true)">넘어가기</button>
            <button v-if="!quest.done" @click="questQuit">도망가기</button>
            <button v-else class="primary" @click="questBack()">거리로 ▶</button>
          </span>
        </header>
        <div class="stage-body" :class="{ ink: quest.ink, paper: quest.ink === 'paper' }">
          <component :is="quest.comp" v-bind="quest.props" />
        </div>
      </div>
      <div v-else-if="quest" class="quest" @pointerdown.stop>
        <div class="quest-card" :style="{ width: `min(${quest.width + 24}px, 96%)` }">
          <header class="quest-head">
            <span class="quest-who">{{ quest.boss ? `${quest.who.face} ${quest.who.name}과의 대결` : quest.who ? `${quest.who.face} ${quest.who.name}의 부탁` : quest.free ? '수리공 도구' : '부탁' }}</span>
            <b>{{ quest.title }}</b>
            <span class="quest-state" :class="{ ok: quest.done }">{{ quest.done ? (quest.boss ? '이겼어요!' : '끝냈어요!') : quest.free ? '' : quest.boss ? '이기면 길이 열려요' : '끝까지 하면 불이 들어와요' }}</span>
            <span class="quest-acts">
              <button v-if="quest.skip && !quest.done" @click="questBack(true)">넘어가기</button>
              <button v-if="!quest.free" @click="questQuit">그만두기</button>
              <button class="primary" :disabled="!quest.done && !quest.free" @click="questBack()">{{ quest.placed ? '이야기로 돌아가기 ▶' : '거리로 돌아가기 ▶' }}</button>
            </span>
          </header>
          <div class="mac-win on quest-win" :class="{ ink: quest.ink, paper: quest.ink === 'paper' }">
            <div class="app-body">
              <div><component :is="quest.comp" v-bind="quest.props" /></div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="wipe" class="wipe" :class="wipe" aria-hidden="true">
        <i v-for="n in WIPE_ROWS" :key="n" :style="{ '--d': `${(n - 1) * 26}ms`, '--s': n % 2 ? -1 : 1 }"></i>
      </div>

      <div v-if="view3d" class="view3d">
        <World3D windowed :build="view3d" @built="from3D" @cancel="from3D(null)" />
      </div>

      <div v-if="ride" class="ride" aria-live="polite">
        <span class="ride-line" :style="{ background: ride.color }">{{ ride.line }}</span>
        <div class="ride-text">
          <small>{{ ride.line }}호선</small>
          <b>{{ ride.from ? `${ride.from} → ` : '' }}{{ ride.station }}</b>
          <span>{{ ride.title }}</span>
        </div>
        <div class="ride-track" :style="{ '--c': ride.color }"><i></i></div>
      </div>

      <div v-if="((!ready && !ride) || menu || (onTitle && paused)) && !dialog && !machine && !ending && !quest && !view3d && !inside" class="scrim mc" :class="{ title: onTitle }" @pointerover="menuHover">
        <div class="mc-wrap">
          <template v-if="!panel">
            <div v-if="onTitle" class="logo" aria-label="간판 수리공">
              <h1><span class="lg-sans">간판</span><img class="lg-hat" :src="hardhat" alt="" draggable="false" /><span class="lg-px">수리공</span></h1>
              <p class="sub">꺼진 간판에 다시 불을 켜는 수리공 이야기</p>
            </div>
            <h2 v-else class="mc-head">일시 정지</h2>

            <p v-if="!onTitle && story" class="mc-note"><b>{{ story.ch.title }}</b> · 부탁 {{ story.step }} / {{ story.goal }}</p>
            <p v-if="!onTitle && mission" class="mc-note"><Target class="ic" />{{ missionText }}</p>

            <div class="stack">
              <template v-if="onTitle">
                <button class="mc-btn" :disabled="!ready" @click="playStory">
                  {{ story && !story.done ? `계속하기 · ${story.ch.title}` : nextCh < 0 ? '처음부터 다시' : nextCh === 0 ? '이야기 시작' : `이어하기 · ${CHAPTERS[nextCh].title}` }}
                </button>
                <div class="pair">
                  <button class="mc-btn" :disabled="!ready" @click="openPanel('story')">장 고르기</button>
                  <button class="mc-btn" @click="openPanel('keys')">조작법</button>
                </div>
              </template>
              <template v-else>
                <button class="mc-btn" @click="resume">게임으로 돌아가기</button>
                <button class="mc-btn" :disabled="!ready" @click="openQuest('atlas')">간판 지도 (M)</button>
                <div class="pair">
                  <button class="mc-btn" :disabled="!ready" @click="openPanel('story')">장 고르기</button>
                  <button class="mc-btn" @click="openPanel('keys')">조작법</button>
                </div>
              </template>
              <button v-if="!onTitle" class="mc-btn" @click="toTitle">타이틀 화면으로</button>
              <button v-if="!windowed" class="mc-btn" @click="unfull">창 모드로</button>
              <button class="mc-btn" @click="close">나가기</button>
            </div>

            <div v-if="!ready" class="mc-load">
              <p>{{ status }}</p>
              <div class="mc-bar"><i></i></div>
            </div>
            <p v-else-if="onTitle" class="mc-where"><MapPin class="ic" />{{ where }}</p>
          </template>

          <div v-else class="mc-panel">
            <h2 class="mc-head">{{ { story: '장 고르기', place: '장소·시간·날씨', keys: '조작법' }[panel] }}</h2>
            <div class="mc-box">
              <template v-if="panel === 'story'">
                <div class="stack">
                  <button v-for="(c, n) in CHAPTERS" :key="c.id" class="mc-btn ch-btn" :class="{ on: story?.ch === c }" :disabled="!ready || !unlocked(n)" @click="menuStory(n)">
                    <i class="ride-dot" :style="{ background: c.ride.color }">{{ c.ride.line }}</i>
                    <CircleCheck v-if="cleared.includes(c.id)" class="ic" /><Lock v-else-if="!unlocked(n)" class="ic" /><span v-else>{{ c.npc.face }}</span> {{ c.title }}
                    <small>{{ c.steps.filter((x) => x.game || x.boss).map((x) => (x.boss ? `보스 ${BOSSES[x.boss]?.name}` : QUESTS[x.game]?.title)).filter(Boolean).join(' · ') }}</small>
                  </button>
                  <button v-if="nextCh < 0" class="mc-btn" :disabled="!ready" @click="menuMachine"><History class="ic" />서울 타임머신</button>
                </div>
              </template>
              <template v-else>
                <ul v-if="!touch" class="keys">
                  <li><kbd>WASD</kbd>·방향키 걷기 · <kbd>Shift</kbd> 달리기 · <kbd>F</kbd> 지붕 위로 날기</li>
                  <li><kbd>E</kbd>·<kbd>Space</kbd> 사장님·안내하는 사람과 말하기, 가까운 간판 고치기 · 간판을 클릭해도 돼요</li>
                  <li><kbd>M</kbd> 간판 지도 · 이야기에서 높이 쌓을 때가 되면 저절로 3D로 들어가요(나오면 쌓은 블록이 그대로 와요)</li>
                  <li>머리 위 <b>!</b> 사장님, <b>💡</b> 동네 사람, 빨간 <b>!</b> 보스 · 눌러도 그 사람에게 걸어가 말을 걸어요 · 간판이 많은 건물은 눌러서 안으로 들어가요</li>
                  <li><kbd>T</kbd> 택시 부르기 · 부탁받은 가게나 멀리 있는 간판 앞까지 바로 태워 줘요</li>
                  <li><kbd>N</kbd> 가까운 간판에 쪽지 붙이기 · 노란 쪽지가 붙은 간판은 다른 사람이 남긴 말이 있어요</li>
                  <li><kbd>Q</kbd> 앞에 블록 놓기 · <kbd>X</kbd> 부수기 · 오른쪽 클릭 놓기 · 왼쪽 클릭 부수기</li>
                  <li><kbd>1</kbd>~<kbd>5</kbd> 블록 고르기 · 휠·<kbd>+</kbd><kbd>-</kbd> 확대 · <kbd>Esc</kbd> 메뉴</li>
                </ul>
                <ul v-else class="keys">
                  <li>왼쪽 아래 화살표로 걷기 · 사장님 앞에서 ‘말걸기’ · 간판을 눌러 고치기</li>
                  <li>머리 위 ! · 💡 를 누르면 그 사람에게 걸어가 말을 걸어요</li>
                  <li>담기: 가까운 간판 담기 · 놓기: 앞에 블록 놓기 · 가까운 칸을 눌러 블록 놓기·부수기</li>
                </ul>
                <p class="src">길 © OpenStreetMap 기여자 · 건물 © 국토교통부 GIS건물통합정보(브이월드) · 간판 소상공인시장진흥공단 상가정보 · 교통·혼잡도 서울 실시간 도시데이터 · 버스 서울시 버스도착정보 · 날씨 Open-Meteo</p>
              </template>
            </div>
            <button class="mc-btn" @click="panel = null">뒤로</button>
          </div>

          <p v-if="notice" class="wnotice"><TriangleAlert class="ic" />{{ notice }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ic {
  display: inline-block;
  width: 1.1em;
  height: 1.1em;
  margin-right: 0.3em;
  vertical-align: -0.18em;
  flex: none;
  stroke-width: 2.2;
}

.world {
  position: fixed;
  inset: 0;
  z-index: 15000;
  display: flex;
  flex-direction: column;
  background: #000;
  font-size: 13px;
  color: var(--label);
}

/* 맥 전체 화면 앱처럼 얇은 유리 막대와 신호등 단추 */
.wbar {
  position: absolute;
  inset: 0 0 auto;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 12px;
  color: rgba(255, 255, 255, 0.85);
  font-size: 12px;
  font-weight: 600;
  background: linear-gradient(rgba(0, 0, 0, 0.45), transparent);
}

.wbar span {
  margin-left: 8px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
}

.tl {
  width: 12px;
  height: 12px;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #ff5f57;
  box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.2);
}

.tl.max {
  background: #28c840;
}

.tl.off {
  background: rgba(255, 255, 255, 0.28);
}

/* 98판의 창·제목줄·묶음 칸을 맥의 어두운 유리 패널로 그린다. 밤 지도 위에 뜨므로 테마와 상관없이 늘 어둡다 */
.window {
  --label: rgba(255, 255, 255, 0.9);
  --label-2: rgba(255, 255, 255, 0.6);
  --label-3: rgba(255, 255, 255, 0.32);
  --sep: rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  color: var(--label);
  background: rgba(28, 28, 32, 0.8);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.16), 0 0 0 0.5px rgba(0, 0, 0, 0.5), 0 12px 36px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.title-bar {
  padding: 8px 12px 0;
}

.title-bar-text {
  font-size: 12px;
  font-weight: 600;
  color: var(--label-2);
}

.window-body {
  padding: 6px 12px 12px;
}

.menu .title-bar-text {
  font-size: 15px;
  color: var(--label);
}

button {
  min-height: 26px;
  padding: 3px 11px;
  border: 0;
  border-radius: 999px;
  background: #3a3a3e;
  color: rgba(255, 255, 255, 0.92);
  font: inherit;
  font-size: 12px;
  box-shadow: inset 0 0.5px 0 rgba(255, 255, 255, 0.12), 0 0 0 0.5px rgba(0, 0, 0, 0.4), 0 1px 1.5px rgba(0, 0, 0, 0.25);
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: #48484c;
}

button:disabled {
  color: rgba(255, 255, 255, 0.32);
}

button.go {
  border-radius: 10px;
  background: linear-gradient(#2a91ff, #0a7cff);
  color: #fff;
  font-size: 14px;
}

fieldset {
  margin: 10px 0 0;
  border: 0;
  padding: 0;
  border-top: 0.5px solid var(--sep);
}

fieldset .chips {
  margin-top: 6px;
}

legend {
  padding: 10px 0 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--label-2);
}

.progress-indicator {
  height: 5px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.progress-indicator-bar {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
}

.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #000;
  user-select: none;
}

.stage > canvas {
  display: block;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  touch-action: none;
}

.hud {
  position: absolute;
  top: 44px;
  left: 14px;
  max-width: calc(100% - 180px);
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  pointer-events: none;
}

.hud .hud-main {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  font-size: 12.5px;
}

.hud-main b {
  font-weight: normal;
  color: #ffa300;
}

.hud-main i {
  width: 2px;
  height: 11px;
  background: #5f6aa8;
}

.hud .hud-note {
  color: rgb(255 255 255 / 0.85);
}

.now {
  margin: 0 0 4px;
  padding: 0;
  list-style: none;
  font-size: 13px;
  line-height: 1.7;
}

/* 거리 위 표시는 대화창과 같은 픽셀 판으로 */
.hud span {
  padding: 3px 9px;
  font-size: 12px;
  border-radius: 0;
  font-family: var(--game-font);
  color: #fff1e8;
  background: #141b3a;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  text-shadow: none;
  box-shadow:
    0 -3px 0 #fff1e8,
    0 3px 0 #fff1e8,
    -3px 0 0 #fff1e8,
    3px 0 0 #fff1e8,
    0 6px 0 rgb(0 0 0 / 0.45);
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
    linear-gradient(#fff, #fff) center / 2px 100% no-repeat,
    linear-gradient(#fff, #fff) center / 100% 2px no-repeat;
  mix-blend-mode: difference;
}

.aim {
  position: absolute;
  bottom: 72px;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: 4px 12px;
  white-space: nowrap;
  font-size: 13px;
  border-radius: 0;
  font-family: var(--game-font);
  color: #fff1e8;
  background: #141b3a;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  text-shadow: none;
  box-shadow:
    0 -3px 0 #fff1e8,
    0 3px 0 #fff1e8,
    -3px 0 0 #fff1e8,
    3px 0 0 #fff1e8,
    0 6px 0 rgb(0 0 0 / 0.45);
  pointer-events: none;
}

.aim small {
  margin-left: 6px;
  color: #ffec27;
}

.mini {
  position: absolute;
  top: 38px;
  right: 8px;
  pointer-events: none;
}

.mini canvas {
  display: block;
  width: 150px;
  height: 150px;
  border: 2px solid #fff;
  outline: 1px solid #000;
  image-rendering: pixelated;
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
  padding: 1px 5px;
  font-size: 11px;
  color: #fff;
  text-shadow: 1px 1px 0 rgb(0 0 0 / 0.5);
}

.goal {
  position: absolute;
  top: 70px;
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 12px;
  font-size: 14px;
  border-radius: 0;
  font-family: var(--game-font);
  color: #fff1e8;
  background: #141b3a;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  text-shadow: none;
  box-shadow:
    0 -3px 0 #fff1e8,
    0 3px 0 #fff1e8,
    -3px 0 0 #fff1e8,
    3px 0 0 #fff1e8,
    0 6px 0 rgb(0 0 0 / 0.45);
  pointer-events: none;
}

.goal.fare {
  display: flex;
  align-items: center;
  gap: 8px;
}

.goal.fare .meter {
  padding: 0 6px;
  color: #141b3a;
  background: #ffec27;
}

.goal.fare small {
  color: #8e93b8;
  font-size: 11px;
}

.goal.fare.hurry .meter {
  color: #fff1e8;
  background: #ff5a6e;
}

.goal .arrow {
  display: inline-block;
  margin-right: 6px;
  color: #ffec27;
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
  border-bottom: 1px dotted #999;
}

.board .line {
  font-weight: bold;
  white-space: nowrap;
}

.board .when {
  text-align: right;
  white-space: nowrap;
  color: #a01818;
}

.board .note {
  margin: 4px 0 0;
  font-size: 10px;
  color: var(--label-2);
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

.toast .share {
  font-size: 12px;
  line-height: 1.4;
}

.toast .share b {
  font-size: 12px;
}

.toast .note-btn {
  margin-top: 6px;
  pointer-events: auto;
}

.aim-note {
  display: block;
  margin-top: 2px;
}

.note-box {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 6;
  width: min(320px, calc(100% - 24px));
  transform: translate(-50%, -50%);
}

.note-box .window-body {
  display: grid;
  gap: 8px;
}

.note-box .hint,
.note-box .err {
  margin: 0;
  font-size: 12px;
}

.note-box .err {
  color: #d70015;
}

.note-box .row {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.hotbar {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  padding: 4px;
  background: #141b3a;
  box-shadow:
    0 -3px 0 #fff1e8,
    0 3px 0 #fff1e8,
    -3px 0 0 #fff1e8,
    3px 0 0 #fff1e8,
    0 6px 0 rgb(0 0 0 / 0.45);
}

.hotbar button {
  position: relative;
  min-width: 0;
  width: 42px;
  height: 42px;
  padding: 0;
  display: grid;
  place-items: center;
}

.hotbar button {
  border-radius: 0;
  background: #2b3170;
  box-shadow: inset 0 -3px 0 #0a0c26;
}

.hotbar button.on {
  background: #3d4590;
  outline: 3px solid #ffec27;
  outline-offset: 0;
}

.hotbar img {
  image-rendering: pixelated;
}

.hotbar span {
  position: absolute;
  right: 2px;
  bottom: 0;
  font-family: var(--game-font);
  font-size: 10px;
  color: #fff1e8;
  text-shadow: 1px 1px 0 #000;
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
  top: 44px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 12px;
  font-size: 13px;
  border-radius: 0;
  font-family: var(--game-font);
  color: #fff1e8;
  background: #141b3a;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  text-shadow: none;
  box-shadow:
    0 -3px 0 #fff1e8,
    0 3px 0 #fff1e8,
    -3px 0 0 #fff1e8,
    3px 0 0 #fff1e8,
    0 6px 0 rgb(0 0 0 / 0.45);
  pointer-events: none;
  white-space: nowrap;
}

.story-bar b {
  font-weight: normal;
  color: #ffa300;
}

/* 부탁 칸: 한 칸이 부탁 하나 */
.story-bar .pips {
  display: flex;
  gap: 3px;
}

.story-bar .pips i {
  width: 10px;
  height: 10px;
  background: #2b3170;
  box-shadow: inset 0 -2px 0 #0a0c26;
}

.story-bar .pips i.on {
  background: #ffec27;
  box-shadow: inset 0 -2px 0 #c28a00;
}

.story-bar .lit {
  color: #ffec27;
}

.story-goal {
  top: 86px;
}

.toast.neon .title-bar {
  background: linear-gradient(90deg, #a0148c, #ff4fd8);
}

.chat {
  position: absolute;
  top: 146px;
  left: 50%;
  transform: translateX(-50%);
  width: min(440px, calc(100% - 20px));
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px 8px 8px;
  font-family: var(--game-font);
  font-size: 14px;
  line-height: 1.55;
  color: #fff1e8;
  background: #141b3a;
  box-shadow:
    0 -3px 0 #fff1e8,
    0 3px 0 #fff1e8,
    -3px 0 0 #fff1e8,
    3px 0 0 #fff1e8,
    0 6px 0 rgb(0 0 0 / 0.45);
  pointer-events: none;
}

.chat-face {
  flex: none;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  font-size: 28px;
  background: #2b3a78;
  overflow: hidden;
}

.chat-face img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
}

.chat p {
  margin: 0;
}

.chat b {
  display: block;
  color: #ffa300;
  font-weight: normal;
}

.inside-wrap {
  position: absolute;
  inset: 0;
  z-index: 45;
  background: #0e0b1c;
}

.story-bar .clock {
  padding: 0 6px;
  color: #ffe14d;
  font-family: var(--game-font);
}

.year {
  position: absolute;
  top: 40px;
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  justify-items: center;
  font-size: 22px;
  color: #fff;
  text-shadow: 3px 3px 0 #1d1d2b;
  pointer-events: none;
}

.year b {
  font-size: 64px;
  line-height: 1;
}

.year small {
  max-width: 80vw;
  margin-top: 4px;
  padding: 2px 8px;
  font-size: 13px;
  text-align: center;
  background: rgb(0 0 0 / 0.45);
  text-shadow: 1px 1px 0 #000;
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
  background: rgb(0 0 0 / 0.35);
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

.go {
  width: 100%;
  height: 34px;
  font-weight: bold;
}

.wnotice {
  margin: 8px 0 0;
  color: #a01818;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chips button.on {
  background: var(--accent);
  color: #fff;
  font-weight: 600;
}

.keys {
  margin: 10px 0 0;
  padding-left: 16px;
  line-height: 1.8;
  font-size: 12px;
}

kbd {
  padding: 0 5px;
  font-family: inherit;
  font-size: 11px;
  border-radius: 5px;
  color: rgba(255, 255, 255, 0.9);
  background: #3a3a3e;
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.4), 0 1px 0 rgba(0, 0, 0, 0.4);
}

.src {
  margin: 10px 0 0;
  font-size: 10px;
  color: #555;
}
/* 맥 창 안: 셸이 창을 그리므로 부모를 채우기만 한다 */
.world.windowed {
  position: absolute;
  z-index: auto;
  border-radius: inherit;
  overflow: hidden;
}

.windowed .hud,
.windowed .mini {
  top: 8px;
}

.windowed .year {
  top: 10px;
}

/* ── 타이틀·게임 메뉴: 인트로 시작 화면과 같은 검은 판 + 픽셀 글자 단추 ───────────── */
.scrim.mc {
  background: rgb(0 0 0 / 0.82);
  overflow: auto;
  font-family: 'Galmuri11 Game', Galmuri11, var(--pixel);
  color: #e9e9ee;
}

.scrim.mc.title {
  background: #000;
}

.mc-wrap {
  position: relative;
  width: min(440px, calc(100% - 24px));
  max-height: calc(100% - 16px);
  padding: 12px 0;
  display: grid;
  justify-items: center;
  gap: 14px;
  text-align: center;
}

.logo {
  position: relative;
  margin-bottom: 18px;
}

.logo h1 {
  --fs: clamp(44px, 7vw, 84px);
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs);
  line-height: 1;
  color: #fff;
  white-space: nowrap;
}

.lg-sans {
  font-family: 'Pretendard Variable', Pretendard, var(--font);
  font-weight: 800;
  letter-spacing: -0.04em;
}

/* 인트로의 블록 글자처럼: 흰 글자에 오른쪽 아래로 회색 두께 */
.lg-px {
  font-family: 'Galmuri11 Game', Galmuri11, var(--pixel);
  font-weight: 700;
  text-shadow:
    0.04em 0.04em 0 #5d5d6c,
    0.07em 0.07em 0 #5d5d6c;
}

.lg-hat {
  position: relative;
  z-index: 1;
  width: 1.15em;
  margin: 0 -0.36em 0 -0.2em;
  filter: drop-shadow(0 0.06em 0.12em rgb(255 190 20 / 0.28));
  animation: lg-bob 3.2s ease-in-out infinite;
}

@keyframes lg-bob {
  50% {
    transform: translateY(-4%) rotate(-4deg);
  }
}

.logo .sub {
  margin: 22px 0 0;
  font: 500 14px / 1.45 'Pretendard Variable', Pretendard, sans-serif;
  color: #e9e9ee;
}

.mc-head {
  margin: 0 0 6px;
  font-size: 22px;
  font-weight: 700;
  color: #ffcf3a;
  text-shadow: 3px 3px 0 #1b1622;
}

.mc-note,
.mc-where {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #8e8ea0;
}

.stack {
  width: 100%;
  display: grid;
  justify-items: center;
  gap: 2px;
}

.pair {
  display: contents;
}

/* 글자만 있는 단추. 고르면(마우스를 올리면 포커스가 옮겨 온다·↑↓) 노란색에 ▶ */
.mc-btn {
  position: relative;
  width: auto;
  min-height: 0;
  padding: 9px 4px;
  border: 0;
  border-radius: 0;
  background: none;
  box-shadow: none;
  color: #8e8ea0;
  font-family: 'Galmuri11 Game', Galmuri11, var(--pixel);
  font-size: clamp(16px, 2.2vh, 21px);
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
}

.mc-btn:focus {
  outline: none;
  background: none;
  box-shadow: none;
  color: #ffcf3a;
  text-shadow: 3px 3px 0 #1b1622;
}

.mc-btn:focus::before {
  content: '▶';
  position: absolute;
  left: -1.5em;
  top: 50%;
  transform: translateY(-50%);
  animation: caret 0.6s steps(2) infinite;
}

@keyframes caret {
  50% {
    transform: translate(5px, -50%);
  }
}

.mc-btn:active:not(:disabled) {
  transform: translateY(2px);
}

.mc-btn:disabled {
  color: #44444f;
  cursor: default;
}

.mc-btn.on {
  color: #fff;
}

.mc-load {
  width: min(320px, 100%);
  display: grid;
  gap: 8px;
  font-size: 12px;
  color: #8e8ea0;
}

.mc-load p {
  margin: 0;
}

.mc-bar {
  height: 10px;
  border: 2px solid #e9e9ee;
  background: #000;
  overflow: hidden;
}

.mc-bar i {
  display: block;
  width: 40%;
  height: 100%;
  background: #ffcf3a;
  animation: mcbar 1.4s steps(12) infinite;
}

@keyframes mcbar {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}

.mc-panel {
  width: 100%;
  display: grid;
  justify-items: center;
  gap: 12px;
}

.mc-box {
  width: 100%;
  max-height: min(56vh, 460px);
  overflow: auto;
  padding: 12px 14px;
  border: 2px solid #2c2c36;
  background: #000;
  text-align: left;
  font-size: 12px;
  line-height: 1.6;
}

.mc-box > p {
  margin: 0 0 10px;
}

.mc-box h3 {
  margin: 10px 0 6px;
  font-size: 12px;
  font-weight: 700;
  color: #ffcf3a;
}

.mc-box h3:first-child {
  margin-top: 0;
}

.mc-box .mc-btn {
  font-size: 15px;
}

.mc .chips button {
  border-radius: 0;
  border: 2px solid #44444f;
  background: #000;
  color: #e9e9ee;
  font-family: 'Galmuri11 Game', Galmuri11, var(--pixel);
}

.mc .chips button.on {
  color: #ffcf3a;
  border-color: #ffcf3a;
}

.mc .chips button:disabled {
  color: #44444f;
  border-color: #2c2c36;
}

.mc .keys {
  margin: 0;
  font-family: var(--font);
  color: #e9e9ee;
}

.mc kbd {
  color: #1b1622;
  background: #e9e9ee;
  box-shadow: 0 2px 0 #5d5d6c;
  border-radius: 0;
}

.mc .src {
  color: #6c6c7c;
  font-family: var(--font);
}

.mc .wnotice {
  margin: 0;
  padding: 6px 10px;
  background: #1b1622;
  color: #ff8a80;
  font-size: 12px;
}
.goal-btn {
  margin-left: 8px;
  pointer-events: auto;
  text-shadow: none;
}

.goal-btn.primary {
  background: #ffd60a;
  color: #1d1d1f;
  font-weight: 700;
}

.goal-btn.primary:hover:not(:disabled) {
  background: #ffe14d;
}

/* 이야기 속 놀이: 거리 화면이 그대로 놀이판으로 바뀐다 */
.stage {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: #0d1030;
  font-family: var(--game-font);
}

.stage-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 7px 12px;
  background: #141b3a;
  box-shadow: 0 3px 0 #fff1e8, 0 6px 0 rgba(8, 10, 24, 0.5);
  color: #fff1e8;
  font-size: 13px;
  position: relative;
  z-index: 1;
}

.stage.boss .stage-bar {
  background: #2a1030;
  box-shadow: 0 3px 0 #ff5a6e, 0 6px 0 rgba(8, 10, 24, 0.5);
}

.stage-face {
  width: 34px;
  height: 34px;
  image-rendering: pixelated;
  object-fit: cover;
  box-shadow: 0 0 0 2px #fff, 0 0 0 4px #0a0c26;
}

.stage-who {
  color: #ffec27;
}

.stage.boss .stage-who {
  color: #ff7a8a;
}

.stage-bar b {
  font-size: 16px;
}

.stage-state {
  opacity: 0.7;
}

.stage-state.ok {
  color: #30d158;
  opacity: 1;
}

.stage-acts {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.stage-acts button {
  padding: 4px 10px;
  border: 0;
  border-radius: 0;
  background: #1b2350;
  box-shadow: 0 0 0 2px #fff1e8;
  color: #fff1e8;
  font: inherit;
  cursor: pointer;
}

.stage-acts button:hover,
.stage-acts button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px #ffec27;
  color: #ffec27;
}

.stage-acts .primary {
  background: #ffa300;
  box-shadow: 0 0 0 2px #fff1e8;
  color: #141b3a;
}

.stage-acts .primary:hover {
  color: #141b3a;
}

.stage-body {
  min-height: 0;
  overflow: auto;
}

.stage-body > :deep(*) {
  min-height: 100%;
}

/* 한 줄씩 엇갈려 덮었다가 다시 걷히는 픽셀 막 */
.wipe {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: grid;
  grid-template-rows: repeat(14, 1fr);
  overflow: hidden;
  pointer-events: all;
}

.wipe i {
  display: block;
  background: #0a0c26;
  box-shadow: inset 0 -2px 0 #ffcf3a33;
  transform: translateX(calc(var(--s) * 101%));
}

.wipe.cover i {
  animation: wipe-in 0.2s steps(5) var(--d) forwards;
}

.wipe.reveal i {
  transform: none;
  animation: wipe-out 0.2s steps(5) var(--d) forwards;
}

@keyframes wipe-in {
  to { transform: none; }
}

@keyframes wipe-out {
  to { transform: translateX(calc(var(--s) * -101%)); }
}

/* 부탁 놀이: 거리 위에 맥 창 하나를 띄운다 */
.quest {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 12px;
  background: rgb(8 10 20 / 0.55);
  backdrop-filter: blur(6px);
}

.quest-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 100%;
  min-height: 0;
}

.quest-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  padding: 8px 12px;
  border-radius: 14px;
  background: rgb(28 28 32 / 0.86);
  box-shadow: inset 0 0.5px 0 rgba(255, 255, 255, 0.14), 0 0 0 0.5px rgba(0, 0, 0, 0.5);
  color: #fff;
}

.quest-who {
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
}

.quest-head b {
  font-size: 15px;
}

.quest-state {
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
}

.quest-state.ok {
  color: #30d158;
  font-weight: 700;
}

.quest-acts {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

.quest-acts .primary {
  background: #0a84ff;
  color: #fff;
  font-weight: 600;
}

.quest-acts .primary:disabled {
  background: #3a3a3e;
}

.quest-win {
  flex: 1;
  min-height: 0;
  border-radius: 16px;
}

.mac-win.quest-win .app-body {
  max-height: calc(100vh - 140px);
  padding-bottom: 0 !important;
}

.view3d {
  position: absolute;
  inset: 0;
  z-index: 25;
}

/* 장 사이 지하철: 노선 색 동그라미와 달리는 열차 */
.ride {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 30;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 6px 16px;
  width: min(420px, calc(100% - 24px));
  padding: 18px 22px;
  border-radius: 22px;
  background: rgb(20 20 24 / 0.9);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5), inset 0 0.5px 0 rgba(255, 255, 255, 0.15);
  color: #fff;
  transform: translate(-50%, -50%);
  animation: ride-in 0.35s ease-out;
}

.ride-line {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  font-size: 24px;
  font-weight: 800;
}

.ride-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ride-text small {
  color: rgba(255, 255, 255, 0.6);
}

.ride-text b {
  font-size: 22px;
}

.ride-text span {
  color: rgba(255, 255, 255, 0.75);
  font-size: 13px;
}

.ride-track {
  position: relative;
  grid-column: 1 / -1;
  height: 6px;
  margin-top: 8px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--c) 35%, transparent);
  overflow: hidden;
}

.ride-track i {
  position: absolute;
  inset: 0 auto 0 0;
  width: 28%;
  border-radius: 3px;
  background: var(--c);
  animation: ride-go 1.4s linear infinite;
}

@keyframes ride-go {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(360%);
  }
}

@keyframes ride-in {
  from {
    opacity: 0;
    transform: translate(-50%, -46%);
  }
}

.ch-btn {
  position: relative;
}

.ch-btn small {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  opacity: 0.75;
}

.ride-dot {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin-right: 6px;
  border-radius: 50%;
  color: #fff;
  font-size: 11px;
  font-style: normal;
  font-weight: 800;
  text-shadow: none;
  vertical-align: 1px;
}
</style>
