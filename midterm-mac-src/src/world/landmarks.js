import * as THREE from 'three'
import { B, DIRS } from './build.js'

// 여기가 어디인지 알아보게 하는 것들: 지하철 출구·역 이름판·버스 정류장·도로명판·건물 이름·고가 철도
const ATLAS = 2048
const PAD = 2

// 글자판 그림을 아틀라스 여러 장에 줄줄이 채운다
class Atlas {
  constructor() {
    this.pages = []
    this.next()
  }
  next() {
    const canvas = document.createElement('canvas')
    canvas.width = ATLAS
    canvas.height = ATLAS
    this.page = { canvas, ctx: canvas.getContext('2d'), pos: [], uv: [], idx: [], owner: [] }
    this.pages.push(this.page)
    this.x = 0
    this.y = 0
    this.row = 0
  }
  add(w, h, draw) {
    if (this.x + w > ATLAS) {
      this.x = 0
      this.y += this.row + PAD
      this.row = 0
    }
    if (this.y + h > ATLAS) this.next()
    const { x, y } = this
    this.page.ctx.save()
    this.page.ctx.translate(x, y)
    draw(this.page.ctx, w, h)
    this.page.ctx.restore()
    this.x += w + PAD
    this.row = Math.max(this.row, h)
    return { page: this.page, uv: [x / ATLAS, 1 - (y + h) / ATLAS, (x + w) / ATLAS, 1 - y / ATLAS] }
  }
}

// 글자 크기를 줄여 가며 폭 안에 맞춘다
function fit(ctx, text, maxW, size, weight = '') {
  let s = size
  do ctx.font = `${weight} ${s}px Galmuri11`
  while (ctx.measureText(text).width > maxW && --s > 8)
  return s
}

const lineShort = (name) => name.match(/^(\d)호선/)?.[1] ?? name[0]

function lineDot(ctx, x, y, r, [name, color]) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  fit(ctx, lineShort(name), r * 1.5, Math.round(r * 1.3), 'bold')
  ctx.fillText(lineShort(name), x, y + 1)
}

// 서울 지하철 출구 표지: 노란 번호 칸 + 역 이름 + 노선 동그라미
function drawExit(station, ref, lines) {
  return (ctx, w, h) => {
    ctx.fillStyle = '#2b3038'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#ffd200'
    ctx.fillRect(6, 6, h - 12, h - 12)
    ctx.fillStyle = '#1d1d2b'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    fit(ctx, ref || '?', h - 20, 52, 'bold')
    ctx.fillText(ref || '?', h / 2, h / 2 + 2)
    const left = h + 4
    const dots = lines.length * 30
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'left'
    fit(ctx, `${station}역`, w - left - dots - 12, 40, 'bold')
    ctx.fillText(`${station}역`, left, h / 2 - 8)
    ctx.fillStyle = '#c9ced6'
    fit(ctx, 'EXIT', 80, 18)
    ctx.fillText(`${ref}번 출구 EXIT`, left, h / 2 + 26)
    lines.forEach((l, n) => lineDot(ctx, w - 18 - n * 30, h / 2, 13, l))
  }
}

// 역 이름판: 흰 바탕, 노선색 띠, 큰 한글 이름과 영문
function drawStation(name, en, lines) {
  return (ctx, w, h) => {
    ctx.fillStyle = '#f4f4f0'
    ctx.fillRect(0, 0, w, h)
    const band = h / Math.max(1, lines.length) / 6
    lines.forEach(([, color], n) => {
      ctx.fillStyle = color
      ctx.fillRect(0, h - 14 + n * band, w, band + 0.5)
    })
    if (!lines.length) {
      ctx.fillStyle = '#5a6b7c'
      ctx.fillRect(0, h - 14, w, 14)
    }
    lines.forEach((l, n) => lineDot(ctx, 34 + n * 50, h / 2 - 6, 21, l))
    const left = 20 + Math.max(1, lines.length) * 50
    ctx.fillStyle = '#1d1d2b'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    fit(ctx, name, w - left - 16, 56, 'bold')
    ctx.fillText(name, left, h / 2 - 18)
    ctx.fillStyle = '#4a4f58'
    fit(ctx, en, w - left - 16, 22)
    ctx.fillText(en, left, h / 2 + 22)
  }
}

