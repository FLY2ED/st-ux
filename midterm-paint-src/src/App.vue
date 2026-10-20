<script setup>
import { computed, defineAsyncComponent, ref, shallowRef } from 'vue'
import WinFrame from './components/WinFrame.vue'
import BuildingWindow from './components/BuildingWindow.vue'
import OpenShopWindow from './components/OpenShopWindow.vue'
import NearbyWindow from './components/NearbyWindow.vue'
import RainWindow from './components/RainWindow.vue'
import ScratchWindow from './components/ScratchWindow.vue'
import DodgeWindow from './components/DodgeWindow.vue'
import BoothWindow from './components/BoothWindow.vue'
import SongWindow from './components/SongWindow.vue'
import BootScreen from './components/BootScreen.vue'

// three.js가 커서 3D 거리를 열 때만 받는다
const World3D = defineAsyncComponent(() => import('./components/World3D.vue'))
import { load } from './data.js'
import { react } from './mood.js'
import { setMuted, sfx, sound } from './sound.js'

const game = (name) => new URL(`./assets/game-${name}.webp`, import.meta.url).href
const HOME = new URL('./assets/home.webp', import.meta.url).href

// 펼친 일기장 위에 붙인 스티커들. x, y 는 home.webp 기준 % 위치
const APPS = [
  { id: 'rain', title: '간판 산성비', comp: RainWindow, width: 560, x: 9, y: 44, tilt: -4, say: '간판이 비처럼 쏟아진다! 빨리 쳐!', face: 'panic' },
  { id: 'dodge', title: '점심 간판 피하기', comp: DodgeWindow, width: 560, x: 9, y: 63, tilt: 3, say: '오늘 점심 뭐 먹었더라…', face: 'think' },
  { id: 'scratch', title: '간판 복권', comp: ScratchWindow, width: 520, x: 9, y: 82, tilt: -2, say: '전국에 하나뿐인 간판, 나와라!', face: 'happy' },
  { id: 'near', title: '우리 동네 간판', comp: NearbyWindow, width: 400, x: 23, y: 84, tilt: 2, say: '우리 집 앞엔 무슨 간판이 있지?', face: 'think' },
  { id: 'open', title: '내 가게 차리기', comp: OpenShopWindow, width: 400, x: 34, y: 86, tilt: -3, say: '내 가게 간판은 내가 짓는다!', face: 'proud' },
  { id: 'building', title: '내 이름 간판', comp: BuildingWindow, width: 620, x: 67, y: 86, tilt: 3, say: '내 이름이 들어간 간판도 있을까…?', face: 'think' },
  { id: 'song', title: '간판 노래방', comp: SongWindow, width: 600, x: 90, y: 32, tilt: 3, say: '간판 이름으로 노래를 불러 보자!', face: 'proud' },
  { id: 'booth', title: '간판 네컷', comp: BoothWindow, width: 540, x: 90, y: 55, tilt: -3, say: '내 머리 위에 간판을 달고 찰칵!', face: 'happy' },
  { id: 'world', title: '3D 간판 거리', full: true, x: 90, y: 79, tilt: 2, say: '불 꺼진 간판을 칠하러 가자!', face: 'proud' },
]
const app = (id) => APPS.find((a) => a.id === id)
const NEW = new Set(['rain', 'dodge', 'scratch', 'song', 'booth'])

// home.webp 의 빈 간판 다섯 칸 [왼쪽, 위, 폭, 높이] %
const SIGN_SLOTS = [
  [23.2, 38.9, 8.6, 6.0],
  [34.2, 38.4, 9.0, 6.2],
  [45.8, 38.4, 9.0, 6.0],
  [57.5, 38.0, 9.0, 6.0],
  [68.9, 39.6, 8.9, 6.0],
]
const GREET = '오늘은 무슨 간판을 만날까?'
const MY_KEY = 'gp-my-shops'

const windows = ref([])
const street = shallowRef([])
const meta = ref(null)
const muted = ref(sound.muted)
const myShops = ref(readShops())
const booting = ref(true)
const world = ref(false)
const say = ref(GREET)
const page = ref(0)

