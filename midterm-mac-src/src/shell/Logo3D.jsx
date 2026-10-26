import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { SignLogo } from './MenuBar.jsx'

const W = 3.2
const H = 1.7
const DEPTH = 0.22

function roundRect(w, h, r) {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

// 간판 앞면: 보라→분홍 그라데이션 판 위에 흰 네온 글자
function faceTextures() {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = Math.round((1024 * H) / W)
  const g = c.getContext('2d')
  const font = getComputedStyle(document.body).fontFamily
  const grad = g.createLinearGradient(0, 0, c.width, c.height)
  grad.addColorStop(0, '#5e5ce6')
  grad.addColorStop(0.55, '#bf5af2')
  grad.addColorStop(1, '#ff6fa3')
  g.fillStyle = grad
  g.fillRect(0, 0, c.width, c.height)
  const base = new THREE.CanvasTexture(c)

  const e = document.createElement('canvas')
  e.width = c.width
  e.height = c.height
  const h = e.getContext('2d')
  h.fillStyle = '#000'
  h.fillRect(0, 0, e.width, e.height)
  for (const ctx of [g, h]) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `800 ${Math.round(c.height * 0.36)}px ${font}`
    ctx.fillStyle = '#fff'
    ctx.shadowColor = 'rgba(255,255,255,0.9)'
    ctx.shadowBlur = 24
    ctx.fillText('간판 도감', c.width / 2, c.height * 0.53)
  }
  const glow = new THREE.CanvasTexture(e)
  for (const t of [base, glow]) {
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
  }
  return { base, glow }
}

// 네온이 켜질 때 몇 번 깜빡이다 붙는다
function flicker(t) {
  if (t < 0.9) return 0
  const k = t - 0.9
  if (k > 0.75) return 1
  return [0.06, 0.16, 0.24, 0.38, 0.46, 0.75].findIndex((x) => k < x) % 2 === 0 ? 0.15 : 1
}

const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)

