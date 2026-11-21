import { useEffect, useMemo, useRef, useState } from 'react'
import { DEMO, BRANDS, BRAND_NAME } from './demo.js'
import Wheel from './Wheel.jsx'
import { Cols, Line, Radar, Split, Rows } from './charts.jsx'
import { shortAddr } from './LineMap.jsx'

const fmt = n => n.toLocaleString('ko-KR')
const pct = v => (v * 100).toFixed(1) + '%'
const floorTxt = f => (f > 0 ? f + '층' : f < 0 ? '지하' + -f + '층' : '층 모름')
const won = v => fmt(v) + '만'
// 공실 예산: 처음 드는 돈(보증금·인테리어·장비, 권리금 없음)
// 내 예산(만 원): 처음 드는 돈 · 매달 내는 돈(월세+관리비)
export const BUDGETS = {
  start: [[5000, '5천만 원'], [7000, '7천만 원'], [10000, '1억 원'], [15000, '1억 5천만 원'], [20000, '2억 원']],
  month: [[150, '150만 원'], [200, '200만 원'], [300, '300만 원'], [400, '400만 원'], [500, '500만 원']],
}
const budgetName = (k, v) => BUDGETS[k].find(b => b[0] === v)?.[1] ?? won(v) + ' 원'
const fits = (p, b) => p.cost && p.cost.start <= b.start && p.cost.month <= b.month
// 제목 안 숫자만 Michroma로
const num = t => { const m = String(t).match(/^(.*?)(\d[\d,.]*)(.*)$/); return m ? <>{m[1]}<em>{m[2]}</em>{m[3]}</> : t }

// 반경 안 숫자는 화면에서 다시 센다(반경 바꾸기)
function useStats(report, radius) {
  return useMemo(() => {
    const { shops, cats, query: Q } = report
    const inR = shops.filter(([x, y]) => Math.hypot(x, y) <= radius)
    const count = inR.filter(s => s[2] === Q.cat).length
    const mix = {}
    for (const s of inR) mix[cats[s[2]]] = (mix[cats[s[2]]] || 0) + 1
    const top = Object.entries(mix).sort((a, b) => b[1] - a[1]).slice(0, 8)
    const near = report.competitors.map((s, i) => ({ ...s, i })).filter(s => s.dist <= radius)
    const floors = { one: near.filter(s => s.floor === 1).length, up: near.filter(s => s.floor > 1 || s.floor < 0).length, none: near.filter(s => s.floor === 0).length }
    // 브랜드: 이름 앞부분으로 찾음
    const brand = {}
    for (const s of near) {
      const b = BRANDS.find(b => s.name.startsWith(b))
      if (b) brand[BRAND_NAME[b] || b] = (brand[BRAND_NAME[b] || b] || 0) + 1
    }
    const fr = Object.values(brand).reduce((a, b) => a + b, 0)
    return { total: inR.length, count, share: inR.length ? count / inR.length : 0, top, near, floors, brand: Object.entries(brand).sort((a, b) => b[1] - a[1]), fr }
  }, [report, radius])
}

// 자세히: 누르면 지도까지 덮는 넓은 화면에 칸(타일)으로 펼친다. 위 줄에서 다른 자세히로 바로 넘어간다
const FOLDS = [['comp', '경쟁'], ['sales', '매출'], ['flow', '유동인구 · 시설'], ['people', '사는·일하는 사람'], ['change', '개업 · 폐업'], ['cost', '임대료 · 손익'], ['good', '좋은 점 · 조심할 점'], ['fit', '맞는 업종']]
// 자세히는 모두 같은 검은 선 하나로 (항목마다 색을 다르게 하지 않음)
const FC = Object.fromEntries(FOLDS.map(([k]) => [k, '#16181d']))
function Fold({ id, t, d, children, open, setOpen }) {
  const isOpen = open === id
  // 다른 자세히에서 넘어온 것이면 넓어지는 전환 없이 카드만 바꾼다
  const cont = useMemo(() => isOpen && document.documentElement.classList.contains('sheeton'), [isOpen])
  return (
    <div id={'more-' + id} className={'fold' + (open === id ? ' open' : '')} style={{ '--c': FC[id] }}>
      <button className="fold-h" aria-expanded={open === id} onClick={() => setOpen(open === id ? null : id)}>
        <b className="dot" aria-hidden="true" /><span>{t}</span><small>{d}</small><i aria-hidden="true">›</i>
      </button>
      {open === id && (
        <div className={'sheet' + (cont ? ' cont' : '')} role="dialog" aria-label={t}>
          <div className="sheet-h">
            <button className="back" onClick={() => setOpen(null)}>← 지도로</button>
            <div className="ttl"><b>{t}</b><small>{d}</small></div>
            <nav aria-label="자세히 고르기">{FOLDS.map(([k, n]) => <button key={k} className={k === id ? 'on' : ''} style={{ '--c': FC[k] }} onClick={() => setOpen(k)}><b className="dot" aria-hidden="true" />{n}</button>)}</nav>
          </div>
          <div className="sheet-b"><div className="sheet-g" key={id}>{children}</div></div>
        </div>
      )}
    </div>
  )
}

function Sec({ id, k, title, sub, children, i = 0, demo, className = '' }) {
  return (
    <section id={id} className={'sec ' + className} style={{ '--i': i }}>
      <header>
        <span className="k m">{k}{demo && <span className="eg">예시</span>}</span>
        <h2>{title}</h2>{sub && <p>{sub}</p>}
      </header>
      {children}
    </section>
  )
}

