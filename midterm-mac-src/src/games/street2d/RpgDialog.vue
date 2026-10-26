<script setup>
// 픽셀 RPG 대화창: 화면 아래 남색 상자, 왼쪽 초상화, 위에 걸친 이름표, 한 글자씩 나오는 대사
// 클릭·Enter·Space: 글자가 나오는 중이면 한 번에 다 보이고, 다 나왔으면 next(선택지가 있으면 고른 것)
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { sound } from '../../sound.js'

const props = defineProps({
  who: { type: String, default: '' },
  face: { type: String, default: '' },
  portrait: { type: String, default: '' },
  text: { type: String, default: '' },
  choices: { type: Array, default: () => [] },
  tone: { type: String, default: 'npc' }, // npc | boss | me | system
  keys: { type: Boolean, default: true }, // false 면 키 입력은 부모가 맡는다
  speed: { type: Number, default: 34 }, // 글자 하나에 걸리는 ms
})
const emit = defineEmits(['next', 'choose'])

// 말하는 사람마다 삑 소리 높이가 다르다
const PITCH = { npc: 520, boss: 190, me: 700, system: 880 }

const chars = computed(() => Array.from(props.text || ''))
const n = ref(0)
const sel = ref(0)
const shaking = ref(false)
const done = computed(() => n.value >= chars.value.length)
const shown = computed(() => chars.value.slice(0, n.value).join(''))
const rest = computed(() => chars.value.slice(n.value).join(''))
const picking = computed(() => done.value && props.choices.length > 0)
const system = computed(() => props.tone === 'system')

let timer = 0
let said = 0

// 아주 짧은 사각파 '삑'. 효과음을 끈 상태면 조용히 넘어간다
let ac = null
function blip(freq = PITCH[props.tone] || PITCH.npc) {
  if (sound.muted) return
  try {
    ac ||= new (window.AudioContext || window.webkitAudioContext)()
    if (ac.state === 'suspended') ac.resume()
    const t = ac.currentTime
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = 'square'
    o.frequency.value = freq * (0.96 + Math.random() * 0.08)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.035, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045)
    o.connect(g).connect(ac.destination)
    o.start(t)
    o.stop(t + 0.05)
  } catch {
    // 소리를 못 내는 브라우저면 글자만 나온다
  }
}

function step() {
  if (done.value) return
  n.value++
  const ch = chars.value[n.value - 1]
  // 두 글자에 한 번만 삑(공백·문장부호는 세지 않는다)
  if (/[가-힣A-Za-z0-9]/.test(ch) && said++ % 2 === 0) blip()
  const wait = /[.!?…~]/.test(ch) ? props.speed * 5 : /[,]/.test(ch) ? props.speed * 3 : props.speed
  timer = setTimeout(step, wait)
}

function run() {
  clearTimeout(timer)
  sel.value = 0
  said = 0
  n.value = 0
  if (props.speed <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) n.value = chars.value.length
  else timer = setTimeout(step, 60)
  if (props.tone === 'boss') {
    shaking.value = false
    requestAnimationFrame(() => (shaking.value = true))
  }
}
watch(() => [props.text, props.tone], run, { immediate: true })

function skip() {
  clearTimeout(timer)
  n.value = chars.value.length
}

function advance() {
  if (!done.value) return skip()
  if (picking.value) return choose(sel.value)
  emit('next')
}

function choose(i) {
  if (!picking.value) return
  blip(PITCH.me)
  emit('choose', i)
}

function move(d) {
  const len = props.choices.length
  sel.value = (sel.value + d + len) % len
  blip(PITCH.system)
}

function onKey(e) {
  if (!props.keys) return
  const t = e.target
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    if (!e.repeat) advance()
  } else if (picking.value && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault()
    move(e.key === 'ArrowUp' ? -1 : 1)
  }
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  clearTimeout(timer)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="rpg" :class="[`rpg-${tone}`, { 'rpg-shake': shaking }]" role="dialog" :aria-label="who || '안내'" @click="advance" @animationend="shaking = false">
    <span v-if="who && !system" class="rpg-name">{{ who }}</span>
    <div class="rpg-box">
      <div v-if="!system && (portrait || face)" class="rpg-face" aria-hidden="true">
        <img v-if="portrait" :src="portrait" alt="" draggable="false" />
        <span v-else>{{ face }}</span>
      </div>
      <div class="rpg-body">
        <p class="rpg-sr">{{ text }}</p>
        <p class="rpg-text" aria-hidden="true">{{ shown }}<span class="rpg-rest">{{ rest }}</span></p>
        <ul v-if="choices.length" class="rpg-choices" :class="{ off: !picking }" role="listbox" :aria-hidden="!picking">
          <li v-for="(c, i) in choices" :key="i" role="option" :aria-selected="picking && sel === i">
            <button type="button" :class="{ on: picking && sel === i }" :disabled="!picking" @mouseenter="picking && (sel = i)" @click.stop="choose(i)">
              <i aria-hidden="true">▶</i>{{ c.label }}
            </button>
          </li>
        </ul>
      </div>
      <span v-if="done && !picking" class="rpg-more" aria-hidden="true">▼</span>
    </div>
  </div>
</template>

