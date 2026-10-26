<script setup>
import { computed, onMounted, ref } from 'vue'
import { load, randomNames } from './data.js'
import { fmt, swatchOf, useCount, useSeen, vReveal } from './util.js'
import PillStream from './components/PillStream.vue'
import FindBoard from './components/FindBoard.vue'
import NearBoard from './components/NearBoard.vue'
import jongno from './assets/jongno.webp'
import seomyeon from './assets/seomyeon.webp'
import myeongdong from './assets/myeongdong.webp'
import gwangbok from './assets/gwangbok.webp'

const PHOTOS = [
  { src: jongno, w: 1600, h: 1101, place: '서울 종로', alt: '해 질 녘 종로 골목, 사진관과 막회, 아구찜 간판이 이어진 길' },
  { src: seomyeon, w: 1000, h: 750, place: '부산 서면', alt: '밤의 서면, 층마다 불 켜진 간판이 쌓인 상가 건물' },
  { src: myeongdong, w: 1600, h: 1195, place: '서울 명동', alt: '명동 골목의 환전소 간판들' },
  { src: gwangbok, w: 1200, h: 900, place: '부산 광복동', alt: '광복동 쇼핑 거리를 걷는 사람들과 세로 간판' },
]
const TRY = ['김밥', '반석공인중개사사무소', '사랑', '옛날통닭', '헤어']
const WORDS = ['사무', '헤어', '학원', '의원', '카페']
const MARK = ['간', '판', '사', '전']

const meta = ref(null)
const street = ref([])
const fame = ref(null)
const stream = ref([])
const draft = ref('김밥')
const query = ref('김밥')

onMounted(async () => {
  const [m, s, f] = await Promise.all([load('meta.json'), load('street.json'), load('fame.json')])
  meta.value = m
  street.value = s
  fame.value = f
  // 흐르는 띠: 유명한 이름 + 무작위로 뽑은 실제 이름
  const picked = (await randomNames(3).catch(() => []))
    .filter((n) => n.name.length >= 2 && n.name.length <= 9)
    .sort(() => Math.random() - 0.5)
    .slice(0, 30)
  const famous = [...f.chains.slice(0, 8), ...f.indie.slice(0, 10)].map(([name, count]) => ({ name, count }))
  stream.value = [...famous, ...picked].sort(() => Math.random() - 0.5)
})

function find(word = draft.value) {
  draft.value = word
  query.value = word.trim()
  document.getElementById('find')?.scrollIntoView({ block: 'start' })
}

const statsEl = ref(null)
const statsSeen = useSeen(statsEl)
const total = useCount(computed(() => meta.value?.total || 0), statsSeen, 1600)
const unique = useCount(computed(() => meta.value?.uniqueNames || 0), statsSeen, 1600)
const cats = useCount(computed(() => meta.value?.categories || 0), statsSeen, 1600)

const maxStreet = computed(() => Math.max(1, ...street.value.map((c) => c.total)))
const sortedStreet = computed(() => [...street.value].sort((a, b) => b.total - a.total))
const words = computed(() => (fame.value?.words || []).filter(([w]) => WORDS.includes(w)).sort((a, b) => b[1] - a[1]))
const longest = computed(() => fame.value?.longest?.[0] || '')
</script>

