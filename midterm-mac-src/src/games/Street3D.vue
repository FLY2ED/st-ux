<script setup>
// 간판 수리공 (3D): 2D 와 같은 동네·간판·이야기를 비스듬히 내려다보는 3D 거리로 푼다.
// 꺼진 동네는 잿빛, 간판을 고치면 네온이 켜지고 그 둘레로 색이 번진다. 1~4장 이야기·보스·부탁 놀이·
// 내 가게 짓기·택시·도감·타임머신까지 모두 이 거리 안에서 한다. 놀이는 거리 위를 덮는 판으로 열린다
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { BookMarked, Lightbulb } from 'lucide-vue-next'
import { load, signsAround } from '../data.js'
import { player as arcadePlayer } from '../arcade.js'
import { pastelOf } from '../shops.js'
import { sfx } from '../sound.js'
import { drawAvatar, readLook } from '../avatar.js'
import { loadLM } from '../signlm.js'
import { B, meshWorld, plantStreetTrees, plantTrees, rasterize } from '../world/build.js'
import { MAX_LIT, fx, neonOf, patch } from '../world/fx.js'
import { makePeople } from '../world/people.js'
import { PRESETS } from '../world/presets.js'
import { meshSigns, placeSigns } from '../world/signs.js'
import { BOSSES, BUILD, CHAPTERS, ENDING, FOLKS, FOLK_IDLE, SCARED, TIMES, fill, ownerOf, readCleared, rideOf, saveCleared, spriteOf } from '../world/story.js'
import { BLOCKS, GROUND_ID, blockMaterials, leafColor, leafMaterials, makeMaterials } from '../world/textures.js'
import { makeTraffic } from '../world/traffic.js'
import { makeWeather } from '../world/weather.js'
import RpgDialog from './street2d/RpgDialog.vue'
import Cutscene from './street2d/Cutscene.vue'

// windowed 는 맥 창 안, play 는 바깥(순위표·위젯)에서 바로 여는 놀이, begin·beginAt 은 인트로 시작 메뉴에서 고른 것
const props = defineProps({ windowed: { type: Boolean, default: false }, play: { type: String, default: '' }, begin: { type: String, default: '' }, beginAt: { type: Number, default: 0 } })
const emit = defineEmits(['close', 'unfull'])

// 사장님 부탁·보스 대결로 여는 놀이: 바탕화면 앱을 그대로 거리 위 판에 띄운다. free 는 끝내지 않아도 돌아갈 수 있다
const QUESTS = {
  rain: { title: '간판 산성비', comp: defineAsyncComponent(() => import('./RainWindow.vue')), ink: true },
  dodge: { title: '점심 간판 피하기', comp: defineAsyncComponent(() => import('./DodgeWindow.vue')), ink: true },
  scratch: { title: '간판 청소', comp: defineAsyncComponent(() => import('./ScratchWindow.vue')), ink: true },
  more: { title: '더 많을까?', comp: defineAsyncComponent(() => import('./MoreWindow.vue')), ink: 'paper' },
  booth: { title: '간판 네컷', comp: defineAsyncComponent(() => import('./BoothWindow.vue')), ink: true, skip: true },
  type: { title: '간판 타자왕', comp: defineAsyncComponent(() => import('./TypeWindow.vue')), ink: true },
  guess: { title: '간판 어디게', comp: defineAsyncComponent(() => import('./GuessWindow.vue')), ink: true },
  map: { title: '간판 지도', comp: defineAsyncComponent(() => import('./BuildingWindow.vue')), mode: 'name' },
  open: { title: '내 가게 차리기', comp: defineAsyncComponent(() => import('./BuildingWindow.vue')), mode: 'shop', free: true },
  atlas: { title: '간판 지도', comp: defineAsyncComponent(() => import('./BuildingWindow.vue')), mode: 'name', free: true },
}
const BOSS_GOAL = { rain: 12, type: 8, more: 6, map: 5 }

// 인물 그림: c- 길잡이·보스 서 있는 모습, f- 동네 사람·사장님, p- 대화창 얼굴
const NPC_ART = import.meta.glob('../assets/npc/*.png', { eager: true, import: 'default' })
const art = (name) => NPC_ART[`../assets/npc/${name}.png`] || ''
const whoOf = (npc, tone = 'npc') => ({ ...npc, portrait: npc.portrait || (npc.id ? art(`p-${npc.id}`) || art(`f-${npc.id}`) : ''), tone: npc.tone || tone })
const bossWho = (id) => whoOf({ id, name: BOSSES[id].name, face: BOSSES[id].face }, 'boss')
const ownerWho = (sign) => {
  const o = ownerOf(sign)
  return { ...o, sprite: spriteOf(sign.cat), portrait: art(`f-${spriteOf(sign.cat)}`) }
}
// 위젯에 넘기는 때: 이야기 속 때를 넷으로 줄인다
const COARSE_TIME = { midnight: 'night', late: 'night', night: 'night', predawn: 'dawn', dawn: 'dawn', dusk: 'dusk', morning: 'day', day: 'day' }

// 도감·내 가게는 2D 판과 같이 쓴다
const DEX_KEY = 'gp-3d-dex'
const SHOP_KEY = 'gp-myshop'
const FARE_KEY = 'st-taxi-won'
const MAX_SIGNS = 3500
const R = 0.3
const REACH = 3.6
const WALK = 5.2
const RUN = 8.5
const WIPE_ROWS = 14
const WIPE_MS = 560

const box = ref(null)
const mini = ref(null)
const status = ref('지도를 펼치는 중…')
const notice = ref('')
const paused = ref(true)
const menu = ref(false)
const panel = ref('')
const onTitle = ref(false)
const dialog = shallowRef(null)
const chat = shallowRef(null)
const toast = shallowRef(null)
const near = shallowRef(null)
const litCount = ref(0)
const arrow = ref(0)
const dist = ref(0)
const goalKind = ref('')
const story = shallowRef(null)
const quest = shallowRef(null)
const wipe = ref('')
const ride = shallowRef(null)
const fare = shallowRef(null)
const machine = shallowRef(null)
const timeMode = ref('midnight')
const cleared = ref(readCleared())
const dex = ref(readDex())
const slot = ref(0)
const touch = matchMedia('(pointer: coarse)').matches
const ready = computed(() => !status.value)
const dexSet = computed(() => new Set(dex.value))
const myName = () => arcadePlayer()?.name || '수리공'
// 이어서 할 장: 아직 못 깬 첫 장(다 깼으면 -1)
const nextCh = computed(() => CHAPTERS.findIndex((c) => !cleared.value.includes(c.id)))
const unlocked = (n) => n === 0 || cleared.value.includes(CHAPTERS[n - 1].id)
const storyOn = computed(() => !!story.value && !story.value.done)
const building = computed(() => !!story.value?.build && !story.value.build.done && !story.value.done)
const blockIcons = BLOCKS.map((b) => {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 16
  b.draw(c.getContext('2d'))
  return { id: b.id, label: b.label, icon: c.toDataURL() }
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

// three.js 상태는 반응형으로 두지 않는다
let renderer, scene, camera, composer, bloom, ambient, moon, stars
let mats, leafMats, weatherFx, blockMats
let worldGroup = null
let signGroup = null
let signMeshes = []
let treeGroup = null
let neonGroup = null
let npcGroup = null
let blockGroup = null
let lotGroup = null
let mineGroup = null
let traffic = null
let people = null
let grid = null
let world = null
let here = ''
let signPlaced = []
let litList = []
let litSet = new Set()
let treeCells = new Set()
let wave = null
let cine = null
let raf = 0
let last = 0
let mapBase = null
let miniTimer = 0
let shake = 0
let observer = null
const sky = { night: 1, dusk: 0 }
const keys = new Set()
const player = { pos: new THREE.Vector3(), face: new THREE.Vector2(0, 1), step: 0, moving: false }
const cam = { yaw: 0.6, pitch: 0.9, dist: 21, target: new THREE.Vector3() }
let drag = null
// 쌓은 블록: 'i,k' → 아래부터 블록 종류 목록
const voxels = new Map()
const vkey = (i, k) => `${i},${k}`

// --- 장면 ---------------------------------------------------------------------
function setupScene() {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
  box.value.prepend(renderer.domElement)
  scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x0b1030, 30, 170)
  camera = new THREE.PerspectiveCamera(50, 1, 0.3, 1200)
  ambient = new THREE.AmbientLight(0x8fa0d8, 0.75)
  moon = new THREE.DirectionalLight(0xc8d4ff, 0.55)
  moon.position.set(-40, 80, 30)
  scene.add(ambient, moon)

  const starPos = []
  for (let i = 0; i < 600; i++) {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.1, Math.random() - 0.5).normalize().multiplyScalar(700)
    starPos.push(v.x, v.y, v.z)
  }
  const sg = new THREE.BufferGeometry()
  sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3))
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }))
  scene.add(stars)

  mats = makeMaterials()
  leafMats = leafMaterials(leafColor(new Date().getMonth() + 1))
  blockMats = blockMaterials()
  for (const m of mats.groundMats) patch(m, 'wet')
  for (const m of [...mats.wallMats, mats.shopMat, mats.roofMat]) patch(m, 'year')
  for (const m of [leafMats.trunk, leafMats.leaf]) patch(m)
  // 밤 창문 불빛
  for (const m of mats.wallMats) m.emissiveIntensity = 0.8
  mats.shopMat.emissiveIntensity = 0.5
  weatherFx = makeWeather()
  scene.add(weatherFx.group)

  neonGroup = new THREE.Group()
  npcGroup = new THREE.Group()
  blockGroup = new THREE.Group()
  lotGroup = new THREE.Group()
  scene.add(neonGroup, npcGroup, blockGroup, lotGroup)

  makeAvatar()
  makeMarks()
  makeSparks()
  makeTaxi()

  composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  // 네온만 번지도록 문턱을 벽 밝기(0.86)보다 높게
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.45, 0.88)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())
  fx.uNight.value = 1
  resize()
}

function resize() {
  if (!renderer || !box.value) return
  const { clientWidth: w, clientHeight: h } = box.value
  if (!w || !h) return
  renderer.setSize(w, h)
  composer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}

// --- 수리공(픽셀 인형 판) -------------------------------------------------------
// 방향 4 × 걸음 3 장을 미리 그려 두고, 카메라 기준 방향에 맞는 장을 고른다
let avatar = null
let ghost = null
let shadow = null
let frames = []
function makeAvatar() {
  const look = readLook()
  frames = []
  for (let dir = 0; dir < 4; dir++) {
    for (let f = 0; f < 3; f++) {
      const c = document.createElement('canvas')
      c.width = 18
      c.height = 26
      drawAvatar(c.getContext('2d'), look, 9, 25, { scale: 1, dir, frame: f, night: true, shadow: false })
      const tex = new THREE.CanvasTexture(c)
      tex.magFilter = THREE.NearestFilter
      tex.minFilter = THREE.NearestFilter
      tex.colorSpace = THREE.SRGBColorSpace
      frames.push(tex)
    }
  }
  if (!avatar) {
    avatar = new THREE.Sprite(new THREE.SpriteMaterial({ map: frames[0], fog: false }))
    avatar.center.set(0.5, 0)
    avatar.scale.set(1.45, 2.1, 1)
    // 건물 뒤에 가려도 흐릿하게 보이는 그림자 인형
    ghost = new THREE.Sprite(new THREE.SpriteMaterial({ map: frames[0], fog: false, depthTest: false, depthWrite: false, transparent: true, opacity: 0.32, color: 0xffcf3a }))
    ghost.center.set(0.5, 0)
    ghost.scale.copy(avatar.scale)
    ghost.renderOrder = 5
    shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }))
    shadow.rotation.x = -Math.PI / 2
    scene.add(avatar, ghost, shadow)
  }
}

function onLook() {
  for (const t of frames) t.dispose()
  makeAvatar()
}

// 카메라에서 본 방향: 0 앞 · 1 뒤 · 2 왼쪽 · 3 오른쪽
function avatarDir() {
  const fx0 = -Math.sin(cam.yaw)
  const fz0 = -Math.cos(cam.yaw)
  const ahead = player.face.x * fx0 + player.face.y * fz0
  const side = player.face.x * Math.cos(cam.yaw) - player.face.y * Math.sin(cam.yaw)
  if (Math.abs(side) > Math.abs(ahead)) return side > 0 ? 3 : 2
  return ahead > 0 ? 1 : 0
}

// 카메라 기준 앞·오른쪽(땅 위)
function camAxes() {
  return { fwd: { x: -Math.sin(cam.yaw), z: -Math.cos(cam.yaw) }, right: { x: Math.cos(cam.yaw), z: -Math.sin(cam.yaw) } }
}

