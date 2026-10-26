// OpenFreeMap 벡터 타일(z14, OpenMapTiles 스키마)로 반경 안 길·땅·역·정류장을 받는다.
// Overpass 가 10초 넘게 걸리는 것을 0.3초 남짓으로 줄이려는 것이고, 받은 타일은 기억해 두어
// 옆 동네로 넘어갈 때 대부분 다시 받지 않는다. 결과는 osm.js compact 가 읽는 OSM 꼴로 바꿔 넘긴다
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import { compact } from './osm.js'

const Z = 14
const TILEJSON = 'https://tiles.openfreemap.org/planet'

let template = null
const tileTemplate = () =>
  (template ||= fetch(TILEJSON)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`tilejson ${res.status}`))))
    .then((tj) => tj.tiles[0])
    .catch((e) => {
      template = null
      throw e
    }))

const tiles = new Map()
function tile(x, y, signal) {
  const key = `${x}/${y}`
  if (!tiles.has(key)) {
    const p = tileTemplate()
      .then((url) => fetch(url.replace('{z}', Z).replace('{x}', x).replace('{y}', y), { signal }))
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`tile ${res.status}`))))
      .then((buf) => new VectorTile(new Pbf(new Uint8Array(buf))))
    p.catch(() => tiles.delete(key))
    tiles.set(key, p)
  }
  return tiles.get(key)
}

const lng2x = (lng) => ((lng + 180) / 360) * 2 ** Z
const lat2y = (lat) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z
}
const x2lng = (x) => (x / 2 ** Z) * 360 - 180
const y2lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** Z))) * 180) / Math.PI

// 반경을 덮는 타일 번호
function cover(lng, lat, r) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180)
  const x0 = Math.floor(lng2x(lng - r / kx))
  const x1 = Math.floor(lng2x(lng + r / kx))
  const y0 = Math.floor(lat2y(lat + r / 110540))
  const y1 = Math.floor(lat2y(lat - r / 110540))
  const out = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y])
  return out
}

// 다음 동네를 미리 받아 둔다. 실패해도 그만이다
export function prefetchTiles(lng, lat, r) {
  for (const [x, y] of cover(lng, lat, r)) tile(x, y).catch(() => {})
}

const HIGHWAY = { motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', minor: 'residential', service: 'service', track: 'track', pedestrian: 'pedestrian' }
const PATHS = new Set(['footway', 'path', 'cycleway', 'steps', 'pedestrian', 'bridleway'])

function tagsOf(layer, p) {
  const t = {}
  if (p.brunnel === 'tunnel') t.tunnel = 'yes'
  if (p.brunnel === 'bridge') t.bridge = 'yes'
  if (p.layer != null) t.layer = String(p.layer)
  switch (layer) {
    case 'transportation':
      if (p.class === 'rail' || p.class === 'transit') t.railway = p.subclass === 'light_rail' ? 'light_rail' : p.class === 'transit' ? 'subway' : 'rail'
      else if (p.class === 'path') t.highway = PATHS.has(p.subclass) ? p.subclass : 'footway'
      else if (HIGHWAY[p.class]) t.highway = HIGHWAY[p.class]
      else return null
      return t
    case 'water':
      return p.class === 'ocean' ? null : { natural: 'water' }
    case 'waterway':
      return p.class === 'river' || p.class === 'stream' ? { waterway: p.class, ...(t.tunnel ? { tunnel: 'yes' } : {}) } : null
    case 'landcover':
      return p.class === 'wood' ? { natural: 'wood' } : p.class === 'grass' ? { landuse: 'grass' } : null
    case 'park':
      return { leisure: 'park' }
    case 'landuse':
      if (['pitch', 'stadium', 'track'].includes(p.class)) return { leisure: p.class }
      if (p.class === 'playground') return { leisure: 'park' }
      if (['school', 'university', 'college', 'kindergarten'].includes(p.class)) return { amenity: p.class === 'college' ? 'university' : p.class }
      return null
    case 'building': {
      if (p.hide_3d || p.render_min_height > 0) return null
      return { building: 'yes', height: String(p.render_height || 9) }
    }
    default:
      return null
  }
}

const LAYERS = ['transportation', 'water', 'waterway', 'landcover', 'park', 'landuse', 'building']

// 바퀴 넓이 부호로 바깥 테두리와 구멍을 가른다. 구멍은 버린다
const ringArea = (ring) => {
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y)
  return s
}

