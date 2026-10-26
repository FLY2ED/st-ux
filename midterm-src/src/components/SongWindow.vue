<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { randomNames, search } from '../data.js'

// 간판 노래: 간판 이름 글자마다 음표가 되어 떨어진다. 제때 누르면 내가 그 간판을 부른다
const STAGE = new URL('../assets/stage.webp', import.meta.url).href
const KEYS = ['d', 'f', 'j', 'k']
const BPM = 104
const BEAT = 60 / BPM
// 판정 창(초). 리듬게임에 익숙하지 않은 사람 기준으로 넉넉하게
const WIN = { perfect: 0.06, great: 0.11, good: 0.16 }
// 음표가 판정선까지 내려오는 시간
const FALL = 1.9
const LEAD = 2 * 4 * BEAT
// 다 장조 펜타토닉 두 옥타브
const PENTA = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3]
// 마디마다 C - Am - F - G
const ROOTS = [130.8, 110, 87.3, 98]
const CHORDS = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]]

const phase = ref('menu')
const word = ref('')
const msg = ref('')
const song = ref([])
const notes = ref([])
const now = ref(0)
const score = ref(0)
const combo = ref(0)
const maxCombo = ref(0)
const judge = ref(null)
const tally = ref({ perfect: 0, great: 0, good: 0, miss: 0 })
const pressed = ref([false, false, false, false])
const auto = ref(false)

let ctx
let master
let start = 0
let raf = 0
let sched = 0
let nextBeat = 0
let jt

// 모음으로 줄을, 받침 유무로 높낮이를 정한다 (ㅏ계열·ㅓ계열·ㅗㅜ계열·ㅡㅣ계열)
const VOWEL_LANE = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3]
function noteOf(ch) {
  const code = ch.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return { lane: ch.charCodeAt(0) % 4, freq: PENTA[(ch.charCodeAt(0) % 4) * 2] }
  const vowel = Math.floor((code % 588) / 28)
  const jong = code % 28
  const lane = VOWEL_LANE[vowel]
  return { lane, freq: PENTA[lane * 2 + (jong ? 1 : 0)] }
}

// 간판 하나에 두 마디. 여덟 글자까지는 8분음표, 그보다 길면 16분음표로 쪼갠다
function compose(names) {
  const out = []
  names.forEach((name, k) => {
    const chars = [...name.replace(/\s/g, '')].slice(0, 14)
    const step = chars.length > 7 ? BEAT / 4 : BEAT / 2
    const bar0 = LEAD + k * 8 * BEAT
    chars.forEach((ch, i) => {
      const t = bar0 + i * step
      out.push({ id: `${k}-${i}`, t, ch, sign: k, ...noteOf(ch), hit: null })
    })
  })
  return out
}

async function pick() {
  msg.value = ''
  phase.value = 'loading'
  const w = word.value.trim()
  let names = []
  if (/[가-힣]{2}/.test(w)) {
    const r = await search(w).catch(() => null)
    names = [...new Set((r?.rows || []).filter((x) => x.exact).map((x) => x.name))]
  }
  if (names.length < 6) {
    const extra = (await randomNames(4)).map((n) => n.name).filter((n) => n.length >= 3 && n.length <= 10 && /^[가-힣]+$/.test(n))
    names.push(...extra.sort(() => Math.random() - 0.5))
  }
  song.value = names.filter((n) => n.length <= 14).sort(() => Math.random() - 0.5).slice(0, 6)
  if (w && !song.value.some((n) => n.includes(w))) msg.value = `'${w}' 들어간 간판을 못 찾아서 아무 간판으로 노래를 만들었어요`
  play()
}

function tone(freq, at, dur, type, vol, dest = master) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, at)
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(vol, at + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(g).connect(dest)
  o.start(at)
  o.stop(at + dur + 0.03)
}

function noise(at, dur, freq, vol) {
  const n = Math.floor(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, n, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n)
  const src = ctx.createBufferSource()
  const f = ctx.createBiquadFilter()
  const g = ctx.createGain()
  src.buffer = buf
  f.type = freq > 4000 ? 'highpass' : 'bandpass'
  f.frequency.value = freq
  g.gain.value = vol
  src.connect(f).connect(g).connect(master)
  src.start(at)
}

