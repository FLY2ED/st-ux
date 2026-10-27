import * as THREE from 'three'
import { drawAvatar } from '../../avatar.js'
import { B } from '../../world/build.js'
import { art } from './people.js'

// 거리에 세우는 그림판·표시·차: 장면 상태 없이 three.js 물체만 만든다

const pixelTex = (canvas) => {
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// 수리공 인형: 방향 4 × 걸음 3 장을 미리 그려 둔다
export function avatarFrames(look) {
  const out = []
  for (let dir = 0; dir < 4; dir++) {
    for (let f = 0; f < 3; f++) {
      const c = document.createElement('canvas')
      c.width = 18
      c.height = 26
      drawAvatar(c.getContext('2d'), look, 9, 25, { scale: 1, dir, frame: f, night: true, shadow: false })
      const tex = pixelTex(c)
      tex.minFilter = THREE.NearestFilter
      out.push(tex)
    }
  }
  return out
}

// 네모 딱지(E·!·💡)
export function tagTexture(text, bg, fg, font = 36) {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const g = c.getContext('2d')
  if (bg) {
    g.fillStyle = '#1b1622'
    g.fillRect(6, 10, 52, 50)
    g.fillStyle = bg
    g.fillRect(6, 4, 52, 50)
  }
  g.fillStyle = fg
  g.font = `700 ${font}px "Galmuri11 Game", Galmuri11, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 32, 31)
  return pixelTex(c)
}

// 이름표: 글자 폭에 맞춘 어두운 띠
export function nameTexture(text) {
  const c = document.createElement('canvas')
  const g = c.getContext('2d')
  const font = '700 22px "Galmuri11 Game", Galmuri11, sans-serif'
  g.font = font
  c.width = Math.ceil(g.measureText(text).width) + 16
  c.height = 32
  g.font = font
  g.fillStyle = 'rgba(27, 22, 34, 0.82)'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#fff3b8'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, c.width / 2, 17)
  return { tex: pixelTex(c), w: c.width / c.height }
}

// --- 이야기 속 사람들(판 그림) ---------------------------------------------------------
// 화면을 보는 판이라 윗부분이 벽에 묻힌다: 깊이 검사를 끄고 가까울 때만 보인다
const texCache = new Map()
function npcTex(name) {
  let e = texCache.get(name)
  if (!e) {
    e = { tex: null, wait: [] }
    const src = art(name)
    if (src) {
      e.tex = new THREE.TextureLoader().load(src, (t) => {
        for (const fn of e.wait) fn(t)
        e.wait = []
      })
      e.tex.magFilter = THREE.NearestFilter
      e.tex.colorSpace = THREE.SRGBColorSpace
    }
    texCache.set(name, e)
  }
  return e
}

export function npcSprite(name, h) {
  const e = npcTex(name)
  if (!e.tex) return null
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: e.tex, fog: false, alphaTest: 0.5, depthTest: false }))
  s.center.set(0.5, 0)
  s.renderOrder = 4
  const fit = (t) => s.scale.set((h * t.image.width) / t.image.height, h, 1)
  s.scale.set(h * 0.7, h, 1)
  if (e.tex.image?.width) fit(e.tex)
  else e.wait.push(fit)
  return s
}

export function disposeNpcTex() {
  for (const e of texCache.values()) e.tex?.dispose()
}

const tagTex = {}
export function tagSprite(kind) {
  tagTex[kind] ||= kind === 'boss' ? tagTexture('!', '#ff4d6d', '#fff') : kind === 'folk' ? tagTexture('💡', '', '#fff', 40) : tagTexture('!', '#ffcf3a', '#1b1622')
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex[kind], depthTest: false, fog: false }))
  s.scale.set(0.62, 0.62, 1)
  s.renderOrder = 6
  return s
}

// 간판 둘레 사각 틀(네온관·고칠 표시 함께 쓴다)
export function frameOf(placed, material, pad = 0.05, thick = 0.06) {
  const g = new THREE.Group()
  const half = (B * 0.47 * placed.scale) / 2 + pad
  for (const [px, pz, qx, qz] of placed.faces) {
    const len = Math.hypot(qx - px, qz - pz)
    const w = (len * 0.94 * placed.scale) / 2 + pad
    const nx = -(qz - pz) / len
    const nz = (qx - px) / len
    const f = new THREE.Group()
    const bar = (cx, cy, sx, sy) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, thick), material)
      m.position.set(cx, cy, 0)
      f.add(m)
    }
    bar(0, half, w * 2 + thick, thick)
    bar(0, -half, w * 2 + thick, thick)
    bar(-w, 0, thick, half * 2)
    bar(w, 0, thick, half * 2)
    f.position.set((px + qx) / 2 + nx * 0.06, placed.y, (pz + qz) / 2 + nz * 0.06)
    f.rotation.y = Math.atan2(qx - px, qz - pz) - Math.PI / 2
    g.add(f)
  }
  return g
}

export function clearGroup(g, own = false) {
  if (!g) return
  g.traverse((o) => {
    o.geometry?.dispose()
    if (own && o.material) o.material.dispose()
  })
  g.clear()
}

// 택시: 주황 상자 차
export function taxiModel() {
  const g = new THREE.Group()
  const part = (sx, sy, sz, color, y, z = 0, basic = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), basic ? new THREE.MeshBasicMaterial({ color, fog: false }) : new THREE.MeshLambertMaterial({ color }))
    m.position.set(0, y, z)
    g.add(m)
    return m
  }
  part(1.9, 0.8, 4.2, 0xf08a1c, 0.7)
  part(1.7, 0.66, 2.1, 0x2a3442, 1.43, -0.2)
  part(0.9, 0.32, 0.42, 0xffec27, 1.92, -0.2, true)
  for (const x of [-0.62, 0.62]) {
    const l = part(0.36, 0.2, 0.08, 0xfff6c0, 0.78, 2.12, true)
    l.position.x = x
  }
  g.visible = false
  return g
}
