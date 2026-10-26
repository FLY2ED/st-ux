<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { load, nameCount } from '../data.js'
import { loadLM } from '../signlm.js'
import { player } from '../arcade.js'
import { sfx } from '../sound.js'

// 간판 브라우저의 '간판 언어 모델' 페이지. 세 그림 모두 간판 이름만 쓴다
// 다음 글자·주의 집중선: 간판 이름 25만 개로만 배운 글자 GPT(signlm)를 브라우저에서 바로 돌린다
// 의미 지도: 간판 이름 2,535개를 bge-m3 로 임베딩해 UMAP 으로 편 것(만들 때 한 번 계산)
// 색은 사이트 글자색 한 가지를 밝기만 달리해 쓴다
const emit = defineEmits(['ask'])

const lm = ref(null)
const failed = ref(false)
loadLM().then((m) => (lm.value = m), () => (failed.value = true))

const view = ref('next')
const VIEWS = [
  { id: 'next', label: '다음 글자' },
  { id: 'att', label: '주의 집중선' },
  { id: 'map', label: '의미 지도' },
]
const fmt = (n) => n.toLocaleString('ko-KR')
const pct = (p) => `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%`

// ── 다음 글자 ─────────────────────────────
const me = player()?.name
const SEEDS = [...new Set(['', ...(me ? [[...me].slice(0, 2).join('')] : []), '행복', '엄마', '스타', '과기'])]
const picks = ref([]) // [{ ch, p }] 고른 글자와 고를 때 확률
const prefix = computed(() => picks.value.map((x) => x.ch).join(''))
const temp = ref(1)
const ended = ref(false)
const same = ref(null)

const cands = computed(() => (lm.value && !ended.value ? lm.value.next(prefix.value, 10, temp.value) : []))
const top = computed(() => cands.value[0]?.p || 1)

function seed(s) {
  picks.value = [...s].map((ch) => ({ ch, p: null }))
  ended.value = false
  same.value = null
  sfx.click()
}
function take(c) {
  if (c.end) return finish()
  if ([...prefix.value].length >= (lm.value?.ctx || 16) - 2) return finish()
  picks.value = [...picks.value, { ch: c.ch, p: c.p }]
  sfx.click()
}
function back() {
  ended.value = false
  same.value = null
  picks.value = picks.value.slice(0, -1)
}
// 온도를 준 전체 분포에서 한 글자 뽑기
function roll() {
  if (!lm.value || ended.value) return
  const p = lm.value.probs(lm.value.run(prefix.value).logits, temp.value)
  let r = Math.random()
  let i = 0
  for (; i < p.length - 1; i++) if ((r -= p[i]) <= 0) break
  if (i === 0) return finish()
  take({ ch: lm.value.vocab[i], end: false, p: p[i] })
}
function runOut() {
  if (!lm.value || ended.value) return
  for (let n = 0; n < 16 && !ended.value; n++) roll()
  if (!ended.value) finish()
}
async function finish() {
  ended.value = true
  sfx.bell?.()
  const name = prefix.value
  same.value = name.length >= 2 ? await nameCount(name).catch(() => null) : null
}

