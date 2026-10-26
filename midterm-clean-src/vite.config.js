import { createReadStream, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 빌드 결과는 GitHub Pages가 그대로 서빙하는 ../midterm-clean 에 둔다.
// 간판 데이터는 원래 간판 도감(../midterm/data)을 같이 쓴다.
const SITE = fileURLToPath(new URL('../midterm-clean', import.meta.url))
const DATA = fileURLToPath(new URL('../midterm/data', import.meta.url))

// 개발 서버에서 ../midterm/data 를 /data 로 보여 준다
const siteData = {
  name: 'site-data',
  configureServer(server) {
    server.middlewares.use('/data', (req, res, next) => {
      const file = `${DATA}${decodeURIComponent(req.url.split('?')[0])}`
      if (!existsSync(file)) return next()
      res.setHeader('Content-Type', 'application/json')
      createReadStream(file).pipe(res)
    })
  },
}

// 해시가 바뀐 옛 파일이 쌓이지 않게 빌드 전에 assets 를 비운다
const cleanAssets = {
  name: 'clean-assets',
  apply: 'build',
  buildStart() {
    rmSync(`${SITE}/assets`, { recursive: true, force: true })
  },
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [siteData, cleanAssets, vue()],
  server: {
    allowedHosts: ['nalda-gram'],
  },
  build: {
    outDir: SITE,
    emptyOutDir: false,
  },
})
