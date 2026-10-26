<script setup>
// 간판 수리공 (3D 시험판): 2D 와 같은 동네·간판·이야기를 비스듬히 내려다보는 3D 거리로 푼다.
// 꺼진 동네는 잿빛, 간판을 고치면 네온이 켜지고 그 둘레로 색이 번진다. 글자는 되도록 줄였다
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { Lightbulb } from 'lucide-vue-next'
import { load, signsAround } from '../data.js'
import { player as arcadePlayer } from '../arcade.js'
import { pastelOf } from '../shops.js'
import { sfx } from '../sound.js'
import { drawAvatar, readLook } from '../avatar.js'
import { B, meshWorld, plantStreetTrees, plantTrees, rasterize } from '../world/build.js'
import { MAX_LIT, fx, neonOf, patch } from '../world/fx.js'
import { makePeople } from '../world/people.js'
import { PRESETS } from '../world/presets.js'
import { meshSigns, placeSigns } from '../world/signs.js'
import { CHAPTERS, fill, ownerOf } from '../world/story.js'
import { GROUND_ID, leafColor, leafMaterials, makeMaterials } from '../world/textures.js'
import { makeTraffic } from '../world/traffic.js'
import { makeWeather } from '../world/weather.js'
import RpgDialog from './street2d/RpgDialog.vue'

// 2D 와 같은 약속: windowed 는 맥 창 안, play 는 바깥에서 바로 여는 놀이, begin·beginAt 은 인트로 시작 메뉴에서 고른 것
const props = defineProps({ windowed: { type: Boolean, default: false }, play: { type: String, default: '' }, begin: { type: String, default: '' }, beginAt: { type: Number, default: 0 } })
const emit = defineEmits(['close', 'unfull'])

// 놀이(산성비·타자왕 등)는 아직 3D 로 옮기지 않았다: 그때만 2D 판을 그대로 띄운다
const Street2D = defineAsyncComponent(() => import('./Street2D.vue'))

const NPC_ART = import.meta.glob('../assets/npc/*.png', { eager: true, import: 'default' })
const art = (name) => NPC_ART[`../assets/npc/${name}.png`] || ''

const MAX_SIGNS = 3500
const R = 0.3
const REACH = 3.6
// 첫 부탁을 마친 뒤 이만큼 켜면 동네 전체에 불이 돌아온다
const GOAL = 10
const WALK = 5.2
const RUN = 8.5

const box = ref(null)
const mini = ref(null)
const status = ref('지도를 펼치는 중…')
const notice = ref('')
const paused = ref(true)
const menu = ref(false)
const panel = ref('')
const onTitle = ref(false)
const dialog = shallowRef(null)
const toast = shallowRef(null)
const near = shallowRef(null)
const litCount = ref(0)
const phase = ref('')
const arrow = ref(0)
const dist = ref(0)
const ready = computed(() => !status.value)
const myName = () => arcadePlayer()?.name || '수리공'

// three.js 상태는 반응형으로 두지 않는다
let renderer, scene, camera, composer, bloom, ambient, moon, stars
let mats, leafMats, weatherFx
let worldGroup = null
let signGroup = null
let signMeshes = []
let treeGroup = null
let neonGroup = null
let traffic = null
let people = null
let grid = null
let world = null
let signPlaced = []
let litList = []
let litSet = new Set()
let treeCells = new Set()
let wave = null
let raf = 0
let last = 0
let mapBase = null
let miniTimer = 0
let shake = 0
let sky = { from: 0, to: 0, t: 1 }
let observer = null
const keys = new Set()
const player = { pos: new THREE.Vector3(), face: new THREE.Vector2(0, 1), step: 0, moving: false }
const cam = { yaw: 0.6, pitch: 0.9, dist: 21, target: new THREE.Vector3() }
let drag = null
let story = null

// --- 장면 ---------------------------------------------------------------------
function setupScene() {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
  box.value.prepend(renderer.domElement)
  scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x0b1030, 30, 170)
  camera = new THREE.PerspectiveCamera(50, 1, 0.3, 900)
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
  for (const m of mats.groundMats) patch(m, 'wet')
  for (const m of [...mats.wallMats, mats.shopMat, mats.roofMat]) patch(m, 'year')
  for (const m of [leafMats.trunk, leafMats.leaf]) patch(m)
  // 밤 창문 불빛
  for (const m of mats.wallMats) m.emissiveIntensity = 0.8
  mats.shopMat.emissiveIntensity = 0.5
  weatherFx = makeWeather()
  scene.add(weatherFx.group)

  makeAvatar()
  makeMarks()
  makeSparks()

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

