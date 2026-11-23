import { useEffect, useRef, useState } from 'react'
import { useFacts } from './facts.js'
import { pp, fmt } from './data.js'
import { plan } from '../Report.jsx'
import { words } from './write.jsx'

// 자세히: 900 높이 섹션들. 왼쪽 문장, 오른쪽 그림 (그림 좌표는 740×900 상자 안, 판 기준 x = 700 + x)
// 같은 문장·그림을 리포트(Read)에서도 이어서 쓴다 → moreParts
const RX = 290, RY = 450, RR = 250
function Radar({ score }) {
  const at = (j, v) => { const a = -Math.PI / 2 + (j * 2 * Math.PI) / score.length; return [RX + Math.cos(a) * v, RY + Math.sin(a) * v, a] }
  return (
    <svg className="radar" viewBox="0 0 740 900" aria-hidden="true">
      <circle cx={RX} cy={RY} r={RR / 2} className="dash" />
      {score.map(([k, v], j) => {
        const [x, y, a] = at(j, (RR * v) / 100), [ex, ey] = at(j, RR), [lx, ly] = at(j, RR + 40)
        const c = Math.cos(a), s = Math.sin(a)
        return <g key={k} className="arm" style={{ '--j': j }}>
          <line x1={RX} y1={RY} x2={ex} y2={ey} className="g" />
          <g className="val"><line x1={RX} y1={RY} x2={x} y2={y} className="v" />
          <circle cx={x} cy={y} r="13" /></g>
          <text x={lx} y={ly + (s < -.9 ? 0 : s > .3 ? 22 : 9)} textAnchor={Math.abs(c) < .2 ? 'middle' : c > 0 ? 'start' : 'end'}>{k} <tspan className="n">{v}</tspan></text>
        </g>
      })}
      <circle cx={RX} cy={RY} r="8" />
    </svg>
  )
}

function Dots({ label, pct, y }) {
  const on = Math.round(pct / 5)
  return (
    <div className="dots" style={{ top: y }}>
      <span>{label}</span>
      <i className="row">{Array.from({ length: 20 }, (_, j) => <i key={j} className={j >= 20 - on ? 'on' : ''} style={{ left: j * 32.7, '--j': j }} />)}</i>
      <b>상위 {pct}%</b>
    </div>
  )
}

const shortName = n => (n || '').replace(/(서울|노원|공릉).*$/, '') || n

// 점 줄: 점 하나 = u. rows: [이름, 값, 오른쪽 글, 진하게]. hollow면 속 빈 점
const nice = v => [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].find(s => s >= v) || 10000
// 한 줄에 점이 15개를 넘지 않게 점 하나의 크기를 고른다
const uOf = (...v) => nice(Math.max(...v) / 15)
function Pips({ rows, u, y, gap = 50, hollow, k0 = 0, slots = 16, rest = true, wide }) {
  return rows.map(([t, v, s, hi, sub], r) => {
    const n = v > 0 ? Math.min(slots, Math.max(1, Math.round(v / u))) : 0, m = rest ? Math.max(n, slots) : n
    return (
      <div key={t + r} className={'pip' + (hi ? ' hi' : '') + (hollow ? ' ho' : '') + (wide ? ' w' : '')} style={{ top: y + r * gap, '--r': r + k0 }}>
        <span>{t}</span>
        <i className="row">{Array.from({ length: m }, (_, j) => <i key={j} className={j < n ? '' : 'e'} style={{ left: j * 22, '--j': j }} />)}</i>
        <b>{s}</b>{sub != null && <em>{sub}</em>}
      </div>
    )
  })
}
// 점 기둥: 아래에서 위로 쌓는다. 위에 값, 남은 칸은 옅은 작은 점. 마지막(지금) 기둥만 진하게
function Cols({ cols, u, base, slots }) {
  return cols.map(([t, v], c) => {
    const n = Math.min(slots, Math.max(1, Math.round(v / u))), last = c === cols.length - 1
    return (
      <div key={t} className={'col' + (last ? ' hi' : '')} style={{ left: 60 + c * 80, top: base, '--r': c }}>
        {Array.from({ length: slots }, (_, j) => <i key={j} className={j < n ? '' : 'e'} style={{ bottom: j * 23, '--j': j }} />)}
        <b style={{ bottom: slots * 23 + 22 }}>{v}</b>
        <span>{t}</span>
      </div>
    )
  })
}
// 점 판: 한 줄에 20개씩 감아 쌓는다
const Grid = ({ n, y, hi, k0 = 0 }) => <div className={'pgrid' + (hi ? ' hi' : '')} style={{ top: y }}>{Array.from({ length: n }, (_, j) => <i key={j} style={{ left: (j % 20) * 31, top: Math.floor(j / 20) * 31, '--j': j + k0 }} />)}</div>
const Head = ({ y, t, b, s }) => <div className="phead" style={{ top: y }}><span>{t}</span><b>{b}</b>{s && <em>{s}</em>}</div>
const Note = ({ y, children }) => <p className="pnote" style={{ top: y }}>{children}</p>

