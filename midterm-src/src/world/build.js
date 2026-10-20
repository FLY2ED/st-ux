import * as THREE from 'three'
import { GROUND_ID, LOOK_WALLS } from './textures.js'

// 블록 한 칸 1.6m, 한 층 3.2m = 두 칸
export const B = 1.6
const FLOOR = 2
const MAX_H = 120

// 지도 반경을 칸 격자로 깔고 땅 종류·건물 높이를 채운다
export function rasterize(world) {
  const N = Math.ceil((world.r * 2) / B) + 8
  const half = N / 2
  const height = new Uint8Array(N * N)
  const wall = new Uint8Array(N * N)
  const ground = new Uint8Array(N * N)
  // 칸마다 그 자리를 차지한 건물 번호 + 1
  const owner = new Int32Array(N * N)
  // 미터 좌표(동, 북) → 칸 좌표
  const cx = (x) => x / B + half
  const cz = (y) => -y / B + half

  function fillPoly(flat, fn) {
    const n = flat.length / 2
    if (n < 3) return
    const xs = []
    const zs = []
    for (let i = 0; i < n; i++) {
      xs.push(cx(flat[i * 2]))
      zs.push(cz(flat[i * 2 + 1]))
    }
    const k0 = Math.max(0, Math.floor(Math.min(...zs)))
    const k1 = Math.min(N - 1, Math.ceil(Math.max(...zs)))
    for (let k = k0; k <= k1; k++) {
      const z = k + 0.5
      const hits = []
      for (let i = 0, j = n - 1; i < n; j = i++) {
        if (zs[i] > z !== zs[j] > z) hits.push(xs[i] + ((z - zs[i]) / (zs[j] - zs[i])) * (xs[j] - xs[i]))
      }
      hits.sort((a, b) => a - b)
      for (let h = 0; h + 1 < hits.length; h += 2) {
        const i0 = Math.max(0, Math.ceil(hits[h] - 0.5))
        const i1 = Math.min(N - 1, Math.floor(hits[h + 1] - 0.5))
        for (let i = i0; i <= i1; i++) fn(k * N + i)
      }
    }
  }

  function stroke(flat, width, fn) {
    const r = width / 2 / B
    for (let p = 0; p + 3 < flat.length; p += 2) {
      const ax = cx(flat[p])
      const az = cz(flat[p + 1])
      const bx = cx(flat[p + 2])
      const bz = cz(flat[p + 3])
      const dx = bx - ax
      const dz = bz - az
      const len2 = dx * dx + dz * dz || 1
      const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - r))
      const i1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx) + r))
      const k0 = Math.max(0, Math.floor(Math.min(az, bz) - r))
      const k1 = Math.min(N - 1, Math.ceil(Math.max(az, bz) + r))
      for (let k = k0; k <= k1; k++) {
        for (let i = i0; i <= i1; i++) {
          const px = i + 0.5 - ax
          const pz = k + 0.5 - az
          const t = Math.max(0, Math.min(1, (px * dx + pz * dz) / len2))
          if (Math.hypot(px - t * dx, pz - t * dz) <= Math.max(r, 0.5)) fn(k * N + i)
        }
      }
    }
  }

  for (const [kind, flat] of world.a) fillPoly(flat, (c) => (ground[c] = GROUND_ID[kind]))
  // 넓은 길을 나중에, 횡단보도는 맨 나중에 그려 위에 오게 한다. 고가는 땅에 그리지 않는다
  const order = { path: 0, rail: 1, water: 1, road: 2, cross: 3 }
  const ways = world.w.filter((w) => w[0] in order).sort((a, b) => order[a[0]] - order[b[0]] || a[1] - b[1])
  for (const [kind, width, flat] of ways) {
    const id = GROUND_ID[kind]
    stroke(flat, width, (c) => {
      if (kind === 'path' && ground[c] === GROUND_ID.road) return
      ground[c] = id
    })
  }
  world.b.forEach(([h, name, flat, kind = 'other'], idx) => {
    const blocks = Math.min(MAX_H, Math.max(2, Math.round(h / B)))
    let hash = idx
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
    // 아주 높은 건물은 아파트가 아니면 유리 외벽
    const choice = LOOK_WALLS[kind === 'apt' || h < 45 ? kind : 'office'] || LOOK_WALLS.other
    const look = choice[hash % choice.length]
    fillPoly(flat, (c) => {
      if (blocks >= height[c]) {
        height[c] = blocks
        wall[c] = look
        owner[c] = idx + 1
      }
    })
  })
  return { N, half, height, wall, ground, owner }
}

// 면 묶음: 재질마다 꼭짓점을 모아 한 덩어리로 그린다
class Bucket {
  constructor() {
    this.pos = []
    this.nor = []
    this.uv = []
    this.idx = []
  }
  quad(a, b, c, d, n, [u0, v0, u1, v1]) {
    const base = this.pos.length / 3
    this.pos.push(...a, ...b, ...c, ...d)
    for (let i = 0; i < 4; i++) this.nor.push(...n)
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1)
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  mesh(material) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setIndex(this.idx)
    g.computeBoundingSphere()
    return new THREE.Mesh(g, material)
  }
}