// 업종별 인기 간판에서 짧은 이름만 골라 거리에 단다. 내가 차린 가게가 있으면 노란 간판 자리에
const pool = computed(() =>
  street.value.flatMap((s) => s.top.filter(([n]) => n.length <= 6).map(([name, count]) => ({ name, count, kind: s.label }))),
)
const signs = computed(() => {
  const all = pool.value
  if (!all.length) return []
  const mine = myShops.value.map((s) => ({ name: s.label, mine: true }))
  return SIGN_SLOTS.map((slot, i) => {
    if (i === 1 && mine.length) return { slot, ...mine[page.value % mine.length] }
    return { slot, ...all[(page.value * 7 + i * 13) % all.length] }
  })
})

const now = new Date()
const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const dateText = `${now.getMonth() + 1}월 ${now.getDate()}일 ${DAYS[now.getDay()]}요일 · ${now.getHours() >= 6 && now.getHours() < 18 ? '맑음(아마도)' : '밤'}`

function readShops() {
  try {
    return JSON.parse(localStorage.getItem(MY_KEY)) || []
  } catch {
    return []
  }
}

function addShop(shop) {
  myShops.value = [...myShops.value.filter((s) => s.label !== shop.label), shop].slice(-4)
  react('proud')
  try {
    localStorage.setItem(MY_KEY, JSON.stringify(myShops.value))
  } catch {
    // 저장이 막힌 브라우저면 이번 방문 동안만 보인다
  }
}
let top = 10

load('street.json').then((v) => (street.value = v))
load('meta.json').then((v) => (meta.value = v))

function open(id, props = {}) {
  sfx.open()
  const a = app(id)
  say.value = a.say
  react(a.face, 2200)
  if (id === 'world') {
    world.value = true
    return
  }
  const found = windows.value.find((w) => w.id === id)
  if (found) {
    found.props = props
    found.z = ++top
    return
  }
  const n = windows.value.length
  const wide = window.innerWidth
  windows.value.push({
    ...a,
    props,
    z: ++top,
    x: Math.min(Math.max(8, wide / 2 - a.width / 2 + (n % 4) * 34 - 40), Math.max(8, wide - a.width - 8)),
    y: 30 + (n % 4) * 26,
  })
}

function close(id) {
  sfx.click()
  windows.value = windows.value.filter((w) => w.id !== id)
  say.value = GREET
}

function focus(w) {
  w.z = ++top
}

function hover(id) {
  say.value = id ? app(id).say : GREET
}

function poke(s) {
  sfx.tick()
  if (s.mine) {
    say.value = `내가 차린 '${s.name}'! 장사 잘 되나?`
    react('proud')
  } else {
    say.value = `'${s.name}' 간판은 ${s.kind} 중에 전국 ${s.count}곳!`
    react('shock')
  }
}

function toggleSound() {
  muted.value = !muted.value
  setMuted(muted.value)
  sfx.click()
}

function nextStreet() {
  page.value++
  sfx.flip()
}

function replay() {
  windows.value = []
  booting.value = true
}

const activeId = computed(() => windows.value.reduce((a, w) => (!a || w.z > a.z ? w : a), null)?.id)
</script>

