import { useId, useState } from 'react'
import { CheckCircle2, Image as ImageIcon } from 'lucide-react'

// Presentational dropzone extracted for the canonical editor. Same visual
// language (ap-af-dropzone*) already used twice in ArticleForm.jsx/
// ArticleWizard.jsx, given a single reusable home instead of a third
// hand-copied block.
export default function ImageDropzone({ file, onSelectFile, disabled = false }) {
  const [isDragging, setIsDragging] = useState(false)
  const inputId = useId()

  function pick(nextFile) {
    if (!disabled && nextFile) onSelectFile(nextFile)
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="Selecionar imagem"
      className={`ap-af-dropzone${isDragging ? ' ap-af-dropzone--active' : ''}`}
      onDragOver={event => {
        event.preventDefault()
        if (!disabled) setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={event => {
        event.preventDefault()
        setIsDragging(false)
        pick(event.dataTransfer.files?.[0])
      }}
      onClick={() => !disabled && document.getElementById(inputId)?.click()}
      onKeyDown={event => {
        if (disabled) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          document.getElementById(inputId)?.click()
        }
      }}
    >
      <input
        id={inputId}
        type="file"
        accept="image/*"
        disabled={disabled}
        onChange={event => pick(event.target.files?.[0])}
      />
      {file ? (
        <>
          <span className="ap-af-dropzone-chip">
            <CheckCircle2 size={16} aria-hidden="true" /> Arquivo anexado: {file.name}
          </span>
          <span className="ap-af-dropzone-hint">Clique para alterar</span>
        </>
      ) : (
        <>
          <span className="ap-af-dropzone-circle">
            <ImageIcon size={20} aria-hidden="true" />
          </span>
          <span className="ap-af-dropzone-label">Clique ou arraste a imagem aqui</span>
        </>
      )}
    </div>
  )
}