// 손익: 값을 바꾸면 바로 다시 센다. 월 매출 점을 재료·인건비·임대료·남는 돈으로 나눠 칠한다
function Calc() {
  const [size, setSize] = useState(10), [ticket, setTicket] = useState(6800), [guests, setGuests] = useState(110)
  const { sales, profit, R, start, payback } = plan(size, ticket, guests)
  const u = Math.max(50, nice(sales / 45))
  // 재료·기타는 큰 회색, 인건비·임대료는 작은 회색, 남는 돈은 진한 점
  const parts = R ? [[R[0][0], R[0][1], 'a'], [R[2][0], R[2][1], 'b'], [R[1][0], R[1][1], 'b'], [profit >= 0 ? '남는 돈' : '모자라는 돈', Math.abs(profit), profit >= 0 ? 'hi' : 'ng']] : [['월 매출', sales, 'a']]
  let k = 0
  const dots = parts.filter(p => p[2] !== 'ng').flatMap(([, v, c]) => Array.from({ length: Math.round(Math.max(0, v) / u) }, () => ({ c, j: k++ })))
  const S = [['면적', size, setSize, 6, 30, 1, size + '평'], ['1명이 쓰는 돈', ticket, setTicket, 3000, 15000, 100, fmt(ticket) + '원'], ['하루 손님', guests, setGuests, 30, 300, 1, guests + '명']]
  const total = start.reduce((a, [, v]) => a + v, 0)
  return (
    <div className="calc">
      <Note y={70}>값을 바꾸면 바로 다시 계산해요</Note>
      {S.map(([t, v, set, lo, hi, st, s], r) => (
        <label key={t} style={{ top: 112 + r * 58 }}><span>{t}</span><input type="range" min={lo} max={hi} step={st} value={v} onChange={e => set(+e.target.value)} /><b>{s}</b></label>
      ))}
      <Note y={318}>월 예상 매출 {fmt(sales)}만 · 점 하나 {fmt(u)}만</Note>
      <div className="grid" style={{ top: 370 }}>{dots.slice(0, 45).map(({ c, j }) => <i key={j} className={c} style={{ left: (j % 15) * 42, top: Math.floor(j / 15) * 42 }} />)}</div>
      <p className="legend" style={{ top: 520 }}>{parts.map(([t, v, c]) => <span key={t} className={c}><i />{t} {fmt(v)}만</span>)}</p>
      <div className="start" style={{ top: 590 }}><b>처음 드는 돈 {fmt(total)}만</b>
        <span>{start.map(([t, v]) => t.replace('·인테리어', '') + ' ' + fmt(v)).join(' · ')} · {payback ? payback + '개월이면 되찾아요' : '이 값으로는 되찾기 어려워요'}</span></div>
    </div>
  )
}

