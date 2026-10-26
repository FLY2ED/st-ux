// 간판 거리 2D의 차와 사람. 좌표는 미터(x 동, y 북)
import { B } from '../../world/build.js'
import { CROWD } from '../../world/people.js'
import { GROUND_ID } from '../../world/textures.js'

const CAR_COLORS = ['#f4f4f2', '#22252c', '#9aa0a8', '#3a5f9a', '#9a3a3a', '#d8d2c4', '#5c6a4a']
const SPEED = { 원활: 10, 서행: 5.5, 정체: 2.2 }
const SHIRTS = ['#e8e8e8', '#2a2c33', '#3a5f9a', '#9a3a3a', '#d9c49a', '#5c7a4a', '#c86b9a', '#e0a040', '#6a6a72']
const PANTS = ['#2a2f3a', '#1c1c20', '#4a5568', '#7a6a58']
const HAIR = ['#1a1612', '#2b211a', '#4a3a2a', '#6b4a2f']

// 오른쪽 통행: 진행 방향 오른쪽으로 off 만큼 민 선
function offsetLine(pts, off) {
  return pts.map(([x, y], n) => {
    const a = pts[Math.max(0, n - 1)]
    const b = pts[Math.min(pts.length - 1, n + 1)]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [x + ((b[1] - a[1]) / len) * off, y - ((b[0] - a[0]) / len) * off]
  })
}

function laneOf(pts, name, width) {
  const cum = [0]
  for (let n = 1; n < pts.length; n++) cum.push(cum[n - 1] + Math.hypot(pts[n][0] - pts[n - 1][0], pts[n][1] - pts[n - 1][1]))
  return { pts, cum, len: cum[cum.length - 1], name, width }
}

function at(lane, s) {
  const { pts, cum } = lane
  let n = 1
  while (n < cum.length - 1 && cum[n] < s) n++
  const t = (s - cum[n - 1]) / (cum[n] - cum[n - 1] || 1)
  const [ax, ay] = pts[n - 1]
  const [bx, by] = pts[n]
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, ang: Math.atan2(by - ay, bx - ax) }
}

export function makeTraffic2D(world, grid, rand) {
  const edge = (grid.N / 2 - 2) * B
  const lanes = []
  for (const [kind, width, flat, name] of world.w) {
    if (kind !== 'road' || width < 6) continue
    const pts = []
    for (let p = 0; p + 1 < flat.length; p += 2) pts.push([flat[p], flat[p + 1]])
    const inside = pts.filter(([x, y]) => Math.abs(x) < edge && Math.abs(y) < edge)
    if (inside.length < 2) continue
    if (width < 8) {
      const lane = laneOf(rand() < 0.5 ? inside : [...inside].reverse(), name, width)
      if (lane.len > 25) lanes.push(lane)
      continue
    }
    for (const line of [inside, [...inside].reverse()]) {
      const lane = laneOf(offsetLine(line, width / 4), name, width)
      if (lane.len > 25) lanes.push(lane)
    }
  }
  let flows = new Map()
  let level = '원활'
  let zone = null
  const levelOf = (lane) => flows.get(lane.name) || level
  const cars = []
  const total = lanes.reduce((a, l) => a + l.len, 0)

  function want() {
    const per = { 원활: 1 / 70, 서행: 1 / 40, 정체: 1 / 22 }[level] || 1 / 60
    return Math.min(90, Math.round(total * per))
  }
  function spawn(fresh) {
    const lane = lanes[(rand() * lanes.length) | 0]
    if (!lane) return null
    const taxi = rand() < 0.16
    return { lane, s: fresh ? rand() * lane.len : 0, v: 0, color: taxi ? '#f2c230' : CAR_COLORS[(rand() * CAR_COLORS.length) | 0], taxi, bus: !taxi && lane.width >= 14 && rand() < 0.12, x: 0, y: 0, ang: 0, stuck: 0 }
  }

  // 사람이 앞을 막으면 멈춘다. 오래 막히면 true (경적)
  function update(dt, player) {
    while (cars.length < want() && lanes.length) cars.push(spawn(true))
    if (cars.length > want() + 4) cars.length = want()
    let honk = false
    for (let n = 0; n < cars.length; n++) {
      const c = cars[n]
      const target = SPEED[levelOf(c.lane)] * (c.bus ? 0.8 : 1)
      const ahead = at(c.lane, Math.min(c.lane.len, c.s + 3.5))
      const blocked = Math.hypot(ahead.x - player.x, ahead.y - player.y) < 2.4
      c.v += ((blocked ? 0 : target) - c.v) * Math.min(1, dt * (blocked ? 6 : 1.4))
      c.stuck = blocked ? c.stuck + dt : 0
      if (c.stuck > 1.2) {
        c.stuck = -3
        honk = true
      }
      c.s += c.v * dt
      if (c.s >= c.lane.len) cars[n] = spawn(false) || c
      const p = at(cars[n].lane, cars[n].s)
      cars[n].x = p.x
      cars[n].y = p.y
      cars[n].ang = p.ang
    }
    return honk
  }

  const visible = (c) => !zone || zone.some(([zx, zy, r]) => (c.x - zx) ** 2 + (c.y - zy) ** 2 < r * r)

  return {
    lanes,
    cars,
    update,
    visible,
    levelOf,
    setFlow(map, lv) {
      flows = map
      level = lv
    },
    setZone(z) {
      zone = z
    },
  }
}

