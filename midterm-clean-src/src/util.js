import { ref, watch } from 'vue'

// 간판 바탕색. 글자색은 바탕마다 정해 둔다
export const SWATCHES = [
  { bg: 'var(--yellow)', fg: 'var(--ink)' },
  { bg: 'var(--blue)', fg: '#fff' },
  { bg: 'var(--red)', fg: '#fff' },
  { bg: 'var(--green)', fg: '#fff' },
  { bg: 'var(--pink)', fg: 'var(--ink)' },
  { bg: 'var(--ink)', fg: '#fff' },
  { bg: 'var(--lime)', fg: 'var(--ink)' },
]

// 같은 업종은 늘 같은 색이 되게 글자로 색을 고른다
export function swatchOf(key = '') {
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return SWATCHES[h % SWATCHES.length]
}

export const fmt = (n) => Number(n).toLocaleString('ko-KR')

const PROVINCE = {
  서울특별시: '서울',
  부산광역시: '부산',
  대구광역시: '대구',
  인천광역시: '인천',
  광주광역시: '광주',
  대전광역시: '대전',
  울산광역시: '울산',
  세종특별자치시: '세종',
  경기도: '경기',
  강원특별자치도: '강원',
  충청북도: '충북',
  충청남도: '충남',
  전북특별자치도: '전북',
  전라남도: '전남',
  경상북도: '경북',
  경상남도: '경남',
  제주특별자치도: '제주',
}

// '서울특별시 강남구' → '서울 강남구'
export function shortRegion(name = '') {
  const [head, ...rest] = name.split(' ')
  return [PROVINCE[head] || head, ...rest].join(' ')
}

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// 화면에 들어오면 in 을 붙인다 (한 번만)
let io
export const vReveal = {
  mounted(el, { value }) {
    if (value) el.style.transitionDelay = `${value}ms`
    if (still() || !('IntersectionObserver' in window)) return el.classList.add('in')
    io ||= new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          e.target.classList.add('in')
          io.unobserve(e.target)
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
  },
  unmounted(el) {
    io?.unobserve(el)
  },
}

// 숫자가 목표값까지 올라간다. start 가 true 가 되는 순간부터
export function useCount(target, start = ref(true), ms = 1200) {
  const shown = ref(0)
  let raf
  const run = () => {
    cancelAnimationFrame(raf)
    const to = Number(target.value) || 0
    if (still()) return (shown.value = to)
    const from = shown.value
    const t0 = performance.now()
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / ms)
      shown.value = Math.round(from + (to - from) * (1 - (1 - p) ** 4))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
  }
  watch([target, start], () => start.value && run(), { immediate: true })
  return shown
}

// 요소가 화면에 들어왔는지
export function useSeen(elRef) {
  const seen = ref(false)
  watch(
    elRef,
    (el) => {
      if (!el) return
      if (still() || !('IntersectionObserver' in window)) return (seen.value = true)
      const o = new IntersectionObserver(([e]) => {
        if (e.isIntersecting) {
          seen.value = true
          o.disconnect()
        }
      }, { threshold: 0.3 })
      o.observe(el)
    },
    { immediate: true },
  )
  return seen
}

// 받침에 맞춰 조사를 고른다: josa('김밥', '이', '가') → '이'
export function josa(word = '', withEnd, without) {
  const c = word.charCodeAt(word.length - 1)
  if (c < 0xac00 || c > 0xd7a3) return withEnd
  return (c - 0xac00) % 28 ? withEnd : without
}