// 자세히 조각: { id, txt(문장), pic(오른쪽 그림) }
export function moreParts(F) {
  const { W, S, C, D, near, Q } = F
  const sc = D.score
  const best = sc ? [...sc].sort((a, b) => b[1] - a[1]) : []
  const low = best[best.length - 1]
  const f1 = near.filter(n => n.floor === 1).length
  const top = S.top.slice(0, 8), mx = Math.max(...top.map(t => t[1]), 1)

  // 더 알아볼 것: 예전 화면 링크 대신 문장으로 잇는다. 자료가 없는 조각은 뺀다
  const SA = D.sales, FL = D.flow, PE = D.people, CH = D.change, RE = D.real || {}
  const GU = D.home?.gu || ''
  const sp = RE.spend, sv = RE.survive
  const P = F.P
  const ratio = (a, b) => (a / b).toFixed(1)
  const ga = w => pp(w, '이', '가')
  // 분기 매출은 최근 2년 평균을 100으로 놓고 센다
  const qs = SA && !SA.none && SA.quarters ? SA.quarters : null
  const qAvg = qs ? qs.reduce((a, q) => a + q[1], 0) / qs.length : 1, qI = qs ? qs.map(([t, v]) => [t, Math.round((v / qAvg) * 100)]) : []
  const qSlots = qs ? Math.min(14, Math.ceil(Math.max(...qI.map(q => q[1])) / 10)) : 0
  const fMax = FL?.hours ? Math.max(...FL.hours.map(h => h[1]), ...(FL.age || []).map(h => h[1])) : 0, fU = uOf(fMax)
  const near1 = (a, b) => { const r = a / b; return r >= 1.3 ? '훨씬 많고' : r >= 1.05 ? '조금 많고' : r > .95 ? '비슷하고' : r > .7 ? '조금 적고' : '훨씬 적고' }
  // "14–17" → 오후 2시~5시
  const when = s => { const [a, b] = String(s).split(/[–-]/).map(Number); if (!(b > 0)) return s + '시'; if (a === 0) return '새벽 ' + b + '시 전'
    const w = a < 6 ? '새벽' : a < 12 ? '오전' : a < 18 ? '오후' : a < 21 ? '저녁' : '밤', h = x => (x > 12 ? x - 12 : x); return w + ' ' + h(a) + '시~' + h(b) + '시' }
  const pU = PE ? Math.max(100, nice(Math.max(PE.live, PE.work) / 100)) : 1, iU = sp?.income ? uOf(sp.income, sp.incomeSeoul) : 1
  const nl = PE ? Math.max(1, Math.round(PE.live / pU)) : 0, nw = PE ? Math.max(1, Math.round(PE.work / pU)) : 0
  const yW = 180 + Math.ceil(nl / 20) * 31 + 40, yI = yW + 40 + Math.ceil(nw / 20) * 31 + 50
  const opened = CH?.years ? CH.years.reduce((a, y) => a + y[1], 0) : 0, closed = CH?.years ? CH.years.reduce((a, y) => a + y[2], 0) : 0
  const cU = CH?.years ? uOf(...CH.years.flatMap(y => [y[1], y[2]])) : 1, sU = sv?.s ? uOf(...sv.s.map(x => x[1] ?? 0)) : 5
  const s3 = sv?.s?.[1]
  const rec = D.recommend || [], tr = D.trend || [], meRec = rec.find(r => r[0] === Q.what)
  const rU = rec.length ? nice(Math.max(...rec.map(r => r[1])) / 11) : 5, tU = tr.length ? nice(Math.max(...tr.map(([, v]) => Math.abs(parseFloat(v)))) / 11) : 10
  const meN = meRec?.[2]?.match(/가게 (\d+)곳/)?.[1]
  // 좋은 점·조심할 점: 문장을 짧은 제목 + 숫자 한 줄로 나눈다
  const ins = t => {
    let m
    if ((m = t.match(/월매출이 서울 평균의 ([\d.]+)배/))) return ['매출이 서울 평균보다 ' + m[1] + '배 높아요', SA && fmt(SA.month) + '만 · 서울 ' + fmt(SA.seoul) + '만']
    if ((m = t.match(/월매출이 서울 평균보다 (\d+)% 적어요/))) return ['매출이 서울 평균보다 ' + m[1] + '% 적어요', SA && fmt(SA.month) + '만 · 서울 ' + fmt(SA.seoul) + '만']
    if ((m = t.match(/유동인구가 서울 상권 평균의 ([\d.]+)배/))) return ['지나가는 사람이 서울 평균보다 ' + m[1] + '배 많아요', FL && '하루 ' + fmt(FL.day) + '명 · 서울 ' + fmt(FL.seoul) + '명']
    if ((m = t.match(/유동인구가 서울 상권 평균보다 (\d+)% 적어요/))) return ['지나가는 사람이 서울 평균보다 ' + m[1] + '% 적어요', FL && '하루 ' + fmt(FL.day) + '명 · 서울 ' + fmt(FL.seoul) + '명']
    if ((m = t.match(/최근 (\d+)년 .* 개업 (\d+)곳, 폐업 (\d+)곳/))) return [+m[2] >= +m[3] ? '여는 가게가 닫는 가게보다 많아요' : '닫는 가게가 여는 가게보다 많아요', '최근 ' + m[1] + '년 연 곳 ' + m[2] + ' · 닫은 곳 ' + m[3]]
    if ((m = t.match(/매출이 1년 전보다 (\d+)% (늘었어요|줄었어요)/))) return ['매출이 1년 새 ' + m[1] + '% ' + m[2], '1년 전과 견줘서']
    if ((m = t.match(/주말 하루 매출이 평일의 (\d+)%/))) return ['주말 매출이 평일보다 적어요', '주말 하루 = 평일의 ' + m[1] + '%']
    if ((m = t.match(/1·3분기 매출이 다른 분기보다 (\d+)%/))) return ['방학 낀 분기엔 매출이 줄어요', '1·3분기 ' + m[1] + '% 적어요']
    if ((m = t.match(/영업 기간이 (\d+)개월로 서울\((\d+)개월\)/))) return ['가게가 오래 못 버티는 편이에요', '평균 ' + m[1] + '개월 · 서울 ' + m[2] + '개월']
    return [t.replace(/\.$/, ''), null]
  }
  const IG = D.insight ? D.insight.good.map(ins) : [], IW = D.insight ? D.insight.warn.map(ins) : []
  const more = [
    qs && { id: 'sales', txt: <>{W} 1곳은 한 달에 평균 <b>{fmt(SA.month)}만 원</b>을 벌어요. 서울 평균 {fmt(SA.seoul)}만 원보다 <b>{SA.month >= SA.seoul ? '많고' : '적고'}</b>,
      {SA.grow != null ? <> 1년 전보다 <b>{Math.abs(SA.grow)}% {SA.grow >= 0 ? '늘었어요' : '줄었어요'}</b>.</> : <> 분기마다 조금씩 오르내려요.</>}</>,
      pic: <><Head y={100} t={'1곳 월평균 매출 · ' + W} b={fmt(SA.month) + '만'} s={'서울 ' + fmt(SA.seoul) + '만'} /><Cols cols={qI} u={10} slots={qSlots} base={640} /><Note y={690}>분기별 매출 · 최근 2년 평균 100 기준 · 점 하나 10</Note></> },
    FL?.hours && { id: 'flow', txt: <>하루 <b>{fmt(FL.day)}명</b>이 지나가요.{FL.seoul ? <> 서울 상권 평균 {fmt(FL.seoul)}명보다 <b>{near1(FL.day, FL.seoul)}</b>,</> : null} 가장 붐비는 때는 <b>{when(FL.peak)}</b>예요.</>,
      pic: <><Note y={96}>시간대 · 점 하나 {fU}%</Note><Pips rows={FL.hours.map(([t, v]) => [String(t).replace(/^0(\d)/, '$1') + '시', v, v + '%', t === FL.peak])} u={fU} y={140} gap={46} />
        {FL.age && <><Note y={425}>지나가는 사람 나이</Note><Pips rows={FL.age.map(([t, v]) => [t, v, v + '%', v === Math.max(...FL.age.map(a => a[1]))])} u={fU} y={468} gap={46} k0={6} /></>}</> },
    PE && { id: 'people', txt: <>주변 상권에 <b>{fmt(PE.live)}명</b>이 살고 <b>{fmt(PE.work)}명</b>이 일해요.
      {' '}{PE.live >= PE.work ? <>사는 사람이 일하는 사람보다 <b>{ratio(PE.live, PE.work)}배</b> 많아요.</> : <>일하는 사람이 사는 사람보다 <b>{ratio(PE.work, PE.live)}배</b> 많아요.</>}
      {sp?.income && <> {GU} 직장인 월 급여는 <b>{fmt(sp.income)}만 원</b>으로 서울 구 평균보다 {sp.income >= sp.incomeSeoul ? '많아요' : '적어요'}.</>}</>,
      pic: <><Note y={96}>점 하나 {fmt(pU)}명</Note>
        <p className="plab" style={{ top: 132 }}>사는 사람 <b>{fmt(PE.live)}</b></p><Grid n={nl} y={180} hi={PE.live >= PE.work} />
        <p className="plab" style={{ top: yW - 8 }}>일하는 사람 <b>{fmt(PE.work)}</b></p><Grid n={nw} y={yW + 40} hi={PE.work > PE.live} k0={nl} />
        {sp?.income && <><Note y={yI}>직장인 월 급여 · 점 하나 {fmt(iU)}만</Note><Pips rows={[[GU || '이 구', sp.income, fmt(sp.income) + '만', true], ['서울 구 평균', sp.incomeSeoul, fmt(sp.incomeSeoul) + '만']]} u={iU} y={yI + 44} gap={46} k0={2} /></>}
        {PE.house > 0 && <Note y={sp?.income ? yI + 150 : yI}>세대 {fmt(PE.house)}</Note>}</> },
    CH?.years && { id: 'change', txt: <>최근 {CH.years.length}년 {ga(W)} <b>{opened}곳 열고 {closed}곳 닫았어요</b>.
      {s3?.[1] != null ? <> 3년 버틴 비율은 <b>{s3[1]}%</b>로 서울 {s3[2]}%{s3[1] > s3[2] ? '보다 높아요' : s3[1] < s3[2] ? '보다 낮아요' : '와 같아요'}.</>
        : CH.life != null && CH.lifeSeoul != null && <> 가게 평균 영업 기간은 <b>{CH.life}년</b>으로 서울 {CH.lifeSeoul}년보다 {CH.life < CH.lifeSeoul ? '짧아요' : '길어요'}.</>}</>,
      pic: <><Note y={96}>● 문 연 곳 &nbsp;○ 닫은 곳 · 주변 상권 {W}{cU > 1 ? ' · 점 하나 ' + cU + '곳' : ''}</Note>
        {CH.years.map(([y, o, c], r) => <div key={y} className="oc2" style={{ top: 140 + r * 96 }}><span>{y}</span>
          <Pips rows={[['', o, '+' + o, true]]} u={cU} y={0} k0={r * 2} rest={false} /><Pips rows={[[' ', c, '−' + c]]} u={cU} y={36} hollow k0={r * 2 + 1} rest={false} /></div>)}
        {sv?.s && <><Note y={460}>살아남은 비율 · 주변 상권 {W} · 점 하나 {sU}%</Note><Pips rows={sv.s.filter(x => x[1] != null).map(([t, v]) => [t, v, v + '%', t === '3년'])} u={sU} slots={Math.min(20, Math.round(100 / sU))} y={505} gap={46} k0={8} />
          {s3?.[2] != null && <Note y={660}>3년 · 서울 {s3[2]}%</Note>}</>}</> },
    P && { id: 'cost', txt: P.R && P.profit != null ? <>10평이면 월세는 <b>{fmt(P.R[1][1])}만 원</b>쯤이에요. 하루 110명이 오면 한 달에 <b>{P.profit >= 0 ? fmt(P.profit) + '만 원이 남고' : fmt(-P.profit) + '만 원이 모자라고'}</b>,
      {P.be ? <> <b>{P.be}명보다 적으면</b> 손해예요.</> : null} 오른쪽 값을 바꿔 볼 수 있어요.</>
      : <>10평에 1명 {fmt(6800)}원, 하루 110명이면 한 달 매출은 <b>{fmt(P.sales)}만 원</b>이에요. 처음 드는 돈은 <b>{fmt(P.total)}만 원</b>이에요.</>,
      pic: <Calc /> },
    D.insight && (IG.length || IW.length) && { id: 'insight', txt: <>{IG[0] && <>좋은 점부터 보면 <b>{IG[0][0]}</b>. </>}{IW[0] && <>다만 <b>{IW[0][0]}</b>.</>}</>,
      pic: <div className="ins"><Note y={96}>좋은 점</Note><ul style={{ top: 136 }}>{IG.map(([t, s], j) => <li key={t} style={{ '--j': j }}>{t}{s && <small>{s}</small>}</li>)}</ul>
        <Note y={440}>조심할 점</Note><ul className="w" style={{ top: 480 }}>{IW.map(([t, s], j) => <li key={t} style={{ '--j': j + 3 }}>{t}{s && <small>{s}</small>}</li>)}</ul></div> },
    rec.length > 0 && { id: 'fit', txt: <>{meRec && meRec !== rec[0] ? <>이 자리엔 <b>{rec[0][0]}</b>{pp(rec[0][0], '이', '가').slice(-1)} 더 맞아요.{meN && <> 주변 상권엔 {W}{pp(W, '이', '가').slice(-1)} 이미 <b>{meN}곳</b> 있어요.</>}</> : <>이 자리엔 <b>{rec[0][0]}</b>{pp(rec[0][0], '이', '가').slice(-1)} 가장 잘 맞아요.</>}
      {tr[0] && <> {GU}에선 <b>{tr[0][0]}</b>{pp(tr[0][0], '이', '가').slice(-1)} 가장 빠르게 뜨고 있어요.</>}</>,
      pic: <><Note y={96}>이 자리에 맞는 업종 · 점 하나 {rU}점</Note>
        <Pips rows={rec.map(([n, v, s], r) => [n === Q.what ? n + ' · 고른 업종' : n, v, v + '점', r === 0 || n === Q.what, [s?.match(/([\d.]+)배/)?.[1] && s.match(/([\d.]+)배/)[1] + '배', s?.match(/가게 (\d+)곳/)?.[1] && s.match(/가게 (\d+)곳/)[1] + '곳'].filter(Boolean).join(' · ')])} u={rU} slots={Math.min(12, Math.ceil(100 / rU))} y={140} gap={46} wide />
        {tr.length > 0 && <><Note y={420}>{GU} 뜨는 상권 · 1년 새 매출 · 점 하나 {tU}%</Note><Pips rows={tr.map(([n, v, s], r) => [n, Math.abs(parseFloat(v)), v, r === 0, s?.match(/(\d+)곳/)?.[0] ?? ''])} u={tU} slots={12} y={464} gap={46} k0={6} wide /></>}</> },
  ].filter(Boolean)
  const n0 = near[0], nm0 = n0 && shortName(n0.name || W)
  return [
    sc && { id: 'radar', txt: <>{W} 3곳 넘는 서울 상권 가운데 이곳은 <b>{best[0][0]} {best[0][1]}점</b>, <b>{best[1][0]} {best[1][1]}점</b>이에요.
      {low[1] < 50 && <> 대신 <b>{pp(low[0], '은', '는')} {low[1]}점</b>으로 낮아요.</>} 점선이 서울 가운데예요.</>,
      pic: <Radar score={sc} /> },
    { id: 'dots', txt: <>서울 상권 {fmt(C.cells)}곳과 비교하면 <b>{W} 수는 {C.topPct > 50 ? '중간보다 적지만' : '많고'}</b>, 비중은 <b>상위 {C.sharePct}%</b>예요. 경쟁 강도는 <b>{F.LV}</b>이에요.</>,
      pic: <><Dots label={W + ' 수'} pct={C.topPct} y={230} /><Dots label={W + ' 비중'} pct={C.sharePct} y={500} /></> },
    { id: 'near', txt: <>걸어서 5분 안 <b>{W} {near.length}곳</b> 중 <b>1층이 {f1}곳</b>이에요.
      {n0 && <> 가장 가까운 곳은 <b>{n0.dist}m</b> 떨어진 {pp(nm0, '이에요', '예요')}.</>}
      {near.length > 0 && <> 프랜차이즈는 {Math.round((S.fr / near.length) * 100)}%예요.</>}</>,
      pic: <ol className="near">
        {near.slice(0, 8).map((n, j) => <li key={j} style={{ top: 194 + j * 64, '--j': j }}><span>{n.name || W}</span><em>{n.floor ? n.floor + '층' : '층 모름'}</em><b>{n.dist}m</b></li>)}
        {near.length > 8 && <li className="etc" style={{ top: 194 + 8 * 64, '--j': 8 }}>그 밖에 {near.length - 8}곳 더</li>}
      </ol> },
    { id: 'bubbles', txt: <>이 근처에 가장 많은 건 <b>{top[0] ? top[0][0] + ' ' + top[0][1] + '곳' : ''}</b>. 그다음이 {top.slice(1, 4).map(([c, n], j) => <span key={c}>{j ? ', ' : ''}{c === Q.what ? <b>{c} {n}곳</b> : c + ' ' + n + '곳'}</span>)}이에요.</>,
      pic: <div className="bubbles">
        {top.map(([c, n], j) => {
          const s = Math.max(48, 124 * Math.sqrt(n / mx))
          return <span key={c} className={c === Q.what ? 'me' : ''} style={{ left: 120 + (j % 4) * 170, top: j < 4 ? 330 : 590, '--j': j }}>
            <i style={{ width: s, height: s }}><b>{n}</b></i><em>{c}</em>
          </span>
        })}
      </div> },
    ...more,
  ].filter(Boolean)
}

