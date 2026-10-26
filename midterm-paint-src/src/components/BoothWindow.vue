<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { randomNames, search } from '../data.js'
import { closeCamera, faceTracker, openCamera } from '../face.js'
import { react } from '../mood.js'
import { sfx } from '../sound.js'

// 간판 네컷: 웹캠을 펜 그림으로 바꾸고, 머리 위에 내 이름이 들어간 진짜 간판을 달아 네 컷을 찍는다
const art = (n) => new URL(`../assets/${n}.webp`, import.meta.url).href
const FRAME = art('booth-frame')
const SIGNS = [art('sign-plain'), art('sign-hl'), art('sign-awning'), art('sign-hl')]
// booth-frame.webp 의 네 칸 (그림 기준 비율)
const HOLES = [
  [0.063, 0.0483, 0.867, 0.1966],
  [0.063, 0.2813, 0.867, 0.198],
  [0.063, 0.5189, 0.867, 0.2012],
  [0.063, 0.7449, 0.867, 0.1708],
]
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
  const list = [FRAME, ...new Set(SIGNS)]
  const loaded = await Promise.all(list.map(loadImg))
  imgs = Object.fromEntries(list.map((s, i) => [s, loaded[i]]))
  await document.fonts.load('700 30px Gaegu', signs.value.join('') + '간판네컷일기0123456789.')
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
  work.width = CW
  work.height = CH
  raf = requestAnimationFrame(loop)
  // 얼굴 추적은 늦게 떠도 된다. 그 전에는 간판을 화면 위쪽 가운데에 단다
  faceTracker(video.value).then((t) => (tracker = t)).catch(() => {})
}

// 영상 한 장을 펜 그림으로: 윤곽은 검은 선, 어두운 곳은 빗금, 나머지는 종이
function penDraw(ctx) {
  const v = video.value
  const s = Math.max(CW / v.videoWidth, CH / v.videoHeight)
  const w = v.videoWidth * s
  const h = v.videoHeight * s
  ctx.save()
  ctx.translate(CW, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(v, (CW - w) / 2, (CH - h) / 2, w, h)
  ctx.restore()
  const img = ctx.getImageData(0, 0, CW, CH)
  const d = img.data
  const g = new Float32Array(CW * CH)
  for (let i = 0, p = 0; i < d.length; i += 4, p++) g[p] = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const p = y * CW + x
      const l = g[p]
      const e = x < CW - 1 && y < CH - 1 ? Math.abs(g[p + 1] - l) + Math.abs(g[p + CW] - l) : 0
      let dark = e > 34 || l < 42
      if (!dark && l < 100) dark = (x + y) % 5 === 0
      if (!dark && l < 70) dark = (x - y + 999) % 5 === 0
      const i = p * 4
      if (dark) {
        d[i] = 27; d[i + 1] = 27; d[i + 2] = 27
      } else {
        d[i] = 255; d[i + 1] = 252; d[i + 2] = 243
      }
    }
  }
  ctx.putImageData(img, 0, 0)
}

function sign(ctx, name, k) {
  const face = tracker?.read()
  const board = imgs[SIGNS[k % SIGNS.length]]
  ctx.font = '700 30px Gaegu'
  const tw = ctx.measureText(name).width
  const w = Math.min(CW - 20, Math.max(face ? face.size * CW * 1.7 : 260, tw + 60))
  const h = w * (board.height / board.width)
  const cx = face ? face.x * CW : CW / 2
  const top = face ? face.top * CH - h - 14 : 14
  const x = Math.max(6, Math.min(CW - w - 6, cx - w / 2))
  const y = Math.max(6, top)
  ctx.drawImage(board, x, y, w, h)
  ctx.fillStyle = '#1b1b1b'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const size = Math.min(30, (w - 40) / Math.max(name.length, 1) * 1.05, h * 0.55)
  ctx.font = `700 ${size}px Gaegu`
  ctx.fillText(name, x + w / 2, y + h / 2 + 2)
}