export default function Report({ report, bld, budget, setBudget, radius, active, setActive, pick, saved, onSave }) {
  const { query: Q, compare: C } = report
  // W: 고른 업종(가게 수·경쟁) · SL: 서울시 매출 자료의 업종 이름 · GU: 자리가 든 구
  const W = Q.what, SL = DEMO.cat?.label || W, GU = DEMO.home?.gu || '이 구', vacOk = !DEMO.sales.sample && DEMO.sales.vac >= 5
  const S = useStats(report, radius)
  const [more, setMore] = useState(false)
  const [alarm, setAlarm] = useState(false)
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(null)
  const share = async () => {
    try { await navigator.clipboard.writeText(location.href) } catch { /* 복사가 막힌 브라우저 */ }
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }
  // 경쟁 강도: 서울 상권(가게 30곳 넘는 200m 칸) 가운데 카페 수·비중 순위를 평균
  const crowd = (100 - C.topPct + (100 - C.sharePct)) / 2
  const level = crowd >= 70 ? 2 : crowd >= 40 ? 1 : 0
  const LV = [['적음', `${W}가 적은 편`], ['보통', `${W} 수는 중간보다 적고, 비중은 높음`], ['많음', `${W}가 많고 비중도 높음`]]
  const list = more ? S.near : S.near.slice(0, 8)
  const D = DEMO
  const P = plan()
  const near3 = [...S.near].sort((a, b) => a.dist - b.dist).slice(0, 3)
  // 공실 후보: 상가 건물인데 등록된 가게가 없는 곳 (Overture 건물) · 예산 안에 드는 곳
  const vac = useMemo(() => bld && bld.features.map(f => f.properties).filter(p => p.empty === 1 && !p.tgt && p.dist <= radius).sort((a, b) => a.dist - b.dist), [bld, radius])
  const fit = vac ? vac.filter(p => fits(p, budget)) : []
  // 열린 예산 돌림판: 'start' | 'month' | null
  const [bw, setBw] = useState(null)
  const bRef = { start: useRef(null), month: useRef(null) }
  const F = 'in late'

  // 부드러운 스크롤: 휠 한 번에 바로 튀지 않고 목표 위치까지 미끄러지듯 따라간다 (터치는 기기 그대로)
  useEffect(() => {
    const col = document.querySelector('.col')
    if (!col || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let cur = col.scrollTop, target = cur, raf = 0
    const max = () => col.scrollHeight - col.clientHeight
    const tick = () => {
      cur += (target - cur) * .1
      if (Math.abs(target - cur) < .5) { cur = target; raf = 0 } else raf = requestAnimationFrame(tick)
      col.scrollTop = cur
    }
    const wheel = e => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.target.closest('.sheet')) return
      e.preventDefault()
      const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? col.clientHeight : 1
      if (!raf) cur = col.scrollTop // 스크롤바를 끌었거나 다른 데서 움직였으면 거기서 시작
      target = Math.max(0, Math.min(max(), (raf ? target : col.scrollTop) + e.deltaY * k))
      if (!raf) raf = requestAnimationFrame(tick)
    }
    col.addEventListener('wheel', wheel, { passive: false })
    return () => { col.removeEventListener('wheel', wheel); cancelAnimationFrame(raf) }
  }, [])

  // 스크롤해서 칸이 화면에 들어오면 그때 올라오고, 안의 그래프도 그때 차오른다
  useEffect(() => {
    const col = document.querySelector('.col')
    if (!col) return
    const t0 = performance.now()
    const io = new IntersectionObserver(es => {
      for (const e of es) {
        if (!e.isIntersecting) continue
        // 처음 화면에 보이던 칸은 원래 순서대로, 나중에 들어온 칸은 바로
        const late = performance.now() - t0 > 400
        e.target.classList.add('in', ...(late ? ['late'] : []))
        countUp(e.target, late ? 350 : 1150)
        io.unobserve(e.target)
      }
    }, { root: col, rootMargin: '0px 0px -12% 0px', threshold: 0.08 })
    col.querySelectorAll('.sec').forEach(s => io.observe(s))
    return () => io.disconnect()
  }, [])

  // 읽는 위치(칸 위쪽 40%)에 걸린 항목을 지도에 알린다: 매출=내 자리, 경쟁=카페, 비용=공실 후보, 그 아래=전체
  useEffect(() => {
    const col = document.querySelector('.col')
    if (!col) return
    let last
    const pick = () => {
      const y = col.getBoundingClientRect().top + col.clientHeight * .4
      let fk = null, cur
      const all = col.querySelectorAll('[data-fk]')
      for (const s of all) if (s.getBoundingClientRect().top <= y) { fk = s.dataset.fk; cur = s }
      if (!cur) { cur = all[0]; fk = cur?.dataset.fk }
      all.forEach(s => s.classList.toggle('cur', s === cur))
      if (fk !== last) { last = fk; dispatchEvent(new CustomEvent('zari-focus', { detail: fk })) }
    }
    pick()
    col.addEventListener('scroll', pick, { passive: true })
    return () => { col.removeEventListener('scroll', pick); dispatchEvent(new CustomEvent('zari-focus', { detail: null })) }
  }, [])

  // 펼친 칸: 숫자를 세어 올리고 그 칸 머리가 보이게 내린다
  useEffect(() => {
    if (!open) return
    const row = document.getElementById('more-' + open)
    row?.querySelectorAll('.sec').forEach(s => countUp(s, 250))
    document.documentElement.classList.add('sheeton')
    // Esc는 리포트를 닫기 전에 넓은 화면부터 닫는다
    const key = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); setOpen(null) } }
    addEventListener('keydown', key, true)
    return () => { removeEventListener('keydown', key, true); document.documentElement.classList.remove('sheeton') }
  }, [open])
  const fp = { open, setOpen }

  return (
    <div className="report">
      <ol className="zl">
        <li className="zi" data-fk="tgt" style={{ '--c': '#3b6fe0' }}>
          <span className="zk m"><i />HERE</span>
          <h2>{num(shortAddr(Q.address))}</h2>
          <p>{Q.near} · {Q.dong} · {Q.what}<br />{D.grade.t} <span className="zg m">{D.grade.g}</span></p>
          <div className="zacts">
            <button className={saved ? 'on' : ''} onClick={onSave}>{saved ? '✓ 비교함에 담음' : '비교함에 담기'}</button>
            <button className={alarm ? 'on' : ''} onClick={() => setAlarm(!alarm)}>{alarm ? '✓ 매월 알림' : '알림'}</button>
            <button className={copied ? 'on' : ''} onClick={share}>{copied ? '✓ 링크 복사' : '공유'}</button>
            <button onClick={() => print()}>저장</button>
          </div>
        </li>
        {vac && (
          <li className="zi" data-fk="empty" style={{ '--c': '#f08a3c' }}>
            <span className="zk m"><i />VACANT</span>
            <h2>공실 <em>{vac.length}</em>곳 · 예산 안 <em>{fit.length}</em>곳</h2>
            <p>상가 건물인데 등록된 가게가 하나도 없는 곳이에요.{fit[0] ? <><br />{fit[0].dist < 60 ? `예산 안 공실이 내 자리 바로 옆 ${fit[0].dist}m에도 있어요.` : `예산 안 공실 중 가장 가까운 곳은 ${fit[0].dist}m.`}</> : vac[0] && <><br />가장 가까운 공실은 {vac[0].dist}m, 예산을 늘려 보세요.</>}</p>
            <div className="zbud">
              {[['start', '처음 드는 돈'], ['month', '매달 내는 돈']].map(([k, t]) => (
                <span key={k} className="zb">{t}
                  <button ref={bRef[k]} className={'chip' + (bw === k ? ' on' : '')} onClick={() => setBw(bw === k ? null : k)} aria-haspopup="listbox" aria-expanded={bw === k}>{budgetName(k, budget[k])} 안</button>
                </span>
              ))}
              <small>처음: 권리금 없이 보증금·인테리어·장비 · 매달: 월세+관리비<span className="eg">추정</span></small>
            </div>
            {bw && <Wheel key={bw} anchor={bRef[bw].current} items={BUDGETS[bw].map(([v, n]) => [n, `공실 ${vac.filter(p => fits(p, { ...budget, [bw]: v })).length}곳`, true])} value={budgetName(bw, budget[bw])}
              label={bw === 'start' ? 'BUDGET · 처음' : 'BUDGET · 매달'}
              onPick={n => setBudget({ ...budget, [bw]: BUDGETS[bw].find(b => b[1] === n)[0] })} onClose={() => setBw(null)} />}
          </li>
        )}
        <li className="zi ring" data-fk="cafe">
          <span className="zk m"><i />RIVALS</span>
          <h2>{Q.what} <em>{S.count}</em>곳</h2>
          <p>걸어서 5분({radius}m) 안 가게 {fmt(S.total)}곳 중 {S.count}곳, {pct(S.share)}.<br />서울 평균 {pct(C.seoulShare)}보다 {S.share > C.seoulShare ? '많아요' : '적어요'}. 경쟁 강도 <b>{LV[level][0]}</b>.</p>
        </li>
        {near3.length > 0 && (
          <li className="zi ring" data-fk="near">
            <span className="zk m"><i />NEAREST</span>
            <h2>가장 가까운 {Q.what} <em>{near3[0].dist}</em>m</h2>
            <div className="zn">
              {near3.map(s => (
                <button key={s.i} className={active === s.i ? 'on' : ''} onMouseEnter={() => setActive(s.i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(s.i)} onBlur={() => setActive(null)} onClick={() => pick(s.i)}>
                  {s.name} · {s.dist}m · {floorTxt(s.floor)}
                </button>
              ))}
            </div>
          </li>
        )}
        <li className="zi" data-fk="cafe" style={{ '--c': '#3b6fe0' }}>
          <span className="zk m"><i />SALES</span>
          <h2>월매출 <em>{fmt(D.sales.month)}</em>만</h2>
          <p>{D.sales.sample ? <>{W}는 서울시 매출 자료가 없어 <b>예시 숫자</b>예요.</> : <>주변 상권 {SL} {D.sales.stores}곳 평균. 서울 평균 {fmt(D.sales.seoul)}만.</>}{vacOk && <><br />방학이 낀 1·3분기엔 {D.sales.vac}%쯤 줄어요.</>}</p>
        </li>
        {S.top[0] && (
          <li className="zi" data-fk="shop" style={{ '--c': '#6b7180' }}>
            <span className="zk m"><i />MIX</span>
            <h2>가장 많은 업종 {S.top[0][0]} <em>{S.top[0][1]}</em>곳</h2>
            <p>그다음 {S.top.slice(1, 5).map(([n, v]) => n + ' ' + v).join(' · ')}.</p>
          </li>
        )}
        <li className="zi" data-fk="tgt" style={{ '--c': '#3b6fe0' }}>
          <span className="zk m"><i />COST</span>
          <h2>처음 <em>{(P.total / 10000).toFixed(1)}</em>억{P.payback ? <>, <em>{P.payback}</em>개월</> : null}</h2>
          <p>10평 기준 보증금·권리금·인테리어·장비.<br />{P.payback ? `한 달 ${fmt(P.profit)}만 남으면 ${P.payback}개월에 되찾아요.` : '지금 값으로는 되찾지 못해요.'}<span className="eg">예시</span></p>
        </li>
      </ol>

      <span className="zk m zmore">MORE</span>
      <div className="folds">
      <Fold {...fp} id="comp" t="경쟁 자세히" d={`서울 상권과 비교 · ${W} 목록`}>
      <Sec className={F} k="INDEX" title="상권 지수" sub={`${SL} 3곳 넘는 서울 상권 가운데 순위를 100점으로 · 점선은 서울 가운데(50)`}>
        <div className="radarw"><Radar data={D.score} /></div>
      </Sec>

      <Sec className={F} k="COMPETITION" title="경쟁 강도" sub={`가게 30곳 넘는 서울 상권 ${fmt(C.cells)}곳과 비교 · 걸어서 5분(300m) 기준`}>
        <div className="signal">
          {LV.map(([t], k) => <div key={k} className={k === level ? 'on' : ''}><i />{t}</div>)}
        </div>
        <p className="note">{LV[level][1]}이에요.</p>
        <div className="rank">
          <div><span>{W} 수</span><Bar v={1 - C.topPct / 100} /><em>상위 {C.topPct}%</em></div>
          <div><span>{W} 비중</span><Bar v={1 - C.sharePct / 100} /><em>상위 {C.sharePct}%</em></div>
        </div>
        <p className="fine">서울 상권 중간값: {W} {C.medianCount}곳 · 비중 {pct(C.medianShare)}</p>
      </Sec>

      <Sec className={F} k="NEARBY" title={`가까운 ${W} ${S.near.length}곳`} sub={`1층 ${S.floors.one} · 2층 이상·지하 ${S.floors.up} · 층 모름 ${S.floors.none}`}>
        <ol className="near">
          {list.map(s => (
            <li key={s.i} className={active === s.i ? 'on' : ''} onMouseEnter={() => setActive(s.i)} onMouseLeave={() => setActive(null)} onClick={() => pick(s.i)}>
              <i className="dot" /><span className="nm">{s.name}</span><span className="fl">{floorTxt(s.floor)}</span><b className="m">{s.dist}M</b>
            </li>
          ))}
        </ol>
        {S.near.length > 8 && <button className="more m" onClick={() => setMore(!more)}>{more ? 'LESS' : `MORE +${S.near.length - 8}`}</button>}
        <div className="brand">
          <Split a="프랜차이즈" b="개인 가게" v={Math.round((S.fr / Math.max(S.near.length, 1)) * 100)} />
          <div className="chips">{S.brand.map(([b, n]) => <span key={b}>{b}{n > 1 && <b className="m">{n}</b>}</span>)}</div>
        </div>
      </Sec>

      <Sec className={F} k="STORE SALES" title="가게별 추정 월매출" sub="카드 결제로 추정한 범위 · 가까운 순" demo>
        <div className="ranges">
          {S.near.slice(0, 8).map((s, k) => {
            const [lo, hi] = D.storeRanges[k % D.storeRanges.length]
            return (
              <div key={s.i} className={active === s.i ? 'on' : ''} onMouseEnter={() => setActive(s.i)} onMouseLeave={() => setActive(null)} onClick={() => pick(s.i)}>
                <span className="nm">{s.name}</span>
                <span className="rg"><i style={{ left: (lo / 2600) * 100 + '%', width: ((hi - lo) / 2600) * 100 + '%' }} /></span>
                <b className="m">{fmt(lo)}–{fmt(hi)}</b>
              </div>
            )
          })}
        </div>
        <p className="fine">단위 만 원 · 막대 끝은 월 2,600만 원</p>
      </Sec>

      <Sec className={F} k="MIX" title="주변 업종 구성" sub="반경 안 가게를 업종별로 센 것">
        <Rows data={S.top} me={Q.what} />
      </Sec>

      </Fold>
      <Fold {...fp} id="sales" t="매출 자세히" d="분기 · 요일 · 시간 · 손님 나이">
      <Sec className={F} k="SALES" title={`${SL} 추정 매출`} demo={D.sales.sample} sub={D.sales.sample ? `${W}는 서울시 매출 자료가 없어 예시 숫자` : `주변 상권 ${D.area.n}곳 ${SL} ${D.sales.stores}곳 평균 · ${D.asOf.sales}`}>
        <div className="kpis">
          <div><span className="m">MONTH</span><b className="m">{fmt(D.sales.month)}</b><small>만 원 · 서울 {fmt(D.sales.seoul)}</small></div>
          <div><span className="m">TICKET</span><b className="m">{fmt(D.sales.ticket)}</b><small>결제 1건 · 서울 {fmt(D.sales.seoulTicket)}원</small></div>
          <div><span className="m">PER DAY</span><b className="m">{fmt(D.sales.perDay)}</b><small>1곳 하루 결제 건수</small></div>
        </div>
      </Sec>
      <Sec className={F} k="QUARTER" title="분기별 월평균"><Line data={D.sales.quarters} fmt={won} /></Sec>
      <Sec className={F} k="SEASON" title="분기별 매출">
        <Cols data={D.sales.season} unit="" />
        <p className="fine">최근 2년 평균 100 기준{vacOk && ` · 방학이 낀 1·3분기 평균이 다른 분기보다 ${D.sales.vac}% 적어요`}</p>
      </Sec>
      <Sec className={F} k="WEEK · HOUR" title="요일 · 시간대" sub="매출 비중(%)">
        <Cols data={D.sales.week} />
        <h3>시간대별</h3>
        <Cols data={D.sales.hours} />
      </Sec>
      <Sec className={F} k="GUEST" title="손님 연령 · 성별" sub="매출 비중(%)">
        <Rows data={D.sales.age} unit="%" me="20대" />
        <Split a="여성" b="남성" v={D.sales.female} />
      </Sec>

      </Fold>
      <Fold {...fp} id="flow" t="유동인구 · 주변 시설" d={`하루 ${fmt(D.flow.day)}명 · 역 · 학교`}>
      <Sec className={F} k="FOOT TRAFFIC" title="유동인구" sub={`주변 상권 ${D.area.n}곳 하루 평균 · ${D.asOf.flow}`}>
        <div className="kpis two">
          <div><span className="m">PER DAY</span><b className="m">{fmt(D.flow.day)}</b><small>명 · 서울 상권 평균 {fmt(D.flow.seoul)}</small></div>
          <div><span className="m">PEAK</span><b className="m">{D.flow.peak}</b><small>한 시간에 가장 붐비는 때</small></div>
        </div>
      </Sec>
      <Sec className={F} k="HOUR · WEEK" title="시간대 · 요일" sub="한 시간 기준 비중(%)">
        <Cols data={D.flow.hours} />
        <h3>요일별</h3>
        <Cols data={D.flow.week} />
      </Sec>
      <Sec className={F} k="AGE" title="지나가는 사람 연령">
        <Rows data={D.flow.age} unit="%" me="20대" />
        <Split a="여성" b="남성" v={D.flow.female} />
      </Sec>

      <Sec className={F} k="PLACES" title="주변 시설" sub="역 · 버스 · 학교 · 아파트 · 지도에서 주변 시설 켜기">
        <h3>가까운 지하철역 · 걸어서</h3>
        <div className="stations">
          {D.place.stations.map(([n, t, m]) => (
            <div key={n}><span>{n}</span><b className="m">{m}분</b><i style={{ width: Math.min(100, (m / 25) * 100) + '%' }} /><small>{t}</small></div>
          ))}
        </div>
      </Sec>
      <Sec className={F} k="HOMES" title="버스 · 아파트" sub="주변 상권 안">
        <div className="kpis">
          <div><span className="m">BUS</span><b className="m">{D.place.bus}</b><small>버스 정류장 · 지하철역 {D.place.subway}</small></div>
          <div><span className="m">APT</span><b className="m">{fmt(D.place.apt.house)}</b><small>아파트·도시형 {D.place.apt.complex}단지 세대</small></div>
          <div><span className="m">PRICE</span><b className="m">{D.place.apt.price}억</b><small>아파트 평균 시세</small></div>
        </div>
        <h3>아파트 면적별 세대</h3>
        <Rows data={D.place.apt.sizes} unit="%" />
      </Sec>
      <Sec className={F} k="AROUND" title="학교 · 생활 시설" sub="주변 상권 안 집객 시설">
        <div className="places-grid">
          {[...D.place.schools, ...D.place.etc].map(([n, v]) => <div key={n}><b className="m">{v}</b><small>{n}</small></div>)}
        </div>
        <p className="fine">서울과기대 정문 앞 · 원룸·소형 아파트가 많아 1인 손님 비중이 높아요.</p>
      </Sec>

      </Fold>
      <Fold {...fp} id="people" t="주변에 사는·일하는 사람" d="걸어서 10분">
      <Sec className={F} k="RESIDENTS" title="주변에 사는·일하는 사람" sub={`주변 상권 ${D.area.n}곳 · ${D.asOf.flow}`}>
        <div className="kpis">
          <div><span className="m">LIVE</span><b className="m">{fmt(D.people.live)}</b><small>사는 사람</small></div>
          <div><span className="m">WORK</span><b className="m">{fmt(D.people.work)}</b><small>일하는 사람</small></div>
          <div><span className="m">HOUSE</span><b className="m">{fmt(D.people.house)}</b><small>세대</small></div>
        </div>
        <p className="fine">세대 수는 상주인구 자료 기준 · 원룸·다세대가 많아요</p>
      </Sec>
      {D.real.spend ? <Spend sp={D.real.spend} F={F} GU={GU} /> : (
      <Sec className={F} k="SPEND" title={`소득 · ${W} 지출`} demo>
        <div className="kpis two">
          <div><span className="m">INCOME</span><b className="m">{D.people.income}만</b><small>월평균 소득 · 서울 {D.people.incomeSeoul}만</small></div>
          <div><span className="m">CAFE SPEND</span><b className="m">{D.people.cafeSpend}만</b><small>1명 한 달 {W} 지출</small></div>
        </div>
        <h3>생활비 중 {W} 지출 비중</h3>
        <Rows data={D.people.spend} unit="%" me="20대" />
      </Sec>)}

      </Fold>
      <Fold {...fp} id="change" t="개업 · 폐업" d="최근 3년">
      <Sec className={F} k="OPEN · CLOSE" title="개업 · 폐업" sub={`주변 상권 ${SL} · 2023–2025`}>
        <div className="signal four">
          {D.change.states.map(t => <div key={t} className={t === D.change.state ? 'on' : ''}><i />{t}</div>)}
        </div>
        <p className="note">{D.change.stateNote}</p>
        <div className="oc">
          {D.change.years.map(([y, o, c]) => (
            <div key={y}><span>{y}</span><i className="o" style={{ width: o * 7 + 'px' }} /><b className="m">+{o}</b><i className="c" style={{ width: c * 7 + 'px' }} /><b className="m">−{c}</b></div>
          ))}
        </div>
      </Sec>
      {D.real.survive ? <Survive sv={D.real.survive} F={F} W={W} D={D} /> : <>
      <Sec className={F} k="SURVIVAL" title="살아남은 비율" sub="이 상권 · 서울" demo>
        <div className="surv">
          {D.change.survive.map(([y, a, b]) => (
            <div key={y}><span>{y}</span><span className="rg2"><i style={{ width: a + '%' }} /><u style={{ left: b + '%' }} /></span><b className="m">{a}%</b></div>
          ))}
        </div>
        <p className="fine">가게 평균 영업 {D.change.life}년 · 서울 {D.change.lifeSeoul}년 (실제) · 생존율 막대는 예시 · 세로선은 서울</p>
      </Sec>
      <Sec className={F} k="AGE" title="지금 가게들이 문 연 지" demo>
        <Rows data={D.change.ages} unit="%" />
        <p className="fine">1년 미만이 23% · 새 가게가 자주 들어오는 상권이에요.</p>
      </Sec>
      </>}

      </Fold>
      <Fold {...fp} id="cost" t="임대료 · 손익 계산" d="직접 바꿔 보기">
      {D.real.rent ? <Rent rt={D.real.rent} C={D.cost} F={F} /> : <>
      <Sec className={F} k="RENT" title="임대료 · 비용" sub="1층 상가 시세 · 2026 상반기" demo>
        <div className="kpis">
          <div><span className="m">RENT</span><b className="m">{D.cost.rent}만</b><small>㎡당 월 · {GU} {D.cost.rentGu}</small></div>
          <div><span className="m">DEPOSIT</span><b className="m">{fmt(D.cost.deposit)}</b><small>보증금 만 원</small></div>
          <div><span className="m">PREMIUM</span><b className="m">{fmt(D.cost.premium)}</b><small>권리금 · 앞 가게에 주는 돈(만 원)</small></div>
        </div>
        <p className="fine">{D.cost.size}㎡(10평) 기준 월 임대료 약 {won(Math.round(D.cost.rent * D.cost.size))} 원</p>
      </Sec>
      <Sec className={F} k="TREND" title="㎡당 월 임대료 · 반기별" demo>
        <Line data={D.cost.trend} fmt={v => v + '만'} />
        <h3>다른 곳과 비교</h3>
        <Rows data={[['이 상권', D.cost.rent], [GU, D.cost.rentGu], ['서울', D.cost.rentSeoul]]} unit="만" me="이 상권" wide />
      </Sec>
      </>}

        <Sim className={F} />
      </Fold>
      <Fold {...fp} id="good" t="좋은 점 · 조심할 점" d="한 줄씩">
        <section className={"sec wide " + F}>
        <div className="insight">
          <div><span className="m">GOOD</span><ul>{D.insight.good.map(t => <li key={t}>{t}</li>)}</ul></div>
          <div className="w"><span className="m">WATCH</span><ul>{D.insight.warn.map(t => <li key={t}>{t}</li>)}</ul></div>
        </div>
        </section>
      </Fold>
      <Fold {...fp} id="fit" t="맞는 업종 · 뜨는 상권" d={GU}>
      <Sec className={F} k="FIT" title="이 자리에 맞는 업종" sub="같은 갈래 업종 · 1곳 매출과 가게 수를 함께 본 점수">
        <ol className="fit">
          {D.recommend.map(([n, v, w], k) => (
            <li key={n} className={n === Q.what ? 'me' : ''}><b className="m">{String(k + 1).padStart(2, '0')}</b><div><span>{n}</span><small>{w}</small></div><em className="m">{v}</em></li>
          ))}
        </ol>
      </Sec>

      <Sec className={F} k="RISING" title={`${GU} 뜨는 상권`} sub={`${SL} 매출 1년 전 대비 · ${SL} 3곳 넘는 상권`}>
        <ol className="fit">
          {D.trend.map(([n, v, w], k) => (
            <li key={n}><b className="m">{String(k + 1).padStart(2, '0')}</b><div><span>{n}</span><small>{w}</small></div><em className="m">{v}</em></li>
          ))}
        </ol>
      </Sec>

      </Fold>
      </div>

      <p className="asof">기준 · 매출 {D.asOf.sales} · 인구 {D.asOf.flow} · 가게 {D.asOf.shops} · 임대료 {D.asOf.rent} · 건물 Overture 2026-10</p>
      <p className="src m">SOURCE · {report.source} · 서울 열린데이터광장 상권분석서비스<br />소득 국세청 · 지출 소비-행정동 · 생존율 인허가 이력 · 임대료 한국부동산원 · 권리금 서울시 상가임대차 실태조사 · 예시 표시 칸은 기획 시연용 숫자</p>
    </div>
  )
}

