// 효과음. 소리는 버스(ui·game·music)를 거쳐 부드러운 컴프레서로 모인다
// 손에 닿는 소리(클릭·긁기·쿵·동전)는 Kenney CC0 음원을 쓰고, 음이 있는 소리는 그 자리에서 합성한다
// 음원을 아직 못 받았거나 못 푸는 브라우저면 합성음으로 대신한다
const URLS = import.meta.glob('./assets/sfx/*.ogg', { eager: true, query: '?url', import: 'default' })

let ctx = null
let master = null
const bus = {}
const buffers = new Map()
let loading = null

export const sound = { muted: read() }

function read() {
  try {
    return localStorage.getItem('gp-muted') === '1'
  } catch {
    return false
  }
}

export function setMuted(v) {
  sound.muted = v
  if (v) stopBgm()
  try {
    localStorage.setItem('gp-muted', v ? '1' : '0')
  } catch {
    // 저장이 막혀도 이번 방문 동안은 유지된다
  }
}

// 버스별 음량. 게임 소리가 UI 소리보다 앞에 나오고, 음악은 뒤에 깔린다
const LEVELS = { ui: 0.45, game: 0.36, music: 0.35, bgm: 0.2 }

function audio() {
  if (sound.muted) return null
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)()
      const comp = ctx.createDynamicsCompressor()
      // 여러 소리가 겹칠 때만 눌러 주는 정도로 둔다. 문턱을 낮추면 짧은 클릭까지 뭉개진다
      comp.threshold.value = -10
      comp.knee.value = 6
      comp.ratio.value = 4
      comp.attack.value = 0.003
      comp.release.value = 0.25
      master = ctx.createGain()
      master.gain.value = 0.8
      master.connect(comp).connect(ctx.destination)
      for (const [name, level] of Object.entries(LEVELS)) {
        bus[name] = ctx.createGain()
        bus[name].gain.value = level
        bus[name].connect(master)
      }
    }
    if (ctx.state === 'suspended') ctx.resume()
    return ctx
  } catch {
    return null
  }
}

// 첫 클릭·키 입력 때 오디오를 깨우고 음원을 미리 받아 둔다
function preload() {
  const c = audio()
  if (!c || loading) return
  loading = Promise.all(
    Object.entries(URLS).map(async ([path, url]) => {
      try {
        const res = await fetch(url)
        const buf = await c.decodeAudioData(await res.arrayBuffer())
        buffers.set(path.split('/').pop().replace('.ogg', ''), buf)
      } catch {
        // 못 푸는 음원은 합성음으로 대신한다
      }
    }),
  )
}
if (typeof window !== 'undefined') {
  const wake = () => {
    preload()
    window.removeEventListener('pointerdown', wake, true)
    window.removeEventListener('keydown', wake, true)
  }
  window.addEventListener('pointerdown', wake, true)
  window.addEventListener('keydown', wake, true)
}

const jitter = (amount) => 1 + (Math.random() * 2 - 1) * amount
const pick = (list) => list[Math.floor(Math.random() * list.length)]

// 같은 소리가 한 프레임에 겹쳐 터지지 않게 막는다
const lastAt = new Map()
function gate(key, ms = 25) {
  const t = performance.now()
  if (t - (lastAt.get(key) || 0) < ms) return false
  lastAt.set(key, t)
  return true
}

// 음원 재생. 없으면 false 를 돌려주고 부른 쪽이 합성음을 낸다
function sample(names, { to = 'game', gain = 0.4, rate = 1, vary = 0.06, at = 0, offset = 0, dur } = {}) {
  const c = audio()
  if (!c) return true
  const buf = buffers.get(pick(names))
  if (!buf) {
    preload()
    return false
  }
  const now = c.currentTime + at
  const src = c.createBufferSource()
  const g = c.createGain()
  src.buffer = buf
  src.playbackRate.value = rate * jitter(vary)
  g.gain.setValueAtTime(Math.min(0.8, gain * jitter(vary)), now)
  if (dur) g.gain.exponentialRampToValueAtTime(0.001, now + dur)
  src.connect(g).connect(bus[to])
  src.start(now, offset, dur ? dur + 0.02 : undefined)
  if (to === 'game') duck(c)
  return true
}

