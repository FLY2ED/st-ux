import { onBeforeUnmount, ref, watch } from 'vue'

// 점수가 바뀌면 0 부터 계단식으로 또각또각 올라간다(게임 결과 화면용)
// get: 목표 숫자를 돌려주는 함수, steps: 몇 번에 나눠 올릴지, tick: 한 칸마다 부를 소리
export function useCountUp(get, { ms = 700, steps = 14, tick } = {}) {
  const shown = ref(0)
  let timer = 0
  const stop = () => clearInterval(timer)
  watch(
    get,
    (to) => {
      stop()
      to = Number(to) || 0
      if (!to || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        shown.value = to
        return
      }
      let k = 0
      shown.value = 0
      timer = setInterval(() => {
        k++
        shown.value = k >= steps ? to : Math.round((to * k) / steps)
        tick?.()
        if (k >= steps) stop()
      }, ms / steps)
    },
    { immediate: true },
  )
  onBeforeUnmount(stop)
  return shown
}