// 매출·손익 계산: 값을 바꾸면 바로 다시 셈
// 매출·손익 계산식: 계산기와 비용 띠가 같이 쓴다
function plan(size = 10, ticket = 6800, guests = 110) {
  const sales = Math.round((ticket * guests * 30) / 10000)
  const rent = Math.round(DEMO.cost.rent * size * 3.3)
  const cost = Math.round(sales * .33)
  const labor = Math.round(260 + size * 12)
  const etc = Math.round(sales * .08 + 40)
  const profit = sales - rent - cost - labor - etc
  const fixed = rent + labor + 40
  const be = Math.ceil((fixed * 10000) / (ticket * 30 * (1 - .33 - .08)))
  const R = [['재료비', cost], ['임대료', rent], ['인건비', labor], ['기타', etc]]
  // 처음 드는 돈: 보증금은 돌려받으니 회수 기간에서 뺀다
  const C0 = DEMO.cost, interior = C0.interior * size
  const start = [['보증금', C0.deposit], ['권리금', C0.premium], ['인테리어', interior], ['장비', C0.equip]]
  const total = start.reduce((a, [, v]) => a + v, 0), sunk = total - C0.deposit
  const payback = profit > 0 ? Math.ceil(sunk / profit) : null
  // 이 매출이 이 상권 카페 가운데 어디쯤인지: 평균 둘레로 퍼진 분포(표준편차 평균의 35%)로 셈
  const z = (sales - DEMO.sales.month) / (DEMO.sales.month * .35)
  const top = Math.min(99, Math.max(1, Math.round((1 - cdf(z)) * 100)))
  return { sales, profit, be, R, start, total, payback, top, C0 }
}

