<script setup>
import { defineAsyncComponent, onBeforeUnmount, ref } from 'vue'
import { randomNames, search } from '../data.js'
import { closeCamera, faceTracker, openCamera } from '../face.js'
import CameraGate from './CameraGate.vue'
import { sfx } from '../sound.js'
import './pixel.css'

// 간판 네컷: 포토 부스처럼 웹캠을 찍고, 머리 위에 내 이름이 들어간 진짜 간판을 달아 네 컷을 남긴다
const ICON = new URL('../assets/mac/booth.webp', import.meta.url).href
const SIGN_COLORS = ['#ff375f', '#0a84ff', '#30d158', '#ff9f0a']
const FONT = "-apple-system, BlinkMacSystemFont, 'Pretendard Variable', Pretendard, sans-serif"
const CW = 480
const CH = 360

// word: 처음 칸에 넣어 둘 낱말(간판 수리공 이야기에서는 내 이름)
// embed: 이야기 안에서 열린 판. 웹캠 대신 사진관 커튼 앞의 내 캐릭터로 네 컷을 찍는다(BoothFavor)
const props = defineProps({
  word: { type: String, default: '' },
  embed: Boolean,
  ownerName: { type: String, default: '' },
  ownerArt: { type: String, default: '' },
  shopName: { type: String, default: '' },
})
const BoothFavor = defineAsyncComponent(() => import('./stage/BoothFavor.vue'))
const phase = ref('menu')
const word = ref(props.word)
const msg = ref('')
const signs = ref([])
const shots = ref([])
const count = ref(0)
const flash = ref(false)
const strip = ref('')
const view = ref(null)
const video = ref(null)

let stream = null
let tracker = null
let raf = 0

async function begin() {
  const w = word.value.trim()
  msg.value = ''
  phase.value = 'loading'
  let found = []
  if (/[가-힣]{2}/.test(w)) {
    const r = await search(w).catch(() => null)
    found = [...new Set((r?.rows || []).filter((x) => x.exact).map((x) => x.name))]
  }
  if (found.length < 4) found.push(...(await randomNames(2)).map((n) => n.name).sort(() => Math.random() - 0.5))
  signs.value = found.sort(() => Math.random() - 0.5).slice(0, 4)
  if (w && signs.value.every((s) => !s.includes(w))) msg.value = `'${w}' 들어간 간판이 없어서 아무 간판이나 골랐어요`
  await document.fonts.load(`700 30px ${FONT}`, signs.value.join('') + '간판네컷0123456789.').catch(() => {})
  // 카메라는 안내 시트(CameraGate)가 열고, 열리면 live() 로 넘어온다
  phase.value = 'gate'
}

const startCamera = (id) => openCamera(video.value, id)

function live(s) {
  stream = s
  phase.value = 'live'
  shots.value = []
  strip.value = ''
  raf = requestAnimationFrame(loop)
  // 얼굴 추적은 늦게 떠도 된다. 그 전에는 간판을 화면 위쪽 가운데에 단다
  faceTracker(video.value).then((t) => (tracker = t)).catch(() => {})
}

// 거울처럼 좌우를 뒤집어 화면을 꽉 채운다
function videoDraw(ctx) {
  const v = video.value
  const s = Math.max(CW / v.videoWidth, CH / v.videoHeight)
  const w = v.videoWidth * s
  const h = v.videoHeight * s
  ctx.save()
  ctx.translate(CW, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(v, (CW - w) / 2, (CH - h) / 2, w, h)
  ctx.restore()
}

// 둥근 간판: 업종 색 바탕에 흰 굵은 글씨, 아래로 그림자
function sign(ctx, name, k) {
  const face = tracker?.read()
  ctx.font = `700 30px ${FONT}`
  const tw = ctx.measureText(name).width
  const w = Math.min(CW - 20, Math.max(face ? face.size * CW * 1.5 : 220, tw + 48))
  const h = Math.min(64, w * 0.26)
  const cx = face ? face.x * CW : CW / 2
  const top = face ? face.top * CH - h - 14 : 14
  const x = Math.max(6, Math.min(CW - w - 6, cx - w / 2))
  const y = Math.max(6, top)
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'
  ctx.shadowBlur = 16
  ctx.shadowOffsetY = 6
  ctx.fillStyle = SIGN_COLORS[k % SIGN_COLORS.length]
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, h * 0.3)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(x + 4, y + 4, w - 8, h - 8, h * 0.22)
  ctx.stroke()
  const size = Math.min(30, ((w - 32) / Math.max(name.length, 1)) * 1.05, h * 0.5)
  ctx.font = `700 ${size}px ${FONT}`
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(name, x + w / 2, y + h / 2 + 1)
}

