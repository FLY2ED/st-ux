import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { findCat, search } from '../search.js'
import { loadCats, loadCmp } from '../report.js'
import { PRESETS, strip, pp } from './data.js'

// 업종 고르기: 왼쪽 점 바퀴, 오른쪽 호를 따라 업종 이름. 가운데(굵게)가 고른 것
const WHATS = [['베이커리', '빵/도넛'], ['떡집', '떡/한과'], ['아이스크림', '아이스크림/빙수'], ['샐러드', '토스트/샌드위치/샐러드'], ['꽃집', '꽃집'], ['분식', '김밥/만두/분식'], ['네일숍', '네일숍'], ['피부 관리', '피부 관리실'],
  ['카페', '카페'], ['음식점', '백반/한정식'], ['국수집', '국수/칼국수'], ['중국집', '중국집'], ['일식', '일식 회/초밥'], ['돈가스', '일식 카레/돈가스/덮밥'], ['파스타', '파스타/스테이크'], ['쌀국수', '베트남식 전문'], ['마라탕', '마라탕/훠궈'],
  ['치킨', '치킨'], ['피자', '피자'], ['버거', '버거'], ['고깃집', '돼지고기 구이/찜'], ['족발·보쌈', '족발/보쌈'], ['술집', '요리 주점'], ['호프', '생맥주 전문'],
  ['미용실', '미용실'], ['편의점', '편의점'], ['반찬가게', '반찬/식료품 소매업'], ['과일가게', '채소/과일 소매업'], ['정육점', '정육점'], ['약국', '약국'], ['안경점', '안경렌즈 소매업'], ['화장품', '화장품 소매업'],
  ['옷가게', '여성 의류 소매업'], ['문구점', '문구/회화용품 소매업'], ['서점', '서점'], ['반려동물', '애완동물/애완용품 소매업'], ['세탁소', '세탁소'], ['빨래방', '셀프 빨래방'], ['스터디 카페', '독서실/스터디 카페'],
  ['필라테스', '요가/필라테스 학원'], ['헬스장', '헬스장'], ['노래방', '노래방'], ['PC방', 'PC방'], ['사진관', '사진촬영업'], ['미술학원', '미술학원'], ['공부방', '입시·교과학원']]
// 업종 한 칸 = 바퀴 STEP도. 글자 부채와 바퀴가 같은 각도로 맞물려 돈다
const STEP = 10

// 휠·화살표로 한 칸씩 (한 번 굴리면 한 칸)
function useStepper(n, i, set) {
  const lock = useRef(0)
  return e => {
    const now = performance.now()
    if (now - lock.current < 110 || Math.abs(e.deltaY) < 4) return
    lock.current = now
    set(Math.max(0, Math.min(n - 1, i + Math.sign(e.deltaY))))
  }
}

// 점 바퀴: 업종에선 가운데 큰 바퀴, 자리에선 왼쪽 밖으로 크게 당겨진 바퀴(같은 바퀴가 확대되며 넘어감)
export const whatIndex = cat => Math.max(0, WHATS.findIndex(w => w[1] === cat))
// 동심원 격자 점 (바퀴 반지름 기준 비율 f와 각도 a). 바깥 테두리는 업종 하나에 큰 점 하나씩
const GRID = [[0, 0]]
for (let i = 1; i < 10; i++) { const n = Math.round(2 * Math.PI * i), off = i % 2 ? 180 / n : 0; for (let j = 0; j < n; j++) GRID.push([i / 10, off + (j * 360) / n]) }
const BIG = 360 / STEP
// 안쪽 고리(가운데 숫자 자리)는 비우고, 바깥 고리 점들을 가게 100곳에 하나씩 채운다
export const PER = 100
const CORE = .3
// 채우는 순서: 안쪽 고리부터, 같은 고리에선 글자 쪽(화면 오른쪽)에 가까운 점부터
function fillOrder(rot) {
  const d = a => { const x = (((a + rot) % 360) + 540) % 360 - 180; return Math.abs(x) }
  return GRID.map(([f, a], j) => ({ j, f, d: d(a) })).filter(g => g.f > CORE).sort((p, q) => p.f - q.f || p.d - q.d).map(g => g.j)
}
export function Wheel({ k, zoom, n }) {
  const m = ((k % BIG) + BIG) % BIG
  const on = useMemo(() => {
    if (n == null) return null
    const ord = fillOrder(-k * STEP), s = new Set(ord.slice(0, Math.max(1, Math.round(n / PER))))
    return s
  }, [k, n])
  return (
    <div className={'wheel' + (zoom ? ' zoom' : '') + (on ? ' filled' : '')} style={{ '--rot': -k * STEP + 'deg' }} aria-hidden="true">
      <div className="spin">
        {GRID.map(([f, a], j) => <i key={j} className={'wd' + (f <= CORE ? ' c' : '') + (on?.has(j) ? ' on' : '')} style={{ '--a': a + 'deg', '--f': f, '--q': (f * .5).toFixed(2) + 's', '--j': (((j * .6180339) % 1) * 1.4 - .4).toFixed(2) }} />)}
        {/* 고른 업종의 점만 글 쪽으로 살짝 비켜 나온다 */}
        {Array.from({ length: BIG }, (_, j) => <i key={'b' + j} className={'wb' + (j === m ? ' on' : '')} style={{ '--a': j * STEP + 'deg', '--q': (.5 + j * .012).toFixed(3) + 's', '--j': j === m ? 0 : (((j * .7548776) % 1) * 1.2 - .2).toFixed(2) }} />)}
      </div>
    </div>
  )
}

