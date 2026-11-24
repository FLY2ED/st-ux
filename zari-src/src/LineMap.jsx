import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { createRoot } from 'react-dom/client'
import { Pin } from './pin.jsx'
import { camState } from './PixelMap.jsx'
import { DEMO, BRANDS, BRAND_NAME } from './demo.js'
import { MOVE_MAX } from './place.js'
import { popCells } from './extra.js'

maplibregl.setWorkerUrl(workerUrl)

// 선으로만 그린 실제 지도 (OpenFreeMap 벡터 타일, 글자 없음)
const W = 'rgba(255,255,255,'
// 가게·카페·유동인구·시설 표시는 흰 선(길·건물)과 섞이지 않게 검은색 계열로
const INK = '#05081c'
const STYLE = {
  version: 8,
  sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    sat: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], attribution: 'Esri World Imagery' } },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': 'rgba(0,0,0,0)' } },
    { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': W + '.05)' } },
    { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#465166' } },
    { id: 'water-edge', type: 'line', source: 'omt', 'source-layer': 'water', paint: { 'line-color': W + '.35)', 'line-width': .8 } },
    { id: 'building', type: 'line', source: 'omt', 'source-layer': 'building', minzoom: 14,
      paint: { 'line-color': W + '.22)', 'line-width': .6 } },
    // 3D 건물: 높이에 따라 밝아진다
    { id: 'building-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14, layout: { visibility: 'none' },
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#56627a', 40, '#a6b0c2', 90, '#ffffff'],
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
function glyph(kind, ink = INK) {
  const k = 2, px = kind === 'station' ? 16 : kind === 'bus' ? 8 : 11, n = px * k, c = document.createElement('canvas')
  c.width = c.height = n
  const x = c.getContext('2d')
  x.fillStyle = ink
  if (kind === 'station') { x.fillRect(0, 0, n, n); x.fillStyle = '#6b7689'; x.fillRect(3 * k, 3 * k, n - 6 * k, n - 6 * k); x.fillStyle = ink; x.fillRect(6 * k, 6 * k, n - 12 * k, n - 12 * k) }
  if (kind === 'bus') { x.fillRect(0, 0, n, n); x.clearRect(2 * k, 2 * k, n - 4 * k, n - 4 * k) }
  if (kind === 'school') for (let r = 0; r < px; r++) { const w = Math.round((r + 1) / px * px / 2); x.fillRect((px / 2 - w) * k, r * k, w * 2 * k, k) }
  if (kind === 'hospital') { x.fillRect(4 * k, 0, 3 * k, n); x.fillRect(0, 4 * k, n, 3 * k) }
  return { image: x.getImageData(0, 0, n, n), pixelRatio: k }
}

// 반경이 화면에 다 들어오는 확대값. 모바일은 위쪽 검색창 아래로 가운데를 내린다
const mob = () => innerWidth < 760
const zoomFor = r => (mob() ? (r > 300 ? 13.9 : 14.6) : r > 300 ? 15.45 : 16.2)
export const mapPadTop = () => (mob() ? 40 : 0)

// 반경 원(미터) → 위경도 고리
export const shortAddr = a => a.replace(/^서울\S*\s+(\S+구\s+)?/, '')
const fmtM = d => (d >= 1000 ? (d / 1000).toFixed(1) + 'km' : Math.round(d / 10) * 10 + 'm')

function ring(lon, lat, r, kx, ky) {
  const pts = []
  for (let a = 0; a <= 96; a++) pts.push([lon + (Math.cos(a / 96 * Math.PI * 2) * r) / kx, lat + (Math.sin(a / 96 * Math.PI * 2) * r) / ky])
  return pts
}

// 유동인구 재생 막대의 시각 이름·설명 (사람 수는 서울 생활인구 칸에서 읽는다)
const PROF = {
  h: {
    n: 24,
    lab: h => `${Math.floor(h)}시`,
    note: h => (h < 6 ? '새벽' : h < 10 ? '출근 · 등교' : h < 11 ? '오전' : h < 14 ? '점심 · 수업 사이' : h < 17 ? '오후 수업' : h < 21 ? '퇴근 · 하교' : '저녁'),
  },
  m: {
    n: 12,
    lab: m => `${Math.floor(m) + 1}월`,
  },
}
const at = (arr, t) => { const n = arr.length, i = Math.floor(t) % n, f = t - Math.floor(t); return arr[i] * (1 - f) + arr[(i + 1) % n] * f }

// 픽셀 네모 아이콘
function square(px, fill, frame) {
  const k = 2, n = px * k, c = document.createElement('canvas')
  c.width = c.height = n
  const x = c.getContext('2d')
  if (frame) {
    x.fillStyle = fill
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
  map.setLayoutProperty('building-3d', 'visibility', k > 0.001 && !map.__solo ? 'visible' : 'none')
  map.setPaintProperty('building-3d', 'fill-extrusion-height', ['*', H0, k])
  map.setPaintProperty('building-3d', 'fill-extrusion-base', ['*', B0, k])
  // 높이만 바뀌면 바닥에 납작한 면이 한꺼번에 생겨 보인다 → 투명도도 같이 올린다
  const f = Math.min(1, k * k)
  map.setPaintProperty('building-3d', 'fill-extrusion-opacity', .82 * f * f * (3 - 2 * f))
  // 지도 3D 건물(같은 자리)보다 조금 높게 세워야 가려지지 않는다
  const hx = ['max', .4, ['*', ['+', ['max', ['coalesce', ['feature-state', 'oh'], 0], ['coalesce', ['get', 'h'], 10]], 1.5], k]]
  for (const id of ['ob-hi', 'ob-col']) if (map.getLayer(id)) map.setPaintProperty(id, 'fill-extrusion-height', hx)
}
// 건물 색 · 한 번에 보기: 내 자리 · 카페 · 공실 후보 · 다른 가게
// 오렌지는 공실에만 쓴다. 다른 건물은 땅(검정)과 잘 갈리도록 밝은 회색으로
const LAND = '#1d2027'
const BC = { tgt: '#3b6fe0', cafe: '#ffffff', empty: '#f08a3c', shop: '#a3abb8', none: '#626a78' }
// 반경만 보기: 원은 검은 땅, 왼쪽에서 읽는 항목(fk)의 건물만 밝게(카페·가게는 흰색) 두고 나머지는 땅 쪽으로 어둡게
const KEYX = { tgt: ['==', ['get', 'tgt'], 1], cafe: ['>', ['coalesce', ['get', 'cafe'], 0], 0], empty: ['==', ['get', 'empty'], 1], shop: ['>', ['coalesce', ['get', 'n'], 0], 0] }
KEYX.both = ['any', KEYX.cafe, KEYX.empty]
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const dim = (h, k = .55) => 'rgb(' + rgb(h).map((v, i) => Math.round(rgb(LAND)[i] + (v - rgb(LAND)[i]) * k)).join(',') + ')'
// budget(만 원): 처음 드는 돈이나 매달 내는 돈이 예산을 넘는 공실은 흐린 오렌지
function bcColor(fk, ids = [], budget) {
  const F = fk === 'near' ? ['in', ['get', 'i'], ['literal', ids]] : KEYX[fk]
  const c = k => (!F ? BC[k] : ['case', F, k === 'tgt' || k === 'empty' ? BC[k] : '#ffffff', dim(BC[k])])
  const over = budget ? ['any', ['>', ['coalesce', ['get', 'start'], 0], budget.start], ['>', ['coalesce', ['get', 'month'], 0], budget.month]] : false
  return ['case', KEYX.tgt, c('tgt'), KEYX.cafe, c('cafe'), ['all', KEYX.empty, over], dim(BC.empty, .35), KEYX.empty, c('empty'), KEYX.shop, c('shop'), c('none')]
}
// 둥근 렌즈(v2) 건물 색: 다른 건물은 땅보다 조금 밝은 남색, 가게는 그보다 조금 밝게
// 문장(fk)이나 층에 따라 밝힐 것만 밝히고, 유동인구·공고 층에선 모두 낮춘다
const BD = { tgt: '#2f5bea', cafe: '#f7f7f7', empty: '#f26b1d', shop: '#2f3647', none: '#272d3c' }
// off: 리포트가 아직 가려져 있을 때 · 내 자리만 파랗고 나머지는 빈 건물 색 (드러나면 여기서부터 번져 칠한다)
const OFF = ['case', KEYX.tgt, BD.tgt, BD.none]
function bareColor(fk, layer, budget, off) {
  if (off) return OFF
  const mute = layer === 'flow' || layer === 'list' || layer === 'place'
  const all = layer === 'shops'
  const cafeOn = !mute && (all || !fk || fk === 'cafe' || fk === 'both' || fk === 'tgt')
  const emptyOn = !mute && (all || !fk || fk === 'empty' || fk === 'both' || fk === 'tgt')
  const over = budget ? ['any', ['>', ['coalesce', ['get', 'start'], 0], budget.start], ['>', ['coalesce', ['get', 'month'], 0], budget.month]] : false
  return ['case', KEYX.tgt, BD.tgt,
    // 문장은 걸어서 5분(300m) 안 카페만 말하므로 그 밖 카페는 낮춘다
    ['all', KEYX.cafe, ['<=', ['coalesce', ['get', 'dist'], 9999], 300]], cafeOn ? BD.cafe : '#454c5d',
    KEYX.cafe, all ? BD.cafe : '#454c5d',
    ['all', KEYX.empty, over], emptyOn ? '#8d4a26' : '#4a3832',
    KEYX.empty, emptyOn ? BD.empty : '#6a4330',
    KEYX.shop, all ? BD.cafe : BD.shop, BD.none]
}
export const BC_KEYS = [['cafe', '카페'], ['empty', '공실'], ['shop', '다른 가게'], ['tgt', '내 자리']]
const eo = v => 1 - Math.pow(1 - v, 3)
const eio = v => (v < .5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2)
// 렌즈에서 켜고 끄는 층: 보이기 대신 투명도를 서서히 바꾼다
const OPK = { fill: 'fill-opacity', line: 'line-opacity', symbol: 'icon-opacity', 'fill-extrusion': 'fill-extrusion-opacity' }
const FULL = { iso: .8, 'iso-fill': .045, 'ob-col': .92 }
const FADES = ['park', 'water', 'water-edge', 'building', ...PLACE_KINDS.map(([k]) => 'poi-' + k), 'walk', 'iso', 'iso-fill', 'ob-col']
function fadeTo(map, id, on, ms = 700) {
  const p = OPK[map.getLayer(id).type]
  map.setPaintProperty(id, p + '-transition', { duration: ms, delay: 0 })
  map.setPaintProperty(id, p, on ? FULL[id] ?? 1 : 0)
}
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

// 건물 색 지도에서도 도로 선은 건물 위에 그린다
const ROADS = ['road-minor', 'road-mid', 'road-major', 'rail']
// 건물 색 지도: 걸어서 5분 원(지름 2r)이 지도 칸을 거의 채우는 확대값 (입체면 세로가 눌려 보이는 만큼 더 키움)
function soloZoom(el, r, lat, d3) {
  const w = el.clientWidth, h = el.clientHeight - mapPadTop() - (mob() ? 20 : 70)
  const px = Math.min(w * .9, (h * .9) / (d3 ? .62 : 1))
  return Math.log2((px * 40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 * r))
}
// 둥근 렌즈(v2): 렌즈 지름의 k만큼 반경 r 원이 차는 확대값
function lensZoom(el, r, lat, k = .8) {
  // 넓게 보기에선 지도 칸이 화면만큼 커져도 원(.lens) 크기를 기준으로 잰다
  const L = el.closest?.('.lens') || el
  const px = Math.min(L.clientWidth, L.clientHeight) * k
  return Math.log2((px * 40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 * r))
}
const LOOK = new Set(['shops', 'flow', 'place'])
// 건물 색 지도에서는 끌기·확대를 막아 원이 그 자리에 머문다
function lock(map, on) {
  for (const h of [map.dragPan, map.scrollZoom, map.boxZoom, map.doubleClickZoom, map.touchZoomRotate, map.keyboard]) on ? h.disable() : h.enable()
  if (!on) map.touchZoomRotate.disableRotation()
}
// 렌즈: 늘 끌어서 옮기고, 오른쪽 버튼(또는 두 손가락)으로 돌리고 기울일 수 있게. 휠 확대는 넓게 볼 때만(작게 볼 땐 휠이 문장을 넘긴다)
function roam(map, wheel) {
  for (const h of [map.dragPan, map.dragRotate, map.touchZoomRotate, map.touchPitch, map.doubleClickZoom]) h.enable()
  map.touchZoomRotate.enableRotation()
  wheel ? map.scrollZoom.enable() : map.scrollZoom.disable()
  map.boxZoom.disable(); map.keyboard.disable()
}

// ctl: 밖에서 정하는 층·보기 { layer, d3, sat, fk } · bare: 버튼·범례 없이 지도만(둥근 렌즈) · pts: 'list' 층에 찍을 점 [{lon, lat, t}]
export default function LineMap({ report, bld, radius, active, onActive, onPick, shown, focus, center, budget, onMove, ctl, bare, pts }) {
  // 처음엔 위성 사진 없이 건물을 세운 3D (위성은 스위치로 켠다)
  const [d3S, setD3] = useState(true)
  const [satS, setSat] = useState(false)
  const d3 = ctl?.d3 ?? d3S, sat = ctl?.sat ?? satS
  const bareRef = useRef(bare)
  bareRef.current = bare
  const padTop = () => (bareRef.current ? 0 : mapPadTop())
  const d3Ref = useRef(d3)
  d3Ref.current = d3
  const tilt = () => (d3Ref.current ? { pitch: 58, bearing: -20 } : { pitch: 0, bearing: 0 })
  const [walk, setWalk] = useState(null)
  const box = useRef(null), mapRef = useRef(null), tipRef = useRef(null), pinRef = useRef(null), fkRef = useRef('tgt'), bldRef = useRef(null)
  const cb = useRef({ onActive, onPick })
  cb.current = { onActive, onPick }
  const { query: Q } = report
  const kx = 111320 * Math.cos((Q.lat * Math.PI) / 180), ky = 110540
  const ll = (x, y) => [Q.lon + x / kx, Q.lat + y / ky]
  const [layerS, setLayer] = useState('bcol')
  const layer = ctl?.layer ?? layerS
  const [ready, setReady] = useState(false)
  const [sel, setSel] = useState(null)
  bldRef.current = bld
  const layerRef = useRef(layer), budgetRef = useRef(budget)
  layerRef.current = layer; budgetRef.current = budget
  const zoomNow = () => (bareRef.current && box.current ? lensZoom(box.current, radius, Q.lat) : layerRef.current === 'bcol' && box.current ? soloZoom(box.current, radius, Q.lat, (mapRef.current?.getPitch() ?? 0) > 10) : zoomFor(radius))
  const ohSet = useRef(new Set()).current
  const [fm, setFm] = useState('h'), [ft, setFt] = useState(7), [play, setPlay] = useState(true)
  // 서울 생활인구 250m 칸(평일 시간대 평균). 못 읽으면 유동인구 층 버튼을 숨긴다
  const [pop, setPop] = useState(null)
  useEffect(() => {
    let on = true
    popCells(Q.lon, Q.lat).then(p => on && p.cells.length && setPop(p)).catch(() => {})
    return () => { on = false }
  }, [Q.lon, Q.lat])

  // 유동인구 층 자리 잡기: 생활인구 칸을 읽기 전 빈 층(버튼은 생활인구를 읽은 뒤에만 보인다)

  useEffect(() => {
    const map = new maplibregl.Map({
      container: box.current, style: STYLE, center: [Q.lon, Q.lat], zoom: 15,
      attributionControl: false, dragRotate: !!bare, pitchWithRotate: !!bare, fadeDuration: 0,
      // 렌즈 평면에선 기울기를 0으로 묶고, 입체일 때만 풀어 준다
      ...(bare ? { maxPitch: d3Ref.current ? 70 : 0 } : {}),
    })
    map.touchZoomRotate.disableRotation()
    // 사람이 직접 옮기거나 돌렸는지 기억해 두었다가, 문장이 바뀌면 이 자리로 되돌린다
    if (bare) for (const t of ['dragstart', 'rotatestart', 'pitchstart', 'zoomstart']) map.on(t, e => { if (e.originalEvent) map.__moved = true })
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    mapRef.current = map
    window.__map = map
    map.on('load', () => {
      const add = (id, { image, pixelRatio }) => map.addImage(id, image, { pixelRatio })
      add('sq', square(6, bare ? 'rgba(196,203,214,.75)' : 'rgba(5,8,28,.6)'))
      add('cafe', square(11, bare ? '#fff' : INK))
      add('hi', square(19, bare ? '#fff' : INK, true))
      PLACE_KINDS.forEach(([k]) => add('p-' + k, glyph(k, bare ? '#fff' : INK)))
      map.addSource('walk', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'walk', type: 'line', source: 'walk', layout: { visibility: 'none' }, paint: { 'line-color': '#fff', 'line-width': 2, 'line-dasharray': [1, 1.5] } })
      // 걸어서 5분 · 10분 (길이 돌아가는 만큼 직선 거리를 1.3으로 나눔)
      map.addSource('iso', { type: 'geojson', data: { type: 'FeatureCollection', features: ISO.map(([min, r]) => ({ type: 'Feature', properties: { min }, geometry: { type: 'Polygon', coordinates: [ring(Q.lon, Q.lat, r, kx, ky)] } })) } })
      map.addLayer({ id: 'iso-fill', type: 'fill', source: 'iso', layout: { visibility: 'none' }, paint: { 'fill-color': '#fff', 'fill-opacity': ['case', ['==', ['get', 'min'], 5], .08, .04] } })
      map.addLayer({ id: 'iso', type: 'line', source: 'iso', layout: { visibility: 'none' }, paint: { 'line-color': '#fff', 'line-width': ['case', ['==', ['get', 'min'], 5], 1.6, 1], 'line-opacity': .8 } })
      // 반경만 보기: 원 안에 흑백 위성
      map.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' },
        paint: { 'raster-saturation': -1, 'raster-brightness-max': .75, 'raster-contrast': .1, 'raster-opacity': 0, 'raster-opacity-transition': { duration: 450, delay: 0 } } })
      map.addSource('radius', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': W + '.06)' } })
      map.addLayer({ id: 'radius', type: 'line', source: 'radius', paint: { 'line-color': '#fff', 'line-width': 1.6, 'line-dasharray': [2, 2] } })
      // Overture 건물: 평소엔 안 보이고, 카페에 올리거나 건물을 누르면 그 건물만 파랗게 세운다
      map.addSource('ob', { type: 'geojson', promoteId: 'i', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'ob', type: 'fill', source: 'ob', paint: { 'fill-color': '#fff', 'fill-opacity': .001 } })
      map.addLayer({ id: 'ob-col', type: 'fill-extrusion', source: 'ob', layout: { visibility: 'none' },
        filter: ['any', ['==', ['get', 'tgt'], 1], ['<=', ['get', 'dist'], 300]], // 걸어서 5분 원 안 건물만 색칠
        paint: { 'fill-extrusion-opacity': .92, 'fill-extrusion-height': .4,
          'fill-extrusion-color': bcColor(null) } })
      map.addLayer({ id: 'ob-empty', type: 'line', source: 'ob', layout: { visibility: 'none' }, filter: ['==', ['get', 'empty'], 1],
        paint: { 'line-color': BC.empty, 'line-width': 2.5, 'line-dasharray': [2, 1.5] } })
      map.addLayer({ id: 'ob-hi', type: 'fill-extrusion', source: 'ob', filter: ['in', ['get', 'i'], ['literal', []]],
        paint: { 'fill-extrusion-color': '#3b6fe0', 'fill-extrusion-opacity': .9, 'fill-extrusion-height': .4 } })
      map.addLayer({ id: 'ob-line', type: 'line', source: 'ob', filter: ['in', ['get', 'i'], ['literal', []]], paint: { 'line-color': '#3b6fe0', 'line-width': 5 } })
      const shops = report.shops.map((s, i) => [s, i]).filter(([s]) => s[2] !== Q.cat).map(([[x, y, c], i]) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: ll(x, y) }, properties: { i, d: Math.hypot(x, y), c: report.cats[c] },
      }))
      const cafes = report.competitors.map((s, i) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: ll(s.x, s.y) }, properties: { i, d: s.dist },
      }))
      map.addSource('flow', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'flow', type: 'fill', source: 'flow', layout: { visibility: 'none' }, paint: { 'fill-color': bare ? '#fff' : INK, 'fill-opacity': ['*', ['get', 'v'], .8] } })
      map.addSource('shops', { type: 'geojson', data: { type: 'FeatureCollection', features: shops } })
      map.addSource('cafes', { type: 'geojson', data: { type: 'FeatureCollection', features: cafes } })
      map.addLayer({ id: 'shops', type: 'symbol', source: 'shops', layout: { 'icon-image': 'sq', 'icon-allow-overlap': true } })
      map.addLayer({ id: 'cafes', type: 'symbol', source: 'cafes', layout: { 'icon-image': 'cafe', 'icon-allow-overlap': true } })
      map.addLayer({ id: 'cafe-hi', type: 'symbol', source: 'cafes', filter: ['==', ['get', 'i'], -1], layout: { 'icon-image': 'hi', 'icon-allow-overlap': true } })
      if (bare) {
        // 렌즈: 반경 밖 건물도 낮은 남색 면으로, 길은 세 단계 회색 선으로
        map.addLayer({ id: 'bfill', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': BD.none } }, 'rail')
        const RD = { 'road-minor': ['#3a4254', .6], 'road-mid': ['#566074', 1.1], 'road-major': ['#8a93a5', 2.2], rail: ['#3a4254', .6] }
        for (const [id, [c, w]] of Object.entries(RD)) { map.setPaintProperty(id, 'line-color', c); map.setPaintProperty(id, 'line-width', w) }
        // 건물 윗면이 조명에 밝아지지 않게 (시안처럼 낮은 남색 그대로)
        map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: .12 })
        map.setPaintProperty('ob-col', 'fill-extrusion-vertical-gradient', false)
        // 켜고 끄는 층은 늘 켜 두고 투명도 0에서 시작한다 (나중에 서서히 올리고 내림)
        for (const id of FADES) { map.setPaintProperty(id, OPK[map.getLayer(id).type], 0); map.setLayoutProperty(id, 'visibility', 'visible') }
        // 유동인구: 칸 대신 칸 가운데 점을 번지게 그린 안개
        map.addSource('flowpt', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({ id: 'flow-heat', type: 'heatmap', source: 'flowpt', layout: { visibility: 'none' }, paint: {
          'heatmap-radius': 160, 'heatmap-intensity': 2.6, 'heatmap-opacity': 0, 'heatmap-weight': ['get', 'd'],
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(247,247,247,0)', .2, 'rgba(190,196,208,.14)', .55, 'rgba(225,228,235,.5)', 1, 'rgba(250,250,250,.85)'] } })
      }
      setRadius(map, radius)
      setReady(true)
      map.on('mousemove', 'cafes', e => cb.current.onActive(e.features[0].properties.i))
      map.on('mouseleave', 'cafes', () => cb.current.onActive(null))
      map.on('click', 'cafes', e => { const i = e.features[0].properties.i; cb.current.onPick(i); if (!bareRef.current) setSel({ cafe: i }) })
      map.on('click', 'shops', e => { if (!bareRef.current && !map.queryRenderedFeatures(e.point, { layers: ['cafes'] }).length) setSel({ shop: e.features[0].properties.i }) })
      map.on('click', e => {
        if (bareRef.current || map.queryRenderedFeatures(e.point, { layers: ['cafes', 'shops'] }).length) return
        const b = map.queryRenderedFeatures(e.point, { layers: ['ob'] })[0]
        setSel(b ? { bld: b.properties.i } : null)
      })
      for (const id of ['cafes', 'shops', 'ob']) {
        map.on('mouseenter', id, () => (map.getCanvas().style.cursor = 'pointer'))
        map.on('mouseleave', id, () => (map.getCanvas().style.cursor = ''))
      }
    })
    const el = document.createElement('div')
    el.className = 'mpin'
    createRoot(el).render(<Pin size={30} />)
    new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([Q.lon, Q.lat]).addTo(map)
    if (bare) {
      const me = document.createElement('div')
      me.className = 'medot'
      new maplibregl.Marker({ element: me, anchor: 'center' }).setLngLat([Q.lon, Q.lat]).addTo(map)
    }
    const move = () => { place(map); clip(map); drawPins(map) }
    map.on('move', move)
    return () => map.remove()
  }, [])

  // 반경만 보기: 지도 그림을 화면 위 원 모양으로 잘라 원 밖에는 아무것도 안 그린다(세운 건물 포함)
  function clip(map) {
    const c = map.getCanvas()
    if (!map.__solo || bareRef.current) { c.style.clipPath = ''; return }
    const pts = ring(Q.lon, Q.lat, map.__r ?? 300, kx, ky).map(q => { const p = map.project(q); return `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px` })
    c.style.clipPath = `polygon(${pts.join(',')})`
  }
  function setRadius(map, r) {
    const src = map.getSource('radius')
    if (!src) return
    src.setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring(Q.lon, Q.lat, r, kx, ky)] } })
    map.__r = r; clip(map)
    map.setPaintProperty('shops', 'icon-opacity', ['case', ['<=', ['get', 'd'], r], 1, .35])
    map.setPaintProperty('cafes', 'icon-opacity', ['case', ['<=', ['get', 'd'], r], 1, .45])
  }
  useEffect(() => { if (mapRef.current?.loaded()) setRadius(mapRef.current, radius) }, [radius])

  // 선택된 카페: 큰 테두리 네모 + 유리 툴팁
  function place(map) {
    const tip = tipRef.current; if (!tip) return
    const i = tip.dataset.i
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
    vis('flow', layer === 'flow' && !bare)
    if (bare) {
      // 유동인구 안개는 켜고 끌 때 서서히
      if (layer === 'flow') vis('flow-heat', true)
      map.setPaintProperty('flow-heat', 'heatmap-opacity-transition', { duration: 800, delay: 0 })
      map.setPaintProperty('flow-heat', 'heatmap-opacity', layer === 'flow' ? .9 : 0)
      vis('cafes', false); vis('cafe-hi', false)
    }
    vis('shops', layer === 'shops' && !bare)
    // 렌즈에선 역·학교 층만 빼고 늘 건물 색 지도
    const solo = bare ? layer !== 'place' : layer === 'bcol'
    if (bare) {
      // 렌즈: 역·학교로 넘어가고 돌아올 때 한 번에 바뀌지 않게 투명도로 서서히
      for (const id of FADES) fadeTo(map, id, id === 'ob-col' ? solo : id.startsWith('poi-') || id === 'walk' || id.startsWith('iso') ? layer === 'place' : !solo)
    } else {
      PLACE_KINDS.forEach(([k]) => vis('poi-' + k, layer === 'place'))
      vis('walk', layer === 'place')
      vis('iso', layer === 'place'); vis('iso-fill', layer === 'place')
      vis('radius', layer !== 'place'); vis('radius-fill', layer !== 'place')
      vis('ob-col', solo)
    }
    vis('ob-empty', false)
    // 건물 색 지도로 들어오면 원을 크게 맞추고 지도를 고정, 나가면 다시 움직이게
    if (!bare && map.__solo !== undefined && solo !== map.__solo && solo) map.easeTo({ center: [Q.lon, Q.lat], zoom: zoomNow(), padding: { top: padTop() }, duration: 700 })
    // 렌즈: 넓게 보기에서만 모든 가게·생활인구·역·학교를 끌고 확대해 둘러볼 수 있게 (방향키는 문장 넘기기에 양보)
    if (bare) roam(map, lookRef.current && LOOK.has(layer))
    else lock(map, solo)
    map.__solo = solo
    document.documentElement.classList.toggle('solo', solo)
    if (!bare) for (const l of STYLE.layers) if (l.id !== 'bg' && l.id !== 'building-3d') vis(l.id, !solo || ROADS.includes(l.id))
    if (bare) vis('bfill', true)
    // 도로 선을 색 건물 위로 올린다
    for (const id of ROADS) map.moveLayer(id, 'ob-hi')
    setH(map, kOf.get(map) ?? 0)
    // 위성 층은 건물 색 지도에선 늘 켜 두고(타일을 미리 받음) 투명도만 바꾼다 → 스위치 누를 때 번쩍이지 않게
    vis('sat', bare || solo); clip(map)
    satPaint(map, solo)
    map.setPaintProperty('radius', 'line-opacity', bare ? 0 : solo ? 0 : 1)
    drawPins(map)
    map.setPaintProperty('cafes', 'icon-opacity', solo ? 0 : ['case', ['<=', ['get', 'd'], radius], 1, .45])
    if (solo) heightsAll(map)
    if (bare) focusNow(map)
    if (layer === 'flow') { setFt(fm === 'h' ? 7 : 0); setPlay(true) }
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
      // 이 자리를 가운데 두고 넓게 본 뒤, 타일이 다 오면 가장 가까운 역을 찾는다
      map.easeTo({ center: [Q.lon, Q.lat], zoom: bare ? lensZoom(box.current, 700, Q.lat) : Math.min(map.getZoom(), mob() ? 14.2 : 15.2), padding: { top: padTop() }, duration: 700 })
      map.once('moveend', () => map.once('idle', find))
    }
    if (bare) {
      // 렌즈: 공고 점은 1.5km까지 넓게, 나머지는 걸어서 5분 원에 맞춰
      if (layer === 'list') map.easeTo({ center: [Q.lon, Q.lat], zoom: lensZoom(box.current, listR(), Q.lat, .9), ...tilt(), duration: 1100 })
      else if (layer !== 'place' && map.__lz !== layer) map.easeTo({ center: [Q.lon, Q.lat], zoom: LOOK.has(layer) ? lensZoom(box.current, 650, Q.lat) : zoomNow(), ...tilt(), duration: 900 })
      map.__lz = layer
    } else if (layer === 'flow') map.easeTo({ center: [Q.lon, Q.lat], zoom: zoomFor(radius), padding: { top: mapPadTop() }, duration: 700 })
  }, [layer, ready])

  // 'list' 층: 공고 자리를 고리 점 + 이름으로 (가장 먼 점까지 보이게, 400m~1.5km)
  const ptsRef = useRef(pts)
  ptsRef.current = pts
  const listR = () => Math.min(1500, Math.max(400, ...(ptsRef.current || []).map(p => Math.hypot((p.lon - Q.lon) * kx, (p.lat - Q.lat) * ky) * 1.15)))
  const lmk = useRef([])
  useEffect(() => {
    const map = mapRef.current
    lmk.current.forEach(m => m.remove()); lmk.current = []
    if (!map || !ready || layer !== 'list' || !pts?.length) return
    for (const p of pts) {
      const el = document.createElement('div')
      el.className = 'lpt'
      el.innerHTML = '<i></i><span></span>'
      el.querySelector('span').textContent = p.t
      lmk.current.push(new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(map))
    }
  }, [layer, pts, ready])
  // 렌즈 둘러보기: 넓게 보기일 때만 끌기·휠 확대를 켜고, 작게 돌아오면 끄고 이 자리로 다시 맞춘다
  const lookRef = useRef(false)
  lookRef.current = !!ctl?.look
  useEffect(() => {
    const map = mapRef.current
    if (!bare || !map || !ready) return
    const on = !!ctl?.look && LOOK.has(layer)
    roam(map, on)
    if (!ctl?.look && map.__looked) { map.easeTo({ center: [Q.lon, Q.lat], zoom: homeZoom(), ...tilt(), duration: 700 }); map.__moved = false }
    map.__looked = !!ctl?.look
  }, [ctl?.look, layer, ready])
  // 층마다 원에 맞는 확대
  const homeZoom = () => (layerRef.current === 'list' ? lensZoom(box.current, listR(), Q.lat, .9) : layerRef.current === 'place' ? lensZoom(box.current, 700, Q.lat) : LOOK.has(layerRef.current) ? lensZoom(box.current, 650, Q.lat) : zoomNow())
  // 문장이 바뀌면(ctl.home) 끌거나 돌려 둔 지도를 이 자리로 되돌린다
  useEffect(() => {
    const map = mapRef.current
    if (!bare || !map || !ready || !map.__moved || ctl?.look) return
    map.__moved = false
    map.easeTo({ center: [Q.lon, Q.lat], zoom: homeZoom(), ...tilt(), duration: 900 })
  }, [ctl?.home])
  // 밖에서 정하는 밝힐 건물(fk)
  useEffect(() => { if (ctl?.fk && ready) { fkRef.current = ctl.fk; focusNow(mapRef.current) } }, [ctl?.fk, ready, bld])
  // 리포트가 가려져 있는 동안은 빈 건물 색
  const offRef = useRef(!!ctl?.off)
  offRef.current = !!ctl?.off
  // 드러날 때는 번지지 않고 바로 칠해 둔다 (위 덮개가 통째로 옅어지며 지도가 나타난다)
  useEffect(() => { if (ready && bare) focusNow(mapRef.current, ctl?.off ? undefined : { now: true }) }, [ctl?.off, ready])
  function satPaint(map, solo) {
    map.setPaintProperty('sat', 'raster-opacity', solo && sat ? 1 : 0)
    map.setPaintProperty('radius-fill', 'fill-color-transition', { duration: 450, delay: 0 })
    map.setPaintProperty('radius-fill', 'fill-color', bareRef.current ? (solo && sat ? 'rgba(14,16,20,.35)' : 'rgba(0,0,0,0)') : solo ? (sat ? 'rgba(14,16,20,.35)' : LAND) : W + '.06)')
  }
  useEffect(() => { const map = mapRef.current; if (map?.getLayer('sat')) satPaint(map, bareRef.current ? layerRef.current !== 'place' : layerRef.current === 'bcol') }, [sat])

  // 생활인구 칸을 지도에 올린다: 칸마다 시간대별 사람 수를 가장 붐비는 칸·시간으로 나눈 값(h0..h23)과 하루 평균(d)
  useEffect(() => {
    const src = mapRef.current?.getSource('flow')
    if (!pop || !src) return
    const mx = Math.max(...pop.cells.flatMap(c => c.h)) || 1
    const md = Math.max(...pop.cells.map(c => c.h.reduce((a, b) => a + b, 0))) || 1
    src.setData({ type: 'FeatureCollection', features: pop.cells.map(c => {
      const hx = 118 / (111320 * Math.cos(c.lat * Math.PI / 180)), hy = 118 / 110540
      const [x0, x1, y0, y1] = [c.lon - hx, c.lon + hx, c.lat - hy, c.lat + hy]
      const pr = Object.fromEntries(c.h.map((v, k) => ['h' + k, v / mx]))
      pr.d = c.h.reduce((a, b) => a + b, 0) / md
      return { type: 'Feature', properties: pr, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } }
    }) })
    mapRef.current.getSource('flowpt')?.setData({ type: 'FeatureCollection', features: pop.cells.map(c => ({ type: 'Feature', properties: { ...Object.fromEntries(c.h.map((v, k) => ['h' + k, v / mx])), d: c.h.reduce((a, b) => a + b, 0) / md }, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } })) })
  }, [pop, ready])

  // 유동인구 재생: 시간(또는 달)에 따라 칸마다 진하기가 바뀐다
  useEffect(() => {
    const map = mapRef.current
    if (!map?.getLayer('flow')) return
    if (pop) {
      // 시간: 그 시각 사람 수(앞뒤 시간 사이를 이어서) · 월: 하루 평균에 이 동의 달별 계절 계수를 곱함(계수가 없으면 시간만)
      const i = Math.floor(ft) % 24, j = (i + 1) % 24, w = ft - Math.floor(ft)
      const v = fm === 'h' || !DEMO.real?.season ? ['+', ['*', ['get', 'h' + i], 1 - w], ['*', ['get', 'h' + j], w]] : ['*', ['get', 'd'], at(DEMO.real.season.m, ft)]
      map.setPaintProperty('flow', 'fill-opacity', ['min', .85, ['*', .9, ['sqrt', v]]])
      // 안개는 사람 수를 그대로(제곱근을 씌우면 새벽과 낮 차이가 눌려 시간이 흘러도 거의 같아 보인다)
      if (map.getLayer('flow-heat')) map.setPaintProperty('flow-heat', 'heatmap-weight', v)
    }
  }, [ft, fm, layer, pop, ready])
  useEffect(() => {
    if (layer !== 'flow' || !play) return
    let raf, t0 = performance.now()
    const step = now => {
      const dt = (now - t0) / (fm === 'h' ? 650 : 900); t0 = now
      setFt(t => (t + dt) % PROF[fm].n)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [layer, play, fm])

  // 2D ↔ 3D: 지도를 눕히면서 건물이 바닥에서 서서히 솟는다 (내릴 땐 거꾸로)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const map = mapRef.current
    if (!map?.getLayer('building-3d')) return
    // 렌즈: 입체로 갈 땐 먼저 기울기를 풀고, 평면으로 다 눕힌 뒤엔 다시 0으로 묶는다
    if (bare && d3) map.setMaxPitch(70)
    map.easeTo({ ...tilt(), duration: 1200 })
    if (bare && !d3) map.once('moveend', () => { if (!d3Ref.current) { map.setPitch(0); map.setMaxPitch(0) } })
    rise(map, d3 ? 1 : 0, d3 ? 1800 : 900, d3 ? 200 : 0)
  }, [d3])

  // 건물 데이터가 오면 지도에 올린다
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !bld || !map.getSource('ob')) return
    map.getSource('ob').setData(bld); focusNow(map)
    setH(map, kOf.get(map) ?? 0)
    if (layerRef.current === 'bcol') map.once('idle', () => heightsAll(map))
  }, [bld, ready])
  useEffect(() => { focusNow(mapRef.current) }, [budget])

  // 고른 카페로 이동 (건물 색 지도에서는 지도를 움직이지 않음)
  useEffect(() => {
    const map = mapRef.current
    if (!map || focus == null || map.__solo) return
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
      map.resize()
      // 지도에서 자리를 옮겨 다시 연 것이면 들어가는 움직임 없이 바로
      if (Q.moved) map.jumpTo({ center: [Q.lon, Q.lat], zoom: zoomNow(), padding: { top: padTop() } })
      else {
        map.jumpTo({ center: [Q.lon, Q.lat], zoom: z0, padding: { top: padTop() } })
        map.easeTo({ center: [Q.lon, Q.lat], zoom: zoomNow(), ...tilt(), padding: { top: padTop() }, duration: 1600, delay: 150 })
      }
      const up = () => setH(map, 1)
      if (d3Ref.current) map.getLayer('building-3d') ? up() : map.once('load', up)
    }
  }, [shown])
  useEffect(() => {
    const map = mapRef.current
    if (map && shown && center) map.easeTo({ center: [Q.lon, Q.lat], zoom: zoomNow(), padding: { top: padTop() }, duration: 700 })
  }, [radius, center])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.getLayer('ob-hi') || !bld) return
    const of = i => (i == null ? null : bld.cafe[i] ?? null)
    const ids = [of(active), sel?.bld ?? of(sel?.cafe)].filter(v => v != null)
    for (const id of ids) {
      if (ohSet.has(id)) continue
      const f = bld.features.find(f => f.properties.i === id)
      if (!f) continue
      const r = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]
      const c = r.reduce((a, q) => [a[0] + q[0] / r.length, a[1] + q[1] / r.length], [0, 0])
      let h = 0
      for (const o of map.querySourceFeatures('omt', { sourceLayer: 'building' })) {
        const g = o.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
        if (polys.some(P => inside(c, P[0]))) h = Math.max(h, o.properties.render_height || 0)
      }
      if (h) { map.setFeatureState({ source: 'ob', id }, { oh: h }); ohSet.add(id) }
    }
    map.setFilter('ob-hi', ['in', ['get', 'i'], ['literal', ids]])
    map.setFilter('ob-line', ['in', ['get', 'i'], ['literal', ids]])
  }, [active, sel, bld])

  // 지도 3D 건물에 가려지지 않게 색칠할 건물마다 같은 자리 지도 건물 높이를 한 번 재 둔다
  function heightsAll(map) {
    if (!bld || ohSet.has('all')) return
    const G = 0.0005, idx = new Map()
    for (const f of bld.features) {
      const P = f.properties
      if (!(P.tgt || P.dist <= 300) || ohSet.has(P.i)) continue
      const r = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]
      const c = r.reduce((a, q) => [a[0] + q[0] / r.length, a[1] + q[1] / r.length], [0, 0])
      const k = Math.floor(c[0] / G) + ',' + Math.floor(c[1] / G)
      if (!idx.has(k)) idx.set(k, [])
      idx.get(k).push({ i: P.i, c, h: 0 })
    }
    for (const o of map.querySourceFeatures('omt', { sourceLayer: 'building' })) {
      const g = o.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
      const h = o.properties.render_height || 0
      if (!h) continue
      for (const P of polys) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
        for (const [x, y] of P[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
        for (let a = Math.floor(x0 / G); a <= Math.floor(x1 / G); a++) for (let b = Math.floor(y0 / G); b <= Math.floor(y1 / G); b++)
          for (const e of idx.get(a + ',' + b) || []) if (h > e.h && inside(e.c, P[0])) e.h = h
      }
    }
    for (const L of idx.values()) for (const e of L) if (e.h) { map.setFeatureState({ source: 'ob', id: e.i }, { oh: e.h }); ohSet.add(e.i) }
    ohSet.add('all')
  }
  // 왼쪽에서 지금 읽는 항목의 건물만 밝게 + 이름표
  const nearest = () => report.competitors.map((s, i) => ({ s, i })).sort((a, b) => a.s.dist - b.s.dist).slice(0, 3)
  function focusNow(map, o) {
    if (!map?.getLayer('ob-col')) return
    const fk = fkRef.current, B = bldRef.current
    const ids = fk === 'near' && B ? nearest().map(({ i }) => B.cafe[i]).filter(v => v != null) : []
    if (bareRef.current) paintBare(map, bareColor(fk, layerRef.current, budgetRef.current, offRef.current), o)
    else map.setPaintProperty('ob-col', 'fill-extrusion-color', bcColor(fk, ids, budgetRef.current))
    drawPins(map)
  }
  useEffect(() => {
    const on = e => { fkRef.current = e.detail; focusNow(mapRef.current) }
    addEventListener('zari-focus', on)
    return () => removeEventListener('zari-focus', on)
  }, [])
  // 렌즈: 건물 색이 바뀔 때 내 자리에서 바깥으로 번지면서, 건물마다 이전 색에서 새 색으로 서서히 바뀐다
  // (번지는 앞쪽 BAND m 안 건물은 섞인 색) · o: { D 걸리는 시간, delay 기다렸다 시작 }
  function paintBare(map, next, o = {}) {
    const key = JSON.stringify(next)
    if (key === map.__bk) return
    const put = c => { map.__shown = c; map.setPaintProperty('ob-col', 'fill-extrusion-color', c) }
    // 바뀌는 중에 또 바뀌면 지금 섞인 색에서 이어 간다 (너무 겹치면 직전 목표 색에서)
    const deep = (map.__dep || 0) >= 2
    const prev = deep ? map.__bc : map.__shown
    map.__dep = deep ? 1 : (map.__dep || 0) + 1
    map.__bc = next; map.__bk = key
    cancelAnimationFrame(map.__paint)
    if (!prev || o.now || matchMedia('(prefers-reduced-motion: reduce)').matches) { map.__dep = 0; return put(next) }
    const t0 = performance.now() + (o.delay || 0), D = o.D || 1000, MAX = 420, BAND = 200
    const dist = ['coalesce', ['get', 'dist'], 0]
    const step = () => {
      const p = Math.max(0, Math.min(1, (performance.now() - t0) / D))
      const R = (MAX + BAND) * eio(p)
      if (p >= 1) { map.__dep = 0; put(next) }
      else put(['interpolate', ['linear'], ['min', 1, ['max', 0, ['/', ['-', R, dist], BAND]]], 0, prev, 1, next])
      if (p < 1) map.__paint = requestAnimationFrame(step)
    }
    step()
  }
  // 내 자리 점: 내 자리 건물 한가운데 (건물이 아직 없으면 주소 좌표)
  const meAt = () => {
    const f = bldRef.current?.features.find(f => f.properties.tgt)
    if (!f) return [Q.lon, Q.lat]
    const r = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]
    return r.slice(1).reduce((a, q) => [a[0] + q[0] / (r.length - 1), a[1] + q[1] / (r.length - 1)], [0, 0])
  }
  // 이름표: 점에서 오른쪽으로 선을 그어 흰 칸에 이름 (화면 밖으로 나가면 왼쪽으로)
  const meas = useRef(null)
  function drawPins(map) {
    const svg = pinRef.current
    if (!svg) return
    if (!map.__solo || bareRef.current) { svg.innerHTML = ''; return }
    const fk = fkRef.current, me = map.project(meAt())
    let P = []
    if (fk === 'tgt') P = [{ p: me, t: '내 자리 · ' + shortAddr(Q.address) }]
    if (fk === 'near') P = nearest().map(({ s }) => ({ p: map.project(ll(s.x, s.y)), t: `${s.name} ${s.dist}m`, c: 1 }))
    P.sort((a, b) => a.p.y - b.p.y)
    const ctx = meas.current || (meas.current = document.createElement('canvas').getContext('2d'))
    ctx.font = `600 ${mob() ? 11.5 : 12.5}px Pretendard, sans-serif`
    const W0 = svg.clientWidth, ws = P.map(q => ctx.measureText(q.t).width + 18), wmax = Math.max(0, ...ws)
    let lx = Math.max(...P.map(q => q.p.x)) + 48
    const left = lx + wmax > W0 - 12
    if (left) lx = Math.min(...P.map(q => q.p.x)) - 48
    const y0 = P.length ? (P[0].p.y + P[P.length - 1].p.y) / 2 - (P.length - 1) * 16 : 0
    const dot = (p, c) => `<circle cx="${p.x}" cy="${p.y}" r="5" class="${c ? 'c' : 'me'}"/>`
    svg.innerHTML = P.map((q, i) => {
      const ly = y0 + i * 32, w = ws[i], x = Math.max(8, Math.min(W0 - 8 - w, left ? lx - w : lx))
      return `<g><line x1="${q.p.x}" y1="${q.p.y}" x2="${lx}" y2="${ly}"/><rect x="${x}" y="${ly - 12}" width="${w}" height="24"/><text x="${x + 9}" y="${ly + 4.5}">${q.t.replace(/[<&]/g, '')}</text>${dot(q.p, q.c)}</g>`
    }).join('') + (fk === 'tgt' ? '' : dot(me))
  }

  const inIso = (r, cafe) => report.shops.filter(([x, y, c]) => Math.hypot(x, y) <= r && (!cafe || c === Q.cat)).length

  return (
    <div className={'mapwrap' + (bare ? ' bare' : '')}>
      <div ref={box} className="linemap" />
      <svg ref={pinRef} className="pins" aria-hidden="true" />
      <div ref={tipRef} className="tip glass maptip" />
      {bare && layer === 'flow' && pop && !ctl?.look && <FlowClock ft={ft} setFt={setFt} play={play} setPlay={setPlay} pop={pop} radius={radius} />}
      {!bare && <>
      <div className="layers" role="group" aria-label="지도에 보이는 것">
        <span className="lg">
          {[['bcol', `${Q.what}·공실`, `건물마다 ${Q.what}·공실·다른 가게를 색으로`], ['shops', '모든 가게', '반경 안 가게를 점으로'], ...(pop ? [['flow', '생활인구', '250m 칸마다 그 시각에 있는 사람 (평일 평균)']] : []), ['place', '역·학교', '가까운 역·학교·버스 정류장']].map(([k, t, d]) => <button key={k} className={layer === k ? 'on' : ''} title={d} onClick={() => setLayer(k)}>{t}</button>)}
        </span>
        <span className="vw">
          <span className="seg" role="group" aria-label="평면 입체 보기">
            <i className={d3 ? 'r' : ''} />
            <button className={d3 ? '' : 'on'} onClick={() => setD3(false)} aria-pressed={!d3} title="위에서 내려다보기">평면</button>
            <button className={d3 ? 'on' : ''} onClick={() => setD3(true)} aria-pressed={d3} title="건물을 세워 보기">입체</button>
          </span>
          {layer === 'bcol' && <button className={'sat' + (sat ? ' on' : '')} onClick={() => setSat(!sat)} aria-pressed={sat} title="위성 사진 켜고 끄기">위성 사진</button>}
        </span>
      </div>
      <div className={'legendmap glass' + (layer === 'flow' ? ' on' : '')}><span>적음</span><i /><span>많음</span></div>
      <div className={'legendmap places glass' + (layer === 'place' ? ' on' : '')}>
        {PLACE_KINDS.map(([k, t]) => <span key={k}><i className={'pk-' + k} />{t}</span>)}
        <span><i className="pk-iso" />걸어서 5·10분</span>
      </div>
      <div className={'scale m' + (layer === 'bcol' ? ' on' : '')}>{radius}M · 걸어서 5분</div>
      <div className={'legendmap places bcol' + (layer === 'bcol' ? ' on' : '')}>
        {BC_KEYS.map(([k, t]) => <span key={k}><i className={'bc-' + k} />{k === 'cafe' ? Q.what : t}</span>)}
      </div>
      {layer === 'place' && walk && (
        <div className="walk glass"><span className="m">NEAREST STATION</span><b>{walk.name}</b><em>직선 {fmtM(walk.d)} · 걸어서 약 <strong className="m">{walk.min}분</strong></em>
          <div className="iso-n">{ISO.map(([min, r]) => <span key={min}><b className="m">{min}분</b>가게 {inIso(r, false)} · {Q.what} {inIso(r, true)}</span>)}</div>
        </div>
      )}
      {layer === 'flow' && pop && <FlowPlayer fm={fm} setFm={m => { setFm(m); setFt(m === 'h' ? 7 : 0) }} ft={ft} setFt={setFt} play={play} setPlay={setPlay} pop={pop} radius={radius} />}
      {layer === 'bcol' && <div className="movehint">{Q.moved ? <>{Q.from}에서 {Q.moved}m 옮긴 자리 · <button onClick={() => onMove(null)}>원래 자리로</button></> : '건물을 누르면 내 자리를 옮길 수 있어요'}</div>}
      {sel && (sel.bld != null ? bld && <BuildingCard what={Q.what} from={Q.from || shortAddr(Q.address)} b={bld.features.find(f => f.properties.i === sel.bld)?.properties} budget={budget} onMove={i => { setSel(null); onMove(i) }} onClose={() => setSel(null)} />
        : <ShopCard sel={sel} report={report} onClose={() => setSel(null)} />)}
      </>}
    </div>
  )
}