function kick(at) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.frequency.setValueAtTime(140, at)
  o.frequency.exponentialRampToValueAtTime(45, at + 0.12)
  g.gain.setValueAtTime(0.5, at)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2)
  o.connect(g).connect(master)
  o.start(at)
  o.stop(at + 0.22)
}

// 반주: 8분음표마다 미리 0.15초 앞서 예약한다 (판정과 같은 AudioContext 시계)
function schedule() {
  const end = LEAD + song.value.length * 8 * BEAT + 2 * BEAT
  while (nextBeat < end && start + nextBeat < ctx.currentTime + 0.15) {
    const at = start + nextBeat
    const eighth = Math.round(nextBeat / (BEAT / 2))
    const beat = eighth / 2
    const bar = Math.floor(beat / 4)
    const inBar = beat % 4
    noise(at, 0.04, 8000, eighth % 2 ? 0.05 : 0.08)
    if (inBar === 0 || inBar === 2) kick(at)
    if (inBar === 1 || inBar === 3) noise(at, 0.14, 1800, 0.22)
    if (eighth % 2 === 0) tone(ROOTS[bar % 4], at, BEAT * 0.9, 'triangle', 0.16)
    if (inBar === 0) for (const f of CHORDS[bar % 4]) tone(f, at, BEAT * 3.8, 'sine', 0.025)
    // 시작 전 두 마디는 박자 세기
    if (nextBeat < LEAD && eighth % 2 === 0) tone(inBar === 0 ? 1568 : 1175, at, 0.06, 'sine', 0.06)
    nextBeat += BEAT / 2
  }
}

function sing(freq, at) {
  tone(freq, at, BEAT * 0.55, 'square', 0.05)
  tone(freq * 2, at, BEAT * 0.3, 'sine', 0.04)
}

function play() {
  ctx ||= new (window.AudioContext || window.webkitAudioContext)()
  ctx.resume()
  master = ctx.createGain()
  master.gain.value = 0.8
  master.connect(ctx.destination)
  notes.value = compose(song.value)
  score.value = 0
  combo.value = 0
  maxCombo.value = 0
  tally.value = { perfect: 0, great: 0, good: 0, miss: 0 }
  judge.value = null
  start = ctx.currentTime + 0.3
  nextBeat = 0
  phase.value = 'play'
  sched = setInterval(schedule, 25)
  schedule()
  raf = requestAnimationFrame(frame)
}

function show(kind) {
  judge.value = { kind, id: Math.random() }
  clearTimeout(jt)
  jt = setTimeout(() => (judge.value = null), 450)
}

function frame() {
  now.value = ctx.currentTime - start
  for (const n of notes.value) {
    if (n.hit) continue
    if (auto.value && now.value >= n.t) hitNote(n, 0)
    else if (now.value - n.t > WIN.good) {
      n.hit = 'miss'
      tally.value.miss++
      combo.value = 0
      show('miss')
    }
  }
  const end = LEAD + song.value.length * 8 * BEAT + BEAT
  if (now.value > end) return finish()
  raf = requestAnimationFrame(frame)
}

function hitNote(n, diff) {
  const d = Math.abs(diff)
  const kind = d <= WIN.perfect ? 'perfect' : d <= WIN.great ? 'great' : 'good'
  n.hit = kind
  tally.value[kind]++
  combo.value++
  maxCombo.value = Math.max(maxCombo.value, combo.value)
  score.value += { perfect: 300, great: 200, good: 100 }[kind] + Math.min(combo.value, 50) * 4
  sing(n.freq, ctx.currentTime)
  show(kind)
}

function press(lane) {
  if (phase.value !== 'play') return
  pressed.value[lane] = true
  setTimeout(() => (pressed.value[lane] = false), 90)
  const t = ctx.currentTime - start
  const cand = notes.value.find((n) => !n.hit && n.lane === lane && Math.abs(n.t - t) <= WIN.good)
  if (cand) hitNote(cand, t - cand.t)
  else tone(196, ctx.currentTime, 0.05, 'triangle', 0.03)
}

function finish() {
  cancelAnimationFrame(raf)
  clearInterval(sched)
  phase.value = 'over'
}

function stop() {
  cancelAnimationFrame(raf)
  clearInterval(sched)
  master?.disconnect()
  phase.value = 'menu'
}

const accuracy = computed(() => {
  const t = tally.value
  const total = t.perfect + t.great + t.good + t.miss
  return total ? Math.round(((t.perfect + t.great * 0.8 + t.good * 0.5) / total) * 100) : 0
})

