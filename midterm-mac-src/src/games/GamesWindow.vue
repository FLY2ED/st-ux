<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { BookOpen, Check, Crown, House, Lock, Play, Trophy } from 'lucide-vue-next'
import { appOf } from '../apps.js'
import { board, boards, player } from '../arcade.js'
import { BOSSES, CHAPTERS, readCleared } from '../world/story.js'
import Glass from './Glass.vue'

// macOS 26 '게임' 앱 모양을 빌린 간판 수리공 기록장. 미니게임은 이야기 속 퀘스트가 되었으니
// 여기서는 이야기 진행(gp-story-now·gp-3d-story), 보스, 모은 간판 수(gp-3d-dex), 지은 가게(gp-myshop), 퀘스트 기록을 모아 보여 준다
const emit = defineEmits(['open'])

const fmt = (n) => Number(n || 0).toLocaleString('ko-KR')
const npcArt = (n) => new URL(`../assets/npc/${n}.png`, import.meta.url).href
const STREET = appOf('street')

// 퀘스트마다 기록 단위와 이 기기에 남는 최고 기록 키
const QUEST = {
  rain: { unit: '점', best: 'gp-rain-best' },
  scratch: { unit: '점', best: 'gp-clean-best' },
  more: { unit: '연승', best: 'gp-more-best' },
  dodge: { unit: '점' },
  booth: { unit: '' },
  type: { unit: '타', best: 'gp-type-best' },
  guess: { unit: '점' },
  map: { unit: '곳' },
}

// 이야기 순서대로 늘어놓은 퀘스트: 몇 장 몇 번째 가게에서 하는지, 보스전인지
const QUESTS = CHAPTERS.flatMap((ch, n) =>
  ch.steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.game || s.boss)
    .map(({ s, i }) => {
      const id = s.boss ? BOSSES[s.boss].game : s.game
      return { key: `${ch.id}-${i}`, id, n, step: i, boss: s.boss || '', title: appOf(id)?.title || '간판 지도', app: appOf(id) }
    }),
)

const BOSS_LIST = Object.entries(BOSSES).map(([id, b]) => {
  const n = CHAPTERS.findIndex((ch) => ch.steps.some((s) => s.boss === id))
  return { id, ...b, n, step: CHAPTERS[n].steps.findIndex((s) => s.boss === id) }
})

const tab = ref('home')
const TABS = [
  { id: 'home', label: '홈', icon: House },
  { id: 'story', label: '이야기', icon: BookOpen },
  { id: 'records', label: '기록', icon: Trophy },
]

const readJson = (k, fb) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? fb
  } catch {
    return fb
  }
}

// 이 기기에 저장된 진행 상황. 이야기가 움직이면(story:progress) 다시 읽는다
const now = ref(null)
const cleared = ref([])
const dex = ref([])
const shop = ref(null)
const bests = ref({})
function readLocal() {
  now.value = readJson('gp-story-now', null)
  cleared.value = readCleared()
  dex.value = readJson('gp-3d-dex', [])
  shop.value = readJson('gp-myshop', null)
  bests.value = Object.fromEntries(Object.entries(QUEST).filter(([, q]) => q.best).map(([id, q]) => [id, Number(localStorage.getItem(q.best)) || 0]))
}

// 지금 장: 진행 중인 장이 있으면 그 장, 없으면 아직 안 끝낸 첫 장
const curN = computed(() => {
  const n = CHAPTERS.findIndex((ch) => ch.title === now.value?.chapter)
  if (n >= 0 && !now.value.done) return n
  const open = CHAPTERS.findIndex((ch) => !cleared.value.includes(ch.id))
  return open < 0 ? CHAPTERS.length : open
})
const allDone = computed(() => curN.value >= CHAPTERS.length)
const started = computed(() => !!now.value || cleared.value.length > 0)

function chapterState(n) {
  if (cleared.value.includes(CHAPTERS[n].id)) return 'done'
  if (n === curN.value) return started.value ? 'now' : 'next'
  return n < curN.value ? 'done' : 'locked'
}

