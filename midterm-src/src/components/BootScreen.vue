<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { sfx } from '../sound.js'

const props = defineProps({ meta: Object })
const emit = defineEmits(['done'])

const START_IMG = new URL('../assets/icon-start.webp', import.meta.url).href
const STEP = 260

const phase = ref('post')
const shown = ref(0)
const memory = ref(0)

const lines = computed(() => {
  const m = props.meta
  return [
    'GANPAN BIOS v4.98PG, An Energy Star Ally',
    'Copyright (C) 1998, 간판도감 Software, Inc.',
    '',
    'Main Processor : Pentium II 400MHz',
    `Memory Testing : ${memory.value}K OK`,
    '',
    `간판 데이터 검사 ...... ${m ? m.total.toLocaleString() : '2,772,484'}개 OK`,
    `업종 목록 검사 ........ ${m ? m.categories : 247}종 OK`,
    `기준일 ................ ${m ? m.date : '2026-06-30'}`,
    '',
    'Starting 간판도감 98...',
  ]
})

// 부팅 순서를 한 칸씩 진행한다. 검은 BIOS 화면은 건너뛸 수 없다
const steps = []
for (let i = 1; i <= lines.value.length; i++) {
  steps.push([STEP, () => (shown.value = i)])
  // 메모리 카운터는 해당 줄이 나온 뒤에 올라간다
  if (i === 5) for (let k = 1; k <= 8; k++) steps.push([70, () => (memory.value = k * 8192)])
}
// 파란 시작 화면은 누를 때까지 그대로 둔다
steps.push([STEP * 2, () => (phase.value = 'splash')])

let at = 0
let timer

function run() {
  if (at >= steps.length) return
  const [ms, fn] = steps[at]
  timer = setTimeout(() => {
    at++
    fn()
    run()
  }, ms)
}

function finish() {
  if (phase.value === 'done') return
  clearTimeout(timer)
  phase.value = 'done'
  sfx.startup()
  emit('done')
}

// 파란 시작 화면이 뜬 뒤에만 눌러서 넘어간다
function start() {
  if (phase.value === 'splash') finish()
}

onMounted(() => {
  run()
  window.addEventListener('keydown', start)
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  window.removeEventListener('keydown', start)
})
</script>

<template>
  <div class="boot" role="status" aria-label="간판도감 98 부팅 중" @click="start">
    <pre v-if="phase === 'post'" class="post">{{ lines.slice(0, shown).join('\n') }}<span class="caret">_</span></pre>

    <div v-else class="splash">
      <div class="logo">
        <img :src="START_IMG" alt="" width="72" height="72" />
        <p><b>간판</b>도감<sup>98</sup></p>
      </div>
      <p class="press">클릭하거나 아무 키나 누르면 시작합니다</p>
      <div class="bar" aria-hidden="true"></div>
    </div>
  </div>
</template>

<style scoped>
.boot {
  position: fixed;
  inset: 0;
  z-index: 20000;
  background: #000;
  color: #c0c0c0;
  cursor: wait;
  image-rendering: pixelated;
}

.post {
  margin: 0;
  padding: 24px 28px;
  font-family: 'Galmuri11', monospace;
  font-size: 15px;
  line-height: 1.5;
  white-space: pre-wrap;
  color: inherit;
  background: none;
  border: 0;
  box-shadow: none;
}

.caret {
  animation: blink 0.5s steps(1) infinite;
}

.splash {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: linear-gradient(#1b3f9b, #4f86d9 60%, #8fb3e6);
  cursor: pointer;
  animation: fade-in 0.4s steps(4);
}

.press {
  position: absolute;
  bottom: 30%;
  margin: 0;
  font-size: 14px;
  color: #fff;
  text-shadow: 2px 2px 0 #1d1d2b;
  animation: blink 1s steps(1) infinite;
}

.logo {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 40px;
}

.logo p {
  margin: 0;
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-size: 46px;
  color: #fff;
  text-shadow: 3px 3px 0 #1d1d2b;
}

.logo b {
  color: var(--yellow);
}

.logo sup {
  font-size: 22px;
  margin-left: 4px;
}

/* 98 시작 화면 맨 아래 띠. 원본은 팔레트 끝 20색을 돌려 움직였다.
   그래서 20칸 색 띠가 화면 너비만큼 한 바퀴를 이루고, 한 칸씩 끊어 흐른다 */
.bar {
  position: absolute;
  inset: auto 0 0 0;
  height: max(10px, 2.5vh);
  background: linear-gradient(90deg, #00003a 0 5%, #000060 5% 10%, #001080 10% 15%, #0020a0 15% 20%, #0038c0 20% 25%, #0050d8 25% 30%, #2070e8 30% 35%, #4090f0 35% 40%, #68b0f8 40% 45%, #98d0ff 45% 50%, #c8e8ff 50% 55%, #98d0ff 55% 60%, #68b0f8 60% 65%, #4090f0 65% 70%, #2070e8 70% 75%, #0050d8 75% 80%, #0038c0 80% 85%, #0020a0 85% 90%, #001080 90% 95%, #000060 95% 100%);
  background-size: 100vw 100%;
  animation: flow 1.6s steps(20) infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
}

@keyframes flow {
  to {
    background-position: 100vw 0;
  }
}

@media (max-width: 719px) {
  .post {
    padding: 16px;
    font-size: 12px;
  }

  .logo p {
    font-size: 34px;
  }

  .logo img {
    width: 52px;
    height: 52px;
  }
}
</style>
