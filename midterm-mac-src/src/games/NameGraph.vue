<script setup>
// 이름 별자리: 찾은 간판을 검은 하늘의 점으로 띄우고, 묶음(동네·업종·글자 자리)마다 실로 잇는다.
// 끌면 돌고, 휠·두 손으로 당기면 다가가고, 점을 누르면 그 간판 카드가 열린다
// 손 조작 중엔 웹캠을 빈 자리에 뜬 작은 유리 창(visionOS 창처럼)에 띄운다: 손끝이 가까운 별을 잡아끌고, 두 손으로 집으면 별자리가 두 손 사이에 걸린다
// 휠·핀치는 커서가 가리킨 자리로 끝까지(×60) 다가가고, 그 자리를 축으로 돈다
// 열려 있는 동안 잔잔한 곡(Starfield Romance)이 흐르고, 별에 닿고·고르고·돌리고·다가가는 손짓이 곡과 같은 조의 소리로 얹힌다(skyaudio.js)
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { GESTURES, REACH } from '../hand.js'
import { sky } from './skyaudio.js'
import Glass from './Glass.vue'

const props = defineProps({
  word: { type: String, required: true },
  // 이름까지 아는 간판(검색 표본)
  rows: { type: Array, required: true },
  // 이름 없이 동네·업종·글자 자리만 아는 점(전국에서 고르게 뽑은 것). 없으면 이름 아는 간판만 띄운다
  dots: { type: Array, default: () => [] },
  // 그 말이 든 전국 간판 수
  total: { type: Number, default: 0 },
  // 손 커서 자리(화면 좌표). 없으면 마우스로 고른다
  hand: Boolean,
  // 손 조작 카메라 영상(MediaStream). 있으면 배경에 깐다
  stream: { type: null, default: null },
})
const emit = defineEmits(['town', 'close', 'hand'])

const FONT = "'Pretendard Variable', Pretendard, sans-serif"
const HOT = '#ff4f00'
const MAX_NAMED = 60
const MAX_DOTS = 4000
const MAX_HUBS = 30
const SPOTS = ['딱 그 이름', '앞에', '가운데', '끝에']
const MOUSE = [
  ['끌기', '돌리기'],
  ['휠·핀치', '가리킨 곳으로 확대'],
  ['점 누르기', '열기'],
]

const VIEWS = [
  { key: 'town', name: '동네', note: '같은 동네 간판끼리 모였어요. 자리는 실제 지도를 따라요' },
  { key: 'cat', name: '업종', note: '같은 장사끼리 모였어요. 큰 무리일수록 그 이름이 흔한 업종' },
  { key: 'spot', name: '글자 자리', note: `‘${props.word}’가 이름 앞에 오는지, 가운데인지, 끝인지` },
]
const view = ref('town')
const viewInfo = computed(() => VIEWS.find((v) => v.key === view.value))

const wrap = ref(null)
const cv = ref(null)
const camEl = ref(null)
const hover = ref(null)
const chosen = ref(null)
const tip = ref({ x: 0, y: 0 })

