<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { randomNames, search } from '../data.js'
import { closeCamera, faceTracker, openCamera } from '../face.js'
import { sfx } from '../sound.js'

// 간판 네컷: 웹캠을 픽셀 사진으로 바꾸고, 머리 위에 내 이름이 들어간 진짜 간판을 달아 네 컷을 찍는다
const art = (n) => new URL(`../assets/${n}.webp`, import.meta.url).href
const SIGNS = [art('sign-plain'), art('sign-gold'), art('sign-awning'), art('sign-gold')]
// 웹캠을 이 크기로 줄여 점을 찍은 뒤 다시 키운다
const PX = 4
// 어두운 데서 밝은 데로 네 가지 색
const PALETTE = [[29, 29, 43], [143, 179, 230], [246, 165, 192], [255, 246, 232]]
// 4x4 바이어 행렬로 색 사이를 점무늬로 섞는다
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const FONT = "Galmuri14, Galmuri11, monospace"
const CW = 480
const CH = 360

const phase = ref('menu')
const word = ref('')
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
let imgs = {}
let work

function loadImg(src) {
  return new Promise((ok, fail) => {
    const i = new Image()
    i.onload = () => ok(i)
    i.onerror = fail
    i.src = src
  })
}

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
  const list = [...new Set(SIGNS)]
  const loaded = await Promise.all(list.map(loadImg))
  imgs = Object.fromEntries(list.map((s, i) => [s, loaded[i]]))
  await document.fonts.load(`30px ${FONT}`, signs.value.join('') + '간판네컷0123456789.').catch(() => {})
  try {
    stream = await openCamera(video.value)
  } catch {
    phase.value = 'menu'
    msg.value = '카메라를 쓸 수 없어요. 브라우저에서 카메라를 허용해 주세요'
    return
  }
  phase.value = 'live'
  shots.value = []
  strip.value = ''
  work = document.createElement('canvas')
  work.width = CW / PX
  work.height = CH / PX
  raf = requestAnimationFrame(loop)
  // 얼굴 추적은 늦게 떠도 된다. 그 전에는 간판을 화면 위쪽 가운데에 단다
  faceTracker(video.value).then((t) => (tracker = t)).catch(() => {})
}

// 영상 한 장을 작게 줄여 네 가지 색 점무늬로 찍고, 다시 키워서 픽셀 사진으로
function pixelDraw(ctx) {
  const v = video.value
  const sw = work.width
  const sh = work.height
  const wc = work.getContext('2d', { willReadFrequently: true })
  const s = Math.max(sw / v.videoWidth, sh / v.videoHeight)
  const w = v.videoWidth * s
  const h = v.videoHeight * s
  wc.save()
  wc.translate(sw, 0)
  wc.scale(-1, 1)
  wc.drawImage(v, (sw - w) / 2, (sh - h) / 2, w, h)
  wc.restore()
  const img = wc.getImageData(0, 0, sw, sh)
  const d = img.data
  const top = PALETTE.length - 1
  for (let y = 0, p = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++, p += 4) {
      const l = (d[p] * 0.3 + d[p + 1] * 0.59 + d[p + 2] * 0.11) / 255
      const t = Math.min(top, Math.max(0, (l * 1.25 - 0.1) * top + (BAYER[(y % 4) * 4 + (x % 4)] / 16 - 0.5)))
      const c = PALETTE[Math.round(t)]
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]
    }
  }
  wc.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(work, 0, 0, CW, CH)
}

function sign(ctx, name, k) {
  const face = tracker?.read()
  const board = imgs[SIGNS[k % SIGNS.length]]
  ctx.font = `30px ${FONT}`
  const tw = ctx.measureText(name).width
  const w = Math.min(CW - 20, Math.max(face ? face.size * CW * 1.7 : 260, tw + 60))
  const h = w * (board.height / board.width)
  const cx = face ? face.x * CW : CW / 2
  const top = face ? face.top * CH - h - 14 : 14
  const x = Math.max(6, Math.min(CW - w - 6, cx - w / 2))
  const y = Math.max(6, top)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(board, x, y, w, h)
  ctx.fillStyle = '#1d1d2b'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const size = Math.min(30, (w - 40) / Math.max(name.length, 1) * 1.05, h * 0.55)
  ctx.font = `${size}px ${FONT}`
  ctx.fillText(name, x + w / 2, y + h / 2 + 2)
}