// 업종 글자가 있던 화면 자리 (다음 화면의 "…을" 글자가 여기서 출발한다)
let HAND = null

export function What({ what, onPick }) {
  const [q, setQ] = useState('')
  const [leave, setLeave] = useState(false)
  const [cats, setCats] = useState([])
  const [cmp, setCmp] = useState(null)
  useEffect(() => { loadCats().then(c => setCats(c || [])); loadCmp().then(setCmp) }, [])
  const list = useMemo(() => (q.trim() ? findCat(q, cats).map(h => [h.label, h.label]) : WHATS), [q, cats])
  const [i, setI] = useState(() => whatIndex(what.cat))
  const k = Math.min(i, list.length - 1)
  useEffect(() => { if (q.trim()) setI(0) }, [q])
  const wheel = useStepper(list.length, k, setI)
  // 서울에 같은 업종 가게가 몇 곳인지 (상가 정보 기준)
  const cur = list[k], ci = cur ? cats.indexOf(cur[1]) : -1, n = ci >= 0 ? cmp?.cat?.[ci]?.n : null
  const pick = j => {
    const w = list[j]
    if (!w || leave) return
    HAND = document.querySelector('.fan.kinds li.on span')?.getBoundingClientRect() || null
    setLeave(true)
    setTimeout(() => onPick({ t: w[0], cat: w[1], n }), 320)
  }
  const inp = useRef(null)
  useEffect(() => {
    const on = e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { setI(v => Math.min(list.length - 1, v + 1)); e.preventDefault() }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { setI(v => Math.max(0, v - 1)); e.preventDefault() }
      else if (e.key === 'Enter') pick(k)
      else if (e.key.length === 1 || e.key === 'Backspace') inp.current?.focus()
    }
    addEventListener('keydown', on)
    return () => removeEventListener('keydown', on)
  })
  return (
    <div className={'home what' + (leave ? ' leave' : '')} onWheel={wheel}>
      <Wheel k={q.trim() ? 0 : k} n={n} />
      {n != null && (
        <p className="wnum" aria-live="polite">
          <b>{n.toLocaleString()}</b>
          <span>서울 {cur[0]} 가게 · 점 하나 {PER}곳</span>
        </p>
      )}
      <ul className="fan kinds" role="listbox" aria-label="업종">
        {list.map(([t], j) => {
          const d = j - k
          return (
            <li key={t + j} role="option" aria-selected={d === 0} className={d === 0 ? 'on' : Math.abs(d) > 4 ? 'far' : ''}
              style={{ '--d': d, '--ad': Math.abs(d), '--o': Math.max(0, 1 - Math.abs(d) * .2) }}
              onClick={() => (d === 0 ? pick(j) : setI(j))}>
              <span>{t}</span>
            </li>
          )
        })}
        {!list.length && <li className="none" style={{ '--d': 0, '--o': .4 }}><span>찾는 업종이 없어요</span></li>}
      </ul>
      <label className="ask">
        <input ref={inp} value={q} onChange={e => setQ(e.target.value)} placeholder="무엇을 차릴까요" aria-label="업종 찾기" />
      </label>
    </div>
  )
}

