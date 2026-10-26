// 같은 동네 사람들 함께 걷기: 동네(방) 하나 = Durable Object 하나.
// 웹소켓은 Hibernation API 로 받아서, 아무도 움직이지 않으면 객체가 잠들어 비용이 들지 않는다.
// 받은 위치는 모아 두었다가 틱(TICK)마다 바뀐 사람만 한 번에 보낸다
import { who } from './handlers.js'

const TICK = 200 // 5Hz
const CAP = 50 // 이보다 많으면 사람마다 가까운 NEAR 명만 보낸다
const NEAR = 30
const ROOM_MAX = 200
const MSG_MAX = 512
const RATE = 10 // 초당 메시지
const BURST = 20
const STRIKES = 60 // 한도를 이만큼 넘기면 끊는다
const LIM = 1_000_000 // 좌표 한계(데시미터, ±100km)
const LOOK_MAX = 200

const LOOK_INT = new Set(['skin', 'hair', 'top', 'bottom'])
const LOOK_WORD = new Set(['hairStyle', 'hat', 'extra'])

// look 은 아는 칸만, 짧은 값만 받아 200바이트 안으로 자른다
export function cleanLook(look) {
  const out = {}
  if (!look || typeof look !== 'object' || Array.isArray(look)) return out
  let size = 2
  for (const [k, v] of Object.entries(look).slice(0, 16)) {
    let ok = false
    if (LOOK_INT.has(k)) ok = Number.isInteger(v) && v >= 0 && v < 32
    else if (LOOK_WORD.has(k)) ok = typeof v === 'string' && /^[a-z]{1,12}$/i.test(v)
    else if (k === 'hatColor') ok = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
    else if (/^[a-z]{1,12}$/i.test(k)) ok = (Number.isInteger(v) && Math.abs(v) < 1000) || (typeof v === 'string' && /^[#\w-]{0,16}$/.test(v))
    if (!ok) continue
    const add = JSON.stringify(k).length + JSON.stringify(v).length + 2
    if (size + add > LOOK_MAX) break
    out[k] = v
    size += add
  }
  return out
}

const coord = (v) => Number.isInteger(v) && v >= -LIM && v <= LIM
const send = (ws, text) => {
  try {
    ws.send(text)
  } catch {
    // 이미 닫힌 소켓
  }
}
const row = (u) => [u.id, u.x, u.y, u.d, u.m]
const pub = (u) => ({ id: u.id, name: u.name, look: u.look, x: u.x, y: u.y, d: u.d, m: u.m })

export class Town {
  constructor(state, env) {
    this.state = state
    this.env = env
    this.users = new Map() // ws → 사람
    this.dirty = new Set()
    this.bucket = new WeakMap()
    this.waiting = new WeakSet() // 이름을 찾는 중
    this.timer = 0
    this.next = 1
    // 잠에서 깨면 소켓에 붙여 둔 정보로 방을 다시 꾸린다
    for (const ws of state.getWebSockets()) {
      const u = ws.deserializeAttachment()
      if (!u?.id) continue
      this.users.set(ws, { ...u, near: null })
      this.next = Math.max(this.next, u.id + 1)
    }
    // 연결 유지용 ping 은 객체를 깨우지 않고 런타임이 바로 답한다
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 })
    if (this.state.getWebSockets().length >= ROOM_MAX + 20) return new Response('full', { status: 503 })
    const [client, server] = Object.values(new WebSocketPair())
    this.state.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  // 초당 RATE 개, 한 번에 BURST 개까지. 넘친 메시지는 버리고, 계속 넘치면 끊는다
  allow(ws) {
    const now = Date.now()
    let b = this.bucket.get(ws)
    if (!b) this.bucket.set(ws, (b = { tok: BURST, at: now, bad: 0 }))
    b.tok = Math.min(BURST, b.tok + ((now - b.at) / 1000) * RATE)
    b.at = now
    if (b.tok >= 1) {
      b.tok -= 1
      return true
    }
    if (++b.bad > STRIKES) this.kick(ws, 1008, 'too many')
    return false
  }

  kick(ws, code, why) {
    try {
      ws.close(code, why)
    } catch {
      // 이미 닫힘
    }
    this.drop(ws)
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MSG_MAX) return this.kick(ws, 1009, 'too big')
    if (!this.allow(ws)) return
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    const u = this.users.get(ws)
    if (msg.t === 'p') {
      if (!u) return
      const { x, y, d } = msg
      if (!coord(x) || !coord(y) || !Number.isInteger(d) || d < 0 || d > 3) return
      const m = msg.m ? 1 : 0
      if (x === u.x && y === u.y && d === u.d && m === u.m) return
      Object.assign(u, { x, y, d, m })
      this.dirty.add(ws)
      this.schedule()
    } else if (msg.t === 'hi') {
      if (u || this.waiting.has(ws)) return
      await this.join(ws, msg)
    } else if (msg.t === 'k') {
      if (!u) return
      u.look = cleanLook(msg.look)
      ws.serializeAttachment(pub(u))
      this.broadcast(JSON.stringify({ t: 'j', id: u.id, name: u.name, look: u.look }), ws)
    }
  }

  async join(ws, msg) {
    if (this.users.size >= ROOM_MAX) return this.kick(ws, 1013, 'full')
    this.waiting.add(ws)
    // 로그인 닉네임이 있으면 그 이름, 없으면 손님 번호. 클라이언트가 보낸 이름은 믿지 않는다
    let name = null
    if (typeof msg.token === 'string' && msg.token.length <= 100 && this.env.DB) {
      try {
        name = (await who(this.env, msg.token))?.name || null
      } catch {
        name = null
      }
    }
    this.waiting.delete(ws)
    if (ws.readyState !== undefined && ws.readyState !== 1) return
    const u = {
      id: this.next++,
      name: name || `손님${1000 + Math.floor(Math.random() * 9000)}`,
      look: cleanLook(msg.look),
      x: coord(msg.x) ? msg.x : 0,
      y: coord(msg.y) ? msg.y : 0,
      d: Number.isInteger(msg.d) && msg.d >= 0 && msg.d <= 3 ? msg.d : 0,
      m: 0,
      near: null,
    }
    this.users.set(ws, u)
    ws.serializeAttachment(pub(u))
    const all = []
    for (const o of this.users.values()) if (o !== u) all.push([o.id, o.name, o.look, o.x, o.y, o.d, o.m])
    send(ws, JSON.stringify({ t: 'me', id: u.id, name: u.name }))
    send(ws, JSON.stringify({ t: 'all', u: all }))
    // 사람이 많을 때는 위치를 빼고 알린다: 가까운 사람에게만 다음 틱에 위치가 간다
    const j = { t: 'j', id: u.id, name: u.name, look: u.look }
    if (this.users.size <= CAP) Object.assign(j, { x: u.x, y: u.y, d: u.d })
    this.broadcast(JSON.stringify(j), ws)
    if (this.users.size > CAP) {
      this.dirty.add(ws)
      this.schedule()
    }
  }

  webSocketClose(ws, code) {
    this.drop(ws)
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye')
    } catch {
      // 이미 닫힘
    }
  }

  webSocketError(ws) {
    this.drop(ws)
  }

  drop(ws) {
    const u = this.users.get(ws)
    if (!u) return
    this.users.delete(ws)
    this.dirty.delete(ws)
    this.broadcast(JSON.stringify({ t: 'l', id: u.id }), ws)
  }

  broadcast(text, skip) {
    for (const ws of this.users.keys()) if (ws !== skip) send(ws, text)
  }

  schedule() {
    if (!this.timer) this.timer = setTimeout(() => this.flush(), TICK)
  }

  flush() {
    this.timer = 0
    if (!this.dirty.size) return
    const moved = []
    for (const ws of this.dirty) {
      const u = this.users.get(ws)
      if (!u) continue
      moved.push(u)
      // 잠들었다 깨도 마지막 자리를 기억하도록 틱마다 한 번만 적는다
      ws.serializeAttachment(pub(u))
    }
    this.dirty.clear()
    const was = new Set(moved)
    const list = [...this.users.values()]
    const n = list.length
    let shared = null
    for (const [ws, me] of this.users) {
      if (n <= CAP) {
        if (me.near === null) {
          shared ??= JSON.stringify({ t: 's', u: moved.map(row) })
          send(ws, shared)
          continue
        }
        // 상한이 풀렸다: 가려 두었던 사람 위치를 다시 채운다
        const u = []
        for (const o of list) if (o !== me && (was.has(o) || !me.near.has(o.id))) u.push(row(o))
        me.near = null
        send(ws, JSON.stringify({ t: 's', u }))
        continue
      }
      // 사람이 많을 때: 나에게서 가까운 NEAR 명만 위치를 받는다
      const near = list
        .filter((o) => o !== me)
        .map((o) => [(o.x - me.x) ** 2 + (o.y - me.y) ** 2, o])
        .sort((a, b) => a[0] - b[0])
        .slice(0, NEAR)
        .map((e) => e[1])
      const ids = new Set(near.map((o) => o.id))
      const u = []
      for (const o of near) if (was.has(o) || !me.near?.has(o.id)) u.push(row(o))
      const h = []
      if (me.near) {
        for (const id of me.near) if (!ids.has(id)) h.push(id)
      } else for (const o of list) if (o !== me && !ids.has(o.id)) h.push(o.id)
      me.near = ids
      if (u.length || h.length) send(ws, JSON.stringify(h.length ? { t: 's', u, h } : { t: 's', u }))
    }
  }
}

// /town/<동네> 로 온 웹소켓을 그 동네 방으로 넘긴다
export function townRoute(request, env, url, origins) {
  if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 })
  const origin = request.headers.get('Origin')
  if (origin && !origins.includes(origin) && env.TOWN_ANY_ORIGIN !== '1') return new Response('forbidden', { status: 403 })
  let room
  try {
    room = decodeURIComponent(url.pathname.slice(6))
  } catch {
    room = ''
  }
  if (!/^[\w:.-]{1,48}$/.test(room)) return new Response('bad town', { status: 400 })
  return env.TOWN.get(env.TOWN.idFromName(room)).fetch(request)
}