// 그 장 n 의 step 번째 가게까지 왔는지(보스는 이기고 나야 지나간 것)
function reached(n, step, boss = false) {
  const st = chapterState(n)
  if (st === 'done') return 'done'
  if (st === 'locked') return 'locked'
  const at = now.value && CHAPTERS[n].title === now.value.chapter ? now.value.step : 0
  if (at > step) return 'done'
  if (at === step) return boss && !now.value?.boss && now.value?.chapter === CHAPTERS[n].title && started.value ? 'done' : 'now'
  return 'locked'
}

const chapters = computed(() =>
  CHAPTERS.map((ch, n) => {
    const state = chapterState(n)
    const live = state === 'now' && now.value?.chapter === ch.title
    return { ...ch, n, state, at: state === 'done' ? ch.steps.length : live ? now.value.step : 0 }
  }),
)
const bosses = computed(() => BOSS_LIST.map((b) => ({ ...b, state: reached(b.n, b.step, true) })))
const beaten = computed(() => bosses.value.filter((b) => b.state === 'done').length)

const heroLine = computed(() => {
  if (allDone.value) return '모든 간판에 불을 켰어요'
  if (!started.value) return '공릉동에서 시작해요'
  return now.value?.next || `${CHAPTERS[curN.value].ride.station}역으로 가요`
})
const heroCh = computed(() => (allDone.value ? '모든 장을 끝냈어요' : CHAPTERS[curN.value].title))
const heroPct = computed(() => {
  if (allDone.value) return 100
  const ch = chapters.value[curN.value]
  return Math.round(((curN.value + ch.at / ch.steps.length) / CHAPTERS.length) * 100)
})

// 순위 서버: 퀘스트 점수의 전체 순위와 내 기록
const me = ref(player())
const data = ref(null)
const failed = ref(false)
function pull() {
  boards().then(
    (d) => ((data.value = d), (failed.value = false)),
    () => (failed.value = true),
  )
}
const byGame = computed(() => Object.fromEntries((data.value?.games || []).map((g) => [g.game, g])))
const bestOf = (id) => Math.max(bests.value[id] || 0, byGame.value[id]?.me?.best || 0)

// 기록 탭: 퀘스트 하나에 한 줄. 같은 놀이가 두 번 나오지 않으니 id 로 묶지 않는다
const records = computed(() =>
  QUESTS.map((q) => {
    const state = reached(q.n, q.step, !!q.boss)
    const g = byGame.value[q.id]
    return { ...q, state, best: bestOf(q.id), rank: g?.me?.rank || 0, players: g?.players || 0, unit: QUEST[q.id]?.unit ?? '점' }
  }),
)
const opened = computed(() => records.value.filter((r) => r.state !== 'locked'))
const ranked = computed(() => QUESTS.filter((q) => byGame.value[q.id] || ['rain', 'dodge', 'guess', 'more', 'type'].includes(q.id)))
const rankGame = ref('rain')
const rankRows = ref(null)
async function loadRank(id) {
  rankGame.value = id
  rankRows.value = null
  try {
    rankRows.value = await board(id, 10)
  } catch {
    rankRows.value = { top: [], players: 0, me: null, failed: true }
  }
}
const rankUnit = computed(() => QUEST[rankGame.value]?.unit || '점')

const scroller = ref(null)
function go(id) {
  tab.value = id
  if (scroller.value) scroller.value.scrollTop = 0
  if (id === 'records' && !rankRows.value) loadRank(rankGame.value)
}

// 이어 하기는 언제나 간판 수리공 창으로. 지난 퀘스트 다시 하기만 그 놀이를 수리공 창 안에서 바로 띄운다
const resume = () => emit('open', 'street')
const replay = (id) => (appOf(id) ? emit('open', id) : emit('open', 'street', { play: id }))

