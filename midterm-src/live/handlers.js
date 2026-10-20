// 실시간 서울 데이터를 받아 3D 거리에 필요한 만큼만 줄인다.
// 배포에서는 Cloudflare Worker(worker.js)가, 개발 서버에서는 Vite 미들웨어가 같은 함수를 부른다.
// 키는 env 로만 받는다: SEOUL_KEY(서울 열린데이터광장), DATA_GO_KR_KEY(공공데이터포털), VWORLD_KEY·VWORLD_DOMAIN(브이월드)
import { vworldRows, vworldUrl } from '../src/world/vworld.js'

const TTL = { city: 300, bus: 30, bldg: 604800 }

async function json(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`upstream ${res.status}`)
  return res.json()
}

const num = (v) => {
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

// 서울 실시간 도시데이터: 도로 소통·인구 혼잡도·지하철 도착·따릉이·날씨·공사
async function city(q, env) {
  const area = (q.get('area') || '').slice(0, 40)
  if (!area) return { status: 400, body: { error: 'area' } }
  const key = env.SEOUL_KEY || 'sample'
  const raw = await json(`http://openapi.seoul.go.kr:8088/${key}/json/citydata/1/5/${encodeURIComponent(area)}`)
  const c = raw.CITYDATA
  if (!c) return { status: 502, body: { error: raw.RESULT?.MESSAGE || raw.RESULT?.['RESULT.MESSAGE'] || 'no data' } }
  const people = c.LIVE_PPLTN_STTS?.[0] || {}
  const avg = c.ROAD_TRAFFIC_STTS?.AVG_ROAD_DATA || {}
  const weather = c.WEATHER_STTS?.[0] || {}
  const xy = (s) => s.split('|').flatMap((p) => p.split('_').map((v) => Math.round(num(v) * 1e6) / 1e6))
  return {
    status: 200,
    ttl: TTL.city,
    body: {
      area: c.AREA_NM,
      sample: key === 'sample',
      people: { level: people.AREA_CONGEST_LVL || '', msg: people.AREA_CONGEST_MSG || '', min: num(people.AREA_PPLTN_MIN), max: num(people.AREA_PPLTN_MAX), time: people.PPLTN_TIME || '' },
      road: { level: avg.ROAD_TRAFFIC_IDX || '', speed: num(avg.ROAD_TRAFFIC_SPD), msg: avg.ROAD_MSG || '', time: avg.ROAD_TRAFFIC_TIME || '' },
      roads: (c.ROAD_TRAFFIC_STTS?.ROAD_TRAFFIC_STTS || []).map((r) => [r.ROAD_NM, num(r.SPD), r.IDX, xy(r.XYLIST || '')]),
      weather: {
        temp: num(weather.TEMP),
        rain: weather.PRECPT_TYPE || '없음',
        msg: weather.PCP_MSG || '',
        sky: weather.FCST24HOURS?.[0]?.SKY_STTS || '',
        dust: weather.PM10_INDEX || '',
      },
      subway: (c.SUB_STTS || []).map((s) => [
        s.SUB_STN_NM,
        num(s.SUB_STN_X),
        num(s.SUB_STN_Y),
        (s.SUB_DETAIL || []).map((d) => [d.SUB_LINE, d.SUB_ROUTE_NM, num(d.SUB_ARVTIME), d.SUB_ARMG1, d.SUB_ARVINFO]),
      ]),
      bike: (c.SBIKE_STTS || []).map((b) => [b.SBIKE_SPOT_NM.replace(/^\d+\.\s*/, ''), num(b.SBIKE_X), num(b.SBIKE_Y), num(b.SBIKE_PARKING_CNT), num(b.SBIKE_RACK_CNT)]),
      works: (c.ACDNT_CNTRL_STTS || []).map((a) => [a.ACDNT_TYPE, a.ACDNT_DTYPE, a.ACDNT_INFO, num(a.ACDNT_X), num(a.ACDNT_Y), a.EXP_CLR_DT]),
      time: c.LIVE_PPLTN_STTS?.[0]?.PPLTN_TIME || '',
    },
  }
}

// 서울 버스: 좌표에서 가장 가까운 정류소의 도착 예정 버스
async function bus(q, env) {
  if (!env.DATA_GO_KR_KEY) return { status: 503, body: { error: 'no key' } }
  const lng = num(q.get('lng'))
  const lat = num(q.get('lat'))
  if (!lng || !lat) return { status: 400, body: { error: 'lng,lat' } }
  const base = 'http://ws.bus.go.kr/api/rest/stationinfo'
  const key = encodeURIComponent(env.DATA_GO_KR_KEY)
  const near = await json(`${base}/getStationByPos?serviceKey=${key}&tmX=${lng}&tmY=${lat}&radius=200&resultType=json`)
  const stop = [near.msgBody?.itemList || []].flat().filter((s) => s.arsId && s.arsId !== '0').sort((a, b) => num(a.dist) - num(b.dist))[0]
  if (!stop) return { status: 200, ttl: TTL.bus, body: { stop: null, buses: [] } }
  const arr = await json(`${base}/getStationByUid?serviceKey=${key}&arsId=${stop.arsId}&resultType=json`)
  const buses = [arr.msgBody?.itemList || []].flat().map((b) => [b.rtNm, b.arrmsg1, b.arrmsg2, b.adirection || '', Number(b.routeType) || 0])
  return { status: 200, ttl: TTL.bus, body: { stop: { name: stop.stationNm, ars: stop.arsId }, buses } }
}

// 브이월드 GIS건물통합정보: 반경 안 건물 외곽선·층수·용도·사용승인 연도
async function bldg(q, env) {
  if (!env.VWORLD_KEY) return { status: 503, body: { error: 'no key' } }
  const lng = num(q.get('lng'))
  const lat = num(q.get('lat'))
  const r = Math.min(400, num(q.get('r')) || 320)
  if (!lng || !lat) return { status: 400, body: { error: 'lng,lat' } }
  const out = []
  for (let page = 1; page <= 5; page++) {
    const res = (await json(vworldUrl(env.VWORLD_KEY, env.VWORLD_DOMAIN, lng, lat, r, page))).response
    if (!vworldRows(res, page, out)) break
  }
  return { status: 200, ttl: TTL.bldg, body: { b: out } }
}

const ROUTES = { city, bus, bldg }

// 경로 하나를 처리해 { status, body, ttl } 을 돌려준다
export async function handle(url, env) {
  const name = url.pathname.split('/').filter(Boolean).pop()
  const route = ROUTES[name]
  if (!route) return { status: 404, body: { error: 'not found' } }
  try {
    return await route(url.searchParams, env)
  } catch (e) {
    return { status: 502, body: { error: String(e.message || e) } }
  }
}
