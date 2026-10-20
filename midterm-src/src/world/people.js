import * as THREE from 'three'
import { B } from './build.js'
import { GROUND_ID } from './textures.js'

// 보도 위를 걷는 블록 사람들. 늘 플레이어 둘레에 모여 있게 멀어진 사람은 가까이 다시 세운다
const MAX = 220
const NEAR = 110
const FAR = 150
const SHIRTS = ['#e8e8e8', '#202024', '#3a5f9a', '#9a3a3a', '#d9c49a', '#5c7a4a', '#c86b9a', '#e0a040', '#6a6a72']
const PANTS = ['#2a2f3a', '#1c1c20', '#4a5568', '#7a6a58']
const SKIN = '#f0c8a0'
const HAIR = ['#1a1612', '#2b211a', '#4a3a2a']

// 혼잡도 → 사람 수
export const CROWD = { 여유: 50, 보통: 100, '약간 붐빔': 150, 붐빔: 210 }

export function guessCrowd(date) {
  const h = date.getHours()
  if (h < 6) return '여유'
  if ((h >= 12 && h < 14) || (h >= 18 && h < 22)) return '약간 붐빔'
  if (h >= 8) return '보통'
  return '여유'
}

export function makePeople(grid, rand) {
  const { N, half, height, ground } = grid
  const walkable = (x, y) => {
    const i = Math.floor(x / B + half)
    const k = Math.floor(-y / B + half)
    if (i < 1 || k < 1 || i >= N - 1 || k >= N - 1) return false
    const c = k * N + i
    const g = ground[c]
    return !height[c] && g !== GROUND_ID.road && g !== GROUND_ID.water && g !== GROUND_ID.rail
  }

  const unit = new THREE.BoxGeometry(1, 1, 1)
  const parts = ['shirt', 'pants', 'skin', 'hair']
  const mats = Object.fromEntries(parts.map((p) => [p, new THREE.MeshLambertMaterial({ color: 0xffffff })]))
  const per = { shirt: 1, pants: 2, skin: 3, hair: 1 }
  const meshes = {}
  const group = new THREE.Group()
  for (const p of parts) {
    meshes[p] = new THREE.InstancedMesh(unit, mats[p], MAX * per[p])
    meshes[p].count = 0
    meshes[p].frustumCulled = false
    group.add(meshes[p])
  }
  mats.skin.color.set(SKIN)

  const people = []
  let want = 100
  const pick = (list) => list[(rand() * list.length) | 0]

  // 플레이어에서 from~to 미터 떨어진 걸을 수 있는 자리
  function spot(cx, cy, from, to) {
    for (let t = 0; t < 30; t++) {
      const a = rand() * Math.PI * 2
      const r = from + rand() * (to - from)
      const x = cx + Math.cos(a) * r
      const y = cy + Math.sin(a) * r
      if (walkable(x, y)) return [x, y]
    }
    return null
  }

  function heading(p) {
    p.dir = rand() * Math.PI * 2
    p.turn = 2 + rand() * 6
  }

  function spawn(p, at) {
    p.x = at[0]
    p.y = at[1]
    heading(p)
  }

  function setCrowd(level) {
    want = Math.min(MAX, CROWD[level] || 100)
  }

  // 열차가 들어오면 출구에서 사람들이 한꺼번에 나온다
  function burst(x, y, n = 10) {
    const sorted = [...people].sort((a, b) => b.d - a.d)
    for (const p of sorted.slice(0, n)) {
      p.x = x + (rand() - 0.5) * 2
      p.y = y + (rand() - 0.5) * 2
      heading(p)
    }
  }

  const m = new THREE.Matrix4()
  const mp = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const v = new THREE.Vector3()
  const one = new THREE.Vector3(1, 1, 1)
  const color = new THREE.Color()
  const swing = new THREE.Matrix4()
  const rotZ = new THREE.Matrix4()
  const down = new THREE.Matrix4()

  function put(key, n, x, y, z, sx, sy, sz, rot) {
    mp.makeScale(sx, sy, sz).setPosition(x, y, z)
    if (rot) mp.premultiply(rot)
    meshes[key].setMatrixAt(n, mp.premultiply(m))
  }

  function update(dt, player, time) {
    const cx = player.x
    const cy = -player.z
    while (people.length < want) {
      const at = spot(cx, cy, 4, NEAR)
      if (!at) break
      const p = { speed: 1 + rand() * 0.6, phase: rand() * 6, tall: 0.92 + rand() * 0.16, shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIR), d: 0 }
      spawn(p, at)
      people.push(p)
    }
    if (people.length > want) people.length = want
    const n = { shirt: 0, pants: 0, skin: 0, hair: 0 }
    for (const p of people) {
      p.d = Math.hypot(p.x - cx, p.y - cy)
      if (p.d > FAR) {
        const at = spot(cx, cy, NEAR * 0.7, NEAR)
        if (at) spawn(p, at)
      }
      p.turn -= dt
      if (p.turn <= 0) {
        p.dir += (rand() - 0.5) * 1.6
        p.turn = 2 + rand() * 6
      }
      const nx = p.x + Math.cos(p.dir) * p.speed * dt
      const ny = p.y + Math.sin(p.dir) * p.speed * dt
      // 건물이나 찻길에 닿으면 돌아선다
      if (walkable(nx, ny)) {
        p.x = nx
        p.y = ny
      } else {
        p.dir += Math.PI * (0.5 + rand())
      }
      const step = Math.sin(time * p.speed * 6 + p.phase)
      m.compose(v.set(p.x, 0, -p.y), q.setFromAxisAngle(up, p.dir), one)
      const s = p.tall
      for (const side of [-1, 1]) {
        // 다리는 엉덩이에서 앞뒤로 흔든다
        swing.makeTranslation(0, 0.8 * s, 0).multiply(rotZ.makeRotationZ(step * 0.5 * side)).multiply(down.makeTranslation(0, -0.8 * s, 0))
        put('pants', n.pants++, 0, 0.4 * s, 0.12 * side, 0.22, 0.8 * s, 0.2, swing)
      }
      put('shirt', n.shirt, 0, 1.12 * s, 0, 0.28, 0.66 * s, 0.5)
      meshes.shirt.setColorAt(n.shirt++, color.set(p.shirt))
      meshes.pants.setColorAt(n.pants - 1, color.set(p.pants))
      meshes.pants.setColorAt(n.pants - 2, color)
      put('skin', n.skin++, 0, 1.62 * s, 0, 0.34, 0.34, 0.34)
      for (const side of [-1, 1]) put('skin', n.skin++, -step * 0.12 * side, 1.02 * s, 0.31 * side, 0.12, 0.5 * s, 0.12)
      put('hair', n.hair, -0.02, 1.81 * s, 0, 0.36, 0.08, 0.36)
      meshes.hair.setColorAt(n.hair++, color.set(p.hair))
    }
    for (const key of parts) {
      meshes[key].count = n[key]
      meshes[key].instanceMatrix.needsUpdate = true
      if (meshes[key].instanceColor) meshes[key].instanceColor.needsUpdate = true
    }
  }

  function dispose() {
    unit.dispose()
    for (const x of Object.values(mats)) x.dispose()
    for (const x of Object.values(meshes)) x.dispose()
  }

  return { group, update, setCrowd, burst, dispose, count: () => people.length }
}