function loop() {
  const ctx = view.value?.getContext('2d', { willReadFrequently: true })
  if (ctx && video.value.readyState >= 2) {
    penDraw(ctx)
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

function compose() {
  const f = imgs[FRAME]
  const out = document.createElement('canvas')
  out.width = f.width
  out.height = f.height
  const ctx = out.getContext('2d')
  ctx.drawImage(f, 0, 0)
  HOLES.forEach(([x, y, w, h], i) => {
    const shot = shots.value[i]
    const bx = x * f.width
    const by = y * f.height
    const bw = w * f.width
    const bh = h * f.height
    const s = Math.max(bw / CW, bh / CH)
    ctx.save()
    ctx.beginPath()
    ctx.rect(bx, by, bw, bh)
    ctx.clip()
    ctx.drawImage(shot, bx + (bw - CW * s) / 2, by + (bh - CH * s) / 2, CW * s, CH * s)
    ctx.restore()
    ctx.strokeStyle = '#1b1b1b'
    ctx.lineWidth = 3
    ctx.strokeRect(bx, by, bw, bh)
  })
  const now = new Date()
  ctx.fillStyle = '#1b1b1b'
  ctx.textAlign = 'left'
  ctx.font = `700 ${Math.round(f.width * 0.06)}px Gaegu`
  ctx.fillText(`간판 네컷 · ${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`, f.width * 0.17, f.height * 0.955)
  strip.value = out.toDataURL('image/png')
  phase.value = 'done'
  react('proud', 2400)
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
      <p class="t hand">간판 네컷</p>
      <p>내 얼굴을 펜 그림으로 바꾸고, 머리 위에 <b>내 이름이 들어간 진짜 간판</b>을 달아 네 컷을 찍어요.<br />영상은 이 브라우저 밖으로 나가지 않아요.</p>
      <form class="row" @submit.prevent="begin">
        <input v-model="word" class="name hand" maxlength="8" placeholder="내 이름 (예: 민수)" />
        <button class="go" :disabled="phase === 'loading'">{{ phase === 'loading' ? '간판 고르는 중…' : '📷 카메라 켜기' }}</button>
      </form>
      <p v-if="msg" class="muted">{{ msg }}</p>
    </div>

    <div v-show="phase === 'live' || phase === 'shooting'" class="live">
      <div class="screen">
        <canvas ref="view" :width="CW" :height="CH"></canvas>
        <span v-if="count" class="count hand">{{ count }}</span>
        <span v-if="flash" class="flash"></span>
      </div>
      <p class="hand cuts">{{ shots.length }} / 4컷 · 지금 간판: <b>{{ signs[shots.length % 4] }}</b></p>
      <button class="go" :disabled="phase === 'shooting'" @click="shoot">{{ phase === 'shooting' ? '찍는 중…' : '찰칵! 네 컷 찍기' }}</button>
      <p v-if="msg" class="muted">{{ msg }}</p>
    </div>

    <div v-if="phase === 'done'" class="done">
      <img :src="strip" alt="간판 네컷 사진" />
      <div class="side">
        <p class="hand">오늘의 간판 네컷 완성!</p>
        <a class="save hand" :href="strip" download="간판네컷.png">💾 사진 저장</a>
        <button @click="again">다시 찍기</button>
      </div>
    </div>

    <video ref="video" class="src" muted playsinline></video>
  </div>
</template>

<style scoped>
.booth {
  display: grid;
  gap: 10px;
}

.menu {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 18px 10px;
  text-align: center;
}

.menu p {
  margin: 0;
}

.t {
  font-size: 36px;
  background: linear-gradient(transparent 58%, var(--hl) 58% 90%, transparent 90%);
}

.name {
  width: 170px;
  font-size: 20px;
  padding: 4px 10px;
  border: 2px solid var(--ink);
  border-radius: var(--wob2);
}

.go {
  background: var(--hl);
}

.live {
  display: grid;
  justify-items: center;
  gap: 8px;
}

.screen {
  position: relative;
  width: 100%;
  max-width: 480px;
}

.screen canvas {
  display: block;
  width: 100%;
  height: auto;
  border: 2.5px solid var(--ink);
  border-radius: var(--wob);
  background: var(--paper);
}

.count {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 120px;
  -webkit-text-stroke: 3px var(--ink);
  color: var(--hl);
}

.flash {
  position: absolute;
  inset: 0;
  background: #fff;
  border-radius: var(--wob);
}

.cuts {
  margin: 0;
  font-size: 17px;
}

.cuts b {
  background: var(--hl-soft);
}

.done {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: center;
}

.done img {
  width: 170px;
  border: 2px solid var(--ink);
  box-shadow: 4px 5px 0 var(--ink);
  transform: rotate(-2deg);
}

.side {
  display: grid;
  gap: 8px;
}

.side p {
  margin: 0;
  font-size: 20px;
}

.save {
  display: inline-block;
  padding: 4px 14px;
  font-size: 17px;
  color: var(--ink);
  text-decoration: none;
  text-align: center;
  background: var(--hl);
  border: 2px solid var(--ink);
  border-radius: var(--wob);
  box-shadow: 2px 3px 0 var(--ink);
}

.src {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
