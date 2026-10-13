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

export const PASTEL = ['#f6a5c0', '#8fb3e6', '#ffd84d', '#9fd8a8', '#c69be0', '#f2b46b', '#7fd1d1', '#f08a7a']

export const pastelOf = (text) => {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PASTEL[h % PASTEL.length]
}
