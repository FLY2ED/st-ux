let ctx

function beep(freq, dur = 0.08, type = 'square', when = 0) {
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

export const sfx = {
  click: () => beep(880, 0.04),
  open: () => { beep(660, 0.05); beep(990, 0.07, 'square', 0.05) },
  bell: () => { beep(1568, 0.12, 'triangle'); beep(2093, 0.18, 'triangle', 0.09) },
  right: () => { beep(784, 0.07); beep(1047, 0.07, 'square', 0.07); beep(1319, 0.12, 'square', 0.14) },
  wrong: () => { beep(220, 0.15, 'sawtooth'); beep(165, 0.25, 'sawtooth', 0.12) },
  tick: () => beep(1200, 0.02, 'triangle'),
  build: (i) => beep(330 + i * 60, 0.05, 'square'),
}