const rank = computed(() => (accuracy.value >= 95 ? 'S' : accuracy.value >= 85 ? 'A' : accuracy.value >= 70 ? 'B' : accuracy.value >= 50 ? 'C' : 'D'))

// 지금 부르는 간판과 가사 진행
const current = computed(() => {
  const k = Math.max(0, Math.min(song.value.length - 1, Math.floor((now.value - LEAD) / (8 * BEAT))))
  return { k, name: song.value[k] || '', chars: notes.value.filter((n) => n.sign === k) }
})

const visible = computed(() => notes.value.filter((n) => n.t - now.value < FALL && now.value - n.t < 0.3 && n.hit !== 'perfect' && n.hit !== 'great' && n.hit !== 'good'))
const y = (n) => `${(1 - (n.t - now.value) / FALL) * 86}%`

function down(e) {
  const lane = KEYS.indexOf(e.key.toLowerCase())
  if (lane < 0 || e.repeat || phase.value !== 'play') return
  if (e.target.tagName === 'INPUT') return
  e.preventDefault()
  press(lane)
}

onMounted(() => window.addEventListener('keydown', down))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', down)
  cancelAnimationFrame(raf)
  clearInterval(sched)
  ctx?.close()
})
</script>

<template>
  <div class="song">
    <div class="stage sunken-panel">
      <img class="pixel" :src="STAGE" alt="" draggable="false" />
      <div v-if="phase === 'play'" class="lyric">
        <span v-for="n in current.chars" :key="n.id" :class="n.hit && n.hit !== 'miss' ? 'sung' : n.hit === 'miss' ? 'missed' : ''">{{ n.ch }}</span>
        <small>{{ current.k + 1 }} / {{ song.length }}번째 간판</small>
      </div>
      <div v-else-if="phase === 'over'" class="lyric">
        <span class="rank">{{ rank }}</span>
        <small>정확도 {{ accuracy }}% · 최대 {{ maxCombo }}콤보 · {{ score.toLocaleString() }}점</small>
      </div>
      <div v-else class="lyric intro">
        <b>간판 노래방</b>
        <small>간판 이름 글자가 음표로 떨어져요</small>
      </div>
    </div>

    <div v-if="phase === 'menu' || phase === 'loading'" class="menu">
      <p>단어를 넣으면 그 단어가 들어간 <b>진짜 간판</b> 여섯 개로 노래를 만들어요. 모음(ㅏ·ㅓ·ㅗ·ㅡ)마다 줄이, 받침마다 음 높이가 정해져요.</p>
      <form class="row" @submit.prevent="pick">
        <input v-model="word" type="text" class="w" maxlength="8" placeholder="예: 사랑, 치킨, 내 이름" />
        <button class="go" :disabled="phase === 'loading'">{{ phase === 'loading' ? '간판 고르는 중…' : '♪ 노래 만들기' }}</button>
      </form>
      <div class="auto"><input id="song-auto" v-model="auto" type="checkbox" /><label for="song-auto">자동 연주로 듣기만 하기</label></div>
      <p v-if="msg" class="muted">{{ msg }}</p>
    </div>

    <template v-else>
      <div class="lanes" :class="{ over: phase === 'over' }">
        <div v-for="(k, i) in KEYS" :key="k" class="lane" :class="{ down: pressed[i] }" @pointerdown.prevent="press(i)">
          <span class="key">{{ k.toUpperCase() }}</span>
        </div>
        <span
          v-for="n in visible"
          :key="n.id"
          class="note"
          :class="{ miss: n.hit === 'miss' }"
          :style="{ left: `${n.lane * 25 + 12.5}%`, top: y(n) }"
        >{{ n.ch }}</span>
        <div class="line" aria-hidden="true"></div>
        <span v-if="judge" :key="judge.id" class="judge" :class="judge.kind">{{ { perfect: '완벽!', great: '좋아!', good: '괜찮아', miss: '놓침' }[judge.kind] }}</span>
        <span v-if="combo > 2" class="combo">{{ combo }} 콤보</span>
      </div>
      <div class="foot">
        <span>점수 <b class="big-num">{{ score.toLocaleString() }}</b></span>
        <span class="muted">D F J K 또는 줄을 눌러요</span>
        <button v-if="phase === 'over'" class="go" @click="play">다시 부르기</button>
        <button @click="stop">{{ phase === 'over' ? '다른 노래' : '그만' }}</button>
      </div>
      <p v-if="phase === 'over'" class="setlist">오늘의 셋리스트: {{ song.join(' · ') }}</p>
    </template>
  </div>
