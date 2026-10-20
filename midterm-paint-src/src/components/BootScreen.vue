<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { sfx } from '../sound.js'

const props = defineProps({ meta: Object })
const emit = defineEmits(['done'])

const COVER = new URL('../assets/cover.webp', import.meta.url).href
const SHEET = new URL('../assets/prologue.webp', import.meta.url).href

// 프롤로그 한 장(prologue.webp) 위의 칸 위치. 모두 그림 크기에 대한 비율 [x, y, w, h]
const PANELS = [
  [0.02, 0.012, 0.963, 0.152],
  [0.02, 0.177, 0.305, 0.203],
  [0.333, 0.177, 0.65, 0.203],
  [0.02, 0.38, 0.963, 0.155],
  [0.02, 0.533, 0.31, 0.172],
  [0.347, 0.543, 0.636, 0.162],
  [0.02, 0.717, 0.963, 0.271],
]

// 카메라가 한 칸씩 따라간다. focus는 세로 화면에서 더 당겨 볼 곳
// say: 그림 속 빈 말풍선에 쓰는 대사, bub: 새로 띄우는 말풍선, cap: 해설 상자, sfx: 효과음 글씨, sign: 간판에 쓰인 글씨
const SHOTS = [
  {
    panel: 0,
    focus: [0.52, 0.012, 0.465, 0.152],
    lines: [{ k: 'say', at: [0.787, 0.022, 0.186, 0.064], t: "과제는\n'우리 동네 관찰'.", fs: 20 }],
  },
  {
    panel: 0,
    focus: [0.02, 0.012, 0.47, 0.152],
    lines: [{ k: 'sfx', at: [0.235, 0.03], t: '하아암~', fs: 34, r: -8 }],
  },
  {
    panel: 1,
    lines: [
      { k: 'cap', at: [0.03, 0.184], t: '관찰은… 밥 먹고.', fs: 17 },
      { k: 'sfx', at: [0.03, 0.315], t: '꼬르륵', fs: 30, r: -10, snd: 'wrong' },
      { k: 'say', at: [0.197, 0.186, 0.116, 0.04], t: '점심 뭐 먹지…', fs: 15 },
    ],
  },
  {
    panel: 2,
    focus: [0.5, 0.177, 0.483, 0.203],
    lines: [{ k: 'bub', at: [0.56, 0.318], t: "'김밥' 들어간 간판만\n13,047개…?", fs: 24, tail: 'right' }],
  },
  {
    panel: 3,
    focus: [0.4, 0.38, 0.583, 0.155],
    lines: [
      { k: 'sfx', at: [0.06, 0.395], t: '우르르르르', fs: 66, r: -6, snd: 'horn' },
      { k: 'sfx', at: [0.78, 0.385], t: '으아아!', fs: 30, r: 8 },
    ],
  },
  {
    panel: 4,
    lines: [
      { k: 'sign', at: [0.14, 0.633, 0.141, 0.051], t: '반석공인중개사\n사무소', fs: 14, r: -3 },
      { k: 'bub', at: [0.04, 0.542], t: '어? 이 간판…', fs: 18, tail: 'down' },
    ],
  },
  {
    panel: 5,
    lines: [
      { k: 'sign', at: [0.395, 0.608, 0.083, 0.042], t: '반석공인\n중개사사무소', fs: 10 },
      { k: 'sign', at: [0.61, 0.617, 0.072, 0.043], t: '반석공인\n중개사사무소', fs: 9 },
      { k: 'sign', at: [0.813, 0.595, 0.084, 0.054], t: '반석공인\n중개사사무소', fs: 10 },
      { k: 'cap', at: [0.5, 0.551], t: '산에도, 바다에도, 도시에도', fs: 16 },
      { k: 'sfx', at: [0.5, 0.66], t: '전국에… 51개?!', fs: 44, r: -3, snd: 'bell' },
    ],
  },
  {
    panel: 6,
    focus: [0.3, 0.717, 0.683, 0.271],
    lines: [{ k: 'say', at: [0.52, 0.745, 0.42, 0.15], t: '그래서 간판 일기를\n쓰기로 했다.\n너네 동네에도 있을걸?', fs: 34 }],
  },
]
const LAST = SHOTS.length