function Sim({ className }) {
  const [size, setSize] = useState(10)
  const [ticket, setTicket] = useState(6800)
  const [guests, setGuests] = useState(110)
  const { sales, profit, be, R, start, total, payback, top, C0 } = plan(size, ticket, guests)
  return (
    <Sec className={className} k="SIMULATOR" title="매출 · 손익 계산" sub="값을 바꾸면 바로 다시 계산해요" demo>
      <div className="sim">
        <label><span>면적</span><input type="range" min="6" max="30" value={size} onChange={e => setSize(+e.target.value)} /><b className="m">{size}평</b></label>
        <label><span>1명이 쓰는 돈</span><input type="range" min="3000" max="15000" step="100" value={ticket} onChange={e => setTicket(+e.target.value)} /><b className="m">{fmt(ticket)}</b></label>
        <label><span>하루 손님</span><input type="range" min="30" max="300" value={guests} onChange={e => setGuests(+e.target.value)} /><b className="m">{guests}명</b></label>
      </div>
      <div className="kpis two">
        <div><span className="m">SALES</span><b className="m">{won(sales)}</b><small>월 예상 매출</small></div>
        <div className={profit < 0 ? 'neg' : ''}><span className="m">PROFIT</span><b className="m">{profit < 0 ? '−' : ''}{won(Math.abs(profit))}</b><small>월 남는 돈</small></div>
      </div>
      <div className="stack">
        {R.map(([n, v]) => <i key={n} style={{ flex: v }} title={n} />)}
        <i className="p" style={{ flex: Math.max(profit, 0) }} />
      </div>
      <div className="legend">{R.map(([n, v]) => <span key={n}>{n} {won(v)}</span>)}</div>
      <p className="note">하루 <b>{be}명</b> 넘게 와야 손해가 없어요.</p>
      <h3>이 매출은 이 상권 같은 업종 중</h3>
      <div className="pctl"><span className="rg"><i style={{ left: 100 - top + '%' }} /></span><b className="m">상위 {top}%</b></div>
      <h3>처음 드는 돈</h3>
      <div className="mix wide">
        {start.map(([n, v]) => <div key={n}><span>{n}</span><i style={{ width: (v / total) * 100 + '%' }} /><b className="m">{won(v)}</b></div>)}
      </div>
      <p className="note">모두 <b>{won(total)} 원</b>{payback ? <> · 보증금을 빼고 <b>{payback}개월</b>이면 되찾아요.</> : ' · 지금 값으로는 되찾지 못해요.'}</p>
      <p className="fine">인테리어 평당 {C0.interior}만 · 장비 {fmt(C0.equip)}만 · 권리금은 주변 시세</p>
    </Sec>
  )
}

