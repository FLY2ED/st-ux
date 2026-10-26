// 리퀴드 글라스의 가장자리 굴절. 둥근 사각형 테두리 띠 안에서 뒤 배경을 안쪽으로 끌어당기는 변위 지도를 그려
// SVG feDisplacementMap 으로 backdrop-filter 에 건다. backdrop-filter: url() 은 Chromium 계열만 되니 나머지는 흐림만 쓴다
export const CAN = typeof navigator !== 'undefined' && !!navigator.userAgentData?.brands?.some((b) => /Chromium/.test(b.brand))

export function displacementMap(w, h, radius, band) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  const img = g.createImageData(w, h)
  const r = Math.min(radius, w / 2, h / 2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 둥근 사각형 안쪽까지의 거리와 바깥을 향한 방향
      const qx = Math.max(r - x, x - (w - r), 0)
      const qy = Math.max(r - y, y - (h - r), 0)
      let d
      let nx = 0
      let ny = 0
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy)
        d = r - len
        nx = (x < w / 2 ? -1 : 1) * (qx / len)
        ny = (y < h / 2 ? -1 : 1) * (qy / len)
      } else {
        const dl = x
        const dr = w - 1 - x
        const dt = y
        const db = h - 1 - y
        d = Math.min(dl, dr, dt, db)
        if (d === dl) nx = -1
        else if (d === dr) nx = 1
        else if (d === dt) ny = -1
        else ny = 1
      }
      const k = d < band ? Math.pow(1 - Math.max(0, d) / band, 2) : 0
      const i = (y * w + x) * 4
      img.data[i] = 128 + nx * k * 127
      img.data[i + 1] = 128 + ny * k * 127
      img.data[i + 2] = 128
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return c.toDataURL()
}
