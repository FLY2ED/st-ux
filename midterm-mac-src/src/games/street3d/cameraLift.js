// 건물이 나를 가리면 카메라를 살짝 들어 올리고 당겨서 비켜 본다(조금만, 천천히)
export const LIFT_MAX = 0.4

// 들어 올린 만큼(lift) 카메라 자리
export function camAt(cam, lift) {
  const pitch = Math.min(1.4, cam.pitch + lift)
  const dist = cam.dist * (1 - lift * 0.6)
  const cp = Math.cos(pitch) * dist
  return { x: cam.target.x + Math.sin(cam.yaw) * cp, y: cam.target.y + Math.sin(pitch) * dist, z: cam.target.z + Math.cos(cam.yaw) * cp }
}

// 카메라에서 나까지 시선을 건물이 막는지. grid 높이는 칸 B 단위
function hidden(cam, lift, grid, B, cellOf) {
  const c = camAt(cam, lift)
  const y0 = cam.target.y + 1
  const n = Math.ceil(Math.hypot(c.x - cam.target.x, c.z - cam.target.z) / (B * 0.7))
  for (let j = 2; j <= n; j++) {
    const k = j / n
    const [i, kk] = cellOf(cam.target.x + (c.x - cam.target.x) * k, cam.target.z + (c.z - cam.target.z) * k)
    if (i < 0 || kk < 0 || i >= grid.N || kk >= grid.N) continue
    if (grid.height[kk * grid.N + i] * B > y0 + (c.y - y0) * k) return true
  }
  return false
}

// 안 가리는 가장 낮은 들기(못 찾으면 LIFT_MAX)
export function wantLift(cam, grid, B, cellOf) {
  for (let l = 0; l <= LIFT_MAX + 1e-6; l += 0.1) if (!hidden(cam, l, grid, B, cellOf)) return l
  return LIFT_MAX
}

// 올라갈 땐 조금 빠르게, 내려올 땐 느긋하게
export const easeLift = (lift, want, dt) => lift + (want - lift) * Math.min(1, dt * (want > lift ? 2.2 : 0.9))
