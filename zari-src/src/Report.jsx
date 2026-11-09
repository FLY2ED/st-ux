import { useEffect, useMemo, useState } from 'react'
import { DEMO, BRANDS, BRAND_NAME } from './demo.js'
import { Cols, Line, Radar, Split, Rows } from './charts.jsx'

const fmt = n => n.toLocaleString('ko-KR')
const pct = v => (v * 100).toFixed(1) + '%'
const floorTxt = f => (f > 0 ? f + '층' : f < 0 ? '지하' + -f + '층' : '층 모름')
const won = v => fmt(v) + '만'

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

export const TABS = [['sum', '요약'], ['comp', '경쟁'], ['sales', '매출'], ['flow', '유동인구'], ['people', '배후'], ['place', '시설'], ['change', '개폐업'], ['cost', '비용'], ['sim', '계산'], ['fit', '추천'], ['check', '체크']]

function Sec({ id, k, title, sub, children, i = 0, demo, className = '' }) {
  return (
    <section id={id} className={'sec sq ' + className} style={{ '--i': i }}>
      <header>
        <span className="k m">{k}{demo && <span className="eg">예시</span>}</span>
        <h2>{title}</h2>{sub && <p>{sub}</p>}
      </header>
      {children}
    </section>
  )
}

export default function Report({ report, radius, setRadius, active, setActive, pick, saved, onSave }) {
  const { query: Q, compare: C } = report
  const S = useStats(report, radius)
  const [more, setMore] = useState(false)
  const [alarm, setAlarm] = useState(false)
  const [copied, setCopied] = useState(false)
  const share = async () => {
    try { await navigator.clipboard.writeText(location.href) } catch { /* 복사가 막힌 브라우저 */ }
    setCopied(true); setTimeout(() => setCopied(false), 1800)
  }
  const [tab, setTab] = useState('sum')
  // 경쟁 강도: 서울 상권(가게 30곳 넘는 200m 칸) 가운데 카페 수·비중 순위를 평균
  const crowd = (100 - C.topPct + (100 - C.sharePct)) / 2
  const level = crowd >= 70 ? 2 : crowd >= 40 ? 1 : 0
  const LV = [['여유', '카페가 적은 편'], ['보통', '카페 수는 중간보다 적고, 비중은 높음'], ['과밀', '카페가 많고 비중도 높음']]
  const list = more ? S.near : S.near.slice(0, 8)
  const D = DEMO

  // 스크롤하면 지금 보는 칸의 탭을 켠다
  useEffect(() => {
    const col = document.querySelector('.col')
    if (!col) return
    const on = () => {
      let cur = TABS[0][0]
      for (const [id] of TABS) { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top < col.getBoundingClientRect().top + 90) cur = id }
      setTab(cur)
    }
    col.addEventListener('scroll', on, { passive: true })
    return () => col.removeEventListener('scroll', on)
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
        e.target.classList.add('in', ...(performance.now() - t0 > 400 ? ['late'] : []))
        io.unobserve(e.target)
      }
    }, { root: col, rootMargin: '0px 0px -12% 0px', threshold: 0.08 })
    col.querySelectorAll('.sec').forEach(s => io.observe(s))
    return () => io.disconnect()
  }, [])

  const jump = id => {
    setTab(id)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="report">
      <section className="sec head sq" style={{ '--i': 0 }}>
        <span className="k m">REPORT · CAFE · {radius}M</span>
        <h1>{Q.address}</h1>
        <p className="where">{Q.near} · {Q.dong} · {Q.what}</p>
        <div className="row">
          <div className="seg m" role="group" aria-label="반경">
            {[300, 500].map(r => <button key={r} className={r === radius ? 'on' : ''} onClick={() => setRadius(r)}>{r}M</button>)}
          </div>
          <button className={'act m' + (saved ? ' on' : '')} onClick={onSave}>{saved ? '✓ 비교함' : '+ 비교함'}</button>
          <button className={'act m' + (alarm ? ' on' : '')} onClick={() => setAlarm(!alarm)}>{alarm ? '✓ 매월 알림' : '알림'}</button>
          <button className={'act m' + (copied ? ' on' : '')} onClick={share}>{copied ? '✓ 링크 복사' : '공유'}</button>
          <button className="act m" onClick={() => print()}>저장</button>
        </div>
        <p className="asof">기준 · 매출 {D.asOf.sales} · 가게 {D.asOf.shops} · 임대료 {D.asOf.rent}</p>
      </section>

      <nav className="tabs" aria-label="리포트 목차">
        {TABS.map(([id, t]) => <button key={id} className={tab === id ? 'on' : ''} onClick={() => jump(id)}>{t}</button>)}
      </nav>

      <Sec id="sum" i={1} k="01 · SUMMARY" title="한눈에">
        <div className="grade">
          <b className="m">{D.grade.g}</b>
          <div><span>{D.grade.t}<em className="eg">예시</em></span><p>{D.grade.s}</p></div>
        </div>
        <p className="lead">반경 {radius}m 안 가게 <b>{fmt(S.total)}곳</b> 가운데 카페가 <b>{S.count}곳</b>이에요. 가게 {Math.round(1 / S.share)}곳 중 1곳꼴로, 서울 전체 비중({pct(C.seoulShare)})보다 높아요.</p>
        <div className="kpis">
          <div><span className="m">SHOPS</span><b className="m">{fmt(S.total)}</b><small>반경 안 가게</small></div>
          <div><span className="m">CAFES</span><b className="m">{S.count}</b><small>같은 업종</small></div>
          <div><span className="m">SHARE</span><b className="m">{pct(S.share)}</b><small>서울 {pct(C.seoulShare)}</small></div>
        </div>
        <div className="insight">
          <div><span className="m">GOOD<em className="eg">예시</em></span><ul>{D.insight.good.map(t => <li key={t}>{t}</li>)}</ul></div>
          <div className="w"><span className="m">WATCH<em className="eg">예시</em></span><ul>{D.insight.warn.map(t => <li key={t}>{t}</li>)}</ul></div>
        </div>
      </Sec>

      <Sec id="score" i={2} k="02 · INDEX" title="상권 지수" sub="다섯 가지를 100점으로 · 점선은 서울 평균(50)" demo>
        <div className="radarw"><Radar data={D.score} /></div>
      </Sec>

      <Sec id="comp" i={3} k="03 · COMPETITION" title="경쟁 강도" sub={`가게 30곳 넘는 서울 상권 ${fmt(C.cells)}곳과 비교 · 반경 300m 기준`}>
        <div className="signal">
          {LV.map(([t], k) => <div key={k} className={k === level ? 'on' : ''}><i />{t}</div>)}
        </div>
        <p className="note">{LV[level][1]}이에요.</p>
        <div className="rank">
          <div><span>카페 수</span><Bar v={1 - C.topPct / 100} /><em>상위 {C.topPct}%</em></div>
          <div><span>카페 비중</span><Bar v={1 - C.sharePct / 100} /><em>상위 {C.sharePct}%</em></div>
        </div>
        <p className="fine">서울 상권 중간값: 카페 {C.medianCount}곳 · 비중 {pct(C.medianShare)}</p>
      </Sec>

      <Sec i={4} k="04 · NEARBY" title={`가까운 카페 ${S.near.length}곳`} sub={`1층 ${S.floors.one} · 2층 이상·지하 ${S.floors.up} · 층 모름 ${S.floors.none}`}>
        <ol className="near">
          {list.map(s => (
            <li key={s.i} className={active === s.i ? 'on' : ''} onMouseEnter={() => setActive(s.i)} onMouseLeave={() => setActive(null)} onClick={() => pick(s.i)}>
              <i className="dot" /><span className="nm">{s.name}</span><span className="fl">{floorTxt(s.floor)}</span><b className="m">{s.dist}M</b>
            </li>
          ))}
        </ol>
        {S.near.length > 8 && <button className="more m" onClick={() => setMore(!more)}>{more ? 'LESS' : `MORE +${S.near.length - 8}`}</button>}
        <div className="brand">
          <Split a="프랜차이즈" b="개인 카페" v={Math.round((S.fr / Math.max(S.near.length, 1)) * 100)} />
          <div className="chips">{S.brand.map(([b, n]) => <span key={b}>{b} <b className="m">{n}</b></span>)}</div>
        </div>
      </Sec>

      <Sec i={5} k="05 · STORE SALES" title="가게별 추정 월매출" sub="카드 결제로 추정한 범위 · 가까운 순" demo>
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

      <Sec id="sales" i={6} k="06 · SALES" title="카페 추정 매출" sub="이 상권 카페 1곳 평균 · 분기마다 갱신" demo>
        <div className="kpis">
          <div><span className="m">MONTH</span><b className="m">{fmt(D.sales.month)}</b><small>만 원 · 서울 {fmt(D.sales.seoul)}</small></div>
          <div><span className="m">TICKET</span><b className="m">{fmt(D.sales.ticket)}</b><small>객단가 원</small></div>
          <div><span className="m">DELIVERY</span><b className="m">{D.sales.delivery}%</b><small>배달 매출</small></div>
        </div>
        <h3>분기별 월평균</h3>
        <Line data={D.sales.quarters} fmt={won} />
        <h3>월별 · 성수기와 비수기</h3>
        <Cols data={D.sales.months} unit="" />
        <p className="fine">연평균 100 기준 · 방학(1·2·7·8월)이 비수기</p>
        <h3>요일별</h3>
        <Cols data={D.sales.week} />
        <h3>시간대별</h3>
        <Cols data={D.sales.hours} />
        <h3>손님 연령</h3>
        <Rows data={D.sales.age} unit="%" me="20대" />
        <Split a="여성" b="남성" v={D.sales.female} />
      </Sec>

      <Sec id="flow" i={7} k="07 · FOOT TRAFFIC" title="유동인구" sub="반경 안 하루 평균 · 지도에서 유동인구 켜기" demo>
        <div className="kpis two">
          <div><span className="m">PER DAY</span><b className="m">{fmt(D.flow.day)}</b><small>명 · 서울 상권 평균 {fmt(D.flow.seoul)}</small></div>
          <div><span className="m">PEAK</span><b className="m">17–21</b><small>퇴근·하교 시간</small></div>
        </div>
        <h3>시간대별</h3>
        <Cols data={D.flow.hours} />
        <h3>요일별</h3>
        <Cols data={D.flow.week} />
        <h3>연령</h3>
        <Rows data={D.flow.age} unit="%" me="20대" />
        <Split a="여성" b="남성" v={D.flow.female} />
      </Sec>

      <Sec id="people" i={8} k="08 · RESIDENTS" title="배후 인구" sub="걸어서 10분 안" demo>
        <div className="kpis">
          <div><span className="m">LIVE</span><b className="m">{fmt(D.people.live)}</b><small>상주 인구</small></div>
          <div><span className="m">WORK</span><b className="m">{fmt(D.people.work)}</b><small>직장 인구</small></div>
          <div><span className="m">STUDENT</span><b className="m">{fmt(D.people.student)}</b><small>서울과기대</small></div>
        </div>
        <p className="fine">{fmt(D.people.house)}세대 · 원룸·오피스텔 비중 높음</p>
        <div className="kpis two">
          <div><span className="m">INCOME</span><b className="m">{D.people.income}만</b><small>월평균 소득 · 서울 {D.people.incomeSeoul}만 · {D.people.tier}분위</small></div>
          <div><span className="m">CAFE SPEND</span><b className="m">{D.people.cafeSpend}만</b><small>1명 한 달 카페 지출</small></div>
        </div>
        <h3>생활비 중 카페 지출 비중</h3>
        <Rows data={D.people.spend} unit="%" me="20대" />
      </Sec>

      <Sec id="place" i={9} k="09 · PLACES" title="주변 시설" sub="역 · 버스 · 학교 · 아파트 · 지도에서 주변 시설 켜기" demo>
        <h3>가까운 지하철역 · 걸어서</h3>
        <div className="stations">
          {D.place.stations.map(([n, t, m]) => (
            <div key={n}><span>{n}</span><b className="m">{m}분</b><i style={{ width: Math.min(100, (m / 25) * 100) + '%' }} /><small>{t}</small></div>
          ))}
        </div>
        <div className="kpis">
          <div><span className="m">BUS</span><b className="m">{D.place.bus}</b><small>정류장 · 노선 {D.place.busLines}개</small></div>
          <div><span className="m">APT</span><b className="m">{fmt(D.place.apt.house)}</b><small>아파트 {D.place.apt.complex}단지 세대</small></div>
          <div><span className="m">PRICE</span><b className="m">{D.place.apt.price}억</b><small>아파트 평균 시세</small></div>
        </div>
        <h3>아파트 면적별 세대</h3>
        <Rows data={D.place.apt.sizes} unit="%" />
        <h3>학교 · 생활 시설</h3>
        <div className="places-grid">
          {[...D.place.schools, ...D.place.etc].map(([n, v]) => <div key={n}><b className="m">{v}</b><small>{n}</small></div>)}
        </div>
        <p className="fine">서울과기대 정문 앞 · 원룸·소형 아파트가 많아 1인 손님 비중이 높아요.</p>
      </Sec>

      <Sec id="change" i={10} k="10 · OPEN · CLOSE" title="개업 · 폐업" sub="반경 안 카페 · 최근 3년" demo>
        <div className="signal four">
          {D.change.states.map(t => <div key={t} className={t === D.change.state ? 'on' : ''}><i />{t}</div>)}
        </div>
        <p className="note">{D.change.stateNote}</p>
        <div className="oc">
          {D.change.years.map(([y, o, c]) => (
            <div key={y}><span>{y}</span><i className="o" style={{ width: o * 7 + 'px' }} /><b className="m">+{o}</b><i className="c" style={{ width: c * 7 + 'px' }} /><b className="m">−{c}</b></div>
          ))}
        </div>
        <h3>살아남은 비율 (이 상권 · 서울)</h3>
        <div className="surv">
          {D.change.survive.map(([y, a, b]) => (
            <div key={y}><span>{y}</span><span className="rg2"><i style={{ width: a + '%' }} /><u style={{ left: b + '%' }} /></span><b className="m">{a}%</b></div>
          ))}
        </div>
        <p className="fine">평균 영업 {D.change.life}년 · 서울 {D.change.lifeSeoul}년 · 세로선은 서울</p>
        <h3>지금 영업 중인 카페의 업력</h3>
        <Rows data={D.change.ages} unit="%" />
        <p className="fine">1년 미만이 23% · 새 가게가 자주 들어오는 상권이에요.</p>
      </Sec>

      <Sec id="cost" i={11} k="11 · RENT" title="임대료 · 비용" sub="1층 상가 시세 · 2026 상반기" demo>
        <div className="kpis">
          <div><span className="m">RENT</span><b className="m">{D.cost.rent}만</b><small>㎡당 월 · 노원 {D.cost.rentGu}</small></div>
          <div><span className="m">DEPOSIT</span><b className="m">{fmt(D.cost.deposit)}</b><small>보증금 만 원</small></div>
          <div><span className="m">PREMIUM</span><b className="m">{fmt(D.cost.premium)}</b><small>권리금 만 원</small></div>
        </div>
        <p className="fine">{D.cost.size}㎡(10평) 기준 월 임대료 약 {won(Math.round(D.cost.rent * D.cost.size))} 원</p>
        <h3>㎡당 월 임대료 · 반기별</h3>
        <Line data={D.cost.trend} fmt={v => v + '만'} />
        <h3>다른 곳과 비교</h3>
        <Rows data={[['이 상권', D.cost.rent], ['노원구', D.cost.rentGu], ['서울', D.cost.rentSeoul]]} unit="만" me="이 상권" />
      </Sec>

      <Sim i={12} />

      <Sec i={13} k="13 · MIX" title="주변 업종 구성" sub="반경 안 가게를 업종별로 센 것">
        <Rows data={S.top} me={Q.what} />
      </Sec>

      <Sec id="fit" i={14} k="14 · FIT" title="이 자리에 맞는 업종" sub="수요와 경쟁을 함께 본 점수" demo>
        <ol className="fit">
          {D.recommend.map(([n, v, w], k) => (
            <li key={n} className={n === Q.what ? 'me' : ''}><b className="m">{String(k + 1).padStart(2, '0')}</b><div><span>{n}</span><small>{w}</small></div><em className="m">{v}</em></li>
          ))}
        </ol>
      </Sec>

      <Sec i={15} k="15 · RISING" title="노원구 뜨는 상권" sub="최근 1년 카페 매출 증가율" demo>
        <ol className="fit">
          {D.trend.map(([n, v, w], k) => (
            <li key={n}><b className="m">{String(k + 1).padStart(2, '0')}</b><div><span>{n}</span><small>{w}</small></div><em className="m">{v}</em></li>
          ))}
        </ol>
      </Sec>

      <Check />

      <p className="src m">SOURCE · {report.source}<br />예시 표시 칸은 기획 시연용 숫자 · 서울 열린데이터 상권분석 연결 예정</p>
    </div>
  )
}

