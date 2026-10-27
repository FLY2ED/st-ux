import * as THREE from 'three'

// --- 불꽃 가루 -----------------------------------------------------------------
// 점 600개를 돌려 쓰는 고리 버퍼. burst 로 뿌리고 update 로 떨어뜨린다
const SPARKS = 600
const YELLOW = new THREE.Color(0xffe27a)

export function makeSparks(scene) {
  const vel = new Float32Array(SPARKS * 3)
  const life = new Float32Array(SPARKS)
  let next = 0
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3).fill(-999), 3))
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3))
  const points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
  points.frustumCulled = false
  scene.add(points)
  const pos = g.attributes.position
  const col = g.attributes.color

  function burst(x, y, z, nx, nz, color, n = 70) {
    for (let i = 0; i < n; i++) {
      const s = next++ % SPARKS
      pos.setXYZ(s, x, y, z)
      const c = Math.random() < 0.35 ? YELLOW : color
      col.setXYZ(s, c.r * 1.6, c.g * 1.6, c.b * 1.6)
      const sp = 2 + Math.random() * 4
      vel[s * 3] = nx * sp + (Math.random() - 0.5) * 4
      vel[s * 3 + 1] = Math.random() * 5 + 1
      vel[s * 3 + 2] = nz * sp + (Math.random() - 0.5) * 4
      life[s] = 0.8 + Math.random() * 0.7
    }
    col.needsUpdate = true
  }

  function update(dt) {
    let any = false
    for (let s = 0; s < SPARKS; s++) {
      if (life[s] <= 0) continue
      any = true
      life[s] -= dt
      if (life[s] <= 0) {
        pos.setXYZ(s, 0, -999, 0)
        continue
      }
      vel[s * 3 + 1] -= 9 * dt
      pos.setXYZ(s, pos.getX(s) + vel[s * 3] * dt, Math.max(0.05, pos.getY(s) + vel[s * 3 + 1] * dt), pos.getZ(s) + vel[s * 3 + 2] * dt)
    }
    if (any) pos.needsUpdate = true
  }

  return { burst, update }
}
