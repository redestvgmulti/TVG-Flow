import React, { useState, useEffect } from 'react'
import { Plus, Trash2, Workflow, AlertCircle } from 'lucide-react'
import { supabase } from '../services/supabase'
import { toast } from 'sonner'
import Modal from './ui/Modal'
import '../styles/conversao-workflow-modal.css'

/**
 * ConversaoWorkflowModal - ETAPA 4 FASE 4
 * Modal para converter OS simples em OS complexa (workflow)
 * Apenas Admin pode executar
 */
export default function ConversaoWorkflowModal({
    isOpen,
    onClose,
    os,
    onSuccess
}) {
    const [etapas, setEtapas] = useState([
        { descricao: '', profissional_id: '', ordem: 1 }
    ])
    const [motivo, setMotivo] = useState('')
    const [profissionais, setProfissionais] = useState([])
    const [loading, setLoading] = useState(false)
    const [loadingProfissionais, setLoadingProfissionais] = useState(false)

    useEffect(() => {
        if (isOpen) {
            loadProfissionais()
        }
    }, [isOpen])

    async function loadProfissionais() {
        try {
            setLoadingProfissionais(true)

            // Buscar profissionais da mesma empresa
            const { data, error } = await supabase
                .from('profissionais')
                .select('id, nome')
                .eq('empresa_id', os.empresa_id)
                .order('nome')

            if (error) throw error

            setProfissionais(data || [])
        } catch (err) {
            console.error('Erro ao carregar profissionais:', err)
            toast.error('Erro ao carregar profissionais')
        } finally {
            setLoadingProfissionais(false)
        }
    }

    function adicionarEtapa() {
        setEtapas([
            ...etapas,
            { descricao: '', profissional_id: '', ordem: etapas.length + 1 }
        ])
    }

    function removerEtapa(index) {
        if (etapas.length === 1) {
            toast.error('Deve ter ao menos 1 etapa')
            return
        }

        const novasEtapas = etapas.filter((_, i) => i !== index)
        // Reordenar
        novasEtapas.forEach((etapa, i) => {
            etapa.ordem = i + 1
        })
        setEtapas(novasEtapas)
    }

    function atualizarEtapa(index, field, value) {
        const novasEtapas = [...etapas]
        novasEtapas[index][field] = value
        setEtapas(novasEtapas)
    }

    function validarFormulario() {
        // Validar que todas etapas têm descrição e profissional
        for (let i = 0; i < etapas.length; i++) {
            const etapa = etapas[i]
            if (!etapa.descricao.trim()) {
                toast.error(`Etapa ${i + 1}: descrição é obrigatória`)
                return false
            }
            if (!etapa.profissional_id) {
                toast.error(`Etapa ${i + 1}: profissional é obrigatório`)
                return false
            }
        }
        return true
    }

    async function handleSubmit(e) {
        e.preventDefault()

        if (!validarFormulario()) return

        try {
            setLoading(true)

            // Preparar dados para Edge Function
            const payload = {
                os_id: os.id,
                micro_tasks: etapas.map(etapa => ({
                    profissional_id: etapa.profissional_id,
                    descricao: etapa.descricao.trim(),
                    ordem: etapa.ordem
                })),
                motivo: motivo.trim() || null
            }

            // Chamar Edge Function via cliente Supabase compartilhado — ele já
            // resolve a URL correta (import.meta.env.VITE_SUPABASE_URL) e anexa
            // o Authorization da sessão atual automaticamente.
            const { data: result, error: fnError } = await supabase.functions.invoke(
                'converter-os-para-complexa',
                { body: payload }
            )

            if (fnError) {
                // A função responde erros de negócio como { error: '...' } no
                // corpo, mesmo com status != 2xx — extrai a mensagem real dali.
                let message = fnError.message
                if (fnError.context) {
                    try {
                        const body = await fnError.context.json()
                        if (body?.error) message = body.error
                    } catch {
                        // corpo não era JSON — mantém a mensagem padrão do SDK
                    }
                }
                throw new Error(message || 'Erro ao converter OS')
            }
            if (result?.error) {
                throw new Error(result.error)
            }

            // Sucesso!
            toast.success(`OS convertida! ${result.micro_tasks_criadas} etapas criadas`)
            onSuccess?.()
            onClose()

        } catch (err) {
            console.error('Erro ao converter OS:', err)
            toast.error(err.message || 'Erro ao converter OS')
        } finally {
            setLoading(false)
        }
    }

    if (!isOpen) return null

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Converter em Workflow"
            icon={Workflow}
            size="lg"
            className="workflow-conversion-modal"
            closeOnBackdrop={!loading}
            footer={(
                <>
                    <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>
                        Cancelar
                    </button>
                    <button type="submit" form="conversao-workflow-form" className="btn btn-primary" disabled={loading}>
                        {loading ? 'Convertendo...' : 'Converter em Workflow'}
                    </button>
                </>
            )}
        >
            <div className="info-banner danger" style={{ marginBottom: 'var(--space-6)' }}>
                <AlertCircle size={18} />
                <p>
                    <strong>Atenção:</strong> Esta ação não pode ser revertida.
                    A OS #{os.id} será convertida em workflow com etapas definidas.
                </p>
            </div>

            {/* Form */}
            <form id="conversao-workflow-form" onSubmit={handleSubmit}>
                {/* Etapas */}
                <div className="conversao-etapas-section">
                    <div className="conversao-section-header">
                        <h3>Etapas do Workflow</h3>
                        <span className="conversao-etapas-count">
                            {etapas.length} {etapas.length === 1 ? 'etapa' : 'etapas'}
                        </span>
                    </div>

                    <div className="conversao-etapas-list">
                        {etapas.map((etapa, index) => (
                            <div key={index} className="conversao-etapa-item">
                                <div className="conversao-etapa-number">
                                    {index + 1}
                                </div>

                                <div className="conversao-etapa-fields">
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="Descrição da etapa"
                                        value={etapa.descricao}
                                        onChange={(e) => atualizarEtapa(index, 'descricao', e.target.value)}
                                        required
                                        disabled={loading}
                                        maxLength={200}
                                    />

                                    <select
                                        className="input"
                                        value={etapa.profissional_id}
                                        onChange={(e) => atualizarEtapa(index, 'profissional_id', e.target.value)}
                                        required
                                        disabled={loading || loadingProfissionais}
                                    >
                                        <option value="">Selecione profissional</option>
                                        {profissionais.map(prof => (
                                            <option key={prof.id} value={prof.id}>
                                                {prof.nome}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {etapas.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => removerEtapa(index)}
                                        className="conversao-etapa-remove"
                                        disabled={loading}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    <button
                        type="button"
                        onClick={adicionarEtapa}
                        className="conversao-add-etapa"
                        disabled={loading}
                    >
                        <Plus size={16} />
                        Adicionar Etapa
                    </button>
                </div>

                {/* Motivo (opcional) */}
                <div className="input-group conversao-motivo-section">
                    <label htmlFor="motivo">Motivo (opcional)</label>
                    <textarea
                        id="motivo"
                        className="input"
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        placeholder="Ex: Cliente solicitou divisão em etapas específicas"
                        rows={3}
                        maxLength={500}
                        disabled={loading}
                    />
                    <span className="conversao-char-count">
                        {motivo.length}/500
                    </span>
                </div>
            </form>
        </Modal>
    )
}
