<script setup>
// 손으로 지구본 다루기. 엄지·검지로 집어서 끌면 돌리고, 짧게 집었다 놓으면 그 자리를 누르고, 두 손으로 집어 벌리면 확대한다
import { onBeforeUnmount, ref } from 'vue'
import { closeCamera, openCamera } from '../face.js'
import { handTracker, span } from '../hand.js'
import CameraGate from './CameraGate.vue'

// full: 화면 전체에 웹캠을 까는 곳(이름 별자리)에선 오른쪽 위 작은 카메라 화면을 숨긴다
defineProps({ full: Boolean })
// frame: 매 프레임 손끝 자리와 집은 손(화면 좌표). stream: 카메라를 열고 닫을 때
const emit = defineEmits(['drag', 'zoom', 'tap', 'point', 'off', 'frame', 'stream'])

const root = ref(null)
const video = ref(null)
const preview = ref(null)
const gate = ref(true)
const msg = ref('')
const live = ref(false)
const cursors = ref([])
const seen = ref(false)
// 지금 손이 하는 일. 카메라 화면 위에 크게 띄운다
const mode = ref('')
const MODE_LABEL = { open: ['OPEN', '손을 폈어요'], pinch: ['PINCH', '집었어요'], drag: ['DRAG', '돌리는 중'], zoom: ['ZOOM', '두 손 확대'] }

let stream = null
let tracker = null
let raf = 0

const startCamera = (id) => openCamera(video.value, id)

async function ready(s) {
  gate.value = false
  stream = s
  emit('stream', s)
  msg.value = '손 인식 모델을 받는 중…'
  try {
    tracker = await handTracker(video.value)
    live.value = true
    msg.value = ''
    raf = requestAnimationFrame(loop)
  } catch {
    stop()
    msg.value = '손 인식 모델을 받지 못했어요'
  }
}

function stop() {
  cancelAnimationFrame(raf)
  closeCamera(stream)
  if (stream) emit('stream', null)
  stream = null
  tracker = null
  live.value = false
}

function quit() {
  stop()
  emit('point', null)
  emit('off')
}

// 손마다 집기 상태를 따로 둔다. 붙을 때(0.33)와 떨어질 때(0.5) 문턱을 달리해 떨림을 막는다
// MediaPipe 는 프레임마다 손 순서를 바꿔 줄 수 있어서, 번호 대신 지난 자리에서 가장 가까운 손을 같은 손으로 이어 붙인다
const slots = [null, null]
const LOST_MS = 220
let grab = null
let spread = null
let zoomUntil = 0
const ripples = ref([])
let rippleId = 0

function track(hands, box, now) {
  const raw = hands.slice(0, 2).map((h) => ({ h, x: span(h.x) * box.width, y: span(h.y) * box.height }))
  const d = (s, r) => (s ? Math.hypot(s.x - r.x, s.y - r.y) : 1e4)
  // 손 두 개면 두 가지 짝 중 이동이 적은 쪽, 하나면 가까운 칸
  let order
  if (raw.length === 2) order = d(slots[0], raw[0]) + d(slots[1], raw[1]) <= d(slots[0], raw[1]) + d(slots[1], raw[0]) ? [0, 1] : [1, 0]
  else if (raw.length === 1) order = [d(slots[0], raw[0]) <= d(slots[1], raw[0]) || !slots[1] ? 0 : 1]
  else order = []
  const used = new Set()
  raw.forEach((r, k) => {
    const i = order[k]
    used.add(i)
    const s = slots[i]
    const on = s && now - s.seen < LOST_MS ? (s.on ? r.h.gap < 0.5 : r.h.gap < 0.33) : r.h.gap < 0.33
    const x = s ? s.x + (r.x - s.x) * 0.5 : r.x
    const y = s ? s.y + (r.y - s.y) * 0.5 : r.y
    // 손가락을 오므리는 동안 커서가 끌려 내려가므로, 누를 자리는 손이 벌어져 있던 마지막 자리로 잡는다
    const open = r.h.gap > 0.55 || !s ? { x, y } : s.open
    slots[i] = { x, y, on, open, seen: now, h: r.h }
  })
  // 잠깐 놓친 손은 바로 지우지 않고 마지막 상태로 버틴다(두 손 확대가 한 프레임 끊겨도 이어지게)
  for (let i = 0; i < 2; i++) if (!used.has(i) && slots[i] && now - slots[i].seen > LOST_MS) slots[i] = null
  return slots.map((s, i) => (s ? { ...s, i, live: used.has(i) } : null)).filter(Boolean)
}