// 게임 소리가 날 때 배경음을 잠깐 낮췄다가 되돌린다
function duck(c) {
  const g = bus.bgm?.gain
  if (!g) return
  const now = c.currentTime
  g.cancelScheduledValues(now)
  g.setValueAtTime(g.value, now)
  g.linearRampToValueAtTime(LEVELS.bgm * 0.55, now + 0.03)
  g.linearRampToValueAtTime(LEVELS.bgm, now + 0.45)
}

// 배경음. 앱마다 한 곡을 반복하고, 곡이 바뀌면 0.6초 동안 겹쳐 넘긴다
const BGM_URLS = import.meta.glob('./assets/bgm/*.mp3', { query: '?url', import: 'default' })
const tracks = new Map()
let playing = null // { name, src, g }
let wanted = null

function track(c, name) {
  const key = `./assets/bgm/${name}.mp3`
  if (!BGM_URLS[key]) return null
  if (!tracks.has(key)) {
    const p = BGM_URLS[key]()
      .then((url) => fetch(url))
      .then((res) => res.arrayBuffer())
      .then((buf) => c.decodeAudioData(buf))
    p.catch(() => tracks.delete(key))
    tracks.set(key, p)
  }
  return tracks.get(key)
}

function fadeOut(c, cur, sec = 0.6) {
  if (!cur) return
  const now = c.currentTime
  cur.g.gain.cancelScheduledValues(now)
  cur.g.gain.setValueAtTime(cur.g.gain.value, now)
  cur.g.gain.linearRampToValueAtTime(0, now + sec)
  cur.src.stop(now + sec + 0.05)
}

// name 이 없으면 멈춘다. 같은 곡이면 그대로 둔다
export async function playBgm(name) {
  wanted = name || null
  const c = audio()
  if (!c || !wanted) {
    if (c) fadeOut(c, playing)
    playing = null
    return
  }
  if (playing?.name === wanted) return
  const p = track(c, wanted)
  if (!p) {
    fadeOut(c, playing)
    playing = null
    return
  }
  let buf
  try {
    buf = await p
  } catch {
    return
  }
  // 받는 동안 다른 앱으로 넘어갔으면 버린다
  if (wanted !== name || playing?.name === name || sound.muted) return
  fadeOut(c, playing)
  const src = c.createBufferSource()
  const g = c.createGain()
  src.buffer = buf
  src.loop = true
  const now = c.currentTime
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(1, now + 0.6)
  src.connect(g).connect(bus.bgm)
  src.start(now)
  playing = { name, src, g }
}

export function stopBgm() {
  if (ctx) fadeOut(ctx, playing, 0.3)
  playing = null
}

// 탭을 가리면 쉬고, 돌아오면 다시 튼다
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return
    if (document.hidden) ctx.suspend()
    else if (!sound.muted) ctx.resume()
  })
}

// 음 하나. 짧게 올라갔다가 지수 곡선으로 사라진다
function tone(freq, { to = 'ui', type = 'sine', at = 0, dur = 0.15, peak = 0.3, attack = 0.004, glide, lp, detune = 0 } = {}) {
  const c = audio()
  if (!c) return
  const now = c.currentTime + at
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.detune.value = detune
  osc.frequency.setValueAtTime(freq, now)
  if (glide) osc.frequency.exponentialRampToValueAtTime(glide, now + dur)
  g.gain.setValueAtTime(0.001, now)
  g.gain.exponentialRampToValueAtTime(Math.min(0.8, peak), now + attack)
  g.gain.exponentialRampToValueAtTime(0.001, now + dur)
  let node = osc.connect(g)
  if (lp) {
    const f = c.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = lp
    node = node.connect(f)
  }
  node.connect(bus[to])
  osc.start(now)
  osc.stop(now + dur + 0.02)
}