const onPlayer = (e) => ((me.value = e.detail), pull())
const onStore = (e) => (!e.key || e.key.startsWith('gp-')) && readLocal()
let timer
onMounted(() => {
  readLocal()
  pull()
  timer = setInterval(pull, 60_000)
  window.addEventListener('arcade:score', pull)
  window.addEventListener('arcade:player', onPlayer)
  window.addEventListener('story:progress', readLocal)
  window.addEventListener('storage', onStore)
  window.addEventListener('focus', readLocal)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  window.removeEventListener('arcade:score', pull)
  window.removeEventListener('arcade:player', onPlayer)
  window.removeEventListener('story:progress', readLocal)
  window.removeEventListener('storage', onStore)
  window.removeEventListener('focus', readLocal)
})
</script>

<template>
  <div class="gm">
    <Glass tag="aside" class="sb" :radius="16" :band="14" :scale="44" :blur="14">
      <div class="sb-top drag" />
      <nav>
        <button v-for="t in TABS" :key="t.id" class="b sb-row" :class="{ on: tab === t.id }" @click="go(t.id)">
          <component :is="t.icon" :size="16" :stroke-width="1.8" class="sb-ic" />
          <span>{{ t.label }}</span>
        </button>
      </nav>
      <div class="sb-me">
        <span class="avatar">{{ me ? me.name.slice(0, 1) : '?' }}</span>
        <span class="me-name">{{ me ? me.name : '닉네임 없음' }}</span>
        <span class="me-sub">진행 {{ heroPct }}%</span>
      </div>
    </Glass>

    <section class="main">
      <header class="tb drag">
        <h2 class="tb-title">{{ TABS.find((t) => t.id === tab).label }}</h2>
      </header>

      <div ref="scroller" class="content">
        <!-- 홈: 지금 장과 숫자 넷, 보스 -->
        <template v-if="tab === 'home'">
          <article class="hero" :style="{ '--h1': '#5b8def', '--h2': '#2b4fb8' }">
            <img class="hero-blur" :src="STREET.img" alt="" draggable="false" />
            <div class="hero-text">
              <h1>{{ heroCh }}</h1>
              <p>{{ heroLine }}</p>
              <div class="bar" :aria-label="`전체 진행 ${heroPct}%`"><i :style="{ width: `${heroPct}%` }" /></div>
              <button class="b play" @click="resume"><Play :size="13" :stroke-width="2.6" fill="currentColor" /> {{ started ? '이어 하기' : '시작하기' }}</button>
            </div>
            <img class="hero-icon" :src="STREET.img" alt="" draggable="false" />
          </article>

          <div class="stats">
            <button class="b stat" @click="go('story')"><strong>{{ cleared.length }}<small>/{{ CHAPTERS.length }}</small></strong><span>장</span></button>
            <button class="b stat" @click="go('story')"><strong>{{ beaten }}<small>/{{ BOSS_LIST.length }}</small></strong><span>보스</span></button>
            <div class="stat"><strong>{{ fmt(dex.length) }}</strong><span>간판</span></div>
            <div class="stat"><strong class="shop-name">{{ shop?.name || '-' }}</strong><span>내 가게</span></div>
          </div>

          <div class="bosses">
            <button v-for="b in bosses" :key="b.id" class="b boss-card" :class="b.state" :title="b.state === 'locked' ? '' : b.name" @click="go('story')">
              <span class="boss-art"><img :src="npcArt(`c-${b.id}`)" alt="" draggable="false" /></span>
              <strong>{{ b.state === 'locked' ? '???' : b.name }}</strong>
            </button>
          </div>
        </template>

        <!-- 이야기: 장마다 한 줄 -->
        <template v-else-if="tab === 'story'">
          <div class="chs">
            <article v-for="ch in chapters" :key="ch.id" class="chapter" :class="ch.state">
              <span class="line-dot big" :style="{ '--line': ch.ride.color }">{{ ch.ride.line }}</span>
              <div class="ch-body">
                <h3>{{ ch.title }}</h3>
                <div class="steps" :aria-label="`가게 ${ch.at}/${ch.steps.length}`">
                  <i v-for="(s, i) in ch.steps" :key="i" :class="{ on: i < ch.at, here: ch.state === 'now' && i === ch.at, boss: s.boss }" />
                </div>
                <p v-if="ch.state === 'now' && now?.next" class="muted">{{ now.next }}</p>
              </div>
              <button v-if="ch.state === 'now' || ch.state === 'next'" class="b get" @click="resume">{{ ch.state === 'now' ? '이어 하기' : '시작' }}</button>
              <Lock v-else-if="ch.state === 'locked'" :size="16" :stroke-width="2" class="muted" />
              <Check v-else :size="18" :stroke-width="2.6" class="ok" />
            </article>
          </div>
        </template>

        <!-- 기록: 해 본 퀘스트와 순위 -->
        <template v-else>
          <p v-if="!opened.length" class="note">이야기를 진행하면 기록이 쌓여요.</p>
          <div class="chal-list">
            <div v-for="r in opened" :key="r.key" class="chal wide">
              <img :src="r.app?.img || STREET.img" alt="" draggable="false" />
              <span class="chal-text">
                <strong>{{ r.title }}</strong>
                <span class="muted">{{ r.best ? `${fmt(r.best)}${r.unit}` : r.state === 'done' ? '끝냄' : '지금 할 차례' }}<template v-if="r.rank"> · {{ fmt(r.rank) }}위</template></span>
              </span>
              <button v-if="r.state === 'done'" class="b get" @click="replay(r.id)">다시</button>
              <button v-else class="b get" @click="resume">하기</button>
            </div>
          </div>
          <p v-if="opened.length < records.length" class="note"><Lock :size="11" :stroke-width="2.2" /> {{ records.length - opened.length }}개 더</p>

          <h2 class="sec">순위</h2>
          <div class="chips">
            <button v-for="q in ranked" :key="q.key" class="b chip" :class="{ on: rankGame === q.id }" @click="loadRank(q.id)">{{ q.title }}</button>
          </div>
          <div class="board">
            <p v-if="!rankRows" class="note">불러오는 중…</p>
            <p v-else-if="rankRows.failed" class="note">순위 서버에 닿지 않아요</p>
            <p v-else-if="!rankRows.top.length" class="note">아직 기록이 없어요</p>
            <ol v-else>
              <li v-for="(r, i) in rankRows.top" :key="r.name" :class="{ me: me && r.name === me.name }">
                <span class="pos">
                  <Crown v-if="i === 0" :size="15" :stroke-width="2.2" />
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <span class="avatar sm">{{ r.name.slice(0, 1) }}</span>
                <span class="who">{{ r.name }}</span>
                <span class="score">{{ fmt(r.score) }}{{ rankUnit }}</span>
              </li>
            </ol>
            <p v-if="rankRows?.me" class="board-me">내 기록 {{ fmt(rankRows.me.best) }}{{ rankUnit }} · {{ fmt(rankRows.me.rank) }}위</p>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.gm {
  --sel-gray: color-mix(in srgb, var(--label) 9%, transparent);
  --card: color-mix(in srgb, var(--label) 5%, transparent);
  --tb-h: 52px;
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  color: var(--label);
  background: none;
  font-size: 13px;
  user-select: none;
  -webkit-user-select: none;
}

