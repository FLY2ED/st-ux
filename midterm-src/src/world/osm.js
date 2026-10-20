// OpenStreetMap에서 반경 안 건물·길·땅 쓰임새를 받아 중심 기준 미터 좌표로 줄인다.
// 브라우저(내 위치)와 프리셋을 미리 굽는 스크립트가 같이 쓴다.

export const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

function query(lng, lat, r) {
  const at = `(around:${r},${lat},${lng})`
  return `[out:json][timeout:40];(
way["building"]${at};
way["highway"]${at};
way["landuse"]${at};
way["leisure"]${at};
way["natural"]${at};
way["amenity"="parking"]${at};
way["waterway"]${at};
way["railway"]${at};
node["railway"~"^(subway_entrance|station)$"]${at};
node["highway"="bus_stop"]${at};
);out geom tags;`
}

export async function fetchOSM(lng, lat, r, { timeout = 30000 } = {}) {
  const body = new URLSearchParams({ data: query(lng, lat, r) })
  let last
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(timeout) })
      if (!res.ok) throw new Error(`${url} ${res.status}`)
      const json = await res.json()
      if (!json.elements?.length) throw new Error(`${url} empty`)
      return json
    } catch (e) {
      last = e
    }
  }
  throw last
}

// 층수를 모를 때 건물 종류로 어림한다. 한국 아파트는 높다
const LEVELS = { apartments: 15, university: 5, school: 4, college: 5, office: 8, commercial: 4, retail: 2, hospital: 6, hotel: 8, church: 3, house: 2, detached: 2, residential: 4, garage: 1, shed: 1, roof: 1, kiosk: 1 }

const ROAD = { motorway: 14, trunk: 12, primary: 12, secondary: 10, tertiary: 8, unclassified: 6, residential: 6, living_street: 5, service: 4, pedestrian: 4, footway: 2, path: 2, cycleway: 2, steps: 2, track: 3 }

function areaKind(t) {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir') return 'water'
  if (t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'grass' || t.natural === 'wood' || t.landuse === 'forest' || t.natural === 'scrub' || t.landuse === 'recreation_ground') return 'park'
  if (t.leisure === 'pitch' || t.leisure === 'stadium' || t.leisure === 'track') return 'pitch'
  if (t.amenity === 'parking') return 'parking'
  if (t.landuse === 'education' || t.amenity === 'university' || t.amenity === 'school') return 'campus'
  return null
}

const round = (v) => Math.round(v * 2) / 2

// 건물 종류를 겉모습 묶음으로 줄인다
function lookOf(t, height) {
  const k = t.building
  if (t.amenity === 'place_of_worship' || k === 'church') return 'church'
  if (['apartments', 'residential', 'dormitory'].includes(k)) return 'apt'
  if (['house', 'detached', 'terrace', 'semidetached_house'].includes(k)) return 'house'
  if (['university', 'school', 'college', 'kindergarten'].includes(k)) return 'school'
  if (k === 'office' || height >= 30) return 'office'
  if (['retail', 'commercial', 'kiosk'].includes(k)) return 'retail'
  return 'other'
}

// 서울 지하철 노선 색 (OSM에 colour가 없을 때)
const LINE_COLOR = { '1호선': '#0052A4', '2호선': '#00A84D', '3호선': '#EF7C1C', '4호선': '#00A5DE', '5호선': '#996CAC', '6호선': '#CD7C2F', '7호선': '#747F00', '8호선': '#E6186C', '9호선': '#BDB092', 신분당선: '#D4003B', 수인분당선: '#F5A200', 경의중앙선: '#77C4A3', 공항철도: '#0090D2', 경춘선: '#0C8E72' }

// OSM 선로 이름 → 안내판에 쓰는 노선 이름
const ALIAS = { 인천국제공항선: '공항철도', 용산선: '경의중앙선', 경의선: '경의중앙선', 중앙선: '경의중앙선', 분당선: '수인분당선' }

const lineName = (n) => {
  const name = n.replace(/^(서울|수도권)\s*(지하철|전철)\s*/, '').replace(/[:(].*$/, '').trim()
  return ALIAS[name] || name
}

export function compact(osm, lng, lat, r) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110540
  const pt = (p) => [round((p.lon - lng) * kx), round((p.lat - lat) * ky)]
  const flat = (geom) => geom.flatMap(pt)
  const b = []
  const w = []
  const a = []
  const stations = new Map()
  const ex = []
  const bus = []
  const lines = new Map()
  for (const el of osm.elements) {
    const t = el.tags || {}
    if (el.type === 'node') {
      const [x, y] = pt(el)
      if (t.railway === 'subway_entrance') ex.push([t.ref || '', x, y, (t.description || '').replace(/\s*\d+\s*번\s*출구.*$/, '')])
      else if (t.railway === 'station' && t.name) {
        const name = t.name.replace(/역$/, '')
        if (!stations.has(name)) stations.set(name, [name, x, y, t['name:en'] || ''])
      } else if (t.highway === 'bus_stop' && t.name) bus.push([t.name, x, y])
      continue
    }
    if (!el.geometry || el.geometry.length < 2) continue
    // 지하로 다니는 노선도 이름과 색은 역 표지판에 쓴다
    if ((t.railway === 'subway' || t.railway === 'rail' || t.railway === 'light_rail') && t.name && /선|line/i.test(t.name)) {
      const name = lineName(t.name)
      if (!lines.has(name) && (LINE_COLOR[name] || t.colour)) lines.set(name, LINE_COLOR[name] || t.colour)
    }
    // 지하상가·지하 역사는 땅 위에 세우지 않는다
    const below = t.layer?.[0] === '-' || t.location === 'underground' || t.tunnel === 'yes'
    if (t.building && t.building !== 'no') {
      if (below || t.building === 'roof') continue
      const levels = Number.parseFloat(t['building:levels']) || LEVELS[t.building] || 3
      const height = Math.min(250, Math.round(Number.parseFloat(t.height) || levels * 3.2))
      b.push([height, t.name || '', flat(el.geometry), lookOf(t, height)])
    } else if (below) {
      continue
    } else if (t.footway === 'crossing' || (t.highway === 'footway' && t.crossing)) {
      w.push(['cross', 4, flat(el.geometry), ''])
    } else if (t.highway && ROAD[t.highway]) {
      const lanes = Number.parseInt(t.lanes, 10)
      const width = Number.parseFloat(t.width) || (lanes ? lanes * 3.2 : ROAD[t.highway])
      w.push([ROAD[t.highway] >= 4 ? 'road' : 'path', Math.min(40, width), flat(el.geometry), ROAD[t.highway] >= 6 ? t.name || '' : '', ROAD[t.highway] >= 6 ? t['name:en'] || '' : ''])
    } else if (t.railway === 'rail' || t.railway === 'subway' || t.railway === 'light_rail') {
      const high = t.bridge === 'yes' || Number.parseInt(t.layer, 10) >= 1
      w.push([high ? 'viaduct' : 'rail', 4, flat(el.geometry), t.name || ''])
    } else if ((t.waterway === 'river' || t.waterway === 'stream') && !t.tunnel) {
      w.push(['water', t.waterway === 'river' ? 20 : 4, flat(el.geometry), ''])
    } else {
      const kind = areaKind(t)
      if (kind) a.push([kind, flat(el.geometry)])
    }
  }
  return { lng, lat, r, b, w, a, st: [...stations.values()], ex, bus, ln: [...lines] }
}
