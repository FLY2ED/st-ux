import * as THREE from 'three'

// 찻길마다 오른쪽 차로를 만들고 블록 자동차를 굴린다.
// 속도와 차 간격은 서울 실시간 도로 소통(있으면) 또는 시간대 어림으로 정한다
const MAX_CARS = 240
const LEVELS = {
  원활: { density: 0.011, speed: 38 },
  서행: { density: 0.022, speed: 18 },
  정체: { density: 0.034, speed: 8 },
}
export const LEVEL_COLOR = { 원활: '#3cc04a', 서행: '#f0a020', 정체: '#e0352b' }

// 실시간 자료가 없을 때: 출퇴근 시간은 막히고 새벽은 뚫린다
export function guessLevel(date) {
  const h = date.getHours() + date.getMinutes() / 60
  const day = date.getDay()
  if (h < 6 || h >= 23) return '원활'
  if (day > 0 && day < 6 && ((h >= 7.5 && h < 9.5) || (h >= 17.5 && h < 20))) return '정체'
  if (h >= 11 && h < 21) return '서행'
  return '원활'
}

// 선 하나를 오른쪽으로 off 미터 밀어낸다
function offsetLine(pts, off) {
  const out = []
  for (let n = 0; n < pts.length; n++) {
    const a = pts[Math.max(0, n - 1)]
    const b = pts[Math.min(pts.length - 1, n + 1)]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    out.push([pts[n][0] + (dy / len) * off, pts[n][1] - (dx / len) * off])
  }
  return out
}

function laneOf(pts, name, width) {
  const cum = [0]
  for (let n = 1; n < pts.length; n++) cum.push(cum[n - 1] + Math.hypot(pts[n][0] - pts[n - 1][0], pts[n][1] - pts[n - 1][1]))
  return { pts, cum, len: cum[cum.length - 1], name, width, cars: [] }
}

// 차로 위 거리 s 의 위치와 방향
function pointAt(lane, s, hint) {
  const { pts, cum } = lane
  let n = Math.min(hint, cum.length - 2)
  while (n > 0 && cum[n] > s) n--
  while (n < cum.length - 2 && cum[n + 1] < s) n++
  const seg = cum[n + 1] - cum[n] || 1
  const t = (s - cum[n]) / seg
  const [ax, ay] = pts[n]
  const [bx, by] = pts[n + 1]
  return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, dx: (bx - ax) / seg, dy: (by - ay) / seg, n }
}

// 차종: 몸통 색, 크기, 부품(가운데 앞뒤·높이·옆, 크기)
const BUS_COLORS = ['#3b6fd8', '#4caf50', '#3b6fd8', '#d84a3b']
const CAR_COLORS = ['#f2f2f2', '#f2f2f2', '#1e1e22', '#1e1e22', '#9aa0a8', '#9aa0a8', '#2a4f8f', '#8f2a2a', '#d9d4c6']
const KINDS = {
  car: {
    body: [0, 0.75, 0, 4.4, 0.8, 1.8],
    glass: [-0.2, 1.4, 0, 2.3, 0.55, 1.6],
    wheels: [[1.35, 0.85], [-1.35, 0.85]],
    front: 2.2,
    side: 0.65,
    light: 0.8,
  },
  taxi: {
    body: [0, 0.75, 0, 4.6, 0.8, 1.8],
    glass: [-0.2, 1.4, 0, 2.4, 0.55, 1.6],
    roof: [-0.2, 1.8, 0, 0.5, 0.25, 0.9],
    wheels: [[1.4, 0.85], [-1.4, 0.85]],
    front: 2.3,
    side: 0.65,
    light: 0.8,
  },
  bus: {
    body: [0, 1.75, 0, 11, 2.8, 2.5],
    glass: [0.1, 2.25, 0, 10.4, 0.95, 2.52],
    wheels: [[3.8, 1.15], [-3.6, 1.15]],
    front: 5.5,
    side: 0.9,
    light: 0.75,
  },
}