// --- 표시: 고칠 간판 틀, E 단추, 목표 빛기둥 -----------------------------------------
let ring = null
let keyMark = null
let beacon = null
function tagTexture(text, bg, fg, font = 36) {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')
  if (bg) {
    g.fillStyle = '#1b1622'
    g.fillRect(6, 10, 52, 50)
    g.fillStyle = bg
    g.fillRect(6, 4, 52, 50)
  }
  g.fillStyle = fg
  g.font = `700 ${font}px "Galmuri11 Game", Galmuri11, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 32, 31)
  const tex = new THREE.CanvasTexture(c)
  tex.magFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeMarks() {
  keyMark = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTexture('E', '#ffcf3a', '#1b1622'), depthTest: false, fog: false }))
  keyMark.scale.set(0.7, 0.7, 1)
  keyMark.renderOrder = 6
  keyMark.visible = false
  scene.add(keyMark)

  ring = new THREE.Group()
  ring.visible = false
  scene.add(ring)

  const bm = new THREE.MeshBasicMaterial({ color: 0xffcf3a, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  beacon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 80, 0.5), bm)
  beacon.visible = false
  scene.add(beacon)
}

// 간판 둘레 사각 틀(네온관·고칠 표시 함께 쓴다)
function frameOf(placed, material, pad = 0.05, thick = 0.06) {
  const g = new THREE.Group()
  const half = (B * 0.47 * placed.scale) / 2 + pad
  for (const [px, pz, qx, qz] of placed.faces) {
    const len = Math.hypot(qx - px, qz - pz)
    const w = (len * 0.94 * placed.scale) / 2 + pad
    const nx = -(qz - pz) / len
    const nz = (qx - px) / len
    const f = new THREE.Group()
    const bar = (cx, cy, sx, sy) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, thick), material)
      m.position.set(cx, cy, 0)
      f.add(m)
    }
    bar(0, half, w * 2 + thick, thick)
    bar(0, -half, w * 2 + thick, thick)
    bar(-w, 0, thick, half * 2)
    bar(w, 0, thick, half * 2)
    f.position.set((px + qx) / 2 + nx * 0.06, placed.y, (pz + qz) / 2 + nz * 0.06)
    f.rotation.y = Math.atan2(qx - px, qz - pz) - Math.PI / 2
    g.add(f)
  }
  return g
}

function clearGroup(g, own = false) {
  if (!g) return
  g.traverse((o) => {
    o.geometry?.dispose()
    if (own && o.material) o.material.dispose()
  })
  g.clear()
}

const ringMat = new THREE.MeshBasicMaterial({ color: 0xffcf3a, fog: false })
let ringFor = null
function showRing(placed) {
  if (ringFor === placed) return
  ringFor = placed
  clearGroup(ring)
  ring.visible = !!placed
  keyMark.visible = !!placed
  if (placed) ring.add(frameOf(placed, ringMat, 0.08, 0.05))
}

// --- 이야기 속 사람들(판 그림) ---------------------------------------------------------
// 화면을 보는 판이라 윗부분이 벽에 묻힌다: 깊이 검사를 끄고 가까울 때만 보인다
const texCache = new Map()
function npcTex(name) {
  let e = texCache.get(name)
  if (!e) {
    e = { tex: null, wait: [] }
    const src = art(name)
    if (src) {
      e.tex = new THREE.TextureLoader().load(src, (t) => {
        for (const fn of e.wait) fn(t)
        e.wait = []
      })
      e.tex.magFilter = THREE.NearestFilter
      e.tex.colorSpace = THREE.SRGBColorSpace
    }
    texCache.set(name, e)
  }
  return e
}

function npcSprite(name, h) {
  const e = npcTex(name)
  if (!e.tex) return null
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: e.tex, fog: false, alphaTest: 0.5, depthTest: false }))
  s.center.set(0.5, 0)
  s.renderOrder = 4
  const fit = (t) => s.scale.set((h * t.image.width) / t.image.height, h, 1)
  s.scale.set(h * 0.7, h, 1)
  if (e.tex.image?.width) fit(e.tex)
  else e.wait.push(fit)
  return s
}

const tagTex = {}
function tagSprite(kind) {
  tagTex[kind] ||= kind === 'boss' ? tagTexture('!', '#ff4d6d', '#fff') : kind === 'folk' ? tagTexture('💡', '', '#fff', 40) : tagTexture('!', '#ffcf3a', '#1b1622')
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex[kind], depthTest: false, fog: false }))
  s.scale.set(0.62, 0.62, 1)
  s.renderOrder = 6
  return s
}

// 길잡이는 내 뒤를 따라오다가, 길잡이 가게 차례면 먼저 가서 기다린다
const guidePos = { x: 0, z: 0, moving: false }
// 곧 말을 꺼낼 사람: 불이 켜지거나 보스가 진 뒤 대화창이 뜨기 전까지 사라지지 않게 붙잡아 둔다
let talker = null
let npcs = []
function syncNpcs() {
  for (const n of npcs) {
    n.sprite.material.dispose()
    n.tag?.material.dispose()
  }
  npcGroup.clear()
  npcs = []
  const st = story.value
  if (!st || st.done) return
  const add = (kind, name, h, at, tag, ref = null) => {
    const sprite = npcSprite(name, h)
    if (!sprite) return
    const t = tag ? tagSprite(tag) : null
    npcGroup.add(sprite)
    if (t) npcGroup.add(t)
    npcs.push({ kind, sprite, tag: t, at, h, ref })
  }
  const own = st.ch.steps[st.step]?.own
  if (st.guide) add('guide', `c-${st.ch.npc.id}`, 2.2, guidePos, own && st.shop ? 'owner' : '')
  if (st.shop && st.ownerAt && !own && !(st.build && !st.build.done)) add('owner', `f-${spriteOf(st.shop.sign.cat)}`, 2.0, st.ownerAt, st.boss?.alive ? '' : 'owner')
  if (st.boss?.alive) add('boss', `c-${st.boss.id}`, 3.4, st.boss.at, 'boss')
  for (const f of st.folks || []) if (!f.done) add('folk', `f-${f.id}`, 2.0, f.at, 'folk', f)
  // 말하고 있는 사람은 이야기가 다음으로 넘어갔어도 대화가 끝날 때까지 그 자리에 남는다
  const stay = dialog.value?.stay || talker
  if (stay && !npcs.some((n) => n.at === stay.at)) add(stay.kind || 'owner', stay.name, stay.h, stay.at)
}

function updateGuide(dt) {
  const st = story.value
  if (!st || st.done || !st.guide) return
  // 첫 인사를 마치기 전이나 대화하는 동안에는 먼저 가 버리지 않고 내 옆에 서 있는다
  const own = st.ch.steps[st.step]?.own && st.ownerAt && st.met && !dialog.value
  const tx = own ? st.ownerAt.x : player.pos.x - player.face.x * 1.8 * B
  const tz = own ? st.ownerAt.z : player.pos.z - player.face.y * 1.8 * B
  const dx = tx - guidePos.x
  const dz = tz - guidePos.z
  const d = Math.hypot(dx, dz)
  if (d > (own ? 70 : 30)) {
    // 너무 멀어지면 화면 밖에서 따라붙는다
    Object.assign(guidePos, own ? st.ownerAt : freeSpot(tx, tz))
    return
  }
  guidePos.moving = d > (own ? 0.3 : 1.2)
  if (!guidePos.moving) return
  const v = Math.min(d, (own ? 13 : Math.max(5, d * 2.4)) * dt)
  const nx = guidePos.x + (dx / d) * v
  const nz = guidePos.z + (dz / d) * v
  if (!blocked(nx, guidePos.z) || own) guidePos.x = nx
  if (!blocked(guidePos.x, nz) || own) guidePos.z = nz
}

function updateNpcs(t) {
  for (const n of npcs) {
    const d = Math.hypot(n.at.x - player.pos.x, n.at.z - player.pos.z)
    const show = d < (n.kind === 'boss' ? 30 : 22)
    const bob = n.kind === 'boss' ? Math.sin(t * 2) * 0.15 + 0.1 : n.kind === 'guide' && guidePos.moving ? Math.abs(Math.sin(t * 9)) * 0.1 : Math.abs(Math.sin(t * 2.4)) * 0.06
    n.sprite.visible = show
    n.sprite.position.set(n.at.x, bob, n.at.z)
    if (n.tag) {
      n.tag.visible = show
      n.tag.position.set(n.at.x, n.h + 0.45 + Math.sin(t * 5) * 0.08, n.at.z)
    }
  }
}

// --- 불꽃 가루 -----------------------------------------------------------------
const SPARKS = 600
let sparks = null
const sparkVel = new Float32Array(SPARKS * 3)
const sparkLife = new Float32Array(SPARKS)
let sparkNext = 0
function makeSparks() {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3).fill(-999), 3))
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3))
  sparks = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
  sparks.frustumCulled = false
  scene.add(sparks)
}

function burst(x, y, z, nx, nz, color, n = 70) {
  const pos = sparks.geometry.attributes.position
  const col = sparks.geometry.attributes.color
  for (let i = 0; i < n; i++) {
    const s = sparkNext++ % SPARKS
    pos.setXYZ(s, x, y, z)
    const yellow = Math.random() < 0.35
    const c = yellow ? new THREE.Color(0xffe27a) : color
    col.setXYZ(s, c.r * 1.6, c.g * 1.6, c.b * 1.6)
    const sp = 2 + Math.random() * 4
    sparkVel[s * 3] = nx * sp + (Math.random() - 0.5) * 4
    sparkVel[s * 3 + 1] = Math.random() * 5 + 1
    sparkVel[s * 3 + 2] = nz * sp + (Math.random() - 0.5) * 4
    sparkLife[s] = 0.8 + Math.random() * 0.7
  }
  col.needsUpdate = true
}

function updateSparks(dt) {
  const pos = sparks.geometry.attributes.position
  let any = false
  for (let s = 0; s < SPARKS; s++) {
    if (sparkLife[s] <= 0) continue
    any = true
    sparkLife[s] -= dt
    if (sparkLife[s] <= 0) {
      pos.setXYZ(s, 0, -999, 0)
      continue
    }
    sparkVel[s * 3 + 1] -= 9 * dt
    pos.setXYZ(s, pos.getX(s) + sparkVel[s * 3] * dt, Math.max(0.05, pos.getY(s) + sparkVel[s * 3 + 1] * dt), pos.getZ(s) + sparkVel[s * 3 + 2] * dt)
  }
  if (any) pos.needsUpdate = true
}

// --- 택시(주황 상자 차) ------------------------------------------------------------
let taxiMesh = null
function makeTaxi() {
  const g = new THREE.Group()
  const part = (sx, sy, sz, color, y, z = 0, basic = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), basic ? new THREE.MeshBasicMaterial({ color, fog: false }) : new THREE.MeshLambertMaterial({ color }))
    m.position.set(0, y, z)
    g.add(m)
    return m
  }
  part(1.9, 0.8, 4.2, 0xf08a1c, 0.7)
  part(1.7, 0.66, 2.1, 0x2a3442, 1.43, -0.2)
  part(0.9, 0.32, 0.42, 0xffec27, 1.92, -0.2, true)
  for (const x of [-0.62, 0.62]) {
    const l = part(0.36, 0.2, 0.08, 0xfff6c0, 0.78, 2.12, true)
    l.position.x = x
  }
  g.visible = false
  taxiMesh = g
  scene.add(g)
}

// --- 세계 만들기 --------------------------------------------------------------
function disposeGroup(g) {
  if (!g) return
  scene.remove(g)
  g.traverse((o) => {
    o.geometry?.dispose()
    if (o.material && !Object.values(mats).flat().includes(o.material) && o.material !== leafMats.trunk && o.material !== leafMats.leaf) {
      o.material.map?.dispose()
      o.material.dispose()
    }
  })
}

async function enter(next, start) {
  status.value = '간판을 세우는 중…'
  for (const g of [worldGroup, signGroup, treeGroup, mineGroup, traffic?.group, people?.group]) disposeGroup(g)
  mineGroup = null
  traffic?.dispose()
  people?.dispose()
  world = next
  grid = rasterize(world)
  worldGroup = meshWorld(grid, mats)
  scene.add(worldGroup)

  let seed = Math.round(world.lng * 1e4) ^ Math.round(world.lat * 1e4)
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  // 나무: 줄기·잎 블록을 인스턴스로 한 번에
  const t1 = plantTrees(grid, rand)
  const trunkAt = new Set(t1.trunk.filter(([, y]) => y === 0).map(([i, , k]) => `${i},${k}`))
  const t2 = plantStreetTrees(grid, world, (i, k) => trunkAt.has(`${i},${k}`))
  const trunk = [...t1.trunk, ...t2.trunk]
  const leaf = [...t1.leaf, ...t2.leaf]
  treeCells = new Set(trunk.filter(([, y]) => y === 0).map(([i, , k]) => k * grid.N + i))
  treeGroup = new THREE.Group()
  const cube = new THREE.BoxGeometry(B, B, B)
  const m = new THREE.Matrix4()
  for (const [list, mat] of [[trunk, leafMats.trunk], [leaf, leafMats.leaf]]) {
    const inst = new THREE.InstancedMesh(cube, mat, Math.max(1, list.length))
    list.forEach(([i, y, k], n) => inst.setMatrixAt(n, m.makeTranslation((i - grid.half + 0.5) * B, (y + 0.5) * B, (k - grid.half + 0.5) * B)))
    inst.count = list.length
    treeGroup.add(inst)
  }
  scene.add(treeGroup)

  traffic = makeTraffic(world, grid, rand)
  people = makePeople(grid, rand)
  scene.add(traffic.group, people.group)
  traffic.setFlow(new Map(), '원활')
  people.setCrowd('보통')

  const found = await signsAround(world.lng, world.lat, world.r).catch(() => ({ dense: false, rows: [] }))
  await document.fonts.load('20px Galmuri11').catch(() => {})
  signPlaced = placeSigns(grid, found.rows.slice(0, MAX_SIGNS))
  const made = meshSigns(signPlaced)
  signGroup = made.group
  signMeshes = made.meshes
  for (const s of signMeshes) patch(s.material, 'sign')
  scene.add(signGroup)
  for (const g of [worldGroup, traffic.group, people.group, signGroup]) patchGroup(g)
  mapBase = drawMapBase()
  resetTown()
  spawn(start)
  status.value = ''
}

// 불 켠 간판·쌓은 블록·빈터를 모두 걷어 내고 꺼진 동네로 되돌린다
function resetTown() {
  for (const l of litList) l.frame.traverse((o) => o.material?.dispose())
  clearGroup(neonGroup)
  litList = []
  litSet = new Set()
  litCount.value = 0
  wave = null
  voxels.clear()
  drawBlocks()
  showLot(null)
  if (mineGroup) {
    disposeGroup(mineGroup)
    signPlaced = signPlaced.filter((p) => !p.sign.mine)
    mineGroup = null
  }
  fx.uSpreadOn.value = 1
  fx.uSpreadN.value = 0
  fx.uWave.value.set(0, 0, 0)
  traffic?.setZone([])
  people?.setZone([])
}

// 이야기 밖 동네: 처음부터 색이 살아 있다
function freeTown() {
  wave = null
  fx.uSpreadOn.value = 0
  traffic?.setZone(null)
  people?.setZone(null)
}

function patchGroup(g) {
  g?.traverse((o) => {
    if (o.isMesh) for (const mm of [o.material].flat()) patch(mm)
  })
}

async function goPreset(p) {
  if (here === p.id && grid) {
    resetTown()
    spawn(p.start)
    return true
  }
  status.value = `${p.label} 지도를 펼치는 중…`
  try {
    await enter(await load(`world/${p.id}.json`), p.start)
    here = p.id
    return true
  } catch (e) {
    if (import.meta.env.DEV) console.error(e)
    status.value = ''
    flash('지도를 못 불러왔어요')
    return false
  }
}

const cellOf = (x, z) => [Math.floor(x / B + grid.half), Math.floor(z / B + grid.half)]
const cellMid = (i, k) => ({ x: (i - grid.half + 0.5) * B, z: (k - grid.half + 0.5) * B })

function groundFree(i, k) {
  const { N, height, ground } = grid
  if (i < 1 || k < 1 || i >= N - 1 || k >= N - 1) return false
  const c = k * N + i
  return !height[c] && ground[c] !== GROUND_ID.water && !treeCells.has(c)
}

const cellFree = (i, k) => groundFree(i, k) && !voxels.has(vkey(i, k))
const blocked = (x, z) => !cellFree(...cellOf(x, z))
const hits = (x, z) => blocked(x - R, z - R) || blocked(x + R, z - R) || blocked(x - R, z + R) || blocked(x + R, z + R)

function freeSpot(x, z) {
  const [ci, ck] = cellOf(x, z)
  let best = null
  for (let dk = -8; dk <= 8; dk++) {
    for (let di = -8; di <= 8; di++) {
      if (!cellFree(ci + di, ck + dk)) continue
      const d = di * di + dk * dk
      if (!best || d < best.d) best = { d, i: ci + di, k: ck + dk }
    }
  }
  if (!best) return { x, z }
  return cellMid(best.i, best.k)
}

// start: 가운데 기준 동·북 미터. 그 옆 빈 바닥(찻길은 피해서)에 선다
function spawn(start) {
  const { N, half, height, ground } = grid
  const oi = start ? start[0] / B + half : half
  const ok = start ? -start[1] / B + half : half
  let best = null
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      const c = k * N + i
      if (height[c] || ground[c] === GROUND_ID.water || treeCells.has(c)) continue
      const d = (i - oi) ** 2 + (k - ok) ** 2 + (ground[c] === GROUND_ID.road ? 40 : 0)
      if (!best || d < best.d) best = { d, i, k }
    }
  }
  player.pos.set((best.i - half + 0.5) * B, 0, (best.k - half + 0.5) * B)
  cam.target.copy(player.pos)
}

// 간판 면 가운데와 바깥쪽 법선 (장면 좌표)
function signAt(p) {
  const [px, pz, qx, qz] = p.faces[0]
  const len = Math.hypot(qx - px, qz - pz) || 1
  return { x: (px + qx) / 2, y: p.y, z: (pz + qz) / 2, nx: -(qz - pz) / len, nz: (qx - px) / len }
}

const distTo = (o) => (o ? Math.hypot(o.x - player.pos.x, o.z - player.pos.z) : 99)

// --- 불 켜기 ------------------------------------------------------------------
// 셰이더가 받는 불빛 자리는 MAX_LIT 개까지. 넘치면 오래된 작은 불빛부터 번짐을 거두고 네온 틀만 남긴다
function lightUp(placed, R0 = 20) {
  if (litSet.has(placed)) return null
  litSet.add(placed)
  const s = signAt(placed)
  const color = placed.sign.mine ? new THREE.Color(0xffd60a) : neonOf(pastelOf(placed.sign.cat))
  const frame = frameOf(placed, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.6), fog: false }))
  neonGroup.add(frame)
  if (litList.length >= MAX_LIT) {
    const n = litList.findIndex((l) => !l.keep)
    const [old] = litList.splice(n < 0 ? 0 : n, 1)
    old.frame.visible = true
  }
  litList.push({ placed, x: s.x, y: s.y, z: s.z, R: R0, r: 0, t0: performance.now() / 1000, color, frame, keep: R0 > 30 })
  litCount.value = litSet.size
  sfx.neon(Math.min(litSet.size - 1, 12))
  burst(s.x + s.nx * 0.2, s.y, s.z + s.nz * 0.2, s.nx, s.nz, color)
  shake = 0.25
  showRing(null)
  near.value = null
  return color
}

let toastTimer = 0
function showToast(v, ms = 2400) {
  toast.value = v
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), ms)
}

let noticeTimer = 0
function flash(text, ms = 2600) {
  notice.value = text
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (notice.value = ''), ms)
}

// 도감에 담는다. 새로 담았으면 true
function collect(s) {
  const key = `${s.name}|${s.cat}`
  if (dexSet.value.has(key)) return false
  dex.value = [...dex.value, key].slice(-3000)
  try {
    localStorage.setItem(DEX_KEY, JSON.stringify(dex.value))
  } catch {
    // 저장이 막히면 이번 방문 동안만 센다
  }
  return true
}

// 이야기 중이면 고치고, 아니면 불을 켜며 도감에 담는다
function useSign(p) {
  if (storyOn.value) return repair(p)
  const color = lightUp(p, 20)
  const fresh = collect(p.sign)
  fresh ? sfx.right() : sfx.click()
  showToast({ name: p.sign.name, color: `#${(color || neonOf(pastelOf(p.sign.cat))).getHexString()}`, tag: fresh ? '도감 +1' : '' })
}

