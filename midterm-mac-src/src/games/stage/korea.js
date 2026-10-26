// 놀이판용 픽셀 한국 지도: map.json 칸을 작은 네모로 찍는다 (KoreaMap.vue 와 같은 투영)
import { load } from '../../data.js'
import { PASTEL } from '../../shops.js'

const KX = Math.cos((36 * Math.PI) / 180)
const B = { minX: 124.6, maxX: 131, minY: 33.1, maxY: 38.65 }

export const koreaCells = () => load('map.json')

// w×h 안에 한반도 남쪽을 꽉 차게 넣는 투영
export function makeView(w, h, pad = 10) {
  const scale = Math.min((w - pad * 2) / ((B.maxX - B.minX) * KX), (h - pad * 2) / (B.maxY - B.minY))
  const ox = (w - (B.maxX - B.minX) * KX * scale) / 2
  const oy = (h - (B.maxY - B.minY) * scale) / 2
  return {
    w,
    h,
    scale,
    project: (lng, lat) => [ox + (lng - B.minX) * scale * KX, oy + (B.maxY - lat) * scale],
    unproject: (x, y) => [B.minX + (x - ox) / (scale * KX), B.maxY - (y - oy) / scale],
  }
}

// 바탕 지도를 한 번 그려 둔 캔버스. tint 를 주면 한 가지 색, 아니면 업종 색
export function paintKorea(map, view, { dpr = 1, tint = '', alpha = 1 } = {}) {
  const c = document.createElement('canvas')
  c.width = Math.round(view.w * dpr)
  c.height = Math.round(view.h * dpr)
  const ctx = c.getContext('2d')
  ctx.scale(dpr, dpr)
  const px = Math.max(1.5, map.step * view.scale)
  for (const [x, y, n, cat] of map.cells) {
    const [sx, sy] = view.project(x * map.step, y * map.step)
    ctx.globalAlpha = Math.min(1, 0.3 + Math.log10(n) / 3) * alpha
    ctx.fillStyle = tint || PASTEL[cat % PASTEL.length]
    ctx.fillRect(Math.round(sx), Math.round(sy), Math.ceil(px), Math.ceil(px))
  }
  return c
}

// 두 좌표 사이 거리(km)
export function haversine(a, b) {
  const R = 6371
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