<template>
  <!-- 선이 떨리는 손그림 효과에 쓰는 필터 세 장 -->
  <svg width="0" height="0" style="position: absolute" aria-hidden="true">
    <filter id="boil-a"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="1" /><feDisplacementMap in="SourceGraphic" scale="2.2" /></filter>
    <filter id="boil-b"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="7" /><feDisplacementMap in="SourceGraphic" scale="2.2" /></filter>
    <filter id="boil-c"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="13" /><feDisplacementMap in="SourceGraphic" scale="2.2" /></filter>
  </svg>

  <BootScreen v-if="booting" :meta="meta" @done="booting = false" />
  <World3D v-if="world" @close="world = false" />

  <main class="desk">
    <div class="spread">
      <img class="bg" :src="HOME" alt="간판 일기: 동네 가게 앞에서 손을 흔드는 나" draggable="false" />

      <p class="date hand">{{ dateText }}</p>
      <p class="lead">전국 <b>{{ meta ? meta.total.toLocaleString() : '2,772,484' }}</b>개 간판을 주워 담는 나의 그림일기</p>

      <div class="tools">
        <button class="mini" :title="muted ? '소리 켜기' : '소리 끄기'" @click="toggleSound">{{ muted ? '🔇' : '🔊' }}</button>
        <button class="mini hand" @click="replay">프롤로그</button>
      </div>

      <button
        v-for="(s, i) in signs"
        :key="`${page}-${i}`"
        class="sign hand"
        :class="{ mine: s.mine }"
        :style="{ left: `${s.slot[0]}%`, top: `${s.slot[1]}%`, width: `${s.slot[2]}%`, height: `${s.slot[3]}%` }"
        :title="s.name"
        @click="poke(s)"
      >
        <span>{{ s.name }}</span>
      </button>
      <button class="turn hand" @click="nextStreet">옆 골목 →</button>

      <p class="bubble hand" aria-live="polite"><span :key="say">{{ say }}</span></p>

      <nav class="stickers" aria-label="놀거리">
        <button
          v-for="a in APPS"
          :key="a.id"
          class="sticker"
          :style="{ '--x': `${a.x}%`, '--y': `${a.y}%`, '--r': `${a.tilt}deg` }"
          @click="open(a.id)"
          @mouseenter="hover(a.id)"
          @mouseleave="hover()"
          @focus="hover(a.id)"
          @blur="hover()"
        >
          <img :src="game(a.id)" alt="" draggable="false" />
          <span class="hand">{{ a.title }}</span>
          <i v-if="NEW.has(a.id)" class="new hand">NEW</i>
        </button>
      </nav>
    </div>

    <WinFrame
      v-for="w in windows"
      :key="w.id"
      :title="w.title"
      :x="w.x"
      :y="w.y"
      :z="w.z"
      :width="w.width"
      :active="w.id === activeId"
      @close="close(w.id)"
      @focus="focus(w)"
    >
      <component
        :is="w.comp"
        v-bind="w.props"
        :my-shops="w.id === 'open' ? myShops : undefined"
        @open="open"
        @opened="addShop"
      />
    </WinFrame>

    <!-- 열린 종이들은 공책 옆에 붙인 인덱스 스티커로 -->
    <nav v-if="windows.length" class="tabs" aria-label="열린 페이지">
      <button
        v-for="w in windows"
        :key="w.id"
        class="tab hand"
        :class="{ on: w.id === activeId }"
        @click="focus(w)"
      >
        {{ w.title }}
      </button>
    </nav>
  </main>
</template>

<style scoped>
.desk {
  position: relative;
  height: 100dvh;
  display: grid;
  place-items: center;
  padding: 10px;
  overflow: hidden;
  background:
    radial-gradient(circle at 20% 10%, rgb(255 255 255 / 0.55), transparent 55%),
    var(--desk);
}

/* 그림 한 장(home.webp)을 화면에 맞춰 놓고, 그 위에 글자와 스티커만 얹는다 */
.spread {
  position: relative;
  width: min(100%, calc((100dvh - 20px) * 1672 / 941));
  aspect-ratio: 1672 / 941;
  container-type: inline-size;
  box-shadow: 6px 8px 0 rgb(27 27 27 / 0.75);
}

.bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  user-select: none;
}

.date {
  position: absolute;
  left: 10.5%;
  top: 25.5%;
  margin: 0;
  font-size: 1.45cqw;
}

.lead {
  position: absolute;
  left: 10.5%;
  top: 29.2%;
  margin: 0;
  font-size: 0.95cqw;
  color: var(--ink-soft);
}

.tools {
  position: absolute;
  right: 3.6%;
  top: 4.2%;
  display: flex;
  gap: 0.5cqw;
}

.mini {
  min-height: 0;
  padding: 0.2cqw 0.8cqw;
  font-size: 1.05cqw;
  box-shadow: 1px 2px 0 var(--ink);
}

.sign {
  all: unset;
  position: absolute;
  display: grid;
  place-items: center;
  font-family: var(--hand);
  font-size: 1.7cqw;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  animation: write 0.5s steps(8) both;
}

