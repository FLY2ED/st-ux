import { useEffect, useRef, useState } from 'react'
import { drawAvatar, readLook } from '../avatar.js'
import { sfx } from '../sound.js'
import hat from '../assets/intro/hardhat.webp'
import './intro.css'

// 게임 인트로: 수리공이 걸어 나와 사다리를 타고 올라가 바탕화면을 주먹으로 쳐서 무너뜨린다.
// 진짜 아이콘·위젯·메뉴 막대·Dock 에 transform 만 잠깐 얹었다가, 끝나면 원래 inline 스타일로 되돌린다
export const INTRO_KEY = 'gp-intro'

export function introSeen() {
  try {
    return localStorage.getItem(INTRO_KEY) === '1'
  } catch {
    return true
  }
}

const G = 2600
const rnd = (a, b) => a + Math.random() * (b - a)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const ease = (k) => 1 - (1 - clamp(k, 0, 1)) ** 3
const lerp = (a, b, k) => a + (b - a) * k
function bounce(k) {
  k = clamp(k, 0, 1)
  const n = 7.5625
  const d = 2.75
  if (k < 1 / d) return n * k * k
  if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75
  if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375
  return n * (k -= 2.625 / d) * k + 0.984375
}

// 시간표(초)
const T = { walk: 1.15, step: 1.4, drop: [0.35, 1.05], climb: 2.3, hits: [2.55, 3.05, 3.55, 4.05], wind: 4.4, smash: 4.85, title: 5.85 }
// 주먹마다 무너뜨릴 것. 앞 것이 비어도 박자는 그대로 간다
const HITS = [
  ['.desk-item', '.mac-win'],
  ['.widgets > *', '.notice'],
  ['.menubar .mb-slot', '.menubar .mb-right > *', '.menubar'],
  ['.wall-lights > :not(i)', '.dock-item', '.dock-sep', '.dock'],
]
const PX_WORD = ['수', '리', '공']

// 작은 안전모 마크(캡션 옆 로고)
const MARK = ['....XXXX....', '..XXXXXXXX..', '.XXXX..XXXX.', '.XXXX..XXXX.', 'XXXXXXXXXXXX', 'XXXXXXXXXXXX', '............', 'XXXXXXXXXXXX']

function drawMark(c) {
  const s = 3
  c.width = 12 * s
  c.height = MARK.length * s
  const x = c.getContext('2d')
  x.fillStyle = '#fff'
  MARK.forEach((row, j) => [...row].forEach((k, i) => k === 'X' && x.fillRect(i * s, j * s, s, s)))
}

// 갈무리로 한 글자를 12칸 격자로 찍어 낸다
function glyphGrid(ch) {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 16
  const x = c.getContext('2d')
  x.font = '700 12px "Galmuri11 Game", Galmuri11, monospace'
  x.textBaseline = 'top'
  x.fillStyle = '#000'
  x.fillText(ch, 1, 2)
  const d = x.getImageData(0, 0, 16, 16).data
  const cells = []
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) if (d[(j * 16 + i) * 4 + 3] > 110) cells.push([i, j])
  if (!cells.length) return { cells, w: 12, h: 12 }
  const minX = Math.min(...cells.map((p) => p[0]))
  const maxX = Math.max(...cells.map((p) => p[0]))
  const minY = Math.min(...cells.map((p) => p[1]))
  const maxY = Math.max(...cells.map((p) => p[1]))
  return { cells: cells.map(([i, j]) => [i - minX, j - minY, rnd(0, 0.18) + (i - minX) * 0.012]), w: maxX - minX + 1, h: maxY - minY + 1 }
}

// 블록 한 칸: 아래·오른쪽으로 두께를 주고 앞면은 흰색
function voxel(x, gx, gy, cell, a = 1) {
  const d = Math.max(2, Math.round(cell * 0.3))
  x.globalAlpha = a
  x.fillStyle = '#5d5d6c'
  x.fillRect(gx + d, gy + d, cell, cell)
  x.fillStyle = '#f4f4f8'
  x.fillRect(gx, gy, cell - 1, cell - 1)
  x.fillStyle = '#ffffff'
  x.fillRect(gx, gy, cell - 1, Math.max(1, cell * 0.18))
  x.fillStyle = '#d9d9e2'
  x.fillRect(gx, gy + cell * 0.78, cell - 1, cell * 0.22 - 1)
  x.globalAlpha = 1
}

// 시작 화면 메뉴. 고르면 무너진 바탕 그대로 게임이 전체 화면으로 열린다. 나가기는 바탕화면을 되돌린다
const MENU = [
  { id: 'play', label: '게임 시작' },
  { id: 'story', label: '장 고르기' },
  { id: 'keys', label: '조작법' },
  { id: 'exit', label: '나가기' },
]

