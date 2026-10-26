<script setup>
// 카메라를 켜기 전 안내 시트. 브라우저 권한 창을 띄우기 전에 왜 필요한지 먼저 말하고, 실패하면 이유별로 푸는 법을 보여 준다
import { computed, onMounted, ref } from 'vue'
import { cameraError, cameraPermission, cameraSecure, listCameras, savedCamera, saveCamera } from '../face.js'

const props = defineProps({
  // (deviceId) => Promise<MediaStream>: 실제로 카메라를 여는 쪽은 게임이 정한다
  open: { type: Function, required: true },
  purpose: { type: String, default: '얼굴 위에 간판을 달기 위해' },
})
const emit = defineEmits(['ready', 'cancel'])

const state = ref('check') // check | intro | opening | error
const problem = ref(null)
const cameras = ref([])
const pick = ref(savedCamera() || '')

const ICONS = {
  denied: 'M4 4l16 16',
  missing: 'M12 8v5m0 3h.01',
  busy: 'M12 8v4l2.5 2.5',
  insecure: 'M9 11V8a3 3 0 0 1 6 0v3',
}
const mark = computed(() => ICONS[problem.value?.kind] || '')

async function refreshCameras() {
  cameras.value = await listCameras()
  if (pick.value && !cameras.value.some((c) => c.id === pick.value)) pick.value = ''
}

async function start() {
  state.value = 'opening'
  problem.value = null
  try {
    const stream = await props.open(pick.value || undefined)
    await refreshCameras()
    emit('ready', stream)
  } catch (e) {
    problem.value = cameraError(e)
    state.value = 'error'
    await refreshCameras()
  }
}

function choose() {
  saveCamera(pick.value || null)
  if (state.value === 'error') start()
}

onMounted(async () => {
  if (!cameraSecure()) {
    problem.value = cameraError({ name: 'SecurityContextError' })
    state.value = 'error'
    return
  }
  const perm = await cameraPermission()
  await refreshCameras()
  // 이미 허용했다면 다시 묻지 않고 바로 연다. 막혀 있으면 브라우저가 창을 안 띄우니 푸는 법부터 보여 준다
  if (perm === 'granted') return start()
  if (perm === 'denied') {
    problem.value = cameraError({ name: 'NotAllowedError' })
    state.value = 'error'
    return
  }
  state.value = 'intro'
})
</script>

<template>
  <div class="gate m-sheet" role="dialog" aria-modal="true" aria-labelledby="gate-title">
    <div class="card">
      <div class="cam" :class="{ bad: state === 'error' }" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2.5" y="6.5" width="13" height="11" rx="2.5" />
          <path d="M15.5 10.5l5-3v9l-5-3" />
        </svg>
        <span v-if="state === 'error'" class="badge">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path :d="mark || 'M12 8v5m0 3h.01'" /></svg>
        </span>
      </div>

      <template v-if="state === 'check' || state === 'opening'">
        <p id="gate-title" class="m-title">카메라 여는 중…</p>
        <p class="m-desc">브라우저가 물어보면 <b>허용</b>을 눌러 주세요</p>
        <span class="spin" aria-hidden="true"></span>
      </template>

      <template v-else-if="state === 'intro'">
        <p id="gate-title" class="m-title">카메라를 켤게요</p>
        <p class="m-desc">{{ purpose }} 카메라가 필요해요.</p>
        <ul class="facts">
          <li>영상은 이 기기 안에서만 쓰이고 서버로 보내거나 저장하지 않아요</li>
          <li>창을 닫으면 카메라도 바로 꺼져요</li>
        </ul>
      </template>

      <template v-else>
        <p id="gate-title" class="m-title">{{ problem.title }}</p>
        <ol class="steps">
          <li v-for="(g, i) in problem.guide" :key="i">{{ g }}</li>
        </ol>
      </template>

      <label v-if="cameras.length > 1 && state !== 'opening'" class="pick">
        <span>카메라</span>
        <select v-model="pick" @change="choose">
          <option value="">기본 카메라</option>
          <option v-for="c in cameras" :key="c.id" :value="c.id">{{ c.label }}</option>
        </select>
      </label>

      <div class="btns">
        <button type="button" @click="emit('cancel')">{{ state === 'intro' ? '나중에' : '닫기' }}</button>
        <button v-if="state === 'intro'" type="button" class="go" @click="start">카메라 허용</button>
        <button v-else-if="state === 'error' && problem.kind !== 'insecure' && problem.kind !== 'unsupported'" type="button" class="go" @click="start">다시 시도</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gate {
  z-index: 20;
}
.card {
  width: min(320px, 100%);
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 22px 20px 16px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.12), 0 18px 50px rgba(0, 0, 0, 0.22);
}
html.dark .card {
  background: var(--panel);
  box-shadow: 0 0 0 0.5px var(--sep), 0 18px 50px rgba(0, 0, 0, 0.22);
}
.cam {
  position: relative;
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  margin-bottom: 2px;
  border-radius: 16px;
  color: #fff;
  background: linear-gradient(#3ad16a, #1fae4a);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 6px 14px rgba(31, 174, 74, 0.35);
}
.cam.bad {
  background: linear-gradient(#a1a1a6, #7c7c80);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 6px 14px rgba(0, 0, 0, 0.18);
}
.badge {
  position: absolute;
  right: -6px;
  bottom: -6px;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #ff3b30;
  box-shadow: 0 0 0 2.5px var(--panel);
}
.m-title {
  font-size: 17px;
}
.facts,
.steps {
  margin: 2px 0 0;
  padding: 10px 12px 10px 28px;
  width: 100%;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.04);
  text-align: left;
  font-size: 12px;
  line-height: 1.55;
  color: var(--label-2);
}
html.dark .facts,
html.dark .steps {
  background: var(--fill);
}
.facts li::marker {
  color: #30d158;
}
.steps li {
  padding-left: 2px;
}
.steps li::marker {
  font-weight: 700;
  color: var(--accent);
}
.pick {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  font-size: 12px;
  color: var(--label-2);
}
.pick select {
  flex: 1;
  min-width: 0;
}
.btns {
  display: flex;
  gap: 8px;
  width: 100%;
  margin-top: 6px;
}
.btns button {
  flex: 1;
  min-height: 28px;
}
.spin {
  width: 22px;
  height: 22px;
  margin: 6px;
  border: 2.5px solid rgba(0, 0, 0, 0.12);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
html.dark .spin {
  border-color: var(--sep);
  border-top-color: var(--accent);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
