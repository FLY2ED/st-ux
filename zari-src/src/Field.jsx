import { useEffect, useRef, useState } from 'react'

// 홈 문장 속 [ 입력칸 ]: 치는 동안 아래에 후보가 뜬다. ↑↓로 고르고 Enter, 눌러서 고른다
// find(q) → Promise<[{ label, sub, ... }]> · onPick(item)
export default function Field({ value, find, onPick, placeholder, label, empty, width }) {
  const [q, setQ] = useState(value)
  const [list, setList] = useState([])
  const [at, setAt] = useState(0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const inp = useRef(null), seq = useRef(0)
  useEffect(() => { if (!open) setQ(value) }, [value, open])

  useEffect(() => {
    if (!open) return
    const id = ++seq.current
    const t = setTimeout(async () => {
      setBusy(true)
      const r = await find(q === value ? '' : q)
      if (id !== seq.current) return
      setList(r); setAt(0); setBusy(false)
    }, q && q !== value ? 220 : 0)
    return () => clearTimeout(t)
  }, [q, open])

  const pick = it => { if (!it) return; onPick(it); setOpen(false); setQ(it.label); inp.current?.blur() }
  const key = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt(a => Math.min(list.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(a => Math.max(0, a - 1)) }
    else if (e.key === 'Enter' && open && list.length && q !== value) { e.preventDefault(); pick(list[at]) }
    else if (e.key === 'Escape') { setOpen(false); setQ(value); inp.current?.blur() }
  }
  return (
    <span className={'chip fld' + (open ? ' on' : '')}>
      <span className="wb">[</span>
      <span className="grow" data-v={q || placeholder} style={width ? { minWidth: width } : null}>
        <input ref={inp} size={1} value={q} placeholder={placeholder} aria-label={label} role="combobox" aria-expanded={open} aria-autocomplete="list"
          onFocus={e => { setOpen(true); e.target.select() }} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={e => setQ(e.target.value)} onKeyDown={key} enterKeyHint="search" autoComplete="off" spellCheck={false} />
      </span>
      <span className="wb">]</span>
      {open && (
        <ul className="sug" role="listbox" aria-label={label} onPointerDown={e => e.preventDefault()}>
          <li className="sug-k m">{label}</li>
          {list.map((it, k) => (
            <li key={it.label + it.sub + k} role="option" aria-selected={k === at} className={k === at ? 'on' : ''} onMouseEnter={() => setAt(k)} onClick={() => pick(it)}>
              <b>{it.label}</b>{it.sub && <small>{it.sub}</small>}
            </li>
          ))}
          {!list.length && <li className="sug-none">{busy ? '찾는 중…' : q && q !== value ? '찾는 결과가 없어요' : empty}</li>}
        </ul>
      )}
    </span>
  )
}
