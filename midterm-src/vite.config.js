import { createReadStream, existsSync, readFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { handle } from './live/handlers.js'

// 빌드 결과는 GitHub Pages가 그대로 서빙하는 ../midterm 에 둔다. 데이터는 거기에만 있다.
const SITE = fileURLToPath(new URL('../midterm', import.meta.url))

// 98.css의 `@media (not(hover))`는 lightningcss가 못 읽어서 같은 뜻의 표준 문법으로 바꾼다
const fix98 = {
  name: 'fix-98css-media',
  transform(code, id) {
    if (id.includes('98.css') && id.endsWith('.css')) return code.replaceAll('(not(hover))', 'not all and (hover)')
  },
}

// 개발 서버에서 ../midterm/data 를 /data 로 보여 준다
const siteData = {
  name: 'site-data',
  configureServer(server) {
    server.middlewares.use('/data', (req, res, next) => {
      const file = `${SITE}/data${decodeURIComponent(req.url.split('?')[0])}`
      if (!existsSync(file)) return next()
      res.setHeader('Content-Type', 'application/json')
      createReadStream(file).pipe(res)
    })
  },
}

// 개발 서버에서는 /live 를 Node 가 직접 처리해 Cloudflare Worker 호출 할당량을 쓰지 않는다
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

// 해시가 바뀐 옛 파일이 쌓이지 않게 빌드 전에 assets 만 비운다 (data 는 남긴다)
const cleanAssets = {
  name: 'clean-assets',
  apply: 'build',
  buildStart() {
    rmSync(`${SITE}/assets`, { recursive: true, force: true })
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
  plugins: [fix98, siteData, liveLocal, cleanAssets, vue()],
  server: {
    allowedHosts: ['nalda-gram'],
  },
  build: {
    outDir: SITE,
    emptyOutDir: false,
  },
}))