// --- 표시: 고칠 간판 틀, E 단추, 부탁 가게 빛기둥, 사장님 ---------------------------
let ring = null
let keyMark = null
let beacon = null
let owner = null
function makeMarks() {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')
  g.fillStyle = '#1b1622'
  g.fillRect(6, 10, 52, 50)
  g.fillStyle = '#ffcf3a'
  g.fillRect(6, 4, 52, 50)
  g.fillStyle = '#1b1622'
  g.font = '700 36px "Galmuri11 Game", Galmuri11, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('E', 32, 31)
  const tex = new THREE.CanvasTexture(c)
  tex.magFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  keyMark = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false }))
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

function clearGroup(g) {
  if (!g) return
  g.traverse((o) => o.geometry?.dispose())
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

function placeOwner(placed) {
  if (owner) {
    scene.remove(owner)
    owner.material.map?.dispose()
    owner.material.dispose()
    owner = null
  }
  if (!placed) return
  const src = art('c-bunsik')
  if (!src) return
  const tex = new THREE.TextureLoader().load(src)
  tex.magFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  // 화면을 보는 판이라 윗부분이 벽에 묻힌다: 깊이 검사를 끄고 가까울 때만 보인다
  owner = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, alphaTest: 0.5, depthTest: false }))
  owner.renderOrder = 4
  owner.center.set(0.5, 0)
  owner.scale.set(1.46, 2.1, 1)
  const { x, z, nx, nz } = signAt(placed)
  const spot = freeSpot(x + nx * 3.0, z + nz * 3.0)
  owner.position.set(spot.x, 0, spot.z)
  scene.add(owner)
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
  for (const g of [worldGroup, signGroup, treeGroup, traffic?.group, people?.group]) disposeGroup(g)
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
  // 꺼진 동네: 불 켠 곳에만 사람과 차가 돌아온다
  traffic.setZone([])
  people.setZone([])

  const found = await signsAround(world.lng, world.lat, world.r).catch(() => ({ dense: false, rows: [] }))
  await document.fonts.load('20px Galmuri11').catch(() => {})
  signPlaced = placeSigns(grid, found.rows.slice(0, MAX_SIGNS))
  const made = meshSigns(signPlaced)
  signGroup = made.group
  signMeshes = made.meshes
  for (const s of signMeshes) patch(s.material, 'sign')
  scene.add(signGroup)
  for (const g of [worldGroup, traffic.group, people.group, signGroup]) patchGroup(g)

  neonGroup = new THREE.Group()
  scene.add(neonGroup)
  litList = []
  litSet = new Set()
  litCount.value = 0
  fx.uSpreadOn.value = 1
  fx.uSpreadN.value = 0
  fx.uWave.value.set(0, 0, 0)
  mapBase = drawMapBase()
  spawn(start)
  status.value = ''
}

function patchGroup(g) {
  g?.traverse((o) => {
    if (o.isMesh) for (const mm of [o.material].flat()) patch(mm)
  })
}

const cellOf = (x, z) => [Math.floor(x / B + grid.half), Math.floor(z / B + grid.half)]

function cellFree(i, k) {
  const { N, height, ground } = grid
  if (i < 1 || k < 1 || i >= N - 1 || k >= N - 1) return false
  const c = k * N + i
  return !height[c] && ground[c] !== GROUND_ID.water && !treeCells.has(c)
}

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
  return { x: (best.i - grid.half + 0.5) * B, z: (best.k - grid.half + 0.5) * B }
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

// --- 이야기(1장 첫 부탁) ----------------------------------------------------------
async function startGame() {
  onTitle.value = false
  panel.value = ''
  if (story) return resume()
  const ch = CHAPTERS[0]
  weatherFx.set(ch.weather)
  const shop = nextShop(player.pos, ch.steps[0].want)
  story = { ch, shop }
  phase.value = 'shop'
  placeOwner(shop)
  say({ name: ch.npc.name, face: ch.npc.face, portrait: art(`p-${ch.npc.id}`) }, ch.intro.map((l) => fill(l, vars(shop))))
}

const vars = (next) => ({ next: next?.sign.name || '', me: myName(), shop: '', nextCat: next?.sign.cat || '', score: '', need: 0 })

