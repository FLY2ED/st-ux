<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { load, search } from '../data.js'
import { PASTEL } from '../shops.js'
import { sfx } from '../sound.js'

const props = defineProps({ q: String })
const SUGGEST = ['행복', '사랑', '치킨', '꽃집', '바다', '엄마']
const canvas = ref(null)
const wrap = ref(null)
const query = ref('')
const result = ref(null)
const error = ref('')
let cells = []
let step = 0.02
let lights = []
let raf = 0
let view = null

function project(lng, lat) {
  const { minX, maxY, scale, ox, oy } = view
  return [ox + (lng - minX) * scale * Math.cos((36 * Math.PI) / 180), oy + (maxY - lat) * scale]
}

function fit() {
  const el = canvas.value
  const dpr = window.devicePixelRatio || 1
  const w = wrap.value.clientWidth
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
  const ctx = canvas.value.getContext('2d')
  const { dpr, w, h } = view
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#20203a'
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
    ctx.fillRect(Math.round(sx) - 2, Math.round(sy) - 2, 4, 4)
  }
  raf = requestAnimationFrame(draw)
}

async function submit(word = query.value) {
  query.value = word
  error.value = ''
  if (!/[가-힣]{2}/.test(word.trim())) {
    error.value = '한글 두 글자 이상 넣어 주세요'
    return
  }
  try {
    result.value = await search(word)
  } catch {
    error.value = '데이터를 못 불러왔어요'
    return
  }
  const rows = result.value.rows.filter((r) => r.exact)
  const now = performance.now()
  lights = (rows.length ? rows : result.value.rows).map((r, i) => ({
    lng: r.lng + (Math.random() - 0.5) * 0.12,
    lat: r.lat + (Math.random() - 0.5) * 0.1,
    color: PASTEL[i % PASTEL.length],
    born: now + i * 90,
    row: r,
  }))
  lights.forEach((_, i) => setTimeout(() => sfx.build(i % 8), i * 90))
}

function onResize() {
  if (canvas.value) fit()
}

onMounted(async () => {
  fit()
  raf = requestAnimationFrame(draw)
  const map = await load('map.json')
  cells = map.cells
  step = map.step
  window.addEventListener('resize', onResize)
  if (props.q) submit(props.q)
})

watch(() => props.q, (q) => q && submit(q))

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div class="map">
    <form class="row" @submit.prevent="submit()">
      <input v-model="query" class="grow" type="text" placeholder="간판에 들어갈 말 (예: 행복)" maxlength="10" />
      <button type="submit">찾기</button>
    </form>
    <div class="chips">
      <button v-for="s in SUGGEST" :key="s" type="button" @click="submit(s)">{{ s }}</button>
    </div>
    <p v-if="error" class="err">{{ error }}</p>
    <div ref="wrap" class="screen">
      <canvas ref="canvas" class="pixel"></canvas>
    </div>
    <p v-if="result" class="muted">
      ‘{{ result.word }}’ 간판 {{ result.exactCount ? '' : '최대 ' }}{{ result.count.toLocaleString() }}곳 중
      {{ result.rows.filter((r) => r.exact).length || result.rows.length }}곳에 불을 켰어요. (시군구 단위 위치)
    </p>
    <p v-else class="muted">점 하나가 약 2km 칸이에요. 색은 그 칸에서 제일 많은 업종.</p>
  </div>
</template>

<style scoped>
.map {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chips button {
  min-width: 0;
  padding: 0 8px;
}

.screen {
  border: 2px inset #fff;
  background: #20203a;
}

canvas {
  display: block;
  width: 100%;
}

.err {
  margin: 0;
  color: var(--red);
}

p {
  margin: 0;
}
</style>
