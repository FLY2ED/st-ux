import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { APPS } from '../apps.js'
import { nameCount, search } from '../data.js'

const fmt = (n) => n.toLocaleString('ko-KR')

// 앱 이름과 실제 간판 색인을 한 번에 찾는다. 결과를 고르면 해당 창이 열린다
export default function Spotlight({ onClose, onOpen }) {
  const [q, setQ] = useState('')
  const [hit, setHit] = useState(null)
  const [sel, setSel] = useState(0)
  const input = useRef(null)

  useEffect(() => input.current?.focus(), [])

  useEffect(() => {
    const word = q.trim()
    if (!/[가-힣]{2}/.test(word)) return setHit(null)
    let alive = true
    const t = setTimeout(async () => {
      const [found, same] = await Promise.all([search(word).catch(() => null), nameCount(word).catch(() => null)])
      if (alive) setHit({ word, found, same })
    }, 160)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q])

  const rows = useMemo(() => {
    const word = q.trim().toLowerCase()
    if (!word) return []
    const apps = APPS.filter((a) => a.kind !== 'hidden' && `${a.title} ${a.keys}`.toLowerCase().includes(word)).map((a) => ({
      kind: 'app',
      key: a.id,
      img: a.img,
      title: a.title,
      sub: '응용 프로그램',
      run: () => onOpen(a.id),
    }))
    const out = [...apps]
    const h = hit && hit.word === q.trim() ? hit : null
    if (h?.found) {
      out.push({
        kind: 'stat',
        key: 'count',
        title: `‘${h.word}’ 들어간 간판`,
        sub: `전국 ${h.found.exactCount ? '' : '최대 '}${fmt(h.found.count)}곳 · 간판 문서 열기`,
        run: () => onOpen('web', { q: h.word, at: Date.now() }),
      })
      if (h.same > 1) out.push({ kind: 'stat', key: 'same', title: `똑같은 이름 ‘${h.word}’`, sub: `전국 ${fmt(h.same)}곳`, run: () => onOpen('building') })
      const sample = [...h.found.rows].sort((a, b) => b.exact - a.exact).filter((r) => r.exact).slice(0, 5)
      for (const r of sample)
        out.push({ kind: 'sign', key: `${r.name}${r.region}${r.floor}`, title: r.name, sub: `${r.cat} · ${r.region}`, run: () => onOpen('building') })
    }
    return out
  }, [q, hit, onOpen])

  useEffect(() => setSel(0), [q])

  const key = (e) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(rows.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter' && rows[sel]) {
      rows[sel].run()
      onClose()
    }
  }

  let last = null
  return (
    <div className="spot-scrim" onPointerDown={onClose}>
      <motion.div
        className="spot glass"
        role="dialog"
        aria-label="Spotlight 검색"
        onPointerDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 36 }}
      >
        <label className="spot-field">
          <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">
            <circle cx="6.8" cy="6.8" r="4.8" stroke="currentColor" strokeWidth="1.6" fill="none" />
            <path d="M10.4 10.4L14.5 14.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={key}
            placeholder="Spotlight 검색 — 앱 이름이나 간판 이름"
            aria-label="검색어"
            spellCheck={false}
          />
        </label>
        {rows.length > 0 && (
          <ul className="spot-list" role="listbox">
            {rows.map((r, i) => {
              const head = r.kind === 'app' ? '응용 프로그램' : r.kind === 'stat' ? '간판 도감' : '실제 간판'
              const showHead = head !== last
              last = head
              return [
                showHead && (
                  <li key={`h-${head}`} className="spot-head">
                    {head}
                  </li>
                ),
                <li key={r.key} role="option" aria-selected={i === sel}>
                  <button className={`spot-row ${i === sel ? 'sel' : ''}`} onPointerEnter={() => setSel(i)} onClick={() => (r.run(), onClose())}>
                    {r.img ? <img src={r.img} alt="" /> : <span className={`spot-glyph ${r.kind}`}>{r.kind === 'stat' ? '#' : '간'}</span>}
                    <span className="spot-title">{r.title}</span>
                    <span className="spot-sub">{r.sub}</span>
                  </button>
                </li>,
              ]
            })}
          </ul>
        )}
        {q.trim() && /[가-힣]{2}/.test(q) && !hit && <p className="spot-wait">간판 277만 곳에서 찾는 중…</p>}
      </motion.div>
    </div>
  )
}
