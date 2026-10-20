// 브이월드 GIS건물통합정보(LT_C_BLDGINFO) 주소와 응답 변환. Worker·개발 서버·브라우저가 함께 쓴다
const num = (v) => {
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

// 브이월드는 해외 IP 를 막아서 배포에서는 브라우저가 JSONP 로 직접 부른다. 주소와 변환은 함께 쓴다
export function vworldUrl(key, domain, lng, lat, r, page) {
  const dx = r / (111320 * Math.cos((lat * Math.PI) / 180))
  const dy = r / 110540
  const box = [lng - dx, lat - dy, lng + dx, lat + dy].map((v) => v.toFixed(6)).join(',')
  return `https://api.vworld.kr/req/data?service=data&request=GetFeature&data=LT_C_BLDGINFO&key=${key}&domain=${encodeURIComponent(domain || '')}&geomFilter=BOX(${box})&size=1000&page=${page}&format=json&crs=EPSG:4326`
}

// 응답 한 쪽을 [층수, 높이, 이름, 용도, 연도, 외곽선] 으로 바꿔 out 에 붙이고, 다음 쪽이 있는지 돌려준다
export function vworldRows(res, page, out) {
  if (res?.status === 'NOT_FOUND') return false
  if (res?.status !== 'OK') throw new Error(res?.error?.text || 'vworld')
  for (const f of res.result.featureCollection.features) {
    const p = f.properties
    const ring = f.geometry?.coordinates?.[0]?.[0]
    if (!ring) continue
    out.push([num(p.grnd_flr), num(p.height), [p.bld_nm, p.dong_nm].filter(Boolean).join(' '), p.usability || '', num(String(p.useapr_day).slice(0, 4)), ring.flat().map((v) => Math.round(v * 1e6) / 1e6)])
  }
  return page < num(res.page?.total)
}