.gm .b {
  min-height: 0;
  height: auto;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: none;
  box-shadow: none;
  color: inherit;
  font: inherit;
  line-height: inherit;
  text-align: left;
  cursor: default;
}

.muted {
  color: var(--label-2);
}

/* 사이드바는 Finder 와 같은 떠 있는 유리판 */
.sb {
  flex: none;
  width: 200px;
  margin: 8px 0 8px 8px;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--window-2) 46%, transparent);
  box-shadow:
    inset 0 0 0 0.5px rgba(0, 0, 0, 0.08),
    inset 1px 1px 0 -0.5px rgba(255, 255, 255, 0.9),
    inset -1px -1px 0 -0.5px rgba(255, 255, 255, 0.5),
    0 2px 10px rgba(0, 0, 0, 0.08),
    0 0 0 24px var(--window);
  overflow: hidden;
}

:global(html.dark) .sb {
  background: color-mix(in srgb, #2c2c30 42%, transparent);
  box-shadow:
    inset 0 0 0 0.5px rgba(255, 255, 255, 0.1),
    inset 1px 1px 0 -0.5px rgba(255, 255, 255, 0.28),
    inset -1px -1px 0 -0.5px rgba(255, 255, 255, 0.1),
    0 2px 10px rgba(0, 0, 0, 0.3),
    0 0 0 24px var(--window);
}

.sb-top {
  flex: none;
  height: 44px;
}

.sb nav {
  flex: 1;
  overflow: auto;
  padding: 0 10px 8px;
}

.sb h3 {
  margin: 14px 8px 3px;
  color: var(--label-2);
  font-size: 11px;
  font-weight: 700;
}

.gm .sb-row {
  width: 100%;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-radius: 8px;
}

.gm .sb-row.on,
.gm .sb-row.on:active {
  background: var(--sel-gray);
}

.sb-ic {
  flex: none;
  color: var(--accent);
}

.sb-row span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.sb-me {
  flex: none;
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 8px;
  align-items: center;
  padding: 10px 14px 12px;
}

.avatar {
  grid-row: span 2;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(#a5a5ad, #6c6c74);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
}

.avatar.sm {
  width: 24px;
  height: 24px;
  font-size: 11px;
}

.me-name {
  font-weight: 600;
}

.me-sub {
  color: var(--label-2);
  font-size: 11px;
}

/* 오른쪽 */
.main {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--window);
}

.tb {
  position: absolute;
  z-index: 3;
  top: 0;
  left: 0;
  right: 0;
  height: var(--tb-h);
  display: flex;
  align-items: center;
  padding: 0 20px;
  isolation: isolate;
}

.tb::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 0 0 -14px;
  pointer-events: none;
  background: linear-gradient(var(--window) 35%, color-mix(in srgb, var(--window) 0%, transparent));
  opacity: 0.82;
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
  -webkit-mask-image: linear-gradient(#000 60%, transparent);
  mask-image: linear-gradient(#000 60%, transparent);
}

.tb-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: calc(var(--tb-h) + 4px) 20px 24px;
}

/* 오늘의 게임: 아이콘을 크게 흐려 깐 배너 */
.hero {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 190px;
  padding: 26px 28px;
  border-radius: 18px;
  overflow: hidden;
  background: linear-gradient(135deg, var(--h1), var(--h2));
  color: #fff;
  isolation: isolate;
}

.hero-blur {
  position: absolute;
  z-index: -1;
  right: -60px;
  top: -80px;
  width: 420px;
  height: 420px;
  filter: blur(40px) saturate(1.4);
  opacity: 0.55;
}

.hero-text {
  flex: 1;
  min-width: 0;
}

.hero-text p {
  margin: 0;
  opacity: 0.88;
}


.hero h1 {
  margin: 4px 0 6px;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.hero-icon {
  flex: none;
  width: 150px;
  height: 150px;
  margin: -10px -6px -10px 12px;
  filter: drop-shadow(0 12px 22px rgba(0, 0, 0, 0.25));
}

.gm .play {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 16px;
  height: 30px;
  padding: 0 16px;
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.95);
  color: #111;
  font-weight: 700;
}

.gm .play:active {
  background: rgba(255, 255, 255, 0.75);
}

.gm .play.dark {
  background: var(--accent);
  color: #fff;
}

.sec {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 24px 2px 10px;
  font-size: 17px;
  font-weight: 700;
}

.gm .more {
  color: var(--accent);
  font-size: 13px;
  font-weight: 500;
}



.boss-card strong {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-weight: 600;
}

.gm .chal {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px;
  border-radius: 14px;
  background: var(--card);
}

.gm .chal:active {
  background: var(--sel-gray);
}

.chal img {
  flex: none;
  width: 48px;
  height: 48px;
}

.chal-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  font-size: 12px;
}

