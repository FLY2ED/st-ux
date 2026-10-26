// 간판 오락실 서버: 닉네임, 게임별 최고 점수, 서버가 뽑는 간판 복권, 지도에 꽂는 내 가게.
// Worker(D1)와 개발 서버(Node SQLite)가 이 파일 하나를 같이 쓴다. env = { DB, data(name), now() }
import { streetFound, streetNote, streetRead } from './street.js'

// 게임마다 한 판에 나올 수 있는 점수 상한. 넘으면 받지 않는다
export const GAMES = {
  rain: { title: '간판 산성비', max: 2_000_000 },
  dodge: { title: '점심 간판 피하기', max: 200_000 },
  song: { title: '간판 노래방', max: 2_000_000 },
  guess: { title: '간판 어디게', max: 25_000 },
  more: { title: '더 많을까?', max: 10_000 },
  type: { title: '간판 타자왕', max: 12_000 },
}

const NAME = /^[가-힣A-Za-z0-9_]{2,10}$/
const BANNED = /시발|씨발|ㅅㅂ|병신|좆|존나|섹스|fuck|shit|admin|운영자|관리자/i
const PASS_MIN = 4
const PASS_MAX = 32
const FAIL_LIMIT = 5
const FAIL_LOCK = 10 * 60_000
const SHOP_NAME = /^[가-힣A-Za-z0-9]{2,12}$/
const TICKETS_PER_DAY = 5
const SHOPS_PER_PLAYER = 3
const KOREA = { w: 124.5, e: 131, s: 33, n: 38.7 }

const ok = (body, status = 200) => ({ status, body })
const fail = (status, error) => ({ status, body: { error } })

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// 암호는 소금을 친 PBKDF2(10만 번)로만 남긴다. Workers 의 PBKDF2 반복 상한이 10만이다
async function passHash(pass, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100_000 }, key, 256)
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function sameHex(a, b) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

function passError(pass) {
  if (typeof pass !== 'string' || pass.length < PASS_MIN || pass.length > PASS_MAX) return `암호는 ${PASS_MIN}~${PASS_MAX}자로 정해 주세요`
  return ''
}

async function newPass(pass) {
  const salt = crypto.randomUUID()
  return { salt, hash: await passHash(pass, salt) }
}

// 한국 날짜(YYYY-MM-DD)와 복권 회차. 2026년 1월 1일이 1회
function kstDay(now) {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10)
}
function roundOf(day) {
  return Math.round((Date.parse(day) - Date.parse('2026-01-01')) / 86_400_000) + 1
}

export async function who(env, token) {
  if (!token) return null
  const h = await sha256(token)
  return env.DB.prepare(
    `SELECT id, name, pass_hash IS NOT NULL AS pass FROM players WHERE token_hash = ?
     UNION ALL SELECT p.id, p.name, p.pass_hash IS NOT NULL FROM sessions s JOIN players p ON p.id = s.player WHERE s.token_hash = ? LIMIT 1`,
  )
    .bind(h, h)
    .first()
}