<template>
  <header class="top wrap">
    <a class="mark" href="#">간판사전</a>
    <nav aria-label="바로 가기">
      <a href="#find">찾기</a>
      <a href="#numbers">숫자</a>
      <a href="#kinds">업종</a>
      <a href="#near">동네</a>
      <a href="../midterm-paint/">만화 버전</a>
    </nav>
  </header>

  <main>
    <section class="hero wrap">
      <div class="lead">
        <h1>
          <span v-reveal class="line rise">전국 간판 277만 개,</span>
          <span v-reveal="120" class="line rise">단어 하나로 찾아보세요</span>
        </h1>
        <p class="sub">2026년 6월 공개된 전국 상가 정보에서 상호만 모았습니다. 단어를 넣으면 그 단어가 들어간 간판이 전국에 몇 곳인지 바로 셉니다.</p>
        <form class="search" role="search" @submit.prevent="find()">
          <label class="sr" for="q">간판에 들어간 단어</label>
          <input id="q" v-model="draft" type="search" placeholder="예: 김밥, 내 이름, 우리 가게 이름" autocomplete="off" />
          <button class="btn" type="submit">간판 찾기</button>
        </form>
        <p class="try">
          <span>이렇게 찾아보세요</span>
          <button v-for="w in TRY" :key="w" type="button" @click="find(w)">{{ w }}</button>
        </p>
      </div>

      <div class="fan" aria-label="간판이 걸린 거리 사진">
        <figure v-for="(p, i) in PHOTOS" :key="p.place" class="card" :class="`c${i}`">
          <img :src="p.src" :width="p.w" :height="p.h" :alt="p.alt" />
          <figcaption :style="{ background: ['var(--yellow)', 'var(--blue)', 'var(--red)', 'var(--lime)'][i], color: i === 1 || i === 2 ? '#fff' : 'var(--ink)' }">
            {{ p.place }}
          </figcaption>
        </figure>
      </div>
    </section>

    <PillStream class="hero-stream" :names="stream" />
    <p class="wordmark wrap" aria-hidden="true">간판사전.</p>

    <FindBoard :query="query" />

    <section class="statement wrap">
      <div class="slogan rise" v-reveal>
        <h2>같은 이름<br />다른 가게</h2>
      </div>
      <div class="fig rise" v-reveal="120">
        <p class="big">51</p>
        <p>‘반석공인중개사사무소’라는 똑같은 간판이 전국에 51곳 있습니다.</p>
      </div>
      <figure class="photo shutter" v-reveal="200">
        <img :src="PHOTOS[0].src" :width="PHOTOS[0].w" :height="PHOTOS[0].h" alt="종로 골목 간판들" loading="lazy" />
      </figure>
      <div class="text">
        <p>
          간판은 가게가 거리에 내미는 첫 문장입니다. 이 사전은 전국 상가 {{ meta ? fmt(meta.total) : '2,772,484' }}곳의 상호를 한 글자도 고치지 않고
          모았습니다. 그 가운데 서로 다른 이름은 {{ meta ? fmt(meta.uniqueNames) : '1,594,624' }}개입니다. 편의점과 커피 체인이 숫자를 끌어올리지만 동네
          이름도 만만치 않습니다. ‘아지트’는 510곳, ‘옛날통닭’은 322곳, ‘수’라는 한 글자 간판도 324곳입니다. 궁금한 단어가 있으면 맨 위 검색창에,
          우리 동네가 궁금하면 아래 동네 간판으로 가 보세요.
        </p>
      </div>
    </section>

    <section id="numbers" ref="statsEl" class="stats wrap">
      <h2>숫자로 본 간판</h2>
      <div class="s s1">
        <p class="big">{{ fmt(total) }}</p>
        <p>전국 상가 간판 수, 2026년 6월 기준</p>
      </div>
      <div class="s s2">
        <p class="big">{{ fmt(unique) }}</p>
        <p>서로 다른 이름</p>
      </div>
      <div class="s s3">
        <p class="big">{{ fmt(cats) }}</p>
        <p>업종</p>
      </div>
    </section>

    <section id="kinds" class="kinds wrap">
      <h2 class="giant">열두 가게</h2>
      <p class="kinds-sub">거리에서 가장 자주 보는 열두 업종입니다. 줄을 누르면 가장 흔한 이름과 체인 비율이 펼쳐집니다.</p>
      <details v-for="(c, i) in sortedStreet" :key="c.key" class="kind rise" v-reveal="i * 40">
        <summary>
          <span class="k-name">{{ c.label }}</span>
          <span class="k-bar"><i :style="{ width: `${(c.total / maxStreet) * 100}%`, background: swatchOf(c.key).bg }" /></span>
          <span class="k-n">{{ fmt(c.total) }}곳</span>
        </summary>
        <div class="k-body">
          <div>
            <p class="k-h">가장 흔한 이름</p>
            <p class="k-pills">
              <span v-for="[n, k] in c.top.slice(0, 6)" :key="n">{{ n }} <small>{{ fmt(k) }}</small></span>
            </p>
          </div>
          <div>
            <p class="k-h">체인 비율 {{ c.chainShare }}%</p>
            <p v-if="c.chains.length" class="k-pills">
              <span v-for="[n, k] in c.chains.slice(0, 3)" :key="n">{{ n }} <small>{{ fmt(k) }}</small></span>
            </p>
            <p v-else class="k-note">체인 가게가 거의 없는 업종입니다.</p>
          </div>
          <div>
            <p class="k-h">이름에 ‘{{ c.word }}’</p>
            <p class="k-note">이 업종 간판의 {{ c.wordShare }}%가 ‘{{ c.word }}’를 이름에 씁니다.</p>
          </div>
        </div>
      </details>
    </section>

    <section class="showcase wrap">
      <figure class="wide shutter" v-reveal>
        <img :src="PHOTOS[1].src" :width="PHOTOS[1].w" :height="PHOTOS[1].h" alt="밤의 부산 서면 상가 건물, 층마다 다른 간판" loading="lazy" />
        <figcaption>부산 서면. 한 건물에 간판이 열 개 넘게 걸립니다.</figcaption>
      </figure>
      <div class="side">
        <figure class="shutter" v-reveal="120">
          <img :src="PHOTOS[3].src" :width="PHOTOS[3].w" :height="PHOTOS[3].h" alt="부산 광복동 쇼핑 거리" loading="lazy" />
        </figure>
        <figure class="shutter" v-reveal="240">
          <img :src="PHOTOS[2].src" :width="PHOTOS[2].w" :height="PHOTOS[2].h" alt="서울 명동 환전소 간판" loading="lazy" />
        </figure>
      </div>
    </section>

    <section v-if="fame" class="chains wrap">
      <h2>체인과 동네 이름</h2>
      <div class="list dark rise" v-reveal>
        <p class="l-h">가장 많은 체인</p>
        <ol>
          <li v-for="[n, k] in fame.chains.slice(0, 10)" :key="n">
            <span>{{ n }}</span>
            <span class="bar"><i :style="{ width: `${(k / fame.chains[0][1]) * 100}%` }" /></span>
            <b>{{ fmt(k) }}</b>
          </li>
        </ol>
      </div>
      <div class="list pale rise" v-reveal="120">
        <p class="l-h">체인이 아닌데 많은 이름</p>
        <ol>
          <li v-for="[n, k] in fame.indie.slice(0, 10)" :key="n">
            <span>{{ n }}</span>
            <span class="bar"><i :style="{ width: `${(k / fame.indie[0][1]) * 100}%` }" /></span>
            <b>{{ fmt(k) }}</b>
          </li>
        </ol>
      </div>
      <div class="fact blue rise" v-reveal>
        <p class="l-h">가장 많이 쓰인 두 글자</p>
        <p v-for="[w, k] in words" :key="w" class="row"><span>{{ w }}</span><b>{{ fmt(k) }}</b></p>
      </div>
      <div class="fact yellow rise" v-reveal="100">
        <p class="l-h">한 글자 간판</p>
        <p v-for="[w, k] in fame.oneChar.slice(0, 5)" :key="w" class="row"><span>‘{{ w }}’</span><b>{{ k }}곳</b></p>
      </div>
      <div class="fact pink rise" v-reveal="200">
        <p class="l-h">가장 긴 간판, {{ longest.length }}글자</p>
        <p class="longest">{{ longest }}</p>
      </div>
    </section>

    <NearBoard />
  </main>

  <footer class="foot wrap">
    <div class="foot-text">
      <p>자료: 소상공인시장진흥공단 상가(상권)정보, 공공데이터포털, 2026년 6월 30일 기준.</p>
      <p>
        사진: “Streets of Seoul” Sergiy Galyonkin, CC BY-SA 4.0 · “서면 西面 Seomyeon, Busan” InSapphoWeTrust, CC BY-SA 2.0 · “Myeong-dong July-2013 shop
        signs” Noulovanarderso, CC BY-SA 3.0 · “Busan shopping streets in Gwangbok-dong” Mstyslav Chernov/Unframe, CC BY-SA 3.0 · 모두 Wikimedia Commons.
      </p>
      <p class="links">
        <a href="../midterm-paint/">만화 버전 간판 일기</a>
        <a href="../midterm/">처음 만든 간판 도감</a>
      </p>
    </div>
    <p class="blocks" aria-label="간판사전">
      <span v-for="(ch, i) in MARK" :key="ch" :style="{ background: ['var(--ink)', 'var(--yellow)', 'var(--blue)', 'var(--red)'][i], color: i === 1 ? 'var(--ink)' : '#fff' }">{{ ch }}</span>
    </p>
  </footer>
