import { useI18n } from '../../../context/I18nContext'

export function ReviewStep({ file, ops, audioConfig, submitting, onBack, onSubmit }) {
  const { t } = useI18n()

  return (
    <div>
      <h2 className="text-xl font-bold text-on-surface mb-6">{t('video.stepReview')}</h2>

      <div className="sd-panel p-6 space-y-4 mb-6">
        {/* File */}
        <ReviewRow icon="video_file" label={t('video.reviewFile')} value={file?.name} />

        {/* Operations */}
        {ops.length > 0 && (
          <ReviewRow
            icon="build"
            label={t('video.reviewOps')}
            value={ops.map(o => opLabel(o, t)).join(' → ')}
          />
        )}

        {/* Audio */}
        {audioConfig.extractAudio && (
          <ReviewRow icon="audio_file" label={t('video.extractAudio')} value="✓" />
        )}

        {/* Transcribe */}
        {audioConfig.transcribe && (
          <ReviewRow
            icon="record_voice_over"
            label={t('video.transcribe')}
            value={`SRT + TXT${audioConfig.sourceLanguage !== 'auto' ? ` (${audioConfig.sourceLanguage})` : ''}`}
          />
        )}

        {/* Translate */}
        {audioConfig.translate && (
          <ReviewRow icon="translate" label={t('video.translate')}
            value={audioConfig.targetLanguage.toUpperCase()} />
        )}

        {/* Burn subs */}
        {audioConfig.burnSubtitles && (
          <ReviewRow icon="subtitles" label={t('video.burnSubs')} value="✓" />
        )}

        {/* Default if nothing selected */}
        {ops.length === 0 && !audioConfig.extractAudio && !audioConfig.transcribe && (
          <p className="text-sm text-outline">{t('video.reviewNoOps')}</p>
        )}
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} disabled={submitting} className="sd-button-secondary px-5 py-2.5 text-sm">
          ← {t('common.back')}
        </button>
        <button
          onClick={onSubmit}
          disabled={submitting}
          className="sd-button-primary px-6 py-2.5 text-sm disabled:opacity-60 flex items-center gap-2"
        >
          {submitting ? (
            <><span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span> {t('common.submitting')}</>
          ) : (
            <>{t('video.startProcessing')} →</>
          )}
        </button>
      </div>
    </div>
  )
}

function ReviewRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-3">
      <span className="material-symbols-outlined text-[18px] text-primary mt-0.5">{icon}</span>
      <div>
        <p className="text-xs text-outline font-semibold uppercase tracking-wide">{label}</p>
        <p className="text-sm text-on-surface mt-0.5">{value}</p>
      </div>
    </div>
  )
}

function opLabel(op, t) {
  const type = op.type
  if (type === 'trim') return `${t('video.ops.trim')} ${op.start}s–${op.end || '∞'}s`
  if (type === 'resize') return `${t('video.ops.resize')} ${op.w}×${op.h}`
  if (type === 'speed') return `${t('video.ops.speed')} ${op.speed}×`
  if (type === 'format_convert') return `→ ${op.format?.toUpperCase()}`
  if (type === 'extract_frame') return `${t('video.ops.frame')} @${op.timestamp}s`
  return type
}
