import { react } from './mood.js'

let ctx

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
  try {
    localStorage.setItem('gp-muted', v ? '1' : '0')
  } catch {
    // 저장이 막혀도 이번 방문 동안은 유지된다
  }
}

function audio() {
  ctx ||= new (window.AudioContext || window.webkitAudioContext)()
  return ctx
}

// 마림바처럼 톡 하고 사라지는 소리
function beep(freq, dur = 0.08, type = 'sine', when = 0, vol = 0.08) {
  if (sound.muted) return
  try {
    const c = audio()
    const t = c.currentTime + when
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + dur + 0.02)
  } catch {
    // 소리를 못 내는 환경이면 조용히 넘어간다
  }
}

// 종이 위를 펜이 사각사각 긋는 소리. 띠를 좁힌 잡음을 짧게 여러 번 낸다
function scratch(strokes = 1, when = 0, len = 0.07, freq = 3200) {
  if (sound.muted) return
  try {
    const c = audio()
    const n = Math.floor(c.sampleRate * len)
    const buf = c.createBuffer(1, n, c.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / n)
    for (let k = 0; k < strokes; k++) {
      const t = c.currentTime + when + k * (len + 0.03)
      const src = c.createBufferSource()
      const bp = c.createBiquadFilter()
      const g = c.createGain()
      src.buffer = buf
      bp.type = 'bandpass'
      bp.frequency.value = freq * (0.85 + Math.random() * 0.3)
      bp.Q.value = 1.4
      g.gain.value = 0.16
      src.connect(bp).connect(g).connect(c.destination)
      src.start(t)
    }
  } catch {
    // 소리를 못 내는 환경이면 조용히 넘어간다
  }
}

// 바탕화면이 뜰 때 나는 시작음. 천천히 부풀어 오르는 화음 위로 종소리가 올라간다
function startup() {
  if (sound.muted) return
  try {
    audio()
    const t0 = ctx.currentTime + 0.05
    const out = ctx.createGain()
    out.gain.value = 0.5
    const echo = ctx.createDelay()
    const fb = ctx.createGain()
    echo.delayTime.value = 0.28
    fb.gain.value = 0.35
    out.connect(ctx.destination)
    out.connect(echo).connect(fb).connect(echo)
    echo.connect(ctx.destination)

    const tone = (freq, at, dur, type, peak, attack) => {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.type = type
      osc.frequency.value = freq
      g.gain.setValueAtTime(0.0001, t0 + at)
      g.gain.exponentialRampToValueAtTime(peak, t0 + at + attack)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur)
      osc.connect(g).connect(out)
      osc.start(t0 + at)
      osc.stop(t0 + at + dur + 0.05)
    }
    // 바닥 화음: E♭ 메이저 9
    for (const f of [155.6, 233.1, 311.1, 392, 466.2, 587.3]) tone(f, 0, 4.2, 'sine', 0.05, 1.2)
    for (const f of [155.6, 311.1]) tone(f * 1.003, 0, 4.2, 'triangle', 0.02, 1.4)
    // 위로 올라가는 종소리
    const bells = [622.3, 784, 932.3, 1174.7, 1244.5, 1568]
    bells.forEach((f, i) => {
      tone(f, 0.35 + i * 0.22, 2.2, 'sine', 0.06, 0.01)
      tone(f * 2, 0.35 + i * 0.22, 0.9, 'sine', 0.015, 0.01)
    })
  } catch {
    // 소리를 못 내는 환경이면 조용히 넘어간다
  }
}

export const sfx = {
  startup,
  scratch,
  click: () => scratch(1, 0, 0.045, 3800),
  open: () => { scratch(1, 0, 0.12, 2400); beep(880, 0.12, 'sine', 0.08) },
  // 공책 한 장 넘기는 소리
  flip: () => scratch(1, 0, 0.32, 1400),
  bell: () => { beep(1568, 0.3, 'sine'); beep(2093, 0.4, 'sine', 0.09) },
  right: () => {
    react('proud')
    beep(784, 0.18); beep(1047, 0.18, 'sine', 0.08); beep(1319, 0.3, 'sine', 0.16)
  },
  wrong: () => {
    react('panic')
    beep(330, 0.22, 'triangle', 0, 0.1); beep(247, 0.35, 'triangle', 0.14, 0.1)
  },
  tick: () => beep(1400, 0.05, 'sine', 0, 0.05),
  build: (i) => { scratch(1, 0, 0.05, 2600 + i * 200); beep(523 + i * 60, 0.1, 'sine', 0.02, 0.05) },
  horn: () => { beep(392, 0.28, 'triangle'); beep(494, 0.28, 'triangle') },
  // 형광펜으로 간판을 쓱쓱 칠하는 소리. n 번째 간판일수록 음이 올라간다
  neon: (n = 0) => {
    scratch(3, 0, 0.09, 2000)
    const scale = [523.3, 587.3, 659.3, 784, 880, 1046.5, 1174.7, 1318.5]
    const f = scale[n % scale.length] * (n >= scale.length ? 2 : 1)
    beep(f, 0.3, 'sine', 0.38)
    beep(f * 1.5, 0.36, 'sine', 0.46)
  },
  dawn: startup,
}