// 종소리. 주파수 변조로 쇳소리 섞인 맑은 울림을 만든다
function chime(freq, { to = 'ui', at = 0, dur = 0.5, peak = 0.22, ratio = 1.4, depth = 900 } = {}) {
  const c = audio()
  if (!c) return
  const now = c.currentTime + at
  const mod = c.createOscillator()
  const modGain = c.createGain()
  const car = c.createOscillator()
  const g = c.createGain()
  mod.frequency.value = freq * ratio
  modGain.gain.setValueAtTime(depth, now)
  modGain.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.7)
  car.frequency.value = freq
  g.gain.setValueAtTime(0.001, now)
  g.gain.exponentialRampToValueAtTime(Math.min(0.8, peak), now + 0.004)
  g.gain.exponentialRampToValueAtTime(0.001, now + dur)
  mod.connect(modGain).connect(car.frequency)
  car.connect(g).connect(bus[to])
  mod.start(now)
  car.start(now)
  mod.stop(now + dur + 0.02)
  car.stop(now + dur + 0.02)
}

let noiseBuf = null
// 잡음 한 줄기. 필터를 휘두르면 휙 소리, 좁히면 긁는 소리가 된다
function noise({ to = 'ui', at = 0, dur = 0.1, peak = 0.2, attack = 0.004, type = 'bandpass', freq = 2000, sweep, Q = 1 } = {}) {
  const c = audio()
  if (!c) return
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  const now = c.currentTime + at
  const src = c.createBufferSource()
  const f = c.createBiquadFilter()
  const g = c.createGain()
  src.buffer = noiseBuf
  f.type = type
  f.Q.value = Q
  f.frequency.setValueAtTime(freq, now)
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, now + dur)
  g.gain.setValueAtTime(0.001, now)
  g.gain.exponentialRampToValueAtTime(Math.min(0.8, peak), now + attack)
  g.gain.exponentialRampToValueAtTime(0.001, now + dur)
  src.connect(f).connect(g).connect(bus[to])
  src.start(now, Math.random() * 0.5, dur + 0.02)
}

// 음계 (Hz)
const PENTA = [523.3, 587.3, 659.3, 784, 880, 1046.5, 1174.7, 1318.5, 1568, 1760]

// ── UI ─────────────────────────────────────────────

function click() {
  if (!gate('click', 30)) return
  if (!sample(['click_003', 'click_005'], { to: 'ui', gain: 0.22, vary: 0.08 })) noise({ freq: 1800, Q: 2, dur: 0.035, peak: 0.22 })
}

function hover() {
  if (!gate('hover', 60)) return
  tone(2600 * jitter(0.03), { dur: 0.05, peak: 0.05, attack: 0.008 })
}

function toggle(on = true) {
  tone(on ? 520 : 700, { glide: on ? 720 : 500, dur: 0.11, peak: 0.16 })
}

function pop() {
  if (!gate('pop', 30)) return
  if (!sample(['drop_002', 'drop_003'], { to: 'ui', gain: 0.22, vary: 0.08 })) tone(900 * jitter(0.05), { glide: 320, dur: 0.07, peak: 0.25 })
}

function whoosh(up = true, { dur = 0.22, peak = 0.12, to = 'ui' } = {}) {
  noise({ to, dur, peak, attack: dur * 0.35, freq: up ? 500 : 4000, sweep: up ? 4000 : 450, Q: 0.9 })
}

// 창이 뜰 때: 바람 한 줄기 위로 아주 작은 유리 소리
function windowOpen() {
  if (!gate('win', 60)) return
  whoosh(true, { dur: 0.18, peak: 0.12 })
  tone(1320 * jitter(0.02), { at: 0.05, dur: 0.12, peak: 0.09, attack: 0.01 })
}

// 창이 닫힐 때: 아래로 빠지는 바람과 낮은 톡
function windowClose() {
  if (!gate('win', 60)) return
  whoosh(false, { dur: 0.16, peak: 0.07 })
  tone(520, { glide: 300, at: 0.04, dur: 0.09, peak: 0.12 })
}

// 최소화: Dock 쪽으로 빨려 들어가는 소리
function minimize() {
  noise({ dur: 0.3, peak: 0.14, attack: 0.08, freq: 3000, sweep: 300, Q: 1.4 })
  tone(700, { glide: 260, dur: 0.26, peak: 0.09, attack: 0.03 })
}

function maximize() {
  noise({ dur: 0.22, peak: 0.13, attack: 0.1, freq: 400, sweep: 3200, Q: 1.2 })
}

