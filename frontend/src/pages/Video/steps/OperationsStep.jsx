import { useState } from 'react'
import { useI18n } from '../../../context/I18nContext'

const PRESETS = [
  { label: '1080p', w: 1920, h: 1080 },
  { label: '720p',  w: 1280, h: 720  },
  { label: '480p',  w: 854,  h: 480  },
]

const SPEED_OPTIONS = [
  { label: '0.5×', value: 0.5 },
  { label: '0.75×', value: 0.75 },
  { label: '1×', value: 1.0 },
  { label: '1.25×', value: 1.25 },
  { label: '1.5×', value: 1.5 },
  { label: '2×', value: 2.0 },
]

const FORMAT_OPTIONS = ['mp4', 'mov', 'webm', 'mkv', 'avi']

export function OperationsStep({ ops, onChange, onBack, onNext }) {
  const { t } = useI18n()

  function hasOp(type) { return ops.some(o => o.type === type) }
  function getOp(type) { return ops.find(o => o.type === type) || {} }

  function toggleOp(type, defaults = {}) {
    if (hasOp(type)) {
      onChange(ops.filter(o => o.type !== type))
    } else {
      onChange([...ops, { type, ...defaults }])
    }
  }

  function updateOp(type, patch) {
    onChange(ops.map(o => o.type === type ? { ...o, ...patch } : o))
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-on-surface mb-2">{t('video.stepOperations')}</h2>
      <p className="text-sm text-outline mb-6">{t('video.opsHint')}</p>

      <div className="space-y-4">

        {/* Trim */}
        <OpCard
          label={t('video.ops.trim')}
          icon="content_cut"
          active={hasOp('trim')}
          onToggle={() => toggleOp('trim', { start: 0, end: '' })}
        >
          {hasOp('trim') && (
            <div className="flex gap-3 mt-3">
              <label className="flex-1">
                <span className="text-xs text-outline">{t('video.trimStart')}</span>
                <input type="number" min="0" step="0.1"
                  value={getOp('trim').start ?? 0}
                  onChange={e => updateOp('trim', { start: parseFloat(e.target.value) || 0 })}
                  className="sd-input px-3 py-2 text-sm mt-1" placeholder="0" />
              </label>
              <label className="flex-1">
                <span className="text-xs text-outline">{t('video.trimEnd')}</span>
                <input type="number" min="0" step="0.1"
                  value={getOp('trim').end ?? ''}
                  onChange={e => updateOp('trim', { end: parseFloat(e.target.value) || '' })}
                  className="sd-input px-3 py-2 text-sm mt-1" placeholder={t('video.trimEndHint')} />
              </label>
            </div>
          )}
        </OpCard>

        {/* Resize */}
        <OpCard
          label={t('video.ops.resize')}
          icon="aspect_ratio"
          active={hasOp('resize')}
          onToggle={() => toggleOp('resize', { w: 1280, h: 720 })}
        >
          {hasOp('resize') && (
            <div className="mt-3">
              <div className="flex gap-2 mb-2">
                {PRESETS.map(p => (
                  <button key={p.label} type="button"
                    onClick={() => updateOp('resize', { w: p.w, h: p.h })}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      getOp('resize').w === p.w ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant hover:border-primary'
                    }`}
                  >{p.label}</button>
                ))}
              </div>
              <div className="flex gap-3">
                <label className="flex-1">
                  <span className="text-xs text-outline">W</span>
                  <input type="number" min="1"
                    value={getOp('resize').w ?? 1280}
                    onChange={e => updateOp('resize', { w: parseInt(e.target.value) || 1280 })}
                    className="sd-input px-3 py-2 text-sm mt-1" />
                </label>
                <label className="flex-1">
                  <span className="text-xs text-outline">H</span>
                  <input type="number" min="1"
                    value={getOp('resize').h ?? 720}
                    onChange={e => updateOp('resize', { h: parseInt(e.target.value) || 720 })}
                    className="sd-input px-3 py-2 text-sm mt-1" />
                </label>
              </div>
            </div>
          )}
        </OpCard>

        {/* Speed */}
        <OpCard
          label={t('video.ops.speed')}
          icon="speed"
          active={hasOp('speed')}
          onToggle={() => toggleOp('speed', { speed: 1.0 })}
        >
          {hasOp('speed') && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {SPEED_OPTIONS.map(s => (
                <button key={s.value} type="button"
                  onClick={() => updateOp('speed', { speed: s.value })}
                  className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                    getOp('speed').speed === s.value ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant hover:border-primary'
                  }`}
                >{s.label}</button>
              ))}
            </div>
          )}
        </OpCard>

        {/* Format convert */}
        <OpCard
          label={t('video.ops.format')}
          icon="swap_horiz"
          active={hasOp('format_convert')}
          onToggle={() => toggleOp('format_convert', { format: 'mp4' })}
        >
          {hasOp('format_convert') && (
            <select
              value={getOp('format_convert').format ?? 'mp4'}
              onChange={e => updateOp('format_convert', { format: e.target.value })}
              className="sd-input px-3 py-2 text-sm mt-3"
            >
              {FORMAT_OPTIONS.map(f => (
                <option key={f} value={f}>{f.toUpperCase()}</option>
              ))}
            </select>
          )}
        </OpCard>

        {/* Extract frame */}
        <OpCard
          label={t('video.ops.frame')}
          icon="photo_camera"
          active={hasOp('extract_frame')}
          onToggle={() => toggleOp('extract_frame', { timestamp: 0 })}
        >
          {hasOp('extract_frame') && (
            <label className="block mt-3">
              <span className="text-xs text-outline">{t('video.frameTimestamp')}</span>
              <input type="number" min="0" step="0.1"
                value={getOp('extract_frame').timestamp ?? 0}
                onChange={e => updateOp('extract_frame', { timestamp: parseFloat(e.target.value) || 0 })}
                className="sd-input px-3 py-2 text-sm mt-1" placeholder="0" />
            </label>
          )}
        </OpCard>
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

function OpCard({ label, icon, active, onToggle, children }) {
  return (
    <div className={`sd-panel p-4 transition-colors ${active ? 'border-primary/40' : ''}`}>
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <button
          type="button"
          onClick={onToggle}
          className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${active ? 'bg-primary' : 'bg-outline-variant/30'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-5' : ''}`} />
        </button>
        <span className="material-symbols-outlined text-[20px] text-primary">{icon}</span>
        <span className="font-semibold text-on-surface text-sm">{label}</span>
      </label>
      {children}
    </div>
  )
}