// ── 주의 집중선 ─────────────────────────────
const attText = ref('올스톤커피하우스')
const layer = ref(3)
const heads = ref([0, 1, 2, 3])
const hideStart = ref(true)
const focus = ref(null)
const att = computed(() => {
  if (!lm.value) return null
  const text = [...attText.value.replace(/\s+/g, '')].slice(0, (lm.value.ctx || 16) - 1).join('')
  if (!text) return null
  const r = lm.value.run(text)
  const T = r.ids.length
  const hs = heads.value.length ? heads.value : [0]
  // 고른 머리들의 평균
  const A = Array.from({ length: T }, (_, t) =>
    Array.from({ length: T }, (_, s) => (s > t ? 0 : hs.reduce((a, h) => a + r.att[layer.value][h][t][s], 0) / hs.length)),
  )
  const chars = r.chars.map((c, i) => (i === 0 ? '시작' : c))
  return { T, A, chars }
})
const ROW = 26
const attH = computed(() => (att.value ? att.value.T * ROW + 16 : 0))
const lines = computed(() => {
  const a = att.value
  if (!a) return []
  const out = []
  for (let t = 1; t < a.T; t++) {
    if (focus.value != null && focus.value !== t) continue
    // 한 줄 안에서 다시 나눠 굵기를 비교하기 쉽게 한다(시작으로 가는 선을 숨기면 그만큼 뺀다)
    const sum = a.A[t].reduce((x, w, s) => x + (hideStart.value && s === 0 ? 0 : w), 0) || 1
    for (let s = 0; s <= t; s++) {
      if (hideStart.value && s === 0) continue
      const w = a.A[t][s] / sum
      if (w < 0.04) continue
      out.push({ t, s, w })
    }
  }
  return out
})
const attFocus = computed(() => {
  const a = att.value
  if (!a) return null
  const t = focus.value ?? a.T - 1
  const row = a.A[t].map((w, s) => ({ s, w, ch: a.chars[s] })).filter((x) => x.s <= t)
  const start = row[0].w
  return { t, ch: a.chars[t], start, top: row.slice(1).sort((x, y) => y.w - x.w).slice(0, 3) }
})
const toggleHead = (h) => (heads.value = heads.value.includes(h) ? heads.value.filter((x) => x !== h) : [...heads.value, h].sort())
const useMine = () => prefix.value && ((attText.value = prefix.value), (view.value = 'att'))

// ── 의미 지도 ─────────────────────────────
const map = ref(null)
const mapFailed = ref(false)
const cat = ref('')
const q = ref('')
const hover = ref(null)
const picked = ref(null)
const cv = ref(null)
const box = ref(null)
let ctx
let size = { w: 0, h: 0 }
let ro
const PAD = 14

const cats = computed(() => {
  if (!map.value) return []
  const m = new Map()
  for (const it of map.value.items) m.set(it.c, (m.get(it.c) || 0) + 1)
  return [...m.keys()].sort((a, b) => a.localeCompare(b, 'ko'))
})
const hits = computed(() => {
  const w = q.value.trim()
  if (!map.value || !w) return null
  return new Set(map.value.items.flatMap((it, i) => (it.n.includes(w) ? [i] : [])))
})
const pickedItem = computed(() => (picked.value != null ? map.value.items[picked.value] : null))

function ensureMap() {
  if (map.value || mapFailed.value) return
  load('signlm/embed-map.json').then((v) => ((map.value = v), nextTick(setup)), () => (mapFailed.value = true))
}
watch(view, (v) => v === 'map' && (map.value ? nextTick(setup) : ensureMap()))

