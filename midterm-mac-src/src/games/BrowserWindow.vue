<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { load, nameCount, search, wordDoc, wordsIn } from '../data.js'
import { sfx } from '../sound.js'
import LmPage from './LmPage.vue'
import WebCover from './web/WebCover.vue'
import {
  BookOpen, Coffee, Croissant, Dessert, Drumstick, FileText, Flower2, Hammer, Mic, Pill, Scissors, Search, Shirt, Soup,
  BrainCircuit, Map as MapIcon, Star, Store, Newspaper, CalendarDays, Plus, ArrowUpRight, RefreshCw, ChevronDown,
} from 'lucide-vue-next'
import heroImg from '../assets/web-hero.webp'
import namesImg from '../assets/web-story-names.webp'
import shopsImg from '../assets/web-story-shops.webp'
import twinsImg from '../assets/web-story-twins.webp'
import modelImg from '../assets/web-story-model.webp'

// page·at: 바탕화면 파일처럼 밖에서 특정 페이지로 열 때. at 이 바뀌면 그 페이지로 간다
// q: 다른 창에서 간판 문서를 바로 열 때
const props = defineProps({ page: { type: String, default: '' }, q: { type: String, default: '' }, at: { type: Number, default: 0 } })
const emit = defineEmits(['open'])

// 사이트는 홈 · 간판 문서 · 간판 이야기 · 간판 모델 네 갈래. 출처는 모든 페이지 맨 아래에 둔다
// 주소는 흉내일 뿐 밖으로 나가지 않는다. 주소창에 다른 말을 넣으면 간판 검색으로 받는다
const HOST = '간판도감.kr'
const PAGES = [
  { id: 'home', path: '', title: '간판도감', icon: Star },
  { id: 'story', path: '이야기', title: '간판 이야기', icon: Newspaper },
  { id: 'lm', path: '모델', title: '간판 언어 모델', icon: BrainCircuit },
]
// 예전 통계 페이지 셋은 이야기 한 편씩이 됐다. 예전 주소·페이지 이름으로 와도 그 이야기를 연다
const STORIES = [
  { id: 'names', path: '흔한이름', old: ['순위', 'rank'], title: '제일 흔한 간판 이름', tab: '흔한 이름', desc: '체인과 동네 가게, 제일 많이 쓰인 이름', img: namesImg },
  { id: 'shops', path: '업종', old: ['업종', 'street'], title: '업종마다 즐겨 쓰는 말', tab: '업종', desc: '꽃집·빵집·카페 간판의 단골 낱말', img: shopsImg },
  { id: 'twins', path: '같은이름', old: ['똑같은이름', 'twins'], title: '똑같은 이름 가게', tab: '같은 이름', desc: '전국에, 한 건물에 같은 이름', img: twinsImg },
]
const SEARCH = { icon: FileText }
// 업종 탭 아이콘(street.json 의 key)
const CAT = {
  flower: Flower2, bread: Croissant, cafe: Coffee, pharm: Pill, ricecake: Dessert, laundry: Shirt,
  karaoke: Mic, hair: Scissors, chicken: Drumstick, book: BookOpen, hardware: Hammer, snack: Soup,
}
const pageOf = (id) => PAGES.find((p) => p.id === id)
const storyOf = (id) => STORIES.find((s) => s.id === id) || STORIES[0]
const storyFromOld = (key) => STORIES.find((s) => s.old.includes(key) || s.path === key || s.id === key)
const SUGGEST = ['행복', '사랑', '치킨', '꽃집', '바다', '엄마']
// 부동산·사무소 이름 조각은 순위를 덮어서 뺀다
const NOISE = new Set(['사무', '무소', '중개', '개사', '공인', '인중', '사사'])

const meta = ref(null)
const fame = ref(null)
const street = ref(null)
const twins = ref(null)
const failed = ref(false)
const STATS = ['meta', 'fame', 'street', 'twins']
const need = { home: STATS, story: STATS, lm: ['meta'], search: ['meta'] }
const store = { meta, fame, street, twins }
const fetching = {}
function ensure(names) {
  return Promise.all(
    names.map((n) => (fetching[n] ||= load(`${n}.json`).then((v) => (store[n].value = v)))),
  )
}

// 밖에서 온 page 값(예전 이름 포함)을 주소 한 칸으로
function urlOfPage(page) {
  if (pageOf(page)) return { p: page, t: page === 'story' ? 'names' : undefined }
  const s = storyFromOld(page)
  return s ? { p: 'story', t: s.id } : { p: 'home' }
}

// 탭마다 방문 기록을 따로 둔다
let tabSeq = 0
const newTab = (url = { p: 'home' }) => reactive({ id: ++tabSeq, stack: [url], at: 0, result: null })
const tabs = ref([newTab(props.q ? { p: 'search', q: props.q } : props.page ? urlOfPage(props.page) : undefined)])
const current = ref(tabs.value[0].id)
const tab = computed(() => tabs.value.find((t) => t.id === current.value))
const url = computed(() => tab.value.stack[tab.value.at])
const side = ref(false)
const progress = ref(0)
const pageEl = ref(null)

const titleOf = (u) => (u.p === 'search' ? `${u.q} — 간판 문서` : u.p === 'story' ? `${storyOf(u.t).title} — 간판 이야기` : pageOf(u.p).title)
const markOf = (u) => (u.p === 'search' ? SEARCH : pageOf(u.p))
const iconOf = (u) => markOf(u).icon
const pathOf = (u) => (u.p === 'search' ? `문서/${u.q}` : u.p === 'story' ? `이야기/${storyOf(u.t).path}` : pageOf(u.p).path)

// 간판 문서 한 장: 전수 통계(2~4글자 말) + 표본 간판 + 똑같은 이름 수. 통계가 없는 긴 이름은 이루는 말로 쪼갠다
const catNames = ref(null)
const tiles = ref(null)
async function lookup(q) {
  const word = q.trim()
  const [doc, found, same] = await Promise.all([
    wordDoc(word),
    search(word).catch(() => null),
    nameCount(word).catch(() => null),
    load('cats.json').then((v) => (catNames.value = v)),
    load('tiles/index.json').then((v) => (tiles.value = v)),
  ])
  const parts = doc ? [] : await wordsIn(word)
  return { word, doc, same, parts, ...(found || { count: 0, rows: [], exactCount: true }) }
}

// 긴 목록은 앞의 몇 개만 보이고 '더보기'로 편다. 페이지를 옮기면 다시 접는다
const more = reactive({})
const cut = (list, key, n = 5) => (more[key] ? list : list.slice(0, n))
const unfold = (key) => ((more[key] = true), sfx.click())

let loadSeq = 0
async function show(t) {
  const u = t.stack[t.at]
  const seq = ++loadSeq
  failed.value = false
  progress.value = 0.15
  for (const k of Object.keys(more)) delete more[k]
  requestAnimationFrame(() => seq === loadSeq && progress.value < 0.7 && (progress.value = 0.7))
  try {
    await ensure(need[u.p])
    if (u.p === 'search' && t.result?.word !== u.q) t.result = await lookup(u.q)
  } catch {
    if (seq === loadSeq) failed.value = true
  }
  if (seq !== loadSeq) return
  progress.value = 1
  setTimeout(() => seq === loadSeq && (progress.value = 0), 260)
  await nextTick()
  pageEl.value?.scrollTo(0, 0)
}
show(tab.value)

