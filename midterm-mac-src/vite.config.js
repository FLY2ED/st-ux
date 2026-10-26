import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import { handle } from '../midterm-src/live/handlers.js'
import { arcade } from './arcade/handlers.js'

// 데이터는 98판 사이트 ../midterm/data 에만 있다. 배포본은 ../midterm/data/ 를 상대 경로로 읽는다
const SITE = fileURLToPath(new URL('../midterm', import.meta.url))
const OUT = fileURLToPath(new URL('../midterm-mac', import.meta.url))

// 개발 서버에서 /midterm/data 를 그대로 보여 준다
const siteData = {
  name: 'site-data',
  configureServer(server) {
    server.middlewares.use('/midterm/data', (req, res, next) => {
      const file = `${SITE}/data${decodeURIComponent(req.url.split('?')[0])}`
      if (!existsSync(file)) return next()
      // 지도 타일(.pmtiles)은 필요한 조각만 Range 로 읽는다. GitHub Pages 도 Range 를 받아 준다
      if (file.endsWith('.pmtiles')) {
        const size = statSync(file).size
        const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '')
        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('Accept-Ranges', 'bytes')
        if (!m) {
          res.setHeader('Content-Length', size)
          return createReadStream(file).pipe(res)
        }
        const start = +m[1]
        const end = Math.min(m[2] ? +m[2] : size - 1, size - 1)
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
        res.setHeader('Content-Length', end - start + 1)
        return createReadStream(file, { start, end }).pipe(res)
      }
      res.setHeader('Content-Type', 'application/json')
      createReadStream(file).pipe(res)
    })
  },
}

// 3D 거리의 실시간 자료. 개발 서버에서는 Node 가 직접 받아 Cloudflare Worker 할당량을 쓰지 않는다 (98판과 같은 방식)
const SECRETS = '/data/secrets/st-ux'
function liveEnv() {
  const env = {}
  for (const f of ['vworld.env', 'datagokr.env', 'seoul.env']) {
    if (!existsSync(`${SECRETS}/${f}`)) continue
    for (const line of readFileSync(`${SECRETS}/${f}`, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/)
      if (m) env[m[1]] = m[2]
    }
  }
  return env
}
const liveLocal = {
  name: 'live-local',
  configureServer(server) {
    const env = liveEnv()
    const cache = new Map()
    server.middlewares.use('/live', async (req, res) => {
      const url = new URL(req.url, 'http://local')
      const key = url.pathname + url.search
      let hit = cache.get(key)
      if (!hit || hit.until < Date.now()) {
        const out = await handle(url, env)
        hit = { ...out, until: Date.now() + (out.status === 200 ? (out.ttl || 0) : 0) * 1000 }
        if (out.status === 200) cache.set(key, hit)
      }
      res.statusCode = hit.status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(hit.body))
    })
  },
}

// 간판 오락실 서버. 개발 서버에서는 D1 대신 Node 내장 SQLite 파일(arcade/.dev.sqlite)로 같은 코드를 돌린다
const ARCADE_DB = fileURLToPath(new URL('./arcade/.dev.sqlite', import.meta.url))
async function localD1() {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(ARCADE_DB)
  // 암호 칸이 생기기 전에 만든 개발 DB 에 칸을 덧붙인다(schema.sql 보다 먼저: 새 칸을 쓰는 색인이 생길 수 있다)
  for (const col of ['pass_hash', 'pass_salt']) {
    try {
      db.exec(`ALTER TABLE players ADD COLUMN ${col} TEXT`)
    } catch {}
  }
  db.exec(readFileSync(new URL('./arcade/schema.sql', import.meta.url), 'utf8'))
  const statement = (sql, args = []) => ({
    sql,
    args,
    bind: (...a) => statement(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args)
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } }
    },
  })
  // D1 batch 와 같이 한 트랜잭션으로 차례로 돌린다. SELECT 는 행을, 나머지는 바뀐 수를 돌려준다
  const batch = async (list) => {
    db.exec('BEGIN')
    try {
      const out = list.map(({ sql, args }) => (/^\s*SELECT/i.test(sql) ? { results: db.prepare(sql).all(...args) } : { meta: { changes: db.prepare(sql).run(...args).changes } }))
      db.exec('COMMIT')
      return out
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return { prepare: (sql) => statement(sql), batch }
}
const arcadeLocal = {
  name: 'arcade-local',
  async configureServer(server) {
    const DB = await localD1()
    const memo = new Map()
    const data = async (name) => {
      if (!memo.has(name)) memo.set(name, JSON.parse(readFileSync(`${SITE}/data/${name}`, 'utf8')))
      return memo.get(name)
    }
    server.middlewares.use('/arcade', async (req, res) => {
      const url = new URL(req.url, 'http://local')
      let body = null
      if (req.method === 'POST') {
        let raw = ''
        for await (const chunk of req) raw += chunk
        try { body = JSON.parse(raw) } catch {}
      }
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null
      let out
      try {
        out = await arcade({ method: req.method, path: url.pathname, query: url.searchParams, body, token, cf: null }, { DB, data, now: () => Date.now() })
      } catch (e) {
        console.error(e)
        out = { status: 500, body: { error: '서버가 잠깐 아파요' } }
      }
      res.statusCode = out.status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(out.body))
    })
  },
}

// 배포 빌드에만 브이월드 브라우저 키를 넣는다 (도메인에 묶인 키라 공개돼도 다른 곳에서 못 쓴다)
export default defineConfig(({ command }) => ({
  define:
    command === 'build'
      ? {
          'import.meta.env.VITE_VWORLD_KEY': JSON.stringify(liveEnv().VWORLD_KEY || ''),
          'import.meta.env.VITE_VWORLD_DOMAIN': JSON.stringify(liveEnv().VWORLD_DOMAIN || ''),
        }
      : {},
  base: './',
  publicDir: false,
  plugins: [siteData, liveLocal, arcadeLocal, react({ include: /\.jsx$/ }), vue()],
  server: { allowedHosts: ['nalda-gram', 'nalda-gram.tail8e2308.ts.net'] },
  build: { outDir: OUT, emptyOutDir: true },
}))
