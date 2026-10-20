<script setup>
import { computed, ref } from 'vue'
import { nearby } from '../data.js'
import { pastelOf } from '../shops.js'
import { sfx } from '../sound.js'

const SPOTS = [
  { label: '강남역', lng: 127.0276, lat: 37.4979 },
  { label: '홍대입구', lng: 126.9237, lat: 37.5572 },
  { label: '서면', lng: 129.0597, lat: 35.1579 },
  { label: '제주시청', lng: 126.5312, lat: 33.4996 },
]
const RADIUS = 800
const items = ref([])
const where = ref('')
const busy = ref(false)
const error = ref('')

async function scan(lng, lat, label) {
  busy.value = true
  error.value = ''
  try {
    items.value = await nearby(lng, lat, RADIUS)
    where.value = label
    sfx.bell()
    if (!items.value.length) error.value = '이 근처엔 담아 둔 간판이 없어요. 번화가를 눌러 보세요'
  } catch {
    error.value = '데이터를 못 불러왔어요'
  }
  busy.value = false
}

function locate() {
  if (!navigator.geolocation) {
    error.value = '이 브라우저는 위치를 못 가져와요'
    return
  }
  busy.value = true
  navigator.geolocation.getCurrentPosition(
    (p) => scan(p.coords.longitude, p.coords.latitude, '내 위치'),
    () => {
      busy.value = false
      error.value = '위치를 허용하지 않았어요. 아래 번화가를 눌러 보세요'
    },
    { timeout: 10000 },
  )
}

const top = computed(() => {
  const m = new Map()
  for (const s of items.value) m.set(s.cat, (m.get(s.cat) || 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, 3)
})
const dots = computed(() => items.value.slice(0, 300))
</script>

<template>
  <div class="near">
    <div class="row">
      <button class="grow" :disabled="busy" @click="locate">📍 내 위치로 찾기</button>
    </div>
    <div class="chips">
      <button v-for="s in SPOTS" :key="s.label" :disabled="busy" @click="scan(s.lng, s.lat, s.label)">{{ s.label }}</button>
    </div>
    <p v-if="error" class="err">{{ error }}</p>
    <template v-if="items.length">
      <svg class="radar sunken-panel" viewBox="-100 -100 200 200" role="img" aria-label="주변 간판 레이더">
        <circle r="95" fill="none" stroke="#c9c3d6" />
        <circle r="48" fill="none" stroke="#c9c3d6" stroke-dasharray="3 3" />
        <circle
          v-for="(s, i) in dots"
          :key="i"
          :cx="(s.dx / RADIUS) * 95"
          :cy="(-s.dy / RADIUS) * 95"
          r="2.6"
          :fill="pastelOf(s.cat)"
          stroke="#1d1d2b"
          stroke-width="0.8"
        />
        <rect x="-3" y="-3" width="6" height="6" fill="#ef5a5a" stroke="#1d1d2b" />
      </svg>
      <p>
        <b>{{ where }}</b> 반경 {{ RADIUS }}m에서 간판 {{ items.length }}곳. 제일 많은 건
        <b>{{ top.map((t) => t[0]).join(', ') }}</b>
      </p>
      <ul class="list sunken-panel">
        <li v-for="(s, i) in items.slice(0, 40)" :key="i">
          <span class="sign" :style="{ background: pastelOf(s.cat) }">{{ s.name }}</span>
          <span class="muted">{{ s.cat }} · {{ s.dist }}m</span>
        </li>
      </ul>
    </template>
    <p class="muted">구역마다 간판을 골고루 추려 담아 둔 표본이라, 실제 가게 전부는 아니에요.</p>
  </div>
</template>

<style scoped>
.near {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

p {
  margin: 0;
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

.err {
  color: var(--red);
}

.radar {
  width: 100%;
  max-width: 260px;
  align-self: center;
  background: #eaf6ee;
}

.list {
  list-style: none;
  margin: 0;
  padding: 6px;
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}

.sign {
  padding: 1px 6px;
  border: 2px solid var(--ink);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