// Dock 아이콘을 누르는 둥근 소리
function dock() {
  if (!gate('dock', 40)) return
  tone(440 * jitter(0.03), { glide: 330, dur: 0.08, peak: 0.16 })
  tone(1760, { dur: 0.04, peak: 0.03 })
}

// 알림: 두 음짜리 맑은 종
function notification() {
  chime(1318.5, { dur: 0.45, peak: 0.16, depth: 600 })
  chime(1975.5, { at: 0.12, dur: 0.6, peak: 0.12, depth: 500 })
}

// 자판 소리. 아주 작게, 매번 조금씩 다르게
function key() {
  if (!gate('key', 20)) return
  if (!sample(['click_003', 'click_005'], { to: 'ui', gain: 0.12, rate: 1.4, vary: 0.12 })) noise({ freq: 3500, Q: 8, dur: 0.025, peak: 0.08 })
}

// ── 게임 ───────────────────────────────────────────

function right() {
  if (!gate('right', 60)) return
  ;[784, 988, 1318.5].forEach((f, i) => {
    tone(f, { to: 'game', type: 'triangle', at: i * 0.07, dur: 0.18, peak: 0.22 })
    tone(f * 2, { to: 'game', at: i * 0.07, dur: 0.1, peak: 0.05 })
  })
}

function wrong() {
  if (!gate('wrong', 60)) return
  tone(330, { to: 'game', type: 'triangle', glide: 260, dur: 0.16, peak: 0.24, lp: 1400 })
  tone(247, { to: 'game', type: 'triangle', glide: 196, at: 0.12, dur: 0.24, peak: 0.24, lp: 1200 })
}

// 숫자가 넘어갈 때의 또각 소리
function tick() {
  if (!gate('tick', 30)) return
  tone(1500 * jitter(0.04), { to: 'game', type: 'triangle', dur: 0.03, peak: 0.12 })
}

// 마림바 같은 짧은 음. i 번째일수록 음이 올라간다
function build(i = 0) {
  const f = PENTA[Math.abs(i) % PENTA.length]
  tone(f, { to: 'game', dur: 0.22, peak: 0.16 })
  tone(f * 4, { to: 'game', dur: 0.05, peak: 0.04 })
}

// 자동차 경적: 살짝 어긋난 두 음을 막힌 소리로
function horn() {
  if (!gate('horn', 400)) return
  for (const [f, d] of [[392, -6], [494, 5]]) tone(f, { to: 'game', type: 'sawtooth', dur: 0.32, peak: 0.12, attack: 0.02, lp: 1600, detune: d })
}

// 네온이 지직거리다 켜지는 소리. n 번째 간판일수록 음이 올라간다
function neon(n = 0) {
  for (const t of [0, 0.08, 0.17]) tone(120, { to: 'game', type: 'sawtooth', at: t, dur: 0.045, peak: 0.07, lp: 900 })
  const f = PENTA[n % PENTA.length] * (n >= PENTA.length ? 2 : 1)
  chime(f, { to: 'game', at: 0.26, dur: 0.5, peak: 0.14, ratio: 2, depth: 400 })
  tone(f * 1.5, { to: 'game', type: 'triangle', at: 0.3, dur: 0.3, peak: 0.07 })
}

// 복권 은박을 긁는 소리
function scratch(strokes = 1, when = 0, len = 0.07, freq = 3200) {
  for (let k = 0; k < strokes; k++) {
    const at = when + k * (len + 0.03)
    const played = sample(['scratch_001', 'scratch_002'], { gain: 0.2, rate: freq / 4000, vary: 0.1, at, offset: Math.random() * 0.04, dur: len + 0.04 })
    if (!played) noise({ to: 'game', at, dur: len, peak: 0.14, freq: freq * jitter(0.15), Q: 1.4, attack: len * 0.4 })
  }
}

// 카메라 셔터
function shutter() {
  noise({ to: 'game', dur: 0.03, peak: 0.3, freq: 3000, Q: 0.8 })
  noise({ to: 'game', at: 0.06, dur: 0.05, peak: 0.22, freq: 1800, Q: 0.8 })
}