export function makePeople2D(grid, rand) {
  const { N, half, height, ground } = grid
  const walkable = (x, y) => {
    const i = Math.floor(x / B + half)
    const k = Math.floor(-y / B + half)
    if (i < 1 || k < 1 || i >= N - 1 || k >= N - 1) return false
    const c = k * N + i
    const g = ground[c]
    return !height[c] && g !== GROUND_ID.road && g !== GROUND_ID.water && g !== GROUND_ID.rail
  }
  const people = []
  let crowd = 100
  let zone = null
  const inZone = (x, y) => !zone || zone.some(([zx, zy, r]) => (x - zx) ** 2 + (y - zy) ** 2 < r * r)
  const pick = (list) => list[(rand() * list.length) | 0]

  function spot(cx, cy, from, to) {
    for (let t = 0; t < 30; t++) {
      const a = rand() * Math.PI * 2
      const d = from + rand() * (to - from)
      const x = cx + Math.cos(a) * d
      const y = cy + Math.sin(a) * d
      if (walkable(x, y) && inZone(x, y)) return [x, y]
    }
    return null
  }
  function make(x, y) {
    return { x, y, dir: rand() * Math.PI * 2, v: 0.9 + rand() * 0.7, t: rand() * 4, step: 0, look: { shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIR), skin: '#f0c8a0', bag: rand() < 0.3 ? '#5a4632' : null } }
  }

  function update(dt, player) {
    const want = Math.round(crowd * 0.5)
    for (let tries = 0; people.length < want && tries < 6; tries++) {
      const p = spot(player.x, player.y, 6, 70)
      if (p) people.push(make(...p))
    }
    if (people.length > want + 6) people.length = want
    for (let n = people.length - 1; n >= 0; n--) {
      const p = people[n]
      if (Math.hypot(p.x - player.x, p.y - player.y) > 95 || !inZone(p.x, p.y)) {
        people.splice(n, 1)
        continue
      }
      p.t -= dt
      if (p.t <= 0) {
        p.t = 2 + rand() * 5
        p.dir += (rand() - 0.5) * 2
        p.stop = rand() < 0.15
      }
      if (p.stop) continue
      const nx = p.x + Math.cos(p.dir) * p.v * dt
      const ny = p.y + Math.sin(p.dir) * p.v * dt
      if (walkable(nx, ny) && Math.hypot(nx - player.x, ny - player.y) > 0.7) {
        p.x = nx
        p.y = ny
        p.step += dt * p.v * 3
      } else {
        p.dir += Math.PI * (0.5 + rand())
      }
    }
  }

  // 지하철 출구에서 사람이 쏟아져 나온다
  function burst(x, y, count) {
    for (let n = 0; n < count; n++) {
      const p = spot(x, y, 0.5, 6)
      if (p) people.push(make(...p))
    }
  }

  return {
    people,
    update,
    burst,
    setCrowd(level) {
      crowd = CROWD[level] || 100
    },
    setZone(z) {
      zone = z
      if (z) for (let n = people.length - 1; n >= 0; n--) if (!inZone(people[n].x, people[n].y)) people.splice(n, 1)
    },
  }
}
