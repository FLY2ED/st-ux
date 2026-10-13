<script setup>
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import WinFrame from './components/WinFrame.vue'
import PixelShop from './components/PixelShop.vue'
import StreetWindow from './components/StreetWindow.vue'
import HighLowWindow from './components/HighLowWindow.vue'
import TwinsWindow from './components/TwinsWindow.vue'
import FameWindow from './components/FameWindow.vue'
import BuildingWindow from './components/BuildingWindow.vue'
import MapWindow from './components/MapWindow.vue'
import OpenShopWindow from './components/OpenShopWindow.vue'
import { load } from './data.js'
import { sfx } from './sound.js'

const APPS = [
  { id: 'street', title: '간판 거리', icon: '🏪', comp: StreetWindow, width: 400 },
  { id: 'highlow', title: '하이로우', icon: '🎲', comp: HighLowWindow, width: 380 },
  { id: 'twins', title: '쌍둥이 간판', icon: '👯', comp: TwinsWindow, width: 420 },
  { id: 'fame', title: '명예의 전당', icon: '🏆', comp: FameWindow, width: 400 },
  { id: 'map', title: '간판 지도', icon: '🗺️', comp: MapWindow, width: 420 },
  { id: 'building', title: '내 이름 빌딩', icon: '🏢', comp: BuildingWindow, width: 380 },
  { id: 'open', title: '내 가게 차리기', icon: '🏗️', comp: OpenShopWindow, width: 380 },
]
const MY_KEY = 'gp-my-shops'

const windows = ref([])
const street = shallowRef([])
const meta = ref(null)
const clock = ref('')
const myShops = ref(readShops())

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
  sfx.open()
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

const activeId = computed(() => windows.value.reduce((a, w) => (!a || w.z > a.z ? w : a), null)?.id)

function tick() {
  const d = new Date()
  clock.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
tick()
const timer = setInterval(tick, 10000)
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <main class="desk">
    <header class="hero">
      <h1>간판 도감</h1>
      <p v-if="meta">전국 간판 {{ meta.total.toLocaleString() }}개를 다 읽어 봤습니다</p>
    </header>

    <section class="street" aria-label="간판 거리">
      <div class="shops">
        <button v-for="s in street" :key="s.key" class="shop-btn" @click="open('street', { start: s.key })">
          <PixelShop :shop="s" small />
        </button>
        <button v-for="s in myShops" :key="`my-${s.label}`" class="shop-btn mine" @click="open('open')">
          <PixelShop :shop="s" small />
          <span class="new">MY</span>
        </button>
      </div>
      <div class="road"></div>
    </section>

    <nav class="icons">
      <button v-for="a in APPS" :key="a.id" class="icon" @click="open(a.id)">
        <span class="glyph">{{ a.icon }}</span>
        <span class="name">{{ a.title }}</span>
      </button>
    </nav>

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

  <footer class="taskbar">
    <button class="start" @click="open('fame')"><b>🪧 시작</b></button>
    <div class="tasks">
      <button
        v-for="w in windows"
        :key="w.id"
        class="task"
        :class="{ on: w.id === activeId }"
        @click="focus(w)"
      >
        {{ w.icon }} {{ w.title }}
      </button>
    </div>
    <div class="tray status-bar-field">{{ clock }}</div>
  </footer>
</template>

<style scoped>
.desk {
  position: relative;
  height: calc(100dvh - var(--taskbar-h));
  overflow: hidden;
  background-color: var(--desk);
  background-image: radial-gradient(var(--desk-dot) 1px, transparent 1px);
  background-size: 8px 8px;
}

.hero {
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

.hero p {
  margin: 6px 0 0;
}

.street {
  margin-top: 14px;
}

.shops {
  display: flex;
  gap: 8px;
  padding: 0 16px;
  overflow-x: auto;
  align-items: flex-end;
  scrollbar-width: none;
}

.shop-btn {
  all: unset;
  cursor: pointer;
  transition: transform 0.15s steps(3);
}

.shop-btn:hover,
.shop-btn:focus-visible {
  transform: translateY(-4px);
}

.mine {
  position: relative;
}

.new {
  position: absolute;
  top: -8px;
  right: -6px;
  padding: 1px 4px;
  font-size: 10px;
  color: #fff;
  background: var(--red);
  border: 2px solid var(--ink);
}

.shop-btn:focus-visible {
  outline: 2px dashed var(--ink);
  outline-offset: 2px;
}

.road {
  height: 16px;
  background: repeating-linear-gradient(90deg, #6d6d80 0 20px, #fff 20px 34px) 0 6px / 100% 3px no-repeat, #6d6d80;
  border-top: 3px solid var(--ink);
}

.icons {
  display: grid;
  grid-template-columns: repeat(auto-fill, 84px);
  gap: 10px;
  padding: 16px;
  justify-content: center;
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
  font-size: 32px;
  filter: drop-shadow(2px 2px 0 rgb(0 0 0 / 0.25));
}

.icon .name {
  padding: 1px 3px;
  color: #fff;
  background: rgb(29 29 43 / 0.55);
  text-align: center;
}

.icon:focus-visible .name,
.icon:hover .name {
  background: #1d1d8f;
}

.taskbar {
  position: fixed;
  inset: auto 0 0 0;
  height: var(--taskbar-h);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  background: silver;
  box-shadow: inset 0 1px #fff, inset 0 2px #dfdfdf;
  z-index: 10000;
}

.start {
  flex: none;
  min-width: 0;
  padding: 0 8px;
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
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task.on {
  box-shadow: inset -1px -1px #fff, inset 1px 1px #0a0a0a, inset -2px -2px #dfdfdf, inset 2px 2px grey;
  background: #e8e8e8;
}

.tray {
  flex: none;
  padding: 4px 8px;
}

@media (min-width: 720px) {
  .icons {
    grid-template-columns: 84px;
    justify-content: start;
  }
}

@media (max-width: 719px) {
  .hero h1 {
    font-size: 28px;
  }

  .icons {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