// --- 이야기 ---------------------------------------------------------------------
const vars = (shop, next, score = '') => ({ shop: shop?.sign.name || '', next: next?.sign.name || '', nextCat: next?.sign.cat || '', me: myName(), score: score ?? '', need: BUILD.need })

// 사장님은 간판 앞 길가에 나와 서 있다
function ownerSpot(p) {
  const s = signAt(p)
  return freeSpot(s.x + s.nx * 1.6 * B, s.z + s.nz * 1.6 * B)
}

// 보스는 그 가게 앞길을 막고 선다(가게 사장님 옆)
function bossOf(step, shop) {
  if (!step?.boss || !shop || !BOSSES[step.boss]) return null
  const s = signAt(shop)
  const at = freeSpot(s.x + (s.nx * 3.2 - s.nz * 2) * B, s.z + (s.nz * 3.2 + s.nx * 2) * B)
  return { id: step.boss, at, alive: true }
}

// 다음에 갈 가게: 지금 자리에서 30~160m 사이, 아직 꺼진 그 업종 간판. 없으면 가까운 꺼진 아무 간판
function nextShop(from, want, used) {
  const cand = signPlaced
    .filter((p) => !used.includes(p) && !litSet.has(p) && !p.sign.mine)
    .map((p) => {
      const s = signAt(p)
      return { p, d: Math.hypot(s.x - from.x, s.z - from.z) }
    })
    .sort((a, b) => a.d - b.d)
  const far = cand.filter((c) => c.d > 30 && c.d < 160)
  const pick = far.find((c) => want.test(c.p.sign.cat)) || cand.find((c) => c.d > 30 && want.test(c.p.sign.cat) && c.d < 260) || far[0] || cand[0]
  return pick?.p || null
}

// 동네 사람은 꺼진 간판 근처 길가에 흩어져 선다(서로 24m 넘게 떨어지게)
function placeFolks(ids = []) {
  const pool = signPlaced
    .filter((p) => !litSet.has(p) && !p.sign.mine)
    .map((p) => ({ p, s: signAt(p) }))
    .map((c) => ({ ...c, d: Math.hypot(c.s.x - player.pos.x, c.s.z - player.pos.z) }))
    .filter((c) => c.d > 25 && c.d < 140)
    .sort(() => Math.random() - 0.5)
  const out = []
  for (const id of ids) {
    if (!FOLKS[id]) continue
    const c = pool.find((c) => out.every((f) => Math.hypot(f.at.x - c.s.x, f.at.z - c.s.z) > 24))
    if (!c) break
    out.push({ id, name: FOLKS[id].name, at: freeSpot(c.s.x + c.s.nx * 2.6 * B, c.s.z + c.s.nz * 2.6 * B), done: false })
  }
  return out
}

function clearFx() {
  story.value = null
  dialog.value = null
  chat.value = null
  cine = null
  talker = null
  showLot(null)
}

// 장 시작: 지하철 카드를 띄운 채 그 동네로 가서, 안내하는 사람을 내 옆에 세운다
let rideTimer = 0
async function startStory(n) {
  const ch = CHAPTERS[n]
  const preset = PRESETS.find((p) => p.id === ch.id)
  clearTimeout(rideTimer)
  onTitle.value = false
  menu.value = false
  panel.value = ''
  paused.value = true
  keys.clear()
  clearFx()
  endTaxi()
  ride.value = rideOf(n)
  sfx.whoosh(true)
  const shown = performance.now()
  const ok = await goPreset(preset)
  const rideLeft = Math.max(600, 2600 - (performance.now() - shown))
  rideTimer = setTimeout(() => (ride.value = null), rideLeft)
  if (!ok || !grid) return
  setTime(ch.time || 'night', true)
  weatherFx.set(ch.weather)
  cam.dist = 21
  cam.pitch = 0.9
  const shop = nextShop(player.pos, ch.steps[0].want, [])
  const goal = Math.min(ch.steps.length, signPlaced.length)
  Object.assign(guidePos, freeSpot(player.pos.x + 1.6 * B, player.pos.z + 0.6 * B), { moving: false })
  const folks = placeFolks(ch.folks)
  story.value = { n, ch, step: 0, goal, lit: 0, shop, used: shop ? [shop] : [], done: false, guide: true, ownerAt: shop && ownerSpot(shop), boss: bossOf(ch.steps[0], shop), folks, gameDone: false, score: null, build: null }
  // 지하철 카드가 걷힌 뒤에 말을 건다
  const met = () => {
    if (story.value?.ch === ch) story.value = { ...story.value, met: true }
    resume()
  }
  setTimeout(() => story.value?.ch === ch && say(whoOf(ch.npc), ch.intro.map((l) => fill(l, vars(null, shop))), { then: met }), rideLeft + 300)
}

