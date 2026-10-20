import * as THREE from 'three'
import { pastelOf } from '../shops.js'
import { B, DIRS } from './build.js'

const CELL_W = 128
const CELL_H = 64
const ATLAS = 2048
const PER = (ATLAS / CELL_W) * (ATLAS / CELL_H)
const REACH = 12

function drawSign(ctx, x, y, sign) {
  // 흰 판에 펜 테두리, 업종 색은 위쪽 띠에만 연하게
  ctx.fillStyle = '#fffdf6'
  ctx.fillRect(x, y, CELL_W, CELL_H)
  ctx.fillStyle = pastelOf(sign.cat)
  ctx.fillRect(x + 5, y + 5, CELL_W - 10, 7)
  ctx.strokeStyle = '#1b1b1b'
  ctx.lineWidth = 4
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(x + 4, y + 5)
  ctx.lineTo(x + CELL_W - 5, y + 3)
  ctx.lineTo(x + CELL_W - 3, y + CELL_H - 5)
  ctx.lineTo(x + 5, y + CELL_H - 3)
  ctx.closePath()
  ctx.stroke()
  ctx.fillStyle = '#1b1b1b'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const name = sign.name
  ctx.font = '700 34px Gaegu'
  const w = ctx.measureText(name).width
  const size = Math.floor(Math.min(36, (34 * 110) / w))
  if (size >= 20 || name.length < 6) {
    ctx.font = `700 ${Math.max(14, size)}px Gaegu`
    ctx.fillText(name, x + CELL_W / 2, y + CELL_H / 2 + 3, 114)
  } else {
    const cut = Math.ceil(name.length / 2)
    ctx.font = '700 22px Gaegu'
    ctx.fillText(name.slice(0, cut), x + CELL_W / 2, y + 24, 114)
    ctx.fillText(name.slice(cut), x + CELL_W / 2, y + 46, 114)
  }
}

// 간판마다 실제 층의 가장 가까운 건물 벽을 찾아 붙이고, 벽이 없으면 기둥 간판으로 세운다
export function placeSigns(grid, signs) {
  const { N, half, height } = grid
  const h = (i, k) => (i < 0 || k < 0 || i >= N || k >= N ? 0 : height[k * N + i])
  const used = new Set()
  const poles = new Map()
  const placed = []
  const X = (i) => (i - half) * B
  for (const s of signs) {
    const si = s.x / B + half
    const sk = -s.y / B + half
    const ci = Math.floor(si)
    const ck = Math.floor(sk)
    // 층을 모르면 1층 간판 띠, 지하면 출입구 높이에 작게
    const want = s.floor < 0 ? 0 : (Math.max(1, s.floor) - 1) * 2 + 1
    let best = null
    for (let k = ck - REACH; k <= ck + REACH; k++) {
      for (let i = ci - REACH; i <= ci + REACH; i++) {
        const hh = h(i, k)
        if (!hh) continue
        const level = Math.min(want, hh - 1)
        for (let di = 0; di < 4; di++) {
          const d = DIRS[di]
          if (h(i + d.di, k + d.dk) > level) continue
          const key = `${i},${k},${di},${level}`
          if (used.has(key)) continue
          const fx = i + 0.5 + d.di * 0.5
          const fz = k + 0.5 + d.dk * 0.5
          const dist = Math.hypot(fx - si, fz - sk) + Math.abs(level - want) * 0.6
          if (!best || dist < best.dist) best = { dist, key, i, k, d, level }
        }
      }
    }
    if (best && best.dist <= REACH) {
      used.add(best.key)
      const { i, k, d, level } = best
      const out = 0.04
      const px = X(i + d.p[0]) + d.n[0] * out
      const pz = X(k + d.p[1]) + d.n[2] * out
      const qx = X(i + d.q[0]) + d.n[0] * out
      const qz = X(k + d.q[1]) + d.n[2] * out
      // 1층 간판은 가게 앞 위쪽 어두운 띠에 맞춘다
      const mid = level * B + (level === 0 ? B * 0.55 : level === 1 ? B * 0.72 : B / 2)
      placed.push({ sign: s, faces: [[px, pz, qx, qz]], y: mid, scale: level === 0 && s.floor < 0 ? 0.7 : 1 })
      continue
    }
    // 건물이 없는 곳(지도에 건물이 비어 있는 곳)은 길가 기둥 간판
    if (ci < 0 || ck < 0 || ci >= N || ck >= N || h(ci, ck)) continue
    const stack = poles.get(ck * N + ci) || 0
    if (stack >= 3) continue
    poles.set(ck * N + ci, stack + 1)
    const x = X(ci) + B / 2
    const z = X(ck) + B / 2
    const w = B * 0.47
    placed.push({
      sign: s,
      faces: [[x - w, z, x + w, z], [x + w, z, x - w, z]],
      y: 2.3 + stack * 0.85,
      scale: 1,
      pole: stack === 0 ? [x, z] : null,
    })
  }
  return placed
}

// 간판 그림을 아틀라스에 모아 그리고, 아틀라스마다 메시 하나를 만든다
export function meshSigns(placed) {
  const group = new THREE.Group()
  const meshes = []
  for (let start = 0; start < placed.length; start += PER) {
    const chunk = placed.slice(start, start + PER)
    const canvas = document.createElement('canvas')
    canvas.width = ATLAS
    canvas.height = ATLAS
    const ctx = canvas.getContext('2d')
    const pos = []
    const uv = []
    const idx = []
    const owner = []
    chunk.forEach((p, n) => {
      const cx = (n % (ATLAS / CELL_W)) * CELL_W
      const cy = Math.floor(n / (ATLAS / CELL_W)) * CELL_H
      drawSign(ctx, cx, cy, p.sign)
      const u0 = cx / ATLAS
      const u1 = (cx + CELL_W) / ATLAS
      const v1 = 1 - cy / ATLAS
      const v0 = 1 - (cy + CELL_H) / ATLAS
      const half = (B * 0.47 * p.scale) / 2
      for (const [px, pz, qx, qz] of p.faces) {
        // 벽 칸 가운데에 폭 0.94칸 간판
        const mx = (px + qx) / 2
        const mz = (pz + qz) / 2
        const ex = ((qx - px) / 2) * 0.94 * p.scale
        const ez = ((qz - pz) / 2) * 0.94 * p.scale
        const base = pos.length / 3
        pos.push(mx - ex, p.y - half, mz - ez, mx + ex, p.y - half, mz + ez, mx + ex, p.y + half, mz + ez, mx - ex, p.y + half, mz - ez)
        uv.push(u0, v0, u1, v0, u1, v1, u0, v1)
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
        owner.push(start + n, start + n)
      }
    })
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeBoundingSphere()
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex }))
    mesh.userData.owner = owner
    meshes.push(mesh)
    group.add(mesh)
  }
  // 기둥
  const poles = placed.filter((p) => p.pole)
  if (poles.length) {
    const geo = new THREE.BoxGeometry(0.12, 2.0, 0.12)
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0x6b6f78 }), poles.length)
    const m = new THREE.Matrix4()
    poles.forEach((p, n) => inst.setMatrixAt(n, m.makeTranslation(p.pole[0], 1.0, p.pole[1])))
    group.add(inst)
  }
  return { group, meshes }
}
