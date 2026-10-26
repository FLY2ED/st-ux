import { useEffect, useId, useState } from 'react'
import { CAN, displacementMap } from './glassmap.js'

// el 크기에 맞춘 변위 지도. 크기가 바뀌는 동안(Dock 확대)은 옛 지도를 늘려 쓰고, 멈추면 다시 그린다
export function useRefraction(ref, { radius = 24, band = 18, scale = 46, blur = 3 } = {}) {
  const id = `lg${useId().replace(/:/g, '')}`
  const [map, setMap] = useState(null)

  useEffect(() => {
    const el = ref.current
    if (!CAN || !el) return
    let t
    const draw = () => {
      const w = Math.round(el.offsetWidth)
      const h = Math.round(el.offsetHeight)
      if (w > 0 && h > 0) setMap(displacementMap(w, h, radius, band))
    }
    const ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(draw, 140)
    })
    ro.observe(el)
    draw()
    return () => {
      ro.disconnect()
      clearTimeout(t)
    }
  }, [ref, radius, band])

  const filter = map ? (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage href={map} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map" />
        <feGaussianBlur in="SourceGraphic" stdDeviation={blur} result="soft" />
        <feDisplacementMap in="soft" in2="map" scale={scale} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  ) : null
  const style = map ? { backdropFilter: `url(#${id}) saturate(170%)`, WebkitBackdropFilter: `url(#${id}) saturate(170%)` } : undefined
  return { filter, style }
}
