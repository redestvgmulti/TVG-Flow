import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../services/supabase'
import { AlertTriangle, Bot, Camera, ExternalLink, Pencil, Plus, Settings, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { SkeletonCard } from '../../components/Skeleton'
import Modal from '../../components/ui/Modal'
import '../../styles/content.css'

const BUCKET = 'assistant-images'
const EMPTY_ASSISTANT = { nome: '', gpt_url: '', imagem: null }

function getImageUrl(path) {
    return path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : ''
}

function AdminContent() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [assistants, setAssistants] = useState([])
    const [tenantId, setTenantId] = useState(null)
    const [currentUserId, setCurrentUserId] = useState(null)
    const [showModal, setShowModal] = useState(false)
    const [editingAssistant, setEditingAssistant] = useState(null)
    const [openAssistantMenu, setOpenAssistantMenu] = useState(null)
    const [assistantToDelete, setAssistantToDelete] = useState(null)
    const [deletingAssistant, setDeletingAssistant] = useState(false)
    const assistantMenuRef = useRef(null)
    const [formData, setFormData] = useState(EMPTY_ASSISTANT)
    const [isDraggingImage, setIsDraggingImage] = useState(false)
    const [imagePreview, setImagePreview] = useState('')

    useEffect(() => { initialise() }, [])

    useEffect(() => {
        if (!openAssistantMenu) return
        const closeMenu = (event) => {
            if (event.type === 'keydown') {
                if (event.key === 'Escape') setOpenAssistantMenu(null)
                return
            }
            if (!assistantMenuRef.current?.contains(event.target)) setOpenAssistantMenu(null)
        }
        document.addEventListener('pointerdown', closeMenu)
        document.addEventListener('keydown', closeMenu)
        return () => {
            document.removeEventListener('pointerdown', closeMenu)
            document.removeEventListener('keydown', closeMenu)
        }
    }, [openAssistantMenu])

    async function initialise() {
        try {
            setLoading(true)
            const { data: { user }, error: userError } = await supabase.auth.getUser()
            if (userError) throw userError
            if (!user) throw new Error('AUTHENTICATED_USER_NOT_FOUND')
            setCurrentUserId(user.id)
            const { data, error } = await supabase
                .from('empresa_profissionais')
                .select('empresa_id, empresas!inner(empresa_tipo)')
                .eq('profissional_id', user.id)
                .eq('ativo', true)
                .eq('empresas.empresa_tipo', 'tenant')
                .maybeSingle()
            if (error) throw error
            setTenantId(data?.empresa_id || null)
            await fetchAssistants()
        } catch (error) {
            console.error('Error loading assistant context:', error)
            toast.error('Não foi possível carregar o contexto dos assistentes')
        } finally { setLoading(false) }
    }

    async function fetchAssistants() {
        const { data, error } = await supabase.from('assistentes').select('*').order('ordem').order('nome')
        if (error) throw error
        setAssistants(data || [])
    }

    function openCreateModal() {
        setEditingAssistant(null)
        setFormData(EMPTY_ASSISTANT)
        setImagePreview('')
        setShowModal(true)
    }

    function openEditModal(assistant) {
        setEditingAssistant(assistant)
        setFormData({ nome: assistant.nome, gpt_url: assistant.gpt_url, imagem: null })
        setImagePreview(getImageUrl(assistant.imagem_path))
        setShowModal(true)
    }

    function closeModal() {
        if (saving) return
        setShowModal(false)
        setEditingAssistant(null)
        setFormData(EMPTY_ASSISTANT)
        setIsDraggingImage(false)
        setImagePreview('')
    }

    function selectImage(file) {
        if (!file) return
        setFormData(current => ({ ...current, imagem: file }))
        const reader = new FileReader()
        reader.onload = () => setImagePreview(String(reader.result || ''))
        reader.readAsDataURL(file)
    }

    async function uploadImage(file) {
        if (!file) return editingAssistant?.imagem_path || null
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('INVALID_IMAGE')
        const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
        const path = tenantId
            ? `${tenantId}/${crypto.randomUUID()}.${extension}`
            : `global/${currentUserId}/${crypto.randomUUID()}.${extension}`
        const { error } = await supabase.storage.from(BUCKET).upload(path, file, { cacheControl: '3600', contentType: file.type, upsert: false })
        if (error) throw error
        return path
    }

    async function handleSave(event) {
        event.preventDefault()
        let uploadedPath = null
        try {
            setSaving(true)
            uploadedPath = await uploadImage(formData.imagem)
            const payload = { nome: formData.nome.trim(), gpt_url: formData.gpt_url.trim(), imagem_path: uploadedPath, tenant_id: tenantId || null, created_by: tenantId ? null : currentUserId }
            const { error } = editingAssistant
                ? await supabase.from('assistentes').update(payload).eq('id', editingAssistant.id)
                : await supabase.from('assistentes').insert(payload)
            if (error) throw error
            if (editingAssistant?.imagem_path && uploadedPath !== editingAssistant.imagem_path) await supabase.storage.from(BUCKET).remove([editingAssistant.imagem_path])
            toast.success(editingAssistant ? 'Assistente atualizado' : 'Assistente criado')
            closeModal()
            await fetchAssistants()
        } catch (error) {
            console.error('Error saving assistant:', error)
            if (uploadedPath && uploadedPath !== editingAssistant?.imagem_path) await supabase.storage.from(BUCKET).remove([uploadedPath])
            toast.error(error.message === 'INVALID_IMAGE' ? 'Use JPG, PNG ou WebP de até 5 MB' : `Não foi possível salvar: ${error.message || error.code || 'erro desconhecido'}`)
        } finally { setSaving(false) }
    }

    function requestDelete(assistant) {
        setOpenAssistantMenu(null)
        setAssistantToDelete(assistant)
    }

    function closeDeleteModal() {
        if (!deletingAssistant) setAssistantToDelete(null)
    }

    async function handleDelete() {
        if (!assistantToDelete) return
        try {
            setDeletingAssistant(true)
            const { data, error } = await supabase
                .from('assistentes')
                .delete()
                .eq('id', assistantToDelete.id)
                .select('id')
                .maybeSingle()
            if (error) throw error
            if (!data) throw new Error('ASSISTANT_NOT_DELETED')
            setAssistants(current => current.filter(item => item.id !== assistantToDelete.id))
            setAssistantToDelete(null)
            if (assistantToDelete.imagem_path) {
                const { error: storageError } = await supabase.storage.from(BUCKET).remove([assistantToDelete.imagem_path])
                if (storageError) console.warn('Assistant image could not be removed:', storageError)
            }
            toast.success('Assistente excluído')
        } catch (error) {
            console.error('Error deleting assistant:', error)
            toast.error('Não foi possível excluir o assistente')
        } finally { setDeletingAssistant(false) }
    }

    if (loading) return <div className="animation-fade-in"><div className="companies-header"><h2 className="companies-title">Assistentes</h2></div><div className="companies-grid">{Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}</div></div>
    return <div className="animation-fade-in">
        <div className="companies-header assistants-header"><div><h2 className="companies-title">Assistentes</h2><p className="assistants-subtitle">GPTs disponíveis para a equipe.</p></div><button className="btn btn-primary" onClick={openCreateModal}><Plus size={16} /> Novo assistente</button></div>
        {assistants.length ? <div className="companies-grid">{assistants.map(assistant => <div key={assistant.id} className="card company-card content-card assistant-card"><div ref={openAssistantMenu === assistant.id ? assistantMenuRef : null} className="assistant-card-menu"><button type="button" className="assistant-menu-trigger" aria-label={`Opções de ${assistant.nome}`} aria-expanded={openAssistantMenu === assistant.id} aria-haspopup="menu" onClick={() => setOpenAssistantMenu(current => current === assistant.id ? null : assistant.id)}><Settings size={18} /></button>{openAssistantMenu === assistant.id && <div className="assistant-menu-popover" role="menu"><button type="button" role="menuitem" onClick={() => { setOpenAssistantMenu(null); openEditModal(assistant) }}><Pencil size={16} /> Editar</button><button type="button" role="menuitem" className="assistant-menu-remove" onClick={() => requestDelete(assistant)}><Trash2 size={16} /> Remover</button></div>}</div><div className="assistant-card-body"><div className="assistant-profile-heading"><img className="assistant-profile-avatar" src={getImageUrl(assistant.imagem_path)} alt={`Foto do assistente ${assistant.nome}`} /><div><span className="assistant-profile-label">Assistente GPT</span><h3 className="company-name">{assistant.nome}</h3></div></div><a href={assistant.gpt_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-content-access">Abrir assistente <ExternalLink size={16} /></a></div></div>)}</div> : <div className="card"><div className="empty-state"><div className="empty-icon"><Bot size={64} /></div><p className="empty-text">Nenhum assistente cadastrado</p><p className="empty-subtitle">Clique em “Novo assistente” para criar o primeiro.</p></div></div>}
        <Modal
            isOpen={showModal}
            onClose={closeModal}
            title={editingAssistant ? 'Editar assistente' : 'Novo assistente'}
            icon={Bot}
            size="md"
            footer={<><button type="button" onClick={closeModal} className="btn btn-secondary">Cancelar</button><button form="assistant-form" type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Salvando...' : 'Salvar assistente'}</button></>}
        >
            <form id="assistant-form" className="assistant-modal-form" onSubmit={handleSave}>
                <div className="assistant-modal-field">
                    <label htmlFor="assistant-image">Foto <span>*</span></label>
                    <div className={`assistant-avatar-picker${isDraggingImage ? ' assistant-avatar-picker--dragging' : ''}`} onDragOver={event => { event.preventDefault(); setIsDraggingImage(true) }} onDragLeave={() => setIsDraggingImage(false)} onDrop={event => { event.preventDefault(); setIsDraggingImage(false); selectImage(event.dataTransfer.files?.[0]) }}>
                        <input id="assistant-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => selectImage(event.target.files?.[0])} required={!editingAssistant} />
                        {imagePreview ? <img src={imagePreview} alt="Prévia da foto do assistente" /> : <span className="assistant-avatar-placeholder"><Bot size={38} /></span>}
                        <span className="assistant-avatar-camera"><Camera size={18} /></span>
                    </div>
                    <span className="assistant-avatar-help">Clique na foto ou arraste uma imagem. JPG, PNG ou WebP, até 5 MB.</span>
                </div>
                <div className="assistant-modal-field"><label htmlFor="assistant-name">Nome <span>*</span></label><input id="assistant-name" value={formData.nome} onChange={event => setFormData({ ...formData, nome: event.target.value })} maxLength={120} required placeholder="Ex.: Redator institucional" /></div>
                <div className="assistant-modal-field"><label htmlFor="assistant-url">Link do GPT <span>*</span></label><input id="assistant-url" type="url" value={formData.gpt_url} onChange={event => setFormData({ ...formData, gpt_url: event.target.value })} required placeholder="https://chatgpt.com/g/..." /></div>
            </form>
        </Modal>
        <Modal
            isOpen={Boolean(assistantToDelete)}
            onClose={closeDeleteModal}
            closeOnBackdrop={!deletingAssistant}
            title="Excluir assistente"
            subtitle="Esta ação não pode ser desfeita."
            icon={AlertTriangle}
            iconColor="var(--color-danger, #DC2626)"
            iconBg="var(--color-danger-bg, #FEE2E2)"
            footer={<><button type="button" onClick={closeDeleteModal} className="btn btn-secondary" disabled={deletingAssistant}>Cancelar</button><button type="button" onClick={handleDelete} className="btn btn-danger" disabled={deletingAssistant}>{deletingAssistant ? 'Excluindo...' : 'Excluir'}</button></>}
        >
            <div className="confirm-modal-content">
                <div className="confirm-modal-icon"><AlertTriangle size={24} /></div>
                <p className="confirm-modal-message">Tem certeza que deseja excluir o assistente <span className="confirm-modal-highlight">“{assistantToDelete?.nome}”</span>?</p>
                <p className="confirm-modal-warning">Esta ação removerá o assistente para todos os usuários.</p>
            </div>
        </Modal>
    </div>
}

export default AdminContent
