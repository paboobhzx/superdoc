import { useI18n } from '../../context/I18nContext'

const STEP_KEYS = ['stepUpload', 'stepOperations', 'stepAudio', 'stepReview']

export function StepBreadcrumb({ currentStep, completedUpTo, onNavigate }) {
  const { t } = useI18n()

  return (
    <nav className="flex items-center gap-1 mb-8 flex-wrap">
      {STEP_KEYS.map((key, idx) => {
        const done = idx < completedUpTo
        const active = idx === currentStep
        const reachable = idx <= completedUpTo

        return (
          <div key={key} className="flex items-center gap-1">
            {idx > 0 && (
              <span className="material-symbols-outlined text-[14px] text-outline-variant">
                chevron_right
              </span>
            )}
            <button
              type="button"
              disabled={!reachable}
              onClick={() => reachable && onNavigate(idx)}
              className={[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors',
                active
                  ? 'bg-primary text-on-primary'
                  : done
                  ? 'bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer'
                  : 'text-outline-variant cursor-default',
              ].join(' ')}
            >
              {done && !active && (
                <span className="material-symbols-outlined text-[14px]">check_circle</span>
              )}
              <span>{idx + 1}. {t(`video.${key}`)}</span>
            </button>
          </div>
        )
      })}
    </nav>
  )
}
