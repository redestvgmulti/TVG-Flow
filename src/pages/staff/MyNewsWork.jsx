import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, FileText, Loader2, RefreshCcw, Undo2, Zap } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { supabase } from '../../services/supabase'
import { resolveOperationalClienteId } from '../../services/visualTitleGroups'
import '../../styles/AutoPublisher.css'

const STATUS_LABELS = {
    adopted: 'Para produzir',
    in_production: 'Produzindo',
    completed: 'Concluída',
}

function formatDate(value) {
    if (!value) return '—'
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        dateStyle: 'short',
        timeStyle: 'short',
    }).format(new Date(value))
}

function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, '') }
    catch { return 'Fonte externa' }
}

export default function MyNewsWork() {
    const [, setSearchParams] = useSearchParams()
    const [clienteId, setClienteId] = useState(null)
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(true)
    const [releasingId, setReleasingId] = useState(null)
    const [workTab, setWorkTab] = useState('pautas')

    useEffect(() => {
        let active = true
        resolveOperationalClienteId(supabase)
            .then(id => { if (active) setClienteId(id) })
            .catch(() => { if (active) toast.error('Não foi possível identificar o cliente operacional.') })
        return () => { active = false }
    }, [])

    const load = useCallback(async () => {
        if (!clienteId) return
        setLoading(true)
        const { data, error } = await supabase.schema('ap').rpc('list_my_news_work', {
            p_cliente_id: clienteId,
        })
        if (error) toast.error('Não foi possível carregar suas matérias.')
        else setItems(data ?? [])
        setLoading(false)
    }, [clienteId])

    useEffect(() => {
        const timer = window.setTimeout(() => { void load() }, 0)
        return () => window.clearTimeout(timer)
    }, [load])

    function openProduction(item) {
        setSearchParams(params => {
            params.set('modal', 'employee-mode')
            if (item.status === 'adopted' && !item.candidate_news_id) {
                params.set('backlog_id', item.id)
                params.set('tab', 'create')
            } else {
                params.delete('backlog_id')
                params.set('tab', 'history')
            }
            return params
        })
    }

    async function release(item) {
        if (releasingId) return
        setReleasingId(item.id)
        const { error } = await supabase.schema('ap').rpc('release_news_backlog_item', {
            p_backlog_id: item.id,
            p_cliente_id: clienteId,
        })
        if (error) toast.error('Não foi possível devolver esta matéria ao banco.')
        else {
            setItems(current => current.filter(existing => existing.id !== item.id))
            toast.success('Matéria devolvida ao Banco de pautas.')
        }
        setReleasingId(null)
    }

    const adoptedItems = items.filter(item => item.status === 'adopted' && !item.candidate_news_id)
    const productionItems = items.filter(item => item.status !== 'adopted' || item.candidate_news_id)

    return (
        <div className="ap-page ap-my-work-page">
            <div className="ap-header">
                <div className="ap-header-left">
                    <h1>Meu trabalho</h1>
                    <p>Veja as pautas que você pegou e acompanhe suas produções.</p>
                </div>
                <button type="button" className="ap-btn-refresh" onClick={load} disabled={loading || !clienteId}>
                    <RefreshCcw size={14} className={loading ? 'ap-spin-icon' : ''} /> Atualizar
                </button>
            </div>

            {loading ? (
                <div className="ap-backlog-loading">Carregando suas matérias…</div>
            ) : items.length === 0 ? (
                <div className="ap-backlog-empty ap-my-work-empty ap-my-work-zero-state">
                    <div className="ap-backlog-empty-icon"><FileText size={22} /></div>
                    <p className="title">Você ainda não pegou nenhuma pauta.</p>
                    <p className="hint">Escolha uma matéria no Banco de pautas para ela aparecer aqui.</p>
                </div>
            ) : (
                <div className="ap-my-work-sections">
                    <div className="ap-work-tabs" role="tablist" aria-label="Meu trabalho">
                        <button type="button" role="tab" aria-selected={workTab === 'pautas'} className={`ap-backlog-tab${workTab === 'pautas' ? ' active' : ''}`} onClick={() => setWorkTab('pautas')}>Pautas <span className="ap-backlog-tab-count">{adoptedItems.length}</span></button>
                        <button type="button" role="tab" aria-selected={workTab === 'producoes'} className={`ap-backlog-tab${workTab === 'producoes' ? ' active' : ''}`} onClick={() => setWorkTab('producoes')}>Produções <span className="ap-backlog-tab-count">{productionItems.length}</span></button>
                    </div>
                    {workTab === 'pautas' && <section aria-label="Minhas pautas">
                        <h2 className="ap-my-work-section-title">Minhas pautas</h2>
                        <p className="ap-my-work-section-hint">Pautas que você pegou e ainda não viraram uma produção.</p>
                        {adoptedItems.length === 0 ? <WorkEmptyState title="Nenhuma pauta aguardando início." description="Quando você pegar uma matéria, ela aparecerá aqui." /> : (
                            <div className="ap-my-work-grid">{adoptedItems.map(item => <NewsWorkCard key={item.id} item={item} onOpen={openProduction} onRelease={release} releasingId={releasingId} />)}</div>
                        )}
                    </section>}
                    {workTab === 'producoes' && <section aria-label="Minhas produções">
                        <h2 className="ap-my-work-section-title">Minhas produções</h2>
                        <p className="ap-my-work-section-hint">Matérias cuja produção já foi iniciada.</p>
                        {productionItems.length === 0 ? <WorkEmptyState title="Não há produções em andamento." description="Quando você começar uma produção, ela aparecerá aqui." /> : (
                            <div className="ap-my-work-grid">{productionItems.map(item => <NewsWorkCard key={item.id} item={item} onOpen={openProduction} onRelease={release} releasingId={releasingId} />)}</div>
                        )}
                    </section>}
                </div>
            )}
        </div>
    )
}

