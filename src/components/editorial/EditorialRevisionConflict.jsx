import { useEffect, useRef } from 'react'
import { canKeepLocalEditorialText } from '../../services/editorialRevisionConflict'
import '../../styles/EditorialRevisionConflict.css'

const FIELDS = [
  ['Manchete', 'titulo', 'headline'],
  ['Texto', 'conteudo', 'body'],
  ['Legenda', 'caption', 'caption'],
  ['TAG', 'context_tag', 'context_tag'],
  ['Categoria', 'category', 'category'],
  ['Localização', 'location', 'location'],
]

function display(value) {
  if (!value) return 'Não informado'
  if (typeof value === 'object') return Object.values(value).filter(Boolean).join(', ') || 'Não informado'
  return value
}

export default function EditorialRevisionConflict({ localForm, article, loading, error, onRefresh, onResolve }) {
  const panelRef = useRef(null)
  useEffect(() => { panelRef.current?.focus() }, [])

  return (
    <section className="ap-revision-conflict" ref={panelRef} tabIndex={-1} aria-label="Conflito de edição">
      <h3>Esta matéria foi atualizada em outra sessão</h3>
      <p role="alert">Seu texto foi preservado. Confira a versão salva antes de continuar.</p>
      {loading && <p role="status">Carregando a versão salva…</p>}
      {error && <p role="alert">{error}</p>}
      {article && (
        <>
          <div className="ap-revision-conflict-grid">
            <div><h4>Seu texto nesta tela</h4></div>
            <div><h4>Texto salvo · revisão {article.revision_number}</h4></div>
            {FIELDS.map(([label, localKey, remoteKey]) => (
              <div className="ap-revision-conflict-field" key={localKey}>
                <strong>{label}</strong>
                <div className="ap-revision-conflict-values">
                  <p aria-label={`${label}: seu texto`}>{display(localForm[localKey])}</p>
                  <p aria-label={`${label}: texto salvo`}>{display(article[remoteKey])}</p>
                </div>
              </div>
            ))}
          </div>
          {!canKeepLocalEditorialText(article) && <p>Esta matéria já avançou no fluxo. Use o texto salvo para conferir seu estado atual.</p>}
          <p>“Usar texto salvo” substitui os campos editoriais nesta tela. “Continuar com meu texto” mantém sua edição para você revisar e salvar novamente. Nenhuma opção salva automaticamente.</p>
        </>
      )}
      <div className="ap-revision-conflict-actions">
        <button type="button" className="ap-wizard-back-btn" onClick={onRefresh} disabled={loading}>Atualizar comparação</button>
        {article && <button type="button" className="ap-wizard-back-btn" onClick={() => onResolve('remote')} disabled={loading}>Usar texto salvo</button>}
        {canKeepLocalEditorialText(article) && <button type="button" className="ap-af-submit" onClick={() => onResolve('local')} disabled={loading}>Continuar com meu texto</button>}
      </div>
    </section>
  )
}
