import { useCallback, useEffect, useState } from 'react'
import { CheckSquare, Clock, RefreshCcw, SendHorizonal } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { listMyEditorialArticles } from '../../services/editorialArticlesService'
import { operationalStageForEditorialStatus } from '../../services/editorialOperationalStage'
import CanonicalEditorialEditor from './CanonicalEditorialEditor'
import Modal from '../ui/Modal'

const DISPATCHED_LIMIT = 20

function formatDate(value) {
    if (!value) return '—'
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(new Date(value))
}

// Admin-only, additive view over ap.editorial_articles (2B.2.3 section 12-13).
// Deliberately not merged into AutoPublisher's candidate_news tabs/queries --
// this is a structurally separate domain, and this list has to stay visible
// even for tenants that later turn the creation flag back off (section 27),
// so it cannot be gated by the current flag state either.
export default function EditorialReviewPanel({ clienteId }) {
    const { user } = useAuth()
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(true)
    const [openArticleId, setOpenArticleId] = useState(null)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const data = await listMyEditorialArticles(supabase)
            setItems(data)
        } catch {
            toast.error('Não foi possível carregar a revisão editorial.')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        const timer = window.setTimeout(() => { void load() }, 0)
        return () => window.clearTimeout(timer)
    }, [load, clienteId])

    const awaitingReview = items.filter(item => item.status === 'content_final')
    const awaitingRender = items.filter(item => item.status === 'ready_for_render')
    const recentlyDispatched = items
        .filter(item => item.status === 'dispatched')
        .slice(0, DISPATCHED_LIMIT)

    return (
        <section className="ap-page" aria-label="Revisão editorial">
            <div className="ap-header">
                <div className="ap-header-left">
                    <h1>Revisão editorial</h1>
                    <p>Matérias criadas pelo editor editorial canônico, aguardando revisão, render ou já enviadas.</p>
                </div>
                <button type="button" className="ap-btn-refresh" onClick={load} disabled={loading}>
                    <RefreshCcw size={14} className={loading ? 'ap-spin-icon' : ''} /> Atualizar
                </button>
            </div>

            {loading ? (
                <div className="ap-backlog-loading">Carregando matérias…</div>
            ) : items.length === 0 ? (
                <div className="ap-backlog-empty">
                    <div className="ap-backlog-empty-icon"><CheckSquare size={22} /></div>
                    <p className="title">Nenhuma matéria do editor editorial ainda.</p>
                    <p className="hint">Quando alguém enviar uma matéria para revisão, ela aparecerá aqui.</p>
                </div>
            ) : (
                <div className="ap-my-work-sections">
                    <ReviewSection
                        title="Aguardando revisão"
                        hint="Enviadas pelo autor, aguardando aprovação ou devolução."
                        icon={SendHorizonal}
                        items={awaitingReview}
                        onOpen={setOpenArticleId}
                    />
                    <ReviewSection
                        title="Aguardando render"
                        hint="Aprovadas, mas ainda não confirmadas como enviadas para renderização."
                        icon={Clock}
                        items={awaitingRender}
                        onOpen={setOpenArticleId}
                    />
                    <ReviewSection
                        title="Recentes"
                        hint={`Últimas ${DISPATCHED_LIMIT} já enviadas para renderização.`}
                        icon={CheckSquare}
                        items={recentlyDispatched}
                        onOpen={setOpenArticleId}
                    />
                </div>
            )}

            <Modal isOpen={Boolean(openArticleId)} onClose={() => { setOpenArticleId(null); void load() }} title="Revisão editorial" size="lg">
                {openArticleId && (
                    <CanonicalEditorialEditor
                        articleId={openArticleId}
                        currentUser={user}
                        permissions={{ canReview: true }}
                    />
                )}
            </Modal>
        </section>
    )
}

function ReviewSection({ title, hint, icon, items, onOpen }) {
    const Icon = icon
    return (
        <section aria-label={title}>
            <h2 className="ap-my-work-section-title">{title} <span className="ap-backlog-tab-count">{items.length}</span></h2>
            <p className="ap-my-work-section-hint">{hint}</p>
            {items.length === 0 ? (
                <div className="ap-my-work-section-empty">
                    <div className="ap-my-work-section-empty-icon"><Icon size={18} /></div>
                    <div><strong>Nada por aqui.</strong></div>
                </div>
            ) : (
                <div className="ap-my-work-grid">
                    {items.map(item => (
                        <article key={item.article_id || item.id} className="ap-my-work-card">
                            <div className={`ap-my-work-status is-${item.status}`}>{operationalStageForEditorialStatus(item.status).label}</div>
                            <h2>{item.headline || 'Matéria sem título'}</h2>
                            <p className="ap-my-work-domain">{item.responsible_name || 'Sem responsável'}</p>
                            <dl>
                                <div><dt>Atualizado em</dt><dd>{formatDate(item.updated_at)}</dd></div>
                            </dl>
                            <div className="ap-my-work-actions">
                                <button type="button" className="ap-backlog-action-solid" onClick={() => onOpen(item.article_id || item.id)}>
                                    Abrir
                                </button>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </section>
    )
}
