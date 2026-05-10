import { useRef, useState } from 'react'
import { useI18n } from '../../../context/I18nContext'

const ACCEPT = '.mp4,.mov,.avi,.mkv,.webm,.m4v'
const ACCEPT_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo',
  'video/x-matroska', 'video/webm', 'video/x-m4v', 'video/']

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export function UploadStep({ file, onFile, onNext }) {
  const { t } = useI18n()
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')

  function handleFiles(files) {
    const f = files[0]
    if (!f) return
    if (!ACCEPT_TYPES.some(type => f.type.startsWith(type)) && !ACCEPT.split(',').some(ext => f.name.toLowerCase().endsWith(ext.replace('.', '')))) {
      setError(t('video.errorNotVideo'))
      return
    }
    setError('')
    onFile(f)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-on-surface mb-6">{t('video.stepUpload')}</h2>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          'border-2 border-dashed rounded-[var(--radius-xl)] p-12 text-center cursor-pointer transition-colors',
          dragOver ? 'border-primary bg-primary/5' : 'border-outline-variant hover:border-primary/50',
          file ? 'border-emerald-400 bg-emerald-50' : '',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
        <span className="material-symbols-outlined text-[48px] text-primary mb-3 block">
          {file ? 'check_circle' : 'video_file'}
        </span>
        {file ? (
          <div>
            <p className="font-semibold text-on-surface">{file.name}</p>
            <p className="text-sm text-outline mt-1">{formatSize(file.size)}</p>
          </div>
        ) : (
          <div>
            <p className="font-semibold text-on-surface">{t('video.dropHere')}</p>
            <p className="text-sm text-outline mt-1">{t('video.acceptedFormats')}</p>
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-error">{error}</p>}

      <div className="mt-6 flex justify-end">
        <button
          onClick={onNext}
          disabled={!file}
          className="sd-button-primary px-6 py-2.5 text-sm disabled:opacity-50"
        >
          {t('common.next')} →
        </button>
      </div>
    </div>
  )
}
