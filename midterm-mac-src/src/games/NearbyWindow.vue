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
    <button class="go locate" :disabled="busy" @click="locate">내 위치로 찾기</button>
    <div class="chips">
      <span class="muted">번화가</span>
      <button v-for="s in SPOTS" :key="s.label" class="m-chip" :class="{ on: where === s.label }" :disabled="busy" @click="scan(s.lng, s.lat, s.label)">{{ s.label }}</button>
    </div>
    <p v-if="error" class="m-err">{{ error }}</p>
    <template v-if="items.length">
      <svg class="radar" viewBox="-100 -100 200 200" role="img" aria-label="주변 간판 레이더">
        <circle r="95" fill="none" stroke="rgba(255,255,255,0.18)" />
        <circle r="48" fill="none" stroke="rgba(255,255,255,0.14)" />
        <line x1="-95" x2="95" stroke="rgba(255,255,255,0.08)" />
        <line y1="-95" y2="95" stroke="rgba(255,255,255,0.08)" />
        <circle
          v-for="(s, i) in dots"
          :key="i"
          :cx="(s.dx / RADIUS) * 95"
          :cy="(-s.dy / RADIUS) * 95"
          r="2.4"
          :fill="pastelOf(s.cat)"
        />
        <circle r="9" fill="rgba(10,132,255,0.25)" />
        <circle r="4.5" fill="#0a84ff" stroke="#fff" stroke-width="1.5" />
      </svg>
      <p class="sum">
        <b>{{ where }}</b> 반경 {{ RADIUS }}m 간판 <b>{{ items.length }}곳</b> · 제일 많은 건 {{ top.map((t) => t[0]).join(', ') }}
      </p>
      <ul class="list m-card">
        <li v-for="(s, i) in items.slice(0, 40)" :key="i">
          <i :style="{ background: pastelOf(s.cat) }"></i>
          <span class="name">{{ s.name }}</span>
          <span class="muted">{{ s.cat }} · {{ s.dist }}m</span>
        </li>
      </ul>
    </template>
    <p class="muted note">구역마다 간판을 골고루 추려 담아 둔 표본이라, 실제 가게 전부는 아니에요.</p>
  </div>
</template>

<style scoped>
.near {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

p {
  margin: 0;
}

.app-body .locate {
  min-height: 30px;
  border-radius: 8px;
  font-weight: 600;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.chips .muted {
  font-size: 11px;
  margin-right: 2px;
}

.app-body .m-chip.on {
  color: #fff;
  background: var(--accent);
}

.radar {
  width: 100%;
  max-width: 240px;
  align-self: center;
  border-radius: 50%;
  background: radial-gradient(#26324a, #141821);
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.2), 0 8px 24px rgba(0, 0, 0, 0.18);
}

.sum {
  font-size: 12px;
  color: var(--label-2);
}

.sum b {
  color: var(--label);
  font-weight: 600;
}

.list {
  list-style: none;
  margin: 0;
  padding: 2px 0;
  max-height: 200px;
  overflow-y: auto;
}

.list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
}

.list li + li {
  border-top: 0.5px solid var(--sep);
}

.list li i {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.list .name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.list .muted {
  flex: none;
  font-size: 11px;
}

.note {
  font-size: 11px;
}
</style>
