<script setup>
// 놀이판 속 픽셀 한국 지도. dots 는 불 켜진 자리(물결이 퍼진다), pin·star·line 은 동네 맞히기용
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { koreaCells, makeView, paintKorea } from './korea.js'

const props = defineProps({
  dots: { type: Array, default: () => [] }, // [{ lng, lat, color }]
  pin: { type: Object, default: null }, // { lng, lat } 내가 찍은 자리
  star: { type: Object, default: null }, // { lng, lat } 정답 자리
  tint: { type: String, default: '' },
  dim: { type: Number, default: 1 },
  clickable: Boolean,
})
const emit = defineEmits(['pick'])
const wrap = ref(null)
const cv = ref(null)
let view = null
let base = null
let map = null
let raf = 0
let observer = null
let t0 = 0
let lineFrom = 0

function fit() {
  const el = wrap.value
  if (!el) return
  const w = el.clientWidth
  const h = el.clientHeight
  if (!w || !h) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  cv.value.width = Math.round(w * dpr)
  cv.value.height = Math.round(h * dpr)
  view = makeView(w, h, 12)
  view.dpr = dpr
  base = map ? paintKorea(map, view, { dpr, tint: props.tint, alpha: props.dim }) : null
}

function frame(t) {
  raf = requestAnimationFrame(frame)
  if (!view) return
  const ctx = cv.value.getContext('2d')
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
  ctx.clearRect(0, 0, view.w, view.h)
  if (base) ctx.drawImage(base, 0, 0, view.w, view.h)
  const s = (t - t0) / 1000
  for (const [i, d] of props.dots.entries()) {
    const [x, y] = view.project(d.lng, d.lat)
    const r = ((s + i * 0.37) % 1.6) * 16
    ctx.globalAlpha = Math.max(0, 1 - r / 26)
    ctx.strokeStyle = d.color || '#ffec27'
    ctx.lineWidth = 2
    ctx.strokeRect(Math.round(x - r), Math.round(y - r), Math.round(r * 2), Math.round(r * 2))
    ctx.globalAlpha = 1
    ctx.fillStyle = d.color || '#ffec27'
    ctx.fillStyle = '#0b1028'
    ctx.fillRect(Math.round(x) - 6, Math.round(y) - 6, 12, 12)
    ctx.fillStyle = d.color || '#ffec27'
    ctx.fillRect(Math.round(x) - 4, Math.round(y) - 4, 8, 8)
    ctx.fillStyle = '#fff'
    ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 3, 3)
  }
  // 내 핀과 정답 별 사이는 점선이 그어진다
  if (props.pin && props.star) {
    const [ax, ay] = view.project(props.pin.lng, props.pin.lat)
    const [bx, by] = view.project(props.star.lng, props.star.lat)
    const p = Math.min(1, (t - lineFrom) / 600)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(ax + (bx - ax) * p, ay + (by - ay) * p)
    ctx.stroke()
    ctx.setLineDash([])
  }
  if (props.star) star(ctx, ...view.project(props.star.lng, props.star.lat), s)
  if (props.pin) pinAt(ctx, ...view.project(props.pin.lng, props.pin.lat))
}

function pinAt(ctx, x, y) {
  x = Math.round(x)
  y = Math.round(y)
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(1.6, 1.6)
  x = 0
  y = 0
  ctx.fillStyle = '#0b1028'
  ctx.fillRect(x - 7, y - 25, 14, 14)
  ctx.fillRect(x - 2, y - 12, 4, 12)
  ctx.fillStyle = '#ff5a7a'
  ctx.fillRect(x - 5, y - 23, 10, 10)
  ctx.fillStyle = '#ffd0d8'
  ctx.fillRect(x - 3, y - 21, 3, 3)
  ctx.fillStyle = '#fff1e8'
  ctx.fillRect(x - 1, y - 12, 2, 11)
  ctx.restore()
}

function star(ctx, x, y, s) {
  x = Math.round(x)
  y = Math.round(y)
  const k = 1.5 + (Math.floor(s * 4) % 2) * 0.2
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(k, k)
  ctx.fillStyle = '#0b1028'
  ctx.fillRect(-3, -11, 6, 22)
  ctx.fillRect(-11, -3, 22, 6)
  ctx.fillRect(-6, -6, 12, 12)
  ctx.fillStyle = '#ffec27'
  ctx.fillRect(-1, -9, 2, 18)
  ctx.fillRect(-9, -1, 18, 2)
  ctx.fillRect(-4, -4, 8, 8)
  ctx.restore()
}

function onClick(e) {
  if (!props.clickable || !view) return
  const r = cv.value.getBoundingClientRect()
  const [lng, lat] = view.unproject(e.clientX - r.left, e.clientY - r.top)
  emit('pick', { lng, lat })
}

// 자판으로 핀을 옮길 때 쓰는 화면 좌표 ↔ 경위도
defineExpose({
  nudge(p, dx, dy) {
    if (!view) return p
    const [x, y] = view.project(p.lng, p.lat)
    const [lng, lat] = view.unproject(x + dx, y + dy)
    return { lng, lat }
  },
  drawLine() {
    lineFrom = performance.now()
  },
})

onMounted(async () => {
  t0 = performance.now()
  observer = new ResizeObserver(fit)
  observer.observe(wrap.value)
  raf = requestAnimationFrame(frame)
  map = await koreaCells().catch(() => null)
  fit()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  observer?.disconnect()
})
</script>

<template>
  <div ref="wrap" class="pk" :class="{ clickable }">
    <canvas ref="cv" @click="onClick"></canvas>
  </div>
</template>

<style scoped>
.pk {
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.pk canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
}

.pk.clickable canvas {
  cursor: crosshair;
}
</style>