function ripple(x, y) {
  const id = ++rippleId
  ripples.value = [...ripples.value, { id, x, y }]
  setTimeout(() => (ripples.value = ripples.value.filter((r) => r.id !== id)), 520)
}

function loop() {
  raf = requestAnimationFrame(loop)
  const el = root.value
  if (!tracker || !el) return
  const hands = tracker.read()
  const box = el.getBoundingClientRect()
  seen.value = hands.length > 0
  const now = performance.now()

  const pts = track(hands, box, now)
  cursors.value = pts.map((p) => ({ x: p.x, y: p.y, on: p.on, press: grab && !grab.drag && grab.slot === p.i ? grab.at : null }))
  // 첫 손 커서 자리(화면 좌표). 가리키기만 해도 고르는 화면에서 쓴다
  const lead = pts.find((p) => p.live) || pts[0]
  emit('point', lead ? { x: box.left + lead.x, y: box.top + lead.y } : null)
  drawPreview(hands)

  const held = pts.filter((p) => p.on)
  emit('frame', {
    tips: hands.flatMap((h) => TIPS.map((k) => ({ x: span(h.pts[k].x) * box.width, y: span(h.pts[k].y) * box.height }))),
    held: held.map((p) => ({ x: p.x, y: p.y })),
  })
  const zooming = held.length === 2 || (spread && now < zoomUntil)
  mode.value = zooming ? 'zoom' : held.length ? (grab?.drag ? 'drag' : 'pinch') : hands.length ? 'open' : ''
  if (held.length === 2) {
    // 두 손: 집은 두 점 사이가 벌어지면 확대, 좁아지면 축소
    const d = Math.hypot(held[0].x - held[1].x, held[0].y - held[1].y)
    const mid = { x: (held[0].x + held[1].x) / 2, y: (held[0].y + held[1].y) / 2 }
    if (spread && d > 20) emit('zoom', Math.log2(d / spread) * 1.6, mid.x, mid.y)
    spread = d
    zoomUntil = now + 250
    grab = null
    return
  }
  // 한쪽 집기가 잠깐 풀린 것이면 확대를 이어 가고, 그 사이 끌기·누르기는 하지 않는다
  if (spread && now < zoomUntil) return
  if (spread) {
    // 확대를 마친 손이 그대로 끌기로 넘어가 화면이 튀지 않게, 손을 다 놓을 때까지 쉰다
    if (held.length) return
    spread = null
  }
  if (held.length === 1) {
    const p = held[0]
    if (!grab || grab.slot !== p.i) grab = { slot: p.i, at: { ...p.open }, last: { x: p.x, y: p.y }, t: now, moved: 0, drag: false }
    const dx = p.x - grab.last.x
    const dy = p.y - grab.last.y
    grab.moved += Math.hypot(dx, dy)
    // 집은 채로 오래 있거나 꽤 움직이면 끌기
    if (grab.moved > 28 || now - grab.t > 600) grab.drag = true
    if (grab.drag) emit('drag', dx, dy)
    grab.last = { x: p.x, y: p.y }
    return
  }
  // 놓았다: 거의 안 움직이고 짧게 집었다 놓았으면, 집기 직전 커서 자리를 누른다
  if (grab && !grab.drag) {
    ripple(grab.at.x, grab.at.y)
    emit('tap', box.left + grab.at.x, box.top + grab.at.y)
  }
  grab = null
}

