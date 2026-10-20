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

function beep(freq, dur = 0.08, type = 'square', when = 0) {
  if (sound.muted) return
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)()
    const t = ctx.currentTime + when
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t)
    gain.gain.setValueAtTime(0.06, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + dur)
  } catch {
    // 소리를 못 내는 환경이면 조용히 넘어간다
  }
}

// 바탕화면이 뜰 때 나는 시작음. 천천히 부풀어 오르는 화음 위로 종소리가 올라간다
function startup() {
  if (sound.muted) return
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)()
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
  click: () => beep(880, 0.04),
  open: () => { beep(660, 0.05); beep(990, 0.07, 'square', 0.05) },
  bell: () => { beep(1568, 0.12, 'triangle'); beep(2093, 0.18, 'triangle', 0.09) },
  right: () => { beep(784, 0.07); beep(1047, 0.07, 'square', 0.07); beep(1319, 0.12, 'square', 0.14) },
  wrong: () => { beep(220, 0.15, 'sawtooth'); beep(165, 0.25, 'sawtooth', 0.12) },
  tick: () => beep(1200, 0.02, 'triangle'),
  build: (i) => beep(330 + i * 60, 0.05, 'square'),
}
