<script setup>
// 이름 별자리: 찾은 간판을 검은 하늘의 점으로 띄우고, 묶음(동네·업종·글자 자리)마다 실로 잇는다.
// 끌면 돌고, 휠·두 손으로 당기면 다가가고, 점을 누르면 그 간판 카드가 열린다
// 손 조작 중엔 웹캠을 거울처럼 깔고 그 위에 그린다: 손끝이 가까운 별을 잡아끌고, 두 손으로 집으면 별자리가 두 손 사이에 걸린다
// 움직이는 동안엔 별자리가 흐린 사본 몇 장으로 뒤따라온다(겹친 잔상)
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { GESTURES } from '../hand.js'
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
  pointer: { type: Object, default: null },
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
  ['휠', '다가가기'],
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
const cam = { yaw: -0.35, pitch: 0.28, zoom: 1, fit: 0, f: 900 }
let W = 0
let H = 0
let dpr = 1
let lastInput = 0

function project(p, o) {
  const cy = Math.cos(cam.yaw)
  const sy = Math.sin(cam.yaw)
  const cp = Math.cos(cam.pitch)
  const sp = Math.sin(cam.pitch)
  const x1 = p[0] * cy + p[2] * sy
  const z1 = -p[0] * sy + p[2] * cy
  const y2 = p[1] * cp - z1 * sp
  const z2 = p[1] * sp + z1 * cp
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
  dpr = Math.min(2, window.devicePixelRatio || 1)
  W = el.clientWidth
  H = el.clientHeight
  cv.value.width = W * dpr
  cv.value.height = H * dpr
}

// ── 손과 잔상 ──
// 손 조작(HandControl)이 매 프레임 넘겨 주는 손끝·집은 손 자리. 잠깐 끊기면 300ms 까지 마지막 것을 쓴다
let frame = null
let frameAt = 0
const feed = (f) => ((frame = f), (frameAt = performance.now()))
// 두 손으로 집으면 별자리 가운데가 두 손 사이로 옮겨 간다. 놓으면 천천히 제자리로
const pan = { x: 0, y: 0 }

// 지난 20 프레임의 점 자리를 고리 버퍼에 쌓아 두고, 3·7·12·18 프레임 전 모습을 점점 흐리게 겹친다
const RING = 20
const ECHOES = [
  [3, 0.34],
  [7, 0.22],
  [12, 0.13],
  [18, 0.07],
]
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const ring = { d: new Float32Array(RING * signs.length * 2), t: new Float32Array(RING * 20), tn: new Uint8Array(RING), head: -1, count: 0 }
const slot = (k) => (ring.head - k + RING) % RING

function pushRing(tips) {
  ring.head = (ring.head + 1) % RING
  ring.count = Math.min(RING, ring.count + 1)
  let o = ring.head * signs.length * 2
  for (const s of signs) {
    ring.d[o++] = s.vis ? s.sx : NaN
    ring.d[o++] = s.sy
  }
  const n = Math.min(10, tips.length)
  ring.tn[ring.head] = n
  o = ring.head * 20
  for (let i = 0; i < n; i++) ((ring.t[o++] = tips[i].x), (ring.t[o++] = tips[i].y))
}

function drawEchoes(g, tips) {
  const n = signs.length
  if (reduced || ring.count <= 12) return
  // 얼마나 움직였는지: 12 프레임 전과 지금 사이 평균 거리. 멈춰 있으면 잔상 없이 또렷한 한 장
  const a = slot(0) * n * 2
  const b = slot(12) * n * 2
  let move = 0
  let c = 0
  for (let i = 0; i < n; i += 7) {
    const d = Math.hypot(ring.d[a + i * 2] - ring.d[b + i * 2], ring.d[a + i * 2 + 1] - ring.d[b + i * 2 + 1])
    if (d === d) ((move += d), c++)
  }
  const show = c ? Math.min(1, move / c / 6) : 0
  if (show < 0.02) return
  for (let e = ECHOES.length - 1; e >= 0; e--) {
    const [k, a0] = ECHOES[e]
    if (k >= ring.count) continue
    const al = a0 * show
    const o = slot(k) * n * 2
    g.fillStyle = `rgb(255 255 255 / ${al})`
    for (let i = labeled.length; i < n; i++) {
      const x = ring.d[o + i * 2]
      if (x === x) g.fillRect(x - 0.8, ring.d[o + i * 2 + 1] - 0.8, 1.6, 1.6)
    }
    g.fillStyle = `rgb(255 79 0 / ${Math.min(1, al * 1.6)})`
    for (let i = 0; i < labeled.length; i++) {
      const x = ring.d[o + i * 2]
      if (x === x) g.fillRect(x - 1.5, ring.d[o + i * 2 + 1] - 1.5, 3, 3)
    }
    const to = slot(k) * 20
    if (ring.tn[slot(k)] === tips.length) {
      g.fillStyle = `rgb(255 79 0 / ${al})`
      for (let i = 0; i < tips.length; i++) {
        g.beginPath()
        g.arc(ring.t[to + i * 2], ring.t[to + i * 2 + 1], 2.5, 0, Math.PI * 2)
        g.fill()
      }
    }
  }
}

