import * as THREE from 'three'

// 마크처럼 16px 픽셀 무늬를 캔버스로 그린다. 같은 씨앗이면 늘 같은 무늬가 나온다
function rng(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

const hex = (c) => [Number.parseInt(c.slice(1, 3), 16), Number.parseInt(c.slice(3, 5), 16), Number.parseInt(c.slice(5, 7), 16)]

function canvasOf(w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  return c
}

function texOf(canvas, repeat = true) {
  const t = new THREE.CanvasTexture(canvas)
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestMipmapNearestFilter
  t.colorSpace = THREE.SRGBColorSpace
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

// 바탕색에 점점이 밝기를 흔든다
function noise(ctx, w, h, base, amount, seed) {
  const r = rng(seed)
  const [R, G, B] = hex(base)
  const img = ctx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const k = 1 + (r() - 0.5) * amount
    img.data[i * 4] = Math.min(255, R * k)
    img.data[i * 4 + 1] = Math.min(255, G * k)
    img.data[i * 4 + 2] = Math.min(255, B * k)
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

function rect(ctx, color, x, y, w, h) {
  ctx.fillStyle = color
  ctx.fillRect(x, y, w, h)
}

const ground = {
  pave: (ctx) => {
    noise(ctx, 16, 16, '#b9b4a8', 0.12, 11)
    rect(ctx, '#9d988c', 0, 15, 16, 1)
    rect(ctx, '#9d988c', 15, 0, 1, 16)
  },
  road: (ctx) => noise(ctx, 16, 16, '#4a4a52', 0.22, 12),
  path: (ctx) => {
    noise(ctx, 16, 16, '#c98d7a', 0.14, 13)
    for (const y of [3, 7, 11, 15]) rect(ctx, '#a8705f', 0, y, 16, 1)
    for (const [y, x] of [[0, 7], [4, 3], [4, 11], [8, 7], [12, 3], [12, 11]]) rect(ctx, '#a8705f', x, y, 1, 3)
  },
  grass: (ctx) => {
    noise(ctx, 16, 16, '#6fae4f', 0.25, 14)
    const r = rng(41)
    for (let i = 0; i < 14; i++) rect(ctx, '#5a9440', (r() * 16) | 0, (r() * 16) | 0, 1, 1)
  },
  water: (ctx) => {
    noise(ctx, 16, 16, '#3f76c9', 0.12, 15)
    rect(ctx, '#6f9fe6', 2, 4, 5, 1)
    rect(ctx, '#6f9fe6', 9, 11, 5, 1)
  },
  pitch: (ctx) => {
    noise(ctx, 16, 16, '#5fa05a', 0.1, 16)
    rect(ctx, '#e8efe0', 0, 0, 16, 1)
  },
  parking: (ctx) => {
    noise(ctx, 16, 16, '#6a6a70', 0.18, 17)
    rect(ctx, '#e6e2d0', 0, 0, 1, 16)
  },
  rail: (ctx) => {
    noise(ctx, 16, 16, '#8a8178', 0.3, 18)
    rect(ctx, '#6b4a2f', 0, 2, 16, 2)
    rect(ctx, '#6b4a2f', 0, 10, 16, 2)
    rect(ctx, '#c8c8d0', 4, 0, 1, 16)
    rect(ctx, '#c8c8d0', 11, 0, 1, 16)
  },
  // 횡단보도: 도로 위 흰 줄. 길 방향을 몰라서 칸마다 줄무늬 반 칸씩
  cross: (ctx) => {
    noise(ctx, 16, 16, '#4a4a52', 0.22, 20)
    rect(ctx, '#ecebe4', 0, 1, 16, 6)
    rect(ctx, '#ecebe4', 0, 9, 16, 6)
  },
  roof: (ctx) => {
    noise(ctx, 16, 16, '#8e9196', 0.12, 19)
    rect(ctx, '#7a7d82', 0, 0, 16, 1)
    rect(ctx, '#7a7d82', 0, 0, 1, 16)
  },
}

// 바닥 블록 무늬. 순서가 곧 칸의 바닥 번호다
export const GROUND = ['pave', 'road', 'path', 'grass', 'water', 'pitch', 'parking', 'rail', 'grass', 'cross']
export const GROUND_ID = { pave: 0, road: 1, path: 2, grass: 3, park: 3, water: 4, pitch: 5, parking: 6, rail: 7, campus: 8, cross: 9 }

// 벽 색 묶음: [벽, 그림자 줄, 창틀]
export const WALLS = [
  ['#d8d2c4', '#bdb6a6', '#5d6470'],
  ['#e9dcc0', '#cdbf9f', '#6b5d4a'],
  ['#b0583f', '#8f4532', '#3d2f2a'],
  ['#eef0ee', '#cfd3d0', '#58707a'],
  ['#9fb7c9', '#7f97aa', '#2f3f52'],
  ['#c9d9c2', '#a9bba2', '#4a5d48'],
]
export const GLASS = WALLS.length
// 벽 번호: 0~5 일반, 6 파란 유리, 7 어두운 유리, 8·9 아파트, 10 학교 벽돌, 11 교회 벽돌
const EXTRA = ['glass', 'dark', 'apt', 'apt', 'school', 'church']
const EXTRA_COLOR = [['#5c7d99', '#4b6a85', '#2b3a4a'], ['#34404d', '#2a343f', '#1b232c'], ['#f1f0ea', '#d6d4cc', '#9aa3ad'], ['#eadfca', '#cfc2a8', '#8c8f8a'], ['#a8573b', '#8a4530', '#f2efe6'], ['#9a4a3a', '#7d3a2d', '#e6dccb']]
export const WALL_COUNT = WALLS.length + EXTRA.length

// 건물 종류마다 고를 수 있는 벽
export const LOOK_WALLS = { apt: [8, 9], house: [1, 2, 5], school: [10], office: [6, 7, 3], retail: [0, 3, 4, 5, 1], church: [11], villa: [1, 0, 3], brick: [2, 11, 2], other: [0, 1, 3, 4, 5] }

// 벽 무늬는 가로 4칸, 세로 두 층(4칸)을 한 장으로 그려 불 켜진 창이 덜 반복돼 보이게 한다
function wallCanvases(i) {
  const style = i < WALLS.length ? 'plain' : EXTRA[i - WALLS.length]
  const [wall, shade, frame] = style === 'plain' ? WALLS[i] : EXTRA_COLOR[i - WALLS.length]
  const glass = style === 'glass' || style === 'dark'
  const r = rng(100 + i)
  const lit = []
  const map = canvasOf(64, 64, (ctx) => {
    noise(ctx, 64, 64, wall, glass ? 0.06 : 0.1, 200 + i)
    for (let fy = 0; fy < 2; fy++) {
      const y = fy * 32
      if (style === 'apt') {
        // 한국 아파트: 층마다 넓은 발코니 창과 난간 줄
        rect(ctx, '#6d8aa3', 2, y + 9, 60, 15)
        for (const x of [2, 18, 32, 48]) rect(ctx, '#9db8cf', x + 2, y + 10, 4, 6)
        for (const x of [16, 31, 47]) rect(ctx, frame, x, y + 9, 1, 15)
        rect(ctx, shade, 0, y + 24, 64, 3)
        rect(ctx, frame, 0, y + 22, 64, 1)
        rect(ctx, shade, 0, y + 31, 64, 1)
        for (const x of [2, 18, 32, 48]) lit.push([x, y + 9, 14, 15, r() < 0.55])
        continue
      }
      rect(ctx, shade, 0, y + 31, 64, 1)
      for (let bx = 0; bx < 4; bx++) {
        const x = bx * 16
        if (glass) {
          rect(ctx, frame, x, y, 1, 32)
          rect(ctx, style === 'dark' ? '#4f6478' : '#8fb0cc', x + 2, y + 3, 12, 26)
          rect(ctx, style === 'dark' ? '#6c8296' : '#b8d2e6', x + 3, y + 4, 3, 8)
          lit.push([x + 2, y + 3, 12, 26, r() < 0.4])
        } else if (style === 'school') {
          // 하얀 창틀의 넓은 교실 창
          rect(ctx, frame, x + 1, y + 7, 14, 18)
          rect(ctx, '#7f9bb3', x + 2, y + 8, 12, 16)
          rect(ctx, frame, x + 7, y + 8, 1, 16)
          rect(ctx, frame, x + 2, y + 15, 12, 1)
          lit.push([x + 2, y + 8, 12, 16, r() < 0.3])
        } else if (style === 'church') {
          // 위가 둥근 좁은 창
          rect(ctx, frame, x + 5, y + 6, 6, 20)
          rect(ctx, '#c9a35b', x + 6, y + 8, 4, 17)
          rect(ctx, '#c9a35b', x + 7, y + 7, 2, 1)
          lit.push([x + 6, y + 8, 4, 17, r() < 0.6])
        } else {
          rect(ctx, frame, x + 3, y + 8, 10, 16)
          rect(ctx, '#7a95ad', x + 4, y + 9, 8, 14)
          rect(ctx, '#a9c3d9', x + 5, y + 10, 2, 5)
          rect(ctx, frame, x + 4, y + 15, 8, 1)
          lit.push([x + 4, y + 9, 8, 14, r() < 0.45])
        }
      }
    }
  })
  const glow = canvasOf(64, 64, (ctx) => {
    rect(ctx, '#000', 0, 0, 64, 64)
    for (const [x, y, w, h, on] of lit) if (on) rect(ctx, glass ? '#ffe7a8' : '#ffd98a', x, y, w, h)
  })
  return [map, glow]
}

// 1층 가게 앞: 유리문과 진열창
function shopCanvases() {
  const map = canvasOf(16, 32, (ctx) => {
    noise(ctx, 16, 32, '#3b3f48', 0.1, 300)
    rect(ctx, '#9fc4e0', 1, 10, 14, 21)
    rect(ctx, '#c9e0f0', 2, 11, 3, 8)
    rect(ctx, '#3b3f48', 8, 10, 1, 21)
    rect(ctx, '#26282e', 0, 0, 16, 9)
  })
  const glow = canvasOf(16, 32, (ctx) => {
    rect(ctx, '#000', 0, 0, 16, 32)
    rect(ctx, '#fff1c8', 1, 10, 14, 21)
  })
  return [map, glow]
}

export function makeMaterials() {
  const groundMats = GROUND.map((k) => new THREE.MeshLambertMaterial({ map: texOf(canvasOf(16, 16, ground[k === 'grass' ? 'grass' : k])) }))
  const lit = (map, glow) =>
    new THREE.MeshLambertMaterial({ map: texOf(map), emissiveMap: texOf(glow), emissive: 0xffffff, emissiveIntensity: 0 })
  const wallMats = Array.from({ length: WALL_COUNT }, (_, i) => lit(...wallCanvases(i)))
  const shopMat = lit(...shopCanvases())
  const roofMat = new THREE.MeshLambertMaterial({ map: texOf(canvasOf(16, 16, ground.roof)) })
  return { groundMats, wallMats, shopMat, roofMat }
}

// 손으로 놓는 블록 다섯 가지
export const BLOCKS = [
  { id: 'brick', label: '벽돌', draw: (ctx) => { noise(ctx, 16, 16, '#b0583f', 0.12, 501); for (const y of [3, 7, 11, 15]) rect(ctx, '#d9cfc0', 0, y, 16, 1); for (const [y, x] of [[0, 7], [4, 3], [4, 11], [8, 7], [12, 3], [12, 11]]) rect(ctx, '#d9cfc0', x, y, 1, 3) } },
  { id: 'grass', label: '잔디', draw: (ctx) => { noise(ctx, 16, 16, '#7a5a3a', 0.2, 502); noise2(ctx) } },
  { id: 'wood', label: '나무', draw: (ctx) => { noise(ctx, 16, 16, '#b8874f', 0.15, 503); for (const y of [0, 4, 8, 12]) rect(ctx, '#8c6234', 0, y, 16, 1) } },
  { id: 'glass', label: '유리', draw: (ctx) => { rect(ctx, '#cfe8f5', 0, 0, 16, 16); rect(ctx, '#ffffff', 0, 0, 16, 1); rect(ctx, '#ffffff', 0, 0, 1, 16); rect(ctx, '#9cc7de', 15, 0, 1, 16); rect(ctx, '#9cc7de', 0, 15, 16, 1); rect(ctx, '#ffffff', 3, 3, 2, 2) } },
  { id: 'gold', label: '간판석', draw: (ctx) => { noise(ctx, 16, 16, '#ffd84d', 0.15, 505); rect(ctx, '#f6a5c0', 4, 4, 8, 8); rect(ctx, '#1d1d2b', 6, 7, 4, 2) } },
]

function noise2(ctx) {
  const r = rng(77)
  for (let x = 0; x < 16; x++) {
    const h = 4 + ((r() * 3) | 0)
    rect(ctx, x % 3 ? '#6fae4f' : '#5a9440', x, 0, 1, h)
  }
}

export function blockMaterials() {
  return BLOCKS.map((b) => {
    const canvas = canvasOf(16, 16, b.draw)
    return { ...b, icon: canvas.toDataURL(), mat: new THREE.MeshLambertMaterial({ map: texOf(canvas, false), transparent: b.id === 'glass', opacity: b.id === 'glass' ? 0.75 : 1 }) }
  })
}

export function leafMaterials() {
  return {
    trunk: new THREE.MeshLambertMaterial({ map: texOf(canvasOf(16, 16, (ctx) => { noise(ctx, 16, 16, '#6b4a2f', 0.25, 601); for (const x of [3, 9, 13]) rect(ctx, '#553a24', x, 0, 1, 16) }), false) }),
    leaf: new THREE.MeshLambertMaterial({ map: texOf(canvasOf(16, 16, (ctx) => { noise(ctx, 16, 16, '#3f8a3a', 0.45, 602) }), false) }),
  }
}