.sign span {
  max-width: 94%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sign:hover span,
.sign:focus-visible span {
  background: linear-gradient(transparent 50%, var(--hl) 50% 92%, transparent 92%);
}

.sign.mine span {
  text-decoration: underline wavy;
}

.turn {
  position: absolute;
  left: 79.5%;
  top: 56%;
  min-height: 0;
  padding: 0.2cqw 0.8cqw;
  font-size: 1.05cqw;
  box-shadow: 1px 2px 0 var(--ink);
}

/* 그림 속 빈 말풍선 */
.bubble {
  position: absolute;
  left: 55.6%;
  top: 62.8%;
  width: 11%;
  height: 11%;
  margin: 0;
  display: grid;
  place-items: center;
  text-align: center;
  font-size: 1.22cqw;
  line-height: 1.2;
  word-break: keep-all;
}

.bubble span {
  animation: pop 0.3s cubic-bezier(0.3, 1.6, 0.5, 1);
}

.sticker {
  all: unset;
  font-family: var(--hand);
  position: absolute;
  left: var(--x);
  top: var(--y);
  width: 10.5cqw;
  display: grid;
  justify-items: center;
  gap: 0.2cqw;
  transform: translate(-50%, -50%) rotate(var(--r));
  cursor: pointer;
  transition: transform 0.15s;
}

.sticker img {
  width: 7.4cqw;
  height: 6.2cqw;
  object-fit: contain;
  filter: drop-shadow(0.15cqw 0.2cqw 0 rgb(27 27 27 / 0.25));
}

.sticker span {
  font-size: 1.25cqw;
  line-height: 1.1;
  white-space: nowrap;
}

.sticker:hover,
.sticker:focus-visible {
  transform: translate(-50%, -54%) rotate(0deg) scale(1.08);
}

.sticker:hover img,
.sticker:focus-visible img {
  animation: boil 0.36s steps(1) infinite;
}

.sticker:hover span,
.sticker:focus-visible span {
  background: linear-gradient(transparent 50%, var(--hl) 50% 92%, transparent 92%);
}

.new {
  position: absolute;
  right: 0.6cqw;
  top: -0.2cqw;
  padding: 0 0.4cqw;
  font-size: 0.85cqw;
  font-style: normal;
  background: var(--hl);
  border: 1.5px solid var(--ink);
  border-radius: 0.6cqw;
  transform: rotate(8deg);
}

/* 오른쪽 가장자리 인덱스 스티커 */
.tabs {
  position: absolute;
  top: 120px;
  right: 2px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 9000;
}

.tab {
  max-width: 150px;
  min-height: 0;
  padding: 6px 10px;
  font-size: 15px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: 10px 4px 4px 10px;
  box-shadow: 1px 2px 0 var(--ink);
  background: var(--hl-pale);
}

.tab.on {
  background: var(--hl);
  transform: translateX(-8px);
}

@keyframes pop {
  from {
    transform: scale(0.6);
    opacity: 0;
  }
}

@keyframes write {
  from {
    clip-path: inset(0 100% 0 0);
  }
  to {
    clip-path: inset(0 0 0 0);
  }
}

/* 좁은 화면: 그림은 위에 배너처럼, 스티커는 아래에 줄지어 */
@media (max-width: 760px) {
  .desk {
    display: block;
    padding: 6px;
    overflow: auto;
  }

  .spread {
    width: 100%;
    box-shadow: 3px 4px 0 rgb(27 27 27 / 0.75);
  }

  .lead,
  .turn {
    display: none;
  }

  .tools {
    top: 2%;
  }

  .mini {
    font-size: 11px;
    padding: 1px 6px;
  }

  .sign {
    font-size: 2.2cqw;
  }

  .bubble {
    font-size: 1.9cqw;
    width: 14%;
    left: 54.5%;
  }

  .date {
    font-size: 2.2cqw;
  }

  .stickers {
    position: absolute;
    top: calc(100% + 10px);
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px 4px;
    padding-bottom: 16px;
  }

  .sticker {
    position: relative;
    left: auto;
    top: auto;
    width: auto;
    transform: rotate(var(--r));
  }

  .sticker img {
    width: 76px;
    height: 64px;
  }

  .sticker span {
    font-size: 15px;
  }

  .new {
    font-size: 10px;
    right: 8px;
  }

  .tabs {
    position: fixed;
    top: auto;
    bottom: 8px;
    right: 8px;
  }
}
</style>
