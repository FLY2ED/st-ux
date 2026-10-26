<script setup>
import { computed } from 'vue'
import { swatchOf } from '../util.js'

// 진짜 간판 이름이 알약 모양으로 겹쳐 흘러간다. 줄마다 방향과 속도가 다르다
const props = defineProps({ names: { type: Array, default: () => [] } })

const rows = computed(() => {
  const out = [[], [], []]
  props.names.forEach((n, i) => out[i % 3].push(n))
  return out.filter((r) => r.length)
})
</script>

<template>
  <div class="stream marquee" aria-hidden="true">
    <div v-for="(row, r) in rows" :key="r" class="row" :class="`r${r}`">
      <div class="track">
        <template v-for="copy in 2" :key="copy">
          <span
            v-for="(n, i) in row"
            :key="`${copy}-${i}`"
            class="pill"
            :style="{ background: swatchOf(n.name + r).bg, color: swatchOf(n.name + r).fg }"
          >
            {{ n.name }}<small v-if="n.count">{{ n.count.toLocaleString('ko-KR') }}</small>
          </span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stream {
  display: grid;
  gap: 10px;
  overflow: hidden;
}

.row {
  overflow: hidden;
}

.track {
  display: flex;
  width: max-content;
  animation: slide 70s linear infinite;
}

.r1 .track {
  animation-duration: 90s;
  animation-direction: reverse;
}

.r2 .track {
  animation-duration: 60s;
}

.row:hover .track {
  animation-play-state: paused;
}

.pill {
  display: inline-flex;
  align-items: baseline;
  gap: 10px;
  margin-right: -14px;
  padding: 18px 36px;
  border: 3px solid var(--bg);
  border-radius: var(--pill);
  font-size: var(--step-lead);
  font-weight: 700;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.pill small {
  font-size: inherit;
  font-weight: 500;
  opacity: 0.7;
}

@keyframes slide {
  to {
    transform: translateX(-50%);
  }
}

@media (max-width: 640px) {
  .pill {
    padding: 12px 24px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .track {
    animation: none;
  }
}
</style>