const px = (it) => [PAD + it.x * (size.w - 2 * PAD), PAD + (1 - it.y) * (size.h - 2 * PAD)]
function tone() {
  const st = getComputedStyle(box.value)
  return { a: st.getPropertyValue('--v').trim() || '#0a84ff', bg: st.getPropertyValue('--panel').trim() || '#fff', ink: st.getPropertyValue('--label').trim() || '#000' }
}
function draw() {
  if (!ctx || !map.value) return
  const { a, bg } = tone()
  const items = map.value.items
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size.w, size.h)
  const focusOn = cat.value || hits.value
  const on = (it, i) => (cat.value ? it.c === cat.value : true) && (hits.value ? hits.value.has(i) : true)
  // 1) 바탕 점: 고른 게 있으면 흐리게
  ctx.fillStyle = a
  ctx.globalAlpha = focusOn ? 0.12 : 0.38
  for (let i = 0; i < items.length; i++) {
    if (focusOn && on(items[i], i)) continue
    const [x, y] = px(items[i])
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3)
  }
  // 2) 고른 점: 진하게, 바탕색 테두리로 겹침을 가른다
  if (focusOn) {
    ctx.globalAlpha = 1
    for (let i = 0; i < items.length; i++) {
      if (!on(items[i], i)) continue
      const [x, y] = px(items[i])
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fillStyle = bg
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fillStyle = a
      ctx.fill()
    }
  }
  // 3) 누른 점과 가장 가까운 이웃 다섯
  const p = pickedItem.value
  if (p) {
    const [x0, y0] = px(p)
    ctx.strokeStyle = a
    for (const [j, sim] of p.nb) {
      const [x1, y1] = px(items[j])
      ctx.globalAlpha = 0.25 + sim * 0.6
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x1, y1, 4, 0, Math.PI * 2)
      ctx.fillStyle = a
      ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.beginPath()
    ctx.arc(x0, y0, 7, 0, Math.PI * 2)
    ctx.fillStyle = bg
    ctx.fill()
    ctx.lineWidth = 2.5
    ctx.stroke()
  }
  if (hover.value != null) {
    const [x, y] = px(items[hover.value])
    ctx.globalAlpha = 1
    ctx.strokeStyle = a
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}
function resize() {
  if (!cv.value || !box.value) return
  const r = box.value.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  size = { w: r.width, h: r.height }
  cv.value.width = Math.round(r.width * dpr)
  cv.value.height = Math.round(r.height * dpr)
  draw()
}
function setup() {
  if (!cv.value) return
  ctx = cv.value.getContext('2d')
  ro?.disconnect()
  ro = new ResizeObserver(resize)
  ro.observe(box.value)
  resize()
}
function nearest(e) {
  const r = cv.value.getBoundingClientRect()
  const mx = e.clientX - r.left
  const my = e.clientY - r.top
  let best = null
  let bd = 10 * 10
  map.value.items.forEach((it, i) => {
    const [x, y] = px(it)
    const d = (x - mx) ** 2 + (y - my) ** 2
    if (d < bd) (bd = d), (best = i)
  })
  return best
}
const tipAt = ref({ x: 0, y: 0 })
function onMove(e) {
  if (!map.value) return
  const i = nearest(e)
  const r = cv.value.getBoundingClientRect()
  tipAt.value = { x: e.clientX - r.left, y: e.clientY - r.top }
  if (i !== hover.value) (hover.value = i), draw()
}
function onClick(e) {
  if (!map.value) return
  const i = nearest(e)
  picked.value = i
  if (i != null) sfx.click()
  draw()
}
const pickIdx = (i) => ((picked.value = i), draw())
watch([cat, q], () => ((picked.value = null), draw()))
// 다크 모드가 바뀌면 다시 칠한다
let mo
onMounted(() => {
  mo = new MutationObserver(() => draw())
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})
onBeforeUnmount(() => {
  ro?.disconnect()
  mo?.disconnect()
})
</script>

