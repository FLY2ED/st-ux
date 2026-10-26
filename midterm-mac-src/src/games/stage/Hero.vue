<script setup>
// 놀이판 속 내 캐릭터: 캐릭터 만들기에서 고른 모습(readLook)을 작은 캔버스에 그린다
// pose: idle 제자리 · walk 걷기 · cheer 만세(통통 튄다) · hurt 맞음(빨갛게 흔들린다)
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { drawAvatar, readLook } from '../../avatar.js'

const props = defineProps({
  scale: { type: Number, default: 4 },
  dir: { type: Number, default: 0 },
  pose: { type: String, default: 'idle' },
})
const cv = ref(null)
const look = readLook()
let frame = 0
let timer = 0

function paint() {
  const c = cv.value
  if (!c) return
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  const f = props.pose === 'walk' ? [1, 0, 2, 0][frame % 4] : 0
  drawAvatar(ctx, look, c.width / 2, c.height - 2, { scale: props.scale, dir: props.dir, frame: f })
}

function loop() {
  clearInterval(timer)
  if (props.pose !== 'walk') return paint()
  timer = setInterval(() => {
    frame++
    paint()
  }, 140)
}

watch(() => [props.pose, props.dir, props.scale], () => requestAnimationFrame(loop))
onMounted(loop)
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <canvas
    ref="cv"
    class="sg-hero"
    :class="pose"
    :width="16 * scale + 8"
    :height="24 * scale + 6"
    aria-hidden="true"
  ></canvas>
</template>

<style scoped>
.sg-hero {
  display: block;
  image-rendering: pixelated;
}

.sg-hero.cheer {
  animation: hero-hop 0.42s steps(3) infinite alternate;
}

.sg-hero.hurt {
  animation: hero-hurt 0.4s steps(4);
}

@keyframes hero-hop {
  to {
    translate: 0 -10px;
  }
}

@keyframes hero-hurt {
  0%,
  100% {
    filter: none;
    translate: 0 0;
  }
  25% {
    filter: brightness(1.6) sepia(1) hue-rotate(-50deg) saturate(5);
    translate: -6px 0;
  }
  75% {
    filter: brightness(1.6) sepia(1) hue-rotate(-50deg) saturate(5);
    translate: 6px 0;
  }
}
</style>
