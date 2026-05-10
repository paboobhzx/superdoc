import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../../context/I18nContext'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../lib/api'
import { StepBreadcrumb } from '../../components/VideoWizard/StepBreadcrumb'
import { UploadStep } from './steps/UploadStep'
import { OperationsStep } from './steps/OperationsStep'
import { AudioTranscriptStep } from './steps/AudioTranscriptStep'
import { ReviewStep } from './steps/ReviewStep'

const TOTAL_STEPS = 4

const DEFAULT_AUDIO_CONFIG = {
  extractAudio: false,
  transcribe: false,
  sourceLanguage: 'auto',
  translate: false,
  targetLanguage: 'pt',
  burnSubtitles: false,
}

export function VideoWizard() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const auth = useAuth()

  const [step, setStep] = useState(0)
  const [completedUpTo, setCompletedUpTo] = useState(0)
  const [file, setFile] = useState(null)
  const [ops, setOps] = useState([])
  const [audioConfig, setAudioConfig] = useState({ ...DEFAULT_AUDIO_CONFIG })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function advance(to) {
    const next = to ?? step + 1
    setStep(next)
    setCompletedUpTo(prev => Math.max(prev, next))
  }

  function goTo(idx) {
    if (idx <= completedUpTo) setStep(idx)
  }

  async function handleSubmit() {
    if (!file) return
    setSubmitting(true)
    setError('')

    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'mp4'
      const params = {
        video_ops: ops,
        extract_audio: audioConfig.extractAudio,
        transcribe: audioConfig.transcribe,
        source_language: audioConfig.sourceLanguage,
        translate: audioConfig.translate,
        target_language: audioConfig.targetLanguage,
        burn_subtitles: audioConfig.burnSubtitles,
      }

      const createFn = auth?.isAuthenticated ? api.createUserJob : api.createJob
      const jobResp = await createFn({
        operation: 'video_process',
        file_name: file.name,
        file_size_bytes: file.size,
        params,
      })

      const jobId = jobResp.job_id
      const upload = jobResp.upload

      await api.uploadToS3(upload, file)
      await api.triggerProcess(jobId)

      navigate(`/processing/${jobId}`, {
        state: { sessionId: jobResp.session_id }
      })
    } catch (err) {
      setError(err.message || t('common.errorGeneric'))
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <p className="text-xs font-bold uppercase tracking-widest text-primary mb-1">
          {t('video.title')}
        </p>
        <h1 className="text-3xl font-bold font-headline text-on-surface">
          {t('video.headline')}
        </h1>
      </div>

      <StepBreadcrumb
        currentStep={step}
        completedUpTo={completedUpTo}
        onNavigate={goTo}
      />

      {error && (
        <div className="mb-4 px-4 py-3 rounded-[var(--radius-md)] bg-error-container text-on-error-container text-sm">
          {error}
        </div>
      )}

      {step === 0 && (
        <UploadStep
          file={file}
          onFile={setFile}
          onNext={() => advance(1)}
        />
      )}

      {step === 1 && (
        <OperationsStep
          ops={ops}
          onChange={setOps}
          onBack={() => setStep(0)}
          onNext={() => advance(2)}
        />
      )}

      {step === 2 && (
        <AudioTranscriptStep
          config={audioConfig}
          onChange={setAudioConfig}
          onBack={() => setStep(1)}
          onNext={() => advance(3)}
        />
      )}

      {step === 3 && (
        <ReviewStep
          file={file}
          ops={ops}
          audioConfig={audioConfig}
          submitting={submitting}
          onBack={() => setStep(2)}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  )
}
