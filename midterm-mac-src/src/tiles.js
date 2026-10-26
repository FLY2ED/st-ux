// 전국 277만 곳 지도 타일(../midterm/data/tiles). 만드는 법은 midterm-src/scripts/build_tiles.py
// 시도별 PMTiles 파일에서 필요한 z14 칸만 Range 로 받아 읽는다
import { PMTiles } from 'pmtiles'
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import { DATA, load } from './data.js'

export const TILE_Z = 14
export const tileUrl = (name) => new URL(`${DATA}tiles/${name}.pmtiles`, location.href).href

let index = null
export const tileIndex = () => (index ||= load('tiles/index.json'))

const archives = new Map()
const archive = (name) => {
  if (!archives.has(name)) archives.set(name, new PMTiles(tileUrl(name)))
  return archives.get(name)
}

const lng2x = (lng, z) => ((lng + 180) / 360) * 2 ** z
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}

// 한 칸 안의 간판. 칸 가장자리 여유(buffer)에 겹쳐 담긴 이웃 칸 점은 빼서 같은 가게가 두 번 나오지 않게 한다
const memo = new Map()
function readTile(region, x, y) {
  const key = `${region}/${x}/${y}`
  if (!memo.has(key)) {
    memo.set(
      key,
      archive(region)
        .getZxy(TILE_Z, x, y)
        .then((res) => {
          if (!res) return []
          const layer = new VectorTile(new Pbf(new Uint8Array(res.data))).layers.s
          if (!layer) return []
          const out = []
          for (let i = 0; i < layer.length; i++) {
            const f = layer.feature(i)
            const [p] = f.loadGeometry()[0]
            if (p.x < 0 || p.y < 0 || p.x >= layer.extent || p.y >= layer.extent) continue
            const n = 2 ** TILE_Z
            const lng = ((x + p.x / layer.extent) / n) * 360 - 180
            const yy = Math.PI * (1 - (2 * (y + p.y / layer.extent)) / n)
            const lat = (Math.atan(Math.sinh(yy)) * 180) / Math.PI
            out.push({ name: f.properties.n, c: f.properties.c, floor: f.properties.f ?? null, lng, lat })
          }
          return out
        })
        .catch((e) => {
          memo.delete(key)
          throw e
        }),
    )
    if (memo.size > 400) memo.delete(memo.keys().next().value)
  }
  return memo.get(key)
}

// 반경 안의 모든 간판 → [{name, c, floor, lng, lat}]. 반경을 덮는 시도 파일과 z14 칸만 받는다
export async function signsInRadius(lng, lat, radius) {
  const { regions } = await tileIndex()
  const dx = radius / (111320 * Math.cos((lat * Math.PI) / 180))
  const dy = radius / 110540
  const box = [lng - dx, lat - dy, lng + dx, lat + dy]
  const hit = Object.entries(regions).filter(([, r]) => r.bounds[0] <= box[2] && r.bounds[2] >= box[0] && r.bounds[1] <= box[3] && r.bounds[3] >= box[1])
  const [x0, x1] = [Math.floor(lng2x(box[0], TILE_Z)), Math.floor(lng2x(box[2], TILE_Z))]
  const [y0, y1] = [Math.floor(lat2y(box[3], TILE_Z)), Math.floor(lat2y(box[1], TILE_Z))]
  const jobs = []
  for (const [name] of hit) for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push(readTile(name, x, y))
  return (await Promise.all(jobs)).flat()
}
