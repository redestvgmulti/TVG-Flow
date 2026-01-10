import { supabase } from './supabase'
import { v4 as uuidv4 } from 'uuid'

export const fileService = {
    /**
     * Uploads multiple files for a task
     * @param {File[]} files - Array of files to upload
     * @param {string} taskId - ID of the task
     * @param {string} empresaId - ID of the company
     * @param {string} uploadedBy - ID of the professional uploading
     * @returns {Promise<Object>} - Result with success/failed counts
     */
    async uploadTaskAttachments(files, taskId, empresaId, uploadedBy) {
        const results = {
            success: [],
            failed: []
        }

        for (const file of files) {
            try {
                const fileExt = file.name.split('.').pop()
                const uuid = uuidv4()
                const safeFilename = `${uuid}.${fileExt}`
                const storagePath = `${empresaId}/${taskId}/${safeFilename}`

                // 1. Upload to Storage
                const { error: uploadError } = await supabase.storage
                    .from('task-attachments')
                    .upload(storagePath, file, {
                        cacheControl: '3600',
                        upsert: false
                    })

                if (uploadError) throw uploadError

                // 2. Insert Metadata into Database
                const { data: insertData, error: dbError } = await supabase
                    .from('task_attachments')
                    .insert({
                        tarefa_id: taskId,
                        empresa_id: empresaId,
                        uploaded_by: uploadedBy,
                        filename: safeFilename, // UUID-based name
                        original_filename: file.name,
                        file_size: file.size,
                        mime_type: file.type,
                        storage_path: storagePath
                    })
                    .select()
                    .single()

                if (dbError) {
                    // Critical: Rollback storage upload if DB insert fails
                    console.error('DB Insert failed, rolling back storage:', dbError)
                    await supabase.storage.from('task-attachments').remove([storagePath])
                    throw dbError
                }

                results.success.push({
                    file: file.name,
                    data: insertData
                })

            } catch (error) {
                console.error(`Failed to upload ${file.name}:`, error)
                results.failed.push({
                    file: file.name,
                    error: error.message
                })
            }
        }

        return results
    },

    /**
     * Get all attachments for a specific task
     * @param {string} taskId 
     */
    async getTaskAttachments(taskId) {
        const { data, error } = await supabase
            .from('task_attachments')
            .select(`
                *,
                profissionais:uploaded_by (
                    id,
                    nome
                )
            `)
            .eq('tarefa_id', taskId)
            .order('created_at', { ascending: false })

        if (error) throw error
        return data
    },

    /**
     * Get a signed URL for downloading the file
     * @param {string} storagePath 
     */
    async getDownloadUrl(storagePath) {
        const { data, error } = await supabase.storage
            .from('task-attachments')
            .createSignedUrl(storagePath, 60) // 60 seconds (aligned with security docs)

        if (error) throw error
        return data.signedUrl
    },

    /**
     * Delete an attachment via Edge Function
     * @param {string} attachmentId - The attachment ID to delete
     */
    async deleteAttachment(attachmentId) {
        const { data, error } = await supabase.functions.invoke(
            'delete-task-attachment',
            {
                body: { attachment_id: attachmentId }
            }
        )

        if (error) throw error

        if (!data?.success) {
            throw new Error(data?.error || 'Failed to delete attachment')
        }

        return { success: true }
    }
}