// cover: 표지에 제목을 쓰는 중 → ready: 눌러서 펼치기 → comic: 칸마다 카메라가 따라감 → end: 한 장 전체 + 다음 장으로
const phase = ref('cover')
const written = ref(0)
const shot = ref(-1)
const opening = ref(false)
const closing = ref(false)
const shaking = ref(false)

const timers = []
const later = (ms, fn) => timers.push(setTimeout(fn, ms))

// 표지 글씨는 다 써질 때까지 넘길 수 없다
function writeCover() {
  const parts = [0, 1, 2, 3]
  parts.forEach((i) => later(350 + i * 650, () => {
    written.value = i + 1
    sfx.scratch(3, 0, 0.08, 2600 + i * 300)
  }))
  later(350 + parts.length * 650 + 200, () => (phase.value = 'ready'))
}

// 한 컷 안에서만 쓰는 타이머(누르면 지우고 바로 다음 컷으로)
let shotTimers = []
const shotLater = (ms, fn) => shotTimers.push(setTimeout(fn, ms))
const clearShot = () => { shotTimers.forEach(clearTimeout); shotTimers = [] }

// 글자는 시각(clock)으로 센다. starts[i]부터 한 글자에 TYPE ms
const TYPE = 55
const clock = ref(0)
const starts = ref([])
let raf = 0
function tick() {
  clock.value = performance.now()
  raf = requestAnimationFrame(tick)
}

const lines = computed(() =>
  SHOTS.flatMap((s, si) => s.lines.map((l, li) => ({ ...l, key: `${si}-${li}`, si }))),
)

function shown(l) {
  if (l.si < shot.value) return l.t
  if (l.si > shot.value) return ''
  const st = starts.value[l.key]
  if (st == null) return ''
  if (l.k !== 'say' && l.k !== 'bub' && l.k !== 'cap') return l.t
  return l.t.slice(0, Math.max(0, Math.floor((clock.value - st) / TYPE)))
}

const typing = () => {
  if (shot.value < 0 || shot.value >= LAST) return false
  return SHOTS[shot.value].lines.some((l, li) => shown({ ...l, key: `${shot.value}-${li}`, si: shot.value }).length < l.t.length)
}

// 칸 가림막: 아직 오지 않은 칸은 종이로 덮어 둔다
const revealed = computed(() => (shot.value >= LAST ? PANELS.length : shot.value < 0 ? 0 : SHOTS[shot.value].panel + 1))

function start(key, l) {
  starts.value = { ...starts.value, [key]: performance.now() }
  if (l.k === 'sfx') {
    // 같은 애니메이션을 다시 걸려면 한 프레임 껐다 켠다
    shaking.value = false
    requestAnimationFrame(() => (shaking.value = true))
    shotLater(450, () => (shaking.value = false))
    if (l.snd) sfx[l.snd]()
    else sfx.scratch(2, 0, 0.06, 2400)
  } else if (l.k !== 'sign') sfx.scratch(1, 0, 0.05, 3200)
}

function enter(i) {
  clearShot()
  shot.value = i
  if (i >= LAST) {
    phase.value = 'end'
    return
  }
  let t = 820
  SHOTS[i].lines.forEach((l, li) => {
    shotLater(t, () => start(`${i}-${li}`, l))
    t += l.k === 'sign' ? 150 : l.k === 'sfx' ? 650 : l.t.length * TYPE + 450
  })
  shotLater(t + 1100, () => enter(i + 1))
}

function finishShot() {
  clearShot()
  const i = shot.value
  const now = -1e9
  const next = { ...starts.value }
  SHOTS[i].lines.forEach((_, li) => (next[`${i}-${li}`] ??= now))
  starts.value = next
  shotLater(1600, () => enter(i + 1))
}

