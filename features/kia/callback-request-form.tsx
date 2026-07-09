'use client'

import { useState } from 'react'

type PreferredTime = 'anytime' | 'morning' | 'afternoon' | 'evening'

const TIME_OPTIONS: Array<{ value: PreferredTime; label: string; hint: string }> = [
  { value: 'anytime', label: 'Anytime', hint: 'Whenever suits you' },
  { value: 'morning', label: 'Morning', hint: '9 AM – 12 PM' },
  { value: 'afternoon', label: 'Afternoon', hint: '12 – 4 PM' },
  { value: 'evening', label: 'Evening', hint: '4 – 7 PM' },
]

export function CallbackRequestForm({
  token,
  customerFirstName,
  accent,
}: {
  token: string
  customerFirstName: string
  accent: string
}) {
  const [preferredTime, setPreferredTime] = useState<PreferredTime>('anytime')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function submit() {
    setStatus('submitting')
    setErrorMsg('')
    try {
      const res = await fetch(`/api/track/${encodeURIComponent(token)}/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredTime, note: note.trim() || undefined }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Could not submit your request. Please try again.')
      }
      setStatus('success')
    } catch (error) {
      setStatus('error')
      setErrorMsg(error instanceof Error ? error.message : 'Something went wrong. Please try again.')
    }
  }

  if (status === 'success') {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#16a34a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, margin: '0 auto' }}>✓</div>
        <h2 style={{ margin: '16px 0 6px', fontSize: 20, fontWeight: 800, color: '#0f172a' }}>Thanks, {customerFirstName}!</h2>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: '#64748b' }}>
          Our team has been notified and will call you back soon. You can close this page.
        </p>
      </div>
    )
  }

  const disabled = status === 'submitting'

  return (
    <div style={{ padding: '28px 24px' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .time-option-card {
          text-align: left;
          padding: 14px 16px;
          border-radius: 16px;
          border: 1.5px solid #e2e8f0;
          background: #fff;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          outline: none;
        }
        .time-option-card:hover:not(:disabled) {
          border-color: #cbd5e1;
          background: #f8fafc;
          transform: translateY(-1px);
        }
        .time-option-card.selected {
          border-color: ${accent} !important;
          background: rgba(79, 70, 229, 0.04) !important;
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.06);
        }
        .time-option-card.selected:hover:not(:disabled) {
          background: rgba(79, 70, 229, 0.06) !important;
        }
        .time-option-card:focus-visible {
          box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.25);
        }
        .textarea-field {
          width: 100%;
          box-sizing: border-box;
          padding: 14px 16px;
          border-radius: 16px;
          border: 1.5px solid #e2e8f0;
          font-size: 14px;
          font-family: inherit;
          color: #0f172a;
          resize: vertical;
          outline: none;
          background: #fff;
          transition: all 0.2s;
        }
        .textarea-field:focus {
          border-color: ${accent} !important;
          box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15);
        }
        .callback-btn {
          width: 100%;
          margin-top: 20px;
          padding: 14px 20px;
          border-radius: 16px;
          border: none;
          color: #fff;
          font-size: 15px;
          font-weight: 800;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
        }
        .callback-btn:hover:not(:disabled) {
          transform: translateY(-1.5px);
          box-shadow: 0 6px 20px rgba(79, 70, 229, 0.4);
          filter: brightness(1.05);
        }
        .callback-btn:active:not(:disabled) {
          transform: translateY(0);
        }
        @media (max-width: 480px) {
          .time-options-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}} />

      <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.6, color: '#475569' }}>
        Leave your preferred time and an optional note, and our team will call you back.
      </p>

      <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b' }}>Preferred time</p>
      <div className="time-options-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 22 }}>
        {TIME_OPTIONS.map((option) => {
          const selected = preferredTime === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setPreferredTime(option.value)}
              disabled={disabled}
              className={`time-option-card ${selected ? 'selected' : ''}`}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: selected ? accent : '#0f172a' }}>{option.label}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{option.hint}</div>
            </button>
          )
        })}
      </div>

      <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b' }}>Note <span style={{ fontWeight: 600, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></p>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value.slice(0, 500))}
        disabled={disabled}
        rows={3}
        placeholder="Anything you'd like us to know before we call?"
        className="textarea-field"
      />
      <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right', marginTop: 4 }}>{note.length}/500</div>

      {status === 'error' && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)', fontSize: 13, fontWeight: 600, color: '#ef4444' }}>
          {errorMsg}
        </div>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={disabled}
        className="callback-btn"
        style={{
          background: disabled ? '#94a3b8' : accent,
          boxShadow: disabled ? 'none' : undefined,
          cursor: disabled ? 'default' : undefined,
        }}
      >
        {disabled ? 'Sending…' : 'Request a callback'}
      </button>
    </div>
  )
}