.chal-text strong {
  font-size: 14px;
}

.chal-list {
  display: grid;
  gap: 8px;
}

.chal.wide .chal-text {
  flex: 1;
}

.go,
.gm .get {
  flex: none;
  height: 26px;
  padding: 0 14px;
  border-radius: 13px;
  background: var(--sel-gray);
  color: var(--accent);
  font-weight: 700;
  line-height: 26px;
}

.note,
.lede {
  margin: 8px 2px;
  color: var(--label-2);
}

.lede {
  margin-bottom: 14px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 14px;
}

.gm .chip {
  height: 26px;
  padding: 0 12px;
  border-radius: 13px;
  background: var(--card);
  font-weight: 500;
}

.gm .chip.on {
  background: var(--label);
  color: var(--window);
}

.mine {
  color: var(--accent);
  font-size: 12px;
}

.board {
  max-width: 520px;
}

.board ol {
  margin: 0;
  padding: 0;
  list-style: none;
  border-radius: 14px;
  background: var(--card);
  overflow: hidden;
}

.board li {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 42px;
  padding: 0 14px;
}

.board li + li {
  border-top: 0.5px solid var(--separator, rgba(128, 128, 128, 0.2));
}

.board li.me {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.pos {
  width: 20px;
  display: grid;
  place-items: center;
  color: var(--label-2);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
}

li:first-child .pos {
  color: #e0a800;
}

.who {
  flex: 1;
  font-weight: 600;
}

.score {
  font-variant-numeric: tabular-nums;
}

.board-me {
  margin: 10px 2px 0;
  color: var(--accent);
  font-weight: 600;
}

/* 이야기 진행: 지하철 노선 색 동그라미 */
.line-dot {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--line);
  color: #fff;
  font-size: 10px;
  font-weight: 800;
}

