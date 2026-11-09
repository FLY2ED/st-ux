// 작은 그래프들: 흰 선·흰 네모, 가장 큰 값만 흰색으로 진하게

// 세로 막대
export function Cols({ data, unit = '%' }) {
  const max = Math.max(...data.map(d => d[1]))
  return (
    <div className="cols">
      {data.map(([l, v]) => (
        <div key={l} className={v === max ? 'pk' : ''}>
          <em className="m">{v}{unit}</em>
          <i style={{ height: (v / max) * 100 + '%' }} />
          <span>{l}</span>
        </div>
      ))}
    </div>
  )
}

// 꺾은선 (네모 점)
export function Line({ data, fmt = v => v }) {
  const W = 360, H = 110, P = 10
  const vs = data.map(d => d[1]), lo = Math.min(...vs) * .9, hi = Math.max(...vs) * 1.04
  const pt = (v, i) => [P + (i / (data.length - 1)) * (W - P * 2), H - P - ((v - lo) / (hi - lo)) * (H - P * 2)]
  const pts = vs.map(pt)
  return (
    <div className="line">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke="#fff" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      {pts.map(([x, y], i) => (
        <b key={i} style={{ '--d': i / (pts.length - 1), left: (x / W) * 100 + '%', top: (y / H) * 100 + '%' }} className={i === pts.length - 1 ? 'last' : ''}>
          {i === pts.length - 1 && <em className="m">{fmt(vs[i])}</em>}
        </b>
      ))}
      <div className="xl">{data.map(([l], i) => <span key={i}>{i % 2 === 1 || i === data.length - 1 ? l : ''}</span>)}</div>
    </div>
  )
}

// 오각형 지수
export function Radar({ data, avg = 50 }) {
  const C = 90, R = 66, n = data.length
  const at = (k, v) => {
    const a = -Math.PI / 2 + (k / n) * Math.PI * 2
    return [C + Math.cos(a) * R * (v / 100), C + Math.sin(a) * R * (v / 100)]
  }
  const poly = vs => vs.map((v, k) => at(k, v).join(',')).join(' ')
  return (
    <svg className="radar" viewBox="0 0 180 180">
      {[25, 50, 75, 100].map(r => <polygon key={r} points={poly(data.map(() => r))} fill="none" stroke="rgba(255,255,255,.18)" />)}
      {data.map((_, k) => { const [x, y] = at(k, 100); return <line key={k} x1={C} y1={C} x2={x} y2={y} stroke="rgba(255,255,255,.18)" /> })}
      <polygon points={poly(data.map(() => avg))} fill="none" stroke="rgba(255,255,255,.6)" strokeDasharray="3 3" />
      <polygon className="me" points={poly(data.map(d => d[1]))} fill="rgba(255,255,255,.22)" stroke="#fff" strokeWidth="1.5" />
      {data.map(([l, v], k) => {
        const [x, y] = at(k, v), [lx, ly] = at(k, 128)
        return (
          <g key={l}>
            <rect x={x - 3} y={y - 3} width="6" height="6" fill="#fff" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle">{l}<tspan className="v" x={lx} dy="12">{v}</tspan></text>
          </g>
        )
      })}
    </svg>
  )
}

// 둘로 나눈 막대 (여성/남성 등)
export function Split({ a, b, v }) {
  return (
    <div className="split">
      <div className="sbar"><i style={{ width: v + '%' }} /></div>
      <div className="sl"><span>{a} <b className="m">{v}%</b></span><span>{b} <b className="m">{100 - v}%</b></span></div>
    </div>
  )
}

// 가로 막대 목록
export function Rows({ data, max, unit = '', me, wide }) {
  const m = max || Math.max(...data.map(d => d[1]))
  return (
    <div className={'mix' + (wide ? ' wide' : '')}>
      {data.map(([n, v]) => (
        <div key={n} className={n === me ? 'me' : ''}><span>{n}</span><i style={{ width: (v / m) * 100 + '%' }} /><b className="m">{v}{unit}</b></div>
      ))}
    </div>
  )
}