const TIPS = [4, 8, 12, 16, 20]

// 손 마디 21개를 잇는 뼈대(MediaPipe 손 모델 순서)
const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]

// 거울처럼 뒤집은 흑백 카메라 위에 손 뼈대를 빛나는 점과 선으로 그린다
function drawPreview(hands) {
  const cv = preview.value
  const v = video.value
  if (!cv || !v || v.readyState < 2) return
  const g = cv.getContext('2d')
  const W = cv.width
  const H = cv.height
  g.save()
  g.filter = 'grayscale(1) brightness(0.55) contrast(1.15)'
  g.scale(-1, 1)
  g.drawImage(v, -W, 0, W, H)
  g.restore()
  hands.forEach((h, i) => {
    const hot = h.gap < 0.4
    const at = (k) => [h.pts[k].x * W, h.pts[k].y * H]
    g.lineWidth = 1.5
    g.strokeStyle = hot ? 'rgb(255 79 0 / 0.75)' : 'rgb(255 255 255 / 0.55)'
    g.beginPath()
    for (const [a, b] of BONES) {
      g.moveTo(...at(a))
      g.lineTo(...at(b))
    }
    g.stroke()
    g.shadowColor = '#ff4f00'
    g.shadowBlur = 10
    h.pts.forEach((_, k) => {
      const tip = k === 4 || k === 8
      g.fillStyle = tip || hot ? '#ff4f00' : '#ffd2bd'
      g.beginPath()
      g.arc(...at(k), tip ? 4.5 : 2.6, 0, Math.PI * 2)
      g.fill()
    })
    g.shadowBlur = 0
    // 엄지·검지 사이 실: 집을수록 짧고 진해진다
    g.strokeStyle = hot ? '#ff4f00' : 'rgb(255 255 255 / 0.35)'
    g.setLineDash(hot ? [] : [3, 3])
    g.beginPath()
    g.moveTo(...at(4))
    g.lineTo(...at(8))
    g.stroke()
    g.setLineDash([])
  })
}

onBeforeUnmount(stop)
</script>

<template>
  <div ref="root" class="hand">
    <video ref="video" class="src" muted playsinline></video>
    <CameraGate v-if="gate" class="hand-gate" :open="startCamera" purpose="손으로 지구본을 돌리기 위해" @ready="ready" @cancel="quit" />

    <i v-for="(c, i) in cursors" :key="i" class="cur" :class="{ on: c.on }" :style="{ transform: `translate(${c.x}px, ${c.y}px)` }"></i>
    <!-- 집고 있는 동안 놓으면 눌릴 자리를 고정해 보여 주고, 놓으면 그 자리에서 물결이 퍼진다 -->
    <template v-for="(c, i) in cursors" :key="`p${i}`">
      <i v-if="c.press" class="press" :style="{ transform: `translate(${c.press.x}px, ${c.press.y}px)` }"></i>
    </template>
    <i v-for="r in ripples" :key="r.id" class="ripple" :style="{ transform: `translate(${r.x}px, ${r.y}px)` }"></i>

    <div v-if="!gate" class="cam">
      <div v-if="!full" class="screen">
        <canvas ref="preview" width="320" height="240"></canvas>
        <p v-if="mode" class="state" :class="mode"><b>{{ MODE_LABEL[mode][0] }}</b> {{ MODE_LABEL[mode][1] }}</p>
      </div>
      <p v-else class="state inline" :class="mode"><b>{{ mode ? MODE_LABEL[mode][0] : 'HAND' }}</b> {{ mode ? MODE_LABEL[mode][1] : '손을 보여 주세요' }}</p>
      <div class="cap">
        <p v-if="msg">{{ msg }}</p>
        <template v-else-if="live">
          <p v-if="!seen" class="wait">손을 카메라에 보여 주세요</p>
          <p><b>집어서 끌기</b> 돌리기</p>
          <p><b>짧게 집었다 놓기</b> 누르기</p>
          <p><b>두 손으로 집어 벌리기</b> 확대</p>
        </template>
        <button class="off" @click="quit">손 조작 끄기</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hand {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
}