function go(next) {
  const t = tab.value
  const now = t.stack[t.at]
  if (next.p === now.p && next.q === now.q && next.t === now.t) return
  t.stack.splice(t.at + 1, Infinity, next)
  t.at++
  sfx.click()
  show(t)
}
function step(d) {
  const t = tab.value
  if (t.at + d < 0 || t.at + d >= t.stack.length) return
  t.at += d
  sfx.click()
  show(t)
}
const reload = () => (sfx.click(), show(tab.value))
const goStory = (id) => go({ p: 'story', t: id })

function addTab() {
  const t = newTab()
  tabs.value.push(t)
  current.value = t.id
  sfx.whoosh()
  show(t)
  nextTick(() => addr.value?.focus())
}
function closeTab(id) {
  if (tabs.value.length === 1) return
  const i = tabs.value.findIndex((t) => t.id === id)
  tabs.value.splice(i, 1)
  if (current.value === id) current.value = tabs.value[Math.max(0, i - 1)].id
  sfx.whoosh(false)
}
function pickTab(id) {
  if (current.value === id) return
  current.value = id
  show(tab.value)
}

// 주소창: 쓸 때는 전체 주소, 아닐 때는 가운데에 사이트 이름만
const addr = ref(null)
const typing = ref(false)
const draft = ref('')
function focusAddr() {
  typing.value = true
  const u = url.value
  draft.value = u.p === 'search' ? u.q : `${HOST}/${pathOf(u)}`
  nextTick(() => addr.value?.select())
}
function submitAddr() {
  const text = draft.value.trim().replace(/^https?:\/\//, '')
  addr.value?.blur()
  if (!text) return
  const path = text.startsWith(HOST) ? text.slice(HOST.length).replace(/^\//, '') : text
  if (path === '' || path === '출처') return go({ p: 'home' })
  if (path.startsWith('검색?q=')) return go({ p: 'search', q: decodeURIComponent(path.slice(5)) })
  if (path.startsWith('문서/')) return go({ p: 'search', q: decodeURIComponent(path.slice(3)) })
  if (path.startsWith('이야기')) return goStory(storyFromOld(path.slice(4))?.id || 'names')
  const old = storyFromOld(path)
  if (old) return goStory(old.id)
  const page = PAGES.find((p) => p.path && (p.path === path || p.title === path))
  if (page) return go(urlOfPage(page.id))
  go({ p: 'search', q: path })
}
const ask = (q) => go({ p: 'search', q })
const homeQ = ref('')
// 시작 페이지 큰 카드: 자주 찾는 말 하나를 골라 간판 수를 보여 준다
const hero = reactive({ at: Math.floor(Math.random() * SUGGEST.length), n: null })
const heroWord = computed(() => SUGGEST[hero.at])
function loadHero() {
  const w = heroWord.value
  hero.n = null
  wordDoc(w).then((d) => heroWord.value === w && (hero.n = d?.n ?? 0)).catch(() => (hero.n = 0))
}
function nextHero() {
  hero.at = (hero.at + 1) % SUGGEST.length
  sfx.click()
  loadHero()
}
loadHero()
watch(
  () => props.at,
  () => (props.q ? go({ p: 'search', q: props.q }) : props.page && go(urlOfPage(props.page))),
)

// 검색 결과: 위치가 있는 표본으로 지역·업종을 센다
const found = computed(() => {
  const r = tab.value.result
  if (!r || url.value.p !== 'search' || r.word !== url.value.q) return null
  const rows = r.rows.filter((x) => x.exact).length ? r.rows.filter((x) => x.exact) : r.rows
  const by = (key) => {
    const m = new Map()
    for (const row of rows) m.set(row[key], (m.get(row[key]) || 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }
  const names = new Map()
  for (const row of rows) names.set(row.name, (names.get(row.name) || 0) + 1)
  return { ...r, sample: rows.length, regions: by('region'), cats: by('cat'), names: [...names].sort((a, b) => b[1] - a[1]).slice(0, 12) }
})

// 숫자로 쓰는 문서. 문장은 모두 위 통계에서 나온다
const SIDO_LABEL = { 전남광주: '광주·전남' }
// 받침 여부. 한글이 아니면 읽는 소리로: 숫자 0·1·3·6·7·8, 영문 L·M·N·R 은 받침이 있다
const batchim = (w) => {
  const c = w.charCodeAt(w.length - 1)
  if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 !== 0
  return /[013678lmnr]$/i.test(w)
}
const eun = (w) => `‘${w}’${batchim(w) ? '은' : '는'}`
const iga = (w) => `‘${w}’${batchim(w) ? '이' : '가'}`
const yeyo = (w) => `${w}${batchim(w) ? '이에요' : '예요'}`
const ieyo = (w) => `‘${w}’${batchim(w) ? '이에요' : '예요'}`
const tenth = (part, whole) => Math.round((part / whole) * 10)
// 몫을 말로: 50% 넘으면 '열에 n곳', 아니면 'n곳 중 1곳'
const shareWords = (p) => (p >= 50 ? `열에 ${Math.round(p / 10)}곳` : `${Math.round(100 / p)}곳 중 1곳`)
const doc = computed(() => {
  const r = tab.value.result
  if (!r?.doc || url.value.p !== 'search' || !catNames.value || !tiles.value) return null
  const d = r.doc
  const w = r.word
  const all = tiles.value.total
  const sido = Object.entries(tiles.value.regions)
    .map(([k, reg], i) => ({ name: SIDO_LABEL[k] || k, n: d.s[i], lift: d.s[i] / d.n / (reg.count / all) }))
    .sort((a, b) => b.n - a.n)
  const cats = d.c.map(([c, n]) => [catNames.value[c], n])
  const mid = Math.max(0, d.n - d.p[0] - d.p[1] - d.p[2])
  const pos = [
    { key: 'start', label: '맨 앞', n: d.p[0], eg: `${w}○○` },
    { key: 'mid', label: '가운데', n: mid, eg: `○${w}○` },
    { key: 'end', label: '맨 끝', n: d.p[1], eg: `○○${w}` },
    { key: 'whole', label: '이름 전체', n: d.p[2], eg: w },
  ]
  const lead = [...pos].sort((a, b) => b.n - a.n)[0]
  const floorKnown = d.f[0] + d.f[1] + d.f[2]
  const hot = sido.filter((x) => x.n >= 30 && x.lift >= 1.25).sort((a, b) => b.lift - a.lift)[0]
  const lines = []
  const per = (d.n / all) * 10000
  const perText = per >= 10 ? Math.round(per) : per.toFixed(1)
  lines.push(`${eun(w)} 전국 간판 ${fmt(d.n)}곳에 들어간 말이에요. 간판 1만 개 중 ${perText}개꼴이에요.`)
  if (lead.key === 'whole') lines.push(`이름이 딱 ‘${w}’뿐인 간판이 가장 많아요(${fmt(d.p[2])}곳).`)
  else if (lead.n / d.n >= 0.5) lines.push(`열에 ${tenth(lead.n, d.n)}곳은 이름 ${lead.label}에 와서 ‘${lead.eg}’처럼 쓰여요.`)
  else lines.push(`이름 어디에 오는지는 고르게 섞여 있고, ${lead.label}(${pct(lead.n, d.n)})이 조금 더 많아요.`)
  if (d.a[0] && d.a[0][1] / d.n >= 0.1) lines.push(`뒤에는 ${iga(d.a[0][0])} 가장 자주 붙어요(‘${w}${d.a[0][0]}…’ ${fmt(d.a[0][1])}곳).`)
  if (d.b[0] && d.b[0][1] / d.n >= 0.1) lines.push(`앞에는 ${iga(d.b[0][0])} 가장 자주 와요(‘…${d.b[0][0]}${w}’ ${fmt(d.b[0][1])}곳).`)
  const [topCat, topN] = cats[0]
  lines.push(
    topN / d.n >= 0.6
      ? `${pct(topN, d.n)}가 ${topCat} 간판이라, 사실상 ${topCat}의 말이에요.`
      : `가장 많이 쓰는 업종은 ${topCat}(${pct(topN, d.n)})이고, ${cats[1] ? `${cats[1][0]}(${pct(cats[1][1], d.n)})가 뒤를 이어요.` : '다른 업종은 드물어요.'}`,
  )
  if (hot && d.n >= 200) lines.push(`${hot.name}에 특히 많아요. 전체 간판 비율로 치면 ${hot.lift.toFixed(1)}배예요.`)
  // 간판 기준: 전국에 하나뿐인 이름을 단 간판의 비율
  const own = d.u[1] / d.n
  lines.push(
    `이 말이 들어간 이름은 ${fmt(d.u[0])}가지예요. 간판 ${pct(d.u[1], d.n)}는 전국에 하나뿐인 이름을 달고 있어요.${own >= 0.6 ? ' 가게마다 제 이름을 지어 붙이는 말이에요.' : own < 0.2 ? ' 똑같은 이름을 여러 가게가 나눠 다는 말이에요.' : ''}`,
  )
  // 큰 숫자 칸: 한눈에 볼 것만
  const spot = d.h[2] >= 3 ? { region: d.h[3], n: d.h[2] } : null
  const stats = [
    { k: '이름 속 자리', v: pct(lead.n, d.n), s: `${lead.label} ‘${lead.eg}’` },
    { k: '많은 업종', v: topCat, s: pct(topN, d.n) },
    hot && d.n >= 200
      ? { k: '특히 많은 곳', v: hot.name, s: `전체 비율의 ×${hot.lift.toFixed(1)}` }
      : { k: '많은 시도', v: sido[0].name, s: `${fmt(sido[0].n)}곳` },
    { k: '서로 다른 이름', v: `${fmt(d.u[0])}가지`, s: `평균 ${(d.l / 10).toFixed(1)}글자` },
  ]
  if (floorKnown >= 20) stats.push({ k: '1층 가게', v: pct(d.f[1], floorKnown), s: '층 정보가 있는 간판 중' })
  // 시군구까지 붙은 긴 지역 이름은 끝 단위만 크게 쓰고 앞은 아래 줄로 내린다
  const area = spot?.region.split(' ') || []
  if (spot) stats.push({ k: '가장 몰린 곳', v: `${area.at(-1)} 부근`, s: `${area.length > 1 ? `${area.slice(0, -1).join(' ')} · ` : ''}1km 안 ${spot.n}곳` })
  const stick = [
    ...d.b.filter(([, n]) => n >= 3).map(([c, n]) => ({ word: c + w, n, side: 'b' })),
    ...d.a.filter(([, n]) => n >= 3).map(([c, n]) => ({ word: w + c, n, side: 'a' })),
  ].sort((x, y) => y.n - x.n)
  return { w, d, sido: sido.filter((x) => x.n > 0).slice(0, 8), cats, pos, lines, stats, stick, perText }
})
const coverSub = computed(() => {
  const f = found.value
  if (!f) return ''
  if (doc.value) return `간판 ${fmt(doc.value.d.n)}곳 · 1만 곳당 ${doc.value.perText}곳`
  if (f.same > 1) return `이 이름 그대로 전국 ${fmt(f.same)}곳`
  if (f.same === 0 && f.rows.some((x) => x.name === f.word)) return '전국에 딱 한 곳'
  return f.parts.length ? `낱말 ${f.parts.length}개로 이루어진 이름` : '간판 문서'
})

// ── 간판 이야기 ─────────────────────────────
const words = computed(() => fame.value?.words.filter(([w]) => !NOISE.has(w)).sort((a, b) => b[1] - a[1]))
const shopKey = ref('cafe')
const shop = computed(() => street.value?.find((s) => s.key === shopKey.value))
const story = computed(() => storyOf(url.value.t))
const longest = computed(() => fame.value?.longest.slice().sort((a, b) => b.length - a.length))
// 홈 이야기 카드의 한 줄. 메뉴 이름 대신 숫자 한 줄을 보여 준다
const teaser = computed(() => {
  const cafe = street.value?.find((s) => s.key === 'cafe')
  return {
    names: fame.value ? `체인 아닌데 제일 많은 이름 ‘${fame.value.indie[0][0]}’` : '제일 흔한 간판 이름',
    shops: cafe ? `카페 간판 ${shareWords(cafe.wordShare)}엔 ‘${cafe.word}’` : '업종마다 즐겨 쓰는 말',
    twins: twins.value ? `한 건물에 같은 간판 ${twins.value.clusters[0][2]}개` : '똑같은 이름 가게',
  }
})
const pickShop = (key) => ((shopKey.value = key), (more.shopIndie = false), (more.shopChain = false), sfx.click())

const fmt = (n) => n.toLocaleString('ko-KR')
const pct = (part, whole) => `${((part / whole) * 100).toFixed(part / whole < 0.01 ? 2 : 1)}%`
const width = (v, max) => `${Math.max(1.5, (v / max) * 100)}%`

function onKey(e) {
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key === 'l') (e.preventDefault(), addr.value?.focus())
  else if (mod && e.key === 't') (e.preventDefault(), addTab())
  else if (mod && e.key === 'w' && tabs.value.length > 1) (e.preventDefault(), closeTab(current.value))
  else if (mod && e.key === '[') step(-1)
  else if (mod && e.key === ']') step(1)
}
</script>

<template>
  <div class="br" tabindex="-1" @keydown="onKey">
    <header class="br-bar">
      <button class="br-ico" :class="{ on: side }" title="사이드바" @click="side = !side">
        <svg viewBox="0 0 20 16" width="18" height="14"><rect x="1" y="1" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M7 1v14" stroke="currentColor" stroke-width="1.4" /></svg>
      </button>
      <div class="br-nav">
        <button class="br-ico" :disabled="tab.at === 0" title="뒤로" @click="step(-1)">
          <svg viewBox="0 0 10 16" width="9" height="14"><path d="M8 2 2 8l6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <button class="br-ico" :disabled="tab.at === tab.stack.length - 1" title="앞으로" @click="step(1)">
          <svg viewBox="0 0 10 16" width="9" height="14"><path d="m2 2 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </div>
      <form class="br-addr" :class="{ typing }" @submit.prevent="submitAddr">
        <input
          ref="addr"
          v-model="draft"
          type="text"
          aria-label="주소 또는 간판 이름"
          spellcheck="false"
          @focus="focusAddr"
          @blur="typing = false"
          @keydown.esc="addr.blur()"
        />
        <span v-if="!typing" class="br-show" @mousedown.prevent="addr.focus()">
          <svg viewBox="0 0 10 12" width="9" height="11"><rect x="1" y="5" width="8" height="6.5" rx="1.5" fill="currentColor" /><path d="M3 5V3.6a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" stroke-width="1.3" /></svg>
          {{ url.p === 'search' ? `${url.q} — 간판 문서` : HOST }}
        </span>
        <button v-if="!typing" type="button" class="br-reload" title="새로 고침" @mousedown.prevent @click="reload">
          <svg viewBox="0 0 16 16" width="12" height="12"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <i class="br-progress" :style="{ transform: `scaleX(${progress})`, opacity: progress ? 1 : 0 }"></i>
      </form>
      <button class="br-ico" title="새 탭 (⌘T)" @click="addTab">
        <svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
      </button>
    </header>

    <nav v-if="tabs.length > 1" class="br-tabs">
      <div v-for="t in tabs" :key="t.id" class="br-tab" :class="{ on: t.id === current }" @click="pickTab(t.id)">
        <button class="br-x" title="탭 닫기" @click.stop="closeTab(t.id)">×</button>
        <component :is="iconOf(t.stack[t.at])" class="fav" :size="14" :stroke-width="2" />
        <span class="t">{{ titleOf(t.stack[t.at]) }}</span>
      </div>
    </nav>

    <div class="br-main">
      <aside v-if="side" class="br-side">
        <h4>즐겨찾기</h4>
        <button v-for="p in PAGES" :key="p.id" :class="{ on: url.p === p.id && p.id !== 'story' }" @click="go(urlOfPage(p.id))">
          <component :is="p.icon" class="fav" :size="15" :stroke-width="2" />{{ p.title }}
        </button>
        <button v-for="s in STORIES" :key="s.id" class="sub" :class="{ on: url.p === 'story' && url.t === s.id }" @click="goStory(s.id)">
          <span class="fav"></span>{{ s.tab }}
        </button>
        <h4>방문 기록</h4>
        <button v-for="(u, i) in tab.stack.slice().reverse().slice(0, 8)" :key="i" @click="go(u)">
          <component :is="iconOf(u)" class="fav" :size="15" :stroke-width="2" />{{ titleOf(u) }}
        </button>
      </aside>

      <main ref="pageEl" class="br-page">
        <div v-if="failed" class="br-fail">
          <b>페이지를 열 수 없음</b>
          <p>간판 자료를 불러오지 못했어요.</p>
          <button class="go" @click="reload">다시 시도</button>
        </div>

        <!-- 홈 -->
        <section v-else-if="url.p === 'home'" class="home">
          <div class="site-top">
            <span class="pill"><CalendarDays :size="14" :stroke-width="2" />{{ meta ? `${meta.date} 기준` : '간판도감' }}</span>
            <b class="logo">간판도감</b>
            <span class="pill">{{ meta ? `${fmt(meta.total)}곳` : '…' }}</span>
          </div>

          <WebCover class="home-hero" size="tall" :img="heroImg" :title="heroWord" :busy="hero.n === null" :sub="hero.n === null ? '간판 세는 중' : hero.n ? `간판 ${fmt(hero.n)}곳에 들어간 말` : '간판 문서'">
            <button class="who" title="다른 말" @click="nextHero">
              <span class="av"><RefreshCw :size="15" :stroke-width="2.2" /></span>
              <span><b>오늘의 간판 말</b><small>눌러서 바꾸기</small></span>
            </button>
            <button class="more" @click="ask(heroWord)"><Plus :size="18" :stroke-width="2.4" />문서 보기</button>
          </WebCover>

          <form class="home-q" @submit.prevent="homeQ.trim() && ask(homeQ.trim())">
            <Search :size="17" :stroke-width="2.2" />
            <input v-model="homeQ" type="text" placeholder="간판 이름이나 낱말을 찾아보세요" spellcheck="false" />
            <button class="go" type="submit">찾기</button>
          </form>
          <div class="chips center">
            <button v-for="s in SUGGEST" :key="s" @click="ask(s)">{{ s }}</button>
          </div>

          <div class="shelf-head">
            <h2>간판 이야기</h2>
            <button class="link" @click="goStory('names')">모두 보기<ArrowUpRight :size="14" :stroke-width="2.2" /></button>
          </div>
          <div class="shelf">
            <button v-for="s in STORIES" :key="s.id" class="shelf-card" @click="goStory(s.id)">
              <WebCover size="mini" :img="s.img" kicker="이야기" :title="teaser[s.id]" :sub="s.title" />
            </button>
            <button class="shelf-card" @click="go({ p: 'lm' })">
              <WebCover size="mini" :img="modelImg" kicker="모델" title="간판 이름만 읽고 배운 작은 AI" sub="다음 글자를 직접 뽑아 보기" />
            </button>
          </div>
          <button class="map-row" @click="emit('open', 'building')">
            <span class="av ink"><MapIcon :size="16" :stroke-width="2.2" /></span>
            <span><b>간판 지도</b><small>내 주변 간판을 지도에서 보기</small></span>
            <ArrowUpRight :size="16" :stroke-width="2" />
          </button>
        </section>

        <!-- 간판 이야기 -->
        <section v-else-if="url.p === 'story' && fame && street && twins && meta" class="doc">
          <WebCover :img="story.img" kicker="간판 이야기" :title="story.title" :sub="story.desc" />
          <div class="tabs" role="tablist">
            <button v-for="s in STORIES" :key="s.id" role="tab" :aria-selected="s.id === story.id" :class="{ on: s.id === story.id }" @click="goStory(s.id)">{{ s.tab }}</button>
          </div>

          <!-- 흔한 이름 -->
          <template v-if="story.id === 'names'">
            <article class="block">
              <h2 class="head">체인이 아닌데 제일 많은 이름은 {{ ieyo(fame.indie[0][0]) }}</h2>
              <p class="lede">가게마다 따로 지었는데 전국 {{ fmt(fame.indie[0][1]) }}곳이 같은 이름을 달았어요. 간판 {{ fmt(meta.total) }}개, 서로 다른 이름 {{ fmt(meta.names) }}개를 셌어요.</p>
              <div class="podium">
                <button v-for="([name, count], i) in fame.indie.slice(0, 3)" :key="name" class="pod" @click="ask(name)">
                  <span class="pod-rk">{{ i + 1 }}</span><b>{{ name }}</b><small>{{ fmt(count) }}곳</small>
                </button>
              </div>
              <div class="chips">
                <button v-for="([name, count], i) in fame.indie.slice(3)" :key="name" @click="ask(name)"><em>{{ i + 4 }}</em>{{ name }} <small>{{ fmt(count) }}</small></button>
              </div>
            </article>
            <article class="block">
              <h2 class="head">프랜차이즈는 {{ iga(fame.chains[0][0]) }} 제일 많아요</h2>
              <p class="lede">전국 간판 1,000개 중 {{ Math.round((fame.chains[0][1] / meta.total) * 1000) }}개가 {{ yeyo(fame.chains[0][0]) }}. 지점 이름이 붙은 간판도 브랜드로 묶어 셌어요.</p>
              <div class="podium">
                <div v-for="([name, count], i) in fame.chains.slice(0, 3)" :key="name" class="pod">
                  <span class="pod-rk">{{ i + 1 }}</span><b>{{ name }}</b><small>{{ fmt(count) }}곳</small>
                </div>
              </div>
              <div class="chips">
                <span v-for="([name, count], i) in fame.chains.slice(3)" :key="name" class="chip"><em>{{ i + 4 }}</em>{{ name }} <small>{{ fmt(count) }}</small></span>
              </div>
            </article>
            <article class="block">
              <h2 class="head">간판에 제일 많이 들어간 두 글자</h2>
              <p class="lede">부동산·사무소 이름 조각(사무·중개·공인…)은 빼고 셌어요. 누르면 그 말의 문서가 열려요.</p>
              <div class="chips">
                <button v-for="[w, c] in cut(words, 'words', 12)" :key="w" @click="ask(w)">{{ w }} <small>{{ fmt(c) }}</small></button>
                <button v-if="!more.words && words.length > 12" class="fold" @click="unfold('words')">더보기<ChevronDown :size="13" :stroke-width="2.4" /></button>
              </div>
              <h3 class="sub-head">한 글자 간판</h3>
              <div class="chips">
                <button v-for="[w, c] in fame.oneChar" :key="w" @click="ask(w)">{{ w }} <small>{{ fmt(c) }}곳</small></button>
              </div>
            </article>
            <article class="block">
              <h2 class="head">제일 긴 간판 이름은 {{ longest[0].length }}글자</h2>
              <p class="big-name">{{ longest[0] }}</p>
              <ol v-if="more.long" class="long">
                <li v-for="name in longest.slice(1)" :key="name">{{ name }} <small>{{ name.length }}자</small></li>
              </ol>
              <button v-else class="fold" @click="unfold('long')">다른 긴 이름 {{ longest.length - 1 }}개<ChevronDown :size="13" :stroke-width="2.4" /></button>
            </article>
          </template>

          <!-- 업종 -->
          <template v-else-if="story.id === 'shops' && shop">
            <div class="scroller" role="tablist">
              <button v-for="s in street" :key="s.key" role="tab" :aria-selected="s.key === shopKey" :class="{ on: s.key === shopKey }" @click="pickShop(s.key)">
                <component :is="CAT[s.key] || Store" :size="14" :stroke-width="2" />{{ s.label }}
              </button>
            </div>
            <article class="block">
              <h2 class="head">{{ shop.label }} 간판 {{ shareWords(shop.wordShare) }}엔 {{ iga(shop.word) }} 들어가요</h2>
              <div class="stats">
                <div class="stat"><small>전국 {{ shop.label }}</small><b>{{ fmt(shop.total) }}곳</b><span>‘{{ shop.word }}’ {{ shop.wordShare }}%</span></div>
                <div class="stat"><small>동네 가게</small><b>{{ (100 - shop.chainShare).toFixed(1) }}%</b><span>프랜차이즈 아닌 곳</span></div>
                <div class="stat"><small>프랜차이즈</small><b>{{ shop.chainShare }}%</b><span>{{ shop.chains[0] ? `1등 ${shop.chains[0][0]}` : '거의 없어요' }}</span></div>
              </div>
              <div class="share-bar">
                <span class="sw-indie" :style="{ width: `${100 - shop.chainShare}%` }"></span>
                <span class="sw-chain" :style="{ width: `${shop.chainShare}%` }"></span>
              </div>
              <p class="legend"><span><i class="sw-indie"></i>동네 가게</span><span><i class="sw-chain"></i>프랜차이즈</span></p>
            </article>
            <article class="block">
              <h2 class="head">동네 {{ shop.label }} 이름은 {{ iga(shop.top[0][0]) }} 제일 많아요</h2>
              <div class="podium">
                <button v-for="([name, count], i) in shop.top.slice(0, 3)" :key="name" class="pod" @click="ask(name)">
                  <span class="pod-rk">{{ i + 1 }}</span><b>{{ name }}</b><small>{{ fmt(count) }}곳</small>
                </button>
              </div>
              <div class="chips">
                <button v-for="([name, count], i) in shop.top.slice(3)" :key="name" @click="ask(name)"><em>{{ i + 4 }}</em>{{ name }} <small>{{ fmt(count) }}</small></button>
              </div>
            </article>
            <article v-if="shop.chains.length" class="block">
              <h2 class="head">프랜차이즈 {{ shop.label }}는 {{ iga(shop.chains[0][0]) }} 1등</h2>
              <div class="podium">
                <div v-for="([name, count], i) in shop.chains.slice(0, 3)" :key="name" class="pod">
                  <span class="pod-rk">{{ i + 1 }}</span><b>{{ name }}</b><small>{{ fmt(count) }}곳 · {{ pct(count, shop.total) }}</small>
                </div>
              </div>
              <div class="chips">
                <span v-for="([name, count], i) in shop.chains.slice(3)" :key="name" class="chip"><em>{{ i + 4 }}</em>{{ name }} <small>{{ fmt(count) }}</small></span>
              </div>
            </article>
          </template>

          <!-- 같은 이름 -->
          <template v-else-if="story.id === 'twins'">
            <article class="block">
              <h2 class="head">전국에 똑같은 간판이 제일 많은 이름은 {{ ieyo(twins.top[0][0]) }}</h2>
              <p class="lede">상호명이 글자 하나까지 같은 간판만 셌어요. 체인은 흐리게 표시했어요.</p>
              <div class="podium">
                <button v-for="([name, count, chain], i) in twins.top.slice(0, 3)" :key="name" class="pod" @click="ask(name)">
                  <span class="pod-rk">{{ i + 1 }}</span><b>{{ name }}</b><small>{{ fmt(count) }}곳{{ chain ? ' · 체인' : '' }}</small>
                </button>
              </div>
              <div class="chips">
                <button v-for="([name, count, chain], i) in cut(twins.top.slice(3), 'twins', 12)" :key="name" :class="{ dim: chain }" @click="ask(name)"><em>{{ i + 4 }}</em>{{ name }} <small>{{ fmt(count) }}</small></button>
                <button v-if="!more.twins && twins.top.length > 15" class="fold" @click="unfold('twins')">더보기<ChevronDown :size="13" :stroke-width="2.4" /></button>
              </div>
            </article>
            <article class="block">
              <h2 class="head">한 건물에 같은 간판이 {{ twins.clusters[0][2] }}개 붙은 곳도 있어요</h2>
              <p class="lede">같은 주소에 같은 이름으로 따로 등록된 가게들이에요. 상가 조합, 시장, 큰 회사 사무실이 많아요.</p>
              <div class="places">
                <div v-for="[name, address, count] in cut(twins.clusters, 'places', 6)" :key="name + address" class="place">
                  <b>{{ name }}</b><small>{{ address }}</small><span class="x">×{{ count }}</span>
                </div>
              </div>
              <button v-if="!more.places && twins.clusters.length > 6" class="fold" @click="unfold('places')">{{ twins.clusters.length - 6 }}곳 더 보기<ChevronDown :size="13" :stroke-width="2.4" /></button>
            </article>
          </template>
        </section>

        <!-- 간판 문서 -->
        <section v-else-if="url.p === 'search' && found" class="doc wiki">
          <WebCover :img="heroImg" :kicker="doc ? '간판 낱말' : '간판 이름'" :title="found.word" :sub="coverSub">
            <span></span>
            <button class="more" @click="emit('open', 'building')"><MapIcon :size="16" :stroke-width="2.2" />지도에서 찾기</button>
          </WebCover>

          <template v-if="doc">
            <div class="stats">
              <div v-for="s in doc.stats" :key="s.k" class="stat"><small>{{ s.k }}</small><b>{{ s.v }}</b><span>{{ s.s }}</span></div>
            </div>
            <article class="block">
              <h2 class="head">한눈에</h2>
              <p v-for="(line, i) in doc.lines" :key="i" class="prose">{{ line }}</p>
            </article>

            <article class="block">
              <h2 class="head">이름 어디에 붙나</h2>
              <div class="share-bar pos">
                <span v-for="p in doc.pos" :key="p.key" :class="`pos-${p.key}`" :style="{ width: `${(p.n / doc.d.n) * 100}%` }" :title="`${p.label} ${fmt(p.n)}곳`"></span>
              </div>
              <p class="legend">
                <span v-for="p in doc.pos" :key="p.key"><i :class="`pos-${p.key}`"></i>{{ p.label }} ‘{{ p.eg }}’ {{ pct(p.n, doc.d.n) }}</span>
              </p>
              <template v-if="doc.stick.length">
                <h3 class="sub-head">자주 붙어 다니는 말</h3>
                <div class="chips">
                  <button v-for="s in cut(doc.stick, 'stick', 10)" :key="s.word" @click="ask(s.word)">{{ s.side === 'b' ? '…' : '' }}{{ s.word }}{{ s.side === 'a' ? '…' : '' }} <small>{{ fmt(s.n) }}</small></button>
                  <button v-if="!more.stick && doc.stick.length > 10" class="fold" @click="unfold('stick')">더보기<ChevronDown :size="13" :stroke-width="2.4" /></button>
                </div>
              </template>
            </article>

            <div class="cols">
              <article class="block">
                <h2 class="head">무슨 가게에 쓰나</h2>
                <ol class="bars">
                  <li v-for="([name, count], i) in cut(doc.cats, 'cats')" :key="name" :title="`${name} ${fmt(count)}곳`">
                    <span class="rk">{{ i + 1 }}</span><span class="nm">{{ name }}</span><span class="ct">{{ pct(count, doc.d.n) }}</span>
                    <i :style="{ width: width(count, doc.cats[0][1]) }"></i>
                  </li>
                </ol>
                <button v-if="!more.cats && doc.cats.length > 5" class="fold" @click="unfold('cats')">더보기<ChevronDown :size="13" :stroke-width="2.4" /></button>
              </article>
              <article class="block">
                <h2 class="head">어디에 많나</h2>
                <ol class="bars">
                  <li v-for="(x, i) in cut(doc.sido, 'sido')" :key="x.name" :title="`${x.name} ${fmt(x.n)}곳 · 전체 간판 비율의 ${x.lift.toFixed(2)}배`">
                    <span class="rk">{{ i + 1 }}</span>
                    <span class="nm">{{ x.name }}<em v-if="doc.d.n >= 200 && x.n >= 30 && x.lift >= 1.25" class="lift">×{{ x.lift.toFixed(1) }}</em></span>
                    <span class="ct">{{ fmt(x.n) }}곳</span>
                    <i :style="{ width: width(x.n, doc.sido[0].n) }"></i>
                  </li>
                </ol>
                <button v-if="!more.sido && doc.sido.length > 5" class="fold" @click="unfold('sido')">더보기<ChevronDown :size="13" :stroke-width="2.4" /></button>
                <p class="note">×배수 = 이 말이 그 시도에 있는 비율 ÷ 전체 간판이 그 시도에 있는 비율. 1.25배 넘는 곳만 표시해요.</p>
              </article>
            </div>

            <article class="block">
              <h2 class="head">제일 많이 쓰인 이름</h2>
              <div class="chips">
                <button v-for="[name, count] in doc.d.m" :key="name" @click="ask(name)">{{ name }} <small>{{ fmt(count) }}곳</small></button>
              </div>
            </article>
          </template>

          <template v-else>
            <article v-if="found.parts.length || found.same > 1 || !found.count" class="block">
              <p v-if="found.same > 1" class="prose">‘{{ found.word }}’ 이름 그대로인 간판이 전국에 <b>{{ fmt(found.same) }}곳</b> 있어요.</p>
              <p v-else-if="found.same === 0 && found.rows.some((x) => x.name === found.word)" class="prose">‘{{ found.word }}’라는 이름은 전국에 <b>딱 한 곳</b>뿐이에요.</p>
              <template v-if="found.parts.length">
                <h2 class="head">이루는 말</h2>
                <p class="lede">하나씩 눌러 보면 각각의 문서가 열려요.</p>
                <div class="podium">
                  <button v-for="[w, n] in found.parts" :key="w" class="pod" @click="ask(w)"><b>{{ w }}</b><small>간판 {{ fmt(n) }}곳</small></button>
                </div>
              </template>
              <p v-if="!found.parts.length && !found.count" class="lede">이 말로 쓸 수 있는 문서가 없어요. 한글 두 글자 이상으로 찾아 주세요.</p>
            </article>
          </template>

          <article v-if="found.count && found.sample" class="block">
            <h2 class="head">실제 간판 몇 곳</h2>
            <div class="chips">
              <span v-for="[name, count] in found.names" :key="name" class="chip">{{ name }}<small v-if="count > 1"> ×{{ count }}</small></span>
            </div>
            <p class="note">위치가 담긴 표본 {{ fmt(found.sample) }}곳에서 골랐어요. 많은 지역: {{ found.regions.slice(0, 3).map(([n]) => n).join(', ') }}.</p>
          </article>

          <p class="note fine">이 문서의 숫자와 문장은 상호명이 비어 있지 않은 간판을 모두 세어 자동으로 썼어요. 한글 2~4글자 말만 문서가 있고, 한 간판에 같은 말이 두 번 나와도 한 곳으로 셌어요. ‘가장 몰린 곳’ 지역 이름은 가장 가까운 시군구 중심으로 붙인 것이라 경계 근처에선 다를 수 있어요.</p>
        </section>

        <!-- 간판 언어 모델 -->
        <section v-else-if="url.p === 'lm'" class="doc">
          <WebCover :img="modelImg" kicker="간판 모델" title="간판 언어 모델" sub="간판 이름만 읽고 배운 작은 모델" />
          <LmPage class="lm-in" @ask="ask" />
        </section>

        <div v-else class="br-wait">불러오는 중…</div>

        <footer v-if="!failed && meta" class="site-foot">
          <span class="av logo-av">간</span>
          <span class="foot-src"><b>{{ HOST }}</b><small>{{ meta.source }} · {{ meta.date }} 기준 · 간판 {{ fmt(meta.total) }}개 · 서로 다른 이름 {{ fmt(meta.names) }}개 · 업종 {{ meta.categories }}가지</small></span>
          <nav class="foot-links">
            <button @click="go({ p: 'home' })">홈</button>
            <button @click="goStory('names')">이야기</button>
            <button @click="go({ p: 'lm' })">모델</button>
            <button @click="emit('open', 'building')">지도</button>
          </nav>
        </footer>
      </main>
    </div>
  </div>
</template>

<style scoped>
.br {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--window);
  outline: none;
}

/* 툴바: Safari 처럼 창 바탕색 위에 가운데 주소창 */
.br-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 10px;
  flex: none;
  border-bottom: 0.5px solid var(--sep);
}

.br-nav {
  display: flex;
}

.br .br-ico {
  display: grid;
  place-items: center;
  width: 30px;
  height: 28px;
  min-height: 0;
  padding: 0;
  border-radius: 6px;
  background: transparent;
  box-shadow: none;
  color: var(--label-2);
}

.br .br-ico:hover:not(:disabled),
.br .br-ico.on {
  background: var(--fill);
  color: var(--label);
}

.br .br-ico:disabled {
  color: var(--label-3);
}

.br-addr {
  position: relative;
  flex: 1;
  max-width: 520px;
  margin: 0 auto;
  height: 30px;
}

.br .br-addr input {
  width: 100%;
  height: 30px;
  padding: 0 30px 0 12px;
  border-radius: 9px;
  background: var(--fill);
  box-shadow: none;
  color: transparent;
  font-size: 13px;
}

.br .br-addr.typing input {
  color: var(--label);
  background: var(--field);
  box-shadow: inset 0 0 0 0.5px var(--field-ring), 0 0 0 3.5px rgba(10, 132, 255, 0.45);
}

.br-show {
  position: absolute;
  inset: 0 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-size: 13px;
  color: var(--label);
  white-space: nowrap;
  overflow: hidden;
  cursor: text;
}

.br-show svg {
  color: var(--label-2);
}

.br .br-reload {
  position: absolute;
  right: 3px;
  top: 3px;
  width: 24px;
  height: 24px;
  min-height: 0;
  padding: 0;
  display: grid;
  place-items: center;
  background: transparent;
  box-shadow: none;
  color: var(--label-2);
}

.br-progress {
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
  transform-origin: left;
  transition: transform 0.3s ease-out, opacity 0.25s;
}

/* 탭 줄 */
.br-tabs {
  display: flex;
  gap: 4px;
  padding: 5px 8px;
  flex: none;
  border-bottom: 0.5px solid var(--sep);
  background: var(--window-2);
}

.br-tab {
  position: relative;
  flex: 1;
  min-width: 0;
  max-width: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 26px;
  padding: 0 26px;
  border-radius: 7px;
  font-size: 12px;
  color: var(--label-2);
  cursor: default;
}

.br-tab:hover {
  background: var(--fill);
}

.br-tab.on {
  background: var(--seg-on);
  color: var(--label);
  box-shadow: 0 0 0 0.5px var(--control-ring), 0 1px 2px rgba(0, 0, 0, 0.12);
}

.br-tab .t {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.br .br-x {
  position: absolute;
  left: 5px;
  width: 16px;
  height: 16px;
  min-height: 0;
  padding: 0;
  border-radius: 4px;
  background: transparent;
  box-shadow: none;
  font-size: 13px;
  line-height: 16px;
  color: var(--label-2);
  opacity: 0;
}

.br-tab:hover .br-x {
  opacity: 1;
}

.br .br-x:hover {
  background: var(--fill-hover);
}

.br-main {
  flex: 1;
  min-height: 0;
  display: flex;
}

.br-side {
  width: 190px;
  flex: none;
  padding: 10px 8px;
  overflow: auto;
  border-right: 0.5px solid var(--sep);
  background: var(--window-2);
}

.br-side h4 {
  margin: 10px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--label-2);
}

.br .br-side button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 26px;
  padding: 0 8px;
  background: transparent;
  box-shadow: none;
  text-align: left;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.br .br-side button:hover {
  background: var(--fill);
}

.br .br-side button.on {
  background: var(--accent);
  color: #fff;
}

.fav {
  width: 16px;
  flex: none;
}



.br-page {
  flex: 1;
  min-width: 0;
  overflow: auto;
  scroll-behavior: smooth;
}

.br-wait,
.br-fail {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 6px;
  height: 100%;
  color: var(--label-2);
}

.br-fail b {
  font-size: 20px;
  color: var(--label);
}

.br-fail p {
  margin: 0 0 8px;
}


/* 간판도감.kr: 여백 많은 단정한 사이트. 사진 카드, 알약 표시, 흰(어두운) 카드 */
.br-page {
  --web: #f7f7f5;
  --web-card: #fff;
  --web-ink: #111;
  --web-ink-2: #6b6b6b;
  --web-line: rgb(0 0 0 / 0.12);
  --web-mute: color-mix(in srgb, var(--web-ink) 7%, var(--web-card));
  /* 창 테마 색 대신 이 사이트의 색을 쓴다 */
  --label: var(--web-ink);
  --label-2: var(--web-ink-2);
  --label-3: color-mix(in srgb, var(--web-ink-2) 70%, var(--web));
  --sep: var(--web-line);
  --fill: var(--web-mute);
  --panel: var(--web-card);
  background: var(--web);
  color: var(--web-ink);
  container-type: inline-size;
}

:global(html.dark .br-page) {
  --web: #141416;
  --web-card: #1f1f22;
  --web-ink: #f2f2f2;
  --web-ink-2: #9a9aa0;
  --web-line: rgb(255 255 255 / 0.14);
}

/* 홈 */
.home {
  display: grid;
  justify-items: center;
  max-width: 760px;
  margin: 0 auto;
  padding: 26px 32px 0;
}

.site-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 15px;
  border: 1px solid var(--web-line);
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--web-ink);
}

