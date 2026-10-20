<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, ref, shallowRef } from 'vue'
import WinFrame from './components/WinFrame.vue'
import PixelShop from './components/PixelShop.vue'
import StreetWindow from './components/StreetWindow.vue'
import HighLowWindow from './components/HighLowWindow.vue'
import TwinsWindow from './components/TwinsWindow.vue'
import FameWindow from './components/FameWindow.vue'
import BuildingWindow from './components/BuildingWindow.vue'
import MapWindow from './components/MapWindow.vue'
import OpenShopWindow from './components/OpenShopWindow.vue'
import KkeutWindow from './components/KkeutWindow.vue'
import NearbyWindow from './components/NearbyWindow.vue'
import BootScreen from './components/BootScreen.vue'

// three.js가 커서 3D 거리를 열 때만 받는다
const World3D = defineAsyncComponent(() => import('./components/World3D.vue'))
import { load } from './data.js'
import { setMuted, sfx, sound } from './sound.js'

const art = (name) => new URL(`./assets/icon-${name}.webp`, import.meta.url).href
const START_IMG = art('start')

const APPS = [
  { id: 'street', img: art('street'), title: '업종별 인기 간판', icon: '🏪', comp: StreetWindow, width: 400 },
  { id: 'highlow', img: art('highlow'), title: '어느 간판이 더 많을까?', icon: '🎲', comp: HighLowWindow, width: 380 },
  { id: 'twins', img: art('twins'), title: '똑같은 이름 가게', icon: '👯', comp: TwinsWindow, width: 420 },
  { id: 'fame', img: art('fame'), title: '간판 순위', icon: '🏆', comp: FameWindow, width: 400 },
  { id: 'map', img: art('map'), title: '간판 지도', icon: '🗺️', comp: MapWindow, width: 420 },
  { id: 'building', img: art('building'), title: '내 이름 간판 찾기', icon: '🏢', comp: BuildingWindow, width: 620 },
  { id: 'open', img: art('open'), title: '내 가게 차리기', icon: '🏗️', comp: OpenShopWindow, width: 380 },
  { id: 'kkeut', img: art('kkeut'), title: '간판 끝말잇기', icon: '🔗', comp: KkeutWindow, width: 360 },
  { id: 'near', img: art('map'), title: '우리 동네 간판', icon: '📍', comp: NearbyWindow, width: 380 },
  { id: 'world', img: art('building'), title: '3D 간판 거리', icon: '🧱', full: true },
]
const MY_KEY = 'gp-my-shops'

const windows = ref([])
const street = shallowRef([])
const meta = ref(null)
const clock = ref('')
const today = ref('')
const menuOpen = ref(false)
const muted = ref(sound.muted)
const QUICK = ['map', 'highlow', 'open']
const myShops = ref(readShops())
const booting = ref(true)
const world = ref(false)

function readShops() {
  try {
    return JSON.parse(localStorage.getItem(MY_KEY)) || []
  } catch {
    return []
  }
}

function addShop(shop) {
  myShops.value = [...myShops.value.filter((s) => s.label !== shop.label), shop].slice(-8)
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
  menuOpen.value = false
  sfx.open()
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
  const app = APPS.find((a) => a.id === id)
  const n = windows.value.length
  windows.value.push({
    ...app,
    props,
    z: ++top,
    x: Math.min(140 + n * 36, Math.max(8, window.innerWidth - app.width - 8)),
    y: 24 + n * 28,
  })
}

function close(id) {
  sfx.click()
  windows.value = windows.value.filter((w) => w.id !== id)
}

function focus(w) {
  w.z = ++top
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  sfx.click()
}

function toggleSound() {
  muted.value = !muted.value
  setMuted(muted.value)
  sfx.click()
}

const activeId = computed(() => windows.value.reduce((a, w) => (!a || w.z > a.z ? w : a), null)?.id)

function tick() {
  const d = new Date()
  const h = d.getHours()
  clock.value = `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`
  today.value = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}