<template>
  <div class="lm">
    <div class="seg" role="tablist">
      <button v-for="v in VIEWS" :key="v.id" role="tab" :aria-selected="view === v.id" :class="{ on: view === v.id }" @click="(view = v.id), sfx.click()">{{ v.label }}</button>
    </div>

    <div class="panel">
    <p v-if="failed" class="note">모델을 불러오지 못했어요.</p>
    <p v-else-if="!lm && view !== 'map'" class="note">모델 불러오는 중… (2.9MB)</p>

    <!-- 다음 글자 -->
    <template v-if="view === 'next' && lm">
      <p class="lede">간판 이름 {{ fmt(lm.trainNames) }}개만 읽은 작은 모델이 다음 글자마다 확률표를 만들어요. 막대를 누르면 그 글자를 붙이고, 다음 표로 넘어가요.</p>
      <div class="row seeds">
        <span class="cap">시작</span>
        <button v-for="s in SEEDS" :key="s" class="chip" :class="{ on: prefix === s }" @click="seed(s)">{{ s || '빈 칸에서' }}</button>
      </div>
      <div class="name" :class="{ done: ended }">
        <span v-for="(x, i) in picks" :key="i" class="tile" :title="x.p == null ? '직접 넣은 글자' : `고를 때 확률 ${pct(x.p)}`">
          {{ x.ch }}<small>{{ x.p == null ? '·' : pct(x.p) }}</small>
        </span>
        <span v-if="!ended" class="tile caret">?</span>
      </div>
      <p v-if="ended" class="verdict">
        <b>‘{{ prefix || '(빈 이름)' }}’</b>
        <template v-if="same > 1"> · 전국에 똑같은 간판이 {{ fmt(same) }}곳 있어요. <button class="link" @click="emit('ask', prefix)">문서 보기</button></template>
        <template v-else-if="prefix.length >= 2"> · 여러 가게가 함께 쓰는 이름은 아니에요. 모델이 새로 지었을 가능성이 커요.</template>
      </p>
      <div class="gen">
        <div>
          <div class="row between">
            <label class="ctl">온도 <input v-model.number="temp" type="range" min="0.3" max="2" step="0.05" /> <span class="mono">{{ temp.toFixed(2) }}</span></label>
            <span class="row">
              <button class="btn ghost" :disabled="!picks.length" @click="back">한 칸 뒤로</button>
              <button class="btn ghost" :disabled="ended" @click="roll">한 글자 뽑기</button>
              <button class="btn" :disabled="ended" @click="runOut">끝까지 이어 쓰기</button>
            </span>
          </div>
          <ol v-if="!ended" class="pbars">
            <li v-for="c in cands" :key="c.ch" :title="`${c.end ? '여기서 끝' : `‘${prefix}${c.ch}’`} ${pct(c.p)}`" @click="take(c)">
              <span class="ch" :class="{ end: c.end }">{{ c.ch }}</span>
              <span class="track"><i :style="{ width: `${Math.max(1, (c.p / top) * 100)}%` }"></i></span>
              <span class="pv">{{ pct(c.p) }}</span>
            </li>
          </ol>
          <p v-else class="note">다시 하려면 시작 칸을 누르거나 한 칸 뒤로 가세요.</p>
        </div>
        <aside class="side">
          <h4>보이는 것</h4>
          <p>빈 칸에서는 1등 글자도 2%쯤이라 첫 글자가 고르게 퍼져 있어요. ‘엄마’ 다음엔 ‘손’이 40%, ‘행복’ 다음엔 ‘한’이 38%로 확 몰려요. ‘끝’ 막대는 이름이 여기서 끝날 확률이에요.</p>
          <p>온도를 낮추면 1등 글자만 고르고, 올리면 드문 글자도 뽑혀요.</p>
          <p class="fine">글자 GPT · 4층 · 머리 4개 · 160차원 · 검증 손실 {{ lm.valLoss }} · 브라우저에서 계산</p>
          <button v-if="prefix && ended" class="btn ghost" @click="useMine">이 이름의 주의 집중선 보기</button>
        </aside>
      </div>
    </template>

    <!-- 주의 집중선 -->
    <template v-if="view === 'att' && lm">
      <p class="lede">모델이 다음 글자를 정할 때 앞의 어느 글자를 다시 보는지 선 굵기로 그렸어요. 왼쪽 글자에 마우스를 올리면 그 글자가 본 곳만 남아요.</p>
      <form class="row" @submit.prevent>
        <input v-model="attText" class="field" type="text" maxlength="15" placeholder="간판 이름" spellcheck="false" aria-label="간판 이름" />
        <button v-for="s in ['올스톤커피하우스', '엄마손칼국수', '행복한약국', '스타벅스강남역점']" :key="s" type="button" class="chip" :class="{ on: attText === s }" @click="attText = s">{{ s }}</button>
      </form>
      <div class="att">
        <svg v-if="att" :viewBox="`0 0 360 ${attH}`" :width="360" :height="attH" @mouseleave="focus = null">
          <g class="cols">
            <text v-for="(c, i) in att.chars" :key="`l${i}`" :x="96" :y="16 + i * ROW + 6" text-anchor="end" :class="{ on: focus === i, dim: focus != null && focus !== i, start: i === 0 }" @mouseenter="i && (focus = i)">{{ c }}</text>
            <text v-for="(c, i) in att.chars" :key="`r${i}`" :x="264" :y="16 + i * ROW + 6" :class="{ start: i === 0, dim: hideStart && i === 0 }">{{ c }}</text>
          </g>
          <line
            v-for="l in lines"
            :key="`${l.t}-${l.s}`"
            :x1="104"
            :y1="16 + l.t * ROW"
            :x2="256"
            :y2="16 + l.s * ROW"
            :stroke-width="1 + l.w * 6"
            :stroke-opacity="focus != null ? 0.25 + l.w * 0.75 : 0.12 + l.w * 0.6"
            class="ln"
          >
            <title>{{ att.chars[l.t] }} → {{ att.chars[l.s] }} {{ pct(l.w) }}</title>
          </line>
          <rect v-for="(c, i) in att.chars" :key="`h${i}`" x="0" :y="16 + i * ROW - 12" width="110" :height="ROW - 2" fill="transparent" @mouseenter="i && (focus = i)" />
        </svg>
        <div class="att-side">
          <label class="ctl wide">층 <input v-model.number="layer" type="range" min="0" :max="lm.L - 1" /> <span class="mono">{{ layer + 1 }}/{{ lm.L }}</span></label>
          <p class="cap">머리 (여럿 고르면 평균)</p>
          <div class="row">
            <button v-for="h in lm.H" :key="h" class="chip" :class="{ on: heads.includes(h - 1) }" @click="toggleHead(h - 1)">{{ h }}</button>
          </div>
          <label class="ctl"><input v-model="hideStart" type="checkbox" /> ‘시작’으로 가는 선 숨기기</label>
          <div v-if="attFocus" class="att-read">
            <b>‘{{ attFocus.ch }}’ 다음을 정할 때</b>
            <p v-for="x in attFocus.top" :key="x.s">{{ x.ch }} <span class="mono">{{ pct(x.w) }}</span></p>
            <p class="fine">‘시작’ 자리에 간 몫 {{ pct(attFocus.start) }}. 볼 글자가 마땅치 않을 때 첫 자리로 가는 선이라 따로 숨길 수 있어요. 비율은 고른 층·머리의 평균이에요.</p>
          </div>
        </div>
      </div>
    </template>

    <!-- 의미 지도 -->
    <template v-if="view === 'map'">
      <p class="lede">간판 이름 2,535개를 1,024차원 숫자(임베딩)로 바꾼 뒤 평면에 펼쳤어요. 뜻이나 소리가 비슷한 이름끼리 가까이 모여요. 점을 누르면 가장 닮은 이름 다섯이 나와요.</p>
      <p v-if="mapFailed" class="note">지도 자료를 불러오지 못했어요.</p>
      <div v-else class="map">
        <div ref="box" class="map-box">
          <canvas ref="cv" @mousemove="onMove" @mouseleave="(hover = null), draw()" @click="onClick"></canvas>
          <div v-if="hover != null && map" class="tip" :style="{ left: `${tipAt.x + 12}px`, top: `${tipAt.y + 12}px` }">
            <b>{{ map.items[hover].n }}</b> · {{ map.items[hover].c }} · {{ fmt(map.items[hover].k) }}곳
          </div>
          <p v-if="!map" class="map-wait">불러오는 중…</p>
        </div>
        <aside class="map-side">
          <input v-model="q" class="field" type="search" placeholder="이름 찾기 (예: 고향, 스타)" aria-label="이름 찾기" />
          <select v-model="cat" class="field" aria-label="업종">
            <option value="">모든 업종</option>
            <option v-for="c in cats" :key="c" :value="c">{{ c }}</option>
          </select>
          <p v-if="hits" class="fine">‘{{ q }}’ 들어간 이름 {{ fmt(hits.size) }}개</p>
          <div v-if="pickedItem" class="nb">
            <b class="nb-name">{{ pickedItem.n }}</b>
            <small>{{ pickedItem.c }} · 전국 {{ fmt(pickedItem.k) }}곳</small>
            <ol>
              <li v-for="[j, sim] in pickedItem.nb" :key="j" @click="pickIdx(j)">
                <span>{{ map.items[j].n }}</span>
                <span class="track"><i :style="{ width: `${sim * 100}%` }"></i></span>
                <span class="mono">{{ sim.toFixed(2) }}</span>
              </li>
            </ol>
            <button class="link" @click="emit('ask', pickedItem.n)">‘{{ pickedItem.n }}’ 문서 보기</button>
          </div>
          <p v-else class="fine">점을 눌러 보세요. 숫자는 1,024차원에서 잰 코사인 유사도예요.</p>
          <p class="fine">BAAI/bge-m3 → UMAP(코사인, 이웃 15). 업종마다 같은 이름이 많은 간판을 골랐어요.</p>
        </aside>
      </div>
    </template>
    </div>
  </div>
