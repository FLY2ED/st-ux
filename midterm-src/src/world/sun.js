// 실제 시각과 위도·경도로 해의 높이와 방위를 구한다 (오차 1도 안팎의 간단한 천문 공식)
const rad = Math.PI / 180

export function sunPosition(date, lat, lng) {
  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 864e5
  const g = (357.529 + 0.98560028 * d) * rad
  const q = 280.459 + 0.98564736 * d
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad
  const e = (23.439 - 0.00000036 * d) * rad
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))
  const dec = Math.asin(Math.sin(e) * Math.sin(L))
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24
  const ha = (gmst * 15 + lng) * rad - ra
  const phi = lat * rad
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha))
  // 북쪽에서 동쪽으로 잰 방위각
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha))
  return { alt, az }
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

const NIGHT = [11, 16, 38]
const DUSK = [244, 150, 96]
const DAY = [142, 197, 255]

// 해 높이로 하늘색과 낮 정도(0 밤 ~ 1 낮), 노을 정도를 정한다
export function skyOf(alt) {
  const s = Math.sin(alt)
  const day = smooth(-0.12, 0.2, s)
  const dusk = Math.max(0, 1 - Math.abs(s - 0.02) / 0.16)
  const rgb = mix(mix(NIGHT, DAY, day), DUSK, dusk * 0.55)
  return { day, dusk, rgb: rgb.map((v) => v / 255) }
}

// 낮·밤 고정 보기에서 쓸 오늘의 시각
export function fixedTime(hour) {
  const d = new Date()
  d.setHours(hour, 0, 0, 0)
  return d
}