function loop() {
  const ctx = view.value?.getContext('2d', { willReadFrequently: true })
  if (ctx && video.value.readyState >= 2) {
    videoDraw(ctx)
    sign(ctx, signs.value[shots.value.length % 4], shots.value.length)
  }
  raf = requestAnimationFrame(loop)
}

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms))

async function shoot() {
  phase.value = 'shooting'
  for (let k = shots.value.length; k < 4; k++) {
    for (let n = 3; n > 0; n--) {
      count.value = n
      sfx.countdown(n)
      await wait(700)
    }
    count.value = 0
    flash.value = true
    sfx.shutter()
    const c = document.createElement('canvas')
    c.width = CW
    c.height = CH
    c.getContext('2d').drawImage(view.value, 0, 0)
    shots.value.push(c)
    await wait(180)
    flash.value = false
    await wait(500)
  }
  cancelAnimationFrame(raf)
  closeCamera(stream)
  stream = null
  compose()
}

// 흰 사진 띠에 네 컷을 둥글게 붙이고 아래에 날짜를 찍는다
function compose() {
  const M = 24
  const GAP = 16
  const HEAD = 76
  const FOOT = 64
  const out = document.createElement('canvas')
  out.width = CW + M * 2
  out.height = HEAD + CH * 4 + GAP * 3 + FOOT
  const ctx = out.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.fillStyle = '#1d1d1f'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 30px ${FONT}`
  ctx.fillText('간판 네컷', out.width / 2, HEAD / 2 + 4)
  shots.value.forEach((shot, i) => {
    const y = HEAD + i * (CH + GAP)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(M, y, CW, CH, 14)
    ctx.clip()
    ctx.drawImage(shot, M, y)
    ctx.restore()
  })
  const now = new Date()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.font = `500 20px ${FONT}`
  ctx.fillText(`${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()}. · 간판 도감`, out.width / 2, out.height - FOOT / 2)
  strip.value = out.toDataURL('image/png')
  phase.value = 'done'
  sfx.bell()
  window.dispatchEvent(new CustomEvent('game:over', { detail: { game: 'booth', score: 1 } }))
}

function again() {
  strip.value = ''
  shots.value = []
  phase.value = 'menu'
}

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  closeCamera(stream)
})
</script>

<template>
  <BoothFavor v-if="props.embed" :word="props.word" :owner-name="props.ownerName" :owner-art="props.ownerArt" :shop-name="props.shopName" />
  <div v-else class="booth-kiosk">
    <header class="booth-top">
      <div class="booth-brand">
        <strong>간판<span>네컷</span></strong>
        <small>나만의 셀프 포토부스</small>
      </div>
      <span class="booth-lens" aria-hidden="true"><i></i></span>
      <p class="booth-top-note">네 장의 순간,<br />하나의 기념사진</p>
    </header>

    <ol class="booth-steps" aria-label="사진 촬영 단계">
      <li :class="{ 'is-current': phase === 'menu' || phase === 'loading' || phase === 'gate', 'is-complete': phase === 'live' || phase === 'shooting' || phase === 'done' }" :aria-current="phase === 'menu' || phase === 'loading' || phase === 'gate' ? 'step' : undefined"><span>1</span>간판 찾기</li>
      <li :class="{ 'is-current': phase === 'live' || phase === 'shooting', 'is-complete': phase === 'done' }" :aria-current="phase === 'live' || phase === 'shooting' ? 'step' : undefined"><span>2</span>촬영</li>
      <li :class="{ 'is-current': phase === 'done' }" :aria-current="phase === 'done' ? 'step' : undefined"><span>3</span>저장</li>
    </ol>

    <div v-show="phase === 'menu' || phase === 'loading' || phase === 'gate'" class="booth-menu">
      <header class="booth-intro">
        <div class="booth-intro-copy">
          <span class="booth-tag">{{ phase === 'loading' ? '간판 고르는 중' : '이름 하나로 특별해지는 사진' }}</span>
          <h1>간판 달고<br /><em>찰칵, 네 컷!</em></h1>
          <p class="booth-lead">머리 위에 진짜 간판을 달고,<br />지금의 나를 네 컷으로 남겨요.</p>
        </div>
        <div class="booth-sample" aria-hidden="true">
          <small>간판 네컷</small>
          <div v-for="n in 4" :key="n" class="booth-sample-cut">
            <span class="booth-sample-sign">간판</span>
            <i class="booth-sample-person"></i>
          </div>
          <span class="booth-sample-caption">오늘도, 나답게</span>
        </div>
      </header>

      <div class="booth-details">
        <span><b>4컷</b> 자동 촬영</span>
        <span><b>3 · 2 · 1</b> 카운트다운</span>
        <span><b>PNG</b> 사진 저장</span>
      </div>

      <form class="booth-ask" @submit.prevent="begin">
        <div class="booth-field-heading">
          <label for="booth-name">간판에서 찾을 이름 <span>선택</span></label>
          <img class="booth-sticker" :src="ICON" alt="" draggable="false" />
        </div>
        <p id="booth-name-hint" class="booth-hint">이름이 들어간 실제 간판을 찾아요.<br />없으면 다른 진짜 간판을 골라 드려요.</p>
        <input id="booth-name" v-model="word" type="text" class="booth-name" maxlength="8" placeholder="내 이름 (예: 민수)" aria-describedby="booth-name-hint" />
        <button type="submit" class="booth-action" :disabled="phase === 'loading'">
          {{ phase === 'loading' ? '간판 고르는 중…' : '카메라 켜기' }}
          <span class="booth-button-arrow" aria-hidden="true">↗</span>
        </button>
      </form>
      <p class="booth-privacy">
        <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="4.5" y="8.5" width="11" height="8" rx="2" /><path d="M7 8.5V6a3 3 0 0 1 6 0v2.5M10 11.5v2" /></svg>
        영상은 이 브라우저 밖으로 나가지 않아요.
      </p>
      <p v-if="msg" class="booth-message">{{ msg }}</p>
    </div>

    <div v-show="phase === 'live' || phase === 'shooting'" class="booth-live">
      <header class="booth-heading">
        <span class="booth-tag">{{ phase === 'shooting' ? '자동 촬영 중' : '카메라 준비 완료' }}</span>
        <h2>{{ phase === 'shooting' ? '지금 이 순간,' : '준비됐다면,' }} <em>네 컷</em></h2>
        <p class="booth-lead">간판마다 포즈를 바꿔 보세요.</p>
      </header>
      <div class="booth-monitor">
        <div class="booth-monitor-bar"><b>간판 네컷</b><span>거울 화면</span></div>
        <div class="booth-screen">
          <canvas ref="view" :width="CW" :height="CH" aria-label="간판이 합성된 카메라 화면"></canvas>
          <span class="booth-frame-guide" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <span v-if="count" :key="count" class="booth-count">{{ count }}</span>
          <span v-if="flash" class="booth-flash" aria-hidden="true"></span>
          <span class="booth-cuts">촬영 <b>{{ shots.length }}</b> / 4</span>
        </div>
      </div>
      <div class="booth-progress">
        <div class="booth-cut-track" aria-hidden="true">
          <span v-for="n in 4" :key="n" :class="{ 'is-taken': n <= shots.length, 'is-next': phase === 'shooting' && n === shots.length + 1 }">{{ n }}</span>
        </div>
        <p>촬영한 사진 <b>{{ shots.length }}컷</b> / 전체 4컷</p>
      </div>
      <p class="booth-now"><span>지금 간판</span><b>{{ signs[shots.length % 4] }}</b></p>
      <button class="booth-action booth-shutter" :disabled="phase === 'shooting'" :aria-label="phase === 'shooting' ? '찍는 중' : '네 컷 찍기'" @click="shoot">
        <i aria-hidden="true"></i>
        {{ phase === 'shooting' ? '네 컷 찍는 중…' : '네 컷 찍기' }}
      </button>
      <p v-if="msg" class="booth-message">{{ msg }}</p>
    </div>

    <div v-if="phase === 'done'" class="booth-done">
      <header class="booth-heading">
        <span class="booth-tag">오늘의 간판 네컷</span>
        <h2 class="px-pop">네 컷 완성!<br /><em>간판 단 오늘, 챙겨 가요</em></h2>
        <p class="booth-lead">오늘 단 간판을 사진으로 간직해요.</p>
      </header>
      <div class="booth-result">
        <div class="booth-print-tray">
          <div class="booth-print-slot" aria-hidden="true"></div>
          <img class="booth-photo" :src="strip" alt="간판 네컷 사진" />
          <span class="booth-print-caption">네 컷을 한 장에</span>
        </div>
        <div class="booth-result-side">
          <div class="booth-receipt">
            <span class="booth-receipt-label">오늘 단 간판</span>
            <p>{{ signs.join(', ') }}</p>
            <div class="booth-receipt-meta"><span>촬영 완료 <b>{{ shots.length }}컷</b></span><span>PNG 이미지</span></div>
          </div>
          <a class="booth-action booth-save" :href="strip" download="간판네컷.png">사진 저장 <span aria-hidden="true">↓</span></a>
          <button class="booth-action booth-secondary" @click="again">다시 찍기</button>
          <p class="booth-hint booth-save-hint">사진을 저장해 오늘의 간판을 간직해요.</p>
        </div>
      </div>
    </div>

    <footer class="booth-footer"><span>간판 도감</span><span>나의 간판, 나의 순간</span></footer>
    <CameraGate v-if="phase === 'gate'" class="booth-gate" :open="startCamera" purpose="머리 위에 간판을 달아 찍기 위해" @ready="live" @cancel="phase = 'menu'" />
    <video ref="video" class="booth-src" muted playsinline></video>
  </div>
</template>

<style scoped>
.booth-kiosk {
  --booth-ink: #49332f;
  --booth-muted: #7c655e;
  --booth-accent: #883c4c;
  --booth-line: #dfcfc3;
  --label: var(--booth-ink);
  --label-2: var(--booth-muted);
  --accent: var(--booth-accent);
  --panel: #fffaf3;
  position: relative;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
  min-width: 0;
  padding: 24px clamp(16px, 4vw, 28px) 18px;
  border: 1px solid #e4d6c9;
  border-radius: 28px;
  color-scheme: light;
  color: var(--booth-ink);
  background: #f7efe3;
  background-image: radial-gradient(ellipse at 95% 5%, #f1dbd6 0, transparent 50%);
  font-family: 'Pretendard Variable', Pretendard, sans-serif;
  -webkit-font-smoothing: antialiased;
  overflow-wrap: anywhere;
}

.booth-kiosk *,
.booth-kiosk *::before,
.booth-kiosk *::after {
  box-sizing: border-box;
}

.booth-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

.booth-brand strong {
  display: block;
  font-size: 20px;
  font-weight: 850;
  letter-spacing: -0.07em;
}

.booth-brand strong span {
  color: var(--booth-accent);
}

.booth-brand small,
.booth-top-note {
  font-size: 10px;
  line-height: 1.6;
  color: var(--booth-muted);
}

.booth-top-note {
  margin: 0;
  text-align: right;
}

/* 키오스크 상단의 렌즈 */
.booth-lens {
  position: relative;
  display: grid;
  place-items: center;
  width: 50px;
  height: 50px;
  border: 5px solid #e1d3c8;
  border-radius: 50%;
  background: #453c3b;
  box-shadow: 0 2px 0 #fffaf4, inset 0 0 0 3px #655855, 0 3px 8px #49332f18;
}

.booth-lens i {
  width: 22px;
  height: 22px;
  border: 4px solid #262d34;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 28%, #c1d6d6 0 13%, #587b85 16%, #243a4c 48%, #171d27 70%);
  box-shadow: 0 0 0 2px #8a8079;
}

.booth-lens::after {
  content: '';
  position: absolute;
  right: -13px;
  top: 7px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #718475;
}

.booth-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  margin: 0;
  padding: 6px;
  border: 1px solid var(--booth-line);
  border-radius: 16px;
  list-style: none;
  background: #efe5da;
}

.booth-steps li {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  padding: 9px 4px;
  border-radius: 11px;
  font-size: 12px;
  font-weight: 650;
  line-height: 1.4;
  color: var(--booth-muted);
}

.booth-steps li > span {
  display: grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.booth-steps .is-current {
  color: #fffaf3;
  background: var(--booth-accent);
  box-shadow: 0 2px 5px #71344520;
}

.booth-steps .is-complete {
  color: #4f6758;
}

.booth-menu,
.booth-live,
.booth-done {
  display: grid;
  gap: 20px;
  width: 100%;
  max-width: 640px;
  min-width: 0;
  margin: 0 auto;
}

.booth-intro {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 100px;
  align-items: center;
  gap: 12px;
  padding: 6px 4px 8px;
}

.booth-intro-copy {
  min-width: 0;
}

.booth-tag {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.6;
  letter-spacing: 0.02em;
  color: var(--booth-accent);
}

.booth-intro h1,
.booth-heading h2 {
  margin: 12px 0;
  font-size: clamp(32px, 5vw, 44px);
  font-weight: 850;
  line-height: 1.18;
  letter-spacing: -0.065em;
  word-break: keep-all;
}

.booth-intro em,
.booth-heading em {
  font-style: normal;
  color: var(--booth-accent);
}

.booth-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--booth-muted);
  word-break: keep-all;
}

/* 사진 대신 실루엣으로 보여 주는 네 컷 안내 */
.booth-sample {
  display: grid;
  gap: 5px;
  width: 88px;
  padding: 9px 6px 8px;
  background: #fffdf9;
  box-shadow: 0 8px 16px #61423824, 0 0 0 1px #e4d6c9;
  text-align: center;
  transform: rotate(7deg);
}

.booth-sample > small {
  font-size: 8px;
  font-weight: 800;
  color: var(--booth-accent);
}

.booth-sample-cut {
  position: relative;
  height: 48px;
  overflow: hidden;
  border-radius: 2px;
  background: #e9d9d2;
}

.booth-sample-cut:nth-of-type(2) {
  background: #dce3d7;
}

.booth-sample-cut:nth-of-type(3) {
  background: #e9deca;
}

.booth-sample-cut:nth-of-type(4) {
  background: #dbdfe9;
}

.booth-sample-sign {
  position: absolute;
  z-index: 1;
  top: 5px;
  left: 50%;
  padding: 1px 10px;
  border: 1px solid #ffffff70;
  border-radius: 3px;
  font-size: 7px;
  font-weight: 700;
  color: #fff;
  background: var(--booth-accent);
  transform: translateX(-50%);
}

.booth-sample-person {
  position: absolute;
  bottom: -18px;
  left: calc(50% - 20px);
  width: 40px;
  height: 40px;
  border-radius: 50% 50% 0 0;
  background: #ad8b80;
}

.booth-sample-person::before {
  content: '';
  position: absolute;
  top: -12px;
  left: 11px;
  width: 18px;
  height: 20px;
  border-radius: 45%;
  background: #f7ecdc;
  box-shadow: inset 0 4px 0 #705b53;
}

.booth-sample-cut:nth-of-type(even) .booth-sample-person {
  transform: rotate(-12deg) translateX(4px);
}

.booth-sample-caption {
  font-size: 6px;
  letter-spacing: 0.05em;
  color: var(--booth-muted);
}

.booth-details {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px 18px;
  padding: 13px 4px;
  border-top: 1px dashed #cdb9ab;
  border-bottom: 1px dashed #cdb9ab;
  font-size: 11px;
  line-height: 1.6;
  color: var(--booth-muted);
}

.booth-details b {
  color: var(--booth-ink);
}

.booth-ask {
  display: grid;
  gap: 12px;
  min-width: 0;
  padding: 20px;
  border: 1px solid #e4d6c9;
  border-radius: 20px;
  background: #fffaf3;
  box-shadow: 0 4px 12px #76503c06;
}

.booth-field-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.booth-field-heading label {
  font-size: 14px;
  font-weight: 750;
  line-height: 1.5;
}

.booth-field-heading label span {
  display: inline-block;
  margin-left: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--booth-muted);
}

.booth-sticker {
  flex: none;
  width: 38px;
  height: 38px;
  object-fit: contain;
  transform: rotate(-8deg);
}

.booth-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--booth-muted);
  word-break: keep-all;
}

.mac-win .booth-kiosk input.booth-name {
  width: 100%;
  min-width: 0;
  height: 52px;
  padding: 0 15px;
  border: 1px solid #cdb9ab;
  border-radius: 12px;
  font: inherit;
  font-size: 15px;
  color: var(--booth-ink);
  background: #fff;
  box-shadow: inset 0 2px 3px #49332f05;
}

.booth-name::placeholder {
  color: #866e66;
}

.mac-win .booth-kiosk .booth-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  width: 100%;
  min-width: 0;
  min-height: 56px;
  height: auto;
  padding: 14px 20px;
  border: 1px solid #763041;
  border-radius: 15px;
  font: inherit;
  font-size: 16px;
  font-weight: 750;
  line-height: 1.4;
  color: #fffaf3;
  background: var(--booth-accent);
  box-shadow: inset 0 1px 0 #ffffff20, 0 4px 0 #68303d;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
}

.mac-win .booth-kiosk .booth-action:hover:not(:disabled) {
  background: #753143;
}

.mac-win .booth-kiosk .booth-action:active:not(:disabled) {
  background: #68303d;
  box-shadow: inset 0 2px 3px #49332f25;
  transform: translateY(3px);
}

.mac-win .booth-kiosk .booth-action:disabled {
  border: 1px solid #cfbfb5;
  color: #70594f;
  background: #e3d6cb;
  box-shadow: none;
  cursor: default;
}

.mac-win .booth-kiosk .booth-action:focus-visible,
.mac-win .booth-kiosk input.booth-name:focus,
.booth-kiosk .booth-gate :deep(button:focus-visible),
.booth-kiosk .booth-gate :deep(select:focus-visible) {
  outline: 3px solid #477265;
  outline-offset: 4px;
}

.booth-button-arrow {
  font-size: 21px;
  line-height: 1;
}

.booth-privacy {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--booth-muted);
  text-align: center;
}

.booth-privacy svg {
  flex: none;
}

.booth-message {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #d8b6a3;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.7;
  color: #7a4129;
  background: #fff4e8;
  text-align: center;
}

.booth-heading {
  text-align: center;
}

.booth-live .booth-heading h2 {
  font-size: clamp(26px, 4vw, 34px);
}

.booth-monitor {
  min-width: 0;
  padding: 10px;
  border: 1px solid #57423f;
  border-radius: 22px;
  background: #493a38;
  box-shadow: 0 5px 0 #dfcfc3, inset 0 1px 0 #ffffff20;
}

.booth-monitor-bar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 7px 10px;
  font-size: 10px;
  line-height: 1.5;
  color: #e9d7cc;
}

.booth-monitor-bar b {
  font-weight: 650;
  letter-spacing: 0.04em;
}

.booth-screen {
  position: relative;
  min-width: 0;
  overflow: hidden;
  isolation: isolate;
  border-radius: 13px;
  background: #252325;
}

.booth-screen canvas {
  display: block;
  width: 100%;
  height: auto;
}

.booth-frame-guide {
  position: absolute;
  inset: 18px;
  pointer-events: none;
}

.booth-frame-guide i {
  position: absolute;
  width: 18px;
  height: 18px;
  border: solid #ffffffb3;
  border-width: 2px 0 0 2px;
  border-radius: 4px 0 0 0;
  filter: drop-shadow(0 1px 2px #0006);
}

.booth-frame-guide i:nth-child(2) {
  right: 0;
  transform: rotate(90deg);
}

.booth-frame-guide i:nth-child(3) {
  right: 0;
  bottom: 0;
  transform: rotate(180deg);
}

.booth-frame-guide i:nth-child(4) {
  bottom: 0;
  transform: rotate(270deg);
}

/* 카운트다운: 픽셀 테두리 네모 칸에 큰 픽셀 숫자 */
.booth-count {
  position: absolute;
  z-index: 2;
  top: 50%;
  left: 50%;
  display: grid;
  place-items: center;
  width: 132px;
  height: 132px;
  font-family: var(--game-font);
  font-size: 96px;
  font-weight: 400;
  line-height: 1;
  color: #fff;
  background: #342024c4;
  text-shadow: 0 5px 0 #000;
  box-shadow:
    0 -4px 0 0 #fff,
    0 4px 0 0 #fff,
    -4px 0 0 0 #fff,
    4px 0 0 0 #fff,
    0 10px 0 0 #0006;
  transform: translate(-50%, -50%);
  animation: booth-count-in 0.36s steps(1) both;
}

.booth-flash {
  position: absolute;
  z-index: 4;
  inset: 0;
  background: #fff;
  pointer-events: none;
  animation: booth-flash-out 0.18s ease-out both;
}

.booth-cuts {
  position: absolute;
  right: 10px;
  bottom: 10px;
  padding: 6px 12px;
  border: 1px solid #ffffff60;
  border-radius: 9px;
  font-size: 12px;
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
  color: #fff;
  background: #342024cc;
}

.booth-cuts b {
  margin-left: 4px;
}

.booth-progress {
  display: grid;
  justify-items: center;
  gap: 10px;
}

.booth-cut-track {
  display: flex;
  gap: 10px;
}

.booth-cut-track span {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid #cdb9ab;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 700;
  color: var(--booth-muted);
  background: #fffaf3;
}

.booth-cut-track .is-taken {
  border-color: var(--booth-accent);
  color: #fff;
  background: var(--booth-accent);
}

.booth-cut-track .is-next {
  outline: 2px solid var(--booth-accent);
  outline-offset: 2px;
}

.booth-progress p {
  margin: 0;
  font-size: 11px;
  color: var(--booth-muted);
}

.booth-progress b {
  color: var(--booth-accent);
}

.booth-now {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px 12px;
  margin: 0;
  padding: 13px 16px;
  border: 1px solid #d0d9cd;
  border-radius: 14px;
  background: #e6ecdf;
  text-align: center;
}

.booth-now span {
  font-size: 11px;
  color: #516249;
}

.booth-now b {
  min-width: 0;
  font-size: 16px;
  line-height: 1.5;
  color: #344a36;
}

.booth-shutter i {
  flex: none;
  width: 23px;
  height: 23px;
  padding: 3px;
  border: 2px solid currentColor;
  border-radius: 50%;
  background: currentColor;
  background-clip: content-box;
}

/* 출력구 아래로 길게 내려오는 실제 사진 띠 */
.booth-result {
  display: grid;
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1fr);
  align-items: start;
  gap: 20px;
  min-width: 0;
}

.booth-print-tray {
  display: grid;
  justify-items: center;
  min-width: 0;
  padding: 16px 12px;
  border: 1px solid #e1cbc1;
  border-radius: 18px;
  background: #efdcd3;
}

.booth-print-slot {
  width: 100%;
  height: 7px;
  border: 1px solid #a68b7e;
  border-radius: 999px;
  background: #594740;
  box-shadow: 0 1px 0 #fff9;
}

.booth-photo {
  display: block;
  width: calc(100% - 14px);
  max-width: 174px;
  height: auto;
  margin-top: -1px;
  border: 1px solid #e8e0d7;
  background: #fff;
  box-shadow: 2px 7px 12px #7654452e, 0 2px 3px #7654451f;
  transform: rotate(-2deg);
  transform-origin: top center;
}

.booth-print-caption {
  margin-top: 16px;
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.08em;
  color: #7a5c50;
}

.booth-result-side {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.booth-receipt {
  min-width: 0;
  padding: 18px 14px 14px;
  border: 1px solid #e4d6c9;
  border-bottom: 2px dashed #d6c0b3;
  border-radius: 14px 14px 2px 2px;
  background: #fffaf3;
}

.booth-receipt-label {
  font-size: 11px;
  font-weight: 750;
  color: var(--booth-accent);
}

.booth-receipt p {
  margin: 12px 0 16px;
  font-size: 14px;
  font-weight: 650;
  line-height: 1.8;
}

.booth-receipt-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
  padding-top: 12px;
  border-top: 1px solid #e8dcd1;
  font-size: 10px;
  line-height: 1.6;
  color: var(--booth-muted);
}

.mac-win .booth-kiosk .booth-secondary {
  border: 1px solid #bda397;
  color: var(--booth-ink);
  background: #fffaf3;
  box-shadow: 0 3px 0 #dfcfc3;
}

.mac-win .booth-kiosk .booth-secondary:hover:not(:disabled),
.mac-win .booth-kiosk .booth-secondary:active:not(:disabled) {
  background: #ece0d5;
}

.booth-save-hint {
  font-size: 11px;
  text-align: center;
}

.booth-footer {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding-top: 16px;
  border-top: 1px dashed #cdb9ab;
  font-size: 10px;
  line-height: 1.5;
  letter-spacing: 0.04em;
  color: var(--booth-muted);
}

/* 카메라 안내도 같은 키오스크 패널로 */
.booth-kiosk .booth-gate {
  padding: 20px;
  border-radius: 27px;
  background: #49332f99;
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

.booth-kiosk .booth-gate :deep(.card) {
  width: min(340px, 100%);
  max-width: 100%;
  min-width: 0;
  padding: 24px 20px 20px;
  border: 1px solid #dfcfc3;
  border-radius: 24px;
  color: var(--booth-ink);
  background: #fffaf3;
  box-shadow: 0 16px 45px #34202440;
}

.booth-kiosk .booth-gate :deep(.cam) {
  border: 1px solid #d9b7b4;
  border-radius: 20px;
  color: var(--booth-accent);
  background: #f1dfd8;
  box-shadow: inset 0 1px 0 #fff, 0 4px 0 #e3c9c0;
}

.booth-kiosk .booth-gate :deep(.cam.bad) {
  color: #70594f;
  background: #e7dfd5;
  box-shadow: inset 0 1px 0 #fff, 0 4px 0 #d8c7bb;
}

.booth-kiosk .booth-gate :deep(.badge) {
  background: #9a3d3d;
  box-shadow: 0 0 0 3px #fffaf3;
}

.booth-kiosk .booth-gate :deep(.m-title),
.booth-kiosk .booth-gate :deep(.m-desc b) {
  color: var(--booth-ink);
}

.booth-kiosk .booth-gate :deep(.m-desc),
.booth-kiosk .booth-gate :deep(.pick) {
  color: var(--booth-muted);
}

.booth-kiosk .booth-gate :deep(.facts),
.booth-kiosk .booth-gate :deep(.steps) {
  min-width: 0;
  padding: 12px 14px 12px 28px;
  border: 1px solid #e3d5c8;
  border-radius: 13px;
  color: var(--booth-muted);
  background: #f2e9dd;
}

.booth-kiosk .booth-gate :deep(.facts li::marker),
.booth-kiosk .booth-gate :deep(.steps li::marker) {
  color: var(--booth-accent);
}

.booth-kiosk .booth-gate :deep(.pick) {
  flex-wrap: wrap;
  margin-top: 6px;
}

.booth-kiosk .booth-gate :deep(.pick select) {
  width: 100%;
  min-height: 44px;
  border: 1px solid #cdb9ab;
  border-radius: 10px;
  color: var(--booth-ink);
  background: #fff;
  box-shadow: none;
  font: inherit;
}

.booth-kiosk .booth-gate :deep(.btns) {
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 12px;
}

.mac-win .booth-kiosk .booth-gate :deep(.btns button) {
  min-width: 90px;
  min-height: 48px;
  padding: 12px;
  border: 1px solid #bda397;
  border-radius: 12px;
  color: var(--booth-ink);
  background: #f2e9dd;
  box-shadow: 0 3px 0 #dfcfc3;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.mac-win .booth-kiosk .booth-gate :deep(.btns button.go) {
  border-color: #763041;
  color: #fffaf3;
  background: var(--booth-accent);
  box-shadow: 0 3px 0 #68303d;
}

.mac-win .booth-kiosk .booth-gate :deep(.btns button:hover) {
  filter: brightness(0.94);
}

.booth-kiosk .booth-gate :deep(.spin) {
  border-color: #dfcfc3;
  border-top-color: var(--booth-accent);
}

.booth-src {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

@keyframes booth-count-in {
  0% {
    transform: translate(-50%, -50%) scale(0.4);
  }
  25% {
    transform: translate(-50%, -50%) scale(0.75);
  }
  50% {
    transform: translate(-50%, -50%) scale(1.12);
  }
  75% {
    transform: translate(-50%, -50%) scale(0.96);
  }
  100% {
    transform: translate(-50%, -50%);
  }
}

@keyframes booth-flash-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

@media (max-width: 480px) {
  .booth-kiosk {
    gap: 20px;
    padding: 20px 16px 16px;
  }

  .booth-intro {
    grid-template-columns: minmax(0, 1fr) 82px;
    gap: 8px;
    padding-inline: 0;
  }

  .booth-sample {
    width: 74px;
  }

  .booth-sample-cut {
    height: 42px;
  }

  .booth-intro h1 {
    font-size: 32px;
  }

  .booth-ask {
    padding: 16px;
  }

  .booth-result {
    gap: 14px;
  }

  .booth-print-tray {
    padding-inline: 8px;
  }

  .booth-result-side .booth-action {
    padding-inline: 10px;
    font-size: 14px;
  }
}

@media (max-width: 360px) {
  .booth-brand strong {
    font-size: 17px;
  }

  .booth-top-note {
    font-size: 9px;
  }

  .booth-steps li {
    gap: 4px;
    font-size: 11px;
  }

  .booth-result {
    grid-template-columns: minmax(0, 1fr);
  }

  .booth-print-tray {
    width: min(220px, 100%);
    justify-self: center;
  }
}

@media (prefers-reduced-motion: reduce) {
  .booth-count,
  .booth-flash {
    animation: none;
  }

  .mac-win .booth-kiosk .booth-action {
    transition: none;
  }
}
</style>
