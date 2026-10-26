// 바탕화면에 놓인 것. 맥처럼 거의 비워 두고 앱은 Dock 에 모은다.
// 두 번 누르면 디스크·폴더는 Finder 창, 문서는 훑어보기 창(file)이 열린다. type 은 Finder 가 쓰는 원래 파일 종류
export const FILES = [
  { id: 'hd', name: '간판도감 HD', type: 'disk' },
  { id: 'mine', name: '내가 차린 가게', type: 'folder' },
  { id: 'readme', name: '수리공 수첩', type: 'txt' },
]

export const fileOf = (id) => FILES.find((f) => f.id === id)

export const SHOP_NAMES = {
  flower: '꽃집',
  bread: '빵집',
  cafe: '카페',
  pharm: '약국',
  ricecake: '떡집',
  laundry: '세탁소',
  karaoke: '노래방',
  hair: '미용실',
  chicken: '치킨집',
  book: '서점',
  hardware: '철물점',
  snack: '분식집',
}

export function readMyShops() {
  try {
    return JSON.parse(localStorage.getItem('gp-my-shops')) || []
  } catch {
    return []
  }
}