export default function Logo3D({ size = 300 }) {
  const box = useRef(null)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    const el = box.current
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setFallback(true)
      return
    }
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.setSize(size, size * 0.8)
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    scene.environment = pmrem.fromScene(room, 0.04).texture
    scene.environmentIntensity = 0.7
    room.dispose()
    pmrem.dispose()

    const camera = new THREE.PerspectiveCamera(32, 1 / 0.8, 0.1, 50)
    camera.position.set(0, -0.1, 8.6)
    camera.lookAt(0, -0.55, 0)

    const key = new THREE.DirectionalLight(0xffffff, 1.2)
    key.position.set(2, 3, 4)
    scene.add(key)
    // 지나가며 표면을 훑는 반사광
    const sweep = new THREE.PointLight(0xffffff, 0, 6, 1.5)
    scene.add(sweep)

    const { base, glow } = faceTextures()
    const disposables = [base, glow]
    const keep = (x) => (disposables.push(x), x)

    const sign = new THREE.Group()
    const pivot = new THREE.Group() // 기둥 위 경첩. 간판은 여기서 흔들린다
    pivot.position.y = 0.1
    scene.add(pivot)
    pivot.add(sign)
    sign.position.y = -0.1

    const body = keep(
      new THREE.ExtrudeGeometry(roundRect(W, H, 0.34), { depth: DEPTH, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 6, curveSegments: 16 }),
    )
    body.translate(0, 0, -DEPTH / 2)
    const sideMat = keep(new THREE.MeshPhysicalMaterial({ color: 0x2c2c3a, metalness: 0.9, roughness: 0.25, iridescence: 0.6, iridescenceIOR: 1.6, clearcoat: 1 }))
    const backMat = keep(new THREE.MeshPhysicalMaterial({ color: 0x1c1c24, metalness: 0.6, roughness: 0.4 }))
    sign.add(new THREE.Mesh(body, [backMat, sideMat]))

    const faceGeo = keep(new THREE.ShapeGeometry(roundRect(W - 0.14, H - 0.14, 0.28), 16))
    // ShapeGeometry 의 uv 는 도형 좌표 그대로라 0~1 로 맞춘다
    const uv = faceGeo.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (W - 0.14) + 0.5, uv.getY(i) / (H - 0.14) + 0.5)
    const faceMat = keep(
      new THREE.MeshPhysicalMaterial({ map: base, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 0, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }),
    )
    const face = new THREE.Mesh(faceGeo, faceMat)
    face.position.z = DEPTH / 2 + 0.061
    sign.add(face)

    // 기둥 두 개
    const postGeo = keep(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 24))
    const postMat = keep(new THREE.MeshPhysicalMaterial({ color: 0xd8d8e0, metalness: 1, roughness: 0.18 }))
    const posts = []
    for (const x of [-0.85, 0.85]) {
      const p = new THREE.Mesh(postGeo, postMat)
      p.position.set(x, -H / 2 - 0.65, 0)
      scene.add(p)
      posts.push(p)
    }

    // 바닥에 번지는 네온 빛
    const halo = document.createElement('canvas')
    halo.width = halo.height = 128
    const hg = halo.getContext('2d')
    const rg = hg.createRadialGradient(64, 64, 0, 64, 64, 64)
    rg.addColorStop(0, 'rgba(191,90,242,0.55)')
    rg.addColorStop(1, 'rgba(191,90,242,0)')
    hg.fillStyle = rg
    hg.fillRect(0, 0, 128, 128)
    const haloTex = keep(new THREE.CanvasTexture(halo))
    const haloMat = keep(new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    const haloGeo = keep(new THREE.PlaneGeometry(6, 2.2))
    const floor = new THREE.Mesh(haloGeo, haloMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -H / 2 - 1.38
    scene.add(floor)

    const pointer = { x: 0, y: 0 }
    const onMove = (e) => {
      pointer.x = (e.clientX / innerWidth) * 2 - 1
      pointer.y = (e.clientY / innerHeight) * 2 - 1
    }
    addEventListener('pointermove', onMove)

    const pose = (t) => {
      // 0~0.6초 기둥이 솟고, 0.25~0.9초 간판이 떨어져 걸린다
      const rise = ease(t / 0.6)
      for (const p of posts) {
        p.scale.y = Math.max(0.001, rise)
        p.position.y = -H / 2 - 1.4 + 0.75 * rise
      }
      const d = Math.max(0, t - 0.25)
      const fall = ease(d / 0.55)
      pivot.position.y = 0.1 + (1 - fall) * 3.2
      // 걸리고 나서 경첩에서 흔들리다 멈춘다
      const s = Math.max(0, t - 0.8)
      pivot.rotation.z = t < 0.8 ? 0 : 0.16 * Math.exp(-2.6 * s) * Math.sin(8 * s)
      pivot.rotation.x = t < 0.8 ? 0 : 0.08 * Math.exp(-2.2 * s) * Math.sin(6.5 * s + 1)
      faceMat.emissiveIntensity = 1.1 * flicker(t)
      haloMat.opacity = flicker(t)
      // 1.6~2.4초 반사광이 왼쪽에서 오른쪽으로 지나간다
      const k = (t - 1.6) / 0.8
      sweep.intensity = k > 0 && k < 1 ? 12 * Math.sin(Math.PI * k) : 0
      sweep.position.set(-3 + 6 * k, 0.8, 1.4)
      // 그다음엔 천천히 숨 쉬듯 돈다
      const idle = Math.max(0, t - 1.2)
      scene.rotation.y = 0.22 * Math.sin(idle * 0.7) * Math.min(1, idle) + pointer.x * 0.18
      scene.rotation.x = pointer.y * 0.08
    }

    const timer = new THREE.Timer()
    timer.connect(document)
    if (still) {
      pose(3)
      renderer.render(scene, camera)
    } else {
      renderer.setAnimationLoop((now) => {
        timer.update(now)
        pose(timer.getElapsed())
        renderer.render(scene, camera)
      })
    }

    return () => {
      renderer.setAnimationLoop(null)
      timer.dispose()
      removeEventListener('pointermove', onMove)
      scene.environment.dispose()
      for (const d of disposables) d.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [size])

  if (fallback) return <SignLogo width="84" height="84" className="boot-logo" />
  return <div ref={box} className="logo3d" style={{ width: size, height: size * 0.8 }} aria-label="간판 도감" role="img" />
}
