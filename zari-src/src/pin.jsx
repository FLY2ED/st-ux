// 픽셀 핀 로고 (1 = 칸). 칸 사이 틈 없이 채운다.
export const PIN = ['01110', '11111', '11011', '11111', '01110', '00100']
export const PIN_CELLS = PIN.flatMap((r, y) => [...r].map((c, x) => (c === '1' ? [x, y] : null))).filter(Boolean)

export function Pin({ size = 30, className, style }) {
  const k = size / PIN.length
  return (
    <svg className={className} style={style} width={PIN[0].length * k} height={size}
      viewBox={`0 0 ${PIN[0].length} ${PIN.length}`} shapeRendering="crispEdges" fill="currentColor" aria-hidden="true">
      {PIN_CELLS.map(([x, y]) => <rect key={x + '-' + y} x={x} y={y} width="1" height="1" />)}
    </svg>
  )
}

export const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2h8v2H6V2zM4 6V4h2v2H4zm0 8H2V6h2v8zm2 2H4v-2h2v2zm8 0v2H6v-2h8zm2-2h-2v2h2v2h2v2h2v2h2v-2h-2v-2h-2v-2h-2v-2zm0-8h2v8h-2V6zm0 0V4h-2v2h2z" /></svg>
)
export const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 11v2h12v2h2v-2h2v-2h-2V9h-2v2H4zm10-4h2v2h-2V7zm0 0h-2V5h2v2zm0 10h2v-2h-2v2zm0 0h-2v2h2v-2z" /></svg>
)