.logo {
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.home-hero {
  margin: 46px 0 34px;
}

.br .cover-foot .who {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  background: none;
  box-shadow: none;
  color: #fff;
  text-align: left;
}

.who b,
.who small,
.map-row b,
.map-row small,
.foot-src b,
.foot-src small {
  display: block;
}

.who b {
  font-size: 13px;
  font-weight: 600;
}

.who small {
  font-size: 11px;
  opacity: 0.75;
}

.av {
  display: grid;
  place-items: center;
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgb(255 255 255 / 0.28);
  backdrop-filter: blur(8px);
}

.av.ink,
.logo-av {
  background: var(--web-ink);
  color: var(--web);
}

.logo-av {
  font-size: 14px;
  font-weight: 800;
}

.br .cover-foot .more {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 44px;
  padding: 0 18px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 6px 18px rgb(0 0 0 / 0.12);
  color: #111;
  font-size: 15px;
  font-weight: 600;
  transition: transform 0.15s var(--spring);
}

.br .cover-foot .more:hover {
  transform: scale(1.04);
}

.home-q {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(520px, 100%);
  height: 50px;
  padding: 0 6px 0 18px;
  border: 1px solid var(--web-line);
  border-radius: 999px;
  background: var(--web-card);
  color: var(--web-ink-2);
}

.br .home-q input {
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  box-shadow: none;
  color: var(--web-ink);
  font-size: 14px;
  outline: none;
}

.br .home-q .go {
  height: 38px;
  padding: 0 18px;
  border-radius: 999px;
  background: var(--web-ink);
  color: var(--web);
  box-shadow: none;
  font-weight: 600;
}

.chips.center {
  justify-content: center;
  margin-top: 14px;
}

.shelf-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  width: 100%;
  margin: 52px 0 14px;
}

