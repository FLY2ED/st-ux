import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { createRoot } from 'react-dom/client'
import { Pin } from './pin.jsx'
import { camState } from './PixelMap.jsx'

maplibregl.setWorkerUrl(workerUrl)

// 선으로만 그린 실제 지도 (OpenFreeMap 벡터 타일, 글자 없음)
const W = 'rgba(255,255,255,'
const STYLE = {
  version: 8,
  sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': 'rgba(0,0,0,0)' } },
    { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': W + '.05)' } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#0716b8' } },
    { id: 'water-edge', type: 'line', source: 'omt', 'source-layer': 'water', paint: { 'line-color': W + '.35)', 'line-width': .8 } },
    { id: 'building', type: 'line', source: 'omt', 'source-layer': 'building', minzoom: 14,
      paint: { 'line-color': W + '.22)', 'line-width': .6 } },
    // 3D 건물: 높이에 따라 밝아진다
    { id: 'building-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14, layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#2a3cf0', 40, '#8f9bff', 90, '#ffffff'],
        'fill-extrusion-height': 0,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': .82,
      } },
    { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
      paint: { 'line-color': W + '.45)', 'line-width': 1, 'line-dasharray': [3, 3] } },
    { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'path', 'track']]],
      paint: { 'line-color': W + '.4)', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, .4, 17, 1.4] } },
    { id: 'road-mid', type: 'line', source: 'omt', 'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary']]],
      paint: { 'line-color': W + '.7)', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, .6, 17, 2.4] } },
    { id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]],
      paint: { 'line-color': W + '.95)', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, .8, 17, 3.4] } },
  ],
}

// 주변 시설 (OpenStreetMap): 역 · 버스 · 학교 · 병원
export const PLACE_KINDS = [
  ['station', '지하철역', ['railway']],
  ['bus', '버스정류장', ['bus']],
  ['school', '학교', ['school', 'college']],
  ['hospital', '병원', ['hospital']],
]
const placeLayers = PLACE_KINDS.map(([k, , cls]) => ({
  id: 'poi-' + k, type: 'symbol', source: 'omt', 'source-layer': 'poi', layout: { visibility: 'none', 'icon-image': 'p-' + k, 'icon-allow-overlap': true },
  filter: k === 'station' ? ['all', ['==', ['get', 'class'], 'railway'], ['in', ['get', 'subclass'], ['literal', ['station', 'subway', 'halt']]]] : ['in', ['get', 'class'], ['literal', cls]],
}))
STYLE.layers.push(...placeLayers)

// 시설 아이콘: 역=굵은 테두리, 버스=작은 빈 네모, 학교=세모, 병원=십자
function glyph(kind) {
  const k = 2, px = kind === 'station' ? 16 : kind === 'bus' ? 8 : 11, n = px * k, c = document.createElement('canvas')
  c.width = c.height = n
  const x = c.getContext('2d')
  x.fillStyle = '#fff'
  if (kind === 'station') { x.fillRect(0, 0, n, n); x.fillStyle = '#0b1ed6'; x.fillRect(3 * k, 3 * k, n - 6 * k, n - 6 * k); x.fillStyle = '#fff'; x.fillRect(6 * k, 6 * k, n - 12 * k, n - 12 * k) }
  if (kind === 'bus') { x.fillRect(0, 0, n, n); x.clearRect(2 * k, 2 * k, n - 4 * k, n - 4 * k) }
  if (kind === 'school') for (let r = 0; r < px; r++) { const w = Math.round((r + 1) / px * px / 2); x.fillRect((px / 2 - w) * k, r * k, w * 2 * k, k) }
  if (kind === 'hospital') { x.fillRect(4 * k, 0, 3 * k, n); x.fillRect(0, 4 * k, n, 3 * k) }
  return { image: x.getImageData(0, 0, n, n), pixelRatio: k }
}

// 반경이 화면에 다 들어오는 확대값. 모바일은 위쪽 검색창 아래로 가운데를 내린다
const mob = () => innerWidth < 760
const zoomFor = r => (mob() ? (r > 300 ? 13.9 : 14.6) : r > 300 ? 15.45 : 16.2)
export const mapPadTop = () => (mob() ? 100 : 0)

// 반경 원(미터) → 위경도 고리
const fmtM = d => (d >= 1000 ? (d / 1000).toFixed(1) + 'km' : Math.round(d / 10) * 10 + 'm')

