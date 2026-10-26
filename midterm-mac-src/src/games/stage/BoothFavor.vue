<script setup>
// 이야기 속 '간판 네컷': 픽셀 사진관 커튼 앞에서 내 캐릭터가 포즈를 잡고, 머리 위에 내 이름 글자가 든 진짜 간판을 단다.
// 스페이스(또는 버튼)를 누르면 3·2·1 찰칵 네 번, 네 컷을 이어 '여기 읽는 사람이 있다' 포스터를 만든다
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { drawAvatar, readLook } from '../../avatar.js'
import { randomNames, search } from '../../data.js'
import { pastelOf } from '../../shops.js'
import { sfx } from '../../sound.js'
import './stage.css'

const props = defineProps({
  word: { type: String, default: '' },
  ownerName: { type: String, default: '' },
  ownerArt: { type: String, default: '' },
  shopName: { type: String, default: '' },
})
const CW = 200
const CH = 150
// 거리와 같은 16색 팔레트의 커튼: 자주 · 남색 · 초록 · 밤색
const CURTAIN = [
  ['#7e2553', '#a8346c'],
  ['#1d2b53', '#2b3a78'],
  ['#008751', '#14a061'],
  ['#ab5236', '#c46a40'],
]
// 컷마다 다른 포즈: 정면 · 옆으로 · 만세 · 뒤돌아 윙크(반대 옆)
const POSES = [
  { dir: 0, frame: 0, hop: 0 },
  { dir: 3, frame: 1, hop: 0 },
  { dir: 0, frame: 1, hop: 8 },
  { dir: 2, frame: 1, hop: 0 },
]

const phase = ref('loading') // loading | ready | shooting | done
const signs = ref([])
const shotNo = ref(0)
const count = ref(0)
const flash = ref(false)
const strip = ref('')
const cv = ref(null)
const look = readLook()
const me = computed(() => (props.word || '수리공').trim())
const say = computed(() => {
  if (phase.value === 'loading') return '간판을 고르는 중이에요…'
  if (phase.value === 'ready') return `${me.value} 님 이름 글자가 든 간판을 달고 네 컷 찍어요! 준비되면 찰칵!`
  if (phase.value === 'shooting') return ['웃어요!', '옆으로 한 번!', '만세!', '마지막 컷!'][shotNo.value] || '찰칵!'
  return '"여기 읽는 사람이 있다" 포스터, 가게 앞에 붙여 둘게요!'
})

let font = 'sans-serif'
let tick = 0
let anim = 0
const shots = []
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms))
let alive = true

async function pick() {
  const w = me.value.replace(/\s+/g, '')
  const tries = [w, w.length > 2 ? w.slice(-2) : '', '수리'].filter((x) => /[가-힣]{2}/.test(x))
  let found = []
  for (const t of tries) {
    const r = await search(t).catch(() => null)
    found = [...new Set((r?.rows || []).filter((x) => x.exact && x.name.length <= 10).map((x) => x.name))]
    if (found.length >= 4) break
  }
  if (found.length < 4) found.push(...(await randomNames(2).catch(() => [])).map((n) => n.name).filter((n) => n.length <= 10))
  return found.sort(() => Math.random() - 0.5).slice(0, 4)
}

