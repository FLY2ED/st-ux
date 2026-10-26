// 시도별 지도 타일(PMTiles z14)을 풀어 간판 한 곳당 한 줄 TSV 로 내보낸다. 원본 CSV 없이 색인을 다시 만들 때 쓴다
// 사용법: node scripts/dump_tiles.mjs ../midterm/data/tiles out.tsv
// 줄: 시도  상호명  업종번호  층(모르면 빈칸)  경도  위도
import { openSync, readSync, createWriteStream } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PMTiles } from 'pmtiles'
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'

const [dir, outPath] = process.argv.slice(2)
const Z = 14
const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'))

class Local {
  constructor(path) {
    this.path = path
    this.fd = openSync(path, 'r')
  }
  getKey() {
    return this.path
  }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length)
    readSync(this.fd, buf, 0, length, offset)
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + length) }
  }
}

const lng2x = (lng) => ((lng + 180) / 360) * 2 ** Z
const lat2y = (lat) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z
}

const out = createWriteStream(outPath)
let total = 0
for (const [sido, r] of Object.entries(index.regions)) {
  const pm = new PMTiles(new Local(join(dir, `${sido}.pmtiles`)))
  const [w, s, e, n] = r.bounds
  let count = 0
  for (let x = Math.floor(lng2x(w)); x <= Math.floor(lng2x(e)); x++) {
    for (let y = Math.floor(lat2y(n)); y <= Math.floor(lat2y(s)); y++) {
      const res = await pm.getZxy(Z, x, y)
      if (!res) continue
      const layer = new VectorTile(new Pbf(new Uint8Array(res.data))).layers.s
      if (!layer) continue
      let buf = ''
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i)
        const [p] = f.loadGeometry()[0]
        if (p.x < 0 || p.y < 0 || p.x >= layer.extent || p.y >= layer.extent) continue
        const k = 2 ** Z
        const lng = ((x + p.x / layer.extent) / k) * 360 - 180
        const yy = Math.PI * (1 - (2 * (y + p.y / layer.extent)) / k)
        const lat = (Math.atan(Math.sinh(yy)) * 180) / Math.PI
        const name = String(f.properties.n ?? '').replace(/[\t\n]/g, ' ')
        buf += `${sido}\t${name}\t${f.properties.c}\t${f.properties.f ?? ''}\t${lng.toFixed(5)}\t${lat.toFixed(5)}\n`
        count++
      }
      if (buf) out.write(buf)
    }
  }
  console.log(sido, count, '/', r.count)
  total += count
}
out.end()
console.log('total', total, '/', index.total)