<style scoped>
.rpg {
  --line: #fff1e8;
  --bg: #141b3a;
  --inner: #2b3a78;
  --tag: #ffa300;
  --tag-ink: #1d1d1f;
  position: absolute;
  left: 50%;
  bottom: 18px;
  z-index: 40;
  width: min(720px, calc(100% - 28px));
  translate: -50% 0;
  color: #fff1e8;
  font-family: var(--game-font, 'Galmuri11 Game', 'Galmuri11', sans-serif);
  -webkit-font-smoothing: none;
  font-smooth: never;
  user-select: none;
  cursor: pointer;
  container-type: inline-size;
}

.rpg-boss {
  --line: #ff004d;
  --bg: #24091a;
  --inner: #7e2553;
  --tag: #ff004d;
  --tag-ink: #fff1e8;
}

.rpg-me {
  --tag: #29adff;
}

.rpg-system {
  --line: #c2c3c7;
  --bg: #000;
  --inner: #3a3a46;
}

/* 모서리가 한 칸 깎인 3px 테두리 + 안쪽 한 줄 + 바닥 그늘 */
.rpg-box {
  position: relative;
  display: flex;
  gap: 14px;
  min-height: 116px;
  padding: 14px 20px 18px 14px;
  background: var(--bg);
  box-shadow:
    inset 0 0 0 3px var(--inner),
    0 -3px 0 0 var(--line),
    0 3px 0 0 var(--line),
    -3px 0 0 0 var(--line),
    3px 0 0 0 var(--line),
    0 9px 0 0 rgba(0, 0, 0, 0.45);
}

.rpg-me .rpg-box {
  flex-direction: row-reverse;
  padding: 14px 14px 18px 20px;
}

/* 이름표: 상자 위에 걸친 작은 탭 */
.rpg-name {
  position: absolute;
  bottom: 100%;
  left: 14px;
  z-index: 1;
  margin-bottom: 3px;
  padding: 5px 12px 4px;
  color: var(--tag-ink);
  background: var(--tag);
  font-size: 14px;
  line-height: 1.2;
  box-shadow:
    0 -3px 0 0 var(--line),
    -3px 0 0 0 var(--line),
    3px 0 0 0 var(--line);
}

.rpg-me .rpg-name {
  left: auto;
  right: 14px;
}

.rpg-face {
  flex: none;
  display: grid;
  place-items: center;
  width: 84px;
  height: 84px;
  background: #0b1028;
  box-shadow: inset 0 0 0 3px var(--inner);
}

.rpg-face img {
  width: 72px;
  height: 72px;
  object-fit: contain;
  image-rendering: pixelated;
}

.rpg-face span {
  font-size: 48px;
  line-height: 1;
}

.rpg-body {
  flex: 1;
  min-width: 0;
}

.rpg-text {
  margin: 2px 0 0;
  font-size: 17px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: keep-all;
  overflow-wrap: anywhere;
}

.rpg-system .rpg-text {
  text-align: center;
}

.rpg-system .rpg-box {
  align-items: center;
  justify-content: center;
}

/* 아직 안 나온 글자도 자리는 잡아 둔다(상자 높이가 출렁이지 않게) */
.rpg-rest {
  visibility: hidden;
}

.rpg-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

.rpg-choices {
  display: grid;
  gap: 2px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.rpg-choices.off {
  visibility: hidden;
}

.rpg-choices button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 3px 6px;
  border: 0;
  border-radius: 0;
  color: #c2c3c7;
  background: none;
  box-shadow: none;
  font: inherit;
  font-size: 16px;
  text-align: left;
  cursor: pointer;
}

.rpg-choices i {
  font-style: normal;
  font-size: 12px;
  visibility: hidden;
}

.rpg-choices button.on {
  color: #ffec27;
}

.rpg-choices button.on i {
  visibility: visible;
  animation: rpg-nudge 0.6s steps(1) infinite;
}

.rpg-more {
  position: absolute;
  right: 14px;
  bottom: 6px;
  font-size: 12px;
  color: var(--line);
  animation: rpg-blink 0.8s steps(1) infinite;
}

.rpg-me .rpg-more {
  right: auto;
  left: 14px;
}

.rpg-shake {
  animation: rpg-shake 0.42s steps(1);
}

@keyframes rpg-blink {
  50% {
    opacity: 0;
  }
}

@keyframes rpg-nudge {
  50% {
    translate: 3px 0;
  }
}

@keyframes rpg-shake {
  0%,
  100% {
    transform: none;
  }
  15% {
    transform: translate(-5px, 2px);
  }
  30% {
    transform: translate(5px, -2px);
  }
  45% {
    transform: translate(-4px, -1px);
  }
  60% {
    transform: translate(4px, 2px);
  }
  80% {
    transform: translate(-2px, 0);
  }
}

@container (max-width: 460px) {
  .rpg-box {
    gap: 10px;
    min-height: 96px;
    padding: 12px 14px 16px 12px;
  }

  .rpg-face {
    width: 60px;
    height: 60px;
  }

  .rpg-face img {
    width: 52px;
    height: 52px;
  }

  .rpg-face span {
    font-size: 34px;
  }

  .rpg-text {
    font-size: 15px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rpg-shake,
  .rpg-more,
  .rpg-choices button.on i {
    animation: none;
  }
}
</style>
