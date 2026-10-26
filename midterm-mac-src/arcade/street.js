// 간판 거리(2D) 같이 하기: 다른 사람이 담은 간판 수·처음 찾은 사람, 간판 쪽지, 동네 순위.
// 실시간 연결 없이 동네에 들어갈 때 한 번 읽고(GET, Worker 가 30초 캐시), 담은 간판은 모아서 한 번에 쓴다(POST, D1 batch 한 번)
const TILE = /^\d{5}_\d{4}$/
const KEY = /^(\d{7,8})_(\d{6,7})\|(.{1,40})$/u
const MAX_FOUND = 60
const NOTE_LEN = 30
const NOTE_GAP = 10_000
const BANNED = /시발|씨발|ㅅㅂ|병신|좆|존나|섹스|fuck|shit/i

const ok = (body, status = 200) => ({ status, body })
const fail = (status, error) => ({ status, body: { error } })
const tileOf = (m) => `${Math.floor(m[1] / 1000)}_${Math.floor(m[2] / 1000)}`
const kstDay = (now) => new Date(now + 9 * 3600_000).toISOString().slice(0, 10)

// 내 정보가 들어가지 않으니 누구에게나 같은 답이다. 그래서 Worker 가 캐시할 수 있다
export async function streetRead(env, query, now) {
  const tiles = [...new Set(String(query.get('t') || '').split(','))].filter((t) => TILE.test(t)).slice(0, 4)
  if (!tiles.length) return fail(400, '동네 조각이 없어요')
  const q = tiles.map(() => '?').join(',')
  const [signs, notes, top, today] = await env.DB.batch([
    env.DB.prepare(`SELECT s.key, s.n, p.name AS first FROM street_signs s JOIN players p ON p.id = s.first WHERE s.tile IN (${q}) ORDER BY s.n DESC LIMIT 3000`).bind(...tiles),
    env.DB.prepare(`SELECT n.key, n.text, n.at, p.name AS by FROM street_notes n JOIN players p ON p.id = n.player WHERE n.tile IN (${q}) ORDER BY n.at DESC LIMIT 300`).bind(...tiles),
    env.DB.prepare(`SELECT p.name, COUNT(*) AS n FROM street_finds f JOIN players p ON p.id = f.player WHERE f.tile IN (${q}) GROUP BY f.player ORDER BY n DESC LIMIT 5`).bind(...tiles),
    env.DB.prepare(`SELECT COUNT(DISTINCT player) AS n FROM street_days WHERE day = ? AND tile IN (${q})`).bind(kstDay(now), ...tiles),
  ])
  return ok({
    signs: Object.fromEntries(signs.results.map((r) => [r.key, [r.n, r.first]])),
    notes: Object.fromEntries(notes.results.map((r) => [r.key, [r.text, r.by, r.at]])),
    top: top.results.map((r) => [r.name, r.n]),
    today: today.results[0]?.n || 0,
  })
}

// 담은 간판 묶음 올리기: 같은 간판을 여러 번 보내도 한 번만 센다
export async function streetFound(env, me, body, now) {
  if (!me) return fail(401, '등록이 필요해요')
  const tile = String(body?.t || '')
  const keys = [...new Set((Array.isArray(body?.found) ? body.found : []).map(String))].slice(0, MAX_FOUND)
  const rows = keys.map((k) => [k, KEY.exec(k)]).filter(([, m]) => m)
  const stmts = []
  for (const [k, m] of rows) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO street_finds (player, key, tile, at) VALUES (?, ?, ?, ?)').bind(me.id, k, tileOf(m), now))
  for (const [k, m] of rows) {
    stmts.push(
      env.DB.prepare(
        `INSERT INTO street_signs (key, tile, n, first, at) VALUES (?, ?, 1, ?, ?)
         ON CONFLICT (key) DO UPDATE SET n = (SELECT COUNT(*) FROM street_finds WHERE key = excluded.key)`,
      ).bind(k, tileOf(m), me.id, now),
    )
  }
  if (TILE.test(tile)) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO street_days (tile, day, player) VALUES (?, ?, ?)').bind(tile, kstDay(now), me.id))
  if (stmts.length) await env.DB.batch(stmts)
  return ok({ saved: rows.length })
}

// 간판 쪽지: 간판마다 마지막 한 줄만 남는다. 빈 글이면 내 쪽지를 지운다
export async function streetNote(env, me, body, now) {
  if (!me) return fail(401, '등록이 필요해요')
  const m = KEY.exec(String(body?.key || ''))
  if (!m) return fail(400, '없는 간판이에요')
  const key = m[0]
  const text = String(body?.text || '').replace(/\s+/g, ' ').trim()
  if (!text) {
    await env.DB.prepare('DELETE FROM street_notes WHERE key = ? AND player = ?').bind(key, me.id).run()
    return ok({ key, text: '' })
  }
  if ([...text].length > NOTE_LEN) return fail(400, `쪽지는 ${NOTE_LEN}자까지예요`)
  if (BANNED.test(text)) return fail(400, '다른 말로 써 주세요')
  const recent = await env.DB.prepare('SELECT at FROM street_notes WHERE player = ? ORDER BY at DESC LIMIT 1').bind(me.id).first()
  if (recent && now - recent.at < NOTE_GAP) return fail(429, '쪽지는 10초에 한 장씩 붙여요')
  await env.DB.prepare(
    `INSERT INTO street_notes (key, tile, player, text, at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET player = excluded.player, text = excluded.text, at = excluded.at`,
  )
    .bind(key, tileOf(m), me.id, text, now)
    .run()
  return ok({ key, text, by: me.name, at: now }, 201)
}
