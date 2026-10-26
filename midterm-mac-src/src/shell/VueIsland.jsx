import { useEffect, useRef } from 'react'
import { createApp, h, reactive } from 'vue'

// 98판에서 쓰던 Vue 게임 화면을 그대로 창 안에 띄운다. props 가 바뀌면 같은 앱에 흘려 넣는다
export default function VueIsland({ comp, props = {}, on = {} }) {
  const el = useRef(null)
  const state = useRef(null)

  useEffect(() => {
    const bag = reactive({ props, on })
    state.current = bag
    const app = createApp({
      render: () =>
        h(comp, {
          ...bag.props,
          ...Object.fromEntries(Object.entries(bag.on).map(([k, fn]) => [`on${k[0].toUpperCase()}${k.slice(1)}`, fn])),
        }),
    })
    app.mount(el.current)
    return () => app.unmount()
  }, [comp])

  useEffect(() => {
    if (!state.current) return
    state.current.props = props
    state.current.on = on
  })

  return <div ref={el} />
}
