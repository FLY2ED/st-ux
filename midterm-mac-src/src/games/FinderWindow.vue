<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AppWindow, ChevronLeft, ChevronRight, Columns3, Ellipsis, GalleryHorizontalEnd, HardDrive, LayoutGrid, List, Monitor, Search, Store, X } from 'lucide-vue-next'
import { APPS } from '../apps.js'
import { FILES, readMyShops } from '../desk.js'
import { shopImg } from '../shops.js'
import { sfx } from '../sound.js'
import FinderIcon from './FinderIcon.vue'
import Glass from './Glass.vue'

// macOS 26 Finder 를 따른 창. 떠 있는 유리 사이드바(즐겨찾기·위치·태그), 툴바(뒤로·앞으로, 보기 네 가지, 정렬, 검색),
// 아래 경로 막대와 상태 막대. 바탕화면 폴더마다 이 창이 하나씩 따로 뜬다
const props = defineProps({ at: { type: String, default: 'desktop' } })
const emit = defineEmits(['open', 'retitle'])

const root = ref(null)

const mine = ref(readMyShops())
const refreshMine = () => (mine.value = readMyShops())
onMounted(() => window.addEventListener('focus', refreshMine))
onBeforeUnmount(() => window.removeEventListener('focus', refreshMine))

const appOf = (id) => APPS.find((a) => a.id === id)

// 폴더 나무: 간판도감 HD ─ 응용 프로그램, 바탕화면 ─ 내가 차린 가게
const NODES = {
  hd: { name: '간판도감 HD', icon: HardDrive },
  apps: { name: '응용 프로그램', parent: 'hd', icon: AppWindow },
  desktop: { name: '바탕화면', parent: 'hd', icon: Monitor },
  mine: { name: '내가 차린 가게', parent: 'desktop', icon: Store },
}
const folderItem = (id) => ({ id, name: NODES[id].name, type: id === 'hd' ? 'hd' : 'folder', glyph: id, folder: id, kind: '폴더', size: null })

function fileItem(f) {
  if (f.type === 'folder') return folderItem(f.id)
  const base = { id: `f:${f.id}`, name: f.name, size: null }
  if (f.type === 'txt') return { ...base, type: 'txt', badge: 'TXT', kind: '일반 텍스트 문서', file: f.id }
  if (f.type === 'webloc') return { ...base, type: 'webloc', img: appOf('web').img, kind: '인터넷 위치', app: 'web' }
  return { ...base, type: 'alias', img: appOf(f.app)?.img, kind: '가상본', app: f.app }
}

function kidsOf(id) {
  if (id === 'hd') return ['apps', 'desktop'].map(folderItem)
  if (id === 'apps')
    return APPS.filter((a) => a.kind === 'hub' || a.kind === 'play' || a.kind === 'look').map((a) => ({ id: `a:${a.id}`, name: a.title, type: 'app', img: a.img, kind: '응용 프로그램', size: null, app: a.id }))
  // 디스크는 바탕화면에 보이지만 바탕화면 폴더 안의 파일은 아니다
  if (id === 'desktop') return FILES.filter((f) => f.type !== 'disk').map(fileItem)
  if (id === 'mine') return mine.value.map((s) => ({ id: `s:${s.label}`, key: s.key, name: s.label, type: 'shop', kind: '내 가게', size: null, look: true }))
  return []
}
const nameOf = (id) => NODES[id]?.name

// 지나온 길
const cwd = ref(NODES[props.at] ? props.at : 'desktop')
const back = ref([])
const fwd = ref([])
const sel = ref(null)
const query = ref('')
const view = ref('icon')
const iconSize = ref(64)
const sortKey = ref(null)
const sortDir = ref(1)
const sortMenu = ref(false)
const look = ref(null)