function playComic() {
  phase.value = 'comic'
  tick()
  enter(0)
}

function skip() {
  clearShot()
  sfx.flip()
  enter(LAST)
}

function press() {
  if (phase.value === 'ready') {
    opening.value = true
    sfx.flip()
    later(650, playComic)
  } else if (phase.value === 'comic') {
    // 글씨가 쓰이는 중이면 마저 쓰고, 다 쓰였으면 다음 칸으로
    if (typing()) finishShot()
    else enter(shot.value + 1)
  } else if (phase.value === 'end' && !closing.value) {
    closing.value = true
    sfx.flip()
    later(520, () => {
      sfx.startup()
      emit('done')
    })
  }
}

// 화면 크기에 맞춰 카메라 위치를 다시 잰다
const BASE = 1000
const RATIO = 1448 / 1086
const view = ref({ w: window.innerWidth, h: window.innerHeight })
const onResize = () => (view.value = { w: window.innerWidth, h: window.innerHeight })

const camera = computed(() => {
  const { w, h } = view.value
  const narrow = w / h < 1.1
  let box = [0, 0, 1, 1]
  if (shot.value >= 0 && shot.value < LAST) {
    const s = SHOTS[shot.value]
    box = (narrow && s.focus) || PANELS[s.panel]
  }
  const bw = box[2] * BASE
  const bh = box[3] * BASE * RATIO
  const full = shot.value < 0 || shot.value >= LAST
  const scale = Math.min((w * (full ? 0.9 : 0.94)) / bw, (h * (full ? 0.86 : 0.8)) / bh)
  const cx = (box[0] + box[2] / 2) * BASE
  const cy = (box[1] + box[3] / 2) * BASE * RATIO
  return `translate(${w / 2 - cx * scale}px, ${h / 2 - cy * scale}px) scale(${scale})`
})

const pct = (v) => `${v * 100}%`
function place(l) {
  const st = { left: pct(l.at[0]), top: pct(l.at[1]), fontSize: `${l.fs}px` }
  if (l.at[2]) {
    st.width = pct(l.at[2])
    st.height = pct(l.at[3])
  }
  if (l.r) st.transform = `rotate(${l.r}deg)`
  return st
}

function key(e) {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') press()
}