// 동네 사람에게 말 걸기: 근처 꺼진 간판 이름을 소리 내어 읽으면 그 간판에 불이 들어온다
function talkFolk(f) {
  const st = story.value
  const who = whoOf({ id: f.id, name: f.name, face: '💡' })
  const sign = signPlaced
    .filter((p) => !litSet.has(p) && p !== st.shop && !p.sign.mine)
    .map((p) => ({ p, d: distTo(signAt(p)) }))
    .filter((c) => c.d < 40)
    .sort((a, b) => a.d - b.d)[0]?.p
  story.value = { ...st, folks: st.folks.map((o) => (o === f ? { ...o, done: true } : o)) }
  sfx.click()
  const stay = { kind: 'folk', name: `f-${f.id}`, h: 2.0, at: f.at }
  if (!sign) return say(who, [fill(FOLK_IDLE[Math.floor(Math.random() * FOLK_IDLE.length)], vars(null, st.shop))], { stay })
  const [first, then] = FOLKS[f.id].lines.map((l) => fill(l, { ...vars(null, st.shop), sign: sign.sign.name }))
  say(who, [first], {
    stay,
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
  shake = 0.35
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
  const at = st.boss?.at
  // 진 보스는 마지막 말을 다 하고 나서 흩어진다
  const stay = at && { kind: 'boss', name: `c-${q.boss}`, h: 3.4, at }
  talker = stay
  story.value = { ...st, gameDone: true, score: q.score ?? 0, boss: st.boss && { ...st.boss, alive: false } }
  sfx.win()
  if (q.boss === 'cloud') weatherFx.set('clear')
  paused.value = true
  setTimeout(() => {
    if (story.value?.ch !== st.ch) return
    say(q.who, BOSSES[q.boss].win.map((l) => fill(l, vars(q.placed, null))), {
      tone: 'boss',
      cut: `${q.boss}-win`,
      stay,
      then: () => {
        if (at) {
          burst(at.x, 1.6, at.z, 0, 0, new THREE.Color(0xff4d6d), 140)
          shake = 0.5
        }
        repair(q.placed)
      },
    })
  }, 900)
}

function hintOf(st) {
  if (st.build && !st.build.done) return `노란 빈터에 블록 ${BUILD.need}개! 「${st.build.name}」이 문을 열어요`
  if (!st.shop) return '이 동네는 거의 다 켰어요!'
  if (st.boss?.alive) return `「${st.shop.sign.name}」 앞을 ${BOSSES[st.boss.id].name}이(가) 막고 있어. 빨간 ! 앞으로!`
  const folk = st.folks?.find((f) => !f.done)
  return `빛기둥을 따라가면 「${st.shop.sign.name}」 사장님이 기다려.${folk ? ' 💡 사람은 간판 이름을 읽어 줄 거야' : ''}`
}

function say(npc, lines, opts = {}) {
  paused.value = true
  keys.clear()
  const w = 'portrait' in npc ? npc : whoOf(npc)
  talker = null
  dialog.value = { who: w.name, face: w.face || '', portrait: w.portrait || '', tone: w.tone || 'npc', lines, i: 0, ...opts }
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

// 간판 고치기: 판이 지직거리다 켜지고 둘레로 색이 번진다
function repair(placed) {
  const st = story.value
  if (!placed || !st) return
  const isShop = placed === st.shop
  // 부탁 놀이가 붙은 가게는 놀이를 끝내야 불이 들어온다
  const want = isShop ? st.ch.steps[st.step] : null
  if (isShop && st.boss?.alive) return askBoss()
  if (want?.game && want.game !== 'build' && !st.gameDone) return askQuest(placed, want)
  if (litSet.has(placed)) return
  const color = lightUp(placed, isShop ? 34 : 20)
  collect(placed.sign)
  showToast({ name: placed.sign.name, color: `#${color.getHexString()}`, tag: isShop ? `${st.step + 1}/${st.goal}` : '' }, 2600)
  const owner = ownerWho(placed.sign)
  if (!isShop) {
    story.value = { ...st, lit: litSet.size }
    speak(owner, owner.line)
    return
  }
  // 부탁받은 가게에 불이 들어오면 그 사장님이 본 것을 들려주고 다음 가게를 알려 준다
  const step = st.ch.steps[st.step]
  const lastStep = st.step + 1 >= st.goal
  const shop = lastStep ? null : nextShop(signAt(placed), st.ch.steps[st.step + 1].want, st.used)
  const stay = !step.own && st.ownerAt && { name: `f-${spriteOf(placed.sign.cat)}`, h: 2.0, at: st.ownerAt }
  talker = stay
  story.value = { ...st, lit: litSet.size, step: st.step + 1, shop, used: shop ? [...st.used, shop] : st.used, gameDone: false, score: null, ownerAt: shop && ownerSpot(shop), boss: lastStep ? null : bossOf(st.ch.steps[st.step + 1], shop) }
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
    say(step.own ? whoOf(st.ch.npc) : owner, lines, { stay, then: lastStep ? end : resume })
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
  menu.value = false
  keys.clear()
  const word = opts.word ?? (game === 'booth' || game === 'map' ? myName() : '')
  const qp = { ...(q.mode ? { mode: q.mode } : {}), ...(word ? { word } : {}) }
  if (opts.placed) Object.assign(qp, { embed: true })
  // 부탁 놀이: 부탁한 사람 그림·이름과 그 가게 간판을 장면에 세운다
  if (opts.placed && !opts.boss) {
    const w = opts.who || {}
    const ownerArt = w.sprite ? art(`f-${w.sprite}`) : w.id ? art(`c-${w.id}`) || art(`f-${w.id}`) : ''
    Object.assign(qp, { ownerName: w.name || '', ownerArt, shopName: opts.placed.sign?.name || '' })
  }
  if (opts.boss) Object.assign(qp, { goal: BOSS_GOAL[game] || 10, boss: art(`c-${opts.boss}`), bossName: BOSSES[opts.boss]?.name || '' })
  const next = { game, ...q, props: qp, placed: opts.placed || null, who: opts.who || null, boss: opts.boss || null, then: opts.then || null, done: false, score: null }
  rowWipe(() => (quest.value = next))
}

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
  back()
}

function questQuit() {
  const q = quest.value
  if (!q || wipe.value) return
  rowWipe(() => {
    quest.value = null
    if (q.then) return q.then(q)
    back()
  })
}

function saveShop(v) {
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
  say(whoOf(st.ch.npc), BUILD.pick.map((l) => fill(l, vars(null, null))), {
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
  showLot(lot)
  checkBuild()
  const v = { ...vars(null, null), shop: name }
  say(whoOf(st.ch.npc), [fill(BUILD.start[0], v), touch ? '블록 12개면 충분해. 놓기 단추로 쌓아 봐!' : '블록 12개면 충분해. Q 로 쌓고, X 로 빼고, 1~5 로 블록을 골라!'])
}

// 내 옆 12칸 안에서 4×4 가 모두 빈 땅인 자리. 찻길은 덜 고른다
function findLot(n = BUILD.lot) {
  const [pi, pk] = cellOf(player.pos.x, player.pos.z)
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

const lotCenter = (lot) => ({ x: (lot.i0 + lot.n / 2 - grid.half) * B, z: (lot.k0 + lot.n / 2 - grid.half) * B })
const inLot = (lot, i, k) => !lot || (i >= lot.i0 && i < lot.i0 + lot.n && k >= lot.k0 && k < lot.k0 + lot.n)

// 빈터: 바닥에 노란 테두리와 옅은 판
const lotMat = new THREE.MeshBasicMaterial({ color: 0xffcf3a, fog: false })
const lotFill = new THREE.MeshBasicMaterial({ color: 0xffcf3a, transparent: true, opacity: 0.16, depthWrite: false, fog: false })
function showLot(lot) {
  clearGroup(lotGroup)
  if (!lot || !grid) return
  const c = lotCenter(lot)
  const S = lot.n * B
  const bar = (x, z, sx, sz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.08, sz), lotMat)
    m.position.set(x, 0.06, z)
    lotGroup.add(m)
  }
  bar(c.x, c.z - S / 2, S, 0.14)
  bar(c.x, c.z + S / 2, S, 0.14)
  bar(c.x - S / 2, c.z, 0.14, S)
  bar(c.x + S / 2, c.z, 0.14, S)
  const f = new THREE.Mesh(new THREE.PlaneGeometry(S, S), lotFill)
  f.rotation.x = -Math.PI / 2
  f.position.set(c.x, 0.04, c.z)
  lotGroup.add(f)
}

const blockGeo = new THREE.BoxGeometry(B, B, B)
function drawBlocks() {
  blockGroup.clear()
  if (!grid) return
  for (const [key, col] of voxels) {
    const [i, k] = key.split(',').map(Number)
    const { x, z } = cellMid(i, k)
    col.forEach((type, y) => {
      const m = new THREE.Mesh(blockGeo, blockMats[type].mat)
      m.position.set(x, (y + 0.5) * B, z)
      blockGroup.add(m)
    })
  }
}

// 내 앞 칸(바라보는 쪽으로 한 칸)
function frontCell() {
  const [pi, pk] = cellOf(player.pos.x, player.pos.z)
  for (const r of [1, 1.4]) {
    const c = cellOf(player.pos.x + player.face.x * r * B, player.pos.z + player.face.y * r * B)
    if (c[0] !== pi || c[1] !== pk) return c
  }
  return null
}

function placeBlock() {
  const c = frontCell()
  if (!c || !groundFree(...c)) return sfx.tick()
  const key = vkey(...c)
  const col = voxels.get(key) || []
  if (col.length >= 6) return sfx.tick()
  voxels.set(key, [...col, slot.value])
  // 내 자리를 막으면 거둔다
  if (hits(player.pos.x, player.pos.z)) {
    col.length ? voxels.set(key, col) : voxels.delete(key)
    return sfx.tick()
  }
  sfx.build(slot.value)
  const { x, z } = cellMid(...c)
  burst(x, (col.length + 1) * B, z, 0, 0, new THREE.Color(0xffcf3a), 14)
  drawBlocks()
  checkBuild()
}

function breakBlock() {
  const c = frontCell()
  const key = c && vkey(...c)
  const col = key && voxels.get(key)
  if (!col) return sfx.tick()
  col.length > 1 ? voxels.set(key, col.slice(0, -1)) : voxels.delete(key)
  sfx.tick()
  drawBlocks()
  checkBuild()
}

// 빈터 안 블록 수. 다 쌓으면 바로 간판을 단다
function checkBuild() {
  const st = story.value
  const b = st?.build
  if (!b || b.done) return
  let count = 0
  for (const [key, col] of voxels) {
    const [i, k] = key.split(',').map(Number)
    if (inLot(b.lot, i, k)) count += col.length
  }
  if (count === b.count) return
  story.value = { ...st, build: { ...b, count } }
  if (count >= BUILD.need) {
    sfx.right()
    setTimeout(finishBuild, 500)
  }
}

// 다 지으면 빈터 앞에 내 간판을 달고 불을 켠다
function finishBuild() {
  const st = story.value
  const b = st?.build
  if (!b || b.done || b.count < BUILD.need) return
  const lot = b.lot
  const c = lot ? lotCenter(lot) : { x: player.pos.x, z: player.pos.z }
  const S = (lot?.n || 2) * B
  const zf = c.z + S / 2 + 0.03
  const sign = { name: b.name, cat: b.cat, floor: 1, mine: true }
  const placed = { sign, faces: [[c.x - S / 2 + 0.2, zf, c.x + S / 2 - 0.2, zf]], y: B * 1.3, scale: 1 }
  signPlaced.push(placed)
  const made = meshSigns([placed])
  mineGroup = made.group
  for (const s of made.meshes) patch(s.material, 'sign')
  scene.add(mineGroup)
  lightUp(placed, 44)
  showLot(null)
  saveShop({ name: b.name, cat: b.cat, place: PRESETS.find((p) => p.id === here)?.label || '', blocks: b.count, at: new Date().toISOString() })
  story.value = { ...st, build: { ...b, done: true } }
  showToast({ name: b.name, color: '#ffd60a', tag: '내 가게' }, 3200)
  setTimeout(() => {
    if (story.value?.ch !== st.ch) return
    say(whoOf(st.ch.npc), BUILD.done.map((l) => fill(l, { ...vars(null, null), shop: b.name })), {
      choices: [
        { label: '진짜 지도에도 걸기 ▶', fn: () => openQuest('open', { word: b.name, then: finishChapter }) },
        { label: '이대로 좋아요', fn: finishChapter },
      ],
    })
  }, 900)
}

// --- 장 끝 -----------------------------------------------------------------------
// 동네 전체로 색이 번지고 카메라가 높이 올라가 동네 전체를 내려다본다
function finishChapter() {
  const st = story.value
  if (!st) return
  story.value = { ...st, done: true }
  if (!cleared.value.includes(st.ch.id)) {
    cleared.value = [...cleared.value, st.ch.id]
    saveCleared(cleared.value)
  }
  const t = performance.now() / 1000
  wave = { x: player.pos.x, z: player.pos.z, t0: t }
  if (st.ch.doneTime) setTime(st.ch.doneTime)
  paused.value = true
  keys.clear()
  cine = { t0: t, dist: cam.dist, pitch: cam.pitch }
  setTimeout(() => sfx.dawn(), 600)
  setTimeout(() => {
    if (story.value?.ch !== st.ch) return
    const lastCh = st.n + 1 >= CHAPTERS.length
    const stay = {
      label: '이 동네 더 둘러보기',
      fn: () => {
        endCine()
        resume()
      },
    }
    const next = lastCh
      ? { label: '서울 타임머신 ▶', fn: () => say({ name: '서울 타임머신', face: '🕰️', portrait: '', tone: 'system' }, ENDING, { then: startMachine }) }
      : { label: `▶ ${CHAPTERS[st.n + 1].title}`, fn: () => startStory(st.n + 1) }
    say(whoOf(st.ch.npc), st.ch.done.map((l) => fill(l, vars(null, null))), { choices: [next, stay] })
  }, 5200)
}

function endCine() {
  cine = null
  cam.dist = 21
  cam.pitch = 0.9
}

// --- 서울 타임머신 -----------------------------------------------------------------
// 건물이 사용승인 연도 순서대로 땅에서 솟아오른다
let machineList = []
let machineYear = 0
let lastTick = 0
function startMachine() {
  if (!grid) return
  const known = (world.b || []).map(([h, name, , , floors, use, year]) => ({ h, name, floors, use, year })).filter((b) => b.year)
  if (!known.length) {
    flash('이 지도에는 건물 연도 자료가 없어요')
    return openMenu()
  }
  clearFx()
  endTaxi()
  machineList = known.sort((a, b) => a.year - b.year)
  const min = Math.max(1900, machineList[0].year - 2)
  paused.value = true
  keys.clear()
  setTime('day', true)
  weatherFx.set('clear')
  freeTown()
  for (const g of [signGroup, neonGroup, mineGroup, npcGroup, blockGroup, traffic.group, people.group, avatar, ghost, shadow]) if (g) g.visible = false
  scene.fog.near = 300
  scene.fog.far = 1100
  cine = { machine: true }
  machine.value = { min, max: 2026, year: min, playing: true, count: 0, recent: [] }
  machineYear = min
  lastTick = min
  fx.uYear.value = min
  sfx.click()
}

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
  machine.value = { ...machine.value, year: y, count: built.length, recent: fresh.slice(0, 3) }
}

function setMachine(p) {
  machine.value = { ...machine.value, ...p }
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
  machine.value = null
  fx.uYear.value = 9999
  for (const g of [signGroup, neonGroup, mineGroup, npcGroup, blockGroup, traffic.group, people.group, avatar, ghost, shadow]) if (g) g.visible = true
  scene.fog.near = 30
  scene.fog.far = 170
  endCine()
  cam.target.copy(player.pos)
  setTime('morning', true)
  sfx.click()
  openMenu()
}

// --- 택시 ----------------------------------------------------------------------
// 손 흔들면 와서 서고, 고른 곳까지 태워 준다. 손님 태우기는 미터기 시간 안에 직접 몰고 간다
const TAXI = { name: '택시 기사님', face: '🚕', portrait: '', tone: 'npc' }
const PASSENGER = { name: '손님', face: '🧳', portrait: '', tone: 'npc' }
const COMPASS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서']
// 북쪽 = -z
const compassOf = (dx, dz) => COMPASS[Math.round(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) / 45) % 8]
const lerp = (a, b, k) => a + (b - a) * k
let cab = null
let fareRun = null

function hailTaxi() {
  if (cab?.phase === 'drive' && !paused.value) return endFare(false)
  if (cab || paused.value || dialog.value || quest.value || machine.value || cine || !grid) return
  if (building.value) return speak(TAXI, '공사 중에는 못 모셔요. 블록부터 쌓고 부르세요!')
  paused.value = true
  keys.clear()
  sfx.horn()
  // 화면 안쪽에서 달려와 내 옆에 선다
  const { fwd, right } = camAxes()
  const to = { x: player.pos.x + right.x * 2.6, z: player.pos.z + right.z * 2.6 }
  const from = { x: to.x + fwd.x * 30, z: to.z + fwd.z * 30 }
  cab = { phase: 'come', t0: performance.now() / 1000, from, to, x: from.x, z: from.z, dir: { x: -fwd.x, z: -fwd.z }, hide: false }
}

// 갈 만한 곳: 이야기 중이면 부탁받은 가게, 아니면 멀리 있는 아직 안 담은 간판 둘과 다른 동네
function taxiChoices() {
  const st = story.value
  const out = []
  const go = (label, at, then = null) => out.push({ label, fn: () => taxiGo(at, then) })
  if (st && !st.done && st.shop) {
    go(`「${st.shop.sign.name}」 앞으로 ▶`, st.ownerAt || ownerSpot(st.shop))
  } else {
    const far = signPlaced
      .filter((p) => !p.sign.mine && !dexSet.value.has(`${p.sign.name}|${p.sign.cat}`))
      .map((p) => ({ p, d: distTo(signAt(p)) }))
      .filter((c) => c.d > 60 && c.d < 260)
    for (let n = 0; n < 2 && far.length; n++) {
      const { p } = far.splice(Math.floor(Math.random() * far.length), 1)[0]
      go(`「${p.sign.name}」 앞으로`, ownerSpot(p))
    }
    const at = PRESETS.findIndex((p) => p.id === here)
    const other = PRESETS[(at + 1) % PRESETS.length]
    if (other && other.id !== here) out.push({ label: `${other.label}(으)로 가 주세요`, fn: () => taxiGo(null, () => goTown(other)) })
    out.push({ label: '제가 몰아 볼게요 (손님 태우기)', fn: startFare })
  }
  out.push({ label: '그냥 걸을게요', fn: taxiCancel })
  return out
}

// 이야기 밖에서 다른 동네로: 처음부터 색이 살아 있다
async function goTown(p) {
  clearFx()
  if (await goPreset(p)) {
    freeTown()
    setTime('night', true)
    weatherFx.set('clear')
  }
}

function taxiAsk() {
  const st = story.value
  const line = st && !st.done && st.shop ? `어서 오세요! 「${st.shop.sign.name}」 가시죠? 거기 간판 꺼졌다고 다들 난리던데.` : '어서 오세요! 어디로 모실까요?'
  say(TAXI, [line], { choices: taxiChoices() })
}

function taxiGo(at, then) {
  sfx.click()
  cab = { ...cab, phase: 'board', t0: performance.now() / 1000, at, then, hide: false }
}

function startFare() {
  const far = signPlaced
    .filter((p) => p.sign?.name && !p.sign.mine)
    .map((p) => ({ p, s: signAt(p) }))
    .map((c) => ({ ...c, d: distTo(c.s) }))
    .filter((c) => c.d > 70 && c.d < 220 && Math.max(Math.abs(c.s.x), Math.abs(c.s.z)) < world.r * 0.4)
  if (!far.length) return say(TAXI, ['오늘은 손님이 없네요. 다음에 몰아 봐요!'], { then: taxiCancel })
  const { p, d } = far[Math.floor(Math.random() * far.length)]
  const at = ownerSpot(p)
  // 미터기 시간: 곧장 가면 넉넉하고, 헤매면 빠듯하다
  const limit = Math.round(d / 7 + 25)
  fareRun = { p, at, limit, el: 0, last: 0, started: false, hintT: 0, lastD: d }
  cab = { ...cab, phase: 'drive', hide: true }
  player.pos.set(cab.x, 0, cab.z)
  if (hits(player.pos.x, player.pos.z)) Object.assign(player.pos, freeSpot(player.pos.x, player.pos.z))
  const way = `${compassOf(at.x - player.pos.x, at.z - player.pos.z)}쪽으로 ${Math.round(d / 10) * 10}m쯤`
  say(PASSENGER, [`「${p.sign.name}」 앞에 내려 주세요. ${limit}초 안에 가면 팁 드릴게요!`, `내비가 고장이라… ${way}일 거예요.`], {
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
  // 차에서 내려 옆에 선다
  const { right } = camAxes()
  const out = freeSpot(player.pos.x - right.x * 2.4, player.pos.z - right.z * 2.4)
  cab = { ...cab, phase: 'wait', hide: false, x: player.pos.x, z: player.pos.z, dir: { x: player.face.x, z: player.face.y } }
  player.pos.set(out.x, 0, out.z)
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
  collect(f.p.sign)
  lightUp(f.p, 20)
  const lines = [`도착! 미터기 ${won.toLocaleString()}원${tip ? `, 팁 ${tip.toLocaleString()}원 얹었어요` : ''}.`, `「${f.p.sign.name}」 간판은 도감에 담아 뒀어요.`]
  if (total) lines.push(`지금까지 번 돈: ${total.toLocaleString()}원`)
  say(PASSENGER, lines, { then: taxiCancel })
}

// 손님 태우고 달리는 중: 택시가 나를 따라오고, 미터기가 돌고, 손님이 가끔 한마디 한다
function runFare(t) {
  const r = cab
  const f = fareRun
  r.x = player.pos.x
  r.z = player.pos.z
  r.dir = { x: player.face.x, z: player.face.y }
  if (!f) return
  const dt = f.last ? t - f.last : 0
  f.last = t
  if (!f.started || paused.value) return
  f.el += dt
  const d = distTo(f.at)
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
  if (!cab) return back()
  cab = { ...cab, phase: 'off', t0: performance.now() / 1000, from: { x: cab.x, z: cab.z }, to: { x: cab.x + cab.dir.x * 40, z: cab.z + cab.dir.z * 40 }, hide: false }
}

function endTaxi() {
  cab = null
  fareRun = null
  fare.value = null
  if (taxiMesh) taxiMesh.visible = false
}

function runRide(t) {
  const r = cab
  if (r.phase === 'drive') return runFare(t)
  const k = (d) => Math.min(1, (t - r.t0) / d)
  if (r.phase === 'come' || r.phase === 'arrive') {
    const v = ease(k(1.1))
    r.x = lerp(r.from.x, r.to.x, v)
    r.z = lerp(r.from.z, r.to.z, v)
    if (v < 1) return
    if (r.phase === 'come') {
      r.phase = 'wait'
      return taxiAsk()
    }
    // 내려 준다
    r.hide = false
    return taxiCancel()
  }
  if (r.phase === 'board') {
    if (k(0.35) < 1) return
    Object.assign(r, { phase: 'leave', t0: t, hide: true, from: { x: r.x, z: r.z }, to: { x: r.x + r.dir.x * 34, z: r.z + r.dir.z * 34 } })
    sfx.whoosh(true, { dur: 0.5 })
    return
  }
  if (r.phase === 'leave') {
    const v = k(0.9) ** 2
    r.x = lerp(r.from.x, r.to.x, v)
    r.z = lerp(r.from.z, r.to.z, v)
    if (v < 1 || r.wiping) return
    r.wiping = true
    rowWipe(() => {
      if (r.then && !r.at) {
        endTaxi()
        r.then()
        resume()
        return
      }
      const at = freeSpot(r.at.x, r.at.z)
      player.pos.set(at.x, 0, at.z)
      cam.target.copy(player.pos)
      const { fwd, right } = camAxes()
      const to = { x: at.x + right.x * 2.6, z: at.z + right.z * 2.6 }
      const from = { x: to.x + fwd.x * 30, z: to.z + fwd.z * 30 }
      Object.assign(r, { phase: 'arrive', t0: performance.now() / 1000, wiping: false, from, to, x: from.x, z: from.z, dir: { x: -fwd.x, z: -fwd.z } })
    })
    return
  }
  if (r.phase === 'off') {
    const v = k(1) ** 2
    r.x = lerp(r.from.x, r.to.x, v)
    r.z = lerp(r.from.z, r.to.z, v)
    if (v < 1) return
    endTaxi()
    if (!dialog.value) back()
  }
}

// 이야기 중에 보스·사장님·💡 사람 앞에 닿으면 E 없이도 바로 대화창이 뜬다.
// 한 번 뜬 상대는 멀어졌다가 다시 와야 또 뜬다
let autoKey = null
function autoTalk() {
  const st = story.value
  if (!st || st.done || paused.value || dialog.value || quest.value || machine.value || cine || cab) return
  const f = st.folks?.find((o) => !o.done && distTo(o.at) < 2.6)
  const key = st.boss?.alive && distTo(st.boss.at) < 3.2 ? `boss:${st.boss.id}` : st.ownerAt && st.shop && distTo(st.ownerAt) < 2.4 ? `owner:${st.step}` : f ? `folk:${f.id}` : null
  if (key === autoKey) return
  autoKey = key
  if (key) interact()
}

function interact() {
  // 이야기 중이면 안내하는 사람·사장님과 먼저 말한다
  const st = story.value
  if (st && !st.done) {
    if (st.boss?.alive && distTo(st.boss.at) < 3.2) return askBoss()
    if (st.ownerAt && st.shop && distTo(st.ownerAt) < 2.4) {
      if (st.boss?.alive) return say(ownerWho(st.shop.sign), SCARED.map((l) => fill(l, vars(st.shop, null))))
      return repair(st.shop)
    }
    const f = st.folks?.find((o) => !o.done && distTo(o.at) < 2.6)
    if (f) return talkFolk(f)
    if (st.guide && distTo(guidePos) < 2.4) return speak(whoOf(st.ch.npc), hintOf(st))
  }
  if (near.value) return useSign(near.value)
  sfx.tick()
}

// --- 바탕화면 '내 수리공' 위젯에 이야기 진행을 알린다 (2D 와 같은 gp-story-now · story:progress) ---
watch(() => dialog.value?.stay, () => syncNpcs())

watch([story, timeMode], ([st, tm]) => {
  syncNpcs()
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

const ease = (v) => 1 - (1 - v) ** 3

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
}

let zoneTimer = 0
function updateZone(dt) {
  if (fx.uSpreadOn.value < 0.5) return
  zoneTimer -= dt
  if (zoneTimer > 0) return
  zoneTimer = 0.4
  const zone = wave && wave.r > 400 ? null : litList.map((l) => [l.x, -l.z, l.r * 0.9])
  if (wave && zone) zone.push([wave.x, -wave.z, wave.r])
  traffic.setZone(zone)
  people.setZone(zone)
}

// 손이 닿는 꺼진 간판 가운데 가장 가까운 것. 벽 간판은 앞쪽에 서 있어야 한다
function findNear() {
  let best = null
  const shop = story.value?.shop
  for (const p of signPlaced) {
    if (litSet.has(p)) continue
    const s = signAt(p)
    const dx = player.pos.x - s.x
    const dz = player.pos.z - s.z
    const d = Math.hypot(dx, dz)
    if (d > REACH) continue
    if (p.faces.length === 1 && dx * s.nx + dz * s.nz < -0.2) continue
    // 부탁받은 가게와 낮은 층 간판을 먼저 고른다
    const score = d + s.y * 0.15 - (p === shop ? 2 : 0)
    if (!best || score < best.score) best = { p, score }
  }
  return best?.p || null
}

// 지금 가야 할 곳: 빈터 · 보스 · 부탁 가게 · 손님이 말한 간판(가까울 때만)
function goalOf() {
  const f = fareRun
  if (f) return distTo(f.at) < 45 ? { ...signAt(f.p), kind: 'fare' } : null
  const st = story.value
  if (!st || st.done) return null
  const b = st.build
  if (b && !b.done && b.lot) return { ...lotCenter(b.lot), y: 0, kind: 'build' }
  if (st.boss?.alive) return { ...st.boss.at, y: 0, kind: 'boss' }
  if (st.shop) {
    const s = signAt(st.shop)
    return { x: s.x + s.nx * 0.8, z: s.z + s.nz * 0.8, y: s.y, kind: 'shop' }
  }
  return null
}

// --- 하늘: 이야기 속 때(TIMES)를 천천히 따라간다 ------------------------------------------
const SKY_NIGHT = new THREE.Color(0x0b1030)
const SKY_DAY = new THREE.Color(0x8ec5ee)
const SKY_DUSK = new THREE.Color(0xd9876a)
const tmpColor = new THREE.Color()
function setTime(id, snap = false) {
  if (!TIMES[id]) return
  timeMode.value = id
  if (snap) Object.assign(sky, { night: TIMES[id].night, dusk: TIMES[id].dusk })
}

function updateSky(dt) {
  const to = TIMES[timeMode.value]
  const k = Math.min(1, dt * 0.5)
  sky.night += (to.night - sky.night) * k
  sky.dusk += (to.dusk - sky.dusk) * k
  tmpColor.copy(SKY_DAY).lerp(SKY_NIGHT, sky.night).lerp(SKY_DUSK, sky.dusk * 0.5)
  scene.background = tmpColor
  scene.fog.color.copy(tmpColor)
  const day = 1 - sky.night
  stars.material.opacity = 0.8 * sky.night
  ambient.intensity = 0.75 + day * 0.55
  moon.intensity = 0.55 + day * 0.7
  moon.color.setRGB(0.78 + day * 0.22, 0.83 + day * 0.05 - sky.dusk * 0.1, 1 - day * 0.2 - sky.dusk * 0.25)
  fx.uNight.value = sky.night
  for (const m of mats.wallMats) m.emissiveIntensity = 0.8 * sky.night
}

function move(dt) {
  let ax = 0
  let az = 0
  if (keys.has('KeyW') || keys.has('ArrowUp') || keys.has('touch-up')) az -= 1
  if (keys.has('KeyS') || keys.has('ArrowDown') || keys.has('touch-down')) az += 1
  if (keys.has('KeyA') || keys.has('ArrowLeft') || keys.has('touch-left')) ax -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight') || keys.has('touch-right')) ax += 1
  if (keys.has('KeyZ')) cam.yaw += dt * 1.8
  if (keys.has('KeyC')) cam.yaw -= dt * 1.8
  player.moving = !!(ax || az)
  if (!player.moving) return
  const len = Math.hypot(ax, az)
  ax /= len
  az /= len
  // 카메라가 보는 쪽이 앞
  const s = Math.sin(cam.yaw)
  const c = Math.cos(cam.yaw)
  const wx = ax * c + az * s
  const wz = -ax * s + az * c
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight')
  const speed = cab?.phase === 'drive' ? (run ? 34 : 24) : run ? RUN : WALK
  player.face.set(wx, wz)
  const nx = player.pos.x + wx * speed * dt
  const nz = player.pos.z + wz * speed * dt
  if (!hits(nx, player.pos.z)) player.pos.x = nx
  if (!hits(player.pos.x, nz)) player.pos.z = nz
  player.step += dt * speed * 1.4
}

function placeCamera() {
  const cp = Math.cos(cam.pitch) * cam.dist
  camera.position.set(cam.target.x + Math.sin(cam.yaw) * cp, cam.target.y + Math.sin(cam.pitch) * cam.dist, cam.target.z + Math.cos(cam.yaw) * cp)
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.8
    camera.position.y += (Math.random() - 0.5) * shake * 0.8
  }
  camera.lookAt(cam.target.x, cam.target.y + 1, cam.target.z)
  stars.position.copy(camera.position)
}

function frame(now) {
  raf = requestAnimationFrame(frame)
  const dt = Math.min(0.05, (now - last) / 1000 || 0)
  last = now
  // 놀이 판이 거리를 다 덮은 동안은 그리지 않는다
  if (quest.value && !wipe.value) return
  if (!grid || status.value) {
    if (grid) composer.render()
    return
  }
  const t = now / 1000
  shake = Math.max(0, shake - dt)

  // 타임머신: 동네 가운데를 높이 돌며 내려다본다
  if (machine.value) {
    updateMachine(dt)
    cam.yaw += dt * 0.08
    cam.target.set(0, 0, 0)
    cam.dist = world.r * 1.05
    cam.pitch = 0.62
    placeCamera()
    updateSky(dt)
    composer.render()
    return
  }

  if (!paused.value) move(dt)
  if (cab) runRide(t)

  // 카메라: 뒤쪽 위에서 비스듬히, 부드럽게 따라간다. 장이 끝나면 높이 올라가 동네를 내려다본다
  if (cine) {
    const k = ease(Math.min(1, (t - (cine.t0 ?? t)) / 4))
    cam.dist = cine.dist + (78 - cine.dist) * k
    cam.pitch = cine.pitch + (1.15 - cine.pitch) * k
    cam.yaw += dt * 0.12
  }
  const follow = cab && cab.phase !== 'drive' && cab.hide ? { x: cab.x, y: 0, z: cab.z } : player.pos
  cam.target.lerp(follow, Math.min(1, dt * 8))
  placeCamera()

  // 인형: 걸을 때 1·2 장을 번갈아, 살짝 통통 튄다. 택시에 탄 동안은 숨긴다
  const f = player.moving ? 1 + (Math.floor(player.step) % 2) : 0
  const tex = frames[avatarDir() * 3 + f]
  avatar.material.map = tex
  ghost.material.map = tex
  const bob = player.moving ? Math.abs(Math.sin(player.step * Math.PI)) * 0.06 : 0
  const inCab = !!cab?.hide
  avatar.visible = ghost.visible = shadow.visible = !inCab
  avatar.position.set(player.pos.x, bob, player.pos.z)
  ghost.position.copy(avatar.position)
  shadow.position.set(player.pos.x, 0.03, player.pos.z)

  // 택시
  taxiMesh.visible = !!cab
  if (cab) {
    taxiMesh.position.set(cab.x, cab.phase === 'drive' && player.moving ? Math.abs(Math.sin(t * 18)) * 0.04 : 0, cab.z)
    taxiMesh.rotation.y = Math.atan2(cab.dir.x, cab.dir.z)
  }

  // 손 닿는 꺼진 간판
  const n = paused.value || cab ? null : findNear()
  if (n !== near.value) near.value = n
  showRing(n)
  if (n) {
    const s = signAt(n)
    keyMark.position.set(s.x + s.nx * 0.4, s.y + 0.85 + Math.sin(t * 5) * 0.08, s.z + s.nz * 0.4)
    ringMat.color.setHex(Math.sin(t * 8) > 0 ? 0xffcf3a : 0xfff3b8)
  }

  // 목표 빛기둥과 화살표
  const g = goalOf()
  beacon.visible = !!g
  goalKind.value = g?.kind || ''
  if (g) {
    beacon.position.set(g.x, 40, g.z)
    beacon.material.color.setHex(g.kind === 'boss' ? 0xff4d6d : g.kind === 'fare' ? 0xffa300 : 0xffcf3a)
    beacon.material.opacity = 0.25 + Math.sin(t * 3) * 0.1
    const dx = g.x - player.pos.x
    const dz = g.z - player.pos.z
    dist.value = Math.round(Math.hypot(dx, dz))
    // 화면 위쪽 = 카메라 앞
    arrow.value = Math.round(((Math.atan2(dx, -dz) + cam.yaw) * 180) / Math.PI)
  }
  lotFill.opacity = 0.12 + Math.sin(t * 4) * 0.06

  updateGuide(dt)
  updateNpcs(t)
  autoTalk()
  if (traffic.update(dt, player.pos) && !paused.value && (wave || fx.uSpreadOn.value < 0.5)) sfx.horn()
  people.update(dt, player.pos, t)
  weatherFx.update(dt, camera.position)
  updateSpread(t)
  updateZone(dt)
  updateSparks(dt)
  updateSky(dt)
  miniTimer -= dt
  if (miniTimer <= 0) {
    miniTimer = 0.12
    drawMini(t, g)
  }
  composer.render()
}

// --- 작은 지도 ------------------------------------------------------------------
const MAP_COLOR = ['#3a3a44', '#202028', '#3a3430', '#2c4a2a', '#1d3560', '#2c4a2a', '#2a2a30', '#34302c', '#2c4a2a', '#45454e']
function drawMapBase() {
  const { N, height, ground } = grid
  const c = document.createElement('canvas')
  c.width = N
  c.height = N
  const m = c.getContext('2d')
  const img = m.createImageData(N, N)
  const rgb = MAP_COLOR.map((hx) => [1, 3, 5].map((o) => Number.parseInt(hx.slice(o, o + 2), 16)))
  for (let n = 0; n < N * N; n++) {
    const h = height[n]
    const v = Math.min(150, 70 + h * 2)
    const [r, g, b] = h ? [v, v, v + 8] : rgb[ground[n]] || rgb[0]
    img.data.set([r, g, b, 255], n * 4)
  }
  m.putImageData(img, 0, 0)
  return c
}

function drawMini(t, goal) {
  const cv = mini.value
  if (!cv || !mapBase) return
  const S = cv.width
  const g = cv.getContext('2d')
  const zoom = 1.6
  const [pi, pk] = [player.pos.x / B + grid.half, player.pos.z / B + grid.half]
  g.fillStyle = '#0a0a10'
  g.fillRect(0, 0, S, S)
  g.save()
  g.translate(S / 2, S / 2)
  g.rotate(cam.yaw)
  g.scale(zoom, zoom)
  g.imageSmoothingEnabled = false
  g.drawImage(mapBase, -pi, -pk)
  const dot = (x, z, color, size) => {
    g.fillStyle = color
    g.fillRect(x / B + grid.half - pi - size / 2, z / B + grid.half - pk - size / 2, size, size)
  }
  for (const p of litSet) {
    const s = signAt(p)
    dot(s.x, s.z, '#ffcf3a', 3)
  }
  for (const n of npcs) if (n.kind === 'folk') dot(n.at.x, n.at.z, '#7ee0ff', 3)
  if (goal && Math.sin(t * 8) > -0.3) dot(goal.x, goal.z, goal.kind === 'fare' ? '#ffa300' : '#ff4d6d', 6)
  g.restore()
  // 나는 가운데 노란 세모(늘 위쪽을 본다)
  g.fillStyle = '#ffcf3a'
  g.beginPath()
  g.moveTo(S / 2, S / 2 - 6)
  g.lineTo(S / 2 + 5, S / 2 + 5)
  g.lineTo(S / 2 - 5, S / 2 + 5)
  g.fill()
}

// --- 입력 -----------------------------------------------------------------------
const typing = (e) => {
  const t = e.target
  return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
}

function onKeyDown(e) {
  if (typing(e) || !ready.value) return
  // 놀이 판은 자기 키를 쓰고, 대화창은 Enter·Space·↑↓ 를 스스로 받는다
  if (quest.value || dialog.value || ride.value) return
  if (machine.value) {
    if (e.code === 'Escape') endMachine()
    return
  }
  if (onTitle.value) {
    if (e.code === 'Escape' && panel.value) panel.value = ''
    return
  }
  if (e.code === 'Escape') {
    e.preventDefault()
    if (menu.value) return panel.value ? (panel.value = '') : closeMenu()
    if (!paused.value) return openMenu()
    return
  }
  if (paused.value) return
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault()
  keys.add(e.code)
  if (e.repeat) return
  if (cab) {
    if (e.code === 'KeyT') hailTaxi()
    return
  }
  if (['KeyE', 'Space', 'KeyF', 'Enter'].includes(e.code)) {
    e.preventDefault()
    return interact()
  }
  if (e.code === 'KeyQ') placeBlock()
  if (e.code === 'KeyX') breakBlock()
  if (/^Digit[1-5]$/.test(e.code)) slot.value = Number(e.code.slice(5)) - 1
  if (e.code === 'KeyT') hailTaxi()
  if (e.code === 'KeyM') openQuest('atlas')
}

function onKeyUp(e) {
  keys.delete(e.code)
}

function hold(code, on) {
  on ? keys.add(code) : keys.delete(code)
}

function onPointerDown(e) {
  if (e.button !== 0 && e.button !== 2) return
  drag = { x: e.clientX, yaw: cam.yaw, y: e.clientY, pitch: cam.pitch }
  e.currentTarget.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e) {
  if (!drag || cine) return
  cam.yaw = drag.yaw - (e.clientX - drag.x) * 0.006
  cam.pitch = Math.max(0.45, Math.min(1.35, drag.pitch + (e.clientY - drag.y) * 0.004))
}

function onPointerUp() {
  drag = null
}

function onWheel(e) {
  e.preventDefault()
  if (cine) return
  cam.dist = Math.max(7, Math.min(40, cam.dist * (1 + Math.sign(e.deltaY) * 0.1)))
}

function resume() {
  menu.value = false
  panel.value = ''
  paused.value = false
}

// 놀이·택시가 끝나면: 타이틀에서 열었으면 타이틀로, 아니면 거리로
function back() {
  if (onTitle.value) {
    paused.value = true
    return
  }
  resume()
}

function openMenu() {
  sfx.click()
  keys.clear()
  paused.value = true
  menu.value = true
  panel.value = ''
}

function closeMenu() {
  sfx.click()
  resume()
}

function openPanel(id) {
  sfx.click()
  panel.value = id
}

// 타이틀 첫 버튼: 하던 장이 있으면 이어서, 아니면 아직 못 깬 첫 장(다 깼으면 처음부터)
function playStory() {
  sfx.click()
  if (storyOn.value) {
    onTitle.value = false
    return resume()
  }
  startStory(Math.max(0, nextCh.value))
}

function menuStory(n) {
  if (!unlocked(n)) return sfx.tick()
  sfx.click()
  startStory(n)
}

function menuAtlas() {
  sfx.click()
  openQuest('atlas')
}

function close() {
  sfx.click()
  emit('close')
}

function unfull() {
  sfx.click()
  emit('unfull')
}

// --- 시작과 끝 -----------------------------------------------------------------
async function boot() {
  setupScene()
  observer = new ResizeObserver(resize)
  observer.observe(box.value)
  const el = renderer.domElement
  el.addEventListener('contextmenu', (e) => e.preventDefault())
  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerUp)
  el.addEventListener('pointercancel', onPointerUp)
  el.addEventListener('wheel', onWheel, { passive: false })
  raf = requestAnimationFrame(frame)
  // 이야기는 늘 서울과기대(공릉)에서 시작한다
  await goPreset(PRESETS[0])
  setTime('midnight', true)
  weatherFx.set(CHAPTERS[0].weather)
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('look:change', onLook)
  window.addEventListener('game:over', onGameOver)
  if (import.meta.env.DEV) window.__street3d = { player, cam, repair, signs: () => signPlaced, near, story, quest, dialog, machine, startStory, openQuest, questBack, finishChapter, startBuild, chooseName, finishBuild, placeBlock, voxels, startMachine, hailTaxi, startFare, cab: () => cab, fareRun: () => fareRun, interact, askBoss, setTime, lit: () => litSet, guidePos, nextLine, grid: () => grid, endMachine }
  boot()
  if (props.play) playFromOutside()
})

// 바깥(순위표·위젯)에서 놀이를 고르면 하던 것 위에 그 판을 띄운다
watch(() => props.play, (g) => g && playFromOutside())
function playFromOutside() {
  if (!QUESTS[props.play] || quest.value?.game === props.play) return
  openQuest(props.play)
}

// 인트로 시작 메뉴에서 고른 것: 게임 시작은 바로 이야기로, 장 고르기·조작법은 타이틀의 그 판을 연다
let begun = 0
watch(
  () => [props.beginAt, ready.value],
  ([at, ok]) => {
    if (!ok || !grid) return
    if (!at) {
      if (!begun && !story.value) (onTitle.value = true), (begun = -1)
      return
    }
    if (at === begun) return
    begun = at
    if (props.begin === 'story' || props.begin === 'keys') (onTitle.value = true), (paused.value = true), (panel.value = props.begin)
    else playStory()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  clearTimeout(toastTimer)
  clearTimeout(chatTimer)
  clearTimeout(rideTimer)
  clearTimeout(noticeTimer)
  observer?.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('look:change', onLook)
  window.removeEventListener('game:over', onGameOver)
  fx.uSpreadOn.value = 0
  fx.uSpreadN.value = 0
  fx.uWave.value.set(0, 0, 0)
  fx.uYear.value = 9999
  if (scene) {
    for (const l of litList) l.frame.traverse((o) => o.material?.dispose())
    for (const g of [worldGroup, signGroup, treeGroup, neonGroup, mineGroup, traffic?.group, people?.group]) disposeGroup(g)
    clearGroup(lotGroup)
    blockGeo.dispose()
    traffic?.dispose()
    people?.dispose()
    weatherFx?.dispose()
    for (const t of frames) t.dispose()
    for (const e of texCache.values()) e.tex?.dispose()
  }
  composer?.dispose()
  renderer?.dispose()
  renderer?.forceContextLoss()
  renderer?.domElement.remove()
  if (import.meta.env.DEV) delete window.__street3d
})
</script>

<template>
  <div ref="box" class="s3" :class="{ windowed }">
    <!-- 불러오는 중 -->
    <div v-if="!ready && !ride" class="s3-load">
      <p>{{ status }}</p>
      <span class="s3-dots"><i></i><i></i><i></i></span>
    </div>
    <p v-if="notice" class="s3-notice">{{ notice }}</p>

    <!-- HUD: 켠 간판 수·걸음, 작은 지도, 갈 곳 방향 -->
    <template v-if="ready && !onTitle && !machine">
      <div class="s3-count">
        <template v-if="storyOn">
          <Lightbulb class="ic" />{{ litCount }}
          <span class="s3-pips"><i v-for="n in story.goal" :key="n" :class="{ on: n <= story.step }"></i></span>
        </template>
        <template v-else><BookMarked class="ic" />{{ dex.length }}</template>
      </div>
      <canvas ref="mini" class="s3-mini" width="132" height="132"></canvas>
      <div v-if="goalKind && !dialog && !quest" class="s3-goal" :class="goalKind">
        <span class="s3-arrow" :style="{ transform: `rotate(${arrow}deg)` }">▲</span>
        <template v-if="building">{{ story.build.count }}/{{ BUILD.need }}</template>
        <template v-else>{{ dist }}m</template>
      </div>
      <div v-if="fare" class="s3-fare" :class="{ hurry: fare.hurry }">
        <b>{{ fare.left }}</b>초 · {{ fare.won.toLocaleString() }}원
        <small>「{{ fare.name }}」</small>
      </div>
      <div v-if="near && !paused && !touch" class="s3-hint"><kbd>E</kbd>{{ storyOn ? '고치기' : '켜기' }}</div>
      <transition name="s3-pop">
        <div v-if="toast" class="s3-toast" :style="{ '--neon': toast.color }">{{ toast.name }}<small v-if="toast.tag">{{ toast.tag }}</small></div>
      </transition>
    </template>

    <div v-if="chat && !dialog && !quest" class="s3-chat">
      <span class="s3-chat-face"><img v-if="chat.portrait" :src="chat.portrait" alt="" /><template v-else>{{ chat.face }}</template></span>
      <p><b>{{ chat.who }}</b>{{ chat.text }}</p>
    </div>

    <!-- 블록: 내 가게 짓는 동안 -->
    <div v-if="ready && building && !dialog && !quest && !menu" class="s3-hotbar">
      <button v-for="(b, i) in blockIcons" :key="b.id" :class="{ on: slot === i }" :title="b.label" @click="slot = i">
        <img :src="b.icon" alt="" width="32" height="32" />
        <span>{{ i + 1 }}</span>
      </button>
    </div>

    <!-- 터치 조작 -->
    <template v-if="ready && touch && !paused && !machine && !dialog && !quest">
      <div class="s3-pad">
        <button v-for="d in ['up', 'left', 'down', 'right']" :key="d" :class="d" @pointerdown="hold(`touch-${d}`, true)" @pointerup="hold(`touch-${d}`, false)" @pointerleave="hold(`touch-${d}`, false)">{{ { up: '▲', left: '◀', down: '▼', right: '▶' }[d] }}</button>
      </div>
      <div class="s3-acts">
        <button @click="interact">{{ storyOn ? '말걸기' : '켜기' }}</button>
        <button v-if="building" @click="placeBlock">놓기</button>
        <button v-if="building" @click="breakBlock">빼기</button>
        <button @click="hailTaxi">택시</button>
        <button @click="openMenu">메뉴</button>
      </div>
    </template>

    <!-- 서울 타임머신 -->
    <template v-if="machine">
      <div class="s3-year" aria-live="polite">
        <b>{{ machine.year }}</b>년
        <small v-if="machine.recent.length">{{ machine.recent.map((b) => `${b.name || b.use} (${b.year})`).join(' · ') }}</small>
      </div>
      <div class="s3-machine">
        <button @click="playMachine">{{ machine.playing ? '⏸' : '▶' }}</button>
        <input type="range" :min="machine.min" :max="machine.max" step="1" :value="machine.year" @input="scrubMachine" />
        <span>건물 {{ machine.count.toLocaleString() }}채</span>
        <button @click="endMachine">나가기</button>
      </div>
    </template>

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

    <!-- 부탁 놀이·보스 대결·간판 지도: 거리 위를 덮는 판 -->
    <div v-if="quest" class="s3-stage" :class="{ boss: quest.boss }" @pointerdown.stop>
      <header class="s3-stage-bar">
        <img v-if="quest.who?.portrait" class="s3-stage-face" :src="quest.who.portrait" alt="" />
        <span v-if="quest.who" class="s3-stage-who">{{ quest.boss ? `VS ${quest.who.name}` : `${quest.who.name}의 부탁` }}</span>
        <b>{{ quest.title }}</b>
        <span v-if="quest.placed" class="s3-stage-state" :class="{ ok: quest.done }">{{ quest.done ? (quest.boss ? '이겼다!' : '해냈다!') : quest.boss ? '이기면 길이 열린다' : '끝내면 불이 들어온다' }}</span>
        <span class="s3-stage-acts">
          <button v-if="quest.skip && quest.placed && !quest.done" @click="questBack(true)">넘어가기</button>
          <button v-if="quest.done" class="primary" @click="questBack()">거리로 ▶</button>
          <button v-else @click="questQuit">{{ quest.placed ? '도망가기' : '거리로 ▶' }}</button>
        </span>
      </header>
      <div class="s3-stage-body">
        <component :is="quest.comp" v-if="quest.placed" v-bind="quest.props" />
        <div v-else class="mac-win on s3-stage-win" :class="{ ink: quest.ink, paper: quest.ink === 'paper' }">
          <div class="app-body"><component :is="quest.comp" v-bind="quest.props" /></div>
        </div>
      </div>
    </div>

    <div v-if="wipe" class="s3-wipe" :class="wipe" aria-hidden="true">
      <i v-for="n in WIPE_ROWS" :key="n" :style="{ '--d': `${(n - 1) * 26}ms`, '--s': n % 2 ? -1 : 1 }"></i>
    </div>

    <!-- 장 시작: 지하철 카드 -->
    <div v-if="ride" class="s3-ride" aria-live="polite">
      <span class="s3-ride-line" :style="{ background: ride.color }">{{ ride.line }}</span>
      <div class="s3-ride-text">
        <small>{{ ride.line }}호선</small>
        <b>{{ ride.from ? `${ride.from} → ` : '' }}{{ ride.station }}</b>
        <span>{{ ride.title }}</span>
      </div>
      <div class="s3-ride-track" :style="{ '--c': ride.color }"><i></i></div>
    </div>

    <!-- 타이틀·게임 메뉴 -->
    <div v-if="ready && (onTitle || menu) && !dialog && !quest && !ride && !machine" class="s3-scrim">
      <div class="s3-panel">
        <template v-if="!panel">
          <h1 v-if="onTitle">간판 수리공<em>3D</em></h1>
          <template v-if="onTitle">
            <button class="on" @click="playStory">▶ {{ storyOn || (nextCh > 0) ? '이어하기' : '시작하기' }}</button>
          </template>
          <button v-else class="on" @click="closeMenu">▶ 계속하기</button>
          <button @click="openPanel('story')">장 고르기</button>
          <button @click="menuAtlas">간판 지도</button>
          <button @click="openPanel('keys')">조작법</button>
          <button v-if="!onTitle && !windowed" @click="unfull">창 모드로</button>
          <button @click="close">나가기</button>
        </template>
        <template v-else-if="panel === 'story'">
          <h2>장 고르기</h2>
          <button v-for="(c, n) in CHAPTERS" :key="c.id" class="s3-ch" :class="{ on: story?.ch === c, lock: !unlocked(n) }" :disabled="!unlocked(n)" @click="menuStory(n)">
            <i class="s3-ride-dot" :style="{ background: c.ride.color }">{{ c.ride.line }}</i>{{ c.title }}<span v-if="cleared.includes(c.id)" class="s3-ok">✓</span>
          </button>
          <button v-if="nextCh < 0" @click="startMachine">서울 타임머신</button>
          <button class="back" @click="panel = ''">◀ 돌아가기</button>
        </template>
        <template v-else>
          <h2>조작법</h2>
          <dl v-if="!touch" class="s3-keys">
            <dt>WASD · 방향키</dt><dd>걷기</dd>
            <dt>Shift</dt><dd>달리기</dd>
            <dt>E · Space</dt><dd>말 걸기 · 고치기</dd>
            <dt>Q · X</dt><dd>블록 놓기 · 빼기</dd>
            <dt>1 ~ 5</dt><dd>블록 고르기</dd>
            <dt>T</dt><dd>택시</dd>
            <dt>M</dt><dd>간판 지도</dd>
            <dt>끌기 · Z C</dt><dd>시점 돌리기</dd>
            <dt>휠</dt><dd>가깝게 · 멀리</dd>
            <dt>Esc</dt><dd>메뉴</dd>
          </dl>
          <dl v-else class="s3-keys">
            <dt>왼쪽 단추</dt><dd>걷기</dd>
            <dt>말걸기</dt><dd>말 걸기 · 고치기</dd>
            <dt>택시</dt><dd>택시 부르기</dd>
            <dt>끌기</dt><dd>시점 돌리기</dd>
          </dl>
          <button class="back" @click="panel = ''">◀ 돌아가기</button>
        </template>
      </div>
    </div>
  </div>
</template>
<style scoped>
.s3 {
  position: fixed;
  inset: 0;
  z-index: 15000;
  overflow: hidden;
  background: #0b1030;
  color: #f4f1ea;
  font-family: 'Galmuri11 Game', Galmuri11, sans-serif;
  user-select: none;
}

.s3.windowed {
  position: absolute;
  z-index: auto;
  border-radius: inherit;
}

.s3 :deep(canvas:first-child) {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
}

.s3-load {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 14px;
  background: #000;
  font-size: 15px;
  color: #8e8ea0;
}

.s3-load p {
  margin: 0;
}

.s3-dots {
  display: flex;
  gap: 8px;
}

.s3-dots i {
  width: 8px;
  height: 8px;
  background: #ffcf3a;
  animation: s3-blink 0.9s infinite steps(1);
}

.s3-dots i:nth-child(2) {
  animation-delay: 0.3s;
}

.s3-dots i:nth-child(3) {
  animation-delay: 0.6s;
}

@keyframes s3-blink {
  50% {
    opacity: 0.15;
  }
}

.s3-notice {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: 8px 14px;
  background: #000;
  border: 2px solid #ffcf3a;
  font-size: 13px;
}

.s3-count {
  position: absolute;
  top: 16px;
  left: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px 7px 9px;
  background: rgb(0 0 0 / 0.72);
  box-shadow: 0 0 0 2px #000, inset 0 0 0 2px #2a2a36;
  font-size: 18px;
  font-weight: 700;
  color: #ffcf3a;
}

.s3-count small {
  font-size: 13px;
  color: #8e8ea0;
}

.s3-count .ic {
  width: 18px;
  height: 18px;
}

.s3-mini {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 132px;
  height: 132px;
  image-rendering: pixelated;
  box-shadow: 0 0 0 2px #000, 0 0 0 4px #2a2a36;
  border-radius: 50%;
}

.s3-goal {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px 6px 10px;
  background: rgb(0 0 0 / 0.72);
  box-shadow: 0 0 0 2px #000, inset 0 0 0 2px #ffcf3a;
  font-size: 15px;
  font-weight: 700;
  color: #ffcf3a;
}

.s3-arrow {
  display: inline-block;
  font-size: 16px;
  transition: transform 0.12s linear;
}

.s3-hint {
  position: absolute;
  bottom: 13%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px 6px 6px;
  background: rgb(0 0 0 / 0.78);
  font-size: 15px;
  font-weight: 700;
}

.s3-hint kbd {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  background: #ffcf3a;
  color: #1b1622;
  font: inherit;
  box-shadow: 0 3px 0 #8a6a10;
  animation: s3-tap 0.8s infinite;
}

@keyframes s3-tap {
  50% {
    transform: translateY(2px);
    box-shadow: 0 1px 0 #8a6a10;
  }
}

.s3-toast {
  position: absolute;
  top: 22%;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 18px;
  font-size: 26px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
  text-shadow: 0 0 6px var(--neon), 0 0 16px var(--neon), 3px 3px 0 #000;
  pointer-events: none;
}

.s3-pop-enter-active {
  animation: s3-in 0.35s steps(4);
}

.s3-pop-leave-active {
  transition: opacity 0.4s;
}

.s3-pop-leave-to {
  opacity: 0;
}

@keyframes s3-in {
  from {
    transform: translateX(-50%) scale(1.6);
    opacity: 0;
  }
}

.s3-scrim {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 0.6);
}

