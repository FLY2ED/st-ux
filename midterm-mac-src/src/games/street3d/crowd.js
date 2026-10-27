import * as THREE from 'three'
import { avatarFrames, nameTexture } from './sprites.js'

// --- 같은 동네 사람들(그리기) ------------------------------------------------------
// 다른 수리공을 픽셀 인형 판과 이름표로 그린다. 방향은 세계 기준 0 남 · 1 북 · 2 서 · 3 동
const FACE_OF = [[0, 1], [0, -1], [-1, 0], [1, 0]]

export function makeCrowd(scene) {
  const others = new Map()

  function make(p) {
    const tex = avatarFrames(p.look || {})
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex[0], fog: false }))
    sprite.center.set(0.5, 0)
    sprite.scale.set(1.45, 2.1, 1)
    const name = nameTexture(p.name || '수리공')
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: name.tex, fog: false, depthTest: false, transparent: true }))
    tag.center.set(0.5, 0)
    tag.scale.set(0.42 * name.w, 0.42, 1)
    tag.renderOrder = 6
    scene.add(sprite, tag)
    return { sprite, tag, tex, look: JSON.stringify(p.look || {}), name: p.name, step: 0 }
  }

  function drop(o) {
    scene.remove(o.sprite, o.tag)
    for (const t of o.tex) t.dispose()
    o.sprite.material.dispose()
    o.tag.material.map.dispose()
    o.tag.material.dispose()
  }

  // seen: 보여 줄 사람 목록, viewDir: 세계 방향 → 카메라 기준 방향
  function show(seen, dt, viewDir) {
    const keep = new Set()
    for (const p of seen) {
      keep.add(p.id)
      let o = others.get(p.id)
      if (o && (o.look !== JSON.stringify(p.look || {}) || o.name !== p.name)) {
        drop(o)
        o = null
      }
      if (!o) others.set(p.id, (o = make(p)))
      if (p.m) o.step += dt * 6
      const [fx, fz] = FACE_OF[p.d & 3] || FACE_OF[0]
      const f = p.m ? 1 + (Math.floor(o.step) % 2) : 0
      o.sprite.material.map = o.tex[viewDir(fx, fz) * 3 + f]
      const bob = p.m ? Math.abs(Math.sin(o.step * Math.PI)) * 0.06 : 0
      o.sprite.position.set(p.x, bob, -p.y)
      o.tag.position.set(p.x, 2.3, -p.y)
    }
    for (const [id, o] of others) {
      if (keep.has(id)) continue
      drop(o)
      others.delete(id)
    }
  }

  function clear() {
    for (const o of others.values()) drop(o)
    others.clear()
  }

  return { others, show, clear }
}
