// 3D 거리 프리셋 지역의 OSM 데이터를 미리 받아 둔다. 실행 중 Overpass가 막혀도 프리셋은 열린다.
// 사용법: node scripts/build_world.mjs [프리셋 id...]
import { existsSync, writeFileSync } from 'node:fs'
import { compact, fetchOSM } from '../src/world/osm.js'
import { PRESETS, RADIUS } from '../src/world/presets.js'

const only = process.argv.slice(2)
for (const p of PRESETS) {
  const out = new URL(`../../midterm/data/world/${p.id}.json`, import.meta.url)
  if (only.length ? !only.includes(p.id) : existsSync(out)) continue
  // 공개 Overpass 서버는 자주 붐비므로 잠깐 쉬었다가 다시 묻는다
  for (let tries = 1; ; tries++) {
    try {
      const world = compact(await fetchOSM(p.lng, p.lat, RADIUS, { timeout: 90000 }), p.lng, p.lat, RADIUS)
      writeFileSync(out, JSON.stringify(world))
      console.log(p.id, 'buildings', world.b.length, 'ways', world.w.length, 'areas', world.a.length)
      break
    } catch (e) {
      if (tries >= 5) throw e
      console.log(p.id, 'retry', tries, e.message)
      await new Promise((r) => setTimeout(r, 15000))
    }
  }
}