// 한 컷 그리기: 주름 커튼 → 나무 바닥 → 머리 위 간판 → 내 캐릭터
function paint(ctx, k, t = 0) {
  const pose = POSES[k % 4]
  const [dark, lite] = CURTAIN[k % 4]
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = dark
  ctx.fillRect(0, 0, CW, CH)
  // 주름: 밝은 기둥 + 한 칸 그늘
  for (let x = 0; x < CW; x += 16) {
    ctx.fillStyle = lite
    ctx.fillRect(x + 4, 0, 6, CH - 24)
    ctx.fillStyle = 'rgb(0 0 0 / 0.22)'
    ctx.fillRect(x + 10, 0, 2, CH - 24)
  }
  // 커튼 봉과 아랫단
  ctx.fillStyle = '#ffa300'
  ctx.fillRect(0, 0, CW, 3)
  ctx.fillStyle = 'rgb(0 0 0 / 0.3)'
  ctx.fillRect(0, CH - 28, CW, 4)
  ctx.fillStyle = '#5f3a24'
  ctx.fillRect(0, CH - 24, CW, 24)
  ctx.fillStyle = '#7a4a2c'
  for (let y = CH - 24, r = 0; y < CH; y += 6, r++) {
    ctx.fillRect(0, y, CW, 1)
    for (let x = (r % 2) * 13; x < CW; x += 26) ctx.fillRect(x, y, 1, 6)
  }
  // 발밑 그림자
  ctx.fillStyle = 'rgb(0 0 0 / 0.35)'
  ctx.fillRect(CW / 2 - 22, CH - 16, 44, 4)
  const bob = pose.hop ? Math.abs(Math.sin(t / 2)) * pose.hop : 0
  // 간판
  const name = signs.value[k % signs.value.length] || me.value
  ctx.font = `14px ${font}`
  const tw = ctx.measureText(name).width
  const w = Math.min(CW - 12, tw + 22)
  const h = 24
  const x = Math.round((CW - w) / 2)
  const y = Math.round(10 - bob / 2)
  ctx.fillStyle = '#141b3a'
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4)
  ctx.fillStyle = pastelOf(name)
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = 'rgb(255 255 255 / 0.35)'
  ctx.fillRect(x, y, w, 2)
  ctx.fillStyle = '#6b4a2a'
  ctx.fillRect(x + 10, y + h + 2, 2, 8)
  ctx.fillRect(x + w - 12, y + h + 2, 2, 8)
  ctx.fillStyle = '#1d1d2b'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, CW / 2, y + h / 2 + 1, w - 10)
  drawAvatar(ctx, look, CW / 2, CH - 14 - bob, { scale: 4, dir: pose.dir, frame: pose.frame })
  // 만세 컷엔 반짝이
  if (pose.hop) {
    ctx.fillStyle = '#ffec27'
    for (const [sx, sy] of [[30, 60], [168, 50], [150, 100], [44, 110]]) {
      const on = (Math.floor(t) + sx) % 3 === 0
      if (on) ctx.fillRect(sx - 1, sy - 4, 2, 8), ctx.fillRect(sx - 4, sy - 1, 8, 2)
    }
  }
}

// 찍는 동안만 보이는 뷰파인더 모서리 표시
function finder(ctx) {
  ctx.fillStyle = '#fff1e8'
  for (const [x, y, sx, sy] of [[4, 4, 1, 1], [CW - 4, 4, -1, 1], [4, CH - 4, 1, -1], [CW - 4, CH - 4, -1, -1]]) {
    ctx.fillRect(sx > 0 ? x : x - 12, sy > 0 ? y : y - 2, 12, 2)
    ctx.fillRect(sx > 0 ? x : x - 2, sy > 0 ? y : y - 12, 2, 12)
  }
  if (Math.floor(tick / 3) % 2) {
    ctx.fillStyle = '#ff004d'
    ctx.fillRect(CW - 18, 10, 5, 5)
  }
}

function live() {
  const ctx = cv.value?.getContext('2d')
  if (!ctx) return
  paint(ctx, shotNo.value, tick++)
  finder(ctx)
}

async function shoot() {
  if (phase.value !== 'ready') return
  phase.value = 'shooting'
  shots.length = 0
  for (let k = 0; k < 4 && alive; k++) {
    shotNo.value = k
    for (let n = 3; n > 0; n--) {
      count.value = n
      sfx.countdown(n)
      await wait(600)
    }
    count.value = 0
    const c = document.createElement('canvas')
    c.width = CW
    c.height = CH
    paint(c.getContext('2d'), k, tick)
    shots.push(c)
    flash.value = true
    sfx.shutter()
    await wait(160)
    flash.value = false
    await wait(380)
  }
  if (alive) compose()
}