export async function arcade(req, env) {
  const { method, path } = req
  const now = env.now()
  // 간판 거리 읽기는 누구에게나 같은 답이라 내가 누구인지 묻지 않는다(D1 읽기 한 번 아낌)
  if (method === 'GET' && path === '/street') return streetRead(env, req.query, now)
  const me = await who(env, req.token)
  if (method === 'POST' && path === '/street') return streetFound(env, me, req.body, now)
  if (method === 'POST' && path === '/street/note') return streetNote(env, me, req.body, now)

  if (method === 'GET' && path === '/where') {
    const cf = req.cf || {}
    if (!cf.latitude) return ok({ approx: null })
    return ok({ approx: { lat: +cf.latitude, lng: +cf.longitude, city: cf.city || cf.region || '' } })
  }

  if (method === 'GET' && path === '/me') return me ? ok({ ...me, pass: !!me.pass }) : fail(401, '등록이 필요해요')

  if (method === 'POST' && path === '/player') {
    const name = String(req.body?.name || '').trim()
    if (!NAME.test(name)) return fail(400, '한글·영문·숫자 2~10자로 지어 주세요')
    if (BANNED.test(name)) return fail(400, '다른 이름으로 지어 주세요')
    const taken = await env.DB.prepare('SELECT 1 FROM players WHERE name = ? COLLATE NOCASE').bind(name).first()
    if (taken) return fail(409, '이미 누가 쓰는 이름이에요')
    const bad = passError(req.body?.pass)
    if (bad) return fail(400, bad)
    const id = crypto.randomUUID()
    const token = crypto.randomUUID() + crypto.randomUUID()
    const { salt, hash } = await newPass(req.body.pass)
    await env.DB.prepare('INSERT INTO players (id, name, token_hash, created, pass_hash, pass_salt) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, name, await sha256(token), now, hash, salt)
      .run()
    return ok({ id, name, token, pass: true }, 201)
  }

  // 있던 이름에 암호로 들어오기: 이 기기에 새 출입증을 준다(처음 기기의 출입증도 그대로 쓸 수 있다)
  if (method === 'POST' && path === '/login') {
    const name = String(req.body?.name || '').trim()
    const pass = req.body?.pass
    const row = NAME.test(name) ? await env.DB.prepare('SELECT id, name, pass_hash, pass_salt FROM players WHERE name = ? COLLATE NOCASE').bind(name).first() : null
    if (!row) return fail(404, '없는 이름이에요')
    if (!row.pass_hash) return fail(403, '이 이름은 암호를 안 정해서 처음 만든 기기에서만 쓸 수 있어요')
    const lock = await env.DB.prepare('SELECT n, until FROM login_fails WHERE name = ?').bind(row.name).first()
    if (lock && lock.until > now) return fail(429, `암호를 여러 번 틀렸어요. ${Math.ceil((lock.until - now) / 60_000)}분 뒤에 다시 해 주세요`)
    if (typeof pass !== 'string' || !sameHex(await passHash(pass, row.pass_salt), row.pass_hash)) {
      // 잠금이 풀리면 n 은 0 부터 다시 센다(잠글 때 0 으로 둔다)
      const n = (lock?.n || 0) + 1
      const until = n >= FAIL_LIMIT ? now + FAIL_LOCK : 0
      await env.DB.prepare('INSERT INTO login_fails (name, n, until) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET n = excluded.n, until = excluded.until')
        .bind(row.name, until ? 0 : n, until)
        .run()
      // 401 은 '저장된 출입증이 죽었다'는 뜻이라 쓰지 않는다
      return fail(403, until ? '암호를 여러 번 틀렸어요. 10분 뒤에 다시 해 주세요' : `이미 있는 이름이에요. 내 이름이면 암호를 다시 확인해 주세요 (${FAIL_LIMIT - n}번 남음)`)
    }
    if (lock) await env.DB.prepare('DELETE FROM login_fails WHERE name = ?').bind(row.name).run()
    const token = crypto.randomUUID() + crypto.randomUUID()
    await env.DB.prepare('INSERT INTO sessions (token_hash, player, created) VALUES (?, ?, ?)').bind(await sha256(token), row.id, now).run()
    return ok({ id: row.id, name: row.name, token, pass: true })
  }

  // 암호 정하기·바꾸기. 이미 있으면 지금 암호를 같이 받는다
  if (method === 'POST' && path === '/me/pass') {
    if (!me) return fail(401, '등록이 필요해요')
    const bad = passError(req.body?.pass)
    if (bad) return fail(400, bad)
    if (me.pass) {
      const row = await env.DB.prepare('SELECT pass_hash, pass_salt FROM players WHERE id = ?').bind(me.id).first()
      if (typeof req.body?.old !== 'string' || !sameHex(await passHash(req.body.old, row.pass_salt), row.pass_hash)) return fail(403, '지금 암호가 맞지 않아요')
    }
    const { salt, hash } = await newPass(req.body.pass)
    await env.DB.prepare('UPDATE players SET pass_hash = ?, pass_salt = ? WHERE id = ?').bind(hash, salt, me.id).run()
    return ok({ pass: true })
  }

  if (method === 'POST' && path === '/score') {
    if (!me) return fail(401, '등록이 필요해요')
    const game = GAMES[req.body?.game]
    const score = Math.floor(Number(req.body?.score))
    if (!game) return fail(400, '없는 게임이에요')
    if (!Number.isFinite(score) || score < 0 || score > game.max) return fail(400, '점수가 이상해요')
    // 같은 게임은 3초에 한 번만 받는다
    const recent = await env.DB.prepare('SELECT at FROM plays WHERE player = ? AND game = ? ORDER BY at DESC LIMIT 1').bind(me.id, req.body.game).first()
    if (recent && now - recent.at < 3000) return fail(429, '조금 뒤에 다시 올려 주세요')
    await env.DB.prepare('INSERT INTO plays (player, game, score, at) VALUES (?, ?, ?, ?)').bind(me.id, req.body.game, score, now).run()
    await env.DB.prepare(
      `INSERT INTO scores (player, game, score, at) VALUES (?, ?, ?, ?)
       ON CONFLICT (player, game) DO UPDATE SET score = excluded.score, at = excluded.at WHERE excluded.score > scores.score`,
    )
      .bind(me.id, req.body.game, score, now)
      .run()
    return ok(await standing(env, req.body.game, me.id, score))
  }

  if (method === 'GET' && path === '/board') {
    const game = req.query.get('game')
    if (!GAMES[game]) return fail(400, '없는 게임이에요')
    const limit = Math.min(50, Math.max(1, Number(req.query.get('limit')) || 10))
    const { results } = await env.DB.prepare(
      'SELECT p.name, s.score, s.at FROM scores s JOIN players p ON p.id = s.player WHERE s.game = ? ORDER BY s.score DESC, s.at ASC LIMIT ?',
    )
      .bind(game, limit)
      .all()
    const players = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE game = ?').bind(game).first()
    const mine = me ? await standing(env, game, me.id) : null
    return ok({ game, title: GAMES[game].title, top: results, players: players.n, me: mine })
  }

  // 바탕화면 위젯용: 게임마다 1~3등과 참가자 수
  if (method === 'GET' && path === '/boards') {
    const out = []
    for (const [id, g] of Object.entries(GAMES)) {
      const { results } = await env.DB.prepare(
        'SELECT p.name, s.score FROM scores s JOIN players p ON p.id = s.player WHERE s.game = ? ORDER BY s.score DESC, s.at ASC LIMIT 3',
      )
        .bind(id)
        .all()
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE game = ?').bind(id).first()
      out.push({ game: id, title: g.title, top: results, players: n.n, me: me ? await standing(env, id, me.id) : null })
    }
    const players = await env.DB.prepare('SELECT COUNT(*) AS n FROM players').first()
    return ok({ games: out, players: players.n })
  }

  if (method === 'GET' && path === '/lotto') {
    const day = kstDay(now)
    const counts = await env.DB.prepare('SELECT rank, COUNT(*) AS n FROM tickets WHERE day = ? GROUP BY rank').bind(day).all()
    const { results: winners } = await env.DB.prepare(
      `SELECT p.name, t.rank, t.cards, t.at FROM tickets t JOIN players p ON p.id = t.player
       WHERE t.rank != '꽝' ORDER BY t.at DESC LIMIT 8`,
    ).all()
    const mine = me ? await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets WHERE player = ? AND day = ?').bind(me.id, day).first() : null
    const sold = counts.results.reduce((a, r) => a + r.n, 0)
    return ok({
      day,
      round: roundOf(day),
      sold,
      ranks: Object.fromEntries(counts.results.map((r) => [r.rank, r.n])),
      winners: winners.map((w) => ({ name: w.name, rank: w.rank, at: w.at, card: JSON.parse(w.cards)[0]?.name })),
      left: mine ? TICKETS_PER_DAY - mine.n : null,
      perDay: TICKETS_PER_DAY,
    })
  }

  if (method === 'POST' && path === '/lotto') {
    if (!me) return fail(401, '등록이 필요해요')
    const day = kstDay(now)
    const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets WHERE player = ? AND day = ?').bind(me.id, day).first()
    if (used.n >= TICKETS_PER_DAY) return fail(429, `오늘 복권 ${TICKETS_PER_DAY}장을 다 긁었어요. 내일 또 와요`)
    const cards = await drawCards(env)
    const prize = judge(cards)
    const res = await env.DB.prepare('INSERT INTO tickets (player, day, round, cards, rank, at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(me.id, day, roundOf(day), JSON.stringify(cards), prize.rank, now)
      .run()
    const no = res.meta?.last_row_id ?? res.lastInsertRowid
    return ok({ no, round: roundOf(day), day, cards, prize, left: TICKETS_PER_DAY - used.n - 1 }, 201)
  }

  if (method === 'GET' && path === '/shops') {
    const { results } = await env.DB.prepare(
      'SELECT s.id, s.name, s.cat, s.emoji, s.lng, s.lat, s.at, p.name AS owner FROM shops s JOIN players p ON p.id = s.player ORDER BY s.at DESC LIMIT 300',
    ).all()
    return ok({ shops: results.map((s) => ({ ...s, mine: me ? s.owner === me.name : false })) })
  }

  if (method === 'POST' && path === '/shops') {
    if (!me) return fail(401, '등록이 필요해요')
    const b = req.body || {}
    const name = String(b.name || '').replace(/\s+/g, '')
    const lng = Number(b.lng)
    const lat = Number(b.lat)
    if (!SHOP_NAME.test(name) || BANNED.test(name)) return fail(400, '가게 이름은 한글·영문·숫자 2~12자예요')
    if (!(lng > KOREA.w && lng < KOREA.e && lat > KOREA.s && lat < KOREA.n)) return fail(400, '우리나라 안에 차려 주세요')
    const cat = String(b.cat || '').slice(0, 20)
    const emoji = String(b.emoji || '').slice(0, 4)
    await env.DB.prepare('INSERT INTO shops (player, name, cat, emoji, lng, lat, at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(me.id, name, cat, emoji, lng, lat, now).run()
    // 한 사람 가게는 최근 세 곳만 남긴다
    await env.DB.prepare('DELETE FROM shops WHERE player = ? AND id NOT IN (SELECT id FROM shops WHERE player = ? ORDER BY at DESC LIMIT ?)')
      .bind(me.id, me.id, SHOPS_PER_PLAYER)
      .run()
    return ok({ name, cat, emoji, lng, lat, owner: me.name }, 201)
  }

  return fail(404, '없는 주소예요')
}

async function standing(env, game, player, last) {
  const row = await env.DB.prepare('SELECT score FROM scores WHERE player = ? AND game = ?').bind(player, game).first()
  if (!row) return null
  const above = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE game = ? AND score > ?').bind(game, row.score).first()
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE game = ?').bind(game).first()
  return { best: row.score, rank: above.n + 1, players: total.n, ...(last !== undefined ? { last, record: last >= row.score } : {}) }
}

// ── 복권 추첨: 클라이언트가 아니라 서버가 진짜 간판 자료에서 뽑는다 ─────────────
const JUNK = /없음|미상|업소명|상호명|^[-.0-9 ]*$/
const bucket = (g) => (g.charCodeAt(0) * 31 + g.charCodeAt(1)) % 1024
const rand = (n) => Math.floor(Math.random() * n)

async function nameCount(env, name) {
  const m = name.match(/[가-힣]{2}/)
  if (!m) return 1
  const shard = await env.data(`names/${bucket(m[0])}.json`)
  return Math.max(1, shard[name] || 1)
}

async function pool(env) {
  const [cats, regions, shard] = await Promise.all([env.data('cats.json'), env.data('regions.json'), env.data(`search/${rand(1024)}.json`)])
  return Object.values(shard)
    .flatMap((e) => e.r)
    .filter(([name]) => !JUNK.test(name))
    .map(([name, c, region]) => ({ name, cat: cats[c], region: regions[region][0] }))
}

// 전국에 하나뿐인 간판은 다섯 장에 한 장꼴로만 나오게 한다
async function pickCard(env, rows, cat) {
  const rare = Math.random() < 0.2
  const list = cat ? rows.filter((r) => r.cat === cat) : rows
  let card = null
  for (let k = 0; k < 6 && list.length; k++) {
    const s = list[rand(list.length)]
    card = { ...s, count: await nameCount(env, s.name) }
    if (rare === (card.count <= 1)) break
  }
  return card
}

async function drawCards(env) {
  const pools = await Promise.all([pool(env), pool(env), pool(env)])
  const first = await pickCard(env, pools[0])
  // 가끔은 같은 업종으로 맞춰 1등 기회를 준다
  const same = Math.random() < 0.12
  const rest = []
  for (const rows of pools.slice(1)) rest.push(await pickCard(env, same ? pools[0] : rows, same ? first.cat : undefined))
  return [first, ...rest].map((c) => c || first)
}

function eun(word) {
  const c = word.charCodeAt(word.length - 1) - 0xac00
  return c >= 0 && c < 11172 && c % 28 ? '은' : '는'
}

export function judge(c) {
  if (c.every((s) => s.cat === c[0].cat)) return { rank: '1등', text: `같은 업종(${c[0].cat}) 세 장! 대박!` }
  const unique = c.filter((s) => s.count <= 1)
  if (unique.length >= 2) return { rank: '2등', text: '전국에 하나뿐인 간판을 두 장이나!' }
  if (unique.length === 1) return { rank: '행운상', text: `'${unique[0].name}'${eun(unique[0].name)} 전국에 딱 한 곳뿐!` }
  const common = c.reduce((a, b) => (b.count > a.count ? b : a))
  return { rank: '꽝', text: `'${common.name}'${eun(common.name)} 전국에 ${common.count.toLocaleString()}곳이나 있어요` }
}