export function makeTraffic(world, grid, rand) {
  const edge = (grid.N / 2 - 2) * 1.6
  const lanes = []
  for (const [kind, width, flat, name] of world.w) {
    if (kind !== 'road' || width < 6) continue
    const pts = []
    for (let p = 0; p + 1 < flat.length; p += 2) pts.push([flat[p], flat[p + 1]])
    // 지도 밖으로 나간 부분은 자른다
    const inside = pts.filter(([x, y]) => Math.abs(x) < edge && Math.abs(y) < edge)
    if (inside.length < 2) continue
    const per = width >= 18 ? 2 : 1
    if (width < 8) {
      const line = rand() < 0.5 ? inside : [...inside].reverse()
      const lane = laneOf(line, name, width)
      if (lane.len > 25) lanes.push(lane)
      continue
    }
    for (const line of [inside, [...inside].reverse()]) {
      for (let l = 0; l < per; l++) {
        const off = per === 1 ? width / 4 : width / 2 - (width / 4) * (l + 0.5)
        const lane = laneOf(offsetLine(line, off), name, width)
        if (lane.len > 25) lanes.push(lane)
      }
    }
  }

  const cars = []
  const unit = new THREE.BoxGeometry(1, 1, 1)
  const mats = {
    body: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    glass: new THREE.MeshLambertMaterial({ color: 0x26323e }),
    wheel: new THREE.MeshLambertMaterial({ color: 0x141414 }),
    roof: new THREE.MeshLambertMaterial({ color: 0xffe14d, emissive: 0x806a00 }),
    head: new THREE.MeshBasicMaterial({ color: 0xfff1c0 }),
    tail: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  }
  const per = { body: 1, glass: 1, wheel: 4, roof: 1, head: 2, tail: 2 }
  const meshes = {}
  const group = new THREE.Group()
  for (const key of Object.keys(mats)) {
    meshes[key] = new THREE.InstancedMesh(unit, mats[key], MAX_CARS * per[key])
    meshes[key].count = 0
    meshes[key].frustumCulled = false
    group.add(meshes[key])
  }

  let flows = new Map()
  let base = '서행'
  const levelOf = (lane) => flows.get(lane.name) || base
  const color = new THREE.Color()

  // 차로마다 밀도에 맞게 차를 다시 뿌린다
  function populate() {
    cars.length = 0
    for (const lane of lanes) lane.cars = []
    const want = lanes.map((lane) => Math.max(1, Math.round(lane.len * LEVELS[levelOf(lane)].density * (lane.width < 8 ? 0.4 : 1))))
    const total = want.reduce((a, b) => a + b, 0)
    const scale = Math.min(1, MAX_CARS / total)
    lanes.forEach((lane, li) => {
      const n = Math.max(rand() < scale ? 1 : 0, Math.floor(want[li] * scale))
      for (let c = 0; c < n && cars.length < MAX_CARS; c++) {
        const r = rand()
        const kind = lane.width >= 10 && r < 0.12 ? 'bus' : r < 0.32 ? 'taxi' : 'car'
        const paint = kind === 'bus' ? BUS_COLORS[(rand() * BUS_COLORS.length) | 0] : kind === 'taxi' ? (rand() < 0.2 ? '#2b2b30' : '#f08a1c') : CAR_COLORS[(rand() * CAR_COLORS.length) | 0]
        const car = { lane, s: (lane.len * (c + rand() * 0.6)) / n, v: 0, kind, color: paint, jitter: 0.85 + rand() * 0.3, hint: 0, blocked: 0 }
        lane.cars.push(car)
        cars.push(car)
      }
    })
    for (const lane of lanes) lane.cars.sort((a, b) => a.s - b.s)
    draw()
  }

  // 도로 이름별 실시간 소통 등급을 받는다. 없으면 시간대 어림
  function setFlow(byName, fallback) {
    flows = byName
    base = fallback
    populate()
  }

  const mCar = new THREE.Matrix4()
  const mPart = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()

  function put(key, n, cx, cy, cz, sx, sy, sz) {
    mPart.makeScale(sx, sy, sz).setPosition(cx, cy, cz)
    meshes[key].setMatrixAt(n, mPart.premultiply(mCar))
  }

  function draw() {
    const count = { body: 0, glass: 0, wheel: 0, roof: 0, head: 0, tail: 0 }
    for (const car of cars) {
      const p = pointAt(car.lane, car.s, car.hint)
      car.hint = p.n
      car.at = p
      const k = KINDS[car.kind]
      mCar.compose(pos.set(p.x, 0, -p.y), q.setFromAxisAngle(up, Math.atan2(p.dy, p.dx)), scl.set(1, 1, 1))
      const [bx, by, bz, bl, bh, bw] = k.body
      put('body', count.body, bx, by, bz, bl, bh, bw)
      meshes.body.setColorAt(count.body++, color.set(car.color))
      const [gx, gy, gz, gl, gh, gw] = k.glass
      put('glass', count.glass++, gx, gy, gz, gl, gh, gw)
      if (k.roof) put('roof', count.roof++, ...k.roof)
      for (const [wx, ws] of k.wheels) for (const s of [-1, 1]) put('wheel', count.wheel++, wx, 0.36, ws * s, 0.72, 0.72, 0.3)
      for (const s of [-1, 1]) {
        put('head', count.head++, k.front + 0.02, k.light, k.side * s, 0.06, 0.2, 0.4)
        put('tail', count.tail++, -bl / 2 - 0.02, k.light, k.side * s, 0.06, 0.18, 0.36)
      }
    }
    for (const key of Object.keys(meshes)) {
      meshes[key].count = count[key]
      meshes[key].instanceMatrix.needsUpdate = true
    }
    if (meshes.body.instanceColor) meshes.body.instanceColor.needsUpdate = true
  }

  // 앞차와 사람을 보고 속도를 맞춘다. 사람이 앞을 막으면 서서 경적을 울린다
  function update(dt, player) {
    let honk = false
    const px = player.x
    const py = -player.z
    for (const lane of lanes) {
      const list = lane.cars
      if (!list.length) continue
      const target = (LEVELS[levelOf(lane)].speed / 3.6) * (lane.width < 8 ? 0.6 : 1)
      for (let c = 0; c < list.length; c++) {
        const car = list[c]
        const ahead = list[(c + 1) % list.length]
        let gap = ahead === car ? Infinity : ahead.s - car.s
        if (gap < 0) gap += lane.len
        gap -= (KINDS[car.kind].body[3] + KINDS[ahead.kind].body[3]) / 2
        let want = target * car.jitter
        if (gap < 14) want = Math.min(want, Math.max(0, (gap - 2.5) * 0.9))
        // 사람이 차 앞 차로 위에 서 있으면 멈춘다
        const at = car.at
        if (at && player.y < 3) {
          const rx = px - at.x
          const ry = py - at.y
          const along = rx * at.dx + ry * at.dy
          const side = Math.abs(-rx * at.dy + ry * at.dx)
          const front = KINDS[car.kind].front
          if (along > 0 && along < front + 7 && side < 1.6) {
            want = 0
            car.blocked += dt
            if (car.blocked > 1.2 && car.blocked - dt <= 1.2) honk = true
          } else car.blocked = 0
        }
        const accel = want > car.v ? 3 : 8
        car.v += Math.max(-accel * dt, Math.min(accel * dt, want - car.v))
        car.s += car.v * dt
        if (car.s >= lane.len) car.s -= lane.len
      }
      list.sort((a, b) => a.s - b.s)
    }
    draw()
    return honk
  }

  function dispose() {
    unit.dispose()
    for (const m of Object.values(mats)) m.dispose()
    for (const m of Object.values(meshes)) m.dispose()
  }

  return { group, lanes, update, setFlow, levelOf, dispose, count: () => cars.length }
}

// 실시간 도로 목록을 도로 이름 → 등급 지도로 줄인다
export function flowsFromCity(city) {
  const byName = new Map()
  const score = { 원활: 0, 서행: 1, 정체: 2 }
  const acc = new Map()
  for (const [name, , idx] of city?.roads || []) {
    if (!(idx in score)) continue
    const a = acc.get(name) || []
    a.push(score[idx])
    acc.set(name, a)
  }
  for (const [name, list] of acc) byName.set(name, ['원활', '서행', '정체'][Math.round(list.reduce((s, v) => s + v, 0) / list.length)])
  return byName
}
