export const SHOP_STYLE = {
  flower: { wall: '#d4ecd0', sign: '#5a9a63' },
  bread: { wall: '#f8e6c6', sign: '#e58fa5' },
  cafe: { wall: '#efe4d6', sign: '#8a5a3c' },
  pharm: { wall: '#e3f2f1', sign: '#3f9e94' },
  ricecake: { wall: '#fbe3ea', sign: '#c86b8a' },
  laundry: { wall: '#e2ebf8', sign: '#4a6fb5' },
  karaoke: { wall: '#ece0f7', sign: '#8a5cc2' },
  hair: { wall: '#fde9d9', sign: '#e0884d' },
  chicken: { wall: '#fff3c4', sign: '#d9a21b' },
  book: { wall: '#d9e4f5', sign: '#3d5e9e' },
  hardware: { wall: '#e4e4dc', sign: '#6b6b5a' },
  snack: { wall: '#fde2d6', sign: '#e0604d' },
}

// 업종별 가게 그림 (간판 글씨는 HTML로 얹는다)
export const shopImg = (key) => new URL(`./assets/shop-${key}.webp`, import.meta.url).href

// 손그림 화면이라 색은 형광펜 노랑 몇 가지와 흰 종이만 쓴다
export const PASTEL = ['#ffe28a', '#fff1c2', '#ffd35c', '#ffffff', '#ffeaa0', '#fff8de']

export const pastelOf = (text) => {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PASTEL[h % PASTEL.length]
}

// 거리 가게 → 데이터의 업종 소분류 이름
export const STREET_CAT = {
  flower: '꽃집',
  bread: '빵/도넛',
  cafe: '카페',
  pharm: '약국',
  ricecake: '떡/한과',
  laundry: '세탁소',
  karaoke: '노래방',
  hair: '미용실',
  chicken: '치킨',
  book: '서점',
  hardware: '철물/공구 소매업',
  snack: '김밥/만두/분식',
}