function ring(lon, lat, r, kx, ky) {
  const pts = []
  for (let a = 0; a <= 96; a++) pts.push([lon + (Math.cos(a / 96 * Math.PI * 2) * r) / kx, lat + (Math.sin(a / 96 * Math.PI * 2) * r) / ky])
  return pts
}

// 픽셀 네모 아이콘
function square(px, fill, frame) {
  const k = 2, n = px * k, c = document.createElement('canvas')
  c.width = c.height = n
  const x = c.getContext('2d')
  if (frame) {
    x.fillStyle = '#fff'
    x.fillRect(0, 0, n, n)
    x.clearRect(2 * k, 2 * k, n - 4 * k, n - 4 * k)
    x.fillRect(4 * k, 4 * k, n - 8 * k, n - 8 * k)
  } else {
    x.fillStyle = fill
    x.fillRect(0, 0, n, n)
  }
  return { image: x.getImageData(0, 0, n, n), pixelRatio: k }
}

// 건물 높이 배율 k(0~1)를 바꿔 건물을 세우고 내린다
const H0 = ['coalesce', ['get', 'render_height'], 6], B0 = ['coalesce', ['get', 'render_min_height'], 0]
const kOf = new WeakMap()
function setH(map, k) {
  kOf.set(map, k)
  map.setLayoutProperty('building-3d', 'visibility', k > 0.001 ? 'visible' : 'none')
  map.setPaintProperty('building-3d', 'fill-extrusion-height', ['*', H0, k])
  map.setPaintProperty('building-3d', 'fill-extrusion-base', ['*', B0, k])
}
const eo = v => 1 - Math.pow(1 - v, 3)
function rise(map, to, dur, delay = 0) {
  const from = kOf.get(map) ?? 0, t0 = performance.now() + delay
  cancelAnimationFrame(map.__rise)
  const step = () => {
    const p = Math.max(0, Math.min(1, (performance.now() - t0) / dur))
    setH(map, from + (to - from) * eo(p))
    if (p < 1) map.__rise = requestAnimationFrame(step)
  }
  map.__rise = requestAnimationFrame(step)
}