// 같은 간판은 늘 같은 자리에 오도록 이름으로 만든 난수를 쓴다
function rand(s, k = 0) {
  let h = 2166136261 ^ k
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

// 구 위에 고르게 n 개를 뿌린다
function sphere(i, n) {
  const y = n === 1 ? 0 : 1 - (2 * (i + 0.5)) / n
  const r = Math.sqrt(1 - y * y)
  const a = i * 2.399963
  return [Math.cos(a) * r, y, Math.sin(a) * r]
}

const spotOf = (r) => (!r.parts[0] && !r.parts[2] ? 0 : !r.parts[0] ? 1 : !r.parts[2] ? 3 : 2)
const shortOf = (region) => region.split(' ').slice(-1)[0]

// 이름 아는 간판 + 이름 없는 점. 이름 아는 간판도 표본의 한 곳이라, 같은 동네·업종·자리 점을 하나씩 빼서 그만큼 대신 선다
const named = props.rows.slice(0, MAX_NAMED).map((r) => ({ r, key: r.key, named: true, spot: spotOf(r) }))
const pool = props.dots.slice(0, MAX_DOTS)
for (const s of named) {
  const i = pool.findIndex((d) => d && d.region === s.r.region && d.cat === s.r.cat && d.spot === s.spot)
  if (i >= 0) pool[i] = null
}
const anon = pool.filter(Boolean).map((d, i) => ({
  r: { region: d.region, short: shortOf(d.region), lng: d.lng, lat: d.lat, cat: d.cat, floor: null },
  key: `${props.word}#${i}`,
  named: false,
  spot: d.spot,
}))
const signs = [...named, ...anon]
for (const s of signs) {
  Object.assign(s, { to: [0, 0, 0], hub: null, sx: 0, sy: 0, sz: 0, ss: 1, vis: false })
  s.pos = [(rand(s.key, 1) - 0.5) * 900, (rand(s.key, 2) - 0.5) * 900, (rand(s.key, 3) - 0.5) * 900]
}
const labeled = signs.filter((s) => s.named)
const commonCat = (() => {
  const n = new Map()
  for (const s of signs) n.set(s.r.cat, (n.get(s.r.cat) || 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
})()

let hubs = []
let hubLinks = []

// 묶음을 정하고 묶음 중심(허브)과 간판 자리를 새로 잡는다. 점은 매 프레임 새 자리로 미끄러진다
function layout() {
  const keyOf = { town: (s) => s.r.region, cat: (s) => s.r.cat || '기타', spot: (s) => SPOTS[s.spot] }[view.value]
  const by = new Map()
  for (const s of signs) {
    const k = keyOf(s)
    if (!by.has(k)) by.set(k, [])
    by.get(k).push(s)
  }
  let groups = [...by.entries()].sort((a, b) => b[1].length - a[1].length)
  // 동네는 전부 제자리에 띄워 점만으로 전국 모양이 나오게 하고, 업종만 큰 무리 몇 개로 줄인다
  const town = view.value === 'town'
  if (!town && groups.length > MAX_HUBS) {
    const rest = groups.slice(MAX_HUBS - 1).flatMap(([, list]) => list)
    groups = [...groups.slice(0, MAX_HUBS - 1), ['그 밖', rest]]
  }
  const R = town ? 420 : 250
  hubs = groups.map(([name, list], i) => {
    let c
    if (town) {
      const r = list[0].r
      c = [(r.lng - 127.8) * 105, -(r.lat - 36.2) * 125, (rand(name, 7) - 0.5) * 120]
    } else c = sphere(i, groups.length).map((v) => v * R)
    const label = town ? shortOf(name) : name
    return { name, label, list, c, sx: 0, sy: 0, ss: 1, sz: 0 }
  })
  if (town) {
    // 섬(제주)까지 넣으면 위아래가 길어져서 가장 먼 허브를 R 에 맞춘다
    const far = Math.max(1, ...hubs.map((h) => Math.hypot(h.c[0], h.c[1])))
    for (const h of hubs) ((h.c[0] *= R / far), (h.c[1] *= R / far))
  }
  // 서울·경기처럼 붙은 묶음은 서로 밀어내 겹치지 않게 벌린다. 동네는 지도 모양이 남게 조금만
  const spread = (n) => (town ? 4 + Math.sqrt(n) * 3.5 : 14 + Math.sqrt(n) * 6)
  const room = (h) => spread(h.list.length) + (town ? 3 : 12)
  for (let it = 0; it < 80; it++)
    for (let a = 0; a < hubs.length; a++)
      for (let b = a + 1; b < hubs.length; b++) {
        const A = hubs[a].c
        const B = hubs[b].c
        const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]]
        const len = Math.hypot(...d) || 1
        const need = room(hubs[a]) + room(hubs[b])
        if (len >= need) continue
        const push = (need - len) / 2 / len
        for (let k = 0; k < 3; k++) ((A[k] -= d[k] * push), (B[k] += d[k] * push))
      }
  for (const h of hubs) {
    const n = h.list.length
    const rr = spread(n)
    h.list.forEach((s, i) => {
      const d = sphere(i, n)
      // 안쪽이 빽빽하고 바깥으로 갈수록 성긴 무리
      const k = 0.25 + 0.75 * Math.sqrt(rand(s.key, 4))
      s.to = [h.c[0] + d[0] * rr * k, h.c[1] + d[1] * rr * k, h.c[2] + d[2] * rr * k]
      s.hub = h
    })
  }
  // 무리 전체의 한가운데를 원점으로 옮겨 화면 가운데에 오게 한다
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (const s of signs) for (let k = 0; k < 3; k++) ((lo[k] = Math.min(lo[k], s.to[k])), (hi[k] = Math.max(hi[k], s.to[k])))
  const mid = lo.map((v, k) => (v + hi[k]) / 2)
  for (const h of hubs) for (let k = 0; k < 3; k++) h.c[k] -= mid[k]
  for (const s of signs) for (let k = 0; k < 3; k++) s.to[k] -= mid[k]
  hubLinks = mst(hubs.map((h) => h.c))
  // 간판이 적으면 무리가 작아서, 가장 먼 점이 화면 높이의 40% 쯤에 오게 맞춘다
  extent = Math.max(120, ...signs.map((s) => Math.hypot(...s.to)), ...hubs.map((h) => Math.hypot(...h.c)))
}
let extent = 300

function mst(pts) {
  if (pts.length < 2) return []
  const d = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  const inTree = new Set([0])
  const out = []
  while (inTree.size < pts.length) {
    let best = null
    for (const i of inTree)
      for (let j = 0; j < pts.length; j++) {
        if (inTree.has(j)) continue
        const w = d(pts[i], pts[j])
        if (!best || w < best[2]) best = [i, j, w]
      }
    out.push([best[0], best[1]])
    inTree.add(best[1])
  }
  return out
}

// ── 카메라 ──
// 위 검색창과 아래 보기 단추를 피해 그 사이 가운데에 별자리를 놓는다
const SAFE_TOP = 64
const SAFE_BOTTOM = 84
const midY = () => SAFE_TOP + (H - SAFE_TOP - SAFE_BOTTOM) / 2
// t 는 도는 축(화면 가운데에 오는 점). 배율과 축은 목표(zoomTo·tTo)를 향해 부드럽게 따라간다
const ZOOM_MIN = 0.5
const ZOOM_MAX = 60
const cam = { yaw: -0.35, pitch: 0.28, zoom: 1, zoomTo: 1, t: [0, 0, 0], tTo: [0, 0, 0], fit: 0, f: 900 }
const zoomShown = ref(1)
let W = 0
let H = 0
let dpr = 1
let lastInput = 0

function project(p, o) {
  const cy = Math.cos(cam.yaw)
  const sy = Math.sin(cam.yaw)
  const cp = Math.cos(cam.pitch)
  const sp = Math.sin(cam.pitch)
  const px = p[0] - cam.t[0]
  const py = p[1] - cam.t[1]
  const pz = p[2] - cam.t[2]
  const x1 = px * cy + pz * sy
  const z1 = -px * sy + pz * cy
  const y2 = py * cp - z1 * sp
  const z2 = py * sp + z1 * cp
  const s = (cam.f / (cam.f + z2)) * cam.zoom * cam.fit
  o.sx = W / 2 + pan.x + x1 * s
  o.sy = midY() + pan.y + y2 * s
  o.sz = z2
  o.ss = s
  // 눈앞을 지나쳐 뒤로 넘어간 점은 그리지 않는다
  o.vis = cam.f + z2 > cam.f * 0.35
  return o
}

function resize() {
  const el = wrap.value
  if (!el || !cv.value) return
  // 점 수천 개를 레티나 두 배로 그리면 무겁다. 1.5배면 충분히 또렷하다
  const d = Math.min(1.5, window.devicePixelRatio || 1)
  if (d !== dpr) sprites.clear()
  dpr = d
  W = el.clientWidth
  H = el.clientHeight
  cv.value.width = W * dpr
  cv.value.height = H * dpr
}

// ── 손 ──
// 손 조작(HandControl)이 매 프레임 넘겨 주는 손끝·집은 손 자리. 잠깐 끊기면 300ms 까지 마지막 것을 쓴다
let frame = null
let frameAt = 0
const feed = (f) => ((frame = f), (frameAt = performance.now()))
// 두 손으로 집으면 별자리 가운데가 두 손 사이로 옮겨 간다. 놓으면 천천히 제자리로
const pan = { x: 0, y: 0 }

// 손끝마다 가까운 별 둘에 주황 실을 걸고, 손끝엔 흰 점과 주황 고리. 두 손으로 집으면 그 사이에 점선과 배율
const near2 = [null, null]
// 손끝마다 마지막으로 울린 별. 손끝이 새 별에 바짝 닿을 때만 한 번 울린다
const rang = []
function drawHands(g, tips, held) {
  g.lineWidth = 1
  for (const [i, p] of tips.entries()) {
    near2[0] = near2[1] = null
    let d0 = 150 * 150
    let d1 = 150 * 150
    for (const s of signs) {
      if (!s.vis) continue
      const d = (s.sx - p.x) ** 2 + (s.sy - p.y) ** 2
      if (d < d0) ((d1 = d0), (near2[1] = near2[0]), (d0 = d), (near2[0] = s))
      else if (d < d1) ((d1 = d), (near2[1] = s))
    }
    const touching = d0 < 30 * 30 ? near2[0] : null
    if (touching && touching !== rang[i]) sky.touch(touching.sy / H, touching.named)
    rang[i] = touching
    for (const [s, d] of [
      [near2[0], d0],
      [near2[1], d1],
    ]) {
      if (!s) continue
      g.strokeStyle = `rgb(255 79 0 / ${1 - Math.sqrt(d) / 150})`
      g.beginPath()
      g.moveTo(p.x, p.y)
      g.lineTo(s.sx, s.sy)
      g.stroke()
    }
  }
  for (const p of tips) {
    g.fillStyle = '#fff'
    g.beginPath()
    g.arc(p.x, p.y, 3, 0, Math.PI * 2)
    g.fill()
    g.strokeStyle = 'rgb(255 79 0 / 0.8)'
    g.beginPath()
    g.arc(p.x, p.y, 6, 0, Math.PI * 2)
    g.stroke()
  }
  if (held) {
    const [a, b] = held
    g.strokeStyle = HOT
    g.lineWidth = 1.5
    g.setLineDash([4, 4])
    g.beginPath()
    g.moveTo(a.x, a.y)
    g.lineTo(b.x, b.y)
    g.stroke()
    g.setLineDash([])
    g.fillStyle = HOT
    for (const p of held) {
      g.beginPath()
      g.arc(p.x, p.y, 6, 0, Math.PI * 2)
      g.fill()
    }
    g.font = `700 13px ${FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineWidth = 3
    g.strokeStyle = 'rgb(0 0 0 / 0.9)'
    const t = `× ${cam.zoom.toFixed(1)}`
    g.strokeText(t, (a.x + b.x) / 2, (a.y + b.y) / 2 + 22)
    g.fillText(t, (a.x + b.x) / 2, (a.y + b.y) / 2 + 22)
    g.textAlign = 'start'
  }
}

// ── 소리 ──
// 도는 빠르기는 바람으로, 다가간 정도는 잔향 깊이로, 배율이 반 옥타브(√2배) 넘어갈 때마다 한 음
let heard = { yaw: 0, pitch: 0, step: 0 }
function hear(held) {
  const speed = Math.min(1, Math.hypot(cam.yaw - heard.yaw, cam.pitch - heard.pitch) / 0.05)
  const depth = Math.max(0, Math.log(cam.zoom) / Math.log(ZOOM_MAX))
  sky.frame(speed, depth, !!held)
  const step = Math.round(Math.log2(Math.max(1, cam.zoom)) * 2)
  if (step !== heard.step) sky.step(step)
  heard = { yaw: cam.yaw, pitch: cam.pitch, step }
}
watch(hover, (s) => s && sky.touch(s.sy / H, s.named))
watch(chosen, (s) => s && sky.chime(s.sy / H))

// ── 그리기 ──
let raf = 0

// 글자 조각: 검은 테를 두른 흰 글자를 화면 배율로 한 번 그려 두고 투명도만 바꿔 찍는다
const PAD = 3
const sprites = new Map()
function textSprite(t, weight, size) {
  const key = `${weight}|${size}|${t}`
  let sp = sprites.get(key)
  if (sp) return sp
  if (sprites.size > 4000) sprites.clear()
  const m = document.createElement('canvas').getContext('2d')
  m.font = `${weight} ${size}px ${FONT}`
  const w = m.measureText(t).width
  const h = Math.ceil(size * 1.5 + PAD * 2)
  const c = document.createElement('canvas')
  c.width = Math.ceil((w + PAD * 2) * dpr)
  c.height = Math.ceil(h * dpr)
  const x = c.getContext('2d')
  x.scale(dpr, dpr)
  x.font = m.font
  x.textBaseline = 'middle'
  x.lineJoin = 'round'
  x.strokeStyle = 'rgb(0 0 0 / 0.7)'
  x.lineWidth = 3
  x.strokeText(t, PAD, h / 2)
  x.fillStyle = '#fff'
  x.fillText(t, PAD, h / 2)
  sp = { c, w, h }
  sprites.set(key, sp)
  return sp
}
// 글꼴이 늦게 도착하면 대체 글꼴로 그려 둔 조각을 버린다
document.fonts?.addEventListener('loadingdone', () => sprites.clear())
const tmp = {}

// 이름 아는 간판 둘레의 주황 번짐. 한 번 그려 두고 찍는다
const glow = document.createElement('canvas')
glow.width = glow.height = 64
{
  const c = glow.getContext('2d')
  const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32)
  gr.addColorStop(0, 'rgb(255 79 0 / 0.55)')
  gr.addColorStop(0.35, 'rgb(255 79 0 / 0.16)')
  gr.addColorStop(1, 'rgb(255 79 0 / 0)')
  c.fillStyle = gr
  c.fillRect(0, 0, 64, 64)
}

// 둥근 캡슐(허브 이름표). 유리판처럼 어두운 반투명 바탕에 윗변만 밝은 테
function capsule(g, x, y, w, h) {
  const r = h / 2
  g.beginPath()
  g.roundRect(x, y, w, h, r)
  g.fillStyle = 'rgb(36 36 42 / 0.62)'
  g.fill()
  g.lineWidth = 0.5
  g.strokeStyle = 'rgb(255 255 255 / 0.16)'
  g.stroke()
  g.beginPath()
  g.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, r)
  g.strokeStyle = 'rgb(255 255 255 / 0.1)'
  g.stroke()
}

function draw() {
  raf = requestAnimationFrame(draw)
  const g = cv.value?.getContext('2d')
  if (!g || !W) return
  const now = performance.now()
  // 놓은 뒤엔 미끄러지듯 조금 더 돌고, 오래 가만히 두면(멀리서 볼 때만) 천천히 돈다
  if (!dragging && (Math.abs(spin.x) > 0.05 || Math.abs(spin.y) > 0.05)) {
    turn(spin.x, spin.y)
    spin.x *= 0.93
    spin.y *= 0.93
  } else if (now - lastInput > 2500 && !dragging && cam.zoomTo < 1.5) cam.yaw += 0.0016
  const fit = (Math.min(W, H - SAFE_TOP - SAFE_BOTTOM) * 0.42) / extent
  cam.fit = cam.fit ? cam.fit + (fit - cam.fit) * 0.06 : fit
  // 배율은 로그로, 축은 그대로 같은 빠르기로 따라가야 가리킨 자리가 덜 밀린다
  cam.zoom = Math.exp(Math.log(cam.zoom) + (Math.log(cam.zoomTo) - Math.log(cam.zoom)) * 0.18)
  for (let k = 0; k < 3; k++) cam.t[k] += (cam.tTo[k] - cam.t[k]) * 0.18
  if (Math.abs(zoomShown.value - cam.zoom) / cam.zoom > 0.02) zoomShown.value = cam.zoom
  const live = props.hand && frame && now - frameAt < 300
  const tips = live ? frame.tips : []
  const held = live && frame.held.length === 2 ? frame.held : null
  hear(held)
  const tx = held ? (held[0].x + held[1].x) / 2 - W / 2 : 0
  const ty = held ? (held[0].y + held[1].y) / 2 - midY() : 0
  pan.x += (tx - pan.x) * (held ? 0.25 : 0.04)
  pan.y += (ty - pan.y) * (held ? 0.25 : 0.04)

  for (const s of signs) {
    for (let k = 0; k < 3; k++) s.pos[k] += (s.to[k] - s.pos[k]) * 0.08
    project(s.pos, s)
    // 화면 밖 점은 그리지도 고르지도 않는다(가까이 다가가면 대부분이 밖)
    if (s.vis && (s.sx < -40 || s.sx > W + 40 || s.sy < -40 || s.sy > H + 40)) s.vis = false
  }
  for (const h of hubs) project(h.c, h)

  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, W, H)
  const depth = (z) => Math.max(0.15, Math.min(1, 0.75 - z / 700))
  // 점이 수천 개라 투명도를 몇 단계로 묶어 단계마다 한 번에 그린다
  const LEVELS = 6
  const level = (z) => Math.min(LEVELS - 1, Math.floor(depth(z) * LEVELS))
  const alphaOf = (l) => (l + 0.5) / LEVELS
  const near = hover.value || chosen.value
  // 다가갈수록 점은 커지지만 끝없이 커지진 않게 제곱근으로 누르고 상한을 둔다
  const dotR = (s) => Math.min(4.5, 0.45 + 0.8 * Math.sqrt(s.ss))
  const namedR = (s) => Math.min(7, 1.6 + 1.1 * Math.sqrt(s.ss))

  // 허브끼리: 바깥으로 휘는 가는 곡선
  g.lineWidth = 0.75
  g.lineCap = 'round'
  for (const [a, b] of hubLinks) {
    const A = hubs[a]
    const B = hubs[b]
    if (!A.vis || !B.vis) continue
    // 두 허브 가운데를 원점 바깥쪽으로 조금 밀어 곡선의 꺾임점으로 쓴다
    const m = [(A.c[0] + B.c[0]) / 2, (A.c[1] + B.c[1]) / 2, (A.c[2] + B.c[2]) / 2]
    const ml = Math.hypot(...m) || 1
    const bend = Math.hypot(A.c[0] - B.c[0], A.c[1] - B.c[1], A.c[2] - B.c[2]) * 0.18
    project([m[0] + (m[0] / ml) * bend, m[1] + (m[1] / ml) * bend, m[2] + (m[2] / ml) * bend], tmp)
    g.strokeStyle = `rgb(255 255 255 / ${0.22 * depth((A.sz + B.sz) / 2)})`
    g.beginPath()
    g.moveTo(A.sx, A.sy)
    g.quadraticCurveTo(tmp.sx, tmp.sy, B.sx, B.sy)
    g.stroke()
  }

  // 간판 → 허브 실, 간판 점. 고른 무리는 한 단계 밝게
  const lines = Array.from({ length: LEVELS }, () => [])
  const marks = Array.from({ length: LEVELS }, () => [])
  for (const s of signs) {
    if (!s.vis) continue
    const l = level(s.sz)
    if (s.hub?.vis) lines[l].push(s)
    marks[l].push(s)
  }
  g.lineWidth = 0.5
  lines.forEach((list, l) => {
    if (!list.length) return
    g.strokeStyle = `rgb(255 255 255 / ${0.06 * alphaOf(l)})`
    g.beginPath()
    for (const s of list) {
      g.moveTo(s.sx, s.sy)
      g.lineTo(s.hub.sx, s.hub.sy)
    }
    g.stroke()
  })
  if (near?.hub?.vis) {
    g.strokeStyle = 'rgb(255 255 255 / 0.35)'
    g.beginPath()
    for (const s of near.hub.list) {
      if (!s.vis) continue
      g.moveTo(s.sx, s.sy)
      g.lineTo(near.hub.sx, near.hub.sy)
    }
    g.stroke()
  }

  // 이름 없는 점: 둥근 빛 알갱이. 겹치면 더해져 빽빽한 곳이 은하처럼 밝아진다
  g.globalCompositeOperation = 'lighter'
  // 2px 도 안 되는 점은 원 대신 같은 넓이의 네모로 찍는다(원은 수천 개면 무겁고, 이 크기에선 눈으로 구별이 안 된다)
  marks.forEach((list, l) => {
    if (!list.length) return
    g.fillStyle = `rgb(235 238 255 / ${0.6 * alphaOf(l)})`
    g.beginPath()
    for (const s of list) {
      if (s.named) continue
      const r = dotR(s)
      if (r < 1.6) {
        const a = r * 1.77
        g.rect(s.sx - a / 2, s.sy - a / 2, a, a)
      } else {
        g.moveTo(s.sx + r, s.sy)
        g.arc(s.sx, s.sy, r, 0, Math.PI * 2)
      }
    }
    g.fill()
  })
  // 이름 아는 간판 둘레 번짐
  for (const s of labeled) {
    if (!s.vis) continue
    const r = namedR(s) * 4.5
    g.globalAlpha = 0.35 + 0.65 * depth(s.sz)
    g.drawImage(glow, s.sx - r, s.sy - r, r * 2, r * 2)
  }
  g.globalAlpha = 1
  g.globalCompositeOperation = 'source-over'

  // 아주 가까이 오면 이름 없는 점도 유리 구슬처럼 가는 테를 두른다
  g.lineWidth = 0.75
  g.strokeStyle = 'rgb(255 255 255 / 0.35)'
  g.beginPath()
  for (const s of signs) {
    if (!s.vis || s.named || s.ss < 9) continue
    const r = dotR(s)
    g.moveTo(s.sx + r, s.sy)
    g.arc(s.sx, s.sy, r, 0, Math.PI * 2)
  }
  g.stroke()

  // 이름 아는 간판: 주황 유리 구슬(바탕 + 왼쪽 위 반사광 + 흰 테)
  for (const s of labeled) {
    if (!s.vis) continue
    const r = namedR(s)
    const a = 0.45 + 0.55 * depth(s.sz)
    g.fillStyle = `rgb(255 79 0 / ${a})`
    g.beginPath()
    g.arc(s.sx, s.sy, r, 0, Math.PI * 2)
    g.fill()
    g.lineWidth = 0.75
    g.strokeStyle = `rgb(255 255 255 / ${0.5 * a})`
    g.stroke()
    g.fillStyle = `rgb(255 255 255 / ${0.55 * a})`
    g.beginPath()
    g.arc(s.sx - r * 0.32, s.sy - r * 0.36, r * 0.32, 0, Math.PI * 2)
    g.fill()
  }

  // 가리키거나 고른 간판: 흰 고리. 고른 것은 숨 쉬듯 천천히 커졌다 작아진다
  for (const s of [hover.value, chosen.value]) {
    if (!s?.vis) continue
    const r = (s.named ? namedR(s) : dotR(s)) + 5 + (s === chosen.value ? Math.sin(now / 420) * 1.5 : 0)
    g.fillStyle = 'rgb(255 255 255 / 0.12)'
    g.beginPath()
    g.arc(s.sx, s.sy, r, 0, Math.PI * 2)
    g.fill()
    g.lineWidth = 1.25
    g.strokeStyle = 'rgb(255 255 255 / 0.9)'
    g.stroke()
    if (!s.named) {
      g.fillStyle = '#fff'
      g.beginPath()
      g.arc(s.sx, s.sy, dotR(s) + 0.5, 0, Math.PI * 2)
      g.fill()
    }
  }

  if (tips.length || held) drawHands(g, tips, held)
  if (props.stream) drawPreview(tips, held)

  // 허브: 가운데가 빈 작은 고리
  g.lineWidth = 1
  for (const h of hubs) {
    if (!h.vis) continue
    g.strokeStyle = `rgb(255 255 255 / ${0.8 * depth(h.sz)})`
    g.beginPath()
    g.arc(h.sx, h.sy, Math.min(3.5, 1.5 + Math.sqrt(h.list.length) * 0.4) * Math.min(2, Math.sqrt(cam.zoom)), 0, Math.PI * 2)
    g.stroke()
  }

  // 글자: 큰 묶음 이름(캡슐) → 가까운 간판 이름 → 남은 묶음 이름 → 아주 가까이선 이름 없는 점의 업종 순으로, 겹치지 않는 것만 단다
  const boxes = []
  const free = (b) => b[0] >= 0 && b[2] <= W && b[1] >= 0 && b[3] <= H && !boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])
  // 글자 뒤에 옅은 검은 테를 둘러 점·실 위에서도 읽히게 한다
  // 글자는 매번 새로 그리면 무거워서, 한 번 그려 둔 조각(textSprite)을 찍는다
  const say = (t, x, y, weight, size, alpha) => {
    if (!t) return 0
    const sp = textSprite(t, weight, size)
    g.globalAlpha = alpha
    g.drawImage(sp.c, x - PAD, y - sp.h / 2, sp.w + PAD * 2, sp.h)
    g.globalAlpha = 1
    return sp.w
  }
  const width = (t, weight, size) => (t ? textSprite(t, weight, size).w : 0)
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  const hubLabel = (h, pill) => {
    if (!h.vis) return
    const count = ` ${h.list.length}`
    const w = width(h.label, 600, 12)
    const wc = width(count, 500, 11)
    const x = h.sx + 9
    const b = pill ? [x, h.sy - 11, x + w + wc + 20, h.sy + 11] : [x - 2, h.sy - 9, x + 3 + w + wc, h.sy + 9]
    if (!free(b)) return
    boxes.push(b)
    const a = depth(h.sz)
    if (pill) {
      g.globalAlpha = 0.55 + 0.45 * a
      capsule(g, b[0], b[1], b[2] - b[0], b[3] - b[1])
      g.globalAlpha = 1
      say(h.label, x + 10, h.sy + 0.5, 600, 12, 0.95)
      say(count, x + 10 + w, h.sy + 0.5, 500, 11, 0.5)
    } else {
      say(h.label, x, h.sy, 600, 12, 0.45 + 0.5 * a)
      say(count, x + w, h.sy, 400, 11, 0.15 + 0.3 * a)
    }
  }
  const signLabel = (s) => {
    const [pre, mid, post] = s.r.parts
    const w0 = width(pre, 400, 11.5)
    const w1 = width(mid, 700, 11.5)
    const x = s.sx + namedR(s) + 5
    const b = [x - 2, s.sy - 8, x + 3 + w0 + w1 + width(post, 400, 11.5), s.sy + 8]
    if (!free(b)) return false
    boxes.push(b)
    const a = depth(s.sz)
    say(pre, x, s.sy, 400, 11.5, 0.45 + 0.4 * a)
    say(mid, x + w0, s.sy, 700, 11.5, 0.7 + 0.3 * a)
    say(post, x + w0 + w1, s.sy, 400, 11.5, 0.45 + 0.4 * a)
    return true
  }
  const TOP = 12
  hubs.slice(0, TOP).forEach((h) => hubLabel(h, true))
  let shown = 0
  for (const s of labeled.filter((s) => s.vis).sort((a, b) => a.sz - b.sz)) if (shown < 40 && signLabel(s)) shown++
  hubs.slice(TOP).forEach((h) => hubLabel(h, false))
  // 점 사이가 벌어질 만큼 다가가면 이름 없는 점에도 업종을 단다. 가장 흔한 업종(커피면 카페)은 빼고, 화면 가운데에 가까운 것부터
  if (cam.zoom > 5) {
    const cx = W / 2 + pan.x
    const cy = midY() + pan.y
    const near = signs.filter((s) => s.vis && !s.named && s.ss > 4 && s.r.cat !== commonCat).sort((a, b) => (a.sx - cx) ** 2 + (a.sy - cy) ** 2 - (b.sx - cx) ** 2 - (b.sy - cy) ** 2)
    let n = 0
    for (const s of near) {
      if (n >= 90) break
      const t = s.r.cat || '기타'
      const x = s.sx + dotR(s) + 4
      const b = [x - 2, s.sy - 7, x + 2 + width(t, 400, 10.5), s.sy + 7]
      if (!free(b)) continue
      boxes.push(b)
      say(t, x, s.sy, 400, 10.5, 0.62)
      n++
    }
  }

  // 손 커서가 있으면 그 자리로 고른다
  if (pointer) pickAt(pointer.x, pointer.y)
}

// 화면 좌표에서 가장 가까운 간판(기본 18px 안, 손은 떨려서 더 넓게)
function nearest(cx, cy, r = 18) {
  const box = wrap.value.getBoundingClientRect()
  const x = cx - box.left
  const y = cy - box.top
  let best = null
  let bd = r * r
  for (const s of signs) {
    if (!s.vis) continue
    // 이름 아는 간판이 점 사이에 묻히지 않게 조금 더 잘 잡히게 한다
    const d = ((s.sx - x) ** 2 + (s.sy - y) ** 2) * (s.named ? 0.5 : 1)
    if (d < bd) ((bd = d), (best = s))
  }
  return best
}

function pickAt(cx, cy) {
  const s = nearest(cx, cy, pointer ? 36 : 18)
  hover.value = s
  if (s) {
    const box = wrap.value.getBoundingClientRect()
    tip.value = { x: cx - box.left, y: cy - box.top }
  }
}

// ── 마우스 ──
let dragging = false
let downAt = null
// 놓을 때의 끄는 빠르기. 놓은 뒤에도 이만큼 미끄러지다 멈춘다
const spin = { x: 0, y: 0 }

function onDown(e) {
  dragging = true
  spin.x = spin.y = 0
  downAt = { x: e.clientX, y: e.clientY, moved: 0, at: performance.now() }
  cv.value.setPointerCapture(e.pointerId)
}
function onMove(e) {
  lastInput = performance.now()
  if (dragging && downAt) {
    const dx = e.clientX - downAt.x
    const dy = e.clientY - downAt.y
    downAt.moved += Math.hypot(dx, dy)
    downAt.x = e.clientX
    downAt.y = e.clientY
    downAt.at = lastInput
    spin.x = spin.x * 0.5 + dx * 0.5
    spin.y = spin.y * 0.5 + dy * 0.5
    turn(dx, dy)
  } else if (!pointer) pickAt(e.clientX, e.clientY)
}
function onUp(e) {
  dragging = false
  if (downAt && downAt.moved < 5) choose(e.clientX, e.clientY)
  // 멈췄다가 놓으면 미끄러지지 않는다
  if (!downAt || performance.now() - downAt.at > 80) spin.x = spin.y = 0
  downAt = null
}
// 마우스 휠은 한 칸에 15% 쯤, 트랙패드 핀치(ctrlKey)는 손가락 벌린 만큼
function onWheel(e) {
  const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
  zoomBy(-d * (e.ctrlKey ? 0.012 : 0.0016), e.clientX, e.clientY)
}
// 두 번 누르면 그 자리로 세 배 다가간다
function onDbl(e) {
  zoomBy(Math.log(3), e.clientX, e.clientY)
}

function turn(dx, dy) {
  cam.yaw += dx * 0.006
  cam.pitch = Math.max(-1.3, Math.min(1.3, cam.pitch + dy * 0.006))
}
function rotate(dx, dy) {
  lastInput = performance.now()
  turn(dx, dy)
}
// 화면 (cx, cy)(창 좌표)가 가리키는 자리가 그대로 남도록 축을 그쪽으로 옮기며 배율을 바꾼다.
// 자리를 안 주면(손 조작) 화면 가운데를 기준으로
function zoomBy(dz, cx, cy) {
  lastInput = performance.now()
  const z0 = cam.zoomTo
  const z1 = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z0 * Math.exp(dz)))
  cam.zoomTo = z1
  if (cx === undefined || !wrap.value || z1 === z0) return
  const box = wrap.value.getBoundingClientRect()
  const S = z0 * cam.fit
  const k = 1 - z0 / z1
  // 축 평면 위에서 가리킨 자리까지(카메라 기준) → 그만큼 축을 옮길 양을 세상 좌표로 되돌린다
  const x1 = ((cx - box.left - W / 2 - pan.x) / S) * k
  const y2 = ((cy - box.top - midY() - pan.y) / S) * k
  const cyw = Math.cos(cam.yaw)
  const syw = Math.sin(cam.yaw)
  const cp = Math.cos(cam.pitch)
  const sp = Math.sin(cam.pitch)
  const z1c = -y2 * sp
  cam.tTo[0] += x1 * cyw - z1c * syw
  cam.tTo[1] += y2 * cp
  cam.tTo[2] += x1 * syw + z1c * cyw
}
// 처음 모습으로
function zoomReset() {
  lastInput = performance.now()
  cam.zoomTo = 1
  cam.tTo = [0, 0, 0]
}
function zoomStep(dz) {
  zoomBy(dz, W / 2 + pan.x + wrap.value.getBoundingClientRect().left, midY() + pan.y + wrap.value.getBoundingClientRect().top)
}
function choose(cx, cy, r) {
  lastInput = performance.now()
  chosen.value = nearest(cx, cy, r)
}

function setView(k) {
  view.value = k
  hover.value = null
  chosen.value = null
}
watch(view, () => (layout(), zoomReset(), sky.swell()))

function onKey(e) {
  if (e.target.closest?.('input, textarea')) return
  const i = ['1', '2', '3'].indexOf(e.key)
  if (i >= 0) setView(VIEWS[i].key)
  if (e.key === '+' || e.key === '=') zoomStep(Math.log(2))
  if (e.key === '-') zoomStep(-Math.log(2))
  if (e.key === '0') zoomReset()
  if (e.key === 'Escape') chosen.value ? (chosen.value = null) : emit('close')
}

const floorLabel = (f) => (f === null || f === undefined ? '' : f < 0 ? `지하 ${-f}층` : `${f}층`)
const towns = new Set(signs.map((s) => s.r.region)).size
const countText = (n) => n.toLocaleString()

// 손 조작은 바깥(HandControl)에서 이 함수들을 부른다
// 손 커서 자리(화면 좌표)도 prop 대신 함수로 받는다. 매 프레임 바뀌어 prop 이면 바깥 창 전체가 다시 그려진다
let pointer = null
const point = (p) => (pointer = props.hand ? p : null)
watch(
  () => props.hand,
  (on) => on || ((pointer = null), (hover.value = null)),
)
defineExpose({ rotate, zoomBy, choose, feed, point })

// 카메라 영상은 손 조작이 연 것을 그대로 받아 떠 있는 창의 video 에 건다
watch(
  [() => props.stream, camEl],
  ([s, el]) => {
    if (!el) return
    if (el.srcObject !== s) el.srcObject = s
    if (s) el.play().catch(() => {})
  },
  { flush: 'post' },
)

// 카메라 창 자리와 영상 비율. 창은 아래 막대를 끌어 옮기고, 별자리 화면 밖으로는 못 나간다
const win = ref({ x: 22, y: 252 })
const camAspect = ref('4 / 3')
const onMeta = (e) => (camAspect.value = `${e.target.videoWidth} / ${e.target.videoHeight}`)
let winAt = null
function winDown(e) {
  winAt = { x: e.clientX - win.value.x, y: e.clientY - win.value.y }
  e.target.setPointerCapture(e.pointerId)
}
function winMove(e) {
  if (!winAt) return
  win.value = { x: Math.max(8, Math.min(W - 248, e.clientX - winAt.x)), y: Math.max(60, Math.min(H - 120, e.clientY - winAt.y)) }
}
const winUp = () => (winAt = null)

// 창 속 영상 위에 손끝을 찍는다. 손끝 화면 좌표는 영상 가운데 70%(REACH)를 화면에 펼친 것이라 거꾸로 되돌린다
const pv = ref(null)
function drawPreview(tips, held) {
  const c = pv.value
  if (!c) return
  const w = c.clientWidth
  const h = c.clientHeight
  if (c.width !== w * dpr) ((c.width = w * dpr), (c.height = h * dpr))
  const g = c.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  const at = (p) => [(REACH.lo + (REACH.size * p.x) / W) * w, (REACH.lo + (REACH.size * p.y) / H) * h]
  for (const p of tips) {
    const [x, y] = at(p)
    g.fillStyle = '#fff'
    g.beginPath()
    g.arc(x, y, 2.5, 0, Math.PI * 2)
    g.fill()
  }
  for (const p of held || []) {
    const [x, y] = at(p)
    g.strokeStyle = HOT
    g.lineWidth = 1.5
    g.beginPath()
    g.arc(x, y, 6, 0, Math.PI * 2)
    g.stroke()
  }
}

let ro
onMounted(() => {
  layout()
  resize()
  ro = new ResizeObserver(resize)
  ro.observe(wrap.value)
  window.addEventListener('keydown', onKey)
  raf = requestAnimationFrame(draw)
  sky.on()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  sky.off()
  ro?.disconnect()
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="wrap" class="graph">
    <canvas
      ref="cv"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointerleave="!pointer && (hover = null)"
      @wheel.prevent="onWheel"
      @dblclick="onDbl"
    ></canvas>

    <!-- 손 조작 카메라: 별자리를 가리지 않게 빈 자리에 뜬 작은 유리 창(아래 막대를 끌어 옮긴다) -->
    <div v-if="stream" class="vis" :style="{ left: `${win.x}px`, top: `${win.y}px` }">
      <Glass class="vis-pane" :radius="26" :band="10" :scale="28">
        <div class="vis-view" :style="{ aspectRatio: camAspect }">
          <video ref="camEl" muted playsinline autoplay @loadedmetadata="onMeta"></video>
          <i class="vis-reach"></i>
          <canvas ref="pv"></canvas>
        </div>
      </Glass>
      <span class="vis-bar" title="끌어서 옮기기" @pointerdown="winDown" @pointermove="winMove" @pointerup="winUp"></span>
    </div>

    <!-- 확대 단추: 지도 앱처럼 오른쪽에 세로로 -->
    <Glass class="zoom" :radius="18" :band="8" :scale="22">
      <button aria-label="확대" @click="zoomStep(Math.log(2))">+</button>
      <span>×{{ zoomShown < 10 ? zoomShown.toFixed(1) : Math.round(zoomShown) }}</span>
      <button aria-label="축소" @click="zoomStep(-Math.log(2))">−</button>
      <button aria-label="전체 보기" class="all" :disabled="zoomShown < 1.05 && zoomShown > 0.95" @click="zoomReset">전체</button>
    </Glass>

    <header class="head">
      <h2>‘{{ word }}’의 별자리</h2>
      <p v-if="total > signs.length">전국 {{ countText(total) }}곳 중 {{ countText(signs.length) }}곳을 고르게 띄움 · 동네 {{ towns }}곳 · 이름 {{ labeled.length }}곳</p>
      <p v-else>간판 {{ countText(signs.length) }}곳 · 동네 {{ towns }}곳</p>
      <div class="acts">
        <Glass tag="button" class="pill" :class="{ on: hand }" :radius="17" :band="8" :scale="22" @click="emit('hand')">✋ {{ hand ? '손 조작 끄기' : '손으로 다루기' }}</Glass>
        <Glass tag="button" class="pill" :radius="17" :band="8" :scale="22" @click="emit('close')">지도로</Glass>
      </div>
    </header>

    <nav class="views">
      <Glass class="seg" role="tablist" :radius="18" :band="8" :scale="22">
        <button v-for="(v, i) in VIEWS" :key="v.key" role="tab" :aria-selected="view === v.key" :class="{ on: view === v.key }" @click="setView(v.key)">
          <b>{{ i + 1 }}</b>{{ v.name }}
        </button>
      </Glass>
      <p>{{ viewInfo.note }}</p>
    </nav>

    <!-- 다루는 법은 한 곳에만. 손 조작 중이면 손 동작, 아니면 마우스 -->
    <ul class="how">
      <li v-for="[k, v] in hand ? GESTURES : MOUSE" :key="k"><b>{{ k }}</b>{{ v }}</li>
    </ul>

    <div v-if="hover && hover !== chosen" class="tip" :style="{ transform: `translate(${tip.x + 14}px, ${tip.y + 10}px)` }">
      <b v-if="hover.named">{{ hover.r.parts[0] }}<em>{{ hover.r.parts[1] }}</em>{{ hover.r.parts[2] }}</b>
      <b v-else>{{ hover.r.cat }}</b>
      <small>{{ hover.named ? `${hover.r.cat} · ${hover.r.short}` : `${hover.r.short} · ‘${word}’ ${SPOTS[hover.spot]} · 이름은 안 담은 점` }}</small>
    </div>

    <Glass v-if="chosen" tag="article" class="card" :radius="20" :band="12" :scale="34" :blur="8">
      <span class="k">{{ viewInfo.name }} · {{ chosen.hub?.label }} {{ chosen.hub?.list.length }}곳</span>
      <h3 v-if="chosen.named">{{ chosen.r.parts[0] }}<em>{{ chosen.r.parts[1] }}</em>{{ chosen.r.parts[2] }}</h3>
      <h3 v-else>‘{{ word }}’ 든 {{ chosen.r.cat }}</h3>
      <dl>
        <dt>업종</dt>
        <dd>{{ chosen.r.cat }}</dd>
        <dt>동네</dt>
        <dd>{{ chosen.r.region }}</dd>
        <dt>글자</dt>
        <dd>{{ SPOTS[chosen.spot] }}</dd>
        <template v-if="floorLabel(chosen.r.floor)">
          <dt>층</dt>
          <dd>{{ floorLabel(chosen.r.floor) }}</dd>
        </template>
      </dl>
      <div class="row">
        <button class="go" @click="emit('town', chosen.r.region)">지도에서 이 동네 보기</button>
        <button aria-label="닫기" @click="chosen = null">✕</button>
      </div>
    </Glass>
  </div>
</template>

<style scoped>
.graph {
  position: absolute;
  inset: 0;
  z-index: 3;
  overflow: hidden;
  /* 한가운데가 아주 조금 밝은 흑연빛 하늘 */
  background: radial-gradient(120% 90% at 50% 42%, #17171c 0%, #0a0a0d 55%, #000 100%);
  color: #fff;
  font-family: 'Pretendard Variable', Pretendard, sans-serif;
  /* 별자리 위에 뜨는 리퀴드 글라스 판 */
  --g-tint: rgb(40 40 46 / 0.28);
  --g-ring:
    0 0 0 0.5px rgb(255 255 255 / 0.14),
    0 10px 30px rgb(0 0 0 / 0.5),
    inset 1px 1px 0 -0.5px rgb(255 255 255 / 0.38),
    inset -1px -1px 0 -0.5px rgb(255 255 255 / 0.12);
}

.graph button {
  font-family: inherit;
}

/* visionOS 창처럼: 두꺼운 유리 테 안에 둥근 영상, 아래엔 옮기는 막대 */
.vis {
  position: absolute;
  z-index: 2;
  display: grid;
  justify-items: center;
  gap: 8px;
  width: 240px;
  animation: vis-in 0.35s cubic-bezier(0.2, 0.8, 0.2, 1);
}

@keyframes vis-in {
  from {
    opacity: 0;
    scale: 0.94;
  }
}

.vis-pane {
  width: 100%;
  padding: 6px;
  border-radius: 26px;
  background: var(--g-tint);
  box-shadow: var(--g-ring);
}

.vis-view {
  position: relative;
  overflow: hidden;
  border-radius: 20px;
  background: #111;
}

.vis-view video,
.vis-view canvas {
  pointer-events: none;
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.vis-view video {
  object-fit: fill;
  transform: scaleX(-1);
  filter: grayscale(1) contrast(1.05);
}

/* 손이 닿는 범위(가운데 70%). 이 안에서 움직인 만큼 화면 끝까지 닿는다 */
.vis-reach {
  position: absolute;
  inset: 15%;
  border: 1px solid rgb(255 255 255 / 0.28);
  border-radius: 10px;
  pointer-events: none;
}

.vis-bar {
  width: 64px;
  height: 6px;
  border-radius: 3px;
  background: rgb(255 255 255 / 0.32);
  cursor: grab;
  touch-action: none;
  transition: background-color 0.15s, width 0.2s;
}

.vis-bar:hover {
  width: 76px;
  background: rgb(255 255 255 / 0.6);
}

.vis-bar:active {
  cursor: grabbing;
}

@media (prefers-reduced-motion: reduce) {
  .vis {
    animation: none;
  }
}

.graph > canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
}

.graph > canvas:active {
  cursor: grabbing;
}

.head {
  position: absolute;
  top: 70px;
  left: 22px;
  pointer-events: none;
}

.head h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.head p,
.views p {
  margin: 6px 0 0;
  font-size: 11.5px;
  color: rgb(255 255 255 / 0.6);
}

.acts {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  pointer-events: auto;
}

.app-body .acts .pill {
  min-height: 34px;
  padding: 0 16px;
  border: 0;
  border-radius: 17px;
  background: var(--g-tint);
  box-shadow: var(--g-ring);
  color: #fff;
  font-size: 12.5px;
  font-weight: 500;
  transition: background-color 0.15s;
}

.app-body .acts .pill:hover {
  background: rgb(255 255 255 / 0.14);
}

/* 손 조작 중일 때만 강조색 한 군데 */
.app-body .acts .pill.on {
  background: rgb(255 79 0 / 0.85);
}

.views {
  position: absolute;
  left: 22px;
  bottom: 20px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  max-width: calc(100% - 44px);
}

.views .seg {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 18px;
  background: var(--g-tint);
  box-shadow: var(--g-ring);
}

.app-body .views .seg button {
  min-height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 15px;
  background: none;
  box-shadow: none;
  color: rgb(255 255 255 / 0.6);
  font-size: 12.5px;
  transition: background-color 0.15s, color 0.15s;
}

.views .seg button b {
  margin-right: 6px;
  font-weight: 500;
  color: rgb(255 255 255 / 0.35);
}

.app-body .views .seg button.on {
  background: rgb(255 255 255 / 0.92);
  color: #000;
}

.views .seg button.on b {
  color: rgb(0 0 0 / 0.4);
}

.views p {
  flex-basis: 100%;
  margin: 4px 0 0 4px;
}

.how {
  position: absolute;
  right: 16px;
  bottom: 20px;
  display: flex;
  gap: 14px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 11.5px;
  color: rgb(255 255 255 / 0.45);
}

.how b {
  margin-right: 5px;
  font-weight: 600;
  color: rgb(255 255 255 / 0.85);
}

.zoom {
  position: absolute;
  top: 50%;
  right: 16px;
  display: grid;
  justify-items: center;
  gap: 2px;
  width: 44px;
  padding: 4px;
  border-radius: 22px;
  background: var(--g-tint);
  box-shadow: var(--g-ring);
  translate: 0 -50%;
}

.app-body .zoom button {
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 18px;
  background: none;
  box-shadow: none;
  color: #fff;
  font-size: 19px;
  font-weight: 300;
  line-height: 1;
  transition: background-color 0.15s, opacity 0.15s;
}

.app-body .zoom button:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.14);
}

.app-body .zoom button.all {
  height: 28px;
  margin-top: 2px;
  font-size: 11px;
  font-weight: 600;
  color: rgb(255 255 255 / 0.85);
}

.app-body .zoom button:disabled {
  opacity: 0.3;
}

.zoom span {
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgb(255 255 255 / 0.55);
}

.tip {
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  gap: 2px;
  padding: 7px 11px;
  border-radius: 12px;
  background: rgb(28 28 32 / 0.72);
  -webkit-backdrop-filter: blur(14px) saturate(170%);
  backdrop-filter: blur(14px) saturate(170%);
  box-shadow: var(--g-ring);
  font-size: 12px;
  pointer-events: none;
}

.tip b {
  font-weight: 400;
}

.tip small {
    font-size: 10.5px;
  color: rgb(255 255 255 / 0.55);
}

em {
  font-style: normal;
  font-weight: 800;
}

.card {
  position: absolute;
  right: 16px;
  bottom: 52px;
  width: 270px;
  padding: 16px 18px;
  border-radius: 20px;
  background: rgb(28 28 32 / 0.5);
  box-shadow: var(--g-ring);
  animation: card-in 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
}

@keyframes card-in {
  from {
    opacity: 0;
    translate: 0 8px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .card {
    animation: none;
  }
}

.card .k {
    font-size: 10.5px;
  letter-spacing: 0.04em;
  color: rgb(255 255 255 / 0.5);
}

.card h3 {
  margin: 4px 0 10px;
  font-size: 19px;
  font-weight: 400;
  word-break: keep-all;
}

.card dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  margin: 0 0 12px;
  font-size: 12.5px;
}

.card dt {
    font-size: 11px;
  color: rgb(255 255 255 / 0.45);
}

.card dd {
  margin: 0;
}

.card .row {
  display: flex;
  gap: 6px;
}

.app-body .card .row button {
  min-height: 32px;
  padding: 0 12px;
  border: 0;
  border-radius: 16px;
  background: rgb(255 255 255 / 0.1);
  box-shadow: none;
  color: #fff;
  font-size: 12px;
}

.app-body .card .row .go {
  flex: 1;
  background: #fff;
  color: #000;
  font-weight: 600;
}

@media (max-width: 599px) {
  .how {
    display: none;
  }

  .card {
    left: 12px;
    right: 12px;
    bottom: 88px;
    width: auto;
  }
}
</style>