function go(id) {
  query.value = ''
  if (id === cwd.value) return
  back.value.push(cwd.value)
  fwd.value = []
  cwd.value = id
  sel.value = null
  sfx.click?.()
}
function goBack() {
  if (!back.value.length) return
  fwd.value.push(cwd.value)
  cwd.value = back.value.pop()
  sel.value = null
}
function goFwd() {
  if (!fwd.value.length) return
  back.value.push(cwd.value)
  cwd.value = fwd.value.pop()
  sel.value = null
}
const goUp = () => NODES[cwd.value]?.parent && go(NODES[cwd.value].parent)

const title = computed(() => (query.value ? `“${query.value}” 검색` : nameOf(cwd.value)))
watch(title, (t) => emit('retitle', t), { immediate: true })

// 검색은 Finder 처럼 이 컴퓨터 전체에서 찾는다
const items = computed(() => {
  let list
  const q = query.value.trim().toLowerCase()
  if (q) {
    const seen = new Set()
    list = ['apps', 'desktop', 'mine']
      .flatMap(kidsOf)
      .filter((it) => it.name.toLowerCase().includes(q) && !seen.has(it.id) && seen.add(it.id))
  } else list = kidsOf(cwd.value)
  if (!sortKey.value) return list
  const k = sortKey.value
  return [...list].sort((a, b) => {
    const x = k === 'size' ? (a.size ?? -1) - (b.size ?? -1) : String(a[k]).localeCompare(String(b[k]), 'ko')
    return x * sortDir.value
  })
})
const selItem = computed(() => items.value.find((it) => it.id === sel.value) || null)

function sortBy(k) {
  if (sortKey.value === k) sortDir.value = -sortDir.value
  else {
    sortKey.value = k
    sortDir.value = 1
  }
  sortMenu.value = false
}

function openItem(it) {
  if (!it) return
  if (it.folder) return go(it.folder)
  if (it.app) return emit('open', it.app)
  if (it.file) return emit('open', 'file', { file: it.file, winTitle: it.name })
  look.value = it.id
  sfx.pop?.()
}

// 훑어보기(스페이스바)
const lookItem = computed(() => items.value.find((it) => it.id === look.value) || null)
function moveLook(d) {
  const i = items.value.findIndex((it) => it.id === look.value)
  const next = items.value[(i + d + items.value.length) % items.value.length]
  look.value = next.id
  sel.value = next.id
}

// 경로 막대: 맨 위 디스크부터 지금 폴더까지
const chain = computed(() => {
  if (query.value) return []
  const out = []
  for (let id = cwd.value; id; id = NODES[id].parent) out.unshift(id)
  return out
})

// 열 보기: 지나온 폴더마다 한 열
const columns = computed(() =>
  query.value
    ? [{ id: 'search', items: items.value, last: true }]
    : chain.value.map((id, i) => ({ id, items: i === chain.value.length - 1 ? items.value : kidsOf(id), pick: chain.value[i + 1], last: i === chain.value.length - 1 })),
)
// 열 보기는 Finder 처럼 늘 맨 오른쪽 열이 보이게 민다
const colsEl = ref(null)
watch([columns, sel, view], () => nextTick(() => colsEl.value && (colsEl.value.scrollLeft = colsEl.value.scrollWidth)))
function pickInColumn(col, it) {
  if (it.folder) return go(it.folder)
  if (!col.last) go(col.id)
  sel.value = it.id
}

const grid = ref(null)
function moveSel(d) {
  const list = items.value
  if (!list.length) return
  const i = list.findIndex((it) => it.id === sel.value)
  sel.value = list[i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + d))].id
  if (look.value) look.value = sel.value
}
function rowStep() {
  if (view.value !== 'icon' || !grid.value) return 1
  const first = grid.value.querySelector('.tile')
  return first ? Math.max(1, Math.round(grid.value.clientWidth / first.offsetWidth)) : 1
}