// 포스터: 검은 띠 위에 네 컷, 위에는 한 줄, 아래에는 가게 이름과 날짜
function compose() {
  const M = 12
  const GAP = 8
  const HEAD = 32
  const FOOT = 28
  const out = document.createElement('canvas')
  out.width = CW + M * 2
  out.height = HEAD + CH * 4 + GAP * 3 + FOOT
  const ctx = out.getContext('2d')
  // 대화창과 같은 남색 판 + 크림 테두리
  ctx.fillStyle = '#fff1e8'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.fillStyle = '#141b3a'
  ctx.fillRect(3, 3, out.width - 6, out.height - 6)
  ctx.fillStyle = '#2b3a78'
  ctx.fillRect(6, 6, out.width - 12, 1)
  ctx.fillStyle = '#ffec27'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `14px ${font}`
  ctx.fillText('여기 읽는 사람이 있다', out.width / 2, HEAD / 2 + 1)
  shots.forEach((s, i) => {
    ctx.fillStyle = '#0b1028'
    ctx.fillRect(M - 2, HEAD + i * (CH + GAP) - 2, CW + 4, CH + 4)
    ctx.drawImage(s, M, HEAD + i * (CH + GAP))
  })
  const d = new Date()
  ctx.fillStyle = '#ffa300'
  ctx.font = `10px ${font}`
  ctx.fillText(`${props.shopName ? `${props.shopName} · ` : ''}${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`, out.width / 2, out.height - FOOT / 2, out.width - 12)
  strip.value = out.toDataURL('image/png')
  phase.value = 'done'
  sfx.bell()
  // 포스터가 붙는 걸 잠깐 보여 준 뒤에 끝을 알린다
  setTimeout(() => alive && window.dispatchEvent(new CustomEvent('game:over', { detail: { game: 'booth', score: 1 } })), 2400)
}

