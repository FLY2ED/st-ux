import { useEffect, useState } from 'react'
import { PRESETS, strip, useZari } from './data.js'
import { What, Where } from './Home.jsx'
import Go from './Go.jsx'
import Read from './Read.jsx'
import More from './More.jsx'

// 화면은 1440×900 판 하나를 창 크기에 맞춰 줄이고 늘린다 (--k)
function useScale() {
  useEffect(() => {
    const on = () => {
      const s = document.documentElement.style
      s.setProperty('--k', Math.min(innerWidth / 1440, innerHeight / 900))
      s.setProperty('--mk', Math.min(1, (innerWidth - 40) / 740))
    }
    on()
    addEventListener('resize', on)
    return () => removeEventListener('resize', on)
  }, [])
}

// 화면 흐름: 업종(what) → 자리(where) → 넘어가는 띠(go) → 문장+원 지도(read) → 자세히(more)
export default function V2() {
  useScale()
  const [step, setStep] = useState('what')
  const [what, setWhat] = useState({ t: '카페', cat: '카페' })
  const [place, setPlace] = useState(() => strip(PRESETS[0]))
  const [budget] = useState({ start: 10000, month: 300 })
  const Z = useZari(place, what.cat)
  // 띠의 점은 리포트 지도가 다 그려질 때까지 원 위에 남아 있다가 지도와 바뀐다 (늦어도 4초)
  const [tail, setTail] = useState(0)
  // 데이터가 오면 리포트 지도를 띠 뒤에서 미리 그린다. 건물 층까지 다 그려지면(drawn) 점이 원으로 모인다 (늦어도 데이터 뒤 8초)
  const [drawn, setDrawn] = useState(false)
  useEffect(() => { if (step === 'where') { setDrawn(false); window.__map = null } }, [step])
  useEffect(() => {
    if (step !== 'go' || !Z.ready || drawn) return
    let live = true, id
    const fin = () => live && setDrawn(true)
    const cap = setTimeout(fin, 8000)
    const wait = () => {
      const m = window.__map
      if (m && m.getSource('ob')) { m.once('idle', fin); m.triggerRepaint() }
      else id = setTimeout(wait, 80)
    }
    wait()
    return () => { live = false; clearTimeout(id); clearTimeout(cap) }
  }, [step, Z.ready, drawn])
  const toRead = () => {
    setStep('read'); setTail(1)
    const t0 = performance.now()
    let done = false
    const fin = () => { if (done) return; done = true; setTail(2); setTimeout(() => setTail(0), 1600) }
    setTimeout(fin, 4500)
    const wait = () => {
      const m = window.__map
      // 건물 층(ob)이 붙은 뒤 한 번 더 다 그려지면(idle) 바꾼다
      if (m && m.getSource('ob')) { m.once('idle', () => setTimeout(fin, 120)); m.triggerRepaint() }
      else setTimeout(wait, 100)
    }
    setTimeout(wait, 60)
  }
  useEffect(() => { document.documentElement.dataset.step = step }, [step])
  const ctx = { ...Z, what, place, budget }
  return (
    <div className={'v2 s-' + step}>
      <div className="stage">
        {(step === 'what' || step === 'where') && <button className="brand" onClick={() => setStep('what')}>ZARI</button>}
        {step === 'what' && <What what={what} onPick={w => { setWhat(w); setStep('where') }} />}
        {step === 'where' && <Where what={what} onPlace={setPlace} onGo={() => setStep('go')} onBack={() => setStep('what')} />}
        {(step === 'go' || (tail > 0 && step === 'read')) && <Go {...ctx} drawn={drawn} out={tail === 2} onDone={toRead} />}
        {(step === 'go' || step === 'read' || step === 'more') && Z.ready && <Read {...ctx} hidden={step !== 'read'} veil={tail === 1} onMore={() => setStep('more')} onBack={() => setStep('where')} />}
      </div>
      {step === 'more' && Z.ready && <More {...ctx} onBack={() => setStep('read')} />}
    </div>
  )
}
