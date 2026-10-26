<script setup>
// 남은 목숨 하트. 방금 잃은 칸은 한 번 번쩍인다
defineProps({ lives: { type: Number, default: 3 }, max: { type: Number, default: 3 } })
</script>

<template>
  <span class="sg-hearts" role="img" :aria-label="`목숨 ${lives}`">
    <svg v-for="n in max" :key="`${n}-${n > lives}`" :class="{ off: n > lives, lost: n === lives + 1 }" viewBox="0 0 7 6" shape-rendering="crispEdges" aria-hidden="true">
      <path d="M1 0h2v1h1V0h2v1h1v2H6v1H5v1H4v1H3V5H2V4H1V3H0V1h1z" />
    </svg>
  </span>
</template>
