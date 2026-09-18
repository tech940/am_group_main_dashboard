'use client'

/**
 * A call player that other parts of the review can drive: an evidence quote or a transcript line calls
 * `seek(seconds)` and playback jumps there. The section's own players (RecordingPlayer, CompactAudioPlayer)
 * cannot seek from outside and are left untouched.
 *
 * Audio comes from the same signed-URL route the Recordings tab uses — a 5-minute link, fetched when the
 * drawer opens and re-fetched if it has expired by the time someone presses play.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Loader2, Pause, Play, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { clock } from './ai-shared'

export type AiAudioPlayerHandle = { seek: (seconds: number) => void }

type Props = {
  recordingId: string
  durationHint: number | null
  onTime?: (seconds: number) => void
}

const SPEEDS = [1, 1.25, 1.5, 2]

export const AiAudioPlayer = forwardRef<AiAudioPlayerHandle, Props>(function AiAudioPlayer({ recordingId, durationHint, onTime }, ref) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [url, setUrl] = useState<{ value: string; expires: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(durationHint ?? 0)
  const [speed, setSpeed] = useState(1)
  const pendingSeek = useRef<number | null>(null)

  const load = useCallback(async (): Promise<string | null> => {
    if (url && url.expires > Date.now() + 15_000) return url.value
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/call-analysis/am-group/recordings/${recordingId}/url`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.url) throw new Error(body.error || 'The recording could not be loaded.')
      const next = { value: String(body.url), expires: Date.now() + (Number(body.expiresInSeconds) || 300) * 1000 }
      setUrl(next)
      return next.value
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The recording could not be loaded.')
      return null
    } finally {
      setLoading(false)
    }
  }, [recordingId, url])

  // Sign once when a call is opened, so the first press of play starts at once. State is set only in the
  // fetch callback — never synchronously in the effect.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/call-analysis/am-group/recordings/${recordingId}/url`)
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (cancelled) return
        if (ok && body?.url) setUrl({ value: String(body.url), expires: Date.now() + (Number(body.expiresInSeconds) || 300) * 1000 })
        else setError(body?.error || 'The recording could not be loaded.')
      })
      .catch(() => { if (!cancelled) setError('The recording could not be loaded.') })
    return () => { cancelled = true }
  }, [recordingId])

  const play = useCallback(async (from?: number) => {
    const audio = audioRef.current
    if (!audio) return
    const src = await load()
    if (!src) return
    if (audio.src !== src) {
      audio.src = src
      pendingSeek.current = from ?? audio.currentTime ?? 0
    } else if (from !== undefined) {
      audio.currentTime = from
    }
    audio.playbackRate = speed
    await audio.play().catch(() => setError('Playback was blocked — press play again.'))
  }, [load, speed])

  useImperativeHandle(ref, () => ({ seek: (seconds: number) => { void play(Math.max(0, seconds - 0.4)) } }), [play])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) audio.pause()
    else void play()
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
      <audio
        ref={audioRef}
        preload="none"
        onLoadedMetadata={(e) => {
          const a = e.currentTarget
          if (Number.isFinite(a.duration)) setDuration(a.duration)
          if (pendingSeek.current !== null) { a.currentTime = pendingSeek.current; pendingSeek.current = null }
        }}
        onTimeUpdate={(e) => { setTime(e.currentTarget.currentTime); onTime?.(e.currentTarget.currentTime) }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => { if (url) setError('The recording could not be played.') }}
      />
      <button
        type="button"
        onClick={toggle}
        disabled={loading && !url}
        aria-label={playing ? 'Pause the call' : 'Play the call'}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#093339] text-white shadow-sm transition hover:bg-[#0b434b] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#093339]/40 focus-visible:ring-offset-2 disabled:opacity-60"
      >
        {loading && !url ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
      </button>
      <div className="flex min-w-[160px] flex-1 items-center gap-2">
        <span className="w-10 text-right text-[11px] font-bold tabular-nums text-slate-500">{clock(time)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(1, duration)}
          step={0.1}
          value={Math.min(time, duration || time)}
          onChange={(e) => {
            const next = Number(e.target.value)
            setTime(next)
            if (audioRef.current) audioRef.current.currentTime = next
          }}
          aria-label="Position in the call"
          className="h-1.5 flex-1 cursor-pointer accent-[#093339]"
        />
        <span className="w-10 text-[11px] font-bold tabular-nums text-slate-400">{clock(duration)}</span>
      </div>
      <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setSpeed(s); if (audioRef.current) audioRef.current.playbackRate = s }}
            className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-black tabular-nums transition', speed === s ? 'bg-[#093339] text-white' : 'text-slate-500 hover:bg-slate-200')}
            aria-pressed={speed === s}
          >
            {s}×
          </button>
        ))}
      </div>
      {error && (
        <p className="flex w-full items-center gap-2 text-[11px] font-semibold text-rose-600">
          {error}
          <button type="button" onClick={() => { setUrl(null); void load() }} className="inline-flex items-center gap-1 font-bold underline">
            <RotateCcw className="h-3 w-3" /> Retry
          </button>
        </p>
      )}
    </div>
  )
})