const ISO = [[5, 258], [10, 515]]
// 점이 다각형 안에 있나 (경도·위도)
function inside([x, y], ring) {
  let o = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) o = !o
  }
  return o
}
const walkMin = d => Math.max(1, Math.round((d * 1.3) / 67))
const floorTxt = f => (f > 0 ? f + '층' : f < 0 ? '지하 ' + -f + '층' : '층 정보 없음')

// 지도에서 누른 가게 설명
function ShopCard({ sel, report, onClose }) {
  const Q = report.query
  let name, cat, floor, x, y, extra = null
  if (sel.cafe != null) {
    const s = report.competitors[sel.cafe]
    ;({ name, floor, x, y } = s); cat = Q.what
    const b = BRANDS.find(b => name.startsWith(b))
    // 가게 하나의 매출은 공개 자료가 없어 붙이지 않고, 주변 상권 같은 업종 평균만 보여 준다
    const SA = DEMO.sales
    extra = (
      <>
        <div className="sc-row"><span>구분</span><b>{b ? '프랜차이즈 · ' + (BRAND_NAME[b] || b) : '개인 가게'}</b></div>
        {!SA.none && <div className="sc-row"><span>주변 같은 업종 평균</span><b className="m">월 {SA.month.toLocaleString()}만</b></div>}
        <p className="sc-note">이 가게 매출은 공개되지 않아요{SA.none ? '' : ` · 주변 상권 ${SA.stores}곳 평균`}</p>
      </>
    )
  } else {
    const s = report.shops[sel.shop]
    ;[x, y] = s; cat = report.cats[s[2]]; name = s[3] || cat; floor = s[4] ?? 0
  }
  const d = Math.hypot(x, y)
  const sameCat = report.shops.filter(t => t[2] === (sel.cafe != null ? Q.cat : report.shops[sel.shop][2]) && Math.hypot(t[0] - x, t[1] - y) <= 100).length - 1
  return (
    <div className="shopcard glass" role="dialog" aria-label={name + ' 정보'}>
      <button className="x" onClick={onClose} aria-label="닫기">×</button>
      <span className="m">{sel.cafe != null ? 'SAME · 경쟁 가게' : 'SHOP'}</span>
      <b className="nm">{name}</b>
      <small>{cat} · {floorTxt(floor)}</small>
      <div className="sc-row"><span>이 자리에서</span><b>{fmtM(d)} · 걸어서 {walkMin(d)}분</b></div>
      <div className="sc-row"><span>100m 안 같은 업종</span><b>{Math.max(0, sameCat)}곳</b></div>
      {extra}
    </div>
  )
}