.src {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.hand-gate {
  pointer-events: auto;
}

/* 좁은 창에선 카메라 화면을 줄인다 */
@media (max-width: 699px) {
  .cam {
    width: 200px;
  }
}

/* 손 커서: 펴면 빈 고리, 집으면 강조색으로 찬다 */
.cur {
  position: absolute;
  top: -14px;
  left: -14px;
  width: 28px;
  height: 28px;
  border: 2px solid var(--mk-ink, #fff);
  border-radius: 50%;
  box-shadow: 0 0 0 2px var(--mk-bg, #000), 0 0 14px rgb(255 79 0 / 0.45);
  transition: background-color 0.12s, scale 0.12s;
}

.cur.on {
  background: var(--mk-hot, #ff4f00);
  border-color: var(--mk-hot, #ff4f00);
  box-shadow: 0 0 0 2px var(--mk-bg, #000), 0 0 22px 4px rgb(255 79 0 / 0.7);
  scale: 0.8;
}

/* 누를 자리: 집는 동안 고정된 작은 표적. 놓으면 물결 */
.press,
.ripple {
  position: absolute;
  top: -9px;
  left: -9px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
}

.press {
  border: 2px solid var(--mk-hot, #ff4f00);
  background: rgb(255 79 0 / 0.25);
}

.press::after {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: var(--mk-hot, #ff4f00);
}

.ripple {
  border: 2px solid var(--mk-hot, #ff4f00);
  animation: ripple 0.5s ease-out forwards;
}

@keyframes ripple {
  from {
    opacity: 1;
    scale: 0.6;
  }
  to {
    opacity: 0;
    scale: 3.2;
  }
}

.cam {
  position: absolute;
  top: 66px;
  right: 10px;
  display: grid;
  overflow: hidden;
  width: 320px;
  border-radius: 16px;
  background: var(--mk-card, rgb(0 0 0 / 0.8));
  box-shadow: 0 0 0 1px var(--mk-line, rgb(255 255 255 / 0.12)), 0 10px 26px rgb(0 0 0 / 0.25);
  pointer-events: auto;
}

.screen {
  position: relative;
  background: #000;
}

.cam canvas {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
}

/* 카메라 왼쪽 위 상태 글자 (PINCH 등) */
.state {
  position: absolute;
  top: 8px;
  left: 10px;
  margin: 0;
  font-size: 11px;
  color: rgb(255 255 255 / 0.7);
}

.state.inline {
  position: static;
  padding: 10px 10px 0;
}

.state b {
  margin-right: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  letter-spacing: 0.08em;
  color: #fff;
}

.state.pinch b,
.state.drag b,
.state.zoom b {
  color: #ff4f00;
  text-shadow: 0 0 10px rgb(255 79 0 / 0.8);
}

.cap {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 2px 8px;
  padding: 8px 10px 10px;
  font-size: 11px;
  color: var(--mk-ink-2, #aaa);
}

.cap p {
  margin: 0;
  display: grid;
}

.cap .wait,
.cap .off,
.cap > p:only-of-type {
  grid-column: 1 / -1;
}

.cap b {
  color: var(--mk-ink, #fff);
  font-weight: 600;
}

.cap .wait {
  margin-bottom: 2px;
  color: var(--mk-hot, #ff4f00);
  font-weight: 600;
}

.app-body .cap .off {
  margin-top: 6px;
  min-height: 26px;
  border-radius: 8px;
  font-size: 11.5px;
}
</style>