onMounted(() => {
  writeCover()
  window.addEventListener('keydown', key)
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  timers.forEach(clearTimeout)
  clearShot()
  cancelAnimationFrame(raf)
  window.removeEventListener('keydown', key)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <div class="boot" :class="{ closing }" role="dialog" aria-label="간판 일기 시작" @click="press">
    <!-- 펼쳐진 첫 장: 프롤로그 한 장을 카메라가 한 칸씩 따라간다 -->
    <section v-if="phase === 'comic' || phase === 'end' || opening" class="stage" :class="{ end: phase === 'end' }">
      <div class="shaker" :class="{ shaking }">
        <div class="sheet" :style="{ transform: camera }">
          <img class="sheet-art" :src="SHEET" alt="프롤로그: 동네 관찰 과제를 받은 날, 점심을 고르다 간판에 깔리고, 전국에 51개 있는 간판을 발견했다" draggable="false" />
          <div
            v-for="(p, i) in PANELS"
            :key="`m${i}`"
            class="mask"
            :class="{ off: i < revealed }"
            :style="{ left: pct(p[0]), top: pct(p[1]), width: pct(p[2]), height: pct(p[3]) }"
          />
          <p
            v-for="l in lines"
            :key="l.key"
            class="hand"
            :class="[l.k, l.tail && `tail-${l.tail}`, { on: shown(l).length > 0 }]"
            :style="place(l)"
          >{{ shown(l) }}</p>
        </div>
      </div>
      <p class="head hand">프롤로그</p>
      <button v-if="phase === 'comic'" class="skip hand" type="button" @click.stop="skip">건너뛰기 ›</button>
      <p class="next hand" :class="{ on: phase === 'end' }">다음 장 넘기기 →</p>
    </section>

    <!-- 공책 표지: 그림(cover.webp)의 빈 줄 세 칸에 글씨만 써 넣는다 -->
    <section class="cover" :class="{ open: opening }">
      <img class="art" :src="COVER" alt="간판 일기 표지" draggable="false" />
      <p class="line hand" :class="{ on: written >= 2 }" style="top: 43.6%">과목 · UX 디자인</p>
      <p class="line hand" :class="{ on: written >= 3 }" style="top: 50%">모은 간판 · {{ props.meta ? props.meta.total.toLocaleString() : '2,772,484' }}개 (예정)</p>
      <p class="line hand" :class="{ on: written >= 4 }" style="top: 56.6%">이름 · 나</p>
      <p class="press hand" :class="{ on: phase === 'ready' }">✏️ 눌러서 펼치기</p>
    </section>
  </div>
</template>

<style scoped>
.boot {
  position: fixed;
  inset: 0;
  z-index: 20000;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 30% 20%, rgb(255 255 255 / 0.5), transparent 60%),
    var(--desk);
  perspective: 1800px;
  cursor: pointer;
  overflow: hidden;
  transition: opacity 0.5s;
}

.boot.closing .stage {
  transform: scale(0.96);
  opacity: 0;
}

.boot.closing {
  opacity: 0;
  transition-delay: 0.25s;
}

.cover {
  grid-area: 1 / 1;
  width: min(92vw, 640px, 82dvh);
  aspect-ratio: 3 / 4;
  border: 2.5px solid var(--ink);
  border-radius: 6px 16px 10px 18px / 16px 8px 18px 10px;
  box-shadow: 6px 8px 0 rgb(27 27 27 / 0.85);
  transform-origin: left center;
  transition: transform 0.65s cubic-bezier(0.5, 0, 0.3, 1), opacity 0.4s;
}

.cover {
  position: relative;
  container-type: inline-size;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  z-index: 2;
}

.art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  filter: drop-shadow(6px 8px 0 rgb(27 27 27 / 0.85));
  user-select: none;
}

.cover.open {
  transform: rotateY(-108deg);
  opacity: 0;
  pointer-events: none;
}

/* 한 줄씩 펜으로 써 내려가듯 왼쪽부터 드러난다 */
.line {
  position: absolute;
  left: 26%;
  right: 25%;
  margin: 0;
  font-size: 4.6cqw;
  line-height: 1;
  white-space: nowrap;
  clip-path: inset(0 100% 0 0);
  transition: clip-path 0.6s steps(12);
}

.line.on {
  clip-path: inset(0 0 0 0);
}

.press {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 4%;
  text-align: center;
  margin: 0;
  font-size: 24px;
  opacity: 0;
}

.press.on {
  animation: nod 1.1s ease-in-out infinite;
  opacity: 1;
}

/* 무대: 화면 전체. 종이 한 장(sheet)을 transform으로 옮겨 칸을 비춘다 */
.stage {
  position: fixed;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  transition: transform 0.5s, opacity 0.4s;
}

.shaker {
  position: absolute;
  inset: 0;
}

.shaker.shaking {
  animation: shake 0.36s steps(6);
}

.sheet {
  position: absolute;
  left: 0;
  top: 0;
  width: 1000px;
  aspect-ratio: 1086 / 1448;
  transform-origin: 0 0;
  transition: transform 0.85s cubic-bezier(0.6, 0, 0.25, 1);
  filter: drop-shadow(6px 8px 0 rgb(27 27 27 / 0.55));
}

.sheet-art {
  display: block;
  width: 100%;
  height: 100%;
  user-select: none;
}

/* 아직 안 온 칸은 종이로 덮어 둔다 */
.mask {
  position: absolute;
  background: #fbf8ef;
  transition: opacity 0.5s 0.35s;
}

.mask.off {
  opacity: 0;
}

