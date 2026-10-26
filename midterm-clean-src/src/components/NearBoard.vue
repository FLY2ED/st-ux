<script setup>
import { computed, ref, watch } from 'vue'
import { nearby } from '../data.js'
import { fmt, swatchOf, useCount, useSeen } from '../util.js'

const SPOTS = [
  { label: '강남역', lng: 127.0276, lat: 37.4979 },
  { label: '홍대입구', lng: 126.9237, lat: 37.5572 },
  { label: '부산 서면', lng: 129.0597, lat: 35.1579 },
  { label: '제주시청', lng: 126.5312, lat: 33.4996 },
]
const RADIUS = 500

const root = ref(null)
const seen = useSeen(root)
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
    if (!items.value.length) error.value = '이 근처에는 모아 둔 간판이 없습니다. 위의 번화가를 눌러 보세요.'
  } catch {
    error.value = '데이터를 불러오지 못했습니다.'
  }
  busy.value = false
}

function locate() {
  if (!navigator.geolocation) return (error.value = '이 브라우저는 위치를 알려 주지 않습니다.')
  busy.value = true
  navigator.geolocation.getCurrentPosition(
    (p) => scan(p.coords.longitude, p.coords.latitude, '내 위치'),
    () => {
      busy.value = false
      error.value = '위치 사용을 허용하지 않았습니다. 번화가를 골라 보세요.'
    },
    { timeout: 10000 },
  )
}

// 처음 보일 때 강남역부터 보여 준다
watch(seen, (v) => v && !items.value.length && scan(SPOTS[0].lng, SPOTS[0].lat, SPOTS[0].label))

const shown = useCount(computed(() => items.value.length), seen, 900)

const cats = computed(() => {
  const m = new Map()
  for (const s of items.value) m.set(s.cat, (m.get(s.cat) || 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, 6)
})
const nearest = computed(() => items.value.slice(0, 36))
</script>

<template>
  <section id="near" ref="root" class="near wrap">
    <div class="head">
      <h2>우리 동네 간판</h2>
      <p>반경 {{ RADIUS }}m 안에 어떤 간판이 걸려 있는지 가까운 순서로 보여 줍니다.</p>
    </div>

    <div class="controls">
      <button class="btn" :disabled="busy" @click="locate">내 위치로 찾기</button>
      <button
        v-for="s in SPOTS"
        :key="s.label"
        class="btn quiet"
        :class="{ on: where === s.label }"
        :disabled="busy"
        @click="scan(s.lng, s.lat, s.label)"
      >
        {{ s.label }}
      </button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="items.length" class="board">
      <div class="tile total">
        <p class="label">{{ where }} 반경 {{ RADIUS }}m</p>
        <p class="num">{{ fmt(shown) }}<span>개</span></p>
        <p class="note">전국에서 고르게 뽑은 표본이라 실제 가게 수보다 적습니다.</p>
      </div>
      <div class="tile cats">
        <p class="label">많은 업종</p>
        <ol>
          <li v-for="[cat, n] in cats" :key="cat">
            <span class="name">{{ cat }}</span>
            <span class="bar"><i :style="{ width: `${(n / cats[0][1]) * 100}%`, background: swatchOf(cat).bg }" /></span>
            <span class="n">{{ n }}</span>
          </li>
        </ol>
      </div>
      <ul class="names">
        <li
          v-for="(s, i) in nearest"
          :key="`${where}-${s.name}-${i}`"
          :style="{ background: swatchOf(s.cat).bg, color: swatchOf(s.cat).fg, animationDelay: `${Math.min(i, 12) * 25}ms` }"
        >
          {{ s.name }}<small>{{ s.dist }}m</small>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.near {
  padding-top: clamp(80px, 12vw, 160px);
}

.head {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--gap);
  align-items: end;
  margin-bottom: 28px;
}

.head h2 {
  grid-column: span 7;
  font-size: var(--step-head);
}

.head p {
  grid-column: span 5;
  max-width: 30em;
  color: var(--muted);
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap);
  margin-bottom: 20px;
}

.error {
  margin-bottom: 20px;
  color: var(--red);
  font-weight: 600;
}

.board {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--gap);
}

.tile {
  display: flex;
  flex-direction: column;
  min-height: 320px;
  padding: var(--pad);
  border-radius: var(--tile);
}

.total {
  grid-column: span 5;
  background: var(--blue);
  color: #fff;
}

.cats {
  grid-column: span 7;
  background: var(--surface);
}

.label {
  font-size: var(--step-lead);
  font-weight: 700;
  letter-spacing: -0.02em;
}

.num {
  margin-top: auto;
  font-size: var(--step-head);
  font-weight: 800;
  letter-spacing: -0.045em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.num span {
  font-size: 0.5em;
}

.note {
  margin-top: 14px;
  opacity: 0.85;
}

ol {
  display: grid;
  gap: 12px;
  margin: auto 0 0;
  padding: 0;
  list-style: none;
}

ol li {
  display: grid;
  grid-template-columns: minmax(7em, 13em) 1fr 3em;
  align-items: center;
  gap: 14px;
}

.name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar {
  height: 22px;
  border-radius: var(--pill);
  background: var(--bg);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  border-radius: var(--pill);
  transition: width 0.8s var(--out);
}

.n {
  text-align: right;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.names {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.names li {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 12px 20px;
  border-radius: var(--pill);
  font-weight: 700;
  animation: pop 0.5s var(--out) both;
}

.names small {
  font-size: var(--step-small);
  font-weight: 600;
  opacity: 0.75;
}

@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(8px);
  }
}

@media (max-width: 860px) {
  .head h2,
  .head p,
  .total,
  .cats {
    grid-column: 1 / -1;
  }

  .tile {
    min-height: 240px;
  }

  ol li {
    grid-template-columns: 7em 1fr 2.5em;
  }
}
</style>
