import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// 배포에선 /zari/ 옆 /midterm/data(서울 간판·건물 칸 파일)를 ../midterm 으로 읽는다. 개발 서버에서도 같은 주소로 내준다
const midterm = () => ({
  name: 'midterm-data',
  configureServer(server) {
    const root = path.resolve(__dirname, '../midterm')
    server.middlewares.use('/midterm', (req, res, next) => {
      const f = path.join(root, decodeURIComponent(req.url.split('?')[0]))
      if (!f.startsWith(root) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return next()
      res.setHeader('Content-Type', f.endsWith('.json') ? 'application/json' : 'application/octet-stream')
      fs.createReadStream(f).pipe(res)
    })
  },
})

// GitHub Pages(/zari/)에 올리므로 상대 경로로 빌드
export default defineConfig({
  base: './',
  plugins: [react(), midterm()],
  build: { outDir: '../zari', emptyOutDir: true },
  server: { host: true, allowedHosts: true },
})