</template>

<style scoped>
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding-top: 22px;
  padding-bottom: 22px;
}

.mark {
  font-size: var(--step-lead);
  font-weight: 800;
  letter-spacing: -0.04em;
  text-decoration: none;
}

nav {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 26px;
  font-weight: 600;
}

nav a {
  text-decoration: none;
  transition: opacity 0.2s var(--out);
}

nav a:hover {
  opacity: 0.55;
}

/* 첫 화면 */
.hero {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--gap);
  align-items: center;
  padding-top: clamp(24px, 5vw, 72px);
  padding-bottom: clamp(32px, 5vw, 64px);
}

.lead {
  grid-column: 1 / span 6;
}

h1 {
  font-size: var(--step-head);
}

h1 .line {
  display: block;
}

.sub {
  max-width: 34em;
  margin-top: 24px;
  color: var(--muted);
  font-size: var(--step-body);
}

.search {
  display: flex;
  gap: var(--gap);
  max-width: 640px;
  margin-top: 32px;
  padding: 6px;
  border-radius: var(--pill);
  background: var(--surface);
}

.search input {
  flex: 1;
  min-width: 0;
  padding: 0 22px;
  border: 0;
  background: transparent;
  font-size: var(--step-lead);
  font-weight: 600;
  letter-spacing: -0.02em;
}

