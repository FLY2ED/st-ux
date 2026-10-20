import * as THREE from 'three'

// 카메라를 따라다니는 상자 안에서 비 줄기나 눈송이를 떨어뜨린다
const COUNT = 2600
const W = 70
const H = 40

export const WEATHERS = [
  { id: 'live', label: '실시간' },
  { id: 'clear', label: '맑음' },
  { id: 'rain', label: '비' },
  { id: 'snow', label: '눈' },
]

export function makeWeather() {
  const drops = new Float32Array(COUNT * 3)
  for (let i = 0; i < COUNT; i++) {
    drops[i * 3] = (Math.random() - 0.5) * W
    drops[i * 3 + 1] = Math.random() * H
    drops[i * 3 + 2] = (Math.random() - 0.5) * W
  }
  // 비: 짧은 선, 눈: 점
  const rainPos = new Float32Array(COUNT * 6)
  const rainGeo = new THREE.BufferGeometry()
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3))
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xa8c0d8, transparent: true, opacity: 0.55 }))
  const snowPos = new Float32Array(COUNT * 3)
  const snowGeo = new THREE.BufferGeometry()
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3))
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false }))
  for (const o of [rain, snow]) {
    o.frustumCulled = false
    o.visible = false
  }
  const group = new THREE.Group()
  group.add(rain, snow)
  let kind = 'clear'
  let t = 0

  function set(next) {
    kind = next
    rain.visible = kind === 'rain'
    snow.visible = kind === 'snow'
  }

  function update(dt, cam) {
    if (kind !== 'rain' && kind !== 'snow') return
    t += dt
    const fall = kind === 'rain' ? 22 : 1.6
    const ox = cam.x
    const oy = cam.y - H / 2
    const oz = cam.z
    for (let i = 0; i < COUNT; i++) {
      let y = drops[i * 3 + 1] - fall * dt
      if (y < 0) y += H
      drops[i * 3 + 1] = y
      // 상자를 카메라 둘레에 감아 붙인다
      const x = ((((drops[i * 3] - ox) % W) + W * 1.5) % W) - W / 2 + ox
      const z = ((((drops[i * 3 + 2] - oz) % W) + W * 1.5) % W) - W / 2 + oz
      const wy = oy + y
      if (kind === 'rain') {
        rainPos.set([x, wy, z, x + 0.05, wy + 0.7, z], i * 6)
      } else {
        const drift = Math.sin(t * 0.8 + i) * 0.6
        snowPos.set([x + drift, wy, z + Math.cos(t * 0.6 + i) * 0.6], i * 3)
      }
    }
    if (kind === 'rain') rainGeo.attributes.position.needsUpdate = true
    else snowGeo.attributes.position.needsUpdate = true
  }

  function dispose() {
    rainGeo.dispose()
    snowGeo.dispose()
    rain.material.dispose()
    snow.material.dispose()
  }

  return { group, set, update, dispose, kind: () => kind }
}
