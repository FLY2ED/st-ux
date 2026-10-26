import { handle } from './handlers.js'

// 배포된 사이트에서만 부를 수 있게 한다. 개발 서버는 이 Worker를 쓰지 않는다
const ORIGINS = ['https://st.naldadev.com']

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || ''
    const cors = ORIGINS.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}
    if (request.method === 'OPTIONS') return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET' } })
    if (request.method !== 'GET') return new Response('method', { status: 405 })

    // 같은 주소는 캐시에서 돌려줘 원본 API 호출 수를 줄인다
    const url = new URL(request.url)
    const cacheKey = new Request(url.toString())
    const cache = caches.default
    const hit = await cache.match(cacheKey)
    if (hit) {
      const res = new Response(hit.body, hit)
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
      return res
    }
    const { status, body, ttl } = await handle(url, env)
    const res = new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${ttl || 0}` },
    })
    if (status === 200 && ttl) ctx.waitUntil(cache.put(cacheKey, res.clone()))
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
    return res
  },
}
