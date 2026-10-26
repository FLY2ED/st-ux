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

createRoot(document.getElementById('root')).render(<App />)
