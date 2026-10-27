// 느린 컴퓨터: 2초씩 재서 프레임이 무거우면 그리는 해상도를 한 단계씩 낮춘다(모양은 그대로)
const QUALITY = [2, 1.5, 1, 0.8, 0.66]

// apply(pr): 새 화면 배율을 렌더러에 건다
export function makeTuner(apply) {
  let quality = 0
  const perf = { ms: 0, n: 0, wait: 3 }
  const ratio = () => Math.min(devicePixelRatio || 1, QUALITY[quality])
  function tune(ms, dt) {
    if (perf.wait > 0) return void (perf.wait -= dt)
    if (ms > 250) return
    perf.ms += ms
    perf.n++
    if (perf.ms < 2000) return
    const avg = perf.ms / perf.n
    perf.ms = 0
    perf.n = 0
    const cur = ratio()
    if (avg > 24 && quality < QUALITY.length - 1) {
      // 화면 배율이 원래 낮으면 실제로 줄어드는 단계까지 건너뛴다
      while (quality < QUALITY.length - 1 && QUALITY[quality] >= cur) quality++
      if (QUALITY[quality] < cur) apply(ratio())
      perf.wait = 1
    }
  }
  return { tune, ratio }
}