function onKey(e) {
  if (!root.value?.closest('.mac-win.on')) return
  const typing = e.target instanceof HTMLInputElement
  const mod = e.metaKey || e.ctrlKey
  if (e.key === 'Escape') {
    if (look.value) look.value = null
    else if (sortMenu.value) sortMenu.value = false
    else if (query.value) query.value = ''
    return
  }
  if (typing) return
  if (mod && e.key === '[') return e.preventDefault(), goBack()
  if (mod && e.key === ']') return e.preventDefault(), goFwd()
  if (mod && e.key === 'ArrowUp') return e.preventDefault(), goUp()
  if (mod && e.key === 'ArrowDown') return e.preventDefault(), openItem(selItem.value)
  if (mod && ['1', '2', '3', '4'].includes(e.key)) return e.preventDefault(), (view.value = ['icon', 'list', 'column', 'gallery'][e.key - 1])
  if (mod) return
  if (e.code === 'Space' && sel.value) {
    e.preventDefault()
    look.value = look.value ? null : sel.value
  } else if (e.key === 'Enter') openItem(selItem.value)
  else if (e.key === 'ArrowRight') e.preventDefault(), look.value ? moveLook(1) : moveSel(1)
  else if (e.key === 'ArrowLeft') e.preventDefault(), look.value ? moveLook(-1) : moveSel(-1)
  else if (e.key === 'ArrowDown') e.preventDefault(), moveSel(rowStep())
  else if (e.key === 'ArrowUp') e.preventDefault(), moveSel(-rowStep())
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const VIEWS = [
  { id: 'icon', icon: LayoutGrid, label: '아이콘' },
  { id: 'list', icon: List, label: '목록' },
  { id: 'column', icon: Columns3, label: '열' },
  { id: 'gallery', icon: GalleryHorizontalEnd, label: '갤러리' },
]
const SORTS = [
  { id: null, label: '없음' },
  { id: 'name', label: '이름' },
  { id: 'kind', label: '종류' },
  { id: 'size', label: '크기' },
]
const FAVS = ['apps', 'desktop', 'mine']
const big = (it) => it && (it.type === 'image' || it.type === 'shop')
</script>

<template>
  <div ref="root" class="fd" @pointerdown="sortMenu && !$event.target.closest('.sort') && (sortMenu = false)">
    <!-- 떠 있는 유리 사이드바. 창 뒤 바탕화면이 흐리게 비치고, 신호등은 창 틀이 이 위에 얹는다 -->
    <Glass tag="aside" class="sb" :radius="16" :band="14" :scale="44" :blur="14">
      <div class="sb-top drag" />
      <nav>
        <h3>즐겨찾기</h3>
        <button v-for="id in FAVS" :key="id" class="b sb-row" :class="{ on: cwd === id && !query }" @click="go(id)">
          <component :is="NODES[id].icon" :size="16" :stroke-width="1.8" class="sb-ic" />
          <span>{{ NODES[id].name }}</span>
        </button>
        <h3>위치</h3>
        <button class="b sb-row" :class="{ on: cwd === 'hd' && !query }" @click="go('hd')">
          <HardDrive :size="16" :stroke-width="1.8" class="sb-ic" />
          <span>간판도감 HD</span>
        </button>
      </nav>
    </Glass>

    <section class="main">
      <header class="tb drag">
        <Glass class="pill nav" :band="9" :scale="26">
          <button class="b" :disabled="!back.length" aria-label="뒤로" title="뒤로" @click="goBack"><ChevronLeft :size="18" :stroke-width="2" /></button>
          <button class="b" :disabled="!fwd.length" aria-label="앞으로" title="앞으로" @click="goFwd"><ChevronRight :size="18" :stroke-width="2" /></button>
        </Glass>
        <h2 class="tb-title">{{ title }}</h2>
        <span class="grow" />
        <Glass class="pill seg" role="radiogroup" aria-label="보기" :band="9" :scale="26">
          <button
            v-for="v in VIEWS"
            :key="v.id"
            class="b"
            :class="{ on: view === v.id }"
            role="radio"
            :aria-checked="view === v.id"
            :aria-label="`${v.label} 보기`"
            :title="`${v.label}으로 보기`"
            @click="view = v.id"
          >
            <component :is="v.icon" :size="16" :stroke-width="1.8" />
          </button>
        </Glass>
        <div class="sort">
          <Glass tag="button" class="b pill one" :class="{ on: sortMenu }" aria-label="정렬" title="정렬 기준" :band="9" :scale="26" @click="sortMenu = !sortMenu"><Ellipsis :size="18" :stroke-width="2" /></Glass>
          <div v-if="sortMenu" class="menu" role="menu">
            <p>정렬 기준</p>
            <button v-for="s in SORTS" :key="s.label" class="b" role="menuitem" @click="s.id ? sortBy(s.id) : ((sortKey = null), (sortMenu = false))">
              <span class="chk">{{ sortKey === s.id ? '✓' : '' }}</span>{{ s.label }}
            </button>
          </div>
        </div>
        <Glass tag="label" class="pill search" :band="9" :scale="26">
          <Search :size="14" :stroke-width="2" />
          <input v-model="query" type="search" placeholder="검색" aria-label="검색" />
          <button v-if="query" class="b clear" aria-label="지우기" @click="query = ''"><X :size="12" :stroke-width="2.4" /></button>
        </Glass>
      </header>

      <div class="content">
        <!-- 빈 폴더 -->
        <div v-if="!items.length" class="empty">
          <template v-if="query">
            <p class="empty-title">결과 없음</p>
            <p class="empty-sub">“{{ query }}”와 맞는 항목이 없어요.</p>
          </template>
          <template v-else-if="cwd === 'mine'">
            <FinderIcon :item="{ type: 'folder', glyph: 'mine' }" style="--fi: 72px" />
            <p class="empty-title">아직 차린 가게가 없어요</p>
            <p class="empty-sub">간판 이름을 지어 가게를 열면 여기에 모여요.</p>
            <button class="go" @click="emit('open', 'open')">내 가게 차리기</button>
          </template>
          <p v-else class="empty-sub">비어 있음</p>
        </div>

        <!-- 아이콘 보기 -->
        <div v-else-if="view === 'icon'" ref="grid" class="icons" :style="{ '--fi': `${iconSize}px` }" @pointerdown.self="sel = null">
          <button
            v-for="it in items"
            :key="it.id"
            class="b tile"
            :class="{ on: sel === it.id }"
            @pointerdown="sel = it.id"
            @dblclick="openItem(it)"
          >
            <span class="tile-ic"><FinderIcon :item="it" /></span>
            <span class="tile-name">{{ it.name }}</span>
            <span v-if="it.tags?.length" class="tile-tags"><i v-for="t in it.tags" :key="t.id" class="dot" :style="{ background: t.color }" /></span>
          </button>
        </div>

        <!-- 목록 보기 -->
        <div v-else-if="view === 'list'" class="list" @pointerdown.self="sel = null">
          <div class="lh">
            <button v-for="c in [['name', '이름'], ['size', '크기'], ['kind', '종류']]" :key="c[0]" class="b" :class="[c[0], { on: sortKey === c[0] }]" @click="sortBy(c[0])">
              {{ c[1] }}<span v-if="sortKey === c[0]" class="arr">{{ sortDir > 0 ? '⌃' : '⌄' }}</span>
            </button>
          </div>
          <button
            v-for="it in items"
            :key="it.id"
            class="b lr"
            :class="{ on: sel === it.id }"
            @pointerdown="sel = it.id"
            @dblclick="openItem(it)"
          >
            <span class="name">
              <FinderIcon :item="it" style="--fi: 18px" />
              <span class="txt">{{ it.name }}</span>
              <i v-for="t in it.tags || []" :key="t.id" class="dot" :style="{ background: t.color }" />
            </span>
            <span class="size">{{ fmtSize(it.size) }}</span>
            <span class="kind">{{ it.kind }}</span>
          </button>
        </div>

        <!-- 열 보기 -->
        <div v-else-if="view === 'column'" ref="colsEl" class="cols">
          <div v-for="col in columns" :key="col.id" class="col">
            <button
              v-for="it in col.items"
              :key="it.id"
              class="b cr"
              :class="{ on: col.last ? sel === it.id : col.pick === it.folder, dim: !col.last }"
              @pointerdown="pickInColumn(col, it)"
              @dblclick="openItem(it)"
            >
              <FinderIcon :item="it" style="--fi: 18px" />
              <span class="txt">{{ it.name }}</span>
              <ChevronRight v-if="it.folder" :size="13" :stroke-width="2.2" class="cr-more" />
            </button>
          </div>
          <div v-if="selItem && !selItem.folder" class="col-preview">
            <img v-if="big(selItem)" class="cp-img" :src="shopImg(selItem.key)" alt="" />
            <FinderIcon v-else :item="selItem" style="--fi: 128px" />
            <p class="cp-name">{{ selItem.name }}</p>
            <p class="cp-meta">{{ selItem.kind }}<template v-if="selItem.size"> · {{ fmtSize(selItem.size) }}</template></p>
            <p v-if="selItem.tags?.length" class="cp-tags">
              <span v-for="t in selItem.tags" :key="t.id"><i class="dot" :style="{ background: t.color }" />{{ t.name }}</span>
            </p>
          </div>
        </div>

        <!-- 갤러리 보기 -->
        <div v-else class="gallery">
          <div class="g-stage" @dblclick="openItem(selItem || items[0])">
            <template v-for="it in [selItem || items[0]]" :key="it.id">
              <img v-if="big(it)" class="g-img" :src="shopImg(it.key)" alt="" />
              <FinderIcon v-else :item="it" style="--fi: 180px" />
              <p class="g-cap">{{ it.name }} <span>· {{ it.kind }}</span></p>
            </template>
          </div>
          <div class="g-strip">
            <button
              v-for="it in items"
              :key="it.id"
              class="b g-th"
              :class="{ on: (sel || items[0].id) === it.id }"
              :aria-label="it.name"
              @pointerdown="sel = it.id"
              @dblclick="openItem(it)"
            >
              <FinderIcon :item="it" style="--fi: 46px" />
            </button>
          </div>
        </div>
      </div>

      <!-- 경로 막대 -->
      <footer class="path">
        <template v-for="(id, i) in chain" :key="id">
          <button class="b crumb" @click="!query && go(id)">
            <FinderIcon :item="id === 'hd' ? { type: 'hd' } : { type: 'folder', glyph: id }" style="--fi: 14px" />
            {{ nameOf(id) }}
          </button>
          <ChevronRight v-if="i < chain.length - 1 || selItem" :size="11" :stroke-width="2.4" class="sepc" />
        </template>
        <span v-if="selItem" class="crumb last">
          <FinderIcon :item="selItem" style="--fi: 14px" />
          {{ selItem.name }}
        </span>
      </footer>
      <!-- 상태 막대 -->
      <footer class="status">
        <span class="grow" />
        <span>{{ selItem ? `${items.length}개 중 1개 선택됨` : `${items.length}개 항목` }}</span>
        <span class="grow" />
        <input v-if="view === 'icon'" v-model.number="iconSize" class="zoom" type="range" min="40" max="128" step="4" aria-label="아이콘 크기" />
      </footer>

    </section>

    <!-- 훑어보기 -->
    <div v-if="lookItem" class="quick" @pointerdown.self="look = null">
      <figure>
        <figcaption>
          <button class="b ql-btn" aria-label="닫기" @click="look = null"><X :size="14" :stroke-width="2.2" /></button>
          <span>{{ lookItem.name }}</span>
          <button class="b ql-btn" aria-label="이전" @click="moveLook(-1)"><ChevronLeft :size="16" :stroke-width="2.2" /></button>
          <button class="b ql-btn" aria-label="다음" @click="moveLook(1)"><ChevronRight :size="16" :stroke-width="2.2" /></button>
        </figcaption>
        <img v-if="big(lookItem)" :src="shopImg(lookItem.key)" :alt="lookItem.name" />
        <div v-else class="ql-icon">
          <FinderIcon :item="lookItem" style="--fi: 160px" />
          <p>{{ lookItem.kind }}</p>
        </div>
      </figure>
    </div>
  </div>
</template>

<style scoped>
.fd {
  --pill: color-mix(in srgb, var(--window) 52%, transparent);
  --sel-gray: color-mix(in srgb, var(--label) 9%, transparent);
  --tb-h: 52px;
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  color: var(--label);
  /* 창 바탕은 비워 둔다. 사이드바 자리로 창 뒤가 비치고, 나머지는 사이드바 둘레 그림자와 .main 이 칠한다 */
  background: none;
  font-size: 13px;
  user-select: none;
  -webkit-user-select: none;
}

.grow {
  flex: 1;
}

/* 모든 단추는 맥 기본 단추 모양을 벗고 시작한다 */
.fd .b {
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

.fd .b:active {
  background: none;
}

.dot {
  display: inline-block;
  flex: none;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.15);
}

/* 사이드바: 창 안에 떠 있는 유리판. 맨 끝 그림자(퍼짐 24px)가 둘레 여백을 창 색으로 칠해, 판 안쪽만 창 뒤가 비친다 */
.sb {
  flex: none;
  width: 190px;
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
  padding: 0 10px 12px;
}

.sb h3 {
  margin: 12px 8px 3px;
  /* 유리 위 글자는 흐린 회색 대신 한 단계 진하게 */
  color: var(--label-2);
  font-size: 11px;
  font-weight: 700;
}

.sb h3:first-child {
  margin-top: 2px;
}

.fd .sb-row {
  width: 100%;
  height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border-radius: 8px;
}

.fd .sb-row.on,
.fd .sb-row.on:active {
  background: var(--sel-gray);
}

.sb-ic {
  flex: none;
  color: var(--accent);
}

.sb-row .dot {
  margin: 0 3.5px;
}

/* 오른쪽: 내용 + 막대 둘. 툴바는 내용 위에 떠 있고, 내용은 그 밑으로 스크롤된다 */
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
  gap: 8px;
  padding: 0 12px 0 14px;
  isolation: isolate;
}

