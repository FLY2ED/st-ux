import { createRoot } from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './fonts.css'
import './mac.css'
import './games/ink.css'
import App from './App.jsx'

// 애플 기기는 시스템 글꼴(SF Pro·Apple SD Gothic Neo)을 그대로 쓰고, 그 밖에서는 Pretendard 를 맥 자간에 맞춘다
const apple = /Mac|iPhone|iPad|iPod/.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent)
document.documentElement.classList.toggle('apple', apple)
// 처음엔 다크 모드. 보기 메뉴에서 바꾸면 기억한다
document.documentElement.classList.toggle('dark', localStorage.getItem('gp-theme') !== 'light')

// 새로 배포하면 옛 조각 파일이 사라진다. 열려 있던 페이지가 그걸 찾다 실패하면 한 번만 새로고침해 새 판을 받는다
window.addEventListener('vite:preloadError', (e) => {
  if (sessionStorage.getItem('gp-reloaded')) return
  e.preventDefault()
  sessionStorage.setItem('gp-reloaded', '1')
  location.reload()
})
setTimeout(() => sessionStorage.removeItem('gp-reloaded'), 10000)

createRoot(document.getElementById('root')).render(<App />)