// 지도에서 누른 건물 설명 (Overture 건물 + 가게 목록을 건물에 맞춘 것)
function BuildingCard({ b, from, what, budget, onMove, onClose }) {
  if (!b) return null
  const n = b.n || 0, c = b.cost
  // 가게·건물 데이터가 처음 자리에서 600m까지라, 옮긴 자리의 걸어서 5분이 그 안에 들 만큼만 옮긴다
  const movable = !b.tgt && b.base <= MOVE_MAX
  return (
    <div className="shopcard glass" role="dialog" aria-label="건물 정보">
      <button className="x" onClick={onClose} aria-label="닫기">×</button>
      <span className="m">{b.tgt ? 'BUILDING · 내 자리' : b.empty ? 'VACANT · 공실 후보' : 'BUILDING · 건물'}</span>
      <b className="nm">{b.name || (b.empty ? '가게가 하나도 없는 상가 건물' : n ? `가게 ${n}곳이 든 건물` : '가게 없는 건물')}</b>
      <small>{fmtM(b.dist || 0)} · 걸어서 {walkMin(b.dist || 0)}분</small>
      {b.empty && <div className={'sc-row' + (b.closed ? ' hot' : '')}><span>최근 3년 폐업{b.closed ? <em className="eg">공실 가능성 높음</em> : null}</span><b>{b.closed ? `${b.closed}곳 · 마지막 ${b.closedLast}` : '기록 없음'}</b></div>}
      <div className="sc-row"><span>안에 든 가게</span><b>{n}곳{b.cafe ? ` · ${what || '같은 업종'} ${b.cafe}` : ''}</b></div>
      {n > 0 && <div className="sc-row"><span>1층 가게</span><b>{b.f1 || 0}곳</b></div>}
      {b.fmax > 1 && <div className="sc-row"><span>가게 있는 층</span><b>1–{b.fmax}층</b></div>}
      {b.top && <div className="sc-row tops"><span>많은 업종</span><b>{b.top.split(' · ').slice(0, 2).map(t => t.replace(/ (\d+)$/, ' $1곳')).join(' · ')}</b></div>}
      {c && <>
        <div className="sc-row"><span>1칸 넓이</span><b>약 {c.py}평 ({c.m2}㎡)</b></div>
        <div className={'sc-row' + (budget && c.month > budget.month ? ' over' : ' in')}><span>매달 · 월세 {c.rent.toLocaleString()}만+관리비</span><b className="m">{c.month.toLocaleString()}만{budget ? (c.month > budget.month ? ' · 예산 넘음' : ' · 예산 안') : ''}</b></div>
        <div className={'sc-row' + (budget && c.start > budget.start ? ' over' : ' in')}><span>처음 · 보증금 {c.deposit.toLocaleString()}만+시설비</span><b className="m">{c.start.toLocaleString()}만{budget ? (c.start > budget.start ? ' · 예산 넘음' : ' · 예산 안') : ''}</b></div>
      </>}
      {movable && <button className="moveto" onClick={() => onMove(b.i)}>여기를 내 자리로 →</button>}
      {!b.tgt && !movable && <p className="sc-note">{from}에서 {MOVE_MAX}m 안 건물만 내 자리로 옮길 수 있어요</p>}
    </div>
  )
}