// 칸이 보일 때 큰 숫자를 0부터 세어 올린다. 그사이 화면 값이 바뀌면(계산기 조작 등) 바로 멈춘다
const NUMS = '.kpis b, .mix b, .cols em, .line em, .pctl b, .walk b'
function countUp(sec, delay) {
  return // 숫자는 처음부터 다 보여 준다(세어 올리지 않음)
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const jobs = []
  for (const el of sec.querySelectorAll(NUMS)) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n; (n = w.nextNode());) {
      const txt = n.nodeValue
      if (!/\d/.test(txt)) continue
      const parts = txt.split(/(\d[\d,]*(?:\.\d+)?)/)
      const at = p => parts.map((x, i) => {
        if (i % 2 === 0) return x
        const dec = (x.split('.')[1] || '').length, v = parseFloat(x.replace(/,/g, '')) * p
        return x.includes(',') ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(dec)
      }).join('')
      n.nodeValue = at(0)
      jobs.push({ n, txt, at, last: n.nodeValue })
    }
  }
  if (!jobs.length) return
  const t0 = performance.now() + delay, D = 1100
  const step = () => {
    const p = Math.max(0, Math.min(1, (performance.now() - t0) / D)), e = 1 - Math.pow(1 - p, 3)
    for (const j of jobs) {
      if (j.done) continue
      if (j.n.nodeValue !== j.last) { j.done = true; continue }
      j.n.nodeValue = j.last = p >= 1 ? j.txt : j.at(e)
      if (p >= 1) j.done = true
    }
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// 표준정규분포 누적값 (근삿값)
function cdf(z) {
  const t = 1 / (1 + .3275911 * Math.abs(z) / Math.SQRT2)
  const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-z * z / 2)
  return z < 0 ? (1 - e) / 2 : (1 + e) / 2
}

