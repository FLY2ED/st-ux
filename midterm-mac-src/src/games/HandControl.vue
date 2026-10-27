<script setup>
// 손으로 지구본 다루기. 엄지·검지로 집어서 끌면 돌리고, 톡 집었다 놓으면 그 자리를 누르고, 두 손으로 집어 벌리면 확대한다
import { onBeforeUnmount, ref } from 'vue'
import { closeCamera, openCamera } from '../face.js'
import { handTracker } from '../hand.js'
import CameraGate from './CameraGate.vue'

const emit = defineEmits(['drag', 'zoom', 'tap', 'point', 'off'])

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
  stream = null
  tracker = null
  live.value = false
}

function quit() {
  stop()
  emit('point', null)
  emit('off')
}

// 카메라 가장자리까지 손을 뻗지 않아도 화면 끝에 닿게 가운데 70%만 쓴다
const span = (v) => Math.min(1, Math.max(0, (v - 0.15) / 0.7))

// 손마다 집기 상태를 따로 둔다. 붙을 때(0.33)와 떨어질 때(0.5) 문턱을 달리해 떨림을 막는다
const pinched = [false, false]
const smooth = [null, null]
let grab = null
let spread = null

function loop() {
  raf = requestAnimationFrame(loop)
  const el = root.value
  if (!tracker || !el) return
  const hands = tracker.read()
  const box = el.getBoundingClientRect()
  seen.value = hands.length > 0
  const now = performance.now()

  const pts = hands.slice(0, 2).map((h, i) => {
    pinched[i] = pinched[i] ? h.gap < 0.5 : h.gap < 0.33
    const raw = { x: span(h.x) * box.width, y: span(h.y) * box.height }
    const s = smooth[i] ? { x: smooth[i].x + (raw.x - smooth[i].x) * 0.5, y: smooth[i].y + (raw.y - smooth[i].y) * 0.5 } : raw
    smooth[i] = s
    return { ...s, on: pinched[i] }
  })
  for (let i = hands.length; i < 2; i++) ((pinched[i] = false), (smooth[i] = null))
  cursors.value = pts
  // 첫 손 커서 자리(화면 좌표). 가리키기만 해도 고르는 화면에서 쓴다
  emit('point', pts[0] ? { x: box.left + pts[0].x, y: box.top + pts[0].y } : null)
  drawPreview(hands)

  const held = pts.filter((p) => p.on)
  mode.value = held.length === 2 ? 'zoom' : held.length ? (grab?.drag ? 'drag' : 'pinch') : hands.length ? 'open' : ''
  if (held.length === 2) {
    // 두 손: 집은 두 점 사이가 벌어지면 확대, 좁아지면 축소
    const d = Math.hypot(held[0].x - held[1].x, held[0].y - held[1].y)
    const mid = { x: (held[0].x + held[1].x) / 2, y: (held[0].y + held[1].y) / 2 }
    if (spread) emit('zoom', Math.log2(d / spread) * 1.4, mid.x, mid.y)
    spread = d
    grab = null
    return
  }
  spread = null
  if (held.length === 1) {
    const p = held[0]
    if (!grab) grab = { x: p.x, y: p.y, last: p, t: now, moved: 0, drag: false }
    const dx = p.x - grab.last.x
    const dy = p.y - grab.last.y
    grab.moved += Math.hypot(dx, dy)
    if (grab.moved > 16) grab.drag = true
    if (grab.drag) emit('drag', dx, dy)
    grab.last = p
    return
  }
  // 놓았다: 거의 안 움직이고 짧게 집었다 놓았으면 그 자리를 누른다
  if (grab && !grab.drag && now - grab.t < 700) emit('tap', box.left + grab.x, box.top + grab.y)
  grab = null
}

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
    const hot = pinched[i]
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

    <div v-if="!gate" class="cam">
      <div class="screen">
        <canvas ref="preview" width="320" height="240"></canvas>
        <p v-if="mode" class="state" :class="mode"><b>{{ MODE_LABEL[mode][0] }}</b> {{ MODE_LABEL[mode][1] }}</p>
      </div>
      <div class="cap">
        <p v-if="msg">{{ msg }}</p>
        <template v-else-if="live">
          <p v-if="!seen" class="wait">손을 카메라에 보여 주세요</p>
          <p><b>집어서 끌기</b> 돌리기</p>
          <p><b>톡 집기</b> 누르기</p>
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