// 바깥에서 볼 때 왼쪽 아래 → 오른쪽 아래로 가는 모서리 (칸 i,k 기준). 법선과 함께
export const DIRS = [
  { di: 1, dk: 0, n: [1, 0, 0], p: [1, 1], q: [1, 0] },
  { di: -1, dk: 0, n: [-1, 0, 0], p: [0, 0], q: [0, 1] },
  { di: 0, dk: 1, n: [0, 0, 1], p: [0, 1], q: [1, 1] },
  { di: 0, dk: -1, n: [0, 0, -1], p: [1, 0], q: [0, 0] },
]

export function meshWorld(grid, mats) {
  const { N, half, height, wall, ground } = grid
  const X = (i) => (i - half) * B
  const groundB = mats.groundMats.map(() => new Bucket())
  const wallB = mats.wallMats.map(() => new Bucket())
  const shopB = new Bucket()
  const roofB = new Bucket()
  const h = (i, k) => (i < 0 || k < 0 || i >= N || k >= N ? 0 : height[k * N + i])

  // 윗면은 같은 줄에서 같은 높이·같은 바닥끼리 이어 붙인다
  for (let k = 0; k < N; k++) {
    let i = 0
    while (i < N) {
      const c = k * N + i
      const hh = height[c]
      const g = ground[c]
      let j = i + 1
      while (j < N && height[k * N + j] === hh && (hh ? true : ground[k * N + j] === g)) j++
      const y = hh * B
      const b = hh ? roofB : groundB[g]
      b.quad([X(i), y, X(k + 1)], [X(j), y, X(k + 1)], [X(j), y, X(k)], [X(i), y, X(k)], [0, 1, 0], [i, -k - 1, j, -k])
      i = j
    }
  }

  // 옆면: 이웃보다 높은 칸의 모서리마다 세운다. 1층은 가게 앞 무늬
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < N; i++) {
      const c = k * N + i
      const hh = height[c]
      if (!hh) continue
      for (const d of DIRS) {
        const nh = h(i + d.di, k + d.dk)
        if (nh >= hh) continue
        const px = X(i + d.p[0])
        const pz = X(k + d.p[1])
        const qx = X(i + d.q[0])
        const qz = X(k + d.q[1])
        const along = d.dk ? i : k
        const face = (bucket, y0, y1, uv) =>
          bucket.quad([px, y0 * B, pz], [qx, y0 * B, qz], [qx, y1 * B, qz], [px, y1 * B, pz], d.n, uv)
        let from = nh
        if (nh < FLOOR && hh > FLOOR) {
          face(shopB, nh, FLOOR, [0, nh / FLOOR, 1, 1])
          from = FLOOR
        }
        face(wallB[wall[c]], from, hh, [along / 4, from / 4, (along + 1) / 4, hh / 4])
      }
    }
  }

  const group = new THREE.Group()
  groundB.forEach((b, i) => b.pos.length && group.add(b.mesh(mats.groundMats[i])))
  wallB.forEach((b, i) => b.pos.length && group.add(b.mesh(mats.wallMats[i])))
  if (shopB.pos.length) group.add(shopB.mesh(mats.shopMat))
  if (roofB.pos.length) group.add(roofB.mesh(mats.roofMat))
  // 지도 밖은 끝없는 보도블록 바닥
  const far = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), mats.groundMats[0].clone())
  far.material.map = far.material.map.clone()
  far.material.map.repeat.set(4000 / B, 4000 / B)
  far.rotation.x = -Math.PI / 2
  far.position.y = -0.4
  group.add(far)
  return group
}

// 공원·캠퍼스 잔디에 마크식 나무를 심는다. 나무 블록은 밟을 수 있게 따로 돌려준다
export function plantTrees(grid, rand) {
  const { N, height, ground } = grid
  const trees = []
  const grassy = (c) => ground[c] === GROUND_ID.park || ground[c] === GROUND_ID.campus
  for (let k = 3; k < N - 3; k++) {
    for (let i = 3; i < N - 3; i++) {
      const c = k * N + i
      if (height[c] || !grassy(c) || rand() > 0.012) continue
      let clear = true
      for (let dk = -2; dk <= 2 && clear; dk++) for (let di = -2; di <= 2; di++) if (height[c + dk * N + di] || !grassy(c + dk * N + di)) clear = false
      if (clear && !trees.some(([ti, tk]) => Math.abs(ti - i) < 4 && Math.abs(tk - k) < 4)) trees.push([i, k])
    }
  }
  const trunk = []
  const leaf = []
  for (const [i, k] of trees) {
    const tall = 3 + ((i * 7 + k) % 2)
    for (let y = 0; y < tall; y++) trunk.push([i, y, k])
    for (const y of [tall - 1, tall]) for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) if (di || dk || y === tall) leaf.push([i + di, y, k + dk])
    for (const [di, dk] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) leaf.push([i + di, tall + 1, k + dk])
  }
  return { trunk, leaf }
}
