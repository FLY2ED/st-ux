import { createReadStream, existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

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

// 해시가 바뀐 옛 파일이 쌓이지 않게 빌드 전에 assets 만 비운다 (data 는 남긴다)
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
  plugins: [fix98, siteData, cleanAssets, vue()],
  build: {
    outDir: SITE,
    emptyOutDir: false,
  },
})