</template>

<style scoped>
/* 간판도감.kr 의 글자색 한 가지를 밝기만 달리 써서 그린다. 글자색 칸 위의 글자는 바탕색 */
.lm {
  --v: var(--web-ink, var(--accent));
  --v-on: var(--web, #fff);
  --v-soft: color-mix(in srgb, var(--v) 9%, transparent);
  --v-mid: color-mix(in srgb, var(--v) 45%, var(--panel, #fff));
  --line: var(--web-line, var(--sep));
}

.panel {
  padding: 22px 24px;
  border-radius: 26px;
  background: var(--panel);
  box-shadow: 0 0 0 1px var(--line);
}

.seg {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin: 4px 0 14px;
}

.lm .seg button {
  min-height: 0;
  height: 34px;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--panel);
  box-shadow: 0 0 0 1px var(--line);
  font-size: 13px;
  font-weight: 600;
  color: var(--label);
}

.lm .seg button.on {
  background: var(--v);
  color: var(--v-on);
  box-shadow: none;
}

.lede {
  margin: 0 0 14px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--label-2);
}

.note,
.fine {
  font-size: 11px;
  line-height: 1.5;
  color: var(--label-3);
}

.cap {
  font-size: 11px;
  color: var(--label-3);
  margin: 10px 0 4px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.row.between {
  justify-content: space-between;
  margin-bottom: 8px;
}

.mono {
  font-variant-numeric: tabular-nums;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  color: var(--label-2);
}

.lm .chip {
  min-height: 0;
  height: 30px;
  padding: 0 13px;
  border-radius: 999px;
  background: var(--panel);
  box-shadow: 0 0 0 1px var(--line);
  font-size: 12.5px;
  color: var(--label);
}

.lm .chip.on {
  background: var(--v);
  color: var(--v-on);
  box-shadow: none;
}

.lm .btn {
  min-height: 0;
  height: 34px;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--v);
  color: var(--v-on);
  box-shadow: none;
  font-size: 12.5px;
  font-weight: 600;
}

.lm .btn.ghost {
  background: var(--panel);
  box-shadow: 0 0 0 1px var(--line);
  color: var(--label);
}

.lm .btn:disabled {
  opacity: 0.4;
}

.lm .link {
  min-height: 0;
  padding: 0;
  background: none;
  box-shadow: none;
  color: var(--v);
  font-size: inherit;
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.lm .field {
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--panel);
  box-shadow: 0 0 0 1px var(--line);
  color: var(--label);
  font-size: 13px;
}

.ctl {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--label-2);
}

