// 주소·장소 이름 찾기: 카카오 JS 키가 있으면 카카오 지도 검색, 없으면 키 없는 Photon(OpenStreetMap)
const KEY = import.meta.env.VITE_KAKAO_KEY
const SEOUL = [126.76, 37.42, 127.19, 37.71]
const inSeoul = (lon, lat) => lon > SEOUL[0] && lon < SEOUL[2] && lat > SEOUL[1] && lat < SEOUL[3]

let kakao
const loadKakao = () => (kakao ??= new Promise((ok, no) => {
  const s = document.createElement('script')
  s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KEY}&libraries=services&autoload=false`
  s.onload = () => window.kakao.maps.load(() => ok(window.kakao.maps.services))
  s.onerror = no
  document.head.appendChild(s)
}))
const kcall = (fn, ...a) => new Promise(ok => fn(...a, (r, st) => ok(st === 'OK' ? r : [])))

// 결과: { label, sub, address, near, dong, lon, lat }
async function kakaoSearch(q) {
  const S = await loadKakao()
  const [addr, place] = await Promise.all([
    kcall((...a) => new S.Geocoder().addressSearch(...a), q),
    kcall((...a) => new S.Places().keywordSearch(...a), q, { rect: SEOUL.join(','), size: 6 }),
  ])
  const A = addr.map(r => {
    const road = r.road_address, j = r.address
    return { label: road?.address_name || r.address_name, sub: road?.building_name || j?.address_name || '주소',
      address: road?.address_name || r.address_name, near: road?.building_name || '', dong: j?.region_3depth_name || road?.region_3depth_name || '', lon: +r.x, lat: +r.y }
  })
  const P = place.map(r => ({ label: r.place_name, sub: r.road_address_name || r.address_name, address: r.road_address_name || r.address_name,
    near: r.place_name, dong: (r.address_name || '').split(' ')[2] || '', lon: +r.x, lat: +r.y }))
  return [...A, ...P]
}

async function photonSearch(q) {
  // lang=default: OSM 원래 이름(한국어)
  const u = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&bbox=${SEOUL.join(',')}&limit=10&lang=default`
  const j = await fetch(u).then(r => r.json())
  return j.features.map(f => {
    const p = f.properties, [lon, lat] = f.geometry.coordinates
    const road = [p.street, p.housenumber?.replace(/^지하\s*/, '')].filter(Boolean).join(' ')
    const gu = p.county && /구$/.test(p.county) ? p.county + ' ' : ''
    const name = p.name && p.osm_key === 'railway' && !/역$/.test(p.name) ? p.name + '역' : p.name
    return { label: name || road, sub: [road && p.name ? road : '', p.district || p.locality].filter(Boolean).join(' · '),
      address: '서울 ' + gu + (road || name), near: name || '', dong: p.district || p.locality || '', lon, lat }
  })
}

export async function search(q) {
  q = q.trim()
  if (q.length < 2) return []
  let r = []
  try { r = KEY ? await kakaoSearch(q) : await photonSearch(q) } catch { r = [] }
  // 같은 이름이 300m 안에 또 있으면(역 출구·정류장 등) 하나만
  const out = []
  for (const x of r) {
    if (!inSeoul(x.lon, x.lat) || !x.label) continue
    if (out.some(o => o.label === x.label && Math.hypot((o.lon - x.lon) * 88000, (o.lat - x.lat) * 111000) < 300)) continue
    out.push(x)
  }
  return out.slice(0, 6)
}

// 좌표 → 주소 (홈 지도에 핀을 꽂을 때)
export async function reverse(lon, lat) {
  try {
    if (KEY) {
      const S = await loadKakao()
      const [r] = await kcall((...a) => new S.Geocoder().coord2Address(...a), lon, lat)
      if (r) {
        const road = r.road_address, j = r.address
        return { address: road?.address_name || j.address_name, near: road?.building_name || '', dong: j?.region_3depth_name || '', lon, lat }
      }
    }
    const j = await fetch(`https://photon.komoot.io/reverse?lon=${lon}&lat=${lat}&lang=default`).then(r => r.json())
    const p = j.features[0]?.properties
    if (p) {
      const road = [p.street, p.housenumber].filter(Boolean).join(' ')
      return { address: '서울 ' + (road || p.name || p.district), near: p.name || '', dong: p.district || p.locality || '', lon, lat }
    }
  } catch {}
  return { address: `서울 ${lat.toFixed(4)}, ${lon.toFixed(4)}`, near: '', dong: '', lon, lat }
}

// 업종 찾기: 서울 상가정보 업종 247개 중에서. 흔히 부르는 이름도 받는다
export const POPULAR = ['카페', '빵/도넛', '미용실', '편의점', '치킨', '김밥/만두/분식', '요리 주점', '네일숍']
const ALIAS = {
  커피: '카페', 베이커리: '빵/도넛', 빵집: '빵/도넛', 제과: '빵/도넛', 디저트: '카페', 술집: '요리 주점', 이자카야: '요리 주점',
  호프: '생맥주 전문', 맥주: '생맥주 전문', 분식: '김밥/만두/분식', 떡볶이: '김밥/만두/분식', 스터디카페: '독서실/스터디 카페',
  독서실: '독서실/스터디 카페', 중식: '중국집', 짜장: '중국집', 햄버거: '버거', 헤어: '미용실', 헤어샵: '미용실', 고깃집: '돼지고기 구이/찜',
  삼겹살: '돼지고기 구이/찜', 헬스: '헬스장', 필라테스: '요가/필라테스 학원', 요가: '요가/필라테스 학원', 옷가게: '기타 의류 소매업',
  펫샵: '애완동물/애완용품 소매업', 반려동물: '애완동물/애완용품 소매업', 피시방: 'PC방', 코인노래방: '노래방', 학원: '입시·교과학원',
}
export function findCat(q, cats) {
  const s = q.trim().replace(/\s+/g, '')
  if (!s) return POPULAR.map(label => ({ label, sub: '많이 찾는 업종' }))
  const norm = x => x.replace(/\s+/g, '')
  const hits = []
  for (const [k, v] of Object.entries(ALIAS)) if (norm(k).startsWith(s) || s.startsWith(norm(k))) hits.push({ label: v, sub: `‘${k}’로 찾음` })
  const pre = cats.filter(c => norm(c).startsWith(s)), mid = cats.filter(c => !norm(c).startsWith(s) && norm(c).includes(s))
  for (const c of [...pre, ...mid]) hits.push({ label: c, sub: '' })
  const seen = new Set()
  return hits.filter(h => !seen.has(h.label) && seen.add(h.label)).slice(0, 7)
}