.shelf-head h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.br .link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 0;
  padding: 0;
  background: none;
  box-shadow: none;
  color: var(--web-ink-2);
  font-size: 12.5px;
}

.br .link:hover {
  color: var(--web-ink);
}

.shelf {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  width: 100%;
}

.br .shelf-card {
  display: block;
  min-height: 0;
  padding: 0;
  border-radius: 26px;
  background: none;
  box-shadow: none;
  text-align: left;
  transition: transform 0.18s var(--spring);
}

.br .shelf-card:hover {
  transform: translateY(-3px);
}

.br .map-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin-top: 12px;
  padding: 14px 18px;
  border-radius: 22px;
  background: var(--web-card);
  box-shadow: 0 0 0 1px var(--web-line);
  color: var(--web-ink);
  text-align: left;
}

.map-row > span:nth-child(2) {
  flex: 1;
}

.map-row b {
  font-size: 14px;
}

.map-row small {
  font-size: 12px;
  color: var(--web-ink-2);
}

.br .map-row:hover {
  box-shadow: 0 0 0 1px var(--web-ink-2);
}

/* 안쪽 페이지: 넓은 사진 띠 아래 카드를 쌓는다 */
.doc {
  display: grid;
  gap: 14px;
  max-width: 880px;
  margin: 0 auto;
  padding: 26px 34px 0;
}

