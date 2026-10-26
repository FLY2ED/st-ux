<script setup>
// 보스를 이긴 뒤 괄호 대사(“자루에서 글자들이 쏟아져 나왔다”)에 맞춰 도는 짧은 그림 장면.
// 한 장으로 뽑은 8칸 그림을 가로 띠로 이어 두고 steps()로 넘긴다. 마지막 칸에서 멈춘다
import { computed, ref, watchEffect } from 'vue'

const props = defineProps({ id: { type: String, required: true } })
const STRIPS = import.meta.glob('../../assets/cut/*.webp', { eager: true, import: 'default' })
const FRAMES = 8
const src = computed(() => STRIPS[`../../assets/cut/${props.id}.webp`])
// 칸 하나의 가로세로 비: 띠 전체 너비 ÷ 칸 수 ÷ 높이
const ar = ref(0)
watchEffect(() => {
  if (!src.value) return
  const img = new Image()
  img.onload = () => (ar.value = img.naturalWidth / FRAMES / img.naturalHeight)
  img.src = src.value
})
</script>

<template>
  <div v-if="src" class="cut" aria-hidden="true">
    <div v-if="ar" class="cut-film" :style="{ backgroundImage: `url(${src})`, '--n': FRAMES, '--ar': ar }"></div>
  </div>
</template>

<style scoped>
.cut {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding-bottom: 140px;
  background: radial-gradient(closest-side, rgb(20 27 58 / 0.55), rgb(8 10 28 / 0.88));
  animation: cut-in 0.25s steps(4) both;
  pointer-events: none;
}

.cut-film {
  height: min(52vh, 320px);
  aspect-ratio: var(--ar, 1);
  background-repeat: no-repeat;
  background-size: calc(var(--n) * 100%) 100%;
  image-rendering: pixelated;
  animation: cut-play 1.6s steps(8, jump-none) 0.2s both;
}

@keyframes cut-play {
  from {
    background-position: 0 0;
  }
  to {
    background-position: 100% 0;
  }
}

@keyframes cut-in {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cut-film {
    animation: none;
    background-position: 100% 0;
  }
}
</style>