.search input:focus {
  outline: none;
}

.search:focus-within {
  outline: 3px solid var(--blue);
  outline-offset: 3px;
}

.try {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 18px;
  margin-top: 18px;
  color: var(--muted);
  font-size: var(--step-small);
}

.try button {
  padding: 6px 0;
  border: 0;
  background: none;
  color: var(--ink);
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 4px;
}

.fan {
  position: relative;
  grid-column: 7 / span 6;
  height: clamp(400px, 38vw, 580px);
}

.card {
  position: absolute;
  top: 50%;
  width: 46%;
  margin: 0;
  border-radius: var(--tile);
  overflow: hidden;
  background: var(--surface);
  animation: deal 1.1s var(--out) backwards;
  transition: transform 0.4s var(--out);
}

.card img {
  width: 100%;
  height: auto;
  aspect-ratio: 3 / 4;
  object-fit: cover;
}

.card figcaption {
  padding: 8px 14px;
  font-size: var(--step-small);
  font-weight: 700;
}

.c0 {
  --to: translateY(-50%) rotate(-10deg);
  left: 5%;
  z-index: 1;
}

.c1 {
  --to: translateY(-54%) rotate(-3.5deg);
  left: 19.5%;
  z-index: 2;
  animation-delay: 80ms;
}

.c2 {
  --to: translateY(-48%) rotate(3.5deg);
  left: 34.5%;
  z-index: 3;
  animation-delay: 160ms;
}

.c3 {
  --to: translateY(-52%) rotate(10deg);
  left: 49%;
  z-index: 4;
  animation-delay: 240ms;
}

.card {
  transform: var(--to);
}

.card:hover {
  transform: var(--to) translateY(-18px);
}

@keyframes deal {
  from {
    opacity: 0;
    transform: translate(40%, -44%) rotate(0deg) scale(0.96);
  }
}

.hero-stream {
  margin: 8px var(--edge) 0;
  border-radius: var(--tile);
}

.wordmark {
  margin-top: clamp(16px, 2vw, 32px);
  margin-bottom: clamp(48px, 8vw, 120px);
  font-size: var(--step-display);
  font-weight: 800;
  letter-spacing: -0.06em;
  line-height: 0.88;
  white-space: nowrap;
}

/* 같은 이름, 다른 가게 */
.statement {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-template-rows: repeat(2, minmax(260px, 38svh));
  gap: var(--gap);
  padding-top: clamp(80px, 12vw, 160px);
}

.slogan {
  display: flex;
  align-items: flex-end;
  grid-column: 1 / span 8;
  grid-row: 1 / span 2;
  padding: var(--pad);
  border-radius: var(--tile);
  background: var(--ink);
  color: #fff;
}

.slogan h2 {
  font-size: clamp(64px, 9vw, 150px);
  line-height: 1.02;
}

.fig {
  display: flex;
  flex-direction: column;
  grid-column: 9 / span 4;
  padding: var(--pad);
  border-radius: var(--tile);
  background: var(--yellow);
  overflow: hidden;
}

.fig .big {
  font-size: var(--step-head);
  font-weight: 800;
  letter-spacing: -0.05em;
  line-height: 1;
}

.fig p:last-child {
  margin-top: auto;
  font-weight: 600;
}

.photo {
  grid-column: 9 / span 4;
  margin: 0;
  border-radius: var(--tile);
  overflow: hidden;
}