.ctl input {
  accent-color: var(--v);
}

.ctl.wide {
  width: 100%;
}

.ctl.wide input {
  flex: 1;
}

.seeds .cap {
  margin: 0 4px 0 0;
}

/* 지은 이름: 글자 칸 + 고를 때 확률 */
.name {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 54px;
  margin: 12px 0 4px;
}

.tile {
  display: grid;
  place-items: center;
  width: 44px;
  height: 54px;
  border-radius: 14px;
  background: var(--v-soft);
  color: var(--label);
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
}

.tile small {
  font-size: 9px;
  font-weight: 500;
  color: var(--label-3);
  font-variant-numeric: tabular-nums;
}

.tile.caret {
  background: transparent;
  outline: 1.5px dashed var(--v-mid);
  color: var(--v-mid);
}

.name.done .tile {
  background: var(--v);
  color: var(--v-on);
}

.name.done .tile small {
  color: color-mix(in srgb, var(--v-on) 75%, transparent);
}

.verdict {
  margin: 6px 0 12px;
  font-size: 13px;
}

.gen {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px;
  gap: 20px;
  margin-top: 10px;
}

.pbars {
  margin: 0;
  padding: 0;
  list-style: none;
}

.pbars li {
  display: grid;
  grid-template-columns: 34px 1fr 52px;
  align-items: center;
  gap: 8px;
  padding: 5px 4px;
  border-radius: 10px;
  cursor: pointer;
}