.s3-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 280px;
  padding: 26px 34px;
  background: #000;
  box-shadow: 0 0 0 2px #2a2a36, 0 0 0 4px #000;
}

.s3-panel h1 {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0 0 14px;
  font-size: 30px;
  color: #f4f1ea;
  text-shadow: 3px 3px 0 #1b1622;
}

.s3-panel h1 em {
  font-style: normal;
  font-size: 14px;
  padding: 2px 5px;
  background: #ffcf3a;
  color: #1b1622;
  text-shadow: none;
}

.s3-panel button {
  padding: 8px 4px;
  border: 0;
  background: none;
  color: #8e8ea0;
  font: 700 18px/1 'Galmuri11 Game', Galmuri11, sans-serif;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.s3-panel button:hover,
.s3-panel button.on {
  color: #ffcf3a;
  text-shadow: 3px 3px 0 #1b1622;
}

.s3-keys {
  display: grid;
  grid-template-columns: auto auto;
  gap: 8px 22px;
  margin: 0 0 12px;
  font-size: 14px;
}

.s3-keys dt {
  color: #ffcf3a;
  text-align: right;
}

.s3-keys dd {
  margin: 0;
  color: #d8d6e0;
}

.s3-panel h2 {
  margin: 0 0 12px;
  font-size: 20px;
  color: #ffcf3a;
  text-shadow: 3px 3px 0 #1b1622;
}

.s3-panel button:disabled {
  opacity: 0.35;
  cursor: default;
}

.s3-panel button.back {
  margin-top: 8px;
  font-size: 15px;
}

.s3-ch {
  display: flex;
  align-items: center;
}

.s3-ok {
  margin-left: 6px;
  color: #30d158;
}

.s3-ride-dot {
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-right: 8px;
  border-radius: 50%;
  color: #fff;
  font-size: 11px;
  font-style: normal;
  text-shadow: none;
}

.s3-pips {
  display: flex;
  gap: 3px;
  margin-left: 4px;
}

.s3-pips i {
  width: 8px;
  height: 8px;
  background: #2a2a36;
}

.s3-pips i.on {
  background: #ffcf3a;
}

.s3-goal.boss {
  color: #ff6b81;
  box-shadow: 0 0 0 2px #000, inset 0 0 0 2px #ff4d6d;
}

.s3-goal.fare {
  color: #ffa300;
  box-shadow: 0 0 0 2px #000, inset 0 0 0 2px #ffa300;
}

.s3-fare {
  position: absolute;
  top: 60px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 14px;
  background: #000;
  box-shadow: 0 0 0 2px #ffa300;
  font-size: 14px;
  color: #f4f1ea;
  white-space: nowrap;
}

.s3-fare b {
  font-size: 22px;
  color: #ffa300;
}

.s3-fare.hurry b {
  color: #ff4d6d;
  animation: s3-blink 0.5s infinite steps(1);
}

.s3-fare small {
  color: #8e8ea0;
}

.s3-toast small {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  text-align: center;
  color: #ffcf3a;
  text-shadow: 2px 2px 0 #000;
}

.s3-chat {
  position: absolute;
  top: 164px;
  left: 50%;
  transform: translateX(-50%);
  width: min(440px, calc(100% - 20px));
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px 8px 8px;
  font-size: 14px;
  line-height: 1.55;
  background: #000;
  box-shadow: 0 0 0 2px #2a2a36, 0 0 0 4px #000;
  pointer-events: none;
}

.s3-chat-face {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  overflow: hidden;
  background: #1b1622;
  font-size: 28px;
}

.s3-chat-face img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top;
  image-rendering: pixelated;
}