tick()
const timer = setInterval(tick, 10000)
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <BootScreen v-if="booting" :meta="meta" @done="booting = false" />
  <World3D v-if="world" @close="world = false" />

  <main class="desk">
    <header class="hero">
      <h1>간판 도감</h1>
    </header>

    <nav class="icons">
      <button v-for="a in APPS" :key="a.id" class="icon" @click="open(a.id)">
        <img class="glyph" :src="a.img" alt="" width="48" height="48" />
        <span class="name">{{ a.title }}</span>
      </button>
    </nav>

    <section class="street" aria-label="업종별 가게 거리">
      <div class="shops">
        <button v-for="s in street" :key="s.key" class="shop-btn" @click="open('street', { start: s.key })">
          <PixelShop :shop="s" small />
        </button>
        <button v-for="s in myShops" :key="`my-${s.label}`" class="shop-btn mine" @click="open('open')">
          <PixelShop :shop="s" small />
          <span class="new">MY</span>
        </button>
      </div>
      <div class="sidewalk"></div>
    </section>

    <WinFrame
      v-for="w in windows"
      :key="w.id"
      :title="w.title"
      :icon="w.icon"
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
  </main>

  <div v-if="menuOpen" class="menu-scrim" @click="menuOpen = false"></div>
  <div v-if="menuOpen" class="start-menu window" role="menu">
    <div class="banner"><b>간판</b>도감 98</div>
    <ul>
      <li v-for="a in APPS" :key="a.id">
        <button role="menuitem" @click="open(a.id)">
          <img :src="a.img" alt="" width="24" height="24" />{{ a.title }}
        </button>
      </li>
      <li class="sep" aria-hidden="true"></li>
      <li>
        <button role="menuitem" @click="toggleSound">
          <span class="emo">{{ muted ? '🔇' : '🔊' }}</span>소리 {{ muted ? '켜기' : '끄기' }}
        </button>
      </li>
    </ul>
  </div>

  <footer class="taskbar">
    <button class="start" :class="{ on: menuOpen }" @click="toggleMenu">
      <img :src="START_IMG" alt="" width="20" height="20" /><b>시작</b>
    </button>
    <span class="divider" aria-hidden="true"></span>
    <div class="quick">
      <button v-for="id in QUICK" :key="id" :title="APPS.find((a) => a.id === id).title" @click="open(id)">
        <img :src="APPS.find((a) => a.id === id).img" alt="" width="18" height="18" />
      </button>
    </div>
    <span class="divider" aria-hidden="true"></span>
    <div class="tasks">
      <button
        v-for="w in windows"
        :key="w.id"
        class="task"
        :class="{ on: w.id === activeId }"
        @click="focus(w)"
      >
        <img :src="w.img" alt="" width="16" height="16" />{{ w.title }}
      </button>
    </div>
    <div class="tray">
      <button class="tray-btn" :title="muted ? '소리 켜기' : '소리 끄기'" @click="toggleSound">{{ muted ? '🔇' : '🔊' }}</button>
      <span v-if="meta" class="tray-btn data" :title="`간판 ${meta.total.toLocaleString()}개 · ${meta.date} 기준`">🪧</span>
      <span class="clock" :title="today">{{ clock }}</span>
    </div>
  </footer>
</template>

<style scoped>
.desk {
  position: relative;
  height: calc(100dvh - var(--taskbar-h));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #008080;
  image-rendering: pixelated;
}

.hero {
  flex: none;
  padding: 16px 16px 0;
  text-align: center;
}

.hero h1 {
  margin: 0;
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-size: 34px;
  color: #fff;
  text-shadow: 3px 3px 0 var(--ink), -1px -1px 0 var(--ink), 1px -1px 0 var(--ink), -1px 1px 0 var(--ink);
  letter-spacing: 2px;
}

.icons {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  align-content: start;
  gap: 6px;
  padding: 12px 16px;
}

.icon {
  all: unset;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 4px;
}

.icon .glyph {
  width: 48px;
  height: 48px;
  filter: drop-shadow(2px 2px 0 rgb(0 0 0 / 0.25));
}

.icon .name {
  max-width: 96px;
  padding: 1px 3px;
  color: #fff;
  background: rgb(29 29 43 / 0.55);
  text-align: center;
  word-break: keep-all;
}

.icon:focus-visible .name,
.icon:hover .name {
  background: #1d1d8f;
}

.street {
  flex: none;
}

.shops {
  display: flex;
  gap: 4px;
  padding: 10px 12px 0;
  overflow-x: auto;
  align-items: flex-end;
  scrollbar-width: none;
}

.shop-btn {
  all: unset;
  position: relative;
  cursor: pointer;
  transition: transform 0.15s steps(3);
}

.shop-btn:hover,
.shop-btn:focus-visible {
  transform: translateY(-4px);
}

.shop-btn:focus-visible {
  outline: 2px dashed var(--ink);
  outline-offset: 2px;
}

