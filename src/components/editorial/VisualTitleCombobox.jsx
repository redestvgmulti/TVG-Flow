import { useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import {
  filterVisualTitleGroups,
  flattenVisualTitleGroups,
  moveComboboxActiveIndex,
} from '../../services/visualTitleCatalog'

function Preview({ title, size = 28 }) {
  const [failed, setFailed] = useState(false)
  if (!title?.preview_url || failed) {
    return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: 6, background: '#e2e8f0', display: 'inline-block', flexShrink: 0 }} />
  }
  return <img src={title.preview_url} alt="" onError={() => setFailed(true)} style={{ width: size, height: size, objectFit: 'contain', borderRadius: 6, background: '#f8fafc', flexShrink: 0 }} />
}

export default function VisualTitleCombobox({ groups = [], value, onChange, contentType, loading, error, onRetry, fieldError }) {
  const generatedId = useId().replace(/:/g, '')
  const listId = `visual-title-options-${generatedId}`
  const triggerRef = useRef(null)
  const inputRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const filteredGroups = useMemo(() => filterVisualTitleGroups(groups, contentType, query), [groups, contentType, query])
  const options = useMemo(() => flattenVisualTitleGroups(filteredGroups), [filteredGroups])
  const optionIndexById = useMemo(() => new Map(options.map((option, index) => [option.id, index])), [options])
  const selected = useMemo(() => flattenVisualTitleGroups(groups).find(title => title.id === value) || null, [groups, value])


  function openMenu() {
    setOpen(true)
    setActiveIndex(options.length ? 0 : -1)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function close({ restoreFocus = true } = {}) {
    setOpen(false)
    setQuery('')
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }

  function toggleMenu() {
    if (open) close({ restoreFocus: false })
    else openMenu()
  }

  function choose(title) {
    onChange(title ? title.id : null)
    close()
  }

  function onTriggerKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openMenu()
    }
    if (event.key === 'Escape') close()
  }

  function onSearchKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex(index => moveComboboxActiveIndex(index, 'next', options.length))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(index => moveComboboxActiveIndex(index, 'previous', options.length))
    }
    if (event.key === 'Enter' && effectiveActiveIndex >= 0) {
      event.preventDefault()
      choose(options[effectiveActiveIndex])
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  const noCatalog = !loading && !error && !groups.length
  const emptyForFormat = !loading && !error && groups.length > 0 && !options.length && !query
  const noResults = !loading && !error && Boolean(query) && !options.length
  const effectiveActiveIndex = activeIndex >= options.length ? (options.length ? 0 : -1) : activeIndex
  const activeOptionId = effectiveActiveIndex >= 0 ? `${listId}-option-${effectiveActiveIndex}` : undefined

  return <div style={{ position: 'relative', display: 'grid', gap: 8 }}>
    <label id={`${listId}-label`} style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>Selo da matéria <span style={{ color: '#64748b', fontWeight: 400 }}>(opcional)</span></label>
    <button
      ref={triggerRef}
      type="button"
      role="combobox"
      aria-labelledby={`${listId}-label`}
      aria-controls={listId}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-activedescendant={open ? activeOptionId : undefined}
      aria-invalid={Boolean(fieldError)}
      aria-describedby={fieldError || error ? `${listId}-status` : undefined}
      onClick={toggleMenu}
      onKeyDown={onTriggerKeyDown}
      disabled={loading}
      style={{ width: '100%', minHeight: 48, padding: '10px 14px', borderRadius: 12, border: fieldError ? '1px solid #ef4444' : '1px solid #cbd5e1', background: '#fff', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', cursor: loading ? 'wait' : 'pointer' }}
    >
      {selected ? <><Preview title={selected} /><span style={{ flex: 1 }}>{selected.nome}</span></> : <span style={{ flex: 1, color: '#64748b' }}>{loading ? 'Carregando selos...' : 'Selecione um selo'}</span>}
      <ChevronDown size={18} aria-hidden="true" />
    </button>
    {fieldError && <span id={`${listId}-status`} role="alert" style={{ color: '#ef4444', fontSize: 12, fontWeight: 600 }}>{fieldError}</span>}
    {!fieldError && error && <span id={`${listId}-status`} role="alert" style={{ color: '#b45309', fontSize: 12 }}>Não foi possível carregar os selos da matéria.</span>}
    {open && <div id={listId} role="listbox" aria-labelledby={`${listId}-label`} style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, maxHeight: 320, overflowY: 'auto', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 12, boxShadow: '0 12px 28px rgba(15,23,42,.16)', padding: 8 }}>
      <div style={{ position: 'sticky', top: -8, padding: '4px 0 8px', background: '#fff', zIndex: 1 }}><label style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }} htmlFor={`${listId}-search`}>Buscar por selo ou grupo</label><div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #cbd5e1', borderRadius: 8, padding: '0 8px' }}><Search size={16} aria-hidden="true" /><input ref={inputRef} id={`${listId}-search`} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onSearchKeyDown} aria-activedescendant={activeOptionId} placeholder="Buscar por selo ou grupo" style={{ width: '100%', border: 0, outline: 0, padding: 10 }} /></div></div>
      <button type="button" role="option" aria-selected={!value} onClick={() => choose(null)} style={{ width: '100%', padding: '10px 8px', border: 0, borderRadius: 8, background: !value ? '#eff6ff' : 'transparent', textAlign: 'left', cursor: 'pointer' }}>Sem selo da matéria</button>
      {filteredGroups.map(group => <div key={group.id}><div role="presentation" style={{ padding: '12px 8px 5px', color: '#475569', fontSize: 12, fontWeight: 700 }}>{group.nome}</div>{group.titles.map(title => { const index = optionIndexById.get(title.id); const active = index === effectiveActiveIndex; return <button key={title.id} id={`${listId}-option-${index}`} type="button" role="option" aria-selected={value === title.id} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(title)} style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'center', padding: '9px 8px', border: 0, borderRadius: 8, background: active || value === title.id ? '#eff6ff' : 'transparent', textAlign: 'left', cursor: 'pointer' }}><Preview title={title} /><span style={{ flex: 1, minWidth: 0 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title.nome}</strong><small style={{ color: '#64748b' }}>{group.nome}</small></span>{value === title.id && <Check size={16} aria-hidden="true" />}</button> })}</div>)}
      {noCatalog && <div style={{ padding: 16 }}><strong>Você ainda não possui grupos de selos.</strong><p style={{ margin: '6px 0 0', color: '#64748b' }}>Cadastre os selos nas configurações antes de criar a matéria.</p></div>}
      {emptyForFormat && <div style={{ padding: 16, color: '#64748b' }}>Não há selos disponíveis para {contentType === 'feed' ? 'Feed' : 'Reels'}.</div>}
      {noResults && <div style={{ padding: 16 }}><strong>Nenhum selo encontrado.</strong><p style={{ margin: '6px 0 0', color: '#64748b' }}>Tente buscar por outro nome ou grupo.</p></div>}
      {error && <div style={{ padding: 16 }}><strong>Não foi possível carregar os selos da matéria.</strong><button type="button" className="ap-btn-outline" onClick={onRetry} style={{ marginTop: 8, display: 'block' }}>Tentar novamente</button></div>}
    </div>}
  </div>
}
