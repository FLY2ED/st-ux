// 실시간 데이터: 개발 서버에서는 Vite 가 직접 중계하고(할당량 0), 배포에서는 Cloudflare Worker 를 거친다
import { vworldRows, vworldUrl } from './vworld.js'

const BASE = import.meta.env.DEV ? './live' : 'https://st-live.naldadev.com'

async function get(path, timeout = 15000) {
  const res = await fetch(`${BASE}/${path}`, { signal: AbortSignal.timeout(timeout) })
  if (!res.ok) throw new Error(`live ${res.status}`)
  return res.json()
}

// 서울 실시간 도시데이터. 샘플 키는 늘 광화문·덕수궁 자료만 주므로 그곳이 아니면 버린다
export async function cityData(area) {
  if (!area) return null
  const data = await get(`city?area=${encodeURIComponent(area)}`).catch(() => null)
  if (!data || (data.sample && data.area !== area)) return null
  return data
}

const busCache = new Map()

// 가까운 버스 정류소 도착 정보. 같은 자리는 30초 동안 다시 묻지 않는다
export async function busArrivals(lng, lat) {
  const key = `${lng.toFixed(4)},${lat.toFixed(4)}`
  const hit = busCache.get(key)
  if (hit && hit.until > Date.now()) return hit.data
  const data = await get(`bus?lng=${lng.toFixed(6)}&lat=${lat.toFixed(6)}`)
  busCache.set(key, { data, until: Date.now() + 30000 })
  return data
}

// 브이월드는 해외 IP(Cloudflare 미국 콜로)를 막는다. 배포에서는 도메인에 묶인 브라우저용 키로 JSONP 를 직접 부른다
const VWORLD_KEY = import.meta.env.VITE_VWORLD_KEY
const VWORLD_DOMAIN = import.meta.env.VITE_VWORLD_DOMAIN

let jsonpSeq = 0
function jsonp(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const name = `__vw${Date.now()}_${jsonpSeq++}`
    const script = document.createElement('script')
    const done = () => {
      clearTimeout(timer)
      delete window[name]
      script.remove()
    }
    const timer = setTimeout(() => {
      done()
      reject(new Error('jsonp timeout'))
    }, timeout)
    window[name] = (data) => {
      done()
      resolve(data)
    }
    script.onerror = () => {
      done()
      reject(new Error('jsonp'))
    }
    script.src = `${url}&callback=${name}`
    document.head.append(script)
  })
}

export async function buildingsAround(lng, lat, r) {
  if (import.meta.env.DEV || !VWORLD_KEY) return get(`bldg?lng=${lng.toFixed(6)}&lat=${lat.toFixed(6)}&r=${r}`, 30000)
  const b = []
  for (let page = 1; page <= 5; page++) {
    const res = (await jsonp(vworldUrl(VWORLD_KEY, VWORLD_DOMAIN, lng, lat, Math.min(400, r), page))).response
    if (!vworldRows(res, page, b)) break
  }
  return { b }
}

// 날씨는 키가 필요 없는 Open-Meteo 를 브라우저에서 바로 부른다
export async function weatherNow(lng, lat) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}&current=temperature_2m,weather_code,precipitation,cloud_cover&timezone=Asia%2FSeoul`
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error('weather')
  const c = (await res.json()).current
  const code = c.weather_code
  // WMO 날씨 코드 → 맑음·흐림·비·눈
  const kind = [71, 73, 75, 77, 85, 86].includes(code) ? 'snow' : code >= 51 && code <= 99 ? 'rain' : c.cloud_cover > 70 || code === 3 || code === 45 || code === 48 ? 'cloud' : 'clear'
  return { temp: Math.round(c.temperature_2m), kind, fog: code === 45 || code === 48 }
}

// 건축물 주용도 코드 → 이름과 겉모습
const USE = {
  '01': ['단독주택', 'house'],
  '02': ['공동주택', 'apt'],
  '03': ['제1종근린생활시설', 'retail'],
  '04': ['제2종근린생활시설', 'retail'],
  '05': ['문화및집회시설', 'other'],
  '06': ['종교시설', 'church'],
  '07': ['판매시설', 'retail'],
  '08': ['운수시설', 'other'],
  '09': ['의료시설', 'office'],
  10: ['교육연구시설', 'school'],
  11: ['노유자시설', 'school'],
  12: ['수련시설', 'school'],
  13: ['운동시설', 'other'],
  14: ['업무시설', 'office'],
  15: ['숙박시설', 'office'],
  16: ['위락시설', 'retail'],
  17: ['공장', 'other'],
  18: ['창고시설', 'other'],
}

// 브이월드 건물을 월드 건물 형식 [높이, 이름, 외곽선, 겉모습, 층, 용도, 연도] 으로 바꾼다
export function vworldBuildings(rows, lng, lat) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110540
  const round = (v) => Math.round(v * 2) / 2
  return rows.map(([floors, height, name, code, year, ring]) => {
    const [use, base] = USE[String(code).slice(0, 2)] || ['', 'other']
    const f = Math.max(1, floors)
    const h = height >= 2 && height < 400 ? height : f * 3.3
    let look = base
    if (look === 'apt' && f < 6) look = 'villa'
    if (look === 'other' && f >= 10) look = 'office'
    const flat = []
    for (let n = 0; n + 1 < ring.length; n += 2) flat.push(round((ring[n] - lng) * kx), round((ring[n + 1] - lat) * ky))
    return [Math.round(h), name, flat, look, f, use, year]
  })
}

// 경위도 → 월드 미터 좌표
export function toLocal(world, lngV, latV) {
  return [(lngV - world.lng) * 111320 * Math.cos((world.lat * Math.PI) / 180), (latV - world.lat) * 110540]
}
