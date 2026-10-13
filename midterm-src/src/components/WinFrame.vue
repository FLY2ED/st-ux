<script setup>
import { ref } from 'vue'

const props = defineProps({
  title: String,
  icon: String,
  x: Number,
  y: Number,
  width: { type: Number, default: 420 },
  z: Number,
  active: Boolean,
})
const emit = defineEmits(['close', 'focus'])

const pos = ref({ x: props.x, y: props.y })
let drag = null

function down(e) {
  emit('focus')
  if (window.innerWidth < 720 || e.target.closest('button')) return
  drag = { dx: e.clientX - pos.value.x, dy: e.clientY - pos.value.y }
  e.currentTarget.setPointerCapture(e.pointerId)
}

function move(e) {
  if (!drag) return
  pos.value = {
    x: Math.min(Math.max(e.clientX - drag.dx, -props.width + 80), window.innerWidth - 80),
    y: Math.min(Math.max(e.clientY - drag.dy, 0), window.innerHeight - 80),
  }
}
</script>

<template>
  <div
    class="window frame"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${width}px`, zIndex: z }"
    @pointerdown="emit('focus')"
  >
    <div
      class="title-bar"
      :class="{ inactive: !active }"
      @pointerdown.stop="down"
      @pointermove="move"
      @pointerup="drag = null"
      @pointercancel="drag = null"
    >
      <div class="title-bar-text">{{ icon }} {{ title }}</div>
      <div class="title-bar-controls">
        <button aria-label="Close" @click="emit('close')"></button>
      </div>
    </div>
    <div class="window-body body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.frame {
  position: absolute;
  max-width: calc(100vw - 8px);
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - var(--taskbar-h) - 8px);
}

.title-bar {
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.body {
  overflow: auto;
  min-height: 0;
}

@media (max-width: 719px) {
  .frame {
    left: 4px !important;
    right: 4px;
    top: 4px !important;
    width: auto !important;
    max-width: none;
    height: calc(100dvh - var(--taskbar-h) - 8px);
  }

  .title-bar {
    cursor: default;
    padding: 4px 3px 4px 6px;
  }

  .title-bar-controls button {
    transform: scale(1.4);
    transform-origin: right center;
  }

  .body {
    flex: 1;
  }
}
</style>