function onKey(e) {
  if (phase.value === 'ready' && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault()
    shoot()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  font = getComputedStyle(cv.value).fontFamily || font
  await document.fonts.ready.catch(() => {})
  signs.value = await pick()
  if (!alive) return
  phase.value = 'ready'
  anim = setInterval(live, 160)
})
onBeforeUnmount(() => {
  alive = false
  clearInterval(anim)
  window.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div class="sg bf">
    <div class="bf-wall" aria-hidden="true"></div>
    <header class="sg-hud">
      <span class="sg-chip"><small>컷</small><b>{{ phase === 'done' ? 4 : phase === 'shooting' ? shotNo + 1 : 0 }} / 4</b></span>
      <span class="sg-chip"><small>내 이름</small><b>{{ me }}</b></span>
    </header>

    <div class="bf-body">
      <!-- 사진관 부스: 대화창 같은 판 안이 뷰파인더 -->
      <section class="bf-booth">
        <div class="bf-frame">
          <span class="sg-tab">간판 네컷 사진관</span>
          <canvas v-show="phase !== 'done'" ref="cv" class="bf-view" :width="CW" :height="CH"></canvas>
          <span v-if="count" :key="count" class="bf-count px-pop">{{ count }}</span>
          <div v-if="flash" class="bf-flash"></div>
          <img v-if="phase === 'done'" class="bf-strip-big" :src="strip" alt="간판 네컷 포스터" />
        </div>
        <div class="bf-ctrl">
          <button v-if="phase === 'ready'" class="sg-btn go" @click="shoot">찰칵! 네 컷 찍기 <span class="sg-key">Space</span></button>
          <p v-else-if="phase === 'shooting'" class="bf-note">{{ shotNo + 1 }}번째 컷… 포즈 그대로!</p>
          <p v-else-if="phase === 'loading'" class="bf-note">간판 고르는 중…</p>
          <p v-else class="bf-note lit">포스터 완성! 「{{ me }}」 이름 간판 네 컷</p>
        </div>
      </section>

      <!-- 가게 앞 게시판과 사장님: 다 찍으면 포스터가 붙는다 -->
      <section class="bf-side">
        <div class="bf-board">
          <span class="sg-tab">가게 앞 게시판</span>
          <img v-if="strip" class="bf-poster px-pop" :src="strip" alt="" />
          <span v-else class="bf-empty">포스터 붙일 자리</span>
        </div>
        <div class="bf-owner">
          <p :key="say" class="sg-say bf-say px-pop">{{ say }}</p>
          <img v-if="ownerArt" :src="ownerArt" alt="" draggable="false" />
          <small v-if="ownerName">{{ ownerName }}</small>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* 사진관 안: 거리 가게 속처럼 남색 벽 + 나무 바닥 */
.bf-wall {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(transparent 0 calc(100% - 44px), #5f3a24 calc(100% - 44px) calc(100% - 40px), #3f2618 calc(100% - 40px)),
    repeating-linear-gradient(90deg, rgb(255 241 232 / 0.035) 0 4px, transparent 4px 48px);
}

.bf-body {
  position: absolute;
  inset: 56px 0 0;
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(220px, 0.8fr);
  gap: 26px;
  padding: 18px 26px 54px;
}

.bf-booth {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  justify-items: center;
  gap: 18px;
  min-height: 0;
  padding-top: 26px;
}

.bf-frame {
  position: relative;
  height: 100%;
  max-width: 100%;
  aspect-ratio: 4 / 3;
  min-height: 0;
  background: #141b3a;
  box-shadow: inset 0 0 0 3px #2b3a78, var(--sg-frame), 0 9px 0 rgb(0 0 0 / 0.45);
}

.bf-view,
.bf-strip-big {
  position: absolute;
  inset: 14px;
  width: calc(100% - 28px);
  height: calc(100% - 28px);
  object-fit: contain;
  image-rendering: pixelated;
}

.bf-count {
  position: absolute;
  top: 8%;
  right: 8%;
  color: #ffec27;
  font-size: clamp(60px, 9cqi, 110px);
  line-height: 1;
  text-shadow: 6px 6px 0 #000;
  pointer-events: none;
}

.bf-flash {
  position: absolute;
  inset: 0;
  background: #fff1e8;
  animation: bf-flash 0.16s steps(2) forwards;
}

@keyframes bf-flash {
  to {
    opacity: 0;
  }
}

.bf-ctrl {
  min-height: 50px;
  display: grid;
  place-items: center;
}

.bf-ctrl .sg-key {
  margin-left: 8px;
}

.bf-note {
  margin: 0;
  padding: 5px 14px;
  font-size: 14px;
  background: #141b3a;
  box-shadow: var(--sg-frame), 0 6px 0 rgb(0 0 0 / 0.45);
}

.bf-note.lit {
  color: #ffec27;
}

.bf-side {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 18px;
  min-height: 0;
  padding-top: 26px;
}

.bf-board {
  position: relative;
  justify-self: center;
  width: min(100%, 240px);
  height: 100%;
  display: grid;
  place-items: center;
  min-height: 0;
  background: #5f3a24;
  box-shadow: inset 0 0 0 3px #3f2618, var(--sg-frame), 0 9px 0 rgb(0 0 0 / 0.45);
}

.bf-empty {
  padding: 4px 8px;
  border: 2px dashed #ab7a52;
  color: #e0b080;
  font-size: 13px;
}

.bf-poster {
  position: absolute;
  inset: 12px;
  width: calc(100% - 24px);
  height: calc(100% - 24px);
  object-fit: contain;
  image-rendering: pixelated;
  rotate: -3deg;
  filter: drop-shadow(6px 8px 0 rgb(0 0 0 / 0.4));
}

.bf-owner {
  position: relative;
  display: grid;
  justify-items: end;
  gap: 4px;
}

.bf-owner img {
  height: clamp(96px, 12cqi, 140px);
}

.bf-owner small {
  padding: 3px 8px;
  font-size: 11px;
  color: #1d1d1f;
  background: #ffa300;
  box-shadow: var(--sg-frame);
}

.bf-say {
  position: absolute;
  bottom: calc(100% - 20px);
  right: 110px;
  width: max-content;
  max-width: min(280px, 28cqi);
  --tail: calc(100% - 26px);
}
</style>