.s3-chat p {
  margin: 0;
}

.s3-chat b {
  display: block;
  color: #ffcf3a;
}

.s3-hotbar {
  position: absolute;
  bottom: 14px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  padding: 4px;
  background: #000;
  box-shadow: 0 0 0 2px #2a2a36;
}

.s3-hotbar button {
  position: relative;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  background: #1b1622;
  cursor: pointer;
}

.s3-hotbar button.on {
  outline: 3px solid #ffcf3a;
}

.s3-hotbar img {
  image-rendering: pixelated;
}

.s3-hotbar span {
  position: absolute;
  right: 3px;
  bottom: 1px;
  font-size: 10px;
  color: #f4f1ea;
  text-shadow: 1px 1px 0 #000;
}

.s3-pad {
  position: absolute;
  left: 14px;
  bottom: 70px;
  display: grid;
  grid-template: repeat(3, 48px) / repeat(3, 48px);
}

.s3-pad button,
.s3-acts button {
  padding: 0;
  border: 0;
  background: rgb(0 0 0 / 0.72);
  box-shadow: inset 0 0 0 2px #2a2a36;
  color: #ffcf3a;
  font: 700 15px 'Galmuri11 Game', Galmuri11, sans-serif;
  touch-action: none;
}

.s3-pad .up {
  grid-area: 1 / 2;
}