// 자리 고르기: "사진관을 [____]에 차릴래요" · 빈칸 위아래로 주소 후보가 줄줄이 뜬다
const FIRST = ['성수역', '공릉로 232', '홍대입구역', '강남역'].map(l => PRESETS.find(p => p.label === l)).filter(Boolean)
// 후보 j번째 자리: 빈칸 바로 위, 바로 아래, 그 위, 그 아래 … (가까운 줄일수록 앞 후보)
const slot = j => (j % 2 ? 1 : -1) * (Math.floor(j / 2) + 1)

export function Where({ what, onPlace, onGo, onBack }) {
  const [txt, setTxt] = useState('')
  const [res, setRes] = useState(null)
  const [picked, setPicked] = useState(null)
  const [open, setOpen] = useState(true)
  const [si, setSi] = useState(-1)
  const [gen, setGen] = useState(0)
  const inp = useRef(null)
  const lead = useRef(null)
  useEffect(() => { inp.current?.focus() }, [])
  // 앞 화면에서 고른 업종 글자 자리에서 문장 첫머리로 미끄러져 온다
  useLayoutEffect(() => {
    const el = lead.current, h = HAND
    HAND = null
    if (!el || !h || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const r = el.getBoundingClientRect(), k = r.width / el.offsetWidth || 1
    const dx = (h.left - r.left) / k, dy = (h.top + h.height / 2 - (r.top + r.height / 2)) / k
    el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 750, easing: 'cubic-bezier(.22,.8,.24,1)' })
  }, [])
  // 입력하면 주소 후보를 새로 찾는다 (두 글자부터)
  useEffect(() => {
    const q = txt.trim()
    if (picked && txt === picked.label) return
    if (q.length < 2) { setRes(null); setSi(-1); return }
    let live = true
    const t = setTimeout(() => search(q).then(r => { if (live) { setRes(r.slice(0, 6)); setSi(-1); setGen(g => g + 1) } }), 220)
    return () => { live = false; clearTimeout(t) }
  }, [txt])
  const list = res ?? FIRST
  const pick = s => { onPlace(strip(s)); setPicked(s); setTxt(s.label); setOpen(false); setSi(-1) }
  const go = () => {
    if (picked && txt === picked.label) return onGo()
    const s = list[Math.max(0, si)]
    if (s && (res || si >= 0)) { pick(s); onGo() } else inp.current?.focus()
  }
  // 화살표: 화면에서 위·아래 칸으로 (빈칸 줄은 건너뜀)
  const move = dir => {
    const ds = list.map((_, j) => slot(j)), cur = si < 0 ? 0 : ds[si]
    const next = ds.filter(d => (dir > 0 ? d > cur : d < cur)).sort((a, b) => dir * (a - b))[0]
    if (next != null) setSi(ds.indexOf(next))
  }
  const show = open && list.length > 0
  const W = what.t
  return (
    <div className={'home where' + (show ? ' typing' : '')}>
      <Wheel k={whatIndex(what.cat)} n={what.n} zoom />
      <div className="sent">
        <button ref={lead} className="lead" onClick={onBack} aria-label="업종 다시 고르기">{pp(W, '을', '를')}</button>
        <label className={'addr' + (txt ? '' : ' blank')}>
          <span className="mir">{txt || '\u2003'.repeat(4)}</span>
          <input ref={inp} value={txt} aria-label="주소" autoComplete="off"
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={e => { setTxt(e.target.value); setOpen(true); if (picked && e.target.value !== picked.label) setPicked(null) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); si >= 0 && show ? pick(list[si]) : go() }
              if (e.key === 'ArrowDown') { move(1); e.preventDefault() }
              if (e.key === 'ArrowUp') { move(-1); e.preventDefault() }
              if (e.key === 'Escape') setOpen(false)
            }} />
          <ul className={'cands' + (show ? '' : ' gone')} aria-label="주소 후보" key={gen}>
            {list.map((s, j) => {
              const d = slot(j)
              return (
                <li key={s.label + j} className={si === j ? 'hi' : ''} style={{ '--d': d, '--a': Math.abs(d), '--q': j }}
                  onMouseDown={e => e.preventDefault()} onClick={() => pick(s)}>
                  <span>{s.label}</span>{s.sub && <small>{s.sub}</small>}
                </li>
              )
            })}
          </ul>
        </label>
        <span className="tail">에 차릴래요</span>
      </div>
      {!list.length && open && <p className="none">찾는 주소가 없어요</p>}
      <button className={'next' + (picked ? '' : ' wait')} onClick={go}>리포트 보기 &nbsp;→</button>
    </div>
  )
}
