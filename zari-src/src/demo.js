// 리포트 숫자. 서울 열린데이터광장 상권분석서비스에서 뽑은 값(seoul.json, scripts/build_seoul.py)으로 덮어쓰고,
// 실제 자료를 못 불러올 때만 아래 기본값을 쓴다. 비용 기본값은 서울시 상가임대차 실태조사(2023) 서울 평균.
import S from './seoul.json'

export const SEOUL = S
const EX = {
  asOf: { sales: '2026년 2분기', shops: '2026년 9월', rent: '2026년 상반기' },
  // 비용: 서울시 상가임대차 실태조사(2023) 서울 평균. 월세 ㎡당 6.24만, 점포당 보증금 5,365만·권리금 6,438만·시설투자비 5,229만(평균 60.2㎡), 공용관리비 ㎡당 0.29만
  cost: {
    rent: 6.24, rentSeoul: 6.24, premium: 6438, size: 33,
    depM2: 89.1, facM2: 86.9, feeM2: 0.29, keyArea: null,
  },
}

// 보증금은 33㎡ 기준(100만 원 단위)
function costOf(rt) {
  const c = rt ? { ...EX.cost, rent: rt.rent, rentSeoul: rt.seoul.rent, premium: rt.key, depM2: rt.depM2, facM2: rt.facM2, feeM2: rt.feeM2,
    keyArea: rt.keyArea, trend: rt.trend, real: true } : { ...EX.cost }
  return { ...c, deposit: Math.round(c.depM2 * c.size / 100) * 100 }
}

// 서울시 숫자(S: seoul.json 또는 seoulCalc.seoulReport 결과)를 화면이 읽는 모양으로 묶는다
// 매출 자료가 없는 업종(S.missing)은 매출·지수 칸을 비워 두고(sales.none) 화면에서 숨긴다
export function mergeDemo(S, name) {
  const miss = !!S.missing
  return {
    home: S.home ?? { gu: '노원구' }, cat: S.cat ?? { label: '카페' },
    area: S.area, insight: S.insight, recommend: S.recommend, trend: S.trend, place: S.place,
    grade: { ...S.grade, g: S.grade.g ?? '—' },
    score: miss ? null : S.score ?? null,
    asOf: { ...EX.asOf, ...S.asOf, ...(S.real?.rent ? { rent: S.real.rent.asOf } : {}) },
    real: S.real ?? {},
    // 임대료는 가장 가까운 부동산원 조사 상권, 권리금·보증금·시설투자비·관리비는 가까운 실태조사 상권(없으면 서울 평균)
    cost: costOf(S.real?.rent),
    sales: miss ? { none: true, month: null, seoul: null, stores: 0, vac: 0 } : S.sales,
    flow: S.flow,
    people: S.people,
    change: S.change,
    // 공릉로 232는 실제 후보 2곳과 비교, 다른 자리는 그 자리 한 줄
    compare: (S.compare.length > 1 ? S.compare : [{ ...S.compare[0], name: name || S.compare[0].name, sub: S.area?.home || '' }])
      .map((c, k) => ({ ...c, ...(S.real?.cmp?.[k] ?? {}) })),   // 실제 임대료·3년 생존율(없는 업종은 null → —)
  }
}
// 화면들이 같이 읽는 지금 리포트 숫자. setDemo로 통째로 바꾼다
export const DEMO = mergeDemo(S)
export const setDemo = (S2, name) => { for (const k of Object.keys(DEMO)) delete DEMO[k]; Object.assign(DEMO, mergeDemo(S2, name)) }
export const BASE_SEOUL = S

// 프랜차이즈 브랜드 (이름 앞부분으로 찾음)
export const BRANDS = ['스타벅스', '투썸', '이디야', '메가엠지씨', '컴포즈', '빽다방', '공차', '더벤티', '설빙', '쥬씨', '커피마마', '떼루와']
export const BRAND_NAME = { 메가엠지씨: '메가커피', 투썸: '투썸플레이스' }
