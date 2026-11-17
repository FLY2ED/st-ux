import { createRoot } from 'react-dom/client'
import 'maplibre-gl/dist/maplibre-gl.css'
import './styles.css'
import App from './App.jsx'

// 지도 버튼 줄 시안 비교용: ?lv=a|b|c|d
document.documentElement.dataset.lv = new URLSearchParams(location.search).get('lv') || 'a'

createRoot(document.getElementById('root')).render(<App />)
