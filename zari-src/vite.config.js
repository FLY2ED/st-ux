import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages(/zari/)에 올리므로 상대 경로로 빌드
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: '../zari', emptyOutDir: true },
  server: { host: true, allowedHosts: true },
})
