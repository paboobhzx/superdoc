import { useI18n } from '../../../context/I18nContext'

const SOURCE_LANGS = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en-US', label: 'English' },
  { value: 'pt-BR', label: 'Portuguese (BR)' },
  { value: 'es-ES', label: 'Spanish' },
  { value: 'fr-FR', label: 'French' },
  { value: 'de-DE', label: 'German' },
  { value: 'it-IT', label: 'Italian' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'zh-CN', label: 'Chinese (Simplified)' },
  { value: 'ko-KR', label: 'Korean' },
]

const TARGET_LANGS = [
  { value: 'en',  label: 'English' },
  { value: 'pt',  label: 'Portuguese' },
  { value: 'es',  label: 'Spanish' },
  { value: 'fr',  label: 'French' },
  { value: 'de',  label: 'German' },
  { value: 'it',  label: 'Italian' },
  { value: 'ja',  label: 'Japanese' },
  { value: 'zh',  label: 'Chinese' },
  { value: 'ko',  label: 'Korean' },
]

export function AudioTranscriptStep({ config, onChange, onBack, onNext }) {
  const { t } = useI18n()

  function set(patch) { onChange({ ...config, ...patch }) }

  return (
    <div>
      <h2 className="text-xl font-bold text-on-surface mb-2">{t('video.stepAudio')}</h2>
      <p className="text-sm text-outline mb-6">{t('video.audioHint')}</p>

      <div className="space-y-4">

        {/* Extract audio */}
        <div className="sd-panel p-4">
          <Toggle
            label={t('video.extractAudio')}
            icon="audio_file"
            value={config.extractAudio}
            onChange={v => set({ extractAudio: v })}
          />
          <p className="text-xs text-outline mt-1 ml-14">{t('video.extractAudioHint')}</p>
        </div>

        {/* Transcribe */}
        <div className="sd-panel p-4">
          <Toggle
            label={t('video.transcribe')}
            icon="record_voice_over"
            value={config.transcribe}
            onChange={v => set({ transcribe: v })}
          />
          <p className="text-xs text-outline mt-1 ml-14">{t('video.transcribeHint')}</p>

          {config.transcribe && (
            <div className="mt-4 ml-14 space-y-4">
              <label className="block">
                <span className="text-xs font-semibold text-outline uppercase tracking-wide">
                  {t('video.sourceLang')}
                </span>
                <select
                  value={config.sourceLanguage}
                  onChange={e => set({ sourceLanguage: e.target.value })}
                  className="sd-input px-3 py-2 text-sm mt-1"
                >
                  {SOURCE_LANGS.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </label>

              {/* Translate */}
              <div>
                <Toggle
                  label={t('video.translate')}
                  icon="translate"
                  value={config.translate}
                  onChange={v => set({ translate: v })}
                />
                {config.translate && (
                  <label className="block mt-3 ml-14">
                    <span className="text-xs font-semibold text-outline uppercase tracking-wide">
                      {t('video.targetLang')}
                    </span>
                    <select
                      value={config.targetLanguage}
                      onChange={e => set({ targetLanguage: e.target.value })}
                      className="sd-input px-3 py-2 text-sm mt-1"
                    >
                      {TARGET_LANGS.map(l => (
                        <option key={l.value} value={l.value}>{l.label}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {/* Burn subtitles */}
              <div>
                <Toggle
                  label={t('video.burnSubs')}
                  icon="subtitles"
                  value={config.burnSubtitles}
                  onChange={v => set({ burnSubtitles: v })}
                />
                <p className="text-xs text-outline mt-1 ml-14">{t('video.burnSubsHint')}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 flex justify-between">
        <button onClick={onBack} className="sd-button-secondary px-5 py-2.5 text-sm">
          ← {t('common.back')}
        </button>
        <button onClick={onNext} className="sd-button-primary px-6 py-2.5 text-sm">
          {t('common.next')} →
        </button>
      </div>
    </div>
  )
}

function Toggle({ label, icon, value, onChange }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${value ? 'bg-primary' : 'bg-outline-variant/30'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : ''}`} />
      </button>
      <span className="material-symbols-outlined text-[20px] text-primary">{icon}</span>
      <span className="font-semibold text-on-surface text-sm">{label}</span>
    </label>
  )
}