.line-dot.big {
  width: 34px;
  height: 34px;
  font-size: 16px;
}



.ok {
  color: #34c759;
}

.bar {
  height: 6px;
  max-width: 320px;
  margin-top: 14px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.28);
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #fff;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.gm .stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--card);
  color: var(--label-2);
  font-size: 12px;
}

.gm .stat:active {
  background: var(--sel-gray);
}

.stat strong {
  overflow: hidden;
  color: var(--label);
  font-size: 22px;
  font-weight: 800;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.stat small {
  color: var(--label-2);
  font-size: 13px;
  font-weight: 600;
}

.stat .shop-name {
  font-size: 17px;
  line-height: 27px;
}

/* 보스: 서 있는 그림, 아직 못 만난 보스는 그림자만 */
.gm .boss-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 12px;
}

.boss-card strong {
  font-size: 13px;
}

.bosses {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 18px;
}

.boss-card.done .boss-art {
  background: linear-gradient(160deg, #ffe7a3, #f2a93b);
}

.chapter h3 {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 700;
}

.note svg {
  vertical-align: -1px;
}

.boss-art {
  display: grid;
  place-items: end center;
  aspect-ratio: 1;
  margin-bottom: 6px;
  border-radius: 14px;
  background: linear-gradient(160deg, #3a3f5c, #171a2b);
  overflow: hidden;
}

.boss-art img {
  width: 82%;
  height: 92%;
  object-fit: contain;
  object-position: bottom;
  image-rendering: pixelated;
}


.locked .boss-art img {
  filter: brightness(0) opacity(0.55);
}







.chs {
  display: grid;
  gap: 10px;
}

.chapter {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px;
  border-radius: 14px;
  background: var(--card);
  font-size: 12px;
}

.chapter.locked {
  opacity: 0.55;
}

.chapter.now {
  box-shadow: inset 0 0 0 1.5px var(--accent);
}

.chapter p {
  margin: 0;
}

.ch-body {
  flex: 1;
  min-width: 0;
}

.chapter > .get,
.chapter > svg {
  align-self: center;
}

.steps {
  display: flex;
  gap: 4px;
  margin: 6px 0;
}

.steps i {
  width: 22px;
  height: 6px;
  border-radius: 3px;
  background: var(--sel-gray);
}

.steps i.on {
  background: #ffc83d;
}

.steps i.here {
  background: var(--accent);
}

.steps i.boss:not(.on) {
  box-shadow: inset 0 0 0 1.5px #ff6b6b;
}













</style>
