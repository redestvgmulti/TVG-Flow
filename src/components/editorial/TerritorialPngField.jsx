import { useEffect, useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { assetPreviewUrl } from '../../services/masterV1Assets'
import {
  formatBytes,
  normalizeSeloPng,
  PngValidationError,
  VALIDATION_MESSAGES,
} from '../../services/seloPngNormalizer'

const PROCESSING_LABEL = {
  analyzing: 'Analisando imagem…',
  optimizing: 'Otimizando PNG…',
  ready: 'Imagem pronta para envio.',
}

export default function TerritorialPngField({
  label,
  asset,
  required = false,
  disabled = false,
  onChange,
  onProcessingChange,
}) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [meta, setMeta] = useState(null)
  const [localPreview, setLocalPreview] = useState(null)
  const tokenRef = useRef(0)

  const preview = localPreview || assetPreviewUrl(supabase, asset)
  const processing = status === 'analyzing' || status === 'optimizing'

  useEffect(() => () => {
    if (localPreview) URL.revokeObjectURL(localPreview)
  }, [localPreview])

  async function choose(candidate) {
    if (!candidate) return
    const token = ++tokenRef.current
    setError('')
    setMeta(null)
    setLocalPreview(previous => {
      if (previous) URL.revokeObjectURL(previous)
      return null
    })
    onChange(null)
    setStatus('analyzing')
    onProcessingChange?.(true)

    try {
      const result = await normalizeSeloPng(candidate, {
        onState: value => {
          if (tokenRef.current === token) setStatus(value)
        },
      })
      if (tokenRef.current !== token) return

      const metadata = {
        original_name: candidate.name,
        original: result.original,
        normalized: result.final,
      }
      setLocalPreview(URL.createObjectURL(result.file))
      setMeta({ original: result.original, final: result.final })
      setStatus('ready')
      onChange({ file: result.file, metadata })
    } catch (validationError) {
      if (tokenRef.current !== token) return
      const message = validationError instanceof PngValidationError
        ? (VALIDATION_MESSAGES[validationError.code] || validationError.message)
        : (validationError?.message || VALIDATION_MESSAGES.CORRUPTED)
      setError(message)
      setStatus('')
      setMeta(null)
      onChange(null)
    } finally {
      if (tokenRef.current === token) onProcessingChange?.(false)
    }
  }

  return (
    <label className="ap-field-label">
      {label}{required ? ' *' : ''}
      <span
        className={`ap-dropzone${dragging ? ' dragging' : ''}`}
        tabIndex={0}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            event.currentTarget.querySelector('input')?.click()
          }
        }}
        onDragOver={event => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => {
          event.preventDefault()
          setDragging(false)
          choose(event.dataTransfer.files?.[0])
        }}
      >
        <input
          type="file"
          accept="image/png"
          disabled={disabled || processing}
          onChange={event => choose(event.target.files?.[0])}
          style={{ display: 'none' }}
        />
        {preview
          ? <img className="ap-vt-preview" src={preview} alt={`Prévia: ${label}`} />
          : <span className="ap-dropzone-icon"><ImagePlus size={20} aria-hidden="true" /></span>}
        <span className="ap-dropzone-label">Arraste o PNG aqui ou clique para escolher</span>
        <small className="ap-dropzone-sub">
          O arquivo é normalizado e salvo em um novo path imutável do cliente.
        </small>
      </span>
      {status && <p role="status" className="ap-config-intro">{PROCESSING_LABEL[status]}</p>}
      {meta && (
        <dl className="ap-vt-optim">
          <div>
            <dt>Original</dt>
            <dd>{meta.original.width} × {meta.original.height} px · {formatBytes(meta.original.bytes)}</dd>
          </div>
          <div>
            <dt>Otimizado</dt>
            <dd>{meta.final.width} × {meta.final.height} px · {formatBytes(meta.final.bytes)}</dd>
          </div>
        </dl>
      )}
      {error && <p role="alert" className="ap-vt-alert">{error}</p>}
    </label>
  )
}
