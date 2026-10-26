// 같은 동네 사람들 함께 걷기: 동네 방(st-arcade Worker 의 Town)에 웹소켓으로 붙어 서로의 위치를 주고받는다.
// 좌표는 미터로 받고, 선에서는 정수 데시미터로 보낸다. 브라우저 밖(Node 22)에서도 돌도록 window 는 있을 때만 쓴다
const ENV = import.meta.env || {}
const SEND_GAP = 200 // 최대 5Hz
const PING_GAP = 25_000
const DEAD = 70_000 // 이만큼 아무것도 못 받으면 끊고 다시 붙는다
const HIDDEN_CLOSE = 60_000 // 탭이 이만큼 숨겨져 있으면 방에서 나간다
const BACKOFF_MAX = 30_000
const SNAP = 30 // 이보다 멀리 뛰면 보간하지 않고 바로 옮긴다(미터)
const FOLLOW = 12 // 보간 속도(1/초)
const LEAD = 0.25 // 예측은 최대 이만큼(초)만

// 서버 주소: VITE_TOWN_URL > 개발 서버면 같은 호스트의 로컬 워커(8796) > 배포 워커
export function townBase() {
  if (ENV.VITE_TOWN_URL) return ENV.VITE_TOWN_URL.replace(/\/$/, '')
  if (ENV.DEV && typeof location !== 'undefined') return `ws://${location.hostname}:8796`
  return 'wss://st-arcade.naldadev.com'
}

function savedToken() {
  try {
    return JSON.parse(localStorage.getItem('gp-player'))?.token || null
  } catch {
    return null
  }
}

const dm = (v) => Math.round(v * 10)

