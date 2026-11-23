import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans-kr/400.css'
import '@fontsource/ibm-plex-sans-kr/500.css'
import '@fontsource/ibm-plex-sans-kr/600.css'
import '@fontsource/geist-mono/500.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import './v2.css'
import V2 from './V2.jsx'

createRoot(document.getElementById('root')).render(<V2 />)
