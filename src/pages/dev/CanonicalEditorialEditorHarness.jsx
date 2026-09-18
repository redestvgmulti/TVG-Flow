import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import CanonicalEditorialEditor from '../../components/editorial/CanonicalEditorialEditor'

// Development-only harness for the 2B.2.2 canonical editor (see
// docs/qa/2b2-2-canonical-editor-checklist.md). Not wired into any real
// screen -- MyNewsWork/AutoPublisher wiring is 2B.2.3. Only reachable behind
// import.meta.env.DEV in App.jsx, so Vite drops this route (and this file's
// import) from the production bundle entirely.
export default function CanonicalEditorialEditorHarness() {
  const { user, role } = useAuth()
  const [articleIdInput, setArticleIdInput] = useState('')
  const [activeArticleId, setActiveArticleId] = useState(null)
  const [canReview, setCanReview] = useState(role === 'admin' || role === 'super_admin')
  const [lastArticle, setLastArticle] = useState(null)

  return (
    <div className="ap-page" style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1>Harness — Editor editorial canônico (2B.2.2)</h1>
      <p style={{ color: '#64748b' }}>
        Rota de desenvolvimento apenas. Simula abrir um artigo existente pelo
        id, ou criar um novo, alternando entre modo Admin (revisão) e Staff.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
          article_id existente (vazio = criar novo)
          <input
            className="ap-af-input"
            value={articleIdInput}
            onChange={event => setArticleIdInput(event.target.value)}
            placeholder="uuid do editorial_articles"
            style={{ minWidth: 320 }}
          />
        </label>
        <button type="button" className="ap-af-submit" onClick={() => setActiveArticleId(articleIdInput.trim() || null)}>
          Abrir
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={canReview} onChange={event => setCanReview(event.target.checked)} />
          Simular admin (canReview)
        </label>
      </div>

      <CanonicalEditorialEditor
        key={activeArticleId || 'new'}
        articleId={activeArticleId}
        currentUser={user}
        permissions={{ canReview }}
        onArticleChange={setLastArticle}
      />

      {lastArticle && (
        <details style={{ marginTop: 24 }}>
          <summary>Último artigo (debug)</summary>
          <pre style={{ fontSize: 11, background: '#f8fafc', padding: 12, borderRadius: 8, overflowX: 'auto' }}>
            {JSON.stringify(lastArticle, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}
