import { Children, Fragment, cloneElement, isValidElement } from 'react'

// 글을 낱말 단위로 쪼개 --w(순서)를 단다. CSS가 흐릿한 낱말을 차례로 또렷하게 띄운다 (줄바꿈은 그대로)
// out을 주면 out.n에 낱말 수를 적는다
export function words(children, out) {
  let n = 0
  const walk = c => Children.map(c, ch => {
    if (typeof ch === 'string' || typeof ch === 'number') {
      return String(ch).split(/(\s+)/).map((w, i) => (!w || /^\s+$/.test(w) ? w : <span key={i} className="wd" style={{ '--w': n++ }}>{w}</span>))
    }
    if (isValidElement(ch)) return ch.type === Fragment ? walk(ch.props.children) : cloneElement(ch, {}, walk(ch.props.children))
    return ch
  })
  const r = walk(children)
  if (out) out.n = n
  return r
}
