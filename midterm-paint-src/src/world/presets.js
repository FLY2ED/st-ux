// 위치를 못 받으면 서울과학기술대학교에서 시작한다
export const RADIUS = 320

// area: 서울 실시간 도시데이터 장소 이름 (없으면 시간대로 어림한다)
export const PRESETS = [
  { id: 'seoultech', label: '서울과기대', lng: 127.0772, lat: 37.6302 },
  { id: 'gangnam', label: '강남역', lng: 127.0276, lat: 37.4979, area: '강남역' },
  { id: 'hongdae', label: '홍대입구', lng: 126.9255, lat: 37.557, area: '홍대입구역(2호선)' },
  { id: 'gwanghwamun', label: '광화문', lng: 126.9769, lat: 37.5713, area: '광화문·덕수궁' },
]
