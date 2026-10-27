// 별자리 소리: 곡(assets/bgm/sky.mp3, Starfield Romance)을 틀고, 그 위에 손짓에 따라 합성음을 얹는다
// 별에 닿으면 그 높이의 음이, 누르면 화음 종이, 돌리면 바람 소리가, 다가가면 소리가 더 깊고 멀게 울린다
import { audioOut, bgmAlias, onMuted, replayBgm } from '../sound.js'

// 곡이 B♭ 단조(D♭ 장조)라 D♭ 오음계(레♭·미♭·파·라♭·시♭)만 쓴다. 어떤 음이 겹쳐도 곡과 어울린다
const SCALE = [0, 2, 4, 7, 9]
const ROOT = 138.59 // D♭3
const note = (i) => ROOT * 2 ** ((SCALE[((i % 5) + 5) % 5] + 12 * Math.floor(i / 5)) / 12)

let s = null // 켜져 있는 동안의 노드 묶음
let want = false
let unsub = null

// 길게 퍼지는 잔향: 흰 소음을 지수로 줄여 만든 4초 짜리 공간
function room(c) {
  const len = Math.floor(c.sampleRate * 4.2)
  const buf = c.createBuffer(2, len, c.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2
  }
  const v = c.createConvolver()
  v.buffer = buf
  return v
}

function build() {
  const o = audioOut('music')
  if (!o) return null
  const { c, out } = o
  const now = c.currentTime
  const n = { c }
  n.main = c.createGain()
  n.main.gain.setValueAtTime(0, now)
  n.main.gain.linearRampToValueAtTime(1, now + 2.5)
  n.main.connect(out)
  // 마른 소리와 잔향 소리. 다가갈수록 잔향 쪽이 커진다
  n.dry = c.createGain()
  n.wet = c.createGain()
  n.dry.gain.value = 0.55
  n.wet.gain.value = 0.6
  n.verb = room(c)
  n.send = c.createGain()
  n.send.connect(n.verb).connect(n.wet).connect(n.main)
  n.dry.connect(n.main)
  // 돌릴 때 부는 바람: 소음을 띠 필터로 걸러 둔다. 평소엔 거의 안 들린다
  const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate)
  const nd = nb.getChannelData(0)
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
  n.wind = c.createBufferSource()
  n.wind.buffer = nb
  n.wind.loop = true
  n.windF = c.createBiquadFilter()
  n.windF.type = 'bandpass'
  n.windF.frequency.value = 700
  n.windF.Q.value = 0.8
  n.windG = c.createGain()
  n.windG.gain.value = 0
  n.wind.connect(n.windF).connect(n.windG)
  n.windG.connect(n.send)
  n.windG.connect(n.dry)
  n.wind.start()
  // 두 손으로 집는 동안 울리는 낮은 5도
  n.holdG = c.createGain()
  n.holdG.gain.value = 0
  n.holdG.connect(n.send)
  n.holdG.connect(n.dry)
  n.hold = [ROOT / 2, (ROOT / 2) * 1.5, ROOT * 1.003].map((f) => {
    const x = c.createOscillator()
    x.type = 'triangle'
    x.frequency.value = f
    x.connect(n.holdG)
    x.start()
    return x
  })
  return n
}

// 종소리 하나: 기본음 + 조금 어긋난 배음, 짧게 치고 길게 사라진다
function bell(n, f, { gain = 0.12, dur = 3.2, at = 0, wet = 1 } = {}) {
  const { c } = n
  const t = c.currentTime + at
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  const w = c.createGain()
  w.gain.value = wet
  g.connect(n.dry)
  g.connect(w).connect(n.send)
  for (const [mul, a] of [
    [1, 1],
    [2.76, 0.18],
    [5.4, 0.06],
  ]) {
    const x = c.createOscillator()
    const xg = c.createGain()
    x.type = 'sine'
    x.frequency.value = f * mul
    xg.gain.value = a
    x.connect(xg).connect(g)
    x.start(t)
    x.stop(t + dur + 0.05)
  }
}

function start() {
  if (s) return
  s = build()
}

function stop(sec = 1.6) {
  if (!s) return
  const n = s
  s = null
  const t = n.c.currentTime
  n.main.gain.cancelScheduledValues(t)
  n.main.gain.setValueAtTime(n.main.gain.value, t)
  n.main.gain.linearRampToValueAtTime(0, t + sec)
  setTimeout(
    () => {
      n.wind.stop()
      n.hold.forEach((x) => x.stop())
      n.main.disconnect()
    },
    sec * 1000 + 100,
  )
}

// 같은 소리가 너무 촘촘히 터지지 않게
const last = {}
const gate = (k, ms) => {
  const t = performance.now()
  if (t - (last[k] || 0) < ms) return false
  last[k] = t
  return true
}

const ramp = (p, v, tc = 0.15) => s && p.setTargetAtTime(v, s.c.currentTime, tc)

export const sky = {
  // 별자리가 열리면 켜고 닫히면 끈다. 소리를 끄면 같이 멈추고, 다시 켜면 다시 시작
  on() {
    want = true
    unsub ||= onMuted((m) => (m ? stop(0.4) : want && start()))
    bgmAlias.building = 'sky'
    replayBgm()
    start()
  },
  off() {
    want = false
    unsub?.()
    unsub = null
    delete bgmAlias.building
    replayBgm()
    stop()
  },
  // 별에 닿음. y 는 0(위)~1(아래): 위쪽 별일수록 높은 음. 이름 아는 간판은 조금 더 또렷하게
  touch(y, named) {
    if (!s || !gate('touch', named ? 60 : 90)) return
    const i = Math.round((1 - Math.max(0, Math.min(1, y))) * 11) + 5
    bell(s, note(i), { gain: named ? 0.09 : 0.045, dur: named ? 2.6 : 1.6, wet: 0.8 })
  },
  // 눌러서 고름: 아래에서 위로 굴러 올라가는 세 음
  chime(y = 0.5) {
    if (!s || !gate('chime', 150)) return
    const i = Math.round((1 - y) * 6) + 7
    ;[0, 2, 4].forEach((k, j) => bell(s, note(i + k), { gain: 0.1 - j * 0.02, dur: 3.6, at: j * 0.09 }))
  },
  // 보기(동네·업종·글자 자리)를 바꿈: 낮게 한 번 부풀고 다음 화음으로
  swell() {
    if (!s || !gate('swell', 400)) return
    bell(s, note(0), { gain: 0.08, dur: 5 })
    bell(s, note(4), { gain: 0.05, dur: 5, at: 0.06 })
  },
  // 매 프레임: 도는 빠르기(0~1), 다가간 정도(0~1), 두 손으로 집었는지
  frame(speed, depth, held) {
    if (!s) return
    ramp(s.windG.gain, Math.min(0.09, speed * 0.12), 0.12)
    ramp(s.windF.frequency, 500 + speed * 1600, 0.2)
    // 다가갈수록 손짓 소리의 잔향이 깊어진다(먼 하늘 속으로 들어가는 느낌)
    ramp(s.wet.gain, 0.55 + depth * 0.5, 0.4)
    ramp(s.dry.gain, 0.6 - depth * 0.25, 0.4)
    ramp(s.holdG.gain, held ? 0.05 : 0, held ? 0.25 : 0.6)
  },
  // 확대·축소 단계가 바뀔 때 한 음씩(올라가면 높게, 물러나면 낮게)
  step(level) {
    if (!s || !gate('step', 70)) return
    bell(s, note(5 + Math.max(0, Math.min(12, level))), { gain: 0.035, dur: 1.4, wet: 1 })
  },
}