.photo img,
.showcase img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.text {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  padding: 40px 0;
}

.text p {
  grid-column: 7 / span 6;
  font-size: var(--step-lead);
  font-weight: 500;
  letter-spacing: -0.02em;
  line-height: 1.45;
}

/* 숫자 */
.stats {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  grid-template-rows: 14vh 12vh 44vh;
  gap: var(--gap);
  padding-top: clamp(80px, 12vw, 160px);
}

.stats h2 {
  grid-column: 7 / span 6;
  grid-row: 1;
  align-self: end;
  font-size: var(--step-head);
}

.s {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: var(--pad);
  border-radius: var(--tile);
  container-type: inline-size;
}

.s .big {
  font-size: min(var(--step-head), 19cqi);
  font-weight: 800;
  letter-spacing: -0.05em;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.s p:last-child {
  font-size: var(--step-lead);
  font-weight: 600;
}

.s1 .big {
  font-size: min(var(--step-display), 19cqi);
}

.s1 {
  grid-column: 1 / span 6;
  grid-row: 1 / span 3;
  min-height: 70vh;
  background: var(--blue);
  color: #fff;
}

.s2 {
  grid-column: 7 / span 3;
  grid-row: 2 / span 2;
  background: var(--ink);
  color: #fff;
}

.s3 {
  grid-column: 10 / span 3;
  grid-row: 3;
  background: var(--lime);
}

/* 업종 */
.kinds {
  padding-top: clamp(150px, 14vw, 200px);
}

.giant {
  font-size: var(--step-display);
  letter-spacing: -0.06em;
  line-height: 0.9;
}

.kinds-sub {
  max-width: 34em;
  margin: 24px 0 36px;
  color: var(--muted);
}

.kind {
  margin-bottom: var(--gap);
  border-radius: var(--tile);
  background: var(--surface);
}

.kind summary {
  display: grid;
  grid-template-columns: minmax(5em, 2fr) 7fr minmax(6em, 2fr);
  align-items: center;
  gap: 20px;
  padding: 18px var(--pad);
  cursor: pointer;
  list-style: none;
}

.kind summary::-webkit-details-marker {
  display: none;
}

.k-name {
  font-size: var(--step-lead);
  font-weight: 800;
  letter-spacing: -0.03em;
}

.k-bar {
  height: 34px;
  border-radius: var(--pill);
  background: var(--bg);
  overflow: hidden;
}

.k-bar i {
  display: block;
  height: 100%;
  border-radius: var(--pill);
  transform-origin: left;
  transform: scaleX(0);
  transition: transform 1s var(--out);
}

.kind.in .k-bar i {
  transform: scaleX(1);
  transition-delay: inherit;
}

.k-n {
  text-align: right;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.kind[open] summary {
  padding-bottom: 8px;
}

.k-body {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 24px;
  padding: 12px var(--pad) 26px;
}

.k-h {
  margin-bottom: 10px;
  font-weight: 800;
}

.k-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.k-pills span {
  padding: 8px 16px;
  border-radius: var(--pill);
  background: var(--bg);
  font-weight: 600;
}

.k-pills small,
.k-note {
  color: var(--muted);
}

.k-pills small {
  font-size: var(--step-small);
}

/* 사진 */
.showcase {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--gap);
  padding-top: clamp(80px, 12vw, 160px);
}

.showcase figure {
  margin: 0;
  border-radius: var(--tile);
  overflow: hidden;
}

.wide {
  position: relative;
  grid-column: 1 / span 8;
  height: clamp(360px, 46vw, 680px);
}

.wide figcaption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 12px var(--pad);
  background: var(--yellow);
  font-weight: 700;
}

.side {
  display: grid;
  grid-column: 9 / span 4;
  gap: var(--gap);
}

/* 체인과 동네 이름 */
.chains {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: var(--gap);
  padding-top: clamp(80px, 12vw, 160px);
}

.chains h2 {
  grid-column: 1 / -1;
  margin-bottom: 20px;
  font-size: var(--step-head);
}

.list,
.fact {
  padding: var(--pad);
  border-radius: var(--tile);
}

.list {
  grid-column: span 6;
}

.fact {
  grid-column: span 4;
  min-height: 300px;
}

.dark {
  background: var(--ink);
  color: #fff;
}

.pale {
  background: var(--surface);
}

.blue {
  background: var(--blue);
  color: #fff;
}

