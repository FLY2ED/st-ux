import { useEffect, useRef } from 'react'
import { clamp, ioc, INTRO } from './motion.js'

// 서울 전체 가게 픽셀 지도 (200m 칸).
// - 인트로: 핀 끝에서 물결처럼 칸이 켜진다
// - 홈: 커서 주변 칸이 켜지고, 칸 위에 유리 툴팁
// - 리포트로 갈 때: 고른 자리로 카메라가 확대되며 선 지도로 넘겨 준다
export default function PixelMap({ grid, clock, camera, tipRef, interactive }) {
  const ref = useRef(null)
  const live = useRef({ camera, interactive })
  live.current = { camera, interactive }

  useEffect(() => {
    if (!grid) return
    const { w, h, g, x0, y1, st } = grid
    const c = ref.current, x = c.getContext('2d'), tip = tipRef.current
    const dpr = devicePixelRatio || 1
    const max = Math.log(1 + Math.max(...g))
    const lv = g.map(v => (v ? Math.log(1 + v) / max : 0))
    const heat = new Float32Array(w * h)
    const cells = []
    for (let i = 0; i < g.length; i++) if (g[i]) cells.push(i)
    const base = document.createElement('canvas')
    let W, H, s, ox, oy, mob
    function layout() {
      mob = innerWidth < 760
      W = c.width = base.width = innerWidth * dpr
      H = c.height = base.height = innerHeight * dpr
      const mc = mob ? Math.min(innerWidth / w * 1.7, innerHeight / h * .9) : Math.min(innerWidth / w, innerHeight / h) * .92
      s = mc * dpr
      ox = (W - w * s) / 2; oy = (H - h * s) / 2
      const b = base.getContext('2d')
      for (const i of cells) {
        b.fillStyle = `rgba(255,255,255,${.05 + lv[i] * .3})`
        b.fillRect(ox + (i % w) * s, oy + Math.floor(i / w) * s, s * .82, s * .82)
      }
    }
    layout()
    addEventListener('resize', layout)

    // 카메라: z 0(서울 전체) ↔ 1(고른 자리 확대). 확대 배율은 화면에 따라
    let z = live.current.camera.z, from = z, to = z, tz = 0
    const DUR = 1300
    const cam = () => {
      const want = live.current.camera.z
      if (want !== to) { from = z; to = want; tz = performance.now() }
      z = from + (to - from) * ioc(clamp((performance.now() - tz) / DUR))
      const ZR = mob ? 22 : 13, Z = Math.exp(Math.log(ZR) * z)
      const { lon, lat, cx, cy } = live.current.camera
      // 고른 자리의 기준 좌표(칸 가운데) → 화면 목표점으로 끌고 간다
      const bx = ox + ((lon - x0) / st) * s, by = oy + ((y1 - lat) / st) * s
      const tx = bx + (cx() * dpr - bx) * z, ty = by + (cy() * dpr - by) * z
      return { Z, ex: tx - Z * bx, ey: ty - Z * by }
    }
    camState.get = () => {
      // 선 지도와 맞출 확대값: 화면 css px 당 0.002도 → maplibre zoom
      const ZR = mob ? 22 : 13, Z = Math.exp(Math.log(ZR) * z)
      return { z, cssPerCell: (s / dpr) * Z, st }
    }

    let cur = null, raf
    const R = 5
    function light(cx, cy, k) {
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const gx = cx + dx, gy = cy + dy, d = Math.hypot(dx, dy)
        if (gx < 0 || gy < 0 || gx >= w || gy >= h || d > R) continue
        const i = gy * w + gx
        heat[i] = Math.max(heat[i], (1 - d / R) * k)
      }
    }
    const rings = []
    const cellAt = (px, py) => [Math.floor((px * dpr - ox) / s), Math.floor((py * dpr - oy) / s)]
    function showTip(px, py) {
      const [gx, gy] = cellAt(px, py)
      const n = gx >= 0 && gy >= 0 && gx < w && gy < h ? g[gy * w + gx] : 0
      if (!n || !live.current.interactive) { tip.style.opacity = 0; return }
      tip.innerHTML = `<b>${n.toLocaleString()}</b>SHOPS · 200M`
      tip.style.opacity = 1
      tip.style.left = Math.min(px + 16, innerWidth - tip.offsetWidth - 12) + 'px'
      tip.style.top = py + 16 + 'px'
    }
    const move = e => { cur = [e.clientX, e.clientY]; showTip(...cur) }
    const leave = () => { cur = null; tip.style.opacity = 0 }
    const down = e => { if (live.current.interactive) rings.push({ c: cellAt(e.clientX, e.clientY), r: 0 }) }
    c.addEventListener('pointermove', move)
    c.addEventListener('pointerleave', leave)
    c.addEventListener('pointerdown', down)

    const tipPt = () => {
      const mh = (mob ? 16 : 22) * 6
      return [innerWidth / 2, innerHeight / 2 + mh / 2 - 30]
    }

    function frame() {
      const t = clock.now()
      for (let i = 0; i < heat.length; i++) heat[i] *= .93
      if (cur && live.current.interactive && z < .05) { const [gx, gy] = cellAt(...cur); light(gx, gy, 1) }
      for (const r of rings) {
        r.r += .45
        for (let a = 0; a < 64; a++) {
          const gx = Math.round(r.c[0] + Math.cos(a / 64 * 6.283) * r.r), gy = Math.round(r.c[1] + Math.sin(a / 64 * 6.283) * r.r)
          if (gx >= 0 && gy >= 0 && gx < w && gy < h) heat[gy * w + gx] = Math.max(heat[gy * w + gx], .9 * (1 - r.r / 40))
        }
      }
      for (let k = rings.length - 1; k >= 0; k--) if (rings[k].r > 40) rings.splice(k, 1)

      const { Z, ex, ey } = cam()
      x.setTransform(1, 0, 0, 1, 0, 0)
      x.clearRect(0, 0, W, H)
      x.imageSmoothingEnabled = false
      x.setTransform(Z, 0, 0, Z, ex, ey)
      if (t >= INTRO.end) x.drawImage(base, 0, 0)
      else {
        const [px, py] = tipPt(), maxd = Math.hypot(innerWidth, innerHeight) * .6
        for (const i of cells) {
          const tx = ox + (i % w) * s, ty = oy + ((i / w) | 0) * s
          const d = Math.hypot(tx / dpr - px, ty / dpr - py)
          const p = clamp((t - 620 - (d / maxd) * 1100) / 500)
          if (p <= 0) continue
          // 번쩍이지 않고 제 밝기로 서서히 나타난다
          const a = (.05 + lv[i] * .3) * p
          x.fillStyle = `rgba(255,255,255,${a})`
          x.fillRect(tx, ty, s * .82, s * .82)
        }
      }
      for (let i = 0; i < heat.length; i++) {
        const v = heat[i]
        if (v < .02 || !g[i]) continue
        const grow = v * s * .25
        x.fillStyle = `rgba(255,255,255,${v * (.35 + .65 * lv[i])})`
        x.fillRect(ox + (i % w) * s - grow / 2, oy + ((i / w) | 0) * s - grow / 2, s * .82 + grow, s * .82 + grow)
      }
      // 확대가 끝나 갈수록 픽셀 지도는 물러나고 선 지도가 받는다
      c.style.opacity = 1 - clamp((z - .7) / .3)
      raf = requestAnimationFrame(frame)
    }
    frame()
    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('resize', layout)
      c.removeEventListener('pointermove', move)
      c.removeEventListener('pointerleave', leave)
      c.removeEventListener('pointerdown', down)
    }
  }, [grid])

  return <canvas ref={ref} className="pixmap" />
}

// 선 지도가 확대값을 읽어 가는 창구
export const camState = { get: () => null }