// 도로명판: 파란 바탕에 흰 글씨
function drawRoad(name, en) {
  return (ctx, w, h) => {
    ctx.fillStyle = '#0f4fa8'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 3
    ctx.strokeRect(5, 5, w - 10, h - 10)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    fit(ctx, name, w - 28, 36, 'bold')
    ctx.fillText(name, w / 2, h / 2 - (en ? 10 : 0))
    if (en) {
      fit(ctx, en, w - 28, 16)
      ctx.fillText(en, w / 2, h / 2 + 22)
    }
  }
}

function drawBus(name) {
  return (ctx, w, h) => {
    ctx.fillStyle = '#123a6b'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#3cb44b'
    ctx.fillRect(6, 6, 58, h - 12)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    fit(ctx, 'BUS', 50, 22, 'bold')
    ctx.fillText('BUS', 35, h / 2 + 1)
    ctx.textAlign = 'left'
    fit(ctx, name, w - 84, 30)
    ctx.fillText(name, 74, h / 2 + 1)
  }
}

// 따릉이 대여소 표지: 초록 바탕에 자전거 수
function drawBike(name, count) {
  return (ctx, w, h) => {
    ctx.fillStyle = '#1f8a3c'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    fit(ctx, '따릉이', 90, 24, 'bold')
    ctx.fillText('따릉이', 10, h / 2 - 12)
    fit(ctx, name, w - 20, 18)
    ctx.fillText(name, 10, h / 2 + 14)
    ctx.textAlign = 'right'
    fit(ctx, `${count}대`, 80, 28, 'bold')
    ctx.fillText(`${count}대`, w - 10, h / 2 - 12)
  }
}

// 공사·사고 안내판: 주황 바탕 검은 글씨
function drawWork(type) {
  return (ctx, w, h) => {
    ctx.fillStyle = '#f28c1c'
    ctx.fillRect(0, 0, w, h)
    for (let x = -h; x < w; x += 24) {
      ctx.fillStyle = '#1d1d1d'
      ctx.beginPath()
      ctx.moveTo(x, h)
      ctx.lineTo(x + 12, h)
      ctx.lineTo(x + 12 + 10, h - 10)
      ctx.lineTo(x + 10, h - 10)
      ctx.fill()
    }
    ctx.fillStyle = '#1d1d1d'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    fit(ctx, `⚠ ${type}`, w - 16, 30, 'bold')
    ctx.fillText(`⚠ ${type}`, w / 2, h / 2 - 5)
  }
}

