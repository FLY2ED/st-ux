import { useMemo } from 'react'
import grainBlack from '../assets/mac/wallpaper-grain-black.webp'

// 바탕화면: 직접 만든 검은 그라데이션에 노이즈(그레인)를 씌운 배경. 라이트·다크 모드 같은 한 장.
// 이름은 예전 픽셀 야경 시절 그대로 둔다(App.jsx 가 usePixelWall·WallLights 를 부른다)
export function usePixelWall(dark) {
  return useMemo(() => ({ url: grainBlack, lights: [] }), [])
}

// 배경 판. --wall 그림을 화면 가득 깐다
export function WallLights() {
  return <div className="wall-lights" aria-hidden="true" />
}