.new {
  position: absolute;
  top: -6px;
  right: -2px;
  padding: 1px 4px;
  font-size: 10px;
  color: #fff;
  background: var(--red);
  border: 2px solid var(--ink);
  box-shadow: 2px 2px 0 var(--ink);
}

/* 가게들이 서는 보도블록. 바로 아래가 작업 표시줄이다 */
.sidewalk {
  height: 12px;
  background:
    repeating-linear-gradient(90deg, transparent 0 23px, rgb(0 0 0 / 0.12) 23px 24px),
    #c9c3d6;
  border-top: 2px solid var(--ink);
  box-shadow: inset 0 2px #e6e1ef;
}

/* 작업 표시줄 */
.taskbar {
  position: fixed;
  inset: auto 0 0 0;
  height: var(--taskbar-h);
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 2px;
  background: silver;
  border-top: 1px solid #dfdfdf;
  box-shadow: inset 0 1px #fff;
  z-index: 10000;
}

.taskbar button {
  min-height: 0;
  height: 28px;
}

.start {
  flex: none;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px 0 4px;
}

.start.on,
.task.on {
  box-shadow: inset -1px -1px #fff, inset 1px 1px #0a0a0a, inset -2px -2px #dfdfdf, inset 2px 2px grey;
}

.start.on b {
  transform: translate(1px, 1px);
}

/* 98 작업 표시줄의 오목한 세로 홈 */
.divider {
  flex: none;
  width: 2px;
  height: 24px;
  margin: 0 2px;
  border-left: 1px solid grey;
  border-right: 1px solid #fff;
}

.quick {
  flex: none;
  display: flex;
  gap: 1px;
}

.quick button {
  min-width: 0;
  width: 26px;
  padding: 0;
  display: grid;
  place-items: center;
  box-shadow: none;
  background: transparent;
}

.quick button:hover {
  box-shadow: inset -1px -1px grey, inset 1px 1px #fff;
}

.quick button:active {
  box-shadow: inset -1px -1px #fff, inset 1px 1px grey;
}

.tasks {
  flex: 1;
  display: flex;
  gap: 3px;
  overflow-x: auto;
  min-width: 0;
  scrollbar-width: none;
}

.task {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 160px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task.on {
  background:
    repeating-conic-gradient(#fff 0 25%, #e0e0e0 0 50%) 0 0 / 2px 2px;
  font-weight: 700;
}

.tray {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 28px;
  padding: 0 6px 0 3px;
  box-shadow: inset -1px -1px #fff, inset 1px 1px grey;
}

.tray-btn {
  all: unset;
  width: 20px;
  text-align: center;
  font-size: 13px;
  cursor: pointer;
}

.tray-btn.data {
  cursor: help;
}

.clock {
  padding-left: 4px;
  white-space: nowrap;
}

/* 시작 메뉴 */
.menu-scrim {
  position: fixed;
  inset: 0;
  z-index: 10001;
}

.start-menu {
  position: fixed;
  left: 2px;
  bottom: calc(var(--taskbar-h) - 2px);
  z-index: 10002;
  display: flex;
  padding: 3px;
  min-width: 230px;
}

.banner {
  width: 26px;
  padding: 8px 0;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  color: #fff;
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-size: 15px;
  letter-spacing: 1px;
  background: linear-gradient(#e86a9a, #8fb3e6);
}

.banner b {
  color: var(--yellow);
}

.start-menu ul {
  flex: 1;
  list-style: none;
  margin: 0;
  padding: 0;
}

.start-menu li button {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 6px;
  font-size: 13px;
  cursor: pointer;
}

.start-menu li button:hover,
.start-menu li button:focus-visible {
  color: #fff;
  background: #1d1d8f;
}

.start-menu .emo {
  width: 24px;
  text-align: center;
  font-size: 16px;
}

.sep {
  height: 0;
  margin: 3px 2px;
  border-top: 1px solid grey;
  border-bottom: 1px solid #fff;
}

@media (min-width: 720px) {
  .icons {
    grid-auto-flow: column;
    grid-template-columns: none;
    grid-template-rows: repeat(auto-fill, 90px);
    grid-auto-columns: 100px;
    justify-content: start;
    gap: 4px;
  }
}

@media (max-width: 719px) {
  .hero h1 {
    font-size: 28px;
  }

  .icons {
    overflow-y: auto;
  }

  .quick,
  .quick + .divider,
  .tray-btn.data {
    display: none;
  }
}
</style>