// 카운트다운. 마지막은 한 옥타브 위로 길게
function countdown(n = 1) {
  if (n > 0) tone(880, { to: 'game', type: 'triangle', dur: 0.12, peak: 0.2 })
  else tone(1760, { to: 'game', type: 'triangle', dur: 0.35, peak: 0.22 })
}

// 간판이 땅에 쿵 떨어지는 소리
function thud() {
  if (!gate('thud', 50)) return
  if (!sample(['impactPlank_medium_000', 'impactPlank_medium_001', 'impactMetal_light_001'], { gain: 0.42, vary: 0.1 })) noise({ to: 'game', dur: 0.12, peak: 0.3, type: 'lowpass', freq: 700 })
  tone(110 * jitter(0.08), { to: 'game', glide: 50, dur: 0.16, peak: 0.3 })
}

// 사람이 간판에 맞았을 때
function hurt() {
  if (!sample(['impactPunch_medium_000', 'impactPunch_medium_001'], { gain: 0.5, vary: 0.06 })) noise({ to: 'game', dur: 0.15, peak: 0.35, type: 'lowpass', freq: 900 })
  tone(300, { to: 'game', type: 'sawtooth', glide: 110, at: 0.02, dur: 0.24, peak: 0.12, lp: 1200 })
}

// 목숨 하나 더
function lifeUp() {
  ;[784, 1046.5, 1318.5, 1568].forEach((f, i) => tone(f, { to: 'game', type: 'triangle', at: i * 0.06, dur: 0.16, peak: 0.18 }))
  chime(2093, { to: 'game', at: 0.24, dur: 0.4, peak: 0.08 })
}

// 동전: 칩 부딪는 소리 위로 높은 두 음
function coin() {
  if (!gate('coin', 40)) return
  sample(['chips-collide-2', 'chip-lay-1'], { gain: 0.32, vary: 0.08 })
  tone(1975.5, { to: 'game', type: 'square', dur: 0.06, peak: 0.06, lp: 5000 })
  tone(2637, { to: 'game', type: 'square', at: 0.06, dur: 0.22, peak: 0.06, lp: 5000 })
}

// 간판 하나 지움. 콤보가 이어질수록 음이 올라간다
function combo(n = 0) {
  if (!gate('combo', 30)) return
  pop()
  const f = PENTA[Math.min(n, PENTA.length - 1)]
  tone(f, { to: 'game', type: 'triangle', dur: 0.14, peak: 0.2 })
  if (n >= 3) tone(f * 1.5, { to: 'game', at: 0.05, dur: 0.16, peak: 0.12 })
}

// 노란 간판: 화면의 간판이 한꺼번에 터진다
function blast() {
  noise({ to: 'game', dur: 0.5, peak: 0.35, type: 'lowpass', freq: 3000, sweep: 200, attack: 0.005 })
  tone(90, { to: 'game', glide: 40, dur: 0.4, peak: 0.35 })
  ;[1046.5, 1318.5, 1568, 2093].forEach((f, i) => chime(f, { to: 'game', at: 0.1 + i * 0.05, dur: 0.5, peak: 0.08 }))
}

// 단계 올라감
function levelUp() {
  ;[523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(f, { to: 'game', type: 'triangle', at: i * 0.08, dur: 0.22, peak: 0.2 }))
  tone(1046.5, { to: 'game', type: 'sawtooth', at: 0.32, dur: 0.4, peak: 0.07, lp: 2500 })
}

// 판 끝: 내려가는 세 음
function lose() {
  ;[[392, 370], [349, 330], [294, 220]].forEach(([a, b], i) =>
    tone(a, { to: 'game', type: 'triangle', glide: b, at: i * 0.22, dur: i === 2 ? 0.55 : 0.2, peak: 0.22, lp: 1600 }),
  )
}

// 복권 한 장이 미끄러져 나온다
function ticket() {
  if (!sample(['card-slide-1'], { gain: 0.5, offset: 0.12, vary: 0.04 })) whoosh(true, { dur: 0.2, peak: 0.12, to: 'game' })
}

