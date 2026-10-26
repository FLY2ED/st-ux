import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { drawAvatar } from '../../avatar.js'

// 수리공 스튜디오 무대: 16×24 픽셀 인형을 앞·뒤·옆 그림으로 깎아 낸 복셀 인형으로 세운다
const W = 16
const H = 24
const MAX = W * H * W
const OUTLINE = [0x1b, 0x16, 0x22]

// 한 방향 그림을 픽셀 배열로. 바깥 테두리(빈칸에 붙은 검은 픽셀)는 지워 복셀이 덩어리로 보이게 한다
function grab(look, dir) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d', { willReadFrequently: true })
  drawAvatar(ctx, look, W / 2, H, { scale: 1, dir, shadow: false })
  const d = ctx.getImageData(0, 0, W, H).data
  const px = new Array(W * H).fill(null)
  for (let i = 0; i < W * H; i++) if (d[i * 4 + 3] > 128) px[i] = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]
  const dark = (p) => p && p[0] === OUTLINE[0] && p[1] === OUTLINE[1] && p[2] === OUTLINE[2]
  const empty = (x, y) => x < 0 || y < 0 || x >= W || y >= H || !px[y * W + x]
  const drop = []
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (dark(px[y * W + x]) && (empty(x - 1, y) || empty(x + 1, y) || empty(x, y - 1) || empty(x, y + 1))) drop.push(y * W + x)
  for (const i of drop) px[i] = null
  // 눈·안경 줄(7~9)만 남기고 안쪽 검은 이음새도 비워 팔·다리가 떨어져 보이게
  for (let y = 0; y < H; y++) if (y < 7 || y > 9) for (let x = 0; x < W; x++) if (dark(px[y * W + x])) px[y * W + x] = null
  return px
}

// 앞(+z)·뒤·왼쪽에서 본 옆(dir 3)·오른쪽에서 본 옆(dir 2) 네 장으로 부피를 만들고, 겉에 드러난 칸만 남긴다
export function buildVoxels(look) {
  const front = grab(look, 0)
  const back = grab(look, 1)
  const sideL = grab(look, 3)
  const sideR = grab(look, 2)
  const F = (x, y) => front[y * W + x]
  const S0 = (z, y) => sideL[y * W + z]
  // 옆모습의 코·입처럼 한 줄만 튀어나온 곳은 얼굴 전체가 앞으로 나오므로 위아래 줄에 맞춰 깎는다
  const zTop = []
  for (let y = 0; y < H; y++) {
    let m = -1
    for (let z = 0; z < W; z++) if (S0(z, y)) m = z
    zTop.push(m)
  }
  const S = (z, y) => {
    if (y >= 6 && y <= 11 && zTop[y - 1] >= 0 && zTop[y + 1] >= 0 && z > Math.max(zTop[y - 1], zTop[y + 1])) return null
    return S0(z, y)
  }
  const solid = new Uint8Array(MAX)
  const at = (x, y, z) => (y * W + z) * W + x
  for (let y = 0; y < H; y++)
    for (let z = 0; z < W; z++) {
      if (!S(z, y)) continue
      for (let x = 0; x < W; x++) if (F(x, y)) solid[at(x, y, z)] = 1
    }
  const has = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < W && y < H && z < W && solid[at(x, y, z)]
  const out = []
  let zMinAll = W
  let zMaxAll = 0
  for (let y = 0; y < H; y++)
    for (let z = 0; z < W; z++)
      for (let x = 0; x < W; x++) {
        if (!has(x, y, z)) continue
        if (has(x - 1, y, z) && has(x + 1, y, z) && has(x, y - 1, z) && has(x, y + 1, z) && has(x, y, z - 1) && has(x, y, z + 1)) continue
        // 가장 가까운 겉면의 그림에서 색을 가져온다
        let zf = z
        while (has(x, y, zf + 1)) zf++
        let zb = z
        while (has(x, y, zb - 1)) zb--
        let xl = x
        while (has(xl - 1, y, z)) xl--
        let xr = x
        while (has(xr + 1, y, z)) xr++
        const cand = [
          [zf - z, F(x, y)],
          [x - xl, S(z, y)],
          [xr - x, sideR[y * W + (W - 1 - z)]],
          [z - zb, back[y * W + (W - 1 - x)]],
        ]
        let best = null
        let bd = 99
        for (const [d, c] of cand) if (c && d < bd) (bd = d), (best = c)
        if (!best) best = F(x, y) || S(z, y)
        out.push(x, y, z, best[0], best[1], best[2])
        zMinAll = Math.min(zMinAll, z)
        zMaxAll = Math.max(zMaxAll, z)
      }
  return { cells: out, zc: (zMinAll + zMaxAll + 1) / 2 }
}

function contactTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, 'rgba(0,0,0,0.7)')
  r.addColorStop(0.45, 'rgba(0,0,0,0.3)')
  r.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// 조명 웅덩이: 인트로의 픽셀 느낌대로 부드러운 원 대신 계단진 동심원
function poolTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const bands = [
    [64, 'rgba(255,207,58,0.05)'],
    [50, 'rgba(255,214,120,0.10)'],
    [36, 'rgba(255,224,160,0.16)'],
    [22, 'rgba(255,236,200,0.22)'],
  ]
  for (const [r, f] of bands) {
    g.fillStyle = f
    g.beginPath()
    g.arc(64, 64, r, 0, Math.PI * 2)
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

// 캔버스에 무대를 세운다. WebGL 이 안 되면 null
export function createVoxelStage(canvas) {
  let renderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false })
  } catch {
    return null
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environment = env
  scene.environmentIntensity = 0.55

  const camera = new THREE.PerspectiveCamera(26, 1, 1, 400)

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c6, 1.1))
  const key = new THREE.DirectionalLight(0xfff4e6, 2.1)
  key.position.set(-8, 42, 16)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.radius = 5
  key.shadow.bias = -0.0008
  key.shadow.normalBias = 0.04
  const sc = key.shadow.camera
  sc.left = sc.bottom = -18
  sc.right = sc.top = 18
  sc.near = 1
  sc.far = 90
  scene.add(key)
  // 검은 무대라 뒤쪽 노란 테두리 빛으로 윤곽을 띄운다
  const rim = new THREE.DirectionalLight(0xffd27a, 1.6)
  rim.position.set(18, 14, -16)
  scene.add(rim)

  // 바닥: 위에서 떨어지는 조명 웅덩이 + 그 위에 그림자만 받는 판 + 발밑 접촉 그림자
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 34),
    new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, depthWrite: false }),
  )
  pool.rotation.x = -Math.PI / 2
  pool.position.y = -0.01
  scene.add(pool)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.35 }))
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(17, 11),
    new THREE.MeshBasicMaterial({ map: contactTexture(), transparent: true, depthWrite: false }),
  )
  blob.rotation.x = -Math.PI / 2
  blob.position.y = 0.02
  scene.add(blob)

  const pivot = new THREE.Group()
  scene.add(pivot)
  const geo = new RoundedBoxGeometry(0.94, 0.94, 0.94, 2, 0.14)
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 })
  const mesh = new THREE.InstancedMesh(geo, mat, MAX)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.count = 0
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.setColorAt(0, new THREE.Color())
  pivot.add(mesh)

  const m4 = new THREE.Matrix4()
  const col = new THREE.Color()
  function setLook(look) {
    const { cells, zc } = buildVoxels(look)
    const n = cells.length / 6
    for (let i = 0; i < n; i++) {
      const [x, y, z, r, g, b] = cells.slice(i * 6, i * 6 + 6)
      m4.makeTranslation(x - (W - 1) / 2, H - 1 - y + 0.5, z + 0.5 - zc)
      mesh.setMatrixAt(i, m4)
      col.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace)
      mesh.setColorAt(i, col)
    }
    mesh.count = n
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }

  // 보는 각도: yaw 는 인형을 돌리고, pitch·zoom 은 카메라를 옮긴다
  const view = { yaw: -0.5, pitch: 0.28, zoom: 1, targetYaw: null, targetPitch: 0.28, spin: true, dragging: false }
  let w = 0
  let h = 0
  function resize() {
    const r = canvas.parentElement?.getBoundingClientRect() || canvas.getBoundingClientRect()
    if (!r.width || !r.height || (r.width === w && r.height === h)) return
    w = r.width
    h = r.height
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(canvas.parentElement || canvas)
  resize()

  let raf = 0
  let last = performance.now()
  const t0 = last
  function frame(now) {
    raf = requestAnimationFrame(frame)
    if (document.hidden) return
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    if (view.targetYaw != null) {
      // 가장 가까운 쪽으로 돌아간다
      let d = view.targetYaw - view.yaw
      d = Math.atan2(Math.sin(d), Math.cos(d))
      view.yaw += d * Math.min(1, dt * 7)
      if (Math.abs(d) < 0.002) view.targetYaw = null
    } else if (view.spin && !view.dragging) view.yaw += dt * 0.45
    view.pitch += (view.targetPitch - view.pitch) * Math.min(1, dt * 6)
    const t = (now - t0) / 1000
    pivot.rotation.y = view.yaw
    pivot.position.y = Math.sin(t * 2.2) * 0.35 + 0.35
    blob.scale.setScalar(1 - (pivot.position.y / 0.7) * 0.08)
    const dist = 78 / view.zoom
    // 가로로 좁은 화면에서는 키를 맞추려고 조금 더 물러난다
    const fit = Math.max(1, 0.9 / Math.max(0.3, camera.aspect))
    const R = dist * fit
    const ty = 11.5
    camera.position.set(0, ty + Math.sin(view.pitch) * R, Math.cos(view.pitch) * R)
    camera.lookAt(0, ty - 0.5, 0)
    renderer.render(scene, camera)
  }
  raf = requestAnimationFrame(frame)

  // 끌어서 돌리기
  let px = 0
  let py = 0
  const down = (e) => {
    view.dragging = true
    view.targetYaw = null
    px = e.clientX
    py = e.clientY
    canvas.setPointerCapture?.(e.pointerId)
  }
  const move = (e) => {
    if (!view.dragging) return
    view.yaw += (e.clientX - px) * 0.012
    view.targetPitch = Math.max(-0.1, Math.min(0.9, view.targetPitch + (e.clientY - py) * 0.006))
    px = e.clientX
    py = e.clientY
  }
  const up = () => (view.dragging = false)
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  canvas.addEventListener('pointercancel', up)

  return {
    setLook,
    setSpin(on) {
      view.spin = on
    },
    setZoom(z) {
      view.zoom = z
    },
    face(yaw, pitch) {
      view.targetYaw = yaw
      view.targetPitch = pitch
    },
    dispose() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      geo.dispose()
      mat.dispose()
      env.dispose()
      pmrem.dispose()
      blob.material.map.dispose()
      pool.material.map.dispose()
      renderer.dispose()
    },
  }
}
