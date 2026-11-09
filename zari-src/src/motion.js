export const clamp = v => Math.max(0, Math.min(1, v))
export const ioc = v => (v < .5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2)
export const back = v => 1 + 2.2 * Math.pow(v - 1, 3) + 1.2 * Math.pow(v - 1, 2)

// 인트로 시각(ms): 핀 찍힘 0~420 → 착지 600 → 왼쪽 위로 900~1700 → ZARI 1300~ → 검색창 1650~
export const INTRO = { land: 600, fly: 900, flyEnd: 1700, word: 1300, pill: 1650, end: 2300 }

// ?t=1200 처럼 주면 그 시각에 멈춘다(캡처용). ?skip 이면 인트로를 건너뛴다.
const P = new URLSearchParams(location.search)
export const params = P
export function makeClock() {
  const freeze = P.get('t') != null ? +P.get('t') : P.has('skip') || P.get('view') ? INTRO.end + 100 : null
  const c = { t0: performance.now() }
  c.now = () => (freeze != null ? freeze : performance.now() - c.t0)
  c.replay = () => { if (freeze == null) c.t0 = performance.now() }
  return c
}