.tabs,
.scroller {
  display: flex;
  gap: 6px;
  margin: 4px 0 2px;
}

.tabs {
  justify-content: center;
}

/* 업종 고르기는 한 줄로 두고 옆으로 민다 */
.scroller {
  overflow-x: auto;
  padding: 2px 2px 6px;
  scrollbar-width: none;
}

.br .tabs button,
.br .scroller button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  height: 34px;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--web-card);
  box-shadow: 0 0 0 1px var(--web-line);
  color: var(--web-ink);
  font-size: 13px;
  font-weight: 600;
}

.br .tabs button.on,
.br .scroller button.on {
  background: var(--web-ink);
  color: var(--web);
  box-shadow: none;
}

.block {
  min-width: 0;
  padding: 22px 24px;
  border-radius: 26px;
  background: var(--web-card);
  box-shadow: 0 0 0 1px var(--web-line);
}

.head {
  margin: 0 0 6px;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.4;
  word-break: keep-all;
}

.sub-head {
  margin: 22px 0 10px;
  font-size: 13.5px;
  font-weight: 700;
}

.lede {
  margin: 0 0 16px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--web-ink-2);
  word-break: keep-all;
}

.prose {
  margin: 0 0 8px;
  font-size: 14.5px;
  line-height: 1.75;
  word-break: keep-all;
}