export default function LineMap({ report, radius, active, onActive, onPick, shown, focus, center }) {
  // 처음부터 3D: 건물을 세우고 지도를 비스듬히 눕힌다
  const [d3, setD3] = useState(true)
  const d3Ref = useRef(d3)
  d3Ref.current = d3
  const tilt = () => (d3Ref.current ? { pitch: 58, bearing: -20 } : { pitch: 0, bearing: 0 })
  const [walk, setWalk] = useState(null)
  const box = useRef(null), mapRef = useRef(null), tipRef = useRef(null)
  const cb = useRef({ onActive, onPick })
  cb.current = { onActive, onPick }
  const { query: Q } = report
  const kx = 111320 * Math.cos((Q.lat * Math.PI) / 180), ky = 110540
  const ll = (x, y) => [Q.lon + x / kx, Q.lat + y / ky]
  const [layer, setLayer] = useState('shops')

  // 유동인구 예시 층: 가게가 몰린 곳을 40m 칸으로 번지게 해서 사람이 많은 곳처럼 보여 준다
  function flowCells() {
    const C = 40, N = 15, g = {}
    for (const [x, y] of report.shops) {
      const gx = Math.floor(x / C), gy = Math.floor(y / C)
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const k = gx + dx + ',' + (gy + dy), w = 1 / (1 + dx * dx + dy * dy)
        g[k] = (g[k] || 0) + w
      }
    }
    const max = Math.max(...Object.values(g))
    return Object.entries(g).filter(([k, v]) => { const [a, b] = k.split(',').map(Number); return Math.hypot(a + .5, b + .5) <= N && v / max > .12 }).map(([k, v]) => {
      const [a, b] = k.split(',').map(Number), x0 = a * C + 2, y0 = b * C + 2, x1 = x0 + C - 4, y1 = y0 + C - 4
      return { type: 'Feature', properties: { v: Math.pow(v / max, 1.3) }, geometry: { type: 'Polygon', coordinates: [[ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)]] } }
    })
  }

  useEffect(() => {
    const map = new maplibregl.Map({
      container: box.current, style: STYLE, center: [Q.lon, Q.lat], zoom: 15,
      attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 0,
    })
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    mapRef.current = map
    window.__map = map
    map.on('load', () => {
      const add = (id, { image, pixelRatio }) => map.addImage(id, image, { pixelRatio })
      add('sq', square(6, 'rgba(255,255,255,.55)'))
      add('cafe', square(11, '#fff'))
      add('hi', square(19, '#fff', true))
      PLACE_KINDS.forEach(([k]) => add('p-' + k, glyph(k)))
      map.addSource('walk', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'walk', type: 'line', source: 'walk', layout: { visibility: 'none' }, paint: { 'line-color': '#fff', 'line-width': 2, 'line-dasharray': [1, 1.5] } })
      map.addSource('radius', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': W + '.06)' } })
      map.addLayer({ id: 'radius', type: 'line', source: 'radius', paint: { 'line-color': '#fff', 'line-width': 1.6, 'line-dasharray': [2, 2] } })
      const shops = report.shops.filter(s => s[2] !== Q.cat).map(([x, y, c], i) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: ll(x, y) }, properties: { i, d: Math.hypot(x, y), c: report.cats[c] },
      }))
      const cafes = report.competitors.map((s, i) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: ll(s.x, s.y) }, properties: { i, d: s.dist },
      }))
      map.addSource('flow', { type: 'geojson', data: { type: 'FeatureCollection', features: flowCells() } })
      map.addLayer({ id: 'flow', type: 'fill', source: 'flow', layout: { visibility: 'none' }, paint: { 'fill-color': '#fff', 'fill-opacity': ['*', ['get', 'v'], .75] } })
      map.addSource('shops', { type: 'geojson', data: { type: 'FeatureCollection', features: shops } })
      map.addSource('cafes', { type: 'geojson', data: { type: 'FeatureCollection', features: cafes } })
      map.addLayer({ id: 'shops', type: 'symbol', source: 'shops', layout: { 'icon-image': 'sq', 'icon-allow-overlap': true } })
      map.addLayer({ id: 'cafes', type: 'symbol', source: 'cafes', layout: { 'icon-image': 'cafe', 'icon-allow-overlap': true } })
      map.addLayer({ id: 'cafe-hi', type: 'symbol', source: 'cafes', filter: ['==', ['get', 'i'], -1], layout: { 'icon-image': 'hi', 'icon-allow-overlap': true } })
      setRadius(map, radius)
      map.on('mousemove', 'cafes', e => cb.current.onActive(e.features[0].properties.i))
      map.on('mouseleave', 'cafes', () => cb.current.onActive(null))
      map.on('click', 'cafes', e => cb.current.onPick(e.features[0].properties.i))
      map.on('mouseenter', 'cafes', () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', 'cafes', () => (map.getCanvas().style.cursor = ''))
    })
    const el = document.createElement('div')
    el.className = 'mpin'
    createRoot(el).render(<Pin size={30} />)
    new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([Q.lon, Q.lat]).addTo(map)
    const move = () => place(map)
    map.on('move', move)
    return () => map.remove()
  }, [])

  function setRadius(map, r) {
    const src = map.getSource('radius')
    if (!src) return
    src.setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring(Q.lon, Q.lat, r, kx, ky)] } })
    map.setPaintProperty('shops', 'icon-opacity', ['case', ['<=', ['get', 'd'], r], 1, .35])
    map.setPaintProperty('cafes', 'icon-opacity', ['case', ['<=', ['get', 'd'], r], 1, .45])
  }
  useEffect(() => { if (mapRef.current?.loaded()) setRadius(mapRef.current, radius) }, [radius])

  // 선택된 카페: 큰 테두리 네모 + 유리 툴팁
  function place(map) {
    const tip = tipRef.current, i = tip.dataset.i
    if (i === '' || i == null) { tip.style.opacity = 0; return }
    const s = report.competitors[+i]
    const p = map.project(ll(s.x, s.y))
    tip.style.opacity = 1
    tip.style.transform = `translate(${Math.min(p.x + 16, box.current.clientWidth - tip.offsetWidth - 10)}px,${p.y + 14}px)`
  }
  useEffect(() => {
    const map = mapRef.current, tip = tipRef.current
    if (!map) return
    tip.dataset.i = active ?? ''
    if (active != null) {
      const s = report.competitors[active]
      tip.innerHTML = `<b>${s.name}</b><span class="m">${s.dist}M · ${s.floor > 0 ? s.floor + 'F' : s.floor < 0 ? 'B' + -s.floor : 'FLOOR —'}</span>`
    }
    if (map.getLayer('cafe-hi')) map.setFilter('cafe-hi', ['==', ['get', 'i'], active ?? -1])
    place(map)
  }, [active])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.getLayer('flow')) return
    const vis = (id, on) => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    vis('flow', layer === 'flow')
    vis('shops', layer === 'shops')
    PLACE_KINDS.forEach(([k]) => vis('poi-' + k, layer === 'place'))
    vis('walk', layer === 'place')
    if (layer === 'place') {
      // 지금 불러온 타일에서 가장 가까운 지하철역을 찾아 걸어서 몇 분인지 잰다
      const find = () => {
        const fs = map.querySourceFeatures('omt', { sourceLayer: 'poi', filter: ['all', ['==', ['get', 'class'], 'railway'], ['in', ['get', 'subclass'], ['literal', ['station', 'subway']]]] })
        let best = null
        for (const f of fs) {
          const [lon, lat] = f.geometry.coordinates, d = Math.hypot((lon - Q.lon) * kx, (lat - Q.lat) * ky)
          if (!best || d < best.d) best = { d, lon, lat, name: f.properties['name:ko'] || f.properties.name }
        }
        if (!best) return false
        map.getSource('walk').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[Q.lon, Q.lat], [best.lon, best.lat]] } })
        setWalk({ ...best, name: /역$/.test(best.name || '') ? best.name : (best.name || '지하철') + '역', min: Math.round((best.d * 1.3) / 67) })
        return true
      }
      if (!find()) map.once('idle', find)
      map.easeTo({ zoom: Math.min(map.getZoom(), mob() ? 14.2 : 15.2), duration: 700 })
    }
  }, [layer])

  // 2D ↔ 3D: 지도를 눕히면서 건물이 바닥에서 서서히 솟는다 (내릴 땐 거꾸로)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const map = mapRef.current
    if (!map?.getLayer('building-3d')) return
    map.easeTo({ ...tilt(), duration: 1200 })
    rise(map, d3 ? 1 : 0, d3 ? 1500 : 900, d3 ? 200 : 0)
  }, [d3])

  // 고른 카페로 이동
  useEffect(() => {
    const map = mapRef.current
    if (!map || focus == null) return
    const s = report.competitors[focus]
    map.easeTo({ center: ll(s.x, s.y), zoom: Math.max(map.getZoom(), 16.6), duration: 700 })
  }, [focus])

  // 픽셀 지도에서 넘겨받기: 같은 배율로 맞춰 둔 뒤 거리 수준까지 들어간다
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (shown) {
      const st = camState.get()
      const z0 = st ? Math.log2((st.cssPerCell / st.st) * 360 / 512) : 15
      map.jumpTo({ center: [Q.lon, Q.lat], zoom: z0, padding: { top: mapPadTop() } })
      map.resize()
      map.easeTo({ center: [Q.lon, Q.lat], zoom: zoomFor(radius), ...tilt(), padding: { top: mapPadTop() }, duration: 1600, delay: 150 })
      const up = () => { setH(map, 0); rise(map, 1, 1600, 900) }
      if (d3Ref.current) map.getLayer('building-3d') ? up() : map.once('load', up)
    }
  }, [shown])
  useEffect(() => {
    const map = mapRef.current
    if (map && shown && center) map.easeTo({ center: [Q.lon, Q.lat], zoom: zoomFor(radius), padding: { top: mapPadTop() }, duration: 700 })
  }, [radius, center])

  return (
    <div className="mapwrap">
      <div ref={box} className="linemap" />
      <div ref={tipRef} className="tip glass maptip" />
      <div className="layers glass" role="group" aria-label="지도에 보이는 것">
        {[['shops', '가게'], ['flow', '유동인구 · 예시'], ['place', '주변 시설']].map(([k, t]) => <button key={k} className={layer === k ? 'on' : ''} onClick={() => setLayer(k)}>{t}</button>)}
        <span className="seg" role="group" aria-label="2D 3D 보기">
          <i className={d3 ? 'r' : ''} />
          <button className={'m' + (d3 ? '' : ' on')} onClick={() => setD3(false)} aria-pressed={!d3}>2D</button>
          <button className={'m' + (d3 ? ' on' : '')} onClick={() => setD3(true)} aria-pressed={d3}>3D</button>
        </span>
      </div>
      <div className={'legendmap glass' + (layer === 'flow' ? ' on' : '')}><span>적음</span><i /><span>많음</span></div>
      <div className={'legendmap places glass' + (layer === 'place' ? ' on' : '')}>
        {PLACE_KINDS.map(([k, t]) => <span key={k}><i className={'pk-' + k} />{t}</span>)}
      </div>
      {layer === 'place' && walk && (
        <div className="walk glass"><span className="m">NEAREST STATION</span><b>{walk.name}</b><em>직선 {fmtM(walk.d)} · 걸어서 약 <strong className="m">{walk.min}분</strong></em></div>
      )}
    </div>
  )
}
