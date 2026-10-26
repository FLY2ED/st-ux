// Apple 지도처럼 업종 무리마다 핀 색을 정한다. 이름에 든 낱말로 가른다
const GROUPS = [
  { color: '#ff3b30', test: /병원|의원|약국|치과|한의|의료|보건/ },
  { color: '#ff9500', test: /음식|백반|한식|중식|일식|양식|피자|버거|치킨|분식|김밥|빵|도넛|카페|주점|호프|고기|횟집|국수|떡|제과|커피|식당|요리/ },
  { color: '#ff2d55', test: /미용|네일|피부|화장품|이용|뷰티|메이크업/ },
  { color: '#af52de', test: /호텔|모텔|여관|펜션|숙박|민박|리조트/ },
  { color: '#34c759', test: /헬스|수영|골프|운동|체육|요가|필라테스|태권|당구|볼링/ },
  { color: '#a2845e', test: /학원|교습|교육|어린이집|유치원|독서실|서점/ },
  { color: '#ffcc00', test: /소매|마트|슈퍼|편의점|상점|의류|가구|꽃/ },
  { color: '#007aff', test: /수리|세탁|부동산|중개|서비스|사진|인쇄|광고|임대|대여/ },
]

export function catColor(cat = '') {
  for (const g of GROUPS) if (g.test.test(cat)) return g.color
  return '#8e8e93'
}