function Bar({ v }) {
  return <span className="bar"><i style={{ left: v * 100 + '%' }} /><u /></span>
}

// 동 지출(소비-행정동) · 구 소득(국세청)
function Spend({ sp, F, GU }) {
  const m = Math.max(...sp.shares.map(x => Math.max(x[1], x[2])))
  const eok = v => (v / 1e8 >= 10 ? Math.round(v / 1e8) : Math.round(v / 1e7) / 10) + '억'
  return (
    <Sec className={F} k="SPEND" title="소득 · 지출" sub={`${GU} 직장인 급여 · ${sp.dong ?? '이 동'}에서 쓰는 돈`}>
      <div className="kpis two">
        <div><span className="m">INCOME</span><b className="m">{sp.income ?? '—'}만</b><small>{GU} 사는 직장인 월 급여 · 서울 구 평균 {sp.incomeSeoul}만</small></div>
        {sp.food != null && <div><span className="m">FOOD</span><b className="m">{eok(sp.food)}</b><small>한 분기 외식 지출{sp.foodGrow != null && ` · 1년 전보다 ${sp.foodGrow >= 0 ? '+' : ''}${sp.foodGrow}%`}</small></div>}
      </div>
      {sp.shares?.length > 0 && <>
        <h3>{sp.dong}에서 쓰는 돈 나누기</h3>
        <div className="surv wl">
          {sp.shares.map(([k, a, b]) => (
            <div key={k}><span>{k}</span><span className="rg2"><i style={{ width: a / m * 100 + '%' }} /><u style={{ left: b / m * 100 + '%' }} /></span><b className="m">{a}%</b></div>
          ))}
        </div>
      </>}
      <p className="fine">급여: 국세청 근로소득 연말정산(주소지, {sp.incomeAsOf}) · 지출: 서울시 상권분석서비스 소비-행정동({sp.spendAsOf}) · 세로선은 서울 동 가운데값</p>
    </Sec>
  )
}