.s3-pad .left {
  grid-area: 2 / 1;
}

.s3-pad .right {
  grid-area: 2 / 3;
}

.s3-pad .down {
  grid-area: 3 / 2;
}

.s3-acts {
  position: absolute;
  right: 14px;
  bottom: 70px;
  display: grid;
  gap: 6px;
}

.s3-acts button {
  width: 70px;
  height: 42px;
}

.s3-year {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  font-size: 18px;
  text-shadow: 3px 3px 0 #1b1622;
}

.s3-year b {
  font-size: 56px;
  color: #ffcf3a;
}

.s3-year small {
  display: block;
  font-size: 13px;
  color: #f4f1ea;
}

.s3-machine {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(620px, calc(100% - 24px));
  padding: 10px 14px;
  background: #000;
  box-shadow: 0 0 0 2px #2a2a36;
  font-size: 13px;
  white-space: nowrap;
}

.s3-machine input {
  flex: 1;
  accent-color: #ffcf3a;
}

.s3-machine button {
  padding: 4px 10px;
  border: 0;
  background: none;
  color: #ffcf3a;
  font: 700 16px 'Galmuri11 Game', Galmuri11, sans-serif;
  cursor: pointer;
}

/* 놀이 판: 거리를 다 덮는다 */
.s3-stage {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: #000;
}