// 부탁할 가게: 30~160m 사이의 꺼진 그 업종 간판. 없으면 가까운 꺼진 아무 간판
function nextShop(from, want) {
  const cand = signPlaced
    .filter((p) => !litSet.has(p))
    .map((p) => {
      const s = signAt(p)
      return { p, d: Math.hypot(s.x - from.x, s.z - from.z) }
    })
    .sort((a, b) => a.d - b.d)
  const far = cand.filter((c) => c.d > 30 && c.d < 160)
  const pick = far.find((c) => want.test(c.p.sign.cat)) || cand.find((c) => c.d > 30 && want.test(c.p.sign.cat) && c.d < 260) || far[0] || cand[0]
  return pick?.p || null
}

function say(who, lines, opts = {}) {
  paused.value = true
  keys.clear()
  dialog.value = { who: who.name, face: who.face || '', portrait: who.portrait || '', tone: who.tone || 'npc', lines, i: 0, ...opts }
}

function nextLine() {
  const d = dialog.value
  if (!d) return
  if (d.i + 1 < d.lines.length) {
    sfx.tick()
    dialog.value = { ...d, i: d.i + 1 }
    return
  }
  dialog.value = null
  if (d.then) return d.then()
  resume()
}

function resume() {
  menu.value = false
  panel.value = ''
  paused.value = false
}

// --- 간판 고치기 ----------------------------------------------------------------
let toastTimer = 0
function repair(placed) {
  if (!placed || litSet.has(placed)) return
  litSet.add(placed)
  const s = signAt(placed)
  const color = neonOf(pastelOf(placed.sign.cat))
  const mat = new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.6), fog: false })
  const frame = frameOf(placed, mat)
  neonGroup.add(frame)
  const isShop = story?.shop === placed
  // 셰이더가 받는 불빛 자리는 MAX_LIT 개까지. 넘치면 틀만 켠다
  if (litList.length < MAX_LIT) litList.push({ placed, x: s.x, y: s.y, z: s.z, R: isShop ? 34 : 20, r: 0, t0: performance.now() / 1000, color, frame })
  litCount.value = litSet.size
  sfx.neon(Math.min(litSet.size - 1, 12))
  burst(s.x + s.nx * 0.2, s.y, s.z + s.nz * 0.2, s.nx, s.nz, color)
  shake = 0.25
  showRing(null)
  near.value = null
  toast.value = { name: placed.sign.name, color: `#${color.getHexString()}` }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 2200)

  if (isShop) {
    const ch = story.ch
    story.shop = null
    beacon.visible = false
    phase.value = 'free'
    setTimeout(() => {
      const lines = ch.steps[0].story.slice(0, 2).map((l) => fill(l, vars(null)))
      const left = Math.max(1, GOAL - litSet.size)
      lines.push(`꺼진 간판 ${left}개만 더 켜 줘. 그러면 동네 전체에 불이 돌아올 거야!`)
      say({ name: ch.npc.name, face: ch.npc.face, portrait: art(`p-${ch.npc.id}`) }, lines)
    }, 900)
  } else if (phase.value === 'free' && litSet.size >= GOAL) {
    setTimeout(finale, 1200)
  }
}

// 동네 전체로 색이 번지고 새벽이 온다
function finale() {
  if (phase.value !== 'free') return
  phase.value = 'done'
  wave = { x: player.pos.x, z: player.pos.z, t0: performance.now() / 1000 }
  weatherFx.set('clear')
  sky = { from: 0, to: 1, t: 0 }
  setTimeout(() => sfx.dawn(), 300)
  const ch = story.ch
  setTimeout(() => {
    if (phase.value !== 'done') return
    say({ name: ch.npc.name, face: ch.npc.face, portrait: art(`p-${ch.npc.id}`) }, [fill(ch.done[0], vars(null))])
    placeOwner(null)
  }, 4200)
}