function loop() {
  const ctx = view.value?.getContext('2d', { willReadFrequently: true })
  if (ctx && video.value.readyState >= 2) {
    pixelDraw(ctx)
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
      sfx.tick()
      await wait(700)
    }
    count.value = 0
    flash.value = true
    sfx.scratch(2, 0, 0.06, 5000)
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

// 분홍 사진 띠에 네 컷을 세로로 붙이고 아래에 날짜를 찍는다
function compose() {
  const M = 20
  const GAP = 14
  const HEAD = 64
  const FOOT = 56
  const out = document.createElement('canvas')
  out.width = CW + M * 2
  out.height = HEAD + CH * 4 + GAP * 3 + FOOT
  const ctx = out.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = '#f6a5c0'
  ctx.fillRect(0, 0, out.width, out.height)
  // 가장자리 바둑판 무늬
  ctx.fillStyle = '#fff6e8'
  for (let y = 0; y < out.height; y += 8) {
    for (const x of [(y / 8) % 2 ? 4 : 0, out.width - 8 + ((y / 8) % 2 ? 4 : 0)]) ctx.fillRect(x, y, 4, 4)
  }
  ctx.fillStyle = '#1d1d2b'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `30px ${FONT}`
  ctx.fillText('★ 간판 네컷 ★', out.width / 2, HEAD / 2 + 2)
  shots.value.forEach((shot, i) => {
    const y = HEAD + i * (CH + GAP)
    ctx.fillStyle = '#1d1d2b'
    ctx.fillRect(M - 4 + 6, y - 4 + 6, CW + 8, CH + 8)
    ctx.fillRect(M - 4, y - 4, CW + 8, CH + 8)
    ctx.drawImage(shot, M, y)
  })
  const now = new Date()
  ctx.font = `22px ${FONT}`
  ctx.fillText(`${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()} · 간판도감 98`, out.width / 2, out.height - FOOT / 2 + 4)
  strip.value = out.toDataURL('image/png')
  phase.value = 'done'
  sfx.bell()
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
  <div class="booth">
    <div v-show="phase === 'menu' || phase === 'loading'" class="menu">
      <p class="t">간판 네컷</p>
      <p>내 얼굴을 픽셀 사진으로 바꾸고, 머리 위에 <b>내 이름이 들어간 진짜 간판</b>을 달아 네 컷을 찍어요.<br />영상은 이 브라우저 밖으로 나가지 않아요.</p>
      <form class="row" @submit.prevent="begin">
        <input v-model="word" type="text" class="name" maxlength="8" placeholder="내 이름 (예: 민수)" />
        <button class="go" :disabled="phase === 'loading'">{{ phase === 'loading' ? '간판 고르는 중…' : '카메라 켜기' }}</button>
      </form>
      <p v-if="msg" class="muted">{{ msg }}</p>
    </div>

    <div v-show="phase === 'live' || phase === 'shooting'" class="live">
      <div class="screen">
        <canvas ref="view" class="pixel" :width="CW" :height="CH"></canvas>
        <span v-if="count" class="count">{{ count }}</span>
        <span v-if="flash" class="flash"></span>
      </div>
      <p class="cuts">{{ shots.length }} / 4컷 · 지금 간판: <b>{{ signs[shots.length % 4] }}</b></p>
      <button class="go" :disabled="phase === 'shooting'" @click="shoot">{{ phase === 'shooting' ? '찍는 중…' : '찰칵! 네 컷 찍기' }}</button>
      <p v-if="msg" class="muted">{{ msg }}</p>
    </div>

    <div v-if="phase === 'done'" class="done">
      <img class="pixel" :src="strip" alt="간판 네컷 사진" />
      <div class="side">
        <p>오늘의 간판 네컷 완성!</p>
        <a class="save" :href="strip" download="간판네컷.png"><button>사진 저장</button></a>
        <button @click="again">다시 찍기</button>
      </div>
    </div>

    <video ref="video" class="src" muted playsinline></video>
  </div>
</template>

<style scoped>
.booth {
  display: grid;
  gap: 8px;
}

.menu {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 18px 10px;
  text-align: center;
  font-size: 13px;
  line-height: 1.6;
}

.menu p {
  margin: 0;
}

.t {
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-size: 26px;
  padding: 0 10px;
  background: var(--yellow);
  border: 3px solid var(--ink);
}

.name {
  width: 170px;
}

.live {
  display: grid;
  justify-items: center;
  gap: 6px;
}

.screen {
  position: relative;
  width: 100%;
  max-width: 480px;
  padding: 2px;
  box-shadow: inset -1px -1px #fff, inset 1px 1px grey, inset -2px -2px #dfdfdf, inset 2px 2px #0a0a0a;
}

.screen canvas {
  display: block;
  width: 100%;
  height: auto;
  background: #fff6e8;
}

.count {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-size: 110px;
  color: var(--yellow);
  text-shadow: 5px 5px 0 var(--ink);
}

.flash {
  position: absolute;
  inset: 0;
  background: #fff;
}

.cuts {
  margin: 0;
  font-size: 13px;
}

.cuts b {
  font-weight: normal;
  padding: 0 4px;
  background: var(--yellow);
}

.done {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: center;
}

.done img {
  width: 170px;
  box-shadow: 4px 4px 0 var(--ink);
}

.side {
  display: grid;
  gap: 8px;
}

.side p {
  margin: 0;
  font-size: 14px;
}

.save button {
  width: 100%;
}

.src {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