// 복권 칸 하나가 열림. 귀한 이름이면 반짝
function flip(rare = false) {
  if (rare) {
    chime(1568, { to: 'game', dur: 0.5, peak: 0.16 })
    chime(2349, { to: 'game', at: 0.08, dur: 0.6, peak: 0.1 })
  } else {
    tone(660 * jitter(0.03), { to: 'game', type: 'triangle', dur: 0.12, peak: 0.16 })
  }
}

// 당첨 팡파르. 1등은 길고 크게, 2등은 짧게, 행운상은 가볍게
function win(rank = '행운상') {
  if (rank === '1등') {
    const notes = [[523.3, 0], [523.3, 0.12], [523.3, 0.24], [659.3, 0.36], [784, 0.6], [659.3, 0.78], [784, 0.9]]
    for (const [f, at] of notes) {
      tone(f, { to: 'game', type: 'sawtooth', at, dur: 0.22, peak: 0.12, lp: 2600, attack: 0.01 })
      tone(f * 2, { to: 'game', type: 'triangle', at, dur: 0.18, peak: 0.08 })
    }
    for (const f of [523.3, 659.3, 784, 1046.5]) tone(f, { to: 'game', type: 'sawtooth', at: 1.05, dur: 1.2, peak: 0.08, lp: 2200, attack: 0.03 })
    for (let k = 0; k < 6; k++) chime(1568 + k * 220, { to: 'game', at: 1.1 + k * 0.09, dur: 0.5, peak: 0.07 })
    for (let k = 0; k < 4; k++) sample(['chips-collide-2', 'chip-lay-1'], { gain: 0.25, at: 1.1 + k * 0.12 })
  } else if (rank === '2등') {
    ;[659.3, 784, 1046.5, 1318.5].forEach((f, i) => tone(f, { to: 'game', type: 'triangle', at: i * 0.09, dur: 0.24, peak: 0.2 }))
    chime(2093, { to: 'game', at: 0.38, dur: 0.6, peak: 0.1 })
    sample(['chips-collide-2'], { gain: 0.28, at: 0.38 })
  } else {
    right()
  }
}

// 바탕화면이 뜰 때 나는 시작음. 천천히 부풀어 오르는 화음 위로 종소리가 올라간다
function startup() {
  const c = audio()
  if (!c) return
  const now = c.currentTime + 0.05
  const echo = c.createDelay()
  const fb = c.createGain()
  const out = c.createGain()
  echo.delayTime.value = 0.28
  fb.gain.value = 0.35
  out.gain.value = 0.8
  out.connect(bus.music)
  out.connect(echo).connect(fb).connect(echo)
  echo.connect(bus.music)
  const pad = (freq, at, dur, type, peak, attack) => {
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(0.001, now + at)
    g.gain.exponentialRampToValueAtTime(peak, now + at + attack)
    g.gain.exponentialRampToValueAtTime(0.001, now + at + dur)
    osc.connect(g).connect(out)
    osc.start(now + at)
    osc.stop(now + at + dur + 0.05)
  }
  // 바닥 화음: E♭ 메이저 9
  for (const f of [155.6, 233.1, 311.1, 392, 466.2, 587.3]) pad(f, 0, 4.2, 'sine', 0.05, 1.2)
  for (const f of [155.6, 311.1]) pad(f * 1.003, 0, 4.2, 'triangle', 0.02, 1.4)
  // 위로 올라가는 종소리
  ;[622.3, 784, 932.3, 1174.7, 1244.5, 1568].forEach((f, i) => {
    pad(f, 0.35 + i * 0.22, 2.2, 'sine', 0.06, 0.01)
    pad(f * 2, 0.35 + i * 0.22, 0.9, 'sine', 0.015, 0.01)
  })
}

export const sfx = {
  // UI
  click,
  hover,
  toggle,
  pop,
  whoosh,
  open: windowOpen,
  windowOpen,
  windowClose,
  minimize,
  maximize,
  dock,
  notification,
  key,
  // 게임
  bell: notification,
  right,
  wrong,
  tick,
  build,
  horn,
  neon,
  scratch,
  shutter,
  countdown,
  thud,
  hurt,
  lifeUp,
  coin,
  combo,
  blast,
  levelUp,
  lose,
  ticket,
  flip,
  win,
  startup,
  dawn: startup,
}