.yellow {
  background: var(--yellow);
}

.pink {
  background: var(--pink);
}

.l-h {
  margin-bottom: 18px;
  font-size: var(--step-lead);
  font-weight: 800;
  letter-spacing: -0.03em;
}

.list ol {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.list li {
  display: grid;
  grid-template-columns: 8em 1fr 4.5em;
  align-items: center;
  gap: 14px;
}

.list li span:first-child {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.list .bar {
  height: 18px;
  border-radius: var(--pill);
  overflow: hidden;
}

.dark .bar {
  background: #2a2a2a;
}

.pale .bar {
  background: var(--bg);
}

.list .bar i {
  display: block;
  height: 100%;
  border-radius: var(--pill);
  transform-origin: left;
  transform: scaleX(0);
  transition: transform 1.1s var(--out) 0.2s;
}

.dark .bar i {
  background: var(--yellow);
}

.pale .bar i {
  background: var(--green);
}

.list.in .bar i {
  transform: scaleX(1);
}

.list b {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.fact .row {
  display: flex;
  justify-content: space-between;
  font-size: var(--step-lead);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.longest {
  font-size: var(--step-lead);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

/* 바닥 */
.foot {
  padding-top: clamp(150px, 12vw, 180px);
  padding-bottom: 40px;
}

.blocks {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--gap);
}

.blocks span {
  display: flex;
  align-items: flex-end;
  aspect-ratio: 1;
  padding: 0.12em;
  border-radius: var(--tile);
  font-size: var(--step-display);
  font-weight: 800;
  letter-spacing: -0.05em;
  line-height: 0.9;
}

@supports (animation-timeline: view()) {
  .blocks span {
    animation: lift linear both;
    animation-timeline: view();
    animation-range: entry 0% entry 70%;
  }

  .blocks span:nth-child(2) {
    animation-range: entry 10% entry 80%;
  }

  .blocks span:nth-child(3) {
    animation-range: entry 20% entry 90%;
  }

  .blocks span:nth-child(4) {
    animation-range: entry 30% entry 100%;
  }
}

@keyframes lift {
  from {
    transform: translateY(30%);
  }
}

.foot-text {
  display: grid;
  gap: 12px;
  max-width: 70ch;
  margin-bottom: 28px;
  color: var(--muted);
  font-size: var(--step-small);
}

.links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  color: var(--ink);
  font-size: var(--step-body);
  font-weight: 700;
}

@media (max-width: 1024px) {
  .lead,
  .fan {
    grid-column: 1 / -1;
  }

  .fan {
    height: clamp(320px, 70vw, 460px);
  }

  .fact {
    grid-column: 1 / -1;
    min-height: 0;
  }
}

@media (max-width: 760px) {
  nav a:not(:last-child) {
    display: none;
  }

  .search {
    flex-direction: column;
    border-radius: var(--tile);
  }

  .search input {
    min-height: 52px;
  }

  .statement {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 46svh auto;
    gap: 6px;
  }

  .slogan {
    grid-column: 1 / -1;
    grid-row: 1;
  }

  .slogan h2 {
    font-size: 17vw;
  }

  .fig,
  .photo {
    grid-column: span 1;
    grid-row: 2;
    aspect-ratio: 1;
  }

  .text {
    display: block;
    padding: 20px 0;
  }

  .text p {
    font-size: 18px;
  }

  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: auto;
  }

  .stats h2 {
    grid-column: 1 / -1;
    grid-row: auto;
    margin-bottom: 12px;
  }

  .s1 {
    grid-column: 1 / -1;
    grid-row: auto;
    min-height: 46svh;
  }

  .s2 {
    grid-column: 1 / -1;
    grid-row: auto;
    min-height: 240px;
  }

  .s3 {
    grid-column: 2;
    grid-row: auto;
    min-height: 200px;
  }

  .kind summary {
    grid-template-columns: 1fr auto;
    gap: 10px 16px;
  }

  .k-bar {
    grid-column: 1 / -1;
    grid-row: 2;
    height: 22px;
  }

  .k-body {
    grid-template-columns: 1fr;
  }

  .wide,
  .side {
    grid-column: 1 / -1;
  }

  .side {
    grid-template-columns: 1fr 1fr;
    height: 220px;
  }

  .list {
    grid-column: 1 / -1;
  }

  .list li {
    grid-template-columns: 6.5em 1fr 4em;
  }
}
</style>