// 생존율 · 문 연 지: 반경 안 같은 업종 가게의 인허가 개업·폐업 이력
function Survive({ sv, F, W, D }) {
  const few = sv.s[1][3] < 15
  const y1 = sv.ages?.[0][1], y1s = sv.agesSeoul?.[0]
  return <>
    <Sec className={F} k="SURVIVAL" title="살아남은 비율" sub={`반경 ${sv.r}m ${W} · 서울`}>
      <div className="surv">
        {sv.s.map(([y, a, b, n]) => (
          <div key={y}><span>{y}</span><span className="rg2"><i style={{ width: (a ?? 0) + '%' }} /><u style={{ left: b + '%' }} /></span><b className="m">{a == null ? '—' : a + '%'}</b></div>
        ))}
      </div>
      <p className="fine">{sv.from}년 뒤 문 연 {W} {sv.s[1][3]}곳 중 3년 뒤에도 영업 중인 비율 {sv.s[1][1] ?? '—'}% · 서울 {sv.s[1][2]}%{few ? ' · 가게가 적어 오차가 커요' : ''} · 가게 평균 영업 {D.change.life}년 · 세로선은 서울 · 행정안전부 인허가 이력({sv.asOf})</p>
    </Sec>
    {sv.ages && <Sec className={F} k="AGE" title="지금 가게들이 문 연 지" sub={`반경 ${sv.r}m 영업 중 ${sv.open}곳`}>
      <Rows data={sv.ages} unit="%" />
      <p className="fine">1년 미만 {y1}% · 서울 {y1s}%{y1 >= y1s + 5 ? ' · 새 가게가 자주 들어오는 자리예요' : y1 <= y1s - 5 ? ' · 오래 버틴 가게가 많은 자리예요' : ''} · 폐업 신고를 안 한 가게가 남아 있어 오래된 칸이 조금 부풀 수 있어요</p>
    </Sec>}
  </>
}

