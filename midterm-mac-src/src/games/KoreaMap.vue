<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { load } from '../data.js'
import { PASTEL, pastelOf } from '../shops.js'
import { sfx } from '../sound.js'

// rows: 불을 켤 가게들 ({ name, lng, lat }). 시군구 중심 좌표라 살짝 흩뿌린다.
const props = defineProps({ rows: { type: Array, default: () => [] }, quiet: Boolean })
const canvas = ref(null)
const wrap = ref(null)
let cells = []
let step = 0.02
let lights = []
let raf = 0
let view = null
let observer = null

function project(lng, lat) {
  const { minX, maxY, scale, ox, oy } = view
  return [ox + (lng - minX) * scale * Math.cos((36 * Math.PI) / 180), oy + (maxY - lat) * scale]
}

function fit() {
  const el = canvas.value
  const dpr = window.devicePixelRatio || 1
  const w = wrap.value.clientWidth
  if (!w) return
  const h = Math.round(w * 1.25)
  el.width = w * dpr
  el.height = h * dpr
  el.style.height = `${h}px`
  const minX = 124.6
  const maxX = 131
  const minY = 33.1
  const maxY = 38.65
  const kx = Math.cos((36 * Math.PI) / 180)
  const scale = Math.min((w - 16) / ((maxX - minX) * kx), (h - 16) / (maxY - minY))
  view = {
    minX,
    maxY,
    scale,
    dpr,
    w,
    h,
    ox: (w - (maxX - minX) * kx * scale) / 2,
    oy: (h - (maxY - minY) * scale) / 2,
  }
}

function draw(t) {
  raf = requestAnimationFrame(draw)
  if (!view) return
  const ctx = canvas.value.getContext('2d')
  const { dpr, w, h } = view
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#16161c'
  ctx.fillRect(0, 0, w, h)
  const px = Math.max(1, Math.round(step * view.scale))
  const dim = lights.length ? 0.35 : 1
  for (const [x, y, n, cat] of cells) {
    const [sx, sy] = project(x * step, y * step)
    ctx.globalAlpha = Math.min(1, 0.25 + Math.log10(n) / 3) * dim
    ctx.fillStyle = PASTEL[cat % PASTEL.length]
    ctx.fillRect(Math.round(sx), Math.round(sy), px, px)
  }
  ctx.globalAlpha = 1
  for (const l of lights) {
    const age = (t - l.born) / 1000
    if (age < 0) continue
    const [sx, sy] = project(l.lng, l.lat)
    for (let k = 0; k < 3; k++) {
      const r = ((age + k * 0.6) % 1.8) * 14
      ctx.globalAlpha = Math.max(0, 1 - r / 25)
      ctx.strokeStyle = l.color
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(sx, sy, r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(sx, sy, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
}

function light(rows) {
  const now = performance.now()
  lights = rows.map((r, i) => ({
    lng: r.lng + (Math.random() - 0.5) * 0.12,
    lat: r.lat + (Math.random() - 0.5) * 0.1,
    color: props.quiet ? pastelOf(r.name) : PASTEL[i % PASTEL.length],
    born: now + i * 90,
  }))
  if (!props.quiet) rows.forEach((_, i) => setTimeout(() => sfx.build(i % 8), i * 90))
}

onMounted(async () => {
  fit()
  observer = new ResizeObserver(fit)
  observer.observe(wrap.value)
  raf = requestAnimationFrame(draw)
  const map = await load('map.json')
  cells = map.cells
  step = map.step
  light(props.rows)
})

watch(() => props.rows, light)

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  observer?.disconnect()
})
</script>

<template>
  <div ref="wrap" class="screen">
    <canvas ref="canvas"></canvas>
  </div>
</template>

<style scoped>
.screen {
  overflow: hidden;
  border-radius: 12px;
  background: #16161c;
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.2);
}

canvas {
  display: block;
  width: 100%;
}
</style>