// --- 바탕화면 '내 수리공' 위젯에 이야기 진행을 알린다 (2D 와 같은 gp-story-now · story:progress) ---
watch([phase, litCount], ([ph, lit]) => {
  if (!ph || !story) return
  const now = {
    chapter: story.ch.title,
    n: Math.max(1, CHAPTERS.indexOf(story.ch) + 1),
    next: ph === 'shop' && story.shop ? `「${story.shop.sign.name}」 불 켜기` : ph === 'free' ? `간판 ${Math.max(0, GOAL - lit)}개 더 켜기` : '',
    lit,
    goal: Math.max(GOAL, lit),
    step: ph === 'shop' ? 0 : ph === 'free' ? 1 : 2,
    steps: 2,
    time: ph === 'done' ? 'dawn' : 'night',
    boss: '',
    own: false,
    done: ph === 'done',
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
  for (const p of signPlaced) {
    if (litSet.has(p)) continue
    const s = signAt(p)
    const dx = player.pos.x - s.x
    const dz = player.pos.z - s.z
    const d = Math.hypot(dx, dz)
    if (d > REACH) continue
    if (p.faces.length === 1 && dx * s.nx + dz * s.nz < -0.2) continue
    // 부탁받은 가게와 낮은 층 간판을 먼저 고른다
    const score = d + s.y * 0.15 - (p === story?.shop ? 2 : 0)
    if (!best || score < best.score) best = { p, score }
  }
  return best?.p || null
}

// --- 매 프레임 -----------------------------------------------------------------
const SKY = [new THREE.Color(0x0b1030), new THREE.Color(0x6a5a8c)]
const tmpColor = new THREE.Color()
function updateSky(dt) {
  if (sky.t < 1) sky.t = Math.min(1, sky.t + dt / 5)
  const k = sky.from + (sky.to - sky.from) * ease(sky.t)
  tmpColor.copy(SKY[0]).lerp(SKY[1], k)
  scene.background = tmpColor
  scene.fog.color.copy(tmpColor)
  stars.material.opacity = 0.8 * (1 - k)
  ambient.intensity = 0.75 + k * 0.5
  moon.intensity = 0.55 + k * 0.6
  moon.color.setRGB(0.78 + k * 0.22, 0.83 + k * 0.05, 1 - k * 0.2)
  fx.uNight.value = 1 - k * 0.6
  for (const m of mats.wallMats) m.emissiveIntensity = 0.8 * (1 - k)
}

function move(dt) {
  let ax = 0
  let az = 0
  if (keys.has('KeyW') || keys.has('ArrowUp')) az -= 1
  if (keys.has('KeyS') || keys.has('ArrowDown')) az += 1
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ax -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight')) ax += 1
  if (keys.has('KeyZ')) cam.yaw += dt * 1.8
  if (keys.has('KeyX')) cam.yaw -= dt * 1.8
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
  const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN : WALK
  player.face.set(wx, wz)
  const nx = player.pos.x + wx * speed * dt
  const nz = player.pos.z + wz * speed * dt
  if (!hits(nx, player.pos.z)) player.pos.x = nx
  if (!hits(player.pos.x, nz)) player.pos.z = nz
  player.step += dt * speed * 1.4
}

function frame(now) {
  raf = requestAnimationFrame(frame)
  const dt = Math.min(0.05, (now - last) / 1000 || 0)
  last = now
  if (!grid || status.value || props.play) {
    if (grid && !props.play) composer.render()
    return
  }
  const t = now / 1000
  if (!paused.value) move(dt)

  // 카메라: 뒤쪽 위에서 비스듬히, 부드럽게 따라간다
  cam.target.lerp(player.pos, Math.min(1, dt * 8))
  const cp = Math.cos(cam.pitch) * cam.dist
  camera.position.set(cam.target.x + Math.sin(cam.yaw) * cp, cam.target.y + Math.sin(cam.pitch) * cam.dist, cam.target.z + Math.cos(cam.yaw) * cp)
  if (shake > 0) {
    shake = Math.max(0, shake - dt)
    camera.position.x += (Math.random() - 0.5) * shake * 0.8
    camera.position.y += (Math.random() - 0.5) * shake * 0.8
  }
  camera.lookAt(cam.target.x, cam.target.y + 1, cam.target.z)
  stars.position.copy(camera.position)

  // 인형: 걸을 때 1·2 장을 번갈아, 살짝 통통 튄다
  const f = player.moving ? 1 + (Math.floor(player.step) % 2) : 0
  const tex = frames[avatarDir() * 3 + f]
  avatar.material.map = tex
  ghost.material.map = tex
  const bob = player.moving ? Math.abs(Math.sin(player.step * Math.PI)) * 0.06 : 0
  avatar.position.set(player.pos.x, bob, player.pos.z)
  ghost.position.copy(avatar.position)
  shadow.position.set(player.pos.x, 0.03, player.pos.z)

  // 손 닿는 꺼진 간판
  const n = paused.value ? null : findNear()
  if (n !== near.value) near.value = n
  showRing(n)
  if (n) {
    const s = signAt(n)
    keyMark.position.set(s.x + s.nx * 0.4, s.y + 0.85 + Math.sin(t * 5) * 0.08, s.z + s.nz * 0.4)
    ringMat.color.setHex(Math.sin(t * 8) > 0 ? 0xffcf3a : 0xfff3b8)
  }

  // 부탁 가게 빛기둥과 화살표
  const shop = story?.shop
  beacon.visible = !!shop
  if (shop) {
    const s = signAt(shop)
    beacon.position.set(s.x + s.nx * 0.8, 40, s.z + s.nz * 0.8)
    beacon.material.opacity = 0.25 + Math.sin(t * 3) * 0.1
    const dx = s.x - player.pos.x
    const dz = s.z - player.pos.z
    dist.value = Math.round(Math.hypot(dx, dz))
    // 화면 위쪽 = 카메라 앞
    arrow.value = Math.round(((Math.atan2(dx, -dz) + cam.yaw) * 180) / Math.PI)
  }
  if (owner) {
    owner.position.y = Math.abs(Math.sin(t * 2.4)) * 0.08
    owner.visible = Math.hypot(owner.position.x - player.pos.x, owner.position.z - player.pos.z) < 16
  }

  if (traffic.update(dt, player.pos) && !paused.value && wave) sfx.horn()
  people.update(dt, player.pos, t)
  weatherFx.update(dt, camera.position)
  updateSpread(t)
  updateZone(dt)
  updateSparks(dt)
  updateSky(dt)
  miniTimer -= dt
  if (miniTimer <= 0) {
    miniTimer = 0.12
    drawMini(t)
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

function drawMini(t) {
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
  if (story?.shop && Math.sin(t * 8) > -0.3) {
    const s = signAt(story.shop)
    dot(s.x, s.z, '#ff4d6d', 6)
  }
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
  if (props.play || typing(e) || !ready.value) return
  // 대화창은 Enter·Space 를 스스로 받는다
  if (dialog.value) return
  if (onTitle.value) {
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault()
      sfx.click()
      startGame()
    }
    return
  }
  if (e.code === 'Escape') {
    e.preventDefault()
    if (menu.value) return closeMenu()
    if (!paused.value) return openMenu()
    return
  }
  if (paused.value) return
  if (['KeyE', 'Space', 'KeyF', 'Enter'].includes(e.code)) {
    e.preventDefault()
    if (!e.repeat) repair(near.value)
    return
  }
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault()
  keys.add(e.code)
}

function onKeyUp(e) {
  keys.delete(e.code)
}

function onPointerDown(e) {
  if (e.button !== 0 && e.button !== 2) return
  drag = { x: e.clientX, yaw: cam.yaw, y: e.clientY, pitch: cam.pitch }
  e.currentTarget.setPointerCapture?.(e.pointerId)
}

function onPointerMove(e) {
  if (!drag) return
  cam.yaw = drag.yaw - (e.clientX - drag.x) * 0.006
  cam.pitch = Math.max(0.45, Math.min(1.35, drag.pitch + (e.clientY - drag.y) * 0.004))
}

function onPointerUp() {
  drag = null
}

function onWheel(e) {
  e.preventDefault()
  cam.dist = Math.max(7, Math.min(40, cam.dist * (1 + Math.sign(e.deltaY) * 0.1)))
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
  const p = PRESETS[0]
  status.value = `${p.label} 지도를 펼치는 중…`
  try {
    await enter(await load(`world/${p.id}.json`), p.start)
  } catch (e) {
    if (import.meta.env.DEV) console.error(e)
    status.value = ''
    notice.value = '지도를 못 불러왔어요'
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('look:change', onLook)
  if (import.meta.env.DEV) window.__street3d = { player, cam, repair, signs: () => signPlaced, near, story: () => story, startGame, finale, lit: () => litSet }
  boot()
})

// 인트로 시작 메뉴에서 고른 것: 게임 시작·장 고르기는 바로 1장, 조작법은 조작법 판을 띄운다
let begun = 0
watch(
  () => [props.beginAt, ready.value],
  ([at, ok]) => {
    if (!ok || !grid || props.play) return
    if (!at) {
      if (!begun && !story) (onTitle.value = true), (begun = -1)
      return
    }
    if (at === begun) return
    begun = at
    if (props.begin === 'keys') (onTitle.value = true), (panel.value = 'keys')
    else startGame()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  clearTimeout(toastTimer)
  observer?.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('look:change', onLook)
  fx.uSpreadOn.value = 0
  fx.uSpreadN.value = 0
  fx.uWave.value.set(0, 0, 0)
  if (scene) {
    for (const g of [worldGroup, signGroup, treeGroup, neonGroup, traffic?.group, people?.group]) disposeGroup(g)
    traffic?.dispose()
    people?.dispose()
    weatherFx?.dispose()
    for (const t of frames) t.dispose()
  }
  composer?.dispose()
  renderer?.dispose()
  renderer?.forceContextLoss()
  renderer?.domElement.remove()
  if (import.meta.env.DEV) delete window.__street3d
})
</script>

<template>
  <Street2D v-if="play" :windowed="windowed" :play="play" @close="emit('close')" @unfull="emit('unfull')" />
  <div v-show="!play" ref="box" class="s3" :class="{ windowed }">
    <!-- 불러오는 중 -->
    <div v-if="!ready" class="s3-load">
      <p>{{ status }}</p>
      <span class="s3-dots"><i></i><i></i><i></i></span>
    </div>
    <p v-if="notice" class="s3-notice">{{ notice }}</p>

    <!-- HUD: 켠 간판 수, 작은 지도, 부탁 가게 방향 -->
    <template v-if="ready && !onTitle">
      <div class="s3-count" :class="{ goal: phase === 'free' }">
        <Lightbulb class="ic" />{{ litCount }}<small v-if="phase === 'free'">/{{ GOAL }}</small>
      </div>
      <canvas ref="mini" class="s3-mini" width="132" height="132"></canvas>
      <div v-if="phase === 'shop'" class="s3-goal">
        <span class="s3-arrow" :style="{ transform: `rotate(${arrow}deg)` }">▲</span>{{ dist }}m
      </div>
      <div v-if="near && !paused" class="s3-hint"><kbd>E</kbd>고치기</div>
      <transition name="s3-pop">
        <div v-if="toast" class="s3-toast" :style="{ '--neon': toast.color }">{{ toast.name }}</div>
      </transition>
    </template>

    <RpgDialog
      v-if="dialog"
      :key="`${dialog.who}-${dialog.i}-${dialog.lines.length}`"
      :who="dialog.who"
      :face="dialog.face"
      :portrait="dialog.portrait"
      :tone="dialog.tone"
      :text="dialog.lines[dialog.i]"
      @next="nextLine()"
    />

    <!-- 타이틀: Dock 에서 바로 연 때 -->
    <div v-if="ready && onTitle" class="s3-scrim">
      <div class="s3-panel">
        <h1>간판 수리공<em>3D</em></h1>
        <template v-if="panel !== 'keys'">
          <button class="on" @click="startGame">▶ 시작하기</button>
          <button @click="panel = 'keys'">조작법</button>
        </template>
        <template v-else>
          <dl class="s3-keys">
            <dt>WASD · 방향키</dt><dd>걷기</dd>
            <dt>Shift</dt><dd>달리기</dd>
            <dt>E · Space</dt><dd>간판 고치기</dd>
            <dt>끌기 · Z X</dt><dd>시점 돌리기</dd>
            <dt>휠</dt><dd>가깝게 · 멀리</dd>
            <dt>Esc</dt><dd>메뉴</dd>
          </dl>
          <button class="on" @click="startGame">▶ 시작하기</button>
        </template>
      </div>
    </div>

    <!-- 게임 메뉴 -->
    <div v-if="menu" class="s3-scrim">
      <div class="s3-panel">
        <template v-if="panel !== 'keys'">
          <button class="on" @click="closeMenu">▶ 계속하기</button>
          <button @click="panel = 'keys'">조작법</button>
          <button v-if="!windowed" @click="unfull">창 모드로</button>
          <button @click="close">나가기</button>
        </template>
        <template v-else>
          <dl class="s3-keys">
            <dt>WASD · 방향키</dt><dd>걷기</dd>
            <dt>Shift</dt><dd>달리기</dd>
            <dt>E · Space</dt><dd>간판 고치기</dd>
            <dt>끌기 · Z X</dt><dd>시점 돌리기</dd>
            <dt>휠</dt><dd>가깝게 · 멀리</dd>
            <dt>Esc</dt><dd>메뉴</dd>
          </dl>
          <button class="on" @click="panel = ''">◀ 돌아가기</button>
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
</style>