// 임대료 · 공실률 · 권리금: 가장 가까운 한국부동산원 조사 상권
function Rent({ rt, C, F }) {
  const far = rt.dist >= 1.5
  return <>
    <Sec className={F} k="RENT" title="임대료 · 비용" sub={`1층 상가 · ${rt.area} 상권 · ${rt.asOf}`}>
      <div className="kpis">
        <div><span className="m">RENT</span><b className="m">{rt.rent}만</b><small>㎡당 월 · 서울 {rt.seoul.rent}만</small></div>
        <div><span className="m">VACANCY</span><b className="m">{rt.vac}%</b><small>빈 가게 비율 · 서울 {rt.seoul.vac}%</small></div>
        <div><span className="m">PREMIUM</span><b className="m">{fmt(rt.key)}</b><small>권리금 · {rt.keyArea ?? '서울 평균'}(만 원)</small></div>
      </div>
      <p className="fine">{C.size}㎡(10평) 기준 월 임대료 약 {won(Math.round(rt.rent * C.size))} 원 · 보증금은 월세 10달치로 셈 · 임대료는 가장 가까운 조사 상권 {rt.area}{rt.dist >= .3 ? `(${rt.dist}km)` : ''} 값{far ? ' · 떨어져 있어 이 자리와 다를 수 있어요' : ''}</p>
    </Sec>
    <Sec className={F} k="TREND" title="㎡당 월 임대료 · 분기별" sub={rt.area}>
      <Line data={rt.trend} fmt={v => v + '만'} />
      <h3>다른 곳과 비교</h3>
      <Rows data={[[rt.area, rt.rent], ['서울', rt.seoul.rent]]} unit="만" me={rt.area} wide />
      <p className="fine">한국부동산원 상업용부동산 임대동향조사({rt.kind === 'small' ? '소규모' : '중대형'} 상가, 1층) · 권리금 서울시 상가임대차 실태조사(2023, 1층 점포)</p>
    </Sec>
  </>
}