// joinTown({ town, look, url?, token?, onEvent? }) → { send, others, step, visible, setLook, leave, me, status }
// name 은 서버가 정한다(로그인 닉네임, 없으면 손님번호). 넘긴 name 은 내 이름이 오기 전까지만 쓴다
export function joinTown({ town, name = '', look = {}, url, token, onEvent } = {}) {
  const base = (url || townBase()).replace(/\/$/, '')
  const target = `${base}/town/${encodeURIComponent(town)}`
  const tok = token === undefined ? savedToken() : token
  const people = new Map()
  const me = { id: 0, name }
  const pos = { x: 0, y: 0, d: 0, m: 0, has: false }
  const sent = { x: NaN, y: NaN, d: -1, m: -1, at: 0 }
  let ws = null
  let status = 'connecting'
  let tries = 0
  let gone = false
  let lastRecv = 0
  let sendTimer = 0
  let retryTimer = 0
  let hideTimer = 0
  let hidden = false
  const pinger = setInterval(() => {
    if (!ws || ws.readyState !== 1) return
    if (Date.now() - lastRecv > DEAD) return ws.close()
    ws.send('ping')
  }, PING_GAP)

  const emit = (type, data) => onEvent?.(type, data)

  function upsert(id, name, look, x, y, d, m) {
    let p = people.get(id)
    if (!p) {
      p = { id, name, look, x: 0, y: 0, d: 0, m: 0, tx: 0, ty: 0, vx: 0, vy: 0, t: 0, hidden: true }
      people.set(id, p)
      emit('join', p)
    } else {
      p.name = name
      p.look = look
      emit('look', p)
    }
    if (x !== undefined) place(p, x, y, d, m, true)
    return p
  }

  // 새 목표 자리. 직전 목표와의 차이로 속도를 어림해 둔다(예측용)
  function place(p, x, y, d, m, snap = false) {
    const nx = x / 10
    const ny = y / 10
    const now = Date.now()
    const gap = (now - p.t) / 1000
    if (snap || p.hidden || Math.hypot(nx - p.x, ny - p.y) > SNAP) {
      p.x = nx
      p.y = ny
      p.vx = p.vy = 0
    } else if (gap > 0.05 && gap < 1) {
      // 틱 간격이 들쭉날쭉해서 속도는 반씩 섞어 흔들림을 줄인다
      p.vx = (p.vx + (nx - p.tx) / gap) / 2
      p.vy = (p.vy + (ny - p.ty) / gap) / 2
    } else {
      p.vx = p.vy = 0
    }
    p.tx = nx
    p.ty = ny
    p.d = d
    p.m = m
    p.t = now
    p.hidden = false
  }

  function onMessage(ev) {
    lastRecv = Date.now()
    if (ev.data === 'pong') return
    let msg
    try {
      msg = JSON.parse(ev.data)
    } catch {
      return
    }
    if (msg.t === 's') {
      for (const [id, x, y, d, m] of msg.u) {
        if (id === me.id) continue
        const p = people.get(id)
        if (p) place(p, x, y, d, m)
      }
      if (msg.h) for (const id of msg.h) if (people.has(id)) people.get(id).hidden = true
    } else if (msg.t === 'j') {
      if (msg.id !== me.id) upsert(msg.id, msg.name, msg.look, msg.x, msg.y, msg.d, 0)
    } else if (msg.t === 'l') {
      const p = people.get(msg.id)
      if (p) {
        people.delete(msg.id)
        emit('leave', p)
      }
    } else if (msg.t === 'me') {
      me.id = msg.id
      me.name = msg.name
      tries = 0
      status = 'open'
      emit('me', me)
      flushSend()
    } else if (msg.t === 'all') {
      // 다시 붙었을 때 사라진 사람을 정리하고 지금 방 사람으로 맞춘다
      const now = new Set()
      for (const [id, name, look, x, y, d, m] of msg.u) {
        now.add(id)
        upsert(id, name, look, x, y, d, m)
      }
      for (const [id, p] of people) if (!now.has(id)) people.delete(id), emit('leave', p)
    }
  }

  function connect() {
    if (gone || hidden) return
    status = 'connecting'
    let sock
    try {
      sock = new WebSocket(target)
    } catch {
      return retry()
    }
    ws = sock
    sock.onopen = () => {
      lastRecv = Date.now()
      sent.x = NaN
      const hi = { t: 'hi', look }
      if (tok) hi.token = tok
      if (pos.has) Object.assign(hi, { x: dm(pos.x), y: dm(pos.y), d: pos.d })
      sock.send(JSON.stringify(hi))
      if (pos.has) Object.assign(sent, { x: dm(pos.x), y: dm(pos.y), d: pos.d, m: 0, at: 0 })
    }
    sock.onmessage = onMessage
    sock.onclose = () => {
      if (ws !== sock) return
      ws = null
      status = 'closed'
      me.id = 0
      retry()
    }
    sock.onerror = () => {}
  }

  // 1s, 2s, 4s … 최대 30s. 여럿이 한꺼번에 다시 붙지 않게 조금씩 흔든다
  function retry() {
    if (gone || hidden || retryTimer) return
    const wait = Math.min(BACKOFF_MAX, 1000 * 2 ** tries++) * (0.75 + Math.random() * 0.5)
    retryTimer = setTimeout(() => {
      retryTimer = 0
      connect()
    }, wait)
  }

  function flushSend() {
    sendTimer = 0
    if (!ws || ws.readyState !== 1 || !me.id || hidden) return
    const x = dm(pos.x)
    const y = dm(pos.y)
    if (x === sent.x && y === sent.y && pos.d === sent.d && pos.m === sent.m) return
    const wait = SEND_GAP - (Date.now() - sent.at)
    if (wait > 0) {
      sendTimer = setTimeout(flushSend, wait)
      return
    }
    ws.send(JSON.stringify({ t: 'p', x, y, d: pos.d, m: pos.m }))
    Object.assign(sent, { x, y, d: pos.d, m: pos.m, at: Date.now() })
  }

  // 탭이 숨겨지면 보내기를 멈추고, 오래 숨겨지면 방에서 나간다. 돌아오면 다시 붙는다
  function onVisibility() {
    if (document.hidden) {
      hideTimer = setTimeout(() => {
        hidden = true
        clearTimeout(retryTimer)
        retryTimer = 0
        const s = ws
        ws = null
        s?.close(1000)
        status = 'closed'
        me.id = 0
        people.clear()
      }, HIDDEN_CLOSE)
    } else {
      clearTimeout(hideTimer)
      if (hidden) {
        hidden = false
        tries = 0
        connect()
      } else flushSend()
    }
  }
  const doc = typeof document !== 'undefined' ? document : null
  doc?.addEventListener('visibilitychange', onVisibility)

  connect()

  return {
    get me() {
      return me
    },
    get status() {
      return status
    },
    // 내 위치(미터). 바뀐 경우에만, 최대 5Hz 로 보낸다
    send(x, y, dir = 0, moving = false) {
      pos.x = x
      pos.y = y
      pos.d = dir & 3
      pos.m = moving ? 1 : 0
      pos.has = true
      if (!sendTimer && !doc?.hidden) flushSend()
    },
    others: () => people,
    // 매 프레임 부른다: 목표 자리 + 짧은 예측 쪽으로 부드럽게 따라간다
    step(dt) {
      const k = 1 - Math.exp(-FOLLOW * dt)
      const now = Date.now()
      for (const p of people.values()) {
        if (p.hidden) continue
        const ahead = p.m ? Math.min(LEAD, (now - p.t) / 1000) : 0
        const gx = p.tx + p.vx * ahead
        const gy = p.ty + p.vy * ahead
        p.x += (gx - p.x) * k
        p.y += (gy - p.y) * k
      }
    },
    // 카메라 사각형(미터, { x0, y0, x1, y1 }) 안팎 margin 까지의 사람만
    visible(rect, margin = 2) {
      const x0 = Math.min(rect.x0, rect.x1) - margin
      const x1 = Math.max(rect.x0, rect.x1) + margin
      const y0 = Math.min(rect.y0, rect.y1) - margin
      const y1 = Math.max(rect.y0, rect.y1) + margin
      const out = []
      for (const p of people.values()) if (!p.hidden && p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) out.push(p)
      return out
    },
    setLook(next) {
      look = next
      if (ws?.readyState === 1 && me.id) ws.send(JSON.stringify({ t: 'k', look }))
    },
    leave() {
      gone = true
      clearInterval(pinger)
      clearTimeout(sendTimer)
      clearTimeout(retryTimer)
      clearTimeout(hideTimer)
      doc?.removeEventListener('visibilitychange', onVisibility)
      const s = ws
      ws = null
      s?.close(1000)
      people.clear()
      status = 'closed'
    },
  }
}
