// --- 작은 지도 ------------------------------------------------------------------
const MAP_COLOR = ['#3a3a44', '#202028', '#3a3430', '#2c4a2a', '#1d3560', '#2c4a2a', '#2a2a30', '#34302c', '#2c4a2a', '#45454e']

// 칸 하나 = 한 화소. 건물은 높을수록 밝은 회색, 땅은 종류 색
export function drawMapBase({ N, height, ground }) {
  const c = document.createElement('canvas')
  c.width = N
  c.height = N
  const m = c.getContext('2d')
  const img = m.createImageData(N, N)
  const rgb = MAP_COLOR.map((hx) => [1, 3, 5].map((o) => Number.parseInt(hx.slice(o, o + 2), 16)))
  for (let n = 0; n < N * N; n++) {
    const h = height[n]
    const v = Math.min(150, 70 + h * 2)
    const [r, g, b] = h ? [v, v, v + 8] : rgb[ground[n]] || rgb[0]
    img.data.set([r, g, b, 255], n * 4)
  }
  m.putImageData(img, 0, 0)
  return c
}

// 나를 가운데 두고 카메라 방향으로 돌린 지도. dots: [{ x, z, color, size }]
export function drawMini(cv, { base, half, B, at, yaw, dots }) {
  const S = cv.width
  const g = cv.getContext('2d')
  const zoom = 1.6
  const [pi, pk] = [at.x / B + half, at.z / B + half]
  g.fillStyle = '#0a0a10'
  g.fillRect(0, 0, S, S)
  g.save()
  g.translate(S / 2, S / 2)
  g.rotate(yaw)
  g.scale(zoom, zoom)
  g.imageSmoothingEnabled = false
  g.drawImage(base, -pi, -pk)
  for (const d of dots) {
    g.fillStyle = d.color
    g.fillRect(d.x / B + half - pi - d.size / 2, d.z / B + half - pk - d.size / 2, d.size, d.size)
  }
  g.restore()
  // 나는 가운데 노란 세모(늘 위쪽을 본다)
  g.fillStyle = '#ffcf3a'
  g.beginPath()
  g.moveTo(S / 2, S / 2 - 6)
  g.lineTo(S / 2 + 5, S / 2 + 5)
  g.lineTo(S / 2 - 5, S / 2 + 5)
  g.fill()
}