.pbars li:hover {
  background: var(--v-soft);
}

.pbars .ch {
  font-size: 15px;
  font-weight: 700;
  text-align: center;
}

.pbars .ch.end {
  font-size: 11px;
  font-weight: 600;
  color: var(--label-2);
}

.track {
  height: 8px;
  border-radius: 999px;
  background: var(--v-soft);
  overflow: hidden;
}

.track i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--v);
}

.pv {
  font-size: 11px;
  text-align: right;
  color: var(--label-2);
  font-variant-numeric: tabular-nums;
}

.side {
  align-self: start;
  padding: 16px 18px;
  border-radius: 20px;
  background: var(--v-soft);
}

.side h4 {
  margin: 0 0 8px;
  font-size: 13px;
}

.side p {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.55;
  color: var(--label-2);
}

/* 주의 집중선 */
.att {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 20px;
  margin-top: 14px;
}

.att svg {
  overflow: visible;
}

.att text {
  font-size: 14px;
  font-weight: 600;
  fill: var(--label);
  cursor: default;
}

.att text.start {
  font-size: 11px;
  font-weight: 500;
  fill: var(--label-3);
}

.att text.on {
  fill: var(--v);
}

.att text.dim {
  fill: var(--label-3);
  opacity: 0.5;
}

.att .ln {
  stroke: var(--v);
  stroke-linecap: round;
  pointer-events: stroke;
}

.att-read {
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 18px;
  background: var(--v-soft);
  font-size: 13px;
}

.att-read p {
  margin: 4px 0 0;
}

/* 의미 지도 */
.map {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 230px;
  gap: 16px;
}

.map-box {
  position: relative;
  height: 440px;
  overflow: hidden;
  border-radius: 20px;
  background: var(--panel, var(--window));
  box-shadow: inset 0 0 0 1px var(--line);
}

.map-box canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}

.map-wait {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  font-size: 12px;
  color: var(--label-3);
}

.tip {
  position: absolute;
  z-index: 2;
  max-width: 220px;
  padding: 6px 10px;
  border-radius: 999px;
  background: var(--v);
  color: var(--v-on);
  font-size: 11px;
  pointer-events: none;
  white-space: nowrap;
}

.map-side {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.nb {
  padding: 14px 16px;
  border-radius: 18px;
  background: var(--v-soft);
}

.nb-name {
  display: block;
  font-size: 16px;
}

.nb small {
  font-size: 11px;
  color: var(--label-2);
}

.nb ol {
  margin: 8px 0;
  padding: 0;
  list-style: none;
}

.nb li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 54px 32px;
  align-items: center;
  gap: 6px;
  padding: 3px 0;
  font-size: 12px;
  cursor: pointer;
}

.nb li span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nb li:hover span:first-child {
  text-decoration: underline;
}

.nb .track {
  height: 6px;
}

@container (max-width: 760px) {
  .gen,
  .att,
  .map {
    grid-template-columns: 1fr;
  }
}
</style>