function WorkEmptyState({ title, description }) {
    return (
        <div className="ap-my-work-section-empty">
            <div className="ap-my-work-section-empty-icon"><FileText size={18} /></div>
            <div>
                <strong>{title}</strong>
                <span>{description}</span>
            </div>
        </div>
    )
}

function NewsWorkCard({ item, onOpen, onRelease, releasingId }) {
    return (
        <article className="ap-my-work-card">
            <div className={`ap-my-work-status is-${item.status}`}>{STATUS_LABELS[item.status] || item.status}</div>
            <h2>{item.titulo || domainOf(item.url_original)}</h2>
            <p className="ap-my-work-domain">{domainOf(item.url_original)}</p>
            {item.observacao && <p className="ap-my-work-note">{item.observacao}</p>}
            <dl>
                <div><dt>Adotada em</dt><dd>{formatDate(item.adopted_at)}</dd></div>
                <div><dt>Produção iniciada</dt><dd>{formatDate(item.production_started_at)}</dd></div>
                <div><dt>Concluída em</dt><dd>{formatDate(item.production_completed_at)}</dd></div>
            </dl>
            <div className="ap-my-work-actions">
                <a href={item.url_original} target="_blank" rel="noreferrer" className="ap-btn-refresh"><ExternalLink size={13} /> Fonte</a>
                <button type="button" className="ap-backlog-action-solid" onClick={() => onOpen(item)}>
                    <Zap size={13} /> {item.status === 'adopted' ? 'Começar produção' : 'Ver produção'}
                </button>
                {item.status === 'adopted' && !item.candidate_news_id && (
                    <button type="button" className="ap-backlog-action-icon" onClick={() => onRelease(item)} disabled={Boolean(releasingId)} title="Devolver ao Banco de pautas" aria-label="Devolver ao Banco de pautas">
                        {releasingId === item.id ? <Loader2 size={14} className="ap-spin-icon" /> : <Undo2 size={14} />}
                    </button>
                )}
            </div>
        </article>
    )
}
