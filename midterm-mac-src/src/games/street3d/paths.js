// --- 걸어서 갈 길 ----------------------------------------------------------------
// map: { N, B, cellOf, cellFree, cellMid } — 칸 크기와 칸 좌표 도우미
// (x, z) 칸에서 걸을 수 있는 칸으로 번져 나가며 몇 칸 걸어야 닿는지 적는다. -1 은 못 가는 칸
export function walkField({ N, cellOf, cellFree }, x, z, maxSteps) {
  const field = new Int16Array(N * N).fill(-1)
  const [si, sk] = cellOf(x, z)
  if (!cellFree(si, sk)) return field
  const queue = new Int32Array(N * N)
  let head = 0
  let tail = 0
  field[sk * N + si] = 0
  queue[tail++] = sk * N + si
  while (head < tail) {
    const c = queue[head++]
    const d = field[c]
    if (d >= maxSteps) continue
    const i = c % N
    const k = (c - i) / N
    for (const [ni, nk] of [[i + 1, k], [i - 1, k], [i, k + 1], [i, k - 1]]) {
      const nc = nk * N + ni
      if (field[nc] !== -1 || !cellFree(ni, nk)) continue
      field[nc] = d + 1
      queue[tail++] = nc
    }
  }
  return field
}

// 그 자리까지 걸어서 몇 미터인지(못 가면 -1)
export function walkMeters({ N, B, cellOf }, field, at) {
  const [i, k] = cellOf(at.x, at.z)
  const steps = field[k * N + i]
  return steps < 0 ? -1 : steps * B
}

// 길 위에서 목표 쪽으로 한 칸 더 가까운 옆 칸 가운데. 모서리는 질러가지 않는다
export function nextCell({ N, cellOf, cellMid }, field, x, z) {
  const [i, k] = cellOf(x, z)
  const here = field[k * N + i]
  if (here <= 0) return null
  let best = null
  for (let dk = -1; dk <= 1; dk++) {
    for (let di = -1; di <= 1; di++) {
      if (!di && !dk) continue
      const d = field[(k + dk) * N + i + di]
      if (d < 0 || d >= here) continue
      if (di && dk && (field[k * N + i + di] < 0 || field[(k + dk) * N + i] < 0)) continue
      if (!best || d < best.d) best = { d, i: i + di, k: k + dk }
    }
  }
  return best && cellMid(best.i, best.k)
}