.s3-stage-bar {
  position: relative;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 8px 14px;
  background: #000;
  box-shadow: 0 2px 0 #2a2a36;
  font-size: 13px;
}

.s3-stage.boss .s3-stage-bar {
  box-shadow: 0 2px 0 #ff4d6d;
}

.s3-stage-face {
  width: 34px;
  height: 34px;
  object-fit: cover;
  object-position: top;
  image-rendering: pixelated;
  box-shadow: 0 0 0 2px #2a2a36;
}

.s3-stage-who {
  color: #ffcf3a;
}

.s3-stage.boss .s3-stage-who {
  color: #ff6b81;
}

.s3-stage-bar b {
  font-size: 16px;
}

.s3-stage-state {
  color: #8e8ea0;
}

.s3-stage-state.ok {
  color: #30d158;
}

.s3-stage-acts {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.s3-stage-acts button {
  padding: 5px 12px;
  border: 0;
  background: #1b1622;
  box-shadow: inset 0 0 0 2px #2a2a36;
  color: #d8d6e0;
  font: 700 13px 'Galmuri11 Game', Galmuri11, sans-serif;
  cursor: pointer;
}

.s3-stage-acts button:hover {
  color: #ffcf3a;
}

.s3-stage-acts .primary {
  background: #ffcf3a;
  box-shadow: none;
  color: #1b1622;
}

.s3-stage-acts .primary:hover {
  color: #1b1622;
}

.s3-stage-body {
  min-height: 0;
  overflow: auto;
  user-select: text;
}

.s3-stage-body > :deep(*) {
  min-height: 100%;
}

.s3-stage-win {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 0;
}

.s3-stage-win > .app-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

/* 한 줄씩 엇갈려 덮었다가 걷히는 막 */
.s3-wipe {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: grid;
  grid-template-rows: repeat(14, 1fr);
  overflow: hidden;
  pointer-events: all;
}

.s3-wipe i {
  display: block;
  background: #000;
  box-shadow: inset 0 -2px 0 #ffcf3a33;
  transform: translateX(calc(var(--s) * 101%));
}

.s3-wipe.cover i {
  animation: s3-wipe-in 0.2s steps(5) var(--d) forwards;
}

.s3-wipe.reveal i {
  transform: none;
  animation: s3-wipe-out 0.2s steps(5) var(--d) forwards;
}

@keyframes s3-wipe-in {
  to {
    transform: none;
  }
}

@keyframes s3-wipe-out {
  to {
    transform: translateX(calc(var(--s) * -101%));
  }
}

/* 장 시작 지하철 카드 */
.s3-ride {
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
  background: #000;
  box-shadow: 0 0 0 2px #2a2a36, 0 0 0 4px #000;
  transform: translate(-50%, -50%);
  animation: s3-ride-in 0.35s steps(4);
}

.s3-ride-line {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  font-size: 24px;
  font-weight: 700;
}

.s3-ride-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.s3-ride-text small {
  color: #8e8ea0;
}

.s3-ride-text b {
  font-size: 22px;
  text-shadow: 3px 3px 0 #1b1622;
}

.s3-ride-text span {
  color: #ffcf3a;
  font-size: 13px;
}

.s3-ride-track {
  position: relative;
  grid-column: 1 / -1;
  height: 6px;
  margin-top: 8px;
  background: color-mix(in srgb, var(--c) 30%, transparent);
  overflow: hidden;
}

.s3-ride-track i {
  position: absolute;
  inset: 0 auto 0 0;
  width: 28%;
  background: var(--c);
  animation: s3-ride-go 1.4s linear infinite;
}

@keyframes s3-ride-go {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(360%);
  }
}

@keyframes s3-ride-in {
  from {
    opacity: 0;
    transform: translate(-50%, -44%);
  }
}
</style>