.sheet p {
  position: absolute;
  margin: 0;
  white-space: pre-line;
  line-height: 1.12;
  font-weight: 700;
  color: var(--ink);
  pointer-events: none;
}

/* 그림 속 빈 말풍선 안에 쓰는 대사 */
.say {
  display: grid;
  place-items: center;
  text-align: center;
}

/* 새로 띄우는 말풍선과 해설 상자는 쓰기 시작할 때 나타난다 */
.bub,
.cap {
  opacity: 0;
  transform: scale(0.8);
  transform-origin: 30% 100%;
  transition: opacity 0.2s, transform 0.3s cubic-bezier(0.3, 1.6, 0.5, 1);
}

.bub.on,
.cap.on {
  opacity: 1;
  transform: none;
}

.bub {
  padding: 8px 14px;
  background: #fff;
  border: 2.5px solid var(--ink);
  border-radius: 50% 46% 48% 50% / 56% 52% 60% 50%;
  text-align: center;
}

.bub::after {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  background: #fff;
  border: solid var(--ink);
  border-width: 0 2.5px 2.5px 0;
}

.tail-right::after {
  right: 6%;
  bottom: -8px;
  transform: rotate(30deg) skewX(-20deg);
}

.tail-down::after {
  left: 50%;
  bottom: -9px;
  transform: rotate(45deg);
}

.cap {
  padding: 4px 10px;
  background: var(--hl-pale);
  border: 2px solid var(--ink);
  border-radius: var(--wob);
}

/* 효과음: 크게 툭 튀어나온다 */
.sheet .sfx {
  opacity: 0;
  white-space: nowrap;
  color: var(--hl);
  /* 펜 테두리: 글자 둘레에 먹 그림자를 빙 둘러 친다 */
  text-shadow:
    2px 0 0 var(--ink), -2px 0 0 var(--ink), 0 2px 0 var(--ink), 0 -2px 0 var(--ink),
    2px 2px 0 var(--ink), -2px -2px 0 var(--ink), 2px -2px 0 var(--ink), -2px 2px 0 var(--ink),
    5px 5px 0 var(--ink);
  letter-spacing: 0.06em;
}

.sfx.on {
  opacity: 1;
  animation: pop 0.4s cubic-bezier(0.3, 1.8, 0.5, 1);
}

/* 노란 간판에 쓰인 상호 */
.sign {
  display: grid;
  place-items: center;
  text-align: center;
  opacity: 0;
  transition: opacity 0.4s;
  letter-spacing: -0.02em;
}

.sign.on {
  opacity: 1;
}

.head {
  position: absolute;
  left: 18px;
  top: 14px;
  margin: 0;
  padding: 2px 12px;
  font-size: 22px;
  background: var(--paper);
  border: 2px solid var(--ink);
  border-radius: var(--wob);
}

.skip {
  all: unset;
  position: absolute;
  right: 18px;
  top: 14px;
  padding: 2px 14px;
  font-family: var(--hand);
  font-size: 22px;
  background: var(--paper);
  border: 2px solid var(--ink);
  border-radius: var(--wob2);
  cursor: pointer;
}

.skip:hover,
.skip:focus-visible {
  background: var(--hl-soft);
}

.next {
  position: absolute;
  right: 22px;
  bottom: 14px;
  margin: 0;
  padding: 2px 14px;
  font-size: 24px;
  background: var(--hl-soft);
  border: 2px solid var(--ink);
  border-radius: var(--wob);
  opacity: 0;
  transition: opacity 0.4s;
}

.next.on {
  opacity: 1;
  animation: nod 1.1s ease-in-out infinite;
}

@keyframes pop {
  0% {
    scale: 0.2;
  }
}

@keyframes shake {
  25% {
    transform: translate(-6px, 3px);
  }
  50% {
    transform: translate(5px, -4px);
  }
  75% {
    transform: translate(-3px, -2px);
  }
}

@keyframes nod {
  50% {
    transform: translateX(6px) rotate(-2deg);
  }
}
</style>
