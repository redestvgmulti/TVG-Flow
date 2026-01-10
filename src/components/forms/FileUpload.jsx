import { useState, useRef } from 'react'
import { Upload, X, File as FileIcon, Image as ImageIcon, CheckCircle, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import '../../styles/admin-forms.css'

export default function FileUpload({
    files,
    onFilesChange,
    maxFiles = 5,
    maxSizeMB = 10,
    acceptedTypes = [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/zip',
        'application/x-zip-compressed'
    ]
}) {
    const inputRef = useRef(null)
    const [isDragging, setIsDragging] = useState(false)

    const handleDragEnter = (e) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(true)
    }

    const handleDragLeave = (e) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)
    }

    const handleDragOver = (e) => {
        e.preventDefault()
        e.stopPropagation()
    }

    const validateFile = (file) => {
        // Check size
        if (file.size > maxSizeMB * 1024 * 1024) {
            toast.error(`Arquivo ${file.name} excede o limite de ${maxSizeMB}MB`)
            return false
        }

        // Check type
        if (!acceptedTypes.includes(file.type)) {
            toast.error(`Formato inválido: ${file.name}`)
            return false
        }

        // Check duplicates
        if (files.some(f => f.name === file.name && f.size === file.size)) {
            toast.error(`Arquivo já adicionado: ${file.name}`)
            return false
        }

        return true
    }

    const handleDrop = (e) => {
        e.preventDefault()
        e.stopPropagation()
        setIsDragging(false)

        const droppedFiles = Array.from(e.dataTransfer.files)
        addFiles(droppedFiles)
    }

    const handleFileSelect = (e) => {
        if (e.target.files) {
            const selectedFiles = Array.from(e.target.files)
            addFiles(selectedFiles)
            e.target.value = ''
        }
    }

    const addFiles = (newFiles) => {
        if (files.length + newFiles.length > maxFiles) {
            toast.error(`Limite máximo de ${maxFiles} arquivos`)
            return
        }

        const validFiles = newFiles.filter(validateFile)
        if (validFiles.length > 0) {
            onFilesChange([...files, ...validFiles])
        }
    }

    const removeFile = (index) => {
        const newFiles = [...files]
        newFiles.splice(index, 1)
        onFilesChange(newFiles)
    }

    const getFileIcon = (file) => {
        if (file.type.startsWith('image/')) return <ImageIcon size={20} className="text-primary" />
        if (file.type === 'application/pdf') return <FileIcon size={20} className="text-red-500" />
        return <FileIcon size={20} className="text-secondary" />
    }

    const formatSize = (bytes) => {
        if (bytes === 0) return '0 Bytes'
        const k = 1024
        const sizes = ['Bytes', 'KB', 'MB', 'GB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }

    return (
        <div className="file-upload-container">
            <div
                className={`file-drop-zone ${isDragging ? 'dragging' : ''}`}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
            >
                <input
                    type="file"
                    ref={inputRef}
                    onChange={handleFileSelect}
                    multiple
                    style={{ display: 'none' }}
                    accept={acceptedTypes.join(',')}
                />

                <Upload size={32} className="drop-zone-icon" />
                <p className="drop-zone-text">
                    Arraste arquivos ou <span>clique para selecionar</span>
                </p>
                <p className="drop-zone-hint">
                    PDF, Imagens, DOC, ZIP (Máx {maxSizeMB}MB)
                </p>
            </div>

            {files.length > 0 && (
                <div className="file-list">
                    {files.map((file, index) => (
                        <div key={`${file.name}-${index}`} className="file-item">
                            <div className="file-item-info">
                                {getFileIcon(file)}
                                <div className="file-item-details">
                                    <span className="file-name">{file.name}</span>
                                    <span className="file-size">{formatSize(file.size)}</span>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => removeFile(index)}
                                className="file-remove-btn"
                                title="Remover"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
