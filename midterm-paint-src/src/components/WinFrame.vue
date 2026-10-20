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

const PAPER = new URL('../assets/paper-page.webp', import.meta.url).href
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
    :class="{ active }"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px`, width: `${width}px`, zIndex: z, backgroundImage: `url(${PAPER})` }"
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
      <div class="title-bar-text"><span class="hl">{{ title }}</span></div>
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
/* 공책 위에 테이프로 붙인 종이 한 장 */
.frame {
  position: absolute;
  max-width: calc(100vw - 8px);
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 24px);
  background: var(--paper) center / 100% 100% no-repeat;
  border: 0;
  padding: 14px 10px 10px;
  box-shadow: none;
  filter: drop-shadow(4px 5px 0 rgb(27 27 27 / 0.18));
  animation: drop 0.32s cubic-bezier(0.3, 1.5, 0.5, 1);
}

.frame.active {
  filter: drop-shadow(5px 7px 0 rgb(27 27 27 / 0.7));
}

.title-bar {
  cursor: grab;
  touch-action: none;
  user-select: none;
  padding-top: 10px;
  border-bottom: 2px dashed rgb(27 27 27 / 0.35);
}

.hl {
  background: linear-gradient(transparent 58%, var(--hl-soft) 58% 92%, transparent 92%);
}

.active .hl {
  background: linear-gradient(transparent 58%, var(--hl) 58% 92%, transparent 92%);
}

.body {
  overflow: auto;
  min-height: 0;
}

@keyframes drop {
  from {
    opacity: 0;
    transform: translateY(-18px) rotate(-2deg);
  }
}

@media (max-width: 719px) {
  .frame {
    left: 6px !important;
    right: 6px;
    top: 14px !important;
    width: auto !important;
    max-width: none;
    height: calc(100dvh - 24px);
  }

  .title-bar {
    cursor: default;
  }

  .body {
    flex: 1;
  }
}
</style>