</template>

<style scoped>
.song {
  display: grid;
  gap: 6px;
}

.stage {
  position: relative;
  aspect-ratio: 16 / 7;
  overflow: hidden;
}

.stage img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 0 70%;
}

/* 그림 오른쪽 빈 하늘 자리에 가사를 */
.lyric {
  position: absolute;
  left: 46%;
  right: 3%;
  top: 0;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  align-content: center;
  justify-content: center;
  gap: 0 2px;
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-size: clamp(22px, 4vw, 34px);
  line-height: 1.2;
  text-shadow: 2px 2px 0 #fff;
}

.lyric small {
  width: 100%;
  text-align: center;
  font-family: 'Galmuri11', monospace;
  font-size: 12px;
  color: #6b6b7b;
}

.lyric .sung {
  color: #e8478a;
}

.lyric .missed {
  opacity: 0.3;
}

.lyric .rank {
  font-size: 64px;
  color: #e8478a;
  text-shadow: 3px 3px 0 var(--ink);
}

.intro b {
  font-weight: normal;
  font-size: clamp(18px, 4.6vw, 30px);
  padding: 0 10px;
  white-space: nowrap;
  background: var(--yellow);
  border: 3px solid var(--ink);
  text-shadow: none;
}

.menu {
  display: grid;
  gap: 8px;
  justify-items: center;
  text-align: center;
  font-size: 13px;
  line-height: 1.6;
}

.menu p {
  margin: 0;
}

.w {
  width: 200px;
}

.lanes {
  position: relative;
  height: min(300px, 40dvh);
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  overflow: hidden;
  background:
    repeating-linear-gradient(transparent 0 23px, rgb(255 255 255 / 0.06) 23px 24px),
    #2b2540;
  touch-action: none;
}

.lanes.over {
  opacity: 0.5;
}

.lane {
  position: relative;
  border-right: 2px dotted rgb(255 255 255 / 0.25);
  cursor: pointer;
}

.lane:last-of-type {
  border-right: 0;
}

.lane.down {
  background: linear-gradient(transparent 40%, rgb(246 165 192 / 0.5));
}

.key {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  width: 34px;
  height: 28px;
  display: grid;
  place-items: center;
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-size: 14px;
  background: silver;
  box-shadow: inset -1px -1px #0a0a0a, inset 1px 1px #fff, inset -2px -2px grey, inset 2px 2px #dfdfdf;
}

.lane.down .key {
  background: var(--pink);
  box-shadow: inset 1px 1px #0a0a0a, inset -1px -1px #fff, inset 2px 2px grey;
}

.note {
  position: absolute;
  width: 42px;
  height: 42px;
  margin: -21px 0 0 -21px;
  display: grid;
  place-items: center;
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-size: 20px;
  background: var(--yellow);
  border: 3px solid var(--ink);
  box-shadow: 3px 3px 0 #000;
  pointer-events: none;
}

.note.miss {
  opacity: 0.25;
}

.line {
  position: absolute;
  left: 0;
  right: 0;
  top: 86%;
  height: 0;
  border-top: 3px dashed var(--pink);
  pointer-events: none;
}

.judge {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-size: 30px;
  color: #fff;
  text-shadow: 3px 3px 0 #000;
  pointer-events: none;
  animation: pop 0.45s steps(5) forwards;
}

.judge.perfect {
  color: var(--yellow);
}

.judge.miss {
  color: #aaa;
}

.combo {
  position: absolute;
  right: 10px;
  top: 6px;
  font-family: 'Galmuri14', 'Galmuri11', monospace;
  font-size: 16px;
  color: var(--pink);
  pointer-events: none;
}

.foot {
  display: flex;
  align-items: center;
  gap: 10px;
}

.foot .muted {
  flex: 1;
}

.setlist {
  margin: 0;
}

@keyframes pop {
  from {
    transform: translate(-50%, -50%) scale(1.4);
  }
  to {
    transform: translate(-50%, -80%) scale(1);
    opacity: 0;
  }
}
</style>
