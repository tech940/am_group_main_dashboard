'use client'

import { useQuery } from '@tanstack/react-query'
import { Loader2, Radio, RefreshCw } from 'lucide-react'
import { formatIndiaDateTime } from '@/lib/date-time'
import { JourneyMap, type JourneySegment } from './journey-map'

/**
 * Where a car that is STILL OUT has been since it left the gate.
 *
 * The finished-drive route is written by a background sweep that only runs once a pass has RETURNED,
 * because it exists to check the odometer a guard typed at gate-in. That left the one moment somebody
 * actually wants a map — the car is out NOW — showing "not checked". This fills it.
 *
 * ⚠️ REFETCHED ON A TIMER, NOT CONTINUOUSLY. The provider's account allows 20 requests per window,
 * shared with the position poll and the nightly trip sweep, and a route costs one call per day of the
 * drive. The server caches each answer for two minutes; this asks every two minutes to match, so a
 * screen left open on a wall costs about 30 calls an hour rather than thousands.
 *
 * ⚠️ THE AS-OF TIME IS ALWAYS SHOWN. "Live" here means "as of a minute ago", and a map that implies
 * otherwise is the same lie the fleet map's freshness bands exist to prevent.
 */

type LiveRoute = {
  status: 'ok' | 'not_out' | 'untracked' | 'not_configured' | 'too_long' | 'rate_limited' | 'unavailable'
  detail: string | null
  segments: JourneySegment[]
  movingSeconds: number | null
  stoppedSeconds: number | null
  stopCount: number | null
  windowStart: string | null
  asOf: string
}

function duration(seconds: number | null): string {
  if (seconds === null) return '—'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function LiveRoutePanel({ passId }: { passId: string }) {
  const { data, isLoading, isFetching, refetch } = useQuery<LiveRoute>({
    queryKey: ['gate-pass-live-route', passId],
    queryFn: async () => {
      /* no-store: the session fetch cache would hold this for 30 minutes — see query-provider.tsx. */
      const res = await fetch(`/api/gate-pass/${passId}/live-route`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Could not follow this car right now.')
      return res.json()
    },
    refetchInterval: 120_000,
    staleTime: 110_000,
  })

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
        <p className="mt-2 text-[11px] font-medium text-slate-500">Following the car…</p>
      </div>
    )
  }

  if (!data) return null

  /* Every non-ok status has a sentence of its own — none of them is a blank map. */
  if (data.status !== 'ok') {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-[11px] font-medium text-slate-500">
          {data.detail || 'No live route is available for this car.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-3 py-2"
        style={{ borderColor: '#bfdbfe', backgroundColor: '#eff6ff' }}>
        <span className="inline-flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide"
          style={{ color: '#1d4ed8' }}>
          <Radio className="h-3.5 w-3.5" /> Out on the road now
        </span>
        <span className="text-[11px] text-slate-600">
          Moving {duration(data.movingSeconds)} · stopped {duration(data.stoppedSeconds)}
          {data.stopCount !== null ? ` · ${data.stopCount} ${data.stopCount === 1 ? 'stop' : 'stops'}` : ''}
        </span>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
          {/* Said plainly: this is the last report, not a live feed. */}
          As of {formatIndiaDateTime(data.asOf)}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex h-6 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={isFetching ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
            Refresh
          </button>
        </span>
      </div>

      {/* The same component the finished drives use — one map, one set of rules about honesty. */}
      <JourneyMap segments={data.segments} />
    </div>
  )
}