// 유동인구 재생 막대: 시간대 · 월별
// pop: 생활인구 칸이 있으면 시간 막대는 반경 안 칸의 실제 사람 수(그 시각에 있는 사람)
// 월: 반경 안 하루 평균(24시각 평균)에 이 동의 2025년 달별 계절 계수(10월 = 1)를 곱함
// 원 지도용 24시 시계: 원 가장자리에 시간마다 눈금(길이 = 그 시각 사람 수). 저절로 돌고, 눈금 위에 올리면 그 시각에서 멈춘다
const hourKo = h => (h === 0 ? '밤 12시' : h < 12 ? '오전 ' + h + '시' : h === 12 ? '낮 12시' : '오후 ' + (h - 12) + '시')
function FlowClock({ ft, setFt, play, setPlay, pop, radius }) {
  const hrs = Array.from({ length: 24 }, (_, k) => pop.cells.filter(c => c.d <= radius).reduce((a, c) => a + c.h[k], 0))
  const mx = Math.max(...hrs, 1), peak = hrs.indexOf(mx), cur = Math.floor(ft) % 24
  const pick = e => {
    const r = e.currentTarget.ownerSVGElement.getBoundingClientRect()
    const a = Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2) + Math.PI / 2
    const h = Math.round(((a + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 12)) % 24
    if (play) setPlay(false)
    if (h !== cur || ft !== h) setFt(h)
  }
  return (
    <div className={'fclock' + (play ? '' : ' held')}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        {hrs.map((v, k) => {
          const a = (k / 24) * 2 * Math.PI - Math.PI / 2, c = Math.cos(a), s = Math.sin(a), r1 = 47.5, r0 = r1 - (1.2 + 5.3 * (v / mx))
          return <line key={k} className={k === cur ? 'on' : ''} x1={50 + c * r0} y1={50 + s * r0} x2={50 + c * r1} y2={50 + s * r1} />
        })}
        <circle className="hit" cx="50" cy="50" r="44" onPointerMove={pick} onPointerEnter={pick} onPointerLeave={() => setPlay(true)} />
      </svg>
      <p>{hourKo(cur)}{cur === peak ? ' · 가장 붐벼요' : ' · 가장 붐빌 때의 ' + Math.round((hrs[cur] / mx) * 100) + '%'}</p>
    </div>
  )
}