// onReady: 제목이 뜨면 게임을 뒤에 미리 띄운다 · onStart(메뉴): 고른 것으로 게임 시작
// release: 게임을 닫거나 창으로 내리면 true. 그때 바탕화면을 되돌리고 onDone
export default function Intro({ onReady, onStart, release, onDone }) {
  const [reduce] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  const [stage, setStage] = useState(reduce ? 'title' : 'play')
  // 전에 한 번 끝까지 봤으면 클릭·키로 빨리 감아 제목까지 건너뛸 수 있다
  const [seen] = useState(introSeen)
  const skipRef = useRef(() => {})
  const [sel, setSel] = useState(0)
  const selRef = useRef(0)
  selRef.current = sel
  const started = useRef(false)
  const holdRef = useRef(false)
  const releaseRef = useRef(() => {})
  const menuKey = useRef(() => {})
  const cv = useRef(null)
  const glyphRefs = useRef([])
  const markRef = useRef(null)
  const blackRef = useRef(null)
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const readyRef = useRef(onReady)
  readyRef.current = onReady
  const startRef = useRef(onStart)
  startRef.current = onStart

  const start = (i) => {
    if (started.current) return
    started.current = true
    setSel(i)
    sfx.coin()
    startRef.current?.(MENU[i].id)
    // 제목이 걷히는 동안 뒤에서 게임이 시작하고, 걷히면 판을 게임 창 아래로 내린다
    setStage('leave')
    setTimeout(() => {
      holdRef.current = true
      setStage((s) => (s === 'leave' ? 'held' : s))
    }, 380)
  }
  menuKey.current = (e) => {
    const k = e.key
    if (k === 'ArrowUp' || k === 'w' || k === 'W') setSel((n) => (n + MENU.length - 1) % MENU.length), sfx.tick()
    else if (k === 'ArrowDown' || k === 's' || k === 'S') setSel((n) => (n + 1) % MENU.length), sfx.tick()
    else if (k === 'Enter' || k === ' ' || k === 'z' || k === 'Z') start(selRef.current)
  }

  useEffect(() => {
    if (release) releaseRef.current()
  }, [release])

  useEffect(() => {
    try {
      localStorage.setItem(INTRO_KEY, '1')
    } catch {
      // 저장이 막히면 다음에도 한 번 더 나온다
    }
    if (markRef.current) drawMark(markRef.current)
  }, [])

  useEffect(() => {
    let alive = true
    let raf = 0
    const W = window.innerWidth
    const H = window.innerHeight
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const root = document.querySelector('.mac')
    const touched = new Map()
    const touch = (el, props) => {
      if (!touched.has(el)) touched.set(el, { transform: el.style.transform, transition: el.style.transition, animation: el.style.animation, visibility: el.style.visibility, willChange: el.style.willChange, filter: el.style.filter })
      Object.assign(el.style, props)
    }
    if (root) touch(root, {})
    const black = blackRef.current
    const restore = () => {
      for (const [el, s] of touched) Object.assign(el.style, s)
      touched.clear()
    }

    // 픽셀 글자는 글꼴이 오면 찍는다
    const glyphs = []
    const fontReady = document.fonts?.load('700 12px "Galmuri11 Game"').catch(() => {}) || Promise.resolve()
    fontReady.then(() => {
      if (!alive) return
      PX_WORD.forEach((ch, i) => (glyphs[i] = glyphGrid(ch)))
      sizeGlyphs()
      if (reduce) drawGlyphs(99)
    })
    function sizeGlyphs() {
      glyphRefs.current.forEach((c, i) => {
        const g = glyphs[i]
        if (!c || !g) return
        const fs = parseFloat(getComputedStyle(c.parentElement).fontSize) || 160
        const cell = Math.max(4, Math.round(((fs * 0.86) / g.h) * dpr))
        c.width = (g.w + 1) * cell
        c.height = (g.h + 1) * cell
        c.style.width = `${c.width / dpr}px`
        c.style.height = `${c.height / dpr}px`
        g.cell = cell
      })
    }
    // age: 제목이 뜬 뒤 흐른 초. 칸마다 위에서 떨어져 제자리에 박힌다
    function drawGlyphs(age) {
      glyphRefs.current.forEach((c, i) => {
        const g = glyphs[i]
        if (!c || !g?.cell) return
        const x = c.getContext('2d')
        x.clearRect(0, 0, c.width, c.height)
        const cell = g.cell
        for (const [gx, gy, delay] of g.cells) {
          const k = clamp((age - 0.15 - i * 0.12 - delay) / 0.32, 0, 1)
          if (k <= 0) continue
          const off = (1 - bounce(k)) * -cell * 3
          voxel(x, gx * cell, gy * cell + off, cell, Math.min(1, k * 3))
        }
      })
    }

    // 바로 끝내는 모드: 검은 판 위에 제목만 잠깐
    if (reduce) {
      let t1 = 0
      const leave = () => {
        if (!alive || t1 === -1) return
        t1 = -1
        setStage('out')
        setTimeout(() => alive && doneRef.current?.(), 420)
      }
      releaseRef.current = leave
      const pre = setTimeout(() => alive && readyRef.current?.(), 300)
      const onKey = (e) => {
        if (holdRef.current || t1 === -1) return
        e.preventDefault()
        e.stopPropagation()
        menuKey.current(e)
      }
      window.addEventListener('keydown', onKey, true)
      return () => {
        alive = false
        clearTimeout(pre)
        window.removeEventListener('keydown', onKey, true)
      }
    }

    const c = cv.current
    c.width = W * dpr
    c.height = H * dpr
    const ctx = c.getContext('2d')
    const look = readLook()
    const S = clamp(Math.round(H / 150), 4, 6)
    const floorY = H - 14
    const ladderX = Math.round(W * 0.43)
    const climbY = Math.round(H * 0.6)
    const MENU = 24

    // 바탕 그림을 한 장 떠 둔다(무너질 때 블록으로 쪼갠다)
    const wallEl = document.querySelector('.wall-lights')
    const wallC = document.createElement('canvas')
    wallC.width = W
    wallC.height = H
    const wx = wallC.getContext('2d')
    wx.fillStyle = getComputedStyle(root || document.body).backgroundColor || '#1a1d3a'
    wx.fillRect(0, 0, W, H)
    const src = wallEl && getComputedStyle(wallEl).backgroundImage.match(/url\("?(.*?)"?\)/)?.[1]
    if (src) {
      const img = new Image()
      img.onload = () => {
        const s = Math.max(W / img.width, H / img.height)
        wx.imageSmoothingEnabled = false
        wx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s)
      }
      img.src = src
    }

    const pieces = []
    const parts = []
    const cracks = []
    const bursts = []
    const words = []
    // 바탕에서 떨어져 나온 조각(바탕 그림을 그대로 오려 쓴다)과 충격파 고리
    const chips = []
    const rings = []
    let blocks = null
    let flash = 0
    // 타격감: trauma 는 맞을 때 더하고 저절로 줄어든다. 흔들림은 trauma² 로, 매 프레임 난수 대신 사인을 겹쳐 부드럽게
    let trauma = 0
    let shakeT = 0
    let zoom = 0
    let charge = 0
    let focusAt = null
    // 히트스톱: 이 시각(실시간 ms)까지 장면 시계를 멈춘다. 큰 한 방 뒤에는 잠깐 느리게 흐르다 돌아온다
    let freezeUntil = 0
    let slowAt = 0
    let impactAt = -1
    let fist = null
    let pose = { x: -80, y: H + 160, dir: 3, frame: 0, arm: null, vy: 0, fall: false, ox: 0 }
    let ladder = { len: 0, sway: 0, y: 0, vy: 0 }
    let fired = new Set()
    let out = null
    let lastStep = -1
    // 장면 시계(초). 로그인 화면이 걷힐 틈을 조금 둔다
    let clock = -0.38
    let last = performance.now()
    const hitStop = (ms) => (freezeUntil = Math.max(freezeUntil, performance.now() + ms))

    function grab(selectors, at, fx, fy, power) {
      let n = 0
      for (const q of selectors) {
        for (const el of document.querySelectorAll(q)) {
          if (pieces.some((p) => p.el === el)) continue
          const r = el.getBoundingClientRect()
          if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > H) continue
          const base = getComputedStyle(el).transform
          const cx = r.left + r.width / 2
          const cy = r.top + r.height / 2
          const d = Math.hypot(cx - fx, cy - fy)
          // 큰 판(메뉴 막대·Dock)은 조금 늦게, 천천히 돈다
          const big = Math.max(r.width, r.height)
          pieces.push({
            el, base: base === 'none' ? '' : base, cx, cy, w: r.width, h: r.height, x: 0, y: 0, a: 0, vx: 0, vy: 0, va: 0,
            at: at + d / 2600 + rnd(0, 0.06) + (big > 400 ? 0.16 : 0) + n * 0.004, power, fx, fy, state: 'wait', spin: Math.min(1, 140 / big),
          })
          n++
        }
      }
    }

    function launch(p) {
      const dx = p.cx - p.fx
      const dy = p.cy - p.fy
      const d = Math.hypot(dx, dy) || 1
      const near = clamp(1.4 - d / 900, 0.5, 1.4)
      p.vx = (dx / d) * 520 * near * p.power + rnd(-140, 140)
      p.vy = (dy / d) * 260 * near - rnd(380, 720) * p.power
      p.va = rnd(-1, 1) * 9 * p.spin
      p.state = 'fly'
      p.lt = p.at
      touch(p.el, { transition: 'none', animation: 'none', willChange: 'transform' })
    }

    function dust(x, y, n, spread = 1) {
      for (let i = 0; i < n; i++) {
        const a = rnd(0, Math.PI * 2)
        const v = rnd(80, 520) * spread
        parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: rnd(0.35, 0.8), age: 0, s: Math.round(rnd(3, 8)), c: ['#fff6d8', '#e8dcc0', '#b9ad94', '#ffcf3a'][i % 4] })
      }
    }

    // 바탕 조각: 맞은 자리 둘레의 바탕 그림을 네모로 오려 튕겨 낸다
    function chipsAt(x, y, n, power) {
      for (let i = 0; i < n && chips.length < 240; i++) {
        const s = Math.round(rnd(6, 20))
        const a = rnd(0, Math.PI * 2)
        const v = rnd(160, 680) * power
        chips.push({
          x: x + rnd(-18, 18), y: y + rnd(-18, 18), vx: Math.cos(a) * v, vy: Math.sin(a) * v - rnd(160, 420) * power, a: 0, va: rnd(-14, 14), s, plaster: Math.random() < 0.35,
          sx: clamp(Math.round(x + rnd(-70, 70)), 0, W - s), sy: clamp(Math.round(y + rnd(-70, 70)), 0, H - s),
        })
      }
    }

    function crack(x, y, size = 1, t = 0) {
      const lines = []
      const n = Math.round(rnd(4, 7))
      for (let i = 0; i < n; i++) {
        let a = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3)
        let px = x
        let py = y
        const pts = [[px, py]]
        const len = rnd(60, 170) * size
        for (let s = 0; s < len; s += 14) {
          a += rnd(-0.5, 0.5)
          px += Math.cos(a) * 14
          py += Math.sin(a) * 14
          pts.push([Math.round(px / 3) * 3, Math.round(py / 3) * 3])
        }
        lines.push(pts)
      }
      cracks.push({ lines, t })
    }

    // 주먹: 몸 쪽 어깨에서 목표 방향으로 팔을 뻗는다
    function punch(i) {
      const sel = HITS[i]
      const els = sel.flatMap((q) => [...document.querySelectorAll(q)])
      let tx = W / 2
      let ty = H / 2
      if (els.length) {
        const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 1)
        if (rs.length) {
          tx = rs.reduce((s, r) => s + r.left + r.width / 2, 0) / rs.length
          ty = rs.reduce((s, r) => s + r.top + r.height / 2, 0) / rs.length
        }
      }
      return aim(tx, ty)
    }
    function aim(tx, ty) {
      const sx = pose.x + pose.ox
      const sy = pose.y - 15 * S
      const dx = tx - sx
      const dy = ty - sy
      const d = Math.hypot(dx, dy) || 1
      const reach = 11 * S
      return { sx, sy, fx: sx + (dx / d) * reach, fy: sy + (dy / d) * reach, dir: dx < 0 ? 2 : 3, ux: dx / d, uy: dy / d }
    }

    function smash() {
      const f = aim(W / 2, H * 0.45)
      fist = f
      // 큰 한 방: 시간 멈춤 → 흑백 반전 두어 프레임 → 하얀 번쩍 → 화면 확대 펀치 → 느린 화면으로 무너짐
      hitStop(170)
      impactAt = performance.now()
      slowAt = impactAt + 170
      flash = 1
      trauma = 1
      zoom = 0.05
      charge = 0
      focusAt = { x: f.fx, y: f.fy, t: T.smash }
      rings.push({ x: f.fx, y: f.fy, t: T.smash, r: Math.max(W, H) * 0.7, w: 22 }, { x: f.fx, y: f.fy, t: T.smash + 0.06, r: Math.max(W, H) * 0.45, w: 12 })
      chipsAt(f.fx, f.fy, 70, 1.5)
      sfx.blast()
      setTimeout(() => sfx.thud(), 120)
      setTimeout(() => sfx.thud(), 300)
      setTimeout(() => sfx.thud(), 520)
      dust(f.fx, f.fy, 60, 1.6)
      cracks.length = 0
      words.push({ text: '와르르!', x: W / 2, y: H * 0.3, t: T.smash, size: 72, rot: -0.08, life: 1.1 })
      // 바탕을 블록으로 쪼개 그 자리를 덮고, 진짜 바탕은 숨긴다
      const B = Math.round(clamp(W / 44, 22, 40))
      blocks = []
      for (let y = 0; y < H; y += B) {
        for (let x = 0; x < W; x += B) {
          const cx = x + B / 2
          const cy = y + B / 2
          const d = Math.hypot(cx - f.fx, cy - f.fy)
          const k = Math.max(0, 1 - d / 700)
          blocks.push({ hx: x, hy: y, x: 0, y: 0, a: 0, vx: ((cx - f.fx) / (d || 1)) * 700 * k + rnd(-60, 60), vy: ((cy - f.fy) / (d || 1)) * 500 * k - rnd(0, 260), va: rnd(-6, 6), at: T.smash + d / 1500 + rnd(0, 0.14), on: false })
        }
      }
      if (wallEl) touch(wallEl, { visibility: 'hidden' })
      if (black) black.style.opacity = '1'
      // 아직 남은 것들은 바닥이 꺼지며 같이 떨어진다
      for (const p of pieces) if (p.state === 'rest') (p.state = 'fly'), (p.vy = rnd(-200, 0))
    }

    const go = () => {
      if (out || !alive) return
      out = { t: clock, wall: !!blocks }
      setStage('out')
      sfx.whoosh(true)
      // 아직 안 맞은 것은 건드리지 않는다
      for (let i = pieces.length - 1; i >= 0; i--) if (pieces[i].state === 'wait') pieces.splice(i, 1)
      if (blocks) for (const b of blocks) {
        b.sx = clamp(b.x, -W, W)
        b.sy = clamp(b.y, -H, H + 200 - b.hy)
        if (!b.on) b.sx = b.sy = 0
        b.sa = b.a
        b.d = (1 - b.hy / H) * 0.22 + rnd(0, 0.12)
      }
      pieces.forEach((p, i) => {
        p.sx = clamp(p.x, -W, W)
        p.sy = clamp(p.y, -H, H + 160 - p.cy)
        p.sa = p.a
        p.d = i * 0.012
      })
    }
    // 애니메이션은 건너뛸 수 없다. 제목이 뜬 뒤 메뉴로만 시작하고, 게임이 끝나야 바탕화면이 돌아온다
    releaseRef.current = () => {
      if (!alive || out) return
      go()
      if (!raf) {
        last = performance.now()
        raf = requestAnimationFrame(frame)
      }
    }

    const onKey = (e) => {
      if (holdRef.current || out) return
      e.preventDefault()
      e.stopPropagation()
      if (fired.has('title')) menuKey.current(e)
      else skipRef.current()
    }
    let ff = false
    skipRef.current = () => {
      if (seen && !fired.has('title')) ff = true
    }
    window.addEventListener('keydown', onKey, true)

    let holdAt = 0
    function frame(now) {
      if (!alive) return
      // 게임이 덮고 있는 동안은 무너진 장면을 잠깐 더 흘리다 멈춘다
      if (holdRef.current && !out) {
        holdAt ||= now
        if (now - holdAt > 1500) {
          raf = 0
          return
        }
      }
      glyphLoop()
      const rdt = Math.min(0.034, (now - last) / 1000)
      last = now
      let ts = 1
      if (now < freezeUntil) ts = 0
      else if (slowAt && now < slowAt + 650) ts = lerp(0.3, 1, ease((now - slowAt) / 650))
      if (ff && !fired.has('title')) ts = 5
      const dt = rdt * ts
      clock += dt
      const t = clock

      if (!out) direct(t)
      step(t, dt)
      camera(now, rdt)
      draw(t, now)
      if (out) {
        const k = t - out.t
        const wallDur = out.wall ? 0.75 : 0
        if (out.wall && k >= wallDur && blocks) {
          blocks = null
          if (black) black.style.opacity = '0'
          if (wallEl) Object.assign(wallEl.style, touched.get(wallEl) || {}), touched.delete(wallEl)
        }
        if (k >= wallDur + 0.75) {
          restore()
          if (root) root.style.transform = ''
          alive = false
          doneRef.current?.()
          return
        }
      }
      raf = requestAnimationFrame(frame)
    }

    // 장면 진행
    function direct(t) {
      // 1. 아래 왼쪽에서 걸어 나온다
      if (t < T.walk) {
        const k = t / T.walk
        pose.x = lerp(-70, ladderX - 110, k)
        pose.y = lerp(H + 150, floorY, ease(k * 1.15))
        pose.dir = 3
        pose.frame = Math.floor(t / 0.11) % 2
      } else if (t < T.step) {
        pose.x = lerp(ladderX - 110, ladderX, ease((t - T.walk) / (T.step - T.walk)))
        pose.y = floorY
        pose.frame = Math.floor(t / 0.11) % 2
      } else if (t < T.climb) {
        // 3. 사다리를 탄다
        const k = (t - T.step) / (T.climb - T.step)
        pose.x = ladderX + Math.sin(t * 22) * 2
        pose.y = lerp(floorY, climbY, ease(k))
        pose.dir = 1
        pose.frame = 1 + (Math.floor(t / 0.12) % 2)
        const st = Math.floor(t / 0.12)
        if (st !== lastStep) (lastStep = st), sfx.tick()
      }
      // 2. 사다리가 메뉴 막대에서 풀려 내려온다
      const [d0, d1] = T.drop
      if (t >= d0) {
        ladder.len = (floorY - MENU) * bounce((t - d0) / (d1 - d0))
        if (!fired.has('drop')) fired.add('drop'), sfx.whoosh(false, { dur: 0.4, peak: 0.14 })
        if (t >= d1 && !fired.has('land')) fired.add('land'), sfx.thud(), (ladder.sway = 10)
      }
      // 4. 주먹 넷: 뒤로 당겼다가(예비 동작) 확 뻗고, 맞는 순간 시간이 잠깐 멈췄다가 몸이 반동으로 밀린다
      if (t >= T.climb) pose.ox = 0
      T.hits.forEach((h, i) => {
        if (t >= h - 0.16 && t < h + 0.24) {
          const f = punch(i)
          pose.dir = f.dir
          pose.frame = 0
          let k
          if (t < h - 0.04) {
            const e = (t - h + 0.16) / 0.12
            k = -0.45 * e * e
            pose.ox = -f.ux * 10 * e * e
          } else if (t < h) {
            k = lerp(-0.45, 1.15, ease((t - h + 0.04) / 0.04))
            pose.ox = lerp(-f.ux * 10, f.ux * 6, (t - h + 0.04) / 0.04)
          } else if (t < h + 0.1) {
            k = lerp(1.15, 1, ease((t - h) / 0.08))
            pose.ox = lerp(f.ux * 6, -f.ux * 8, ease((t - h) / 0.06))
          } else {
            k = 1 - (t - h - 0.1) / 0.14
            pose.ox = -f.ux * 8 * (1 - ease((t - h - 0.1) / 0.14))
          }
          pose.arm = { ...f, k, smear: t >= h - 0.04 && t < h + 0.03, hot: t >= h && t < h + 0.05 }
        } else if (t >= h + 0.24 && t < h + 0.3) pose.arm = null
        if (t >= h && !fired.has(`hit${i}`)) {
          fired.add(`hit${i}`)
          const f = punch(i)
          fist = f
          sfx.hurt()
          hitStop(55 + i * 12)
          trauma = Math.min(1, trauma + 0.38 + i * 0.06)
          zoom = 0.012 + i * 0.004
          dust(f.fx, f.fy, 22)
          crack(f.fx, f.fy, 0.8 + i * 0.15, t)
          chipsAt(f.fx, f.fy, 12 + i * 4, 0.9 + i * 0.1)
          rings.push({ x: f.fx, y: f.fy, t, r: 110 + i * 25, w: 8 })
          bursts.push({ x: f.fx, y: f.fy, t })
          words.push({ text: ['퍽!', '빡!', '쾅!', '퍼억!'][i], x: f.fx + f.ux * 40, y: f.fy + f.uy * 40 - 20, t, size: 34 + i * 4, rot: rnd(-0.25, 0.25) })
          grab(HITS[i], t, f.fx, f.fy, 1 + i * 0.08)
        }
      })
      // 5. 힘을 모아 한 방
      // 몸을 뒤로 젖히며 팔을 당기고, 화면이 낮게 울리며 둘레의 빛 알갱이가 주먹으로 빨려 든다
      if (t >= T.wind && t < T.smash) {
        const k = (t - T.wind) / (T.smash - T.wind)
        const f = aim(W / 2, H * 0.45)
        pose.dir = f.dir
        pose.x = ladderX + rnd(-2, 2) * k
        pose.ox = -f.ux * 16 * ease(k)
        pose.arm = { ...f, k: -0.55 * ease(k) }
        charge = k
        focusAt = { x: f.sx, y: f.sy, t }
        trauma = Math.max(trauma, 0.2 + 0.22 * k)
        for (let n = 0; n < 2; n++) {
          const a = rnd(0, Math.PI * 2)
          const r = rnd(150, 280)
          parts.push({ x: f.sx + Math.cos(a) * r, y: f.sy + Math.sin(a) * r, vx: -Math.cos(a) * r * 3.2, vy: -Math.sin(a) * r * 3.2, g: 0, life: 0.28, age: 0, s: Math.random() < 0.3 ? 6 : 4, c: Math.random() < 0.5 ? '#ffcf3a' : '#fff6d8' })
        }
      }
      if (t >= T.smash && !fired.has('smash')) {
        fired.add('smash')
        pose.ox = 0
        smash()
        pose.arm = { ...aim(W / 2, H * 0.45), k: 1.2, hot: true, smear: true }
      }
      if (t >= T.smash + 0.18 && !pose.fall) {
        pose.fall = true
        pose.arm = null
        pose.vy = -380
        ladder.vy = -120
      }
      if (t >= T.title && !fired.has('title')) {
        fired.add('title')
        setStage('title')
        sfx.startup()
        // 제목이 자리 잡는 동안 뒤에서 게임을 불러 둔다
        setTimeout(() => alive && readyRef.current?.(), 700)
      }
    }

    function step(t, dt) {
      ladder.sway *= Math.exp(-dt * 3)
      if (pose.fall) {
        pose.vy += G * dt
        pose.y += pose.vy * dt
        ladder.vy += G * 0.8 * dt
        ladder.y += ladder.vy * dt
      }
      const floor = !blocks
      for (const p of pieces) {
        if (out) {
          const k = ease((t - out.t - (out.wall ? 0.7 : 0) - p.d) / 0.5)
          p.x = p.sx * (1 - k)
          p.y = p.sy * (1 - k)
          p.a = p.sa * (1 - k)
          continue
        }
        if (p.state === 'wait') {
          if (t >= p.at) launch(p)
          else continue
        }
        if (p.state === 'gone') continue
        p.vy += G * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.a += p.va * dt
        const ca = Math.abs(Math.cos(p.a))
        const sa = Math.abs(Math.sin(p.a))
        const hh = (ca * p.h + sa * p.w) / 2
        const hw = (ca * p.w + sa * p.h) / 2
        const bottom = p.cy + p.y + hh
        if (floor && bottom > H) {
          p.y -= bottom - H
          if (p.vy > 260) {
            if (p.state !== 'rest') sfx.thud()
            p.vy *= -0.34
            p.vx *= 0.7
            p.va *= 0.5
          } else {
            p.vy = 0
            p.vx *= 0.86
            p.va *= 0.8
            p.state = 'rest'
          }
        }
        const left = p.cx + p.x - hw
        const right = p.cx + p.x + hw
        if (left < 0 && p.vx < 0) p.vx = -p.vx * 0.5
        if (right > W && p.vx > 0) p.vx = -p.vx * 0.5
        if (!floor && p.cy + p.y - hh > H + 40) p.state = 'gone'
      }
      if (blocks) {
        for (const b of blocks) {
          if (out) {
            const k = ease((t - out.t - b.d) / 0.42)
            b.x = b.sx * (1 - k)
            b.y = b.sy * (1 - k)
            b.a = b.sa * (1 - k)
            continue
          }
          if (!b.on) {
            if (t < b.at) continue
            b.on = true
          }
          if (b.hy + b.y > H + 80) continue
          b.vy += G * 0.85 * dt
          b.x += b.vx * dt
          b.y += b.vy * dt
          b.a += b.va * dt
        }
      }
      for (const c of chips) {
        c.vy += G * dt
        c.x += c.vx * dt
        c.y += c.vy * dt
        c.a += c.va * dt
        if (floor && c.y + c.s / 2 > H && c.vy > 0) {
          c.y = H - c.s / 2
          c.vy *= -0.32
          c.vx *= 0.7
          c.va *= 0.6
        }
      }
      for (let i = chips.length - 1; i >= 0; i--) if (chips[i].y > H + 60 || (floor && Math.abs(chips[i].vy) < 20 && chips[i].y > H - 30 && Math.random() < dt * 2)) chips.splice(i, 1)
      for (const q of parts) {
        q.age += dt
        q.vy += (q.g ?? 900) * dt
        q.x += q.vx * dt
        q.y += q.vy * dt
        q.vx *= 0.97
      }
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].age > parts[i].life) parts.splice(i, 1)
      for (const p of pieces) {
        if (p.state === 'wait' && !out) continue
        // 맞은 직후: 찌그러졌다가 출렁이며 돌아오고, 두어 프레임 하얗게 번쩍인다
        const q = p.lt != null && !out ? clamp((t - p.lt) / 0.26, 0, 1) : 1
        const sq = 0.16 * (1 - q) * Math.cos(q * Math.PI * 1.5)
        p.el.style.transform = `${p.base} translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) rotate(${p.a.toFixed(3)}rad) scale(${(1 + sq).toFixed(3)}, ${(1 - sq).toFixed(3)})`
        p.el.style.filter = q < 0.18 ? 'brightness(2) saturate(0.5)' : ''
      }
    }

    // 화면 흔들림·확대 펀치·반전 프레임은 실제 시간으로 흐른다(히트스톱 중에도 화면은 떨린다)
    function camera(now, rdt) {
      trauma = Math.max(0, trauma - rdt * 1.3)
      zoom *= Math.exp(-rdt * 7)
      flash = Math.max(0, flash - rdt * 3)
      shakeT += rdt * 32
      if (!root) return
      if (out) {
        root.style.transform = ''
        root.style.filter = ''
        return
      }
      const s = trauma * trauma
      const ox = 26 * s * (0.6 * Math.sin(shakeT * 1.7) + 0.4 * Math.sin(shakeT * 3.3 + 1.3))
      const oy = 18 * s * (0.6 * Math.sin(shakeT * 2.3 + 0.7) + 0.4 * Math.sin(shakeT * 4.1))
      const rot = 0.7 * s * Math.sin(shakeT * 1.1)
      const z = 1 + zoom + charge * 0.03
      root.style.transform = s > 0.0005 || z > 1.0005 ? `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px) rotate(${rot.toFixed(3)}deg) scale(${z.toFixed(4)})` : ''
      root.style.filter = impactAt >= 0 && now - impactAt < 75 ? 'invert(1) grayscale(1) contrast(2.4)' : ''
    }

    // 집중선: 한 점으로 모이는 만화 속도선. 매 프레임 조금씩 흔들려 번득인다
    function focusLines(cx, cy, amt) {
      const n = 56
      const R = Math.hypot(W, H)
      const r0 = lerp(Math.min(W, H) * 0.62, Math.min(W, H) * 0.22, amt)
      ctx.fillStyle = `rgba(255,250,235,${(0.18 + 0.5 * amt).toFixed(3)})`
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd(-0.04, 0.04)
        const w = rnd(0.004, 0.016) * (0.5 + amt)
        const r = r0 + rnd(0, 90)
        ctx.beginPath()
        ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
        ctx.lineTo(cx + Math.cos(a - w) * R, cy + Math.sin(a - w) * R)
        ctx.lineTo(cx + Math.cos(a + w) * R, cy + Math.sin(a + w) * R)
        ctx.closePath()
        ctx.fill()
      }
    }

    function draw(t) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      ctx.imageSmoothingEnabled = false
      // 무너지는 바탕
      if (blocks) {
        const B = blocks.length ? Math.round(clamp(W / 44, 22, 40)) : 0
        for (const b of blocks) {
          if (b.hy + b.y > H + 60) continue
          if (!b.on && !out) {
            ctx.drawImage(wallC, b.hx, b.hy, B, B, b.hx, b.hy, B, B)
            continue
          }
          ctx.save()
          ctx.translate(b.hx + b.x + B / 2, b.hy + b.y + B / 2)
          ctx.rotate(b.a)
          ctx.drawImage(wallC, b.hx, b.hy, B, B, -B / 2, -B / 2, B, B)
          // 블록 두께
          ctx.fillStyle = 'rgba(0,0,0,0.35)'
          ctx.fillRect(-B / 2, B / 2 - 3, B, 3)
          ctx.fillRect(B / 2 - 3, -B / 2, 3, B)
          ctx.fillStyle = 'rgba(255,255,255,0.18)'
          ctx.fillRect(-B / 2, -B / 2, B, 2)
          ctx.restore()
        }
      }
      if (out) return
      // 금: 맞은 자리에서 바깥으로 쩍 갈라져 나간다
      ctx.lineJoin = 'miter'
      for (const c of cracks) {
        const grow = clamp((t - c.t) / 0.09, 0, 1)
        for (const all of c.lines) {
          const pts = all.slice(0, Math.max(2, Math.ceil(all.length * grow)))
          ctx.beginPath()
          pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
          ctx.strokeStyle = 'rgba(8,6,20,0.9)'
          ctx.lineWidth = 6
          ctx.stroke()
          ctx.strokeStyle = 'rgba(255,246,216,0.7)'
          ctx.lineWidth = 2
          ctx.stroke()
        }
      }
      // 집중선: 기를 모을 때 짙어지고, 큰 한 방 직후 잠깐 남는다
      if (charge > 0 && focusAt) focusLines(focusAt.x, focusAt.y, charge)
      else if (focusAt && t - focusAt.t < 0.35) focusLines(focusAt.x, focusAt.y, 1 - (t - focusAt.t) / 0.35)
      // 사다리
      if (ladder.len > 0) drawLadder(t)
      // 수리공
      if (pose.y - 24 * S < H + 20) {
        if (pose.arm && pose.dir !== 1) drawArm(pose.arm, false)
        drawAvatar(ctx, look, pose.x + pose.ox, pose.y, { scale: S, dir: pose.dir, frame: pose.frame, shadow: pose.y >= floorY - 1 && !pose.fall })
        if (pose.arm && pose.dir !== 1) drawArm(pose.arm, true)
      }
      // 퍽! 별
      for (const b of bursts) {
        const k = (t - b.t) / 0.22
        if (k > 1) continue
        const r = 18 + k * 60
        ctx.fillStyle = k < 0.35 ? '#ffffff' : '#ffcf3a'
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2
          const s = Math.round(10 * (1 - k)) + 3
          ctx.fillRect(Math.round(b.x + Math.cos(a) * r - s / 2), Math.round(b.y + Math.sin(a) * r - s / 2), s, s)
        }
        ctx.fillStyle = `rgba(255,255,255,${0.9 * (1 - k)})`
        const s = 26 * (1 - k)
        ctx.fillRect(b.x - s / 2, b.y - s / 2, s, s)
      }
      // 충격파 고리
      for (const r of rings) {
        const k = (t - r.t) / 0.32
        if (k < 0 || k > 1) continue
        const rad = r.r * ease(k)
        ctx.lineWidth = Math.max(1, r.w * (1 - k))
        ctx.strokeStyle = `rgba(255,255,255,${(1 - k).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(r.x, r.y, rad, 0, Math.PI * 2)
        ctx.stroke()
        ctx.lineWidth = Math.max(1, r.w * 0.5 * (1 - k))
        ctx.strokeStyle = `rgba(255,207,58,${(0.8 * (1 - k)).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(r.x, r.y, rad * 0.82, 0, Math.PI * 2)
        ctx.stroke()
      }
      // 바탕 조각: 앞면은 바탕 그림, 옆면은 벽 속 회반죽. 셋 중 하나는 회반죽 덩어리
      for (const c of chips) {
        const h = c.s / 2
        const d = Math.max(3, Math.round(c.s * 0.28))
        ctx.save()
        ctx.translate(Math.round(c.x), Math.round(c.y))
        ctx.rotate(c.a)
        ctx.fillStyle = '#0b0a14'
        ctx.fillRect(-h - 2, -h - 2, c.s + d + 4, c.s + d + 4)
        ctx.fillStyle = c.plaster ? '#9d917a' : '#cfc3a6'
        ctx.fillRect(-h + d, -h + d, c.s, c.s)
        if (c.plaster) {
          ctx.fillStyle = '#efe4c8'
          ctx.fillRect(-h, -h, c.s, c.s)
        } else ctx.drawImage(wallC, c.sx, c.sy, c.s, c.s, -h, -h, c.s, c.s)
        ctx.fillStyle = 'rgba(255,255,255,0.4)'
        ctx.fillRect(-h, -h, c.s, 2)
        ctx.restore()
      }
      for (const q of parts) {
        ctx.globalAlpha = clamp(1 - q.age / q.life, 0, 1)
        ctx.fillStyle = q.c
        ctx.fillRect(Math.round(q.x), Math.round(q.y), q.s, q.s)
      }
      ctx.globalAlpha = 1
      // 퍽! 쾅! 글자
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      for (const w of words) {
        const k = (t - w.t) / (w.life || 0.62)
        if (k < 0 || k > 1) continue
        const pop = 1 + 0.7 * (1 - ease(k * 5))
        ctx.save()
        ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1
        ctx.translate(w.x, w.y - k * 24)
        ctx.rotate(w.rot)
        ctx.scale(pop, pop)
        ctx.font = `700 ${w.size}px "Galmuri11 Game", Galmuri11, sans-serif`
        ctx.lineWidth = Math.max(6, w.size / 6)
        ctx.strokeStyle = '#1b1622'
        ctx.strokeText(w.text, 3, 4)
        ctx.strokeText(w.text, 0, 0)
        ctx.fillStyle = '#1b1622'
        ctx.fillText(w.text, 3, 4)
        ctx.fillStyle = '#ffcf3a'
        ctx.fillText(w.text, 0, 0)
        ctx.restore()
      }
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,250,230,${flash * 0.85})`
        ctx.fillRect(0, 0, W, H)
      }
    }

    function drawLadder(t) {
      const u = Math.max(3, Math.round(S * 0.75))
      const top = MENU + ladder.y
      const len = ladder.len
      const sway = ladder.sway * Math.sin(t * 9)
      const half = 5 * u
      const xAt = (y) => Math.round(ladderX + (sway * (y - top)) / Math.max(1, len))
      // 걸이 고리
      ctx.fillStyle = '#1b1622'
      ctx.fillRect(ladderX - half - u * 2, top - u, u * 4, u * 2)
      ctx.fillRect(ladderX + half - u * 2, top - u, u * 4, u * 2)
      for (let y = top; y < top + len; y += u) {
        const x = xAt(y)
        for (const side of [-1, 1]) {
          const rx = x + side * half - u / 2
          ctx.fillStyle = '#1b1622'
          ctx.fillRect(rx - 1, y, u + 2, u)
          ctx.fillStyle = (Math.floor((y - top) / u) % 2) ? '#c98a3a' : '#e0a752'
          ctx.fillRect(rx, y, u, u)
        }
      }
      for (let y = top + 4 * u; y < top + len - u; y += 5 * u) {
        const x = xAt(y)
        ctx.fillStyle = '#1b1622'
        ctx.fillRect(x - half, y - 1, half * 2, Math.round(u * 1.4) + 2)
        ctx.fillStyle = '#ffcf3a'
        ctx.fillRect(x - half + u / 2, y, half * 2 - u, Math.round(u * 1.4))
        ctx.fillStyle = '#b8860b'
        ctx.fillRect(x - half + u / 2, y + Math.round(u * 1.4) - 2, half * 2 - u, 2)
      }
    }

    // 팔: 소매 몇 칸 + 주먹. k<0 이면 뒤로 당긴 자세
    function drawArm(f, front) {
      if (front !== f.k > 0) return
      const len = 11 * S * f.k
      const ex = f.sx + f.ux * len
      const ey = f.sy + f.uy * len
      const n = 5
      for (let i = 0; i <= n; i++) {
        const x = lerp(f.sx, ex, i / n)
        const y = lerp(f.sy, ey, i / n)
        const s = 3 * S
        ctx.fillStyle = '#1b1622'
        ctx.fillRect(Math.round(x - s / 2 - 1), Math.round(y - s / 2 - 1), s + 2, s + 2)
      }
      const top = ['#2f6fff', '#e8483f', '#ffb020', '#2fb36a', '#8a5cf6', '#ff6fae', '#f4f4f4', '#2b2f3a'][look.top] || '#2f6fff'
      for (let i = 0; i < n; i++) {
        const x = lerp(f.sx, ex, i / n)
        const y = lerp(f.sy, ey, i / n)
        const s = 3 * S - 2
        ctx.fillStyle = top
        ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s)
      }
      // 뻗는 순간 주먹 뒤로 잔상 줄
      if (f.smear) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        for (const o of [-1.4, 0, 1.4]) {
          const px = -f.uy * o * S
          const py = f.ux * o * S
          const len2 = 14 * S
          for (let i = 1; i <= 6; i++) {
            const x = ex - f.ux * (len2 * i) / 6 + px
            const y = ey - f.uy * (len2 * i) / 6 + py
            const w = Math.max(2, S * (1 - i / 7))
            ctx.fillRect(Math.round(x - w / 2), Math.round(y - w / 2), w, w)
          }
        }
      }
      const s = 4 * S
      ctx.fillStyle = '#1b1622'
      ctx.fillRect(Math.round(ex - s / 2 - 2), Math.round(ey - s / 2 - 2), s + 4, s + 4)
      ctx.fillStyle = f.hot ? '#ffffff' : ['#ffd9b8', '#f2c094', '#d99a6c', '#a86b43'][look.skin] || '#ffd9b8'
      ctx.fillRect(Math.round(ex - s / 2), Math.round(ey - s / 2), s, s)
      ctx.fillStyle = 'rgba(0,0,0,0.18)'
      ctx.fillRect(Math.round(ex - s / 2), Math.round(ey + s / 2 - S), s, S)
    }

    // 제목 픽셀 글자 애니메이션도 같은 루프에서
    let titleAt = 0
    const glyphLoop = () => {
      if (!alive) return
      if (fired.has('title') && !out) {
        if (!titleAt) {
          titleAt = performance.now()
          sizeGlyphs()
        }
        const age = (performance.now() - titleAt) / 1000
        if (age < 2) drawGlyphs(age)
      }
    }
    raf = requestAnimationFrame(frame)

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKey, true)
      restore()
      if (root) root.style.transform = ''
    }
  }, [reduce])

  return (
    <div
      className={`intro s-${stage} ${reduce ? 'reduce' : ''}`}
      onPointerDown={(e) => {
        e.stopPropagation()
        if (stage === 'play') skipRef.current()
      }}
      role="dialog"
      aria-label="간판 수리공 시작 화면"
    >
      <div ref={blackRef} className="intro-black" />
      <div className="intro-title" aria-hidden={stage === 'play'}>
        <div className="it-row">
          <span className="it-word sans">
            <b style={{ '--i': 0 }}>간</b>
            <b style={{ '--i': 1 }}>판</b>
            <small>SIGN</small>
          </span>
          <img className="it-hat" src={hat} alt="" draggable={false} />
          <span className="it-word px">
            {PX_WORD.map((ch, i) => (
              <canvas key={ch} ref={(el) => (glyphRefs.current[i] = el)} aria-label={ch} />
            ))}
            <small>REPAIRMAN</small>
          </span>
          <span className="it-badge">도감</span>
        </div>
        <div className="it-cap">
          <canvas ref={markRef} className="it-mark" />
          <p>
            꺼진 간판에 다시 불을 켜는
            <br />
            수리공 이야기
          </p>
        </div>
        <div className="it-menu" role="menu">
          {MENU.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="menuitem"
              className={i === sel ? 'on' : ''}
              style={{ '--i': i }}
              tabIndex={stage === 'title' ? 0 : -1}
              onPointerEnter={() => stage === 'title' && i !== sel && (setSel(i), sfx.tick())}
              onClick={() => stage === 'title' && start(i)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="it-press">↑↓ 고르기 · Enter 시작</p>
      </div>
      <canvas ref={cv} className="intro-cv" />
      {seen && stage === 'play' && <p className="it-skip">클릭하면 건너뛰기</p>}
    </div>
  )
}