/* 스크롤 가장자리: 줄 대신 툴바 밑으로 들어간 내용을 살짝 흐리고 창 색으로 바랜다 */
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

/* 툴바 단추 묶음: 작은 유리 알약. 밑으로 지나가는 내용이 가장자리에서 휘어 보인다 */
.pill {
  height: 32px;
  display: flex;
  align-items: center;
  border-radius: 16px;
  background: var(--pill);
  box-shadow:
    0 0 0 0.5px rgba(0, 0, 0, 0.06),
    0 2px 8px rgba(0, 0, 0, 0.1),
    inset 1px 1px 0 -0.5px rgba(255, 255, 255, 0.95),
    inset -1px -1px 0 -0.5px rgba(255, 255, 255, 0.6);
}

:global(html.dark) .pill {
  background: rgba(60, 60, 64, 0.38);
  box-shadow:
    0 0 0 0.5px rgba(255, 255, 255, 0.1),
    0 2px 8px rgba(0, 0, 0, 0.35),
    inset 1px 1px 0 -0.5px rgba(255, 255, 255, 0.3),
    inset -1px -1px 0 -0.5px rgba(255, 255, 255, 0.12);
}

.fd .pill .b {
  display: grid;
  place-items: center;
  width: 34px;
  height: 28px;
  border-radius: 14px;
  color: var(--label-2);
}