export default function More(ctx) {
  const F = useFacts(ctx)
  const parts = moreParts(F)
  const box = useRef(null)
  const [prog, setProg] = useState(0)
  useEffect(() => { const el = box.current; const on = () => setProg(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)); el.addEventListener('scroll', on); return () => el.removeEventListener('scroll', on) }, [])
  useEffect(() => { const on = e => { if (e.key === 'Escape') ctx.onBack() }; addEventListener('keydown', on); return () => removeEventListener('keydown', on) })
  // 섹션이 반쯤 보이면 seen을 달아 그때 그림이 움직인다 (한 번만)
  useEffect(() => {
    const el = box.current
    const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add('seen')), { root: el, threshold: .4 })
    el.querySelectorAll('section').forEach(s => io.observe(s))
    return () => io.disconnect()
  }, [])
  return (
    <div className="more" ref={box}>
      <i className="prog" style={{ transform: 'scaleX(' + prog + ')' }} />
      <i className="vbar"><i style={{ transform: 'translateY(' + prog * 160 + 'px)' }} /></i>
      <button className="back" onClick={ctx.onBack}>← 지도로</button>
      <div className="pg">
        {parts.map(p => (
          <section key={p.id}>
            <p className="txt">{words(p.txt)}</p>
            <div className="vis"><div className="in">{p.pic}</div></div>
          </section>
        ))}
      </div>
    </div>
  )
}