.prose:last-child {
  margin-bottom: 0;
}

.note {
  margin: 12px 0 0;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--web-ink-2);
  word-break: keep-all;
}

.note.fine {
  margin: 4px 6px 0;
}

/* 숫자 칸 */
.stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.block .stats {
  margin-top: 14px;
}

.stat {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 16px 18px;
  border-radius: 20px;
  background: var(--web-card);
  box-shadow: 0 0 0 1px var(--web-line);
}

.block .stat {
  background: var(--web-mute);
  box-shadow: none;
}

.stat small,
.stat span {
  font-size: 11.5px;
  color: var(--web-ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stat b {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 1~3등은 큰 카드, 나머지는 알약 */
.podium {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.head + .podium {
  margin-top: 14px;
}

.br .pod,
.pod {
  position: relative;
  display: grid;
  justify-items: start;
  gap: 2px;
  min-width: 0;
  min-height: 0;
  padding: 16px 18px;
  border-radius: 20px;
  background: var(--web-mute);
  box-shadow: none;
  color: var(--web-ink);
  text-align: left;
}

.br button.pod:hover {
  box-shadow: 0 0 0 1px var(--web-ink-2);
}

.pod-rk {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-bottom: 10px;
  border-radius: 50%;
  background: var(--web-ink);
  color: var(--web);
  font-size: 12px;
  font-weight: 700;
}

.pod b {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.pod small {
  font-size: 12px;
  color: var(--web-ink-2);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.br .chips button,
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding: 3px 13px;
  border-radius: 999px;
  background: var(--web-card);
  box-shadow: 0 0 0 1px var(--web-line);
  color: var(--web-ink);
  font-size: 12.5px;
}

.br .chips button:hover {
  background: var(--web-card);
  box-shadow: 0 0 0 1px var(--web-ink-2);
}

.br .chips button.dim {
  color: var(--web-ink-2);
}

.chips em {
  font-style: normal;
  font-size: 11px;
  color: var(--label-3);
  font-variant-numeric: tabular-nums;
}

.chips small {
  color: var(--web-ink-2);
  font-variant-numeric: tabular-nums;
}

.br .fold,
.br .chips .fold {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding: 3px 13px;
  border-radius: 999px;
  background: var(--web-mute);
  box-shadow: none;
  color: var(--web-ink-2);
  font-size: 12.5px;
  font-weight: 600;
}

.block > .fold {
  margin-top: 12px;
}

.br .fold:hover {
  color: var(--web-ink);
}

.big-name {
  margin: 10px 0 12px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.4;
  word-break: break-all;
}

.long {
  margin: 0;
  padding-left: 18px;
  display: grid;
  gap: 8px;
  font-size: 13px;
  word-break: break-all;
}

.long small {
  color: var(--web-ink-2);
}

/* 몫 막대: 동네 가게·프랜차이즈, 이름 속 자리 */
.share-bar {
  display: flex;
  gap: 3px;
  height: 12px;
  margin-top: 16px;
  overflow: hidden;
  border-radius: 999px;
}

.share-bar span {
  min-width: 3px;
}

.share-bar span:first-child {
  border-radius: 999px 0 0 999px;
}

.share-bar span:last-child {
  border-radius: 0 999px 999px 0;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--web-ink-2);
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.legend i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
}

.sw-indie,
.pos-start {
  background: var(--web-ink);
}

.sw-chain,
.pos-end {
  background: color-mix(in srgb, var(--web-ink) 40%, var(--web-card));
}

.pos-mid {
  background: color-mix(in srgb, var(--web-ink) 65%, var(--web-card));
}

.pos-whole {
  background: color-mix(in srgb, var(--web-ink) 18%, var(--web-card));
}

.cols {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 14px;
}

/* 가로 막대: 이름·수는 글자색, 막대는 한 가지 색 */
.bars {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.bars li {
  display: grid;
  grid-template-columns: 22px 1fr auto;
  align-items: baseline;
  column-gap: 6px;
  padding: 7px 0 8px;
  border-bottom: 0.5px solid var(--web-line);
  font-size: 13px;
}

.bars li:last-child {
  border-bottom: 0;
}

.bars .rk {
  font-size: 11px;
  color: var(--label-3);
  font-variant-numeric: tabular-nums;
}

.bars .nm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bars .ct {
  font-size: 12px;
  color: var(--web-ink-2);
  font-variant-numeric: tabular-nums;
}

.bars i {
  grid-column: 2 / -1;
  height: 4px;
  margin-top: 5px;
  border-radius: 999px;
  background: var(--web-ink);
}

.lift {
  margin-left: 6px;
  font-style: normal;
  font-size: 11px;
  font-weight: 700;
  color: var(--web-ink-2);
}

/* 한 건물에 같은 간판이 몰린 곳 */
.places {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 10px;
}

.place {
  position: relative;
  display: grid;
  gap: 3px;
  min-width: 0;
  padding: 14px 64px 14px 16px;
  border-radius: 18px;
  background: var(--web-mute);
}

.place b {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.place small {
  font-size: 11.5px;
  color: var(--web-ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.place .x {
  position: absolute;
  top: 50%;
  right: 14px;
  translate: 0 -50%;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

/* 맨 아래: 출처와 다른 페이지 */
.site-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 14px;
  width: calc(100% - 68px);
  max-width: 812px;
  margin: 46px auto 0;
  padding: 22px 0 34px;
  border-top: 1px solid var(--web-line);
}

.home + .site-foot {
  width: calc(100% - 64px);
  max-width: 696px;
}

.foot-src {
  flex: 1;
  min-width: 220px;
}

.foot-src b {
  font-size: 13px;
}

.foot-src small {
  margin-top: 2px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--web-ink-2);
}

.foot-links {
  display: flex;
  gap: 4px;
}

.br .foot-links button {
  height: 30px;
  min-height: 0;
  padding: 0 13px;
  border-radius: 999px;
  background: none;
  box-shadow: 0 0 0 1px var(--web-line);
  color: var(--web-ink);
  font-size: 12px;
}

.br .foot-links button:hover {
  box-shadow: 0 0 0 1px var(--web-ink-2);
}

.br .br-side button.sub {
  padding-left: 22px;
  color: var(--label-2);
}

.br .br-side button.sub.on {
  color: #fff;
}

.lm-in {
  min-width: 0;
}

@container (max-width: 720px) {
  .shelf {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .doc {
    padding: 18px 16px 0;
  }

  .home {
    padding: 20px 18px 0;
  }

  .podium {
    grid-template-columns: 1fr;
  }

  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .block {
    padding: 18px;
  }

  .site-foot,
  .home + .site-foot {
    width: calc(100% - 32px);
  }
}
</style>
