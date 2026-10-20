<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { sfx } from '../sound.js'

const props = defineProps({ meta: Object })
const emit = defineEmits(['done'])

const COVER = new URL('../assets/cover.webp', import.meta.url).href
const PAPER = new URL('../assets/paper-page.webp', import.meta.url).href
const CUTS = [1, 2, 3, 4].map((i) => new URL(`../assets/intro-${i}.webp`, import.meta.url).href)

// cover: 표지에 제목을 쓰는 중 → ready: 눌러서 펼치기 → comic: 4컷이 한 컷씩 → end: 다음 장으로
const phase = ref('cover')
const written = ref(0)
const cuts = ref(0)
const opening = ref(false)
const closing = ref(false)

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

function nextCut() {
  if (cuts.value >= CUTS.length) return
  cuts.value++
  sfx.scratch(2, 0, 0.07, 3000)
  if (cuts.value === CUTS.length) later(900, () => (phase.value = 'end'))
}

let auto
function playComic() {
  phase.value = 'comic'
  later(500, nextCut)
  auto = setInterval(() => (cuts.value >= CUTS.length ? clearInterval(auto) : nextCut()), 1500)
}

function press() {
  if (phase.value === 'ready') {
    opening.value = true
    sfx.flip()
    later(650, playComic)
  } else if (phase.value === 'comic') {
    // 누르면 다음 컷을 바로 그린다
    clearInterval(auto)
    nextCut()
    auto = setInterval(() => (cuts.value >= CUTS.length ? clearInterval(auto) : nextCut()), 1500)
  } else if (phase.value === 'end' && !closing.value) {
    closing.value = true
    sfx.flip()
    later(520, () => {
      sfx.startup()
      emit('done')
    })
  }
}

function key(e) {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') press()
}

onMounted(() => {
  writeCover()
  window.addEventListener('keydown', key)
})

onBeforeUnmount(() => {
  timers.forEach(clearTimeout)
  clearInterval(auto)
  window.removeEventListener('keydown', key)
})
</script>

<template>
  <div class="boot" :class="{ closing }" role="dialog" aria-label="간판 일기 시작" @click="press">
    <!-- 펼쳐진 첫 장: 프롤로그 4컷 -->
    <section v-if="phase === 'comic' || phase === 'end' || opening" class="page" :style="{ backgroundImage: `url(${PAPER})` }">
      <p class="head hand">프롤로그 · 그래서 간판을 모으기로 했다</p>
      <div class="cuts">
        <figure v-for="(src, i) in CUTS" :key="src" class="cut" :class="{ on: i < cuts }">
          <img :src="src" :alt="`프롤로그 ${i + 1}컷`" draggable="false" />
        </figure>
      </div>
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

.boot.closing .page {
  transform: rotateY(-100deg);
  opacity: 0;
}

.boot.closing {
  opacity: 0;
  transition-delay: 0.25s;
}

.cover,
.page {
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

.page {
  background: center / 100% 100% no-repeat;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  filter: drop-shadow(6px 8px 0 rgb(27 27 27 / 0.6));
  display: flex;
  flex-direction: column;
  padding: 9% 8% 7%;
  z-index: 1;
}

.head {
  margin: 0 0 3%;
  font-size: clamp(18px, 3.4vw, 24px);
}

.cuts {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 2.5%;
}

.cut {
  margin: 0;
  min-height: 0;
  opacity: 0;
  transform: scale(0.92) rotate(-1.5deg);
  transition: opacity 0.35s, transform 0.45s cubic-bezier(0.3, 1.6, 0.5, 1);
}

.cut:nth-child(even) {
  transform: scale(0.92) rotate(1.5deg);
}

.cut.on {
  opacity: 1;
  transform: none;
}

.cut img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #fff;
}

.next {
  align-self: flex-end;
  margin: 3% 0 0;
  font-size: 24px;
  opacity: 0;
  transition: opacity 0.4s;
}

.next.on {
  opacity: 1;
  animation: nod 1.1s ease-in-out infinite;
}

@keyframes nod {
  50% {
    transform: translateX(6px) rotate(-2deg);
  }
}
</style>