// 매출·손익 계산: 값을 바꾸면 바로 다시 셈
function Sim({ i }) {
  const [size, setSize] = useState(10)
  const [ticket, setTicket] = useState(6800)
  const [guests, setGuests] = useState(110)
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
  return (
    <Sec id="sim" i={i} k="12 · SIMULATOR" title="매출 · 손익 계산" sub="값을 바꾸면 바로 다시 계산해요" demo>
      <div className="sim">
        <label><span>면적</span><input type="range" min="6" max="30" value={size} onChange={e => setSize(+e.target.value)} /><b className="m">{size}평</b></label>
        <label><span>객단가</span><input type="range" min="3000" max="15000" step="100" value={ticket} onChange={e => setTicket(+e.target.value)} /><b className="m">{fmt(ticket)}</b></label>
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
      <h3>이 매출은 이 상권 카페 중</h3>
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

// 표준정규분포 누적값 (근삿값)
function cdf(z) {
  const t = 1 / (1 + .3275911 * Math.abs(z) / Math.SQRT2)
  const e = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-z * z / 2)
  return z < 0 ? (1 - e) / 2 : (1 + e) / 2
}

function Bar({ v }) {
  return <span className="bar"><i style={{ left: v * 100 + '%' }} /><u /></span>
}

// 계약 전 체크리스트: 고른 것은 이 브라우저에 남는다
function Check() {
  const [on, setOn] = useState(() => { try { return JSON.parse(localStorage.getItem('zari-check') || '[]') } catch { return [] } })
  const flip = n => {
    const next = on.includes(n) ? on.filter(x => x !== n) : [...on, n]
    setOn(next); try { localStorage.setItem('zari-check', JSON.stringify(next)) } catch { /* 저장이 막힌 브라우저 */ }
  }
  return (
    <Sec id="check" i={16} k="16 · CHECKLIST" title="계약 전에 확인할 것" sub={`데이터로는 알 수 없는 것 · ${on.length}/${DEMO.check.length} 확인`}>
      <ul className="check">
        {DEMO.check.map(([n, t]) => (
          <li key={n} className={on.includes(n) ? 'on' : ''}>
            <button onClick={() => flip(n)} aria-pressed={on.includes(n)}><i /><span><b>{n}</b><small>{t}</small></span></button>
          </li>
        ))}
      </ul>
    </Sec>
  )
}