// 손끝마다 가까운 별 둘에 주황 실을 걸고, 손끝엔 흰 점과 주황 고리. 두 손으로 집으면 그 사이에 점선과 배율
const near2 = [null, null]
function drawHands(g, tips, held) {
  g.lineWidth = 1
  for (const p of tips) {
    near2[0] = near2[1] = null
    let d0 = 150 * 150
    let d1 = 150 * 150
    for (const s of signs) {
      if (!s.vis) continue
      const d = (s.sx - p.x) ** 2 + (s.sy - p.y) ** 2
      if (d < d0) ((d1 = d0), (near2[1] = near2[0]), (d0 = d), (near2[0] = s))
      else if (d < d1) ((d1 = d), (near2[1] = s))
    }
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

// ── 그리기 ──
let raf = 0
const tmp = {}

function draw() {
  raf = requestAnimationFrame(draw)
  const g = cv.value?.getContext('2d')
  if (!g || !W) return
  const now = performance.now()
  if (now - lastInput > 2500 && !dragging) cam.yaw += 0.002
  const fit = (Math.min(W, H - SAFE_TOP - SAFE_BOTTOM) * 0.42) / extent
  cam.fit = cam.fit ? cam.fit + (fit - cam.fit) * 0.06 : fit
  const live = props.hand && frame && now - frameAt < 300
  const tips = live ? frame.tips : []
  const held = live && frame.held.length === 2 ? frame.held : null
  const tx = held ? (held[0].x + held[1].x) / 2 - W / 2 : 0
  const ty = held ? (held[0].y + held[1].y) / 2 - midY() : 0
  pan.x += (tx - pan.x) * (held ? 0.25 : 0.04)
  pan.y += (ty - pan.y) * (held ? 0.25 : 0.04)

  for (const s of signs) {
    for (let k = 0; k < 3; k++) s.pos[k] += (s.to[k] - s.pos[k]) * 0.08
    project(s.pos, s)
  }
  for (const h of hubs) project(h.c, h)
  pushRing(tips)

  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, W, H)
  drawEchoes(g, tips)
  const depth = (z) => Math.max(0.15, Math.min(1, 0.75 - z / 700))
  // 점이 천 개라 투명도를 몇 단계로 묶어 단계마다 한 번에 그린다
  const LEVELS = 6
  const level = (z) => Math.min(LEVELS - 1, Math.floor(depth(z) * LEVELS))
  const alphaOf = (l) => (l + 0.5) / LEVELS
  const near = hover.value || chosen.value

  // 허브끼리: 바깥으로 휘는 가는 곡선
  g.lineWidth = 0.8
  for (const [a, b] of hubLinks) {
    const A = hubs[a]
    const B = hubs[b]
    if (!A.vis || !B.vis) continue
    // 두 허브 가운데를 원점 바깥쪽으로 조금 밀어 곡선의 꺾임점으로 쓴다
    const m = [(A.c[0] + B.c[0]) / 2, (A.c[1] + B.c[1]) / 2, (A.c[2] + B.c[2]) / 2]
    const ml = Math.hypot(...m) || 1
    const bend = Math.hypot(A.c[0] - B.c[0], A.c[1] - B.c[1], A.c[2] - B.c[2]) * 0.18
    project([m[0] + (m[0] / ml) * bend, m[1] + (m[1] / ml) * bend, m[2] + (m[2] / ml) * bend], tmp)
    g.strokeStyle = `rgb(255 255 255 / ${0.3 * depth((A.sz + B.sz) / 2)})`
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
    g.strokeStyle = `rgb(255 255 255 / ${0.07 * alphaOf(l)})`
    g.beginPath()
    for (const s of list) {
      g.moveTo(s.sx, s.sy)
      g.lineTo(s.hub.sx, s.hub.sy)
    }
    g.stroke()
  })
  if (near?.hub?.vis) {
    g.strokeStyle = 'rgb(255 255 255 / 0.4)'
    g.beginPath()
    for (const s of near.hub.list) {
      if (!s.vis) continue
      g.moveTo(s.sx, s.sy)
      g.lineTo(near.hub.sx, near.hub.sy)
    }
    g.stroke()
  }
  marks.forEach((list, l) => {
    if (!list.length) return
    const a = alphaOf(l)
    // 이름 없는 점은 작고 흐리게, 이름 아는 간판은 크고 또렷하게
    g.fillStyle = `rgb(255 255 255 / ${0.55 * a})`
    for (const s of list) {
      if (s.named) continue
      const z = Math.max(1.2, 2.2 * s.ss)
      g.fillRect(s.sx - z / 2, s.sy - z / 2, z, z)
    }
    // 이름 아는 간판만 강조색
    g.fillStyle = `rgb(255 79 0 / ${0.4 + 0.6 * a})`
    for (const s of list) {
      if (!s.named) continue
      const z = Math.max(2.5, 4.5 * s.ss)
      g.fillRect(s.sx - z / 2, s.sy - z / 2, z, z)
    }
  })
  // 가리키거나 고른 간판: 흰 네모 + 둘레 고리
  for (const s of [hover.value, chosen.value]) {
    if (!s?.vis) continue
    const z = Math.max(4, 6 * s.ss)
    g.fillStyle = '#fff'
    g.fillRect(s.sx - z / 2, s.sy - z / 2, z, z)
    g.strokeStyle = 'rgb(255 255 255 / 0.6)'
    g.lineWidth = 1
    g.strokeRect(s.sx - z, s.sy - z, z * 2, z * 2)
  }

  if (tips.length || held) drawHands(g, tips, held)

  // 허브 고리
  g.lineWidth = 1
  for (const h of hubs) {
    if (!h.vis) continue
    g.strokeStyle = `rgb(255 255 255 / ${depth(h.sz)})`
    g.beginPath()
    g.arc(h.sx, h.sy, Math.min(3.5, 1.5 + Math.sqrt(h.list.length) * 0.4), 0, Math.PI * 2)
    g.stroke()
  }

  // 글자: 큰 묶음 이름 → 가까운 간판 이름 → 남은 묶음 이름 순으로, 겹치지 않는 것만 단다. 찾은 글자는 굵게
  const boxes = []
  const free = (b) => b[0] >= 0 && b[2] <= W && b[1] >= 0 && b[3] <= H && !boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])
  // 글자 뒤에 검은 테를 둘러 점·실 위에서도 읽히게 한다
  const say = (t, x, y, weight, size, alpha) => {
    if (!t) return 0
    g.font = `${weight} ${size}px ${FONT}`
    g.strokeStyle = 'rgb(0 0 0 / 0.9)'
    g.lineWidth = 3
    g.strokeText(t, x, y)
    g.fillStyle = `rgb(255 255 255 / ${alpha})`
    g.fillText(t, x, y)
    return g.measureText(t).width
  }
  const width = (t, weight, size) => {
    g.font = `${weight} ${size}px ${FONT}`
    return t ? g.measureText(t).width : 0
  }
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  const hubLabel = (h) => {
    if (!h.vis) return
    const count = ` ${h.list.length}`
    const w = width(h.label, 600, 12)
    const b = [h.sx + 6, h.sy - 9, h.sx + 11 + w + width(count, 400, 11), h.sy + 9]
    if (!free(b)) return
    boxes.push(b)
    const a = depth(h.sz)
    say(h.label, h.sx + 8, h.sy, 600, 12, 0.45 + 0.55 * a)
    say(count, h.sx + 8 + w, h.sy, 400, 11, 0.15 + 0.3 * a)
  }
  const signLabel = (s) => {
    const [pre, mid, post] = s.r.parts
    const w0 = width(pre, 400, 11)
    const w1 = width(mid, 700, 11)
    const b = [s.sx + 5, s.sy - 7, s.sx + 10 + w0 + w1 + width(post, 400, 11), s.sy + 7]
    if (!free(b)) return false
    boxes.push(b)
    const a = depth(s.sz)
    const x = s.sx + 7
    say(pre, x, s.sy, 400, 11, 0.35 + 0.4 * a)
    say(mid, x + w0, s.sy, 700, 11, 0.6 + 0.4 * a)
    say(post, x + w0 + w1, s.sy, 400, 11, 0.35 + 0.4 * a)
    return true
  }
  const TOP = 12
  hubs.slice(0, TOP).forEach(hubLabel)
  let shown = 0
  for (const s of labeled.filter((s) => s.vis).sort((a, b) => a.sz - b.sz)) if (shown < 40 && signLabel(s)) shown++
  hubs.slice(TOP).forEach(hubLabel)

  // 손 커서가 있으면 그 자리로 고른다
  if (props.pointer) pickAt(props.pointer.x, props.pointer.y)
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
  const s = nearest(cx, cy, props.pointer ? 36 : 18)
  hover.value = s
  if (s) {
    const box = wrap.value.getBoundingClientRect()
    tip.value = { x: cx - box.left, y: cy - box.top }
  }
}