.fd .pill .b:hover:not(:disabled) {
  color: var(--label);
}

.fd .pill .b:disabled {
  color: var(--label-3);
}

.nav {
  padding: 0 2px;
}

.tb-title {
  margin: 0 0 0 4px;
  min-width: 0;
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.seg {
  padding: 0 2px;
}

.fd .seg .b {
  width: 32px;
}

.fd .seg .b.on,
.fd .seg .b.on:active {
  background: var(--sel-gray);
  color: var(--label);
}

.sort {
  position: relative;
}

.fd .pill.one {
  width: 32px;
  height: 32px;
  border-radius: 16px;
  padding: 0;
}

.fd .pill.one.on {
  color: var(--label);
}

.menu {
  position: absolute;
  z-index: 6;
  top: 38px;
  right: 0;
  width: 150px;
  padding: 5px;
  border-radius: 12px;
  background: var(--panel);
  box-shadow: 0 0 0 0.5px var(--sep), 0 10px 30px rgba(0, 0, 0, 0.2);
}

.menu p {
  margin: 2px 8px 4px;
  color: var(--label-3);
  font-size: 11px;
  font-weight: 700;
}

.fd .menu .b {
  width: 100%;
  display: flex;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
}

.fd .menu .b:hover {
  background: var(--accent);
  color: #fff;
}

.chk {
  width: 14px;
}

.search {
  width: 168px;
  gap: 6px;
  padding: 0 10px;
  color: var(--label-2);
}

.fd .search input {
  flex: 1;
  min-width: 0;
  height: 28px;
  padding: 0;
  border: 0;
  background: none;
  box-shadow: none;
  color: var(--label);
  font-size: 13px;
}

.fd .search input::-webkit-search-cancel-button {
  display: none;
}

.fd .search .clear {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--label-3);
  color: var(--window);
}

