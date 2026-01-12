import React from 'react'
import { supabase } from '../services/supabase'
import { Send, X } from 'lucide-react'
import '../styles/comment-form.css'

/**
 * Componente ComentarioForm - ETAPA 3 FASE 5
 * Formulário para adicionar novos comentários em uma OS
 */
export default function ComentarioForm({ taskId, osId, onSuccess }) {
    // BACKWARD COMPATIBILITY: Accept either taskId or osId
    const finalTaskId = taskId || osId
    
    const [content, setContent] = React.useState('')
    const [isSubmitting, setIsSubmitting] = React.useState(false)
    const [error, setError] = React.useState(null)

    async function handleSubmit(e) {
        e.preventDefault()

        const trimmedContent = content.trim()

        // Validações
        if (!trimmedContent) {
            setError('Comentário não pode estar vazio')
            return
        }

        if (trimmedContent.length > 5000) {
            setError('Comentário muito longo (máx 5000 caracteres)')
            return
        }
        
        // GUARD CLAUSE: Critical fix for NULL task_id
        if (!finalTaskId) {
            console.error('CRITICAL: Tentativa de comentar sem ID da tarefa (taskId/osId is null)')
            setError('Erro interno: ID da tarefa não identificado. Tente recarregar a página.')
            return
        }

        try {
            setIsSubmitting(true)
            setError(null)

            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                throw new Error('Usuário não autenticado')
            }

            // Inserir comentário
            // Triggers automáticos criarão: evento + notificações
            const { error: insertError } = await supabase
                .from('task_comments')
                .insert({
                    task_id: finalTaskId, // Fixed: Using the validated ID
                    author_id: user.id,
                    content: trimmedContent
                })

            if (insertError) throw insertError

            // Sucesso
            setContent('')
            onSuccess?.()

        } catch (err) {
            console.error('Erro ao adicionar comentário:', err)
            setError(err.message || 'Erro ao adicionar comentário')
        } finally {
            setIsSubmitting(false)
        }
    }

    function handleClear() {
        setContent('')
        setError(null)
    }

    return (
        <form className="comment-form" onSubmit={handleSubmit}>
            <div className="comment-form-header">
                <label htmlFor="comment-input">Adicionar Comentário</label>
                <span className="comment-form-counter">
                    {content.length}/5000
                </span>
            </div>

            <textarea
                id="comment-input"
                className="comment-form-textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Escreva seu comentário..."
                rows={3}
                maxLength={5000}
                disabled={isSubmitting}
            />

            {error && (
                <div className="comment-form-error">
                    {error}
                </div>
            )}

            <div className="comment-form-actions">
                {content && (
                    <button
                        type="button"
                        onClick={handleClear}
                        className="comment-form-btn comment-form-btn-clear"
                        disabled={isSubmitting}
                    >
                        <X size={16} />
                        Limpar
                    </button>
                )}
                <button
                    type="submit"
                    className="comment-form-btn comment-form-btn-submit"
                    disabled={isSubmitting || !content.trim()}
                >
                    <Send size={16} />
                    {isSubmitting ? 'Enviando...' : 'Comentar'}
                </button>
            </div>
        </form>
    )
}
