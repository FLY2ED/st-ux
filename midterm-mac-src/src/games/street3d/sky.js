import * as THREE from 'three'

// --- 하늘: 이야기 속 때(TIMES)를 천천히 따라간다 ------------------------------------------
const SKY_NIGHT = new THREE.Color(0x0b1030)
const SKY_DAY = new THREE.Color(0x8ec5ee)
const SKY_DUSK = new THREE.Color(0xd9876a)
const tmpColor = new THREE.Color()

// sky: { night, dusk } 지금 값, to: 가야 할 때, parts: 바꿀 장면 조각들
export function stepSky(sky, to, dt, { scene, stars, ambient, moon, wallMats, fx }) {
  const k = Math.min(1, dt * 0.5)
  sky.night += (to.night - sky.night) * k
  sky.dusk += (to.dusk - sky.dusk) * k
  tmpColor.copy(SKY_DAY).lerp(SKY_NIGHT, sky.night).lerp(SKY_DUSK, sky.dusk * 0.5)
  scene.background = tmpColor
  scene.fog.color.copy(tmpColor)
  const day = 1 - sky.night
  stars.material.opacity = 0.8 * sky.night
  ambient.intensity = 0.75 + day * 0.55
  moon.intensity = 0.55 + day * 0.7
  moon.color.setRGB(0.78 + day * 0.22, 0.83 + day * 0.05 - sky.dusk * 0.1, 1 - day * 0.2 - sky.dusk * 0.25)
  fx.uNight.value = sky.night
  for (const m of wallMats) m.emissiveIntensity = 0.8 * sky.night
}
