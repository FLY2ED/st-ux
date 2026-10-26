<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { CAN, displacementMap } from '../shell/glassmap.js'

// 리퀴드 글라스 판. Dock(refract.jsx)과 같은 가장자리 굴절 지도를 Vue 쪽에서 쓴다
// 뒤에 비치는 것을 흐리고(blur) 테두리 띠에서 안쪽으로 휘게(scale) 한다. Chromium 밖에서는 흐림만 남는다
const props = defineProps({
  tag: { type: String, default: 'div' },
  radius: { type: Number, default: 16 },
  band: { type: Number, default: 12 },
  scale: { type: Number, default: 36 },
  blur: { type: Number, default: 2 },
  saturate: { type: Number, default: 170 },
})

const id = `fg${Math.random().toString(36).slice(2, 9)}`
const el = ref(null)
const map = ref(null)
let ro
let t

onMounted(() => {
  if (!CAN || !el.value) return
  const draw = () => {
    const w = Math.round(el.value.offsetWidth)
    const h = Math.round(el.value.offsetHeight)
    if (w > 0 && h > 0) map.value = displacementMap(w, h, props.radius, props.band)
  }
  ro = new ResizeObserver(() => {
    clearTimeout(t)
    t = setTimeout(draw, 140)
  })
  ro.observe(el.value)
  draw()
})

onBeforeUnmount(() => {
  ro?.disconnect()
  clearTimeout(t)
})
</script>

<template>
  <component
    :is="tag"
    ref="el"
    class="glass"
    :class="{ refract: map }"
    :style="map ? { backdropFilter: `url(#${id}) saturate(${saturate}%)`, WebkitBackdropFilter: `url(#${id}) saturate(${saturate}%)` } : null"
  >
    <svg v-if="map" width="0" height="0" class="glass-defs" aria-hidden="true">
      <filter :id="id" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feImage :href="map" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
        <feGaussianBlur in="SourceGraphic" :stdDeviation="blur" result="soft" />
        <feDisplacementMap in="soft" in2="map" :scale="scale" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
    <slot />
  </component>
</template>

<style scoped>
/* 굴절을 못 쓰는 브라우저는 흐림만 */
.glass {
  -webkit-backdrop-filter: blur(16px) saturate(170%);
  backdrop-filter: blur(16px) saturate(170%);
}

.glass-defs {
  position: absolute;
  pointer-events: none;
}
</style>
