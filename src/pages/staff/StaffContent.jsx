import { useEffect, useState } from 'react'
import { supabase } from '../../services/supabase'
import { Bot, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import '../../styles/content.css'

const BUCKET = 'assistant-images'
const getImageUrl = path => path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : ''

function StaffContent() {
    const [loading, setLoading] = useState(true)
    const [assistants, setAssistants] = useState([])
    useEffect(() => { fetchAssistants() }, [])
    async function fetchAssistants() {
        try {
            setLoading(true)
            const { data, error } = await supabase.from('assistentes').select('*').eq('ativo', true).order('ordem').order('nome')
            if (error) throw error
            setAssistants(data || [])
        } catch (error) {
            console.error('Error fetching assistants:', error)
            toast.error('Erro ao carregar assistentes')
        } finally { setLoading(false) }
    }
    if (loading) return <div className="animation-fade-in"><div className="companies-header"><h2 className="companies-title">Assistentes</h2></div><div className="card loading-card"><p className="loading-text-primary">Carregando assistentes...</p></div></div>
    return <div className="animation-fade-in"><div className="companies-header"><div><h2 className="companies-title">Assistentes</h2><p className="assistants-subtitle">Escolha um GPT para começar.</p></div></div>{assistants.length ? <div className="companies-grid">{assistants.map(assistant => <div key={assistant.id} className="card company-card content-card assistant-card"><div className="assistant-card-body"><div className="assistant-profile-heading"><img className="assistant-profile-avatar" src={getImageUrl(assistant.imagem_path)} alt={`Foto do assistente ${assistant.nome}`} /><div><span className="assistant-profile-label">Assistente GPT</span><h3 className="company-name">{assistant.nome}</h3></div></div><a href={assistant.gpt_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-content-access">Abrir assistente <ExternalLink size={16} /></a></div></div>)}</div> : <div className="card"><div className="empty-state"><div className="empty-icon"><Bot size={64} /></div><p className="empty-text">Nenhum assistente disponível no momento.</p></div></div>}</div>
}

export default StaffContent