function FlowPlayer({ fm, setFm, ft, setFt, play, setPlay, pop, radius }) {
  const SE = DEMO.real?.season?.m
  if (!SE) fm = 'h'   // 달별 계수가 없는 동은 시간 막대만
  const P = PROF[fm], cur = Math.floor(ft) % P.n
  const realH = fm === 'h', realM = fm === 'm'
  const hrs = Array.from({ length: 24 }, (_, k) => pop.cells.filter(c => c.d <= radius).reduce((a, c) => a + c.h[k], 0))
  const avg = hrs.reduce((a, b) => a + b, 0) / 24
  const tot = realH ? hrs : SE.map(f => avg * f)
  const mx = Math.max(...tot)
  const now = Math.round(at(tot, ft) / 10) * 10
  // 달별 차이는 10% 안팎이라 막대는 가장 적은 달의 80%를 바닥으로 그린다
  const lo = realM ? Math.min(...tot) * .8 : 0
  const pct = realM ? Math.round((SE[cur] - 1) * 100) : 0
  const note = realM ? (cur === 9 ? '기준 달' : pct === 0 ? '10월과 비슷해요' : `10월보다 ${Math.abs(pct)}% ${pct > 0 ? '많아요' : '적어요'}`) : PROF.h.note(ft)
  return (
    <div className="player glass">
      <div className="pl-top">
        <button className="pp" onClick={() => setPlay(!play)} aria-label={play ? '멈춤' : '재생'}>{play ? <span className="ps" /> : <span className="pl" />}</button>
        <div className="pl-now"><b className="m">{P.lab(ft)}</b><span>{note}</span></div>
        <div className="pl-n"><b className="m">{now.toLocaleString()}</b><small>{realH ? `명 · 반경 ${radius}m 안` : realM ? `명 · 반경 ${radius}m 평일 평균` : fm === 'h' ? '명 / 시간' : '명 / 하루'}</small></div>
        <span className="seg" role="group" aria-label="재생 단위">
          <i className={fm === 'm' ? 'r' : ''} />
          <button className={'m' + (fm === 'h' ? ' on' : '')} onClick={() => setFm('h')}>시간</button>
          {SE && <button className={'m' + (fm === 'm' ? ' on' : '')} onClick={() => setFm('m')}>월</button>}
        </span>
      </div>
      <div className="pl-bars" onPointerDown={e => {
        const go = ev => { const r = e.currentTarget.getBoundingClientRect(); setFt(Math.max(0, Math.min(P.n - .01, ((ev.clientX - r.left) / r.width) * P.n))) }
        const el = e.currentTarget; setPlay(false); go(e)
        const mv = ev => { const r = el.getBoundingClientRect(); setFt(Math.max(0, Math.min(P.n - .01, ((ev.clientX - r.left) / r.width) * P.n))) }
        const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up) }
        addEventListener('pointermove', mv); addEventListener('pointerup', up)
      }}>
        {tot.map((v, i) => <i key={i} className={i === cur ? 'on' : ''} style={{ height: 12 + ((v - lo) / (mx - lo || 1)) * 88 + '%' }} />)}
        <u style={{ left: (ft / P.n) * 100 + '%' }} />
      </div>
      <div className="pl-x m">{fm === 'h' ? ['0', '6', '12', '18', '24'].map(t => <span key={t}>{t}</span>) : ['1', '4', '7', '10', '12'].map(t => <span key={t}>{t}</span>)}</div>
    </div>
  )
}