export async function fetchTilesArea(lng, lat, r, { timeout = 8000 } = {}) {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), timeout)
  try {
    const list = cover(lng, lat, r)
    const vts = await Promise.all(list.map(([x, y]) => tile(x, y, stop.signal)))
    const kx = 111320 * Math.cos((lat * Math.PI) / 180)
    const near = (p) => Math.abs((p.lon - lng) * kx) < r * 1.05 && Math.abs((p.lat - lat) * 110540) < r * 1.05
    const elements = []
    const names = new Map()
    vts.forEach((vt, n) => {
      const [tx, ty] = list[n]
      const toGeo = (pt, extent) => ({ lon: x2lng(tx + pt.x / extent), lat: y2lat(ty + pt.y / extent) })
      for (const name of LAYERS) {
        const layer = vt.layers[name]
        if (!layer) continue
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i)
          const tags = tagsOf(name, f.properties)
          if (!tags) continue
          let rings = f.loadGeometry()
          if (f.type === 3) {
            const outer = Math.sign(ringArea(rings[0]))
            rings = rings.filter((ring) => Math.sign(ringArea(ring)) === outer)
          }
          for (const ring of rings) {
            const geometry = ring.map((pt) => toGeo(pt, layer.extent))
            if (geometry.length < 2 || !geometry.some(near)) continue
            elements.push({ type: 'way', tags, geometry })
          }
        }
      }
      // 길 이름은 따로 든 선을 5m 칸에 찍어 두고, 길 조각이 지나는 칸으로 찾아 붙인다
      const tn = vt.layers.transportation_name
      for (let i = 0; tn && i < tn.length; i++) {
        const f = tn.feature(i)
        const p = f.properties
        const label = p['name:ko'] || p.name
        if (!label) continue
        if (p.class === 'rail' || p.class === 'transit') {
          // 노선 이름은 역 안내판 색에만 쓴다(땅 위에 다시 그리지 않게 지하로 둔다)
          elements.push({ type: 'way', tags: { railway: 'subway', tunnel: 'yes', name: label }, geometry: [{ lon: lng, lat }, { lon: lng, lat }] })
          continue
        }
        for (const ring of f.loadGeometry()) {
          for (const pt of ring) {
            const g = toGeo(pt, tn.extent)
            names.set(`${Math.round((g.lon - lng) * kx / 5)},${Math.round((g.lat - lat) * 110540 / 5)}`, [label, p.name_en || p['name:en'] || ''])
          }
        }
      }
      const poi = vt.layers.poi
      for (let i = 0; poi && i < poi.length; i++) {
        const f = poi.feature(i)
        const p = f.properties
        const label = p['name:ko'] || p.name
        if (f.type !== 1) continue
        const g = toGeo(f.loadGeometry()[0][0], poi.extent)
        if (!near(g)) continue
        if (p.subclass === 'subway_entrance') elements.push({ type: 'node', tags: { railway: 'subway_entrance' }, ...g })
        if (!label) continue
        if (p.subclass === 'bus_stop') elements.push({ type: 'node', tags: { highway: 'bus_stop', name: label }, ...g })
        else if (p.class === 'railway' && (p.subclass === 'station' || p.subclass === 'subway')) elements.push({ type: 'node', tags: { railway: 'station', name: label, 'name:en': p.name_en || '' }, ...g })
      }
    })
    const w = compact({ elements }, lng, lat, r)
    nameRoads(w, names)
    w.w.push(...crossings(w.w))
    return w
  } finally {
    clearTimeout(timer)
  }
}

function nameRoads(w, names) {
  for (const road of w.w) {
    if (road[0] !== 'road' || road[1] < 6) continue
    const f = road[2]
    for (let n = 0; n < f.length && !road[3]; n += 2) {
      const hit = names.get(`${Math.round(f[n] / 5)},${Math.round(f[n + 1] / 5)}`)
      if (hit) [road[3], road[4]] = hit
    }
  }
}

// 타일에는 횡단보도가 없어서, 찻길 세 갈래 이상이 만나는 꼭짓점마다 각 갈래를 가로지르는 선을 만든다.
// 교차로 한가운데를 비우도록 다른 길 폭의 절반 + 2m 만큼 떨어뜨린다
function crossings(ways) {
  const at = new Map()
  ways.forEach(([kind, width, flat], id) => {
    if (kind !== 'road' || width < 6) return
    for (let n = 0; n < flat.length; n += 2) {
      const key = `${Math.round(flat[n])},${Math.round(flat[n + 1])}`
      if (!at.has(key)) at.set(key, [])
      at.get(key).push([id, n])
    }
  })
  const out = []
  const seen = new Set()
  for (const arms of at.values()) {
    // 한 길이 조각나 이어지는 자리(갈래 둘)는 교차로가 아니다. 끝점은 한 갈래, 중간 점은 두 갈래
    const count = arms.reduce((sum, [id, n]) => sum + (n > 0 && n + 2 < ways[id][2].length ? 2 : 1), 0)
    // 골목끼리 만나는 곳에는 그리지 않는다. 8m 넘는 길이 지나는 교차로만
    if (count < 3 || !arms.some(([id]) => ways[id][1] >= 8)) continue
    const [id0, n0] = arms[0]
    const vx = ways[id0][2][n0]
    const vy = ways[id0][2][n0 + 1]
    const spot = `${Math.round(vx / 8)},${Math.round(vy / 8)}`
    if (seen.has(spot)) continue
    seen.add(spot)
    const wide = Math.max(...arms.map(([id]) => ways[id][1]))
    for (const [id, n] of arms) {
      const [, width, flat] = ways[id]
      for (const step of [-2, 2]) {
        const m = n + step
        if (m < 0 || m + 1 >= flat.length) continue
        const dx = flat[m] - vx
        const dy = flat[m + 1] - vy
        const len = Math.hypot(dx, dy)
        const d = wide / 2 + 2
        if (len < d + 2) continue
        const ux = dx / len
        const uy = dy / len
        const cx = vx + ux * d
        const cy = vy + uy * d
        const half = width / 2 + 1
        out.push(['cross', 4, [cx - uy * half, cy + ux * half, cx + uy * half, cy - ux * half].map((v) => Math.round(v * 2) / 2), ''])
      }
    }
  }
  return out
}
