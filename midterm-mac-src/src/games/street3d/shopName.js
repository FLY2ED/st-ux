// 내 가게 이름: 간판 이름 25만 개로만 배운 작은 언어 모델이 지어 준다(브라우저 안에서 계산)
const CAT_WORDS = [
  [/분식|떡볶이|김밥|튀김/, '분식'], [/빵|베이커리|제과/, '빵집'], [/카페|커피|디저트|케이크/, '카페'], [/치킨|닭/, '치킨'], [/세탁|빨래/, '세탁소'],
  [/미용|헤어|네일|뷰티/, '미용실'], [/약국/, '약국'], [/학원|교습|공부/, '학원'], [/노래/, '노래방'], [/꽃/, '꽃집'],
  [/마트|슈퍼|상회|상사|편의/, '슈퍼'], [/식당|밥|국|찌개|고기|갈비|면|반점|횟집|집$/, '식당'], [/술|포차|주점|호프/, '주점'],
]
export const catOf = (name) => CAT_WORDS.find(([re]) => re.test(name))?.[1] || '가게'

// 이름 후보 셋. 모델을 못 불러왔으면 내 이름으로 짓는다
export function pickNames(lm, me) {
  const who = me.replace(/\s+/g, '').slice(0, 6)
  if (!lm) return [`${who}네 가게`, `${who} 상회`, `${who}네 분식`]
  const out = new Set()
  for (let n = 0; n < 9 && out.size < 3; n++) {
    const name = (out.size === 0 ? lm.sample(`${who}네`, 0.8) : lm.sample('', 0.9)).trim()
    const len = [...name].length
    if (len >= 2 && len <= 12 && name !== `${who}네`) out.add(name)
  }
  if (!out.size) out.add(`${who}네 가게`)
  return [...out]
}