// ── 마우스 ──
let dragging = false
let downAt = null

function onDown(e) {
  dragging = true
  downAt = { x: e.clientX, y: e.clientY, moved: 0 }
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
    rotate(dx, dy)
  } else if (!props.pointer) pickAt(e.clientX, e.clientY)
}
function onUp(e) {
  dragging = false
  if (downAt && downAt.moved < 5) choose(e.clientX, e.clientY)
  downAt = null
}
function onWheel(e) {
  lastInput = performance.now()
  zoomBy(-e.deltaY * 0.0015)
}

function rotate(dx, dy) {
  lastInput = performance.now()
  cam.yaw += dx * 0.006
  cam.pitch = Math.max(-1.3, Math.min(1.3, cam.pitch + dy * 0.006))
}
function zoomBy(dz) {
  lastInput = performance.now()
  cam.zoom = Math.max(0.45, Math.min(3, cam.zoom * Math.exp(dz)))
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
watch(view, layout)

function onKey(e) {
  if (e.target.closest?.('input, textarea')) return
  const i = ['1', '2', '3'].indexOf(e.key)
  if (i >= 0) setView(VIEWS[i].key)
  if (e.key === 'Escape') chosen.value ? (chosen.value = null) : emit('close')
}

const floorLabel = (f) => (f === null || f === undefined ? '' : f < 0 ? `지하 ${-f}층` : `${f}층`)
const towns = new Set(signs.map((s) => s.r.region)).size
const countText = (n) => n.toLocaleString()

// 손 조작은 바깥(HandControl)에서 이 함수들을 부른다
defineExpose({ rotate, zoomBy, choose, feed })

// 카메라 영상은 손 조작이 연 것을 그대로 받아 배경 video 에 건다
watch(
  [() => props.stream, camEl],
  ([s, el]) => {
    if (!el) return
    if (el.srcObject !== s) el.srcObject = s
    if (s) el.play().catch(() => {})
  },
  { flush: 'post' },
)

let ro
onMounted(() => {
  layout()
  resize()
  ro = new ResizeObserver(resize)
  ro.observe(wrap.value)
  window.addEventListener('keydown', onKey)
  raf = requestAnimationFrame(draw)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  ro?.disconnect()
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="wrap" class="graph">
    <template v-if="stream">
      <video ref="camEl" class="cam" muted playsinline autoplay></video>
      <div class="shade"></div>
    </template>
    <canvas
      ref="cv"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointerleave="!pointer && (hover = null)"
      @wheel.prevent="onWheel"
    ></canvas>

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
  background: #000;
  color: #fff;
  font-family: 'Pretendard Variable', Pretendard, sans-serif;
  --lo: 0.15;
  --size: 0.7;
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

/* 손 좌표와 같은 가운데 70%만 화면에 펼쳐(늘여) 손끝 그림이 영상 속 손가락과 겹치게 한다 */
.cam {
  position: absolute;
  top: calc(var(--lo) / var(--size) * -100%);
  left: calc(var(--lo) / var(--size) * -100%);
  width: calc(100% / var(--size));
  height: calc(100% / var(--size));
  object-fit: fill;
  transform: scaleX(-1);
  filter: grayscale(1) brightness(0.32) contrast(1.15);
  pointer-events: none;
}

.shade {
  position: absolute;
  inset: 0;
  background: radial-gradient(closest-side, transparent 55%, rgb(0 0 0 / 0.7) 140%);
  pointer-events: none;
}

canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
}

canvas:active {
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