/* 내용 */
.content {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.content > * {
  flex: 1;
  min-width: 0;
}

.icons {
  overflow: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(calc(var(--fi) + 40px), 1fr));
  align-content: start;
  gap: 10px 2px;
  padding: calc(var(--tb-h) + 10px) 14px 16px;
}

.fd .tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  text-align: center;
}

.tile-ic {
  display: grid;
  place-items: center;
  padding: 4px;
  border-radius: 8px;
}

.tile.on .tile-ic {
  background: var(--sel-gray);
}

.tile-name {
  max-width: calc(var(--fi) + 36px);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.3;
  word-break: keep-all;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tile.on .tile-name {
  background: var(--accent);
  color: #fff;
}

.tile-tags {
  display: flex;
  gap: 2px;
}

.tile-tags .dot {
  width: 7px;
  height: 7px;
}

/* 목록 보기 */
.list {
  overflow: auto;
  padding: var(--tb-h) 10px 10px;
  font-variant-numeric: tabular-nums;
}

.lh,
.lr {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 84px 130px;
  align-items: center;
}

.lh {
  position: sticky;
  top: var(--tb-h);
  z-index: 1;
  height: 28px;
  margin-bottom: 2px;
  border-bottom: 0.5px solid var(--sep);
  background: var(--window);
}

.fd .lh .b {
  height: 100%;
  padding: 0 8px;
  color: var(--label-2);
  font-size: 12px;
  font-weight: 600;
}

.fd .lh .b + .b {
  border-left: 0.5px solid var(--sep);
}

.fd .lh .b.on {
  color: var(--label);
}

.arr {
  margin-left: 4px;
  font-size: 10px;
}

.fd .lr {
  width: 100%;
  height: 26px;
  border-radius: 6px;
}

.fd .lr:nth-child(odd) {
  background: color-mix(in srgb, var(--label) 3.5%, transparent);
}

.fd .lr.on,
.fd .lr.on:active {
  background: var(--accent);
  color: #fff;
}

.lr > span {
  min-width: 0;
  padding: 0 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lr .name {
  display: flex;
  align-items: center;
  gap: 6px;
}

.lr .txt {
  overflow: hidden;
  text-overflow: ellipsis;
}

.lr .size {
  text-align: right;
}

.lr .size,
.lr .kind {
  color: var(--label-2);
}

.lr.on .size,
.lr.on .kind {
  color: rgba(255, 255, 255, 0.85);
}

/* 열 보기 */
.cols {
  display: flex;
  overflow-x: auto;
}

.col {
  flex: none;
  width: 180px;
  overflow: auto;
  padding: calc(var(--tb-h) + 4px) 6px 4px;
  border-right: 0.5px solid var(--sep);
}

.fd .cr {
  width: 100%;
  height: 26px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  border-radius: 6px;
}

.cr .txt {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cr-more {
  flex: none;
  color: var(--label-3);
}

.fd .cr.on,
.fd .cr.on:active {
  background: var(--accent);
  color: #fff;
}

.fd .cr.on.dim,
.fd .cr.on.dim:active {
  background: var(--sel-gray);
  color: var(--label);
}

.cr.on:not(.dim) .cr-more {
  color: #fff;
}

.col-preview {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: calc(var(--tb-h) + 8px) 16px 16px;
  text-align: center;
}

.cp-img {
  image-rendering: pixelated;
  width: min(100%, 220px);
  aspect-ratio: 1;
  object-fit: contain;
  border-radius: 10px;
  box-shadow: 0 0 0 0.5px var(--sep), 0 6px 20px rgba(0, 0, 0, 0.12);
}

.cp-name {
  margin: 10px 0 0;
  font-size: 14px;
  font-weight: 700;
}

.cp-meta,
.cp-tags {
  margin: 0;
  color: var(--label-2);
  font-size: 12px;
}

.cp-tags {
  display: flex;
  gap: 10px;
}

.cp-tags span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* 갤러리 보기 */
.gallery {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.g-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: calc(var(--tb-h) + 6px) 12px 12px;
}

.g-img {
  image-rendering: pixelated;
  flex: 1;
  min-height: 0;
  max-width: 100%;
  object-fit: contain;
  border-radius: 10px;
}

.g-cap {
  margin: 0;
  font-weight: 700;
}

.g-cap span {
  color: var(--label-2);
  font-weight: 400;
}

.g-strip {
  flex: none;
  display: flex;
  gap: 4px;
  padding: 6px 12px 10px;
  overflow-x: auto;
}

.fd .g-th {
  flex: none;
  padding: 4px;
  border-radius: 8px;
}

.fd .g-th.on,
.fd .g-th.on:active {
  background: var(--sel-gray);
  box-shadow: inset 0 0 0 2px var(--accent);
}

/* 빈 폴더 */
.empty {
  padding-top: var(--tb-h);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-align: center;
}

.empty p {
  margin: 0;
}

.empty-title {
  margin-top: 6px !important;
  font-size: 15px;
  font-weight: 700;
}

.empty-sub {
  margin-bottom: 10px !important;
  color: var(--label-2);
}

/* 경로 막대, 상태 막대 */
.path,
.status {
  flex: none;
  height: 24px;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 0 12px;
  border-top: 0.5px solid var(--sep);
  color: var(--label-2);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
}

.fd .crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 4px;
  border-radius: 4px;
}

.fd button.crumb:hover {
  background: var(--fill);
  color: var(--label);
}

.crumb.last {
  color: var(--label);
}

.sepc {
  flex: none;
  color: var(--label-3);
}

.zoom {
  width: 90px;
  height: 14px;
  margin: 0;
  accent-color: var(--label-2);
}

/* 훑어보기 */
.quick {
  position: absolute;
  inset: 0;
  z-index: 8;
  border-radius: inherit;
  display: grid;
  place-items: center;
  padding: 18px;
  background: color-mix(in srgb, var(--window) 50%, transparent);
  backdrop-filter: blur(6px);
}

.quick figure {
  display: flex;
  flex-direction: column;
  margin: 0;
  width: min(100%, 420px);
  max-height: 100%;
  border-radius: 16px;
  overflow: hidden;
  background: var(--panel);
  box-shadow: 0 0 0 0.5px var(--sep), 0 20px 50px rgba(0, 0, 0, 0.35);
  animation: ql-in 0.22s var(--spring, ease-out);
}

@keyframes ql-in {
  from {
    transform: scale(0.86);
    opacity: 0;
  }
}

.quick figcaption {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 600;
}

.quick figcaption > span {
  flex: 1;
  text-align: center;
}

.fd .ql-btn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--label-2);
}

.fd .ql-btn:hover {
  background: var(--fill);
  color: var(--label);
}

.quick img {
  image-rendering: pixelated;
  display: block;
  flex: 1;
  min-height: 0;
  width: 100%;
  object-fit: contain;
}

.ql-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 20px 26px;
}

.ql-icon p {
  margin: 6px 0 0;
  color: var(--label-2);
}

@media (prefers-reduced-motion: reduce) {
  .quick figure {
    animation: none;
  }
}
</style>