// 건물 이름은 벽에 바로 쓴 글자처럼 바탕 없이 테두리만
function drawName(name, w, h, dark) {
  return (ctx) => {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${h - 22}px Galmuri11`
    ctx.lineWidth = 8
    ctx.lineJoin = 'round'
    ctx.strokeStyle = dark ? '#f4f1e8' : '#1d2430'
    ctx.strokeText(name, w / 2, h / 2 + 2, w - 12)
    ctx.fillStyle = dark ? '#24456e' : '#ffffff'
    ctx.fillText(name, w / 2, h / 2 + 2, w - 12)
  }
}

export function buildLandmarks(world, grid) {
  const { N, half, height, owner, wall } = grid
  const atlas = new Atlas()
  const infos = []
  const boxes = new Map()
  const lines = world.ln || []
  const stations = world.st || []
  const cellAt = (x, y) => [Math.floor(x / B + half), Math.floor(-y / B + half)]
  const free = (x, y) => {
    const [i, k] = cellAt(x, y)
    return i >= 0 && k >= 0 && i < N && k < N && !height[k * N + i]
  }

  // 판 하나: 가운데(동·높이·북 미터), 바라보는 방향(동·북), 폭·높이
  function panel(tex, x, y, z, nx, ny, w, h, info, both = true) {
    const { page, uv } = tex
    const id = infos.push(info) - 1
    const sides = both ? [1, -1] : [1]
    for (const s of sides) {
      // 장면 좌표: x=동, z=-북. 앞면 법선 (nx, -ny)
      const fx = nx * s
      const fz = -ny * s
      const rx = fz
      const rz = -fx
      const cx = x + fx * 0.03
      const cz = -z + fz * 0.03
      const base = page.pos.length / 3
      const a = w / 2
      const b = h / 2
      page.pos.push(cx - rx * a, y - b, cz - rz * a, cx + rx * a, y - b, cz + rz * a, cx + rx * a, y + b, cz + rz * a, cx - rx * a, y + b, cz - rz * a)
      page.uv.push(uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3])
      page.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
      page.owner.push(id, id)
    }
  }

  // 상자 하나: 가운데, 길이 방향(동·북 단위 벡터), 크기(길이·높이·폭)
  function box(mat, x, y, z, [dx, dy], len, tall, wide) {
    if (!boxes.has(mat)) boxes.set(mat, [])
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, -z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dy, dx)),
      new THREE.Vector3(len, tall, wide),
    )
    boxes.get(mat).push(m)
  }

  // 가장 가까운 찻길과 그 방향
  const roads = world.w.filter((w) => w[0] === 'road')
  function nearestRoad(x, y) {
    let best = null
    for (const [, width, flat, name] of roads) {
      for (let p = 0; p + 3 < flat.length; p += 2) {
        const ax = flat[p]
        const ay = flat[p + 1]
        const dx = flat[p + 2] - ax
        const dy = flat[p + 3] - ay
        const len = Math.hypot(dx, dy) || 1
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len ** 2))
        const px = ax + t * dx
        const py = ay + t * dy
        const dist = Math.hypot(x - px, y - py)
        if (!best || dist < best.dist) best = { dist, dir: [dx / len, dy / len], at: [px, py], width, name }
      }
    }
    return best
  }

  // 찻길 위에 찍힌 점은 보도 쪽으로 밀어낸다
  function curb(x, y, road, extra) {
    if (!road) return [x, y, [0, 1]]
    let ox = x - road.at[0]
    let oy = y - road.at[1]
    const len = Math.hypot(ox, oy)
    if (len < 0.01) [ox, oy] = [-road.dir[1], road.dir[0]]
    else [ox, oy] = [ox / len, oy / len]
    const want = road.width / 2 + extra
    if (road.dist < want) return [road.at[0] + ox * want, road.at[1] + oy * want, [ox, oy]]
    return [x, y, [ox, oy]]
  }

  // 지하철 출구: 유리 지붕을 씌운 계단 입구
  const station = stations[0]
  for (const [ref, x0, y0, desc] of world.ex || []) {
    const road = nearestRoad(x0, y0)
    const [x, y] = curb(x0, y0, road, 2)
    let [dx, dy] = road ? road.dir : [1, 0]
    // 계단은 역 쪽으로 내려가고, 입구는 그 반대편
    if (station && (x - station[1]) * dx + (y - station[2]) * dy < 0) [dx, dy] = [-dx, -dy]
    const sx = -dy
    const sy = dx
    const name = (desc || station?.[0] || '').replace(/역$/, '') || '지하철'
    box('dark', x, 0.03, y, [dx, dy], 4.6, 0.06, 2.4)
    box('roofDark', x, 2.85, y, [dx, dy], 5, 0.16, 2.8)
    for (const s of [-1, 1]) box('glass', x + sx * s * 1.3, 1.4, y + sy * s * 1.3, [dx, dy], 4.8, 2.7, 0.08)
    box('glass', x - dx * 2.4, 1.4, y - dy * 2.4, [dx, dy], 0.08, 2.7, 2.6)
    for (const a of [-1, 1]) for (const s of [-1, 1]) box('metal', x + dx * a * 2.4 + sx * s * 1.3, 1.45, y + dy * a * 2.4 + sy * s * 1.3, [dx, dy], 0.14, 2.9, 0.14)
    const tex = atlas.add(320, 96, drawExit(name, ref, lines))
    panel(tex, x + dx * 2.5, 3.4, y + dy * 2.5, dx, dy, 2.8, 0.84, { kind: 'exit', title: `${name}역 ${ref ? `${ref}번 ` : ''}출구`, sub: lines.map((l) => l[0]).join(' · ') || '지하철' })
  }

  // 역 이름판: 두 기둥 위의 큰 판. 건물 안이면 가까운 빈 땅으로 옮긴다
  for (const [name, x0, y0, en] of stations) {
    let [x, y] = [x0, y0]
    for (let r = 0; r < 40 && !free(x, y); r += 2) {
      const a = r * 0.7
      ;[x, y] = [x0 + Math.cos(a) * r, y0 + Math.sin(a) * r]
    }
    const road = nearestRoad(x, y)
    const [dx, dy] = road ? road.dir : [1, 0]
    for (const s of [-1, 1]) box('metal', x + dx * s * 2.2, 2.6, y + dy * s * 2.2, [dx, dy], 0.22, 5.2, 0.22)
    const tex = atlas.add(448, 128, drawStation(name, en, lines))
    panel(tex, x, 4.7, y, -dy, dx, 5.6, 1.6, { kind: 'station', title: `${name}역`, sub: [en, ...lines.map((l) => l[0])].filter(Boolean).join(' · ') })
  }

  // 버스 정류장: 지붕·뒷유리·의자 + 정류장 이름판
  for (const [name, x0, y0] of world.bus || []) {
    const road = nearestRoad(x0, y0)
    const [x, y, [ox, oy]] = curb(x0, y0, road, 1.2)
    const [dx, dy] = road ? road.dir : [1, 0]
    box('roofDark', x, 2.5, y, [dx, dy], 3.8, 0.12, 1.5)
    box('glass', x + ox * 0.65, 1.25, y + oy * 0.65, [dx, dy], 3.6, 2.2, 0.06)
    box('metal', x + ox * 0.45, 0.24, y + oy * 0.45, [dx, dy], 2.4, 0.08, 0.45)
    for (const s of [-1, 1]) box('metal', x + dx * s * 1.75 + ox * 0.65, 1.25, y + dy * s * 1.75 + oy * 0.65, [dx, dy], 0.1, 2.5, 0.1)
    const tex = atlas.add(320, 56, drawBus(name))
    panel(tex, x - ox * 0.7, 2.86, y - oy * 0.7, -ox, -oy, 3.2, 0.56, { kind: 'bus', title: name, sub: '버스 정류장' })
  }

  // 따릉이 대여소: 거치대에 선 자전거 줄과 초록 표지
  for (const [name, x0, y0, count, rack] of world.bk || []) {
    const road = nearestRoad(x0, y0)
    const [x, y, [ox, oy]] = curb(x0, y0, road, 1.4)
    const [dx, dy] = road ? road.dir : [1, 0]
    const n = Math.min(8, Math.max(2, rack || 5))
    box('metal', x, 0.12, y, [dx, dy], n * 0.75 + 0.4, 0.24, 0.4)
    for (let b = 0; b < Math.min(n, count); b++) {
      const t = (b - (n - 1) / 2) * 0.75
      const bx = x + dx * t
      const by = y + dy * t
      box('bike', bx, 0.55, by, [ox, oy], 1.6, 0.08, 0.08)
      for (const s of [-0.6, 0.6]) box('tire', bx + ox * s, 0.36, by + oy * s, [ox, oy], 0.66, 0.66, 0.06)
      box('bike', bx - ox * 0.3, 0.85, by - oy * 0.3, [ox, oy], 0.1, 0.5, 0.08)
    }
    box('metal', x + dx * (n * 0.4 + 0.5), 1.2, y + dy * (n * 0.4 + 0.5), [dx, dy], 0.1, 2.4, 0.1)
    const tex = atlas.add(256, 80, drawBike(name, count))
    panel(tex, x + dx * (n * 0.4 + 0.5), 2.2, y + dy * (n * 0.4 + 0.5), ox, oy, 1.8, 0.56, { kind: 'bike', title: `따릉이 ${name}`, sub: `자전거 ${count}대 · 거치대 ${rack}개` })
  }

  // 공사·사고 자리: 고깔과 가림막
  for (const [type, info, x, y] of world.wk || []) {
    const road = nearestRoad(x, y)
    const [dx, dy] = road ? road.dir : [1, 0]
    for (let c = -2; c <= 2; c++) {
      const cxp = x + dx * c * 1.6
      const cyp = y + dy * c * 1.6
      box('cone', cxp, 0.35, cyp, [dx, dy], 0.4, 0.7, 0.4)
      box('stripe', cxp, 0.42, cyp, [dx, dy], 0.42, 0.12, 0.42)
    }
    box('stripe', x - dy * 1.2, 0.9, y + dx * 1.2, [dx, dy], 5, 0.5, 0.08)
    const tex = atlas.add(256, 72, drawWork(type))
    panel(tex, x - dy * 1.2, 1.6, y + dx * 1.2, -dy, dx, 2.4, 0.68, { kind: 'work', title: type, sub: info })
  }

  // 도로명판: 이름 있는 찻길을 따라 일정 간격으로, 걷는 방향에서 보이게 세운다
  const placedRoads = []
  for (const [, width, flat, name, en] of roads) {
    if (!name) continue
    let walked = 0
    let side = 1
    for (let p = 0; p + 3 < flat.length; p += 2) {
      const ax = flat[p]
      const ay = flat[p + 1]
      const len = Math.hypot(flat[p + 2] - ax, flat[p + 3] - ay)
      if (!len) continue
      const dx = (flat[p + 2] - ax) / len
      const dy = (flat[p + 3] - ay) / len
      for (let t = 0; t < len; t += 6) {
        if (walked + t < 18) continue
        const off = width / 2 + 1.3
        const x = ax + dx * t - dy * off * side
        const y = ay + dy * t + dx * off * side
        if (!free(x, y) || placedRoads.some(([n, px, py]) => n === name && Math.hypot(px - x, py - y) < 80)) continue
        if (placedRoads.length >= 60) break
        placedRoads.push([name, x, y])
        box('metal', x, 1.7, y, [dx, dy], 0.12, 3.4, 0.12)
        const tex = atlas.add(256, 80, drawRoad(name, en))
        // 판은 찻길 쪽으로 조금 내밀어 단다
        panel(tex, x + dy * 0.9 * side, 3.4, y - dx * 0.9 * side, dx, dy, 2.2, 0.69, { kind: 'road', title: name, sub: en || '도로' })
        side = -side
      }
      walked += len
    }
  }

  // 건물 이름: 가장 높은 층의 가장 긴 벽 위쪽에 큰 글씨로
  const cells = new Map()
  for (let c = 0; c < N * N; c++) {
    const o = owner[c]
    if (o && world.b[o - 1][1]) cells.has(o) ? cells.get(o).push(c) : cells.set(o, [c])
  }
  const h = (i, k) => (i < 0 || k < 0 || i >= N || k >= N ? 0 : height[k * N + i])
  for (const [o, list] of cells) {
    const name = world.b[o - 1][1]
    const top = Math.max(...list.map((c) => height[c]))
    if (top < 3) continue
    // 같은 방향·같은 줄에 이어진 벽 칸을 묶는다
    const runs = new Map()
    for (const c of list) {
      if (height[c] !== top) continue
      const i = c % N
      const k = (c - i) / N
      DIRS.forEach((d, di) => {
        const nh = h(i + d.di, k + d.dk)
        if (nh > top - 2) return
        const key = `${di}|${d.dk ? k : i}`
        if (!runs.has(key)) runs.set(key, [])
        runs.get(key).push({ along: d.dk ? i : k, i, k, nh })
      })
    }
    let best = null
    for (const [key, run] of runs) {
      run.sort((a, b) => a.along - b.along)
      let start = 0
      for (let n = 1; n <= run.length; n++) {
        if (n < run.length && run[n].along === run[n - 1].along + 1) continue
        const part = run.slice(start, n)
        if (!best || part.length > best.part.length) best = { part, d: DIRS[Number(key.split('|')[0])] }
        start = n
      }
    }
    if (!best || best.part.length < 2) continue
    const { part, d } = best
    const X = (v) => (v - half) * B
    const pts = part.flatMap(({ i, k }) => [[X(i + d.p[0]), X(k + d.p[1])], [X(i + d.q[0]), X(k + d.q[1])]])
    const sx = pts.reduce((s, p) => s + p[0], 0) / pts.length
    const sz = pts.reduce((s, p) => s + p[1], 0) / pts.length
    const room = part.length * B * 0.92
    const floorTop = Math.max(...part.map((p) => p.nh)) * B
    // 글자 크기는 건물 높이를 따라가되 벽 폭과 옆 건물 높이 안에서
    let ph = top >= 20 ? 3 : top >= 8 ? 2 : 1.1
    const probe = document.createElement('canvas').getContext('2d')
    probe.font = 'bold 42px Galmuri11'
    const aspect = (probe.measureText(name).width + 24) / 64
    let pw = ph * aspect
    if (pw > room) {
      pw = room
      ph = pw / aspect
    }
    ph = Math.min(ph, top * B - floorTop - 0.4)
    pw = ph * aspect
    if (ph < 0.7) continue
    const texW = Math.min(1024, Math.round(64 * aspect))
    const look = wall[part[0].k * N + part[0].i]
    const tex = atlas.add(texW, 64, drawName(name, texW, 64, look === 8 || look === 9 || look === 3))
    panel(tex, sx, top * B - ph / 2 - 0.25, -sz, d.n[0], -d.n[2], pw, ph, { kind: 'building', title: name, sub: '건물' }, false)
  }

  // 고가 철도: 기둥 위에 콘크리트 상판
  for (const [kind, , flat] of world.w) {
    if (kind !== 'viaduct') continue
    let walked = 0
    for (let p = 0; p + 3 < flat.length; p += 2) {
      const ax = flat[p]
      const ay = flat[p + 1]
      const len = Math.hypot(flat[p + 2] - ax, flat[p + 3] - ay)
      if (!len) continue
      const dir = [(flat[p + 2] - ax) / len, (flat[p + 3] - ay) / len]
      box('concrete', ax + (dir[0] * len) / 2, 7.4, ay + (dir[1] * len) / 2, dir, len + 0.4, 1, 7)
      for (const s of [-1, 1]) box('metal', ax + (dir[0] * len) / 2 - dir[1] * s * 0.9, 8.0, ay + (dir[1] * len) / 2 + dir[0] * s * 0.9, dir, len + 0.4, 0.2, 0.15)
      for (let t = (25 - (walked % 25)) % 25; t < len; t += 25) box('concrete', ax + dir[0] * t, 3.5, ay + dir[1] * t, dir, 1.4, 7, 2.4)
      walked += len
    }
  }

  // 메시로 묶는다
  const group = new THREE.Group()
  const MATS = {
    metal: new THREE.MeshLambertMaterial({ color: 0x5d636b }),
    roofDark: new THREE.MeshLambertMaterial({ color: 0x3a4048 }),
    dark: new THREE.MeshLambertMaterial({ color: 0x24262b }),
    glass: new THREE.MeshLambertMaterial({ color: 0xa9d2e8, transparent: true, opacity: 0.4 }),
    concrete: new THREE.MeshLambertMaterial({ color: 0xb7b2a6 }),
    bike: new THREE.MeshLambertMaterial({ color: 0x2fa84f }),
    tire: new THREE.MeshLambertMaterial({ color: 0x1a1a1a }),
    cone: new THREE.MeshLambertMaterial({ color: 0xff6a13 }),
    stripe: new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }),
  }
  const unit = new THREE.BoxGeometry(1, 1, 1)
  for (const [key, list] of boxes) {
    const inst = new THREE.InstancedMesh(unit, MATS[key], list.length)
    list.forEach((m, n) => inst.setMatrixAt(n, m))
    inst.computeBoundingSphere()
    group.add(inst)
  }
  const meshes = []
  for (const page of atlas.pages) {
    if (!page.pos.length) continue
    const tex = new THREE.CanvasTexture(page.canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(page.pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(page.uv, 2))
    g.setIndex(page.idx)
    g.computeBoundingSphere()
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5 }))
    mesh.userData.owner = page.owner
    meshes.push(mesh)
    group.add(mesh)
  }
  return { group, meshes, infos }
}

// 지금 선 자리를 사람 말로: "강남역 10번 출구 앞 · 강남대로"
export function describeSpot(world, x, y) {
  const parts = []
  let exit = null
  for (const e of world.ex || []) {
    const d = Math.hypot(e[1] - x, e[2] - y)
    if (d < 35 && (!exit || d < exit.d)) exit = { d, e }
  }
  const station = (world.st || []).map((s) => ({ s, d: Math.hypot(s[1] - x, s[2] - y) })).sort((a, b) => a.d - b.d)[0]
  if (exit) parts.push(`${(exit.e[3] || station?.s[0] || '').replace(/역$/, '')}역 ${exit.e[0] ? `${exit.e[0]}번 ` : ''}출구 앞`)
  else if (station && station.d < 200) parts.push(`${station.s[0]}역 ${Math.round(station.d / 10) * 10}m`)
  let road = null
  for (const [kind, width, flat, name] of world.w) {
    if (kind !== 'road' || !name) continue
    for (let p = 0; p + 3 < flat.length; p += 2) {
      const ax = flat[p]
      const ay = flat[p + 1]
      const dx = flat[p + 2] - ax
      const dy = flat[p + 3] - ay
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)))
      const d = Math.hypot(x - ax - t * dx, y - ay - t * dy) - width / 2
      if (d < 18 && (!road || d < road.d)) road = { d, name }
    }
  }
  if (road) parts.push(road.name)
  return parts.join(' · ')
}
