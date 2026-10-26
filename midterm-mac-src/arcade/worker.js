import { arcade } from './handlers.js'
import { townRoute } from './town.js'

export { Town } from './town.js'

// 배포된 사이트에서만 부를 수 있게 한다. 개발 서버는 이 Worker 대신 vite.config.js 의 로컬 SQLite 를 쓴다
const ORIGINS = ['https://st.naldadev.com']
const memo = new Map()

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    // 같은 동네 함께 걷기(웹소켓)는 동네 방(Durable Object)으로 바로 넘긴다
    if (url.pathname.startsWith('/town/')) return townRoute(request, env, url, ORIGINS)
    const origin = request.headers.get('Origin') || ''
    const cors = ORIGINS.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST' }
      : {}
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors })

    // 간판 거리 읽기는 모두에게 같은 답이라 30초 동안 엣지 캐시에서 준다(같은 동네 사람이 몰려도 D1 은 한 번)
    const shared = request.method === 'GET' && url.pathname === '/street'
    const cacheKey = new Request(url.toString(), { method: 'GET' })
    if (shared) {
      const hit = await caches.default.match(cacheKey)
      if (hit) return new Response(hit.body, { status: hit.status, headers: { ...Object.fromEntries(hit.headers), ...cors } })
    }
    let body = null
    if (request.method === 'POST') body = await request.json().catch(() => null)
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '') || null

    // 간판 자료는 사이트의 정적 파일을 읽어 온다. 같은 조각은 한 isolate 안에서 다시 받지 않는다
    const data = (name) => {
      if (!memo.has(name)) {
        memo.set(
          name,
          fetch(`${env.DATA_BASE}${name}`, { cf: { cacheTtl: 86400, cacheEverything: true } }).then((r) => {
            if (!r.ok) throw new Error(`${name} ${r.status}`)
            return r.json()
          }),
        )
        if (memo.size > 200) memo.delete(memo.keys().next().value)
      }
      return memo.get(name)
    }

    let out
    try {
      out = await arcade({ method: request.method, path: url.pathname, query: url.searchParams, body, token, cf: request.cf }, { DB: env.DB, data, now: () => Date.now() })
    } catch (e) {
      out = { status: 500, body: { error: '서버가 잠깐 아파요' } }
      console.error(e)
    }
    const text = JSON.stringify(out.body)
    if (shared && out.status === 200) {
      const copy = new Response(text, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=30' } })
      ctx.waitUntil(caches.default.put(cacheKey, copy))
    }
    return new Response(text, {
      status: out.status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
    })
  },
}
