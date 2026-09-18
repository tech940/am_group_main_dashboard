'use client'

/**
 * One call, reviewed. Built so the MD can decide in seconds whether he needs to listen:
 *   verdict + headline → what the customer wanted → what was promised → the evidence (click to hear it)
 *   → the transcript, following the audio → "is this verdict right?".
 */
import React, { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, CheckCircle2, Flag, Loader2, MessageSquareQuote, PhoneIncoming, PhoneOutgoing, Play, RefreshCw,
  ThumbsDown, ThumbsUp, UserRound,
} from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  INTENT_LABELS,
  MOOD_LABELS,
  RED_FLAG_LABELS,
  SKIP_REASON_LABELS,
  VERDICT_LABELS,
  VERDICTS,
  type ReviewDetail,
  type Verdict,
} from '@/lib/call-ai/types'
import { AiAudioPlayer, type AiAudioPlayerHandle } from './ai-audio-player'
import { callTime, clock, dueLabel, effectiveVerdict, fetchJson, MOOD_TONE, PendingChip, VerdictChip } from './ai-shared'

type Props = {
  reviewId: string | null
  onClose: () => void
  isAdmin: boolean
  today: string
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2', className)}>
      <h3 className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{title}</h3>
      {children}
    </section>
  )
}

function Fact({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={cn('mt-0.5 text-xs font-bold text-slate-800', tone)}>{value}</p>
    </div>
  )
}

export function AiReviewDrawer({ reviewId, onClose, isAdmin, today }: Props) {
  const open = Boolean(reviewId)
  const queryClient = useQueryClient()
  const player = useRef<AiAudioPlayerHandle>(null)
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [now, setNow] = useState(0)
  const [feedbackMode, setFeedbackMode] = useState<'idle' | 'wrong'>('idle')
  const [corrected, setCorrected] = useState<Verdict | ''>('')
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const detail = useQuery<ReviewDetail>({
    queryKey: ['call-ai-review', reviewId],
    enabled: open,
    staleTime: 30 * 1000,
    queryFn: () => fetchJson<ReviewDetail>(`/api/call-analysis/ai/reviews/${reviewId}`),
  })
  const r = detail.data
  const a = r?.analysis ?? null
  const verdict = r ? effectiveVerdict(r) : null

  // Voice labels (S1, S2 …) from the transcriber, named by the verdict: which voice is staff, which the customer.
  const roleOf = new Map((a?.speakers ?? []).map((s) => [s.label, s.role]))
  const speakerChip = (label: string) => {
    const role = roleOf.get(label)
    if (role === 'staff') return { text: 'Staff', tone: 'bg-teal-50 text-[#093339] border-teal-200' }
    if (role === 'customer') return { text: 'Customer', tone: 'bg-amber-50 text-amber-800 border-amber-200' }
    return { text: label, tone: 'bg-slate-50 text-slate-500 border-slate-200' }
  }

  // The line being heard: the last one that has started. A few hundred lines at most — no memo needed.
  let activeLine = -1
  if (now > 0) r?.segments?.forEach((seg, index) => { if (now >= seg.s - 0.2) activeLine = index })

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['call-ai-review', reviewId] })
    void queryClient.invalidateQueries({ queryKey: ['call-ai-reviews'] })
    void queryClient.invalidateQueries({ queryKey: ['call-ai-verdicts'] })
  }

  const feedback = useMutation({
    mutationFn: (body: { verdictOk: boolean; correctedVerdict?: Verdict | null; note?: string | null }) =>
      fetchJson(`/api/call-analysis/ai/reviews/${reviewId}/feedback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    onSuccess: (_data, body) => {
      setFeedbackMode('idle')
      setCorrected('')
      setNote('')
      setNotice(body.verdictOk ? 'Thanks — marked as right.' : 'Saved. Your verdict now shows instead of the AI\'s.')
      refreshAll()
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Could not save.'),
  })

  const reanalyse = useMutation({
    mutationFn: (retranscribe: boolean) =>
      fetchJson(`/api/call-analysis/ai/reviews/${reviewId}/reanalyse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retranscribe }) }),
    onSuccess: () => { setNotice('Queued — the new review appears within about 10 minutes.'); refreshAll() },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Could not queue the call.'),
  })

  const seekTo = (seconds: number, line?: number) => {
    player.current?.seek(seconds)
    if (line !== undefined) lineRefs.current[line]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const close = () => {
    setFeedbackMode('idle')
    setNotice(null)
    setNow(0)
    onClose()
  }

  const customerName = r?.customer?.name || r?.customer?.notACustomer || 'Unknown caller'
  const due = (date: string | null) => dueLabel(date, today)

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close() }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-5xl gap-0 p-0 sm:rounded-3xl">
        {detail.isLoading || !r ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 text-xs font-bold text-slate-400">
            {detail.isError ? (
              <>
                <AlertTriangle className="h-5 w-5 text-rose-500" />
                <span className="text-rose-600">{detail.error instanceof Error ? detail.error.message : 'Could not load this review.'}</span>
              </>
            ) : (
              <><Loader2 className="h-5 w-5 animate-spin text-[#093339]" />Loading the review…</>
            )}
            <DialogTitle className="sr-only">AI call review</DialogTitle>
            <DialogDescription className="sr-only">Loading</DialogDescription>
          </div>
        ) : (
          <>
            {/* Header: the verdict and who the call was with */}
            <header className="space-y-3 border-b border-slate-100 px-6 pb-4 pt-6 pr-14">
              <div className="flex flex-wrap items-center gap-2">
                {r.status === 'done' && verdict ? <VerdictChip verdict={verdict} corrected={Boolean(r.overrideVerdict)} /> : <PendingChip row={r} />}
                {r.overrideVerdict && r.verdict && r.overrideVerdict !== r.verdict && (
                  <span className="text-[11px] font-semibold text-slate-400">AI said: {VERDICT_LABELS[r.verdict]}</span>
                )}
                {a?.needs_human_review && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                    <AlertTriangle className="h-3 w-3" /> Listen to be sure
                  </span>
                )}
              </div>
              <DialogTitle className="text-lg font-black leading-snug tracking-tight text-slate-900 [text-wrap:balance]">
                {r.headline || (r.status === 'skipped' ? SKIP_REASON_LABELS[r.skipReason ?? ''] ?? 'Not reviewed' : 'Review in progress')}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
                  <span className="inline-flex items-center gap-1 font-bold text-slate-800"><UserRound className="h-3.5 w-3.5 text-slate-400" />{customerName}</span>
                  {r.customer?.phone && <span className="tabular-nums">{r.customer.phone}</span>}
                  {r.customer?.sourceLabel && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{r.customer.sourceLabel}</span>}
                  <span className="text-slate-300">·</span>
                  <span className="inline-flex items-center gap-1">
                    {r.callType === 'incoming' ? <PhoneIncoming className="h-3.5 w-3.5 text-green-600" /> : <PhoneOutgoing className="h-3.5 w-3.5 text-[#093339]" />}
                    {r.callType === 'incoming' ? 'Customer called' : 'We called'} · {clock(r.durationSeconds)}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span>{callTime(r.recordedAt)}</span>
                  <span className="text-slate-300">·</span>
                  <span>{[r.creName, r.team].filter(Boolean).join(' · ')}</span>
                </div>
              </DialogDescription>
              <AiAudioPlayer ref={player} recordingId={r.recordingId} durationHint={r.durationSeconds} onTime={setNow} />
            </header>

            <div className="grid gap-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
              {/* The verdict, explained */}
              <div className="space-y-5 border-slate-100 px-6 py-5 lg:border-r">
                {r.status !== 'done' || !a ? (
                  <p className="text-sm font-medium text-slate-500">
                    {r.status === 'skipped' ? `${SKIP_REASON_LABELS[r.skipReason ?? ''] ?? 'Skipped'} — nothing to review.` : r.status === 'failed' ? `The AI could not review this call${r.lastError ? `: ${r.lastError}` : '.'}` : 'The AI is still reviewing this call. It usually takes a few minutes after the recording uploads.'}
                  </p>
                ) : a.conversation !== 'customer_call' ? (
                  <p className="text-sm font-medium text-slate-500">
                    Not a customer conversation ({a.conversation.replace(/_/g, ' ')}).
                    {(a.conversation === 'personal' || a.conversation === 'internal_staff') && ' The transcript was discarded for privacy.'}
                  </p>
                ) : (
                  <>
                    {a.customer_wanted && (
                      <Section title="What the customer wanted">
                        <p className="text-[15px] font-semibold leading-relaxed text-slate-900">{a.customer_wanted}</p>
                      </Section>
                    )}
                    {a.summary_en && (
                      <Section title="What happened">
                        <p className="text-sm leading-relaxed text-slate-600">{a.summary_en}</p>
                      </Section>
                    )}

                    {(a.commitments.length > 0 || a.next_action.needed) && (
                      <Section title="Promises and next step">
                        <ul className="space-y-1.5">
                          {a.commitments.map((c, i) => {
                            const chip = due(c.due)
                            return (
                              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                                <span className={cn('mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase', c.by === 'dealer' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500')}>{c.by === 'dealer' ? 'We promised' : 'Customer'}</span>
                                <span className="flex-1">{c.what}</span>
                                {chip && <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', chip.tone)}>{chip.text}</span>}
                              </li>
                            )
                          })}
                          {a.next_action.needed && a.next_action.what && (
                            <li className="flex items-start gap-2 text-sm text-slate-700">
                              <span className="mt-0.5 shrink-0 rounded-md bg-[#093339] px-1.5 py-0.5 text-[10px] font-black uppercase text-white">Next</span>
                              <span className="flex-1">{a.next_action.what}{a.next_action.owner ? <span className="text-slate-400"> — {a.next_action.owner}</span> : null}</span>
                              {due(a.next_action.due) && <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', due(a.next_action.due)!.tone)}>{due(a.next_action.due)!.text}</span>}
                            </li>
                          )}
                        </ul>
                      </Section>
                    )}

                    {a.evidence.length > 0 && (
                      <Section title="Why — hear it yourself">
                        <ul className="space-y-2">
                          {a.evidence.map((e, i) => {
                            const seg = r.segments?.[e.segment]
                            return (
                              <li key={i}>
                                <button
                                  type="button"
                                  disabled={!seg}
                                  onClick={() => seg && seekTo(seg.s, e.segment)}
                                  className="group flex w-full items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-[#093339]/40 hover:bg-teal-50/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#093339]/40 disabled:cursor-default"
                                >
                                  <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-[#093339]" />
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-semibold text-slate-800">“{e.quote}”</span>
                                    <span className="block text-xs text-slate-500">{e.meaning_en.trim().toLowerCase() === e.quote.trim().toLowerCase() ? '' : `${e.meaning_en} `}<span className="text-slate-400">— {e.speaker_guess === 'dealer' ? 'staff' : e.speaker_guess === 'customer' ? 'customer' : 'speaker unclear'}</span></span>
                                  </span>
                                  {seg && <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-black tabular-nums text-slate-500 group-hover:bg-[#093339] group-hover:text-white"><Play className="h-2.5 w-2.5" aria-hidden />{clock(seg.s)}</span>}
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      </Section>
                    )}

                    {a.red_flags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {a.red_flags.map((flag) => (
                          <span key={flag} className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                            <Flag className="h-3 w-3" />{RED_FLAG_LABELS[flag]}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Fact label="Purpose" value={INTENT_LABELS[a.intent]} />
                      <Fact label="Ended" value={`${MOOD_LABELS[a.mood_end]}${a.satisfaction ? ` · ${a.satisfaction}/5` : ''}`} tone={MOOD_TONE[a.mood_end]} />
                      <Fact label="Lead" value={a.lead.temperature === 'none' ? 'Not a sale' : `${a.lead.temperature[0].toUpperCase()}${a.lead.temperature.slice(1)}${a.lead.models.length ? ` · ${a.lead.models.join(', ')}` : ''}`} tone={a.lead.temperature === 'hot' ? 'text-emerald-700' : undefined} />
                      {a.complaint.is_complaint && <Fact label="Complaint" value={`${a.complaint.about ?? 'Yes'}${a.complaint.severity ? ` · ${a.complaint.severity}` : ''}`} tone="text-rose-700" />}
                      {a.lead.exchange_vehicle && <Fact label="Exchange" value={a.lead.exchange_vehicle} />}
                      {a.staff_handling.score && <Fact label="Staff handling (AI's view)" value={`${a.staff_handling.score}/5${a.staff_handling.notes ? ` — ${a.staff_handling.notes}` : ''}`} />}
                    </div>
                  </>
                )}
              </div>

              {/* The transcript, following the audio */}
              <div className="px-6 py-5">
                <Section title={r.sttLanguage === 'translated-en' ? 'Transcript · English translation (machine)' : `Transcript${r.sttLanguage ? ` · ${r.sttLanguage}` : ''}`}>
                  {r.segments && r.segments.length > 0 ? (
                    <ol className="max-h-[420px] space-y-0.5 overflow-y-auto pr-1">
                      {r.segments.map((seg, i) => (
                        <li key={i}>
                          <button
                            ref={(el) => { lineRefs.current[i] = el }}
                            type="button"
                            onClick={() => seekTo(seg.s)}
                            className={cn(
                              'flex w-full gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm leading-relaxed transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#093339]/40',
                              i === activeLine ? 'bg-teal-50 text-slate-900' : 'text-slate-700 hover:bg-slate-50',
                              seg.f && 'text-slate-400',
                            )}
                            aria-label={`Play from ${clock(seg.s)}`}
                          >
                            <span className={cn('w-9 shrink-0 pt-0.5 text-[10px] font-black tabular-nums', i === activeLine ? 'text-[#093339]' : 'text-slate-300')}>{clock(seg.s)}</span>
                            <span className="min-w-0 flex-1 break-words">
                              {seg.p && (
                                <span className={cn('mr-1.5 inline-flex rounded-md border px-1.5 py-px align-[1px] text-[9px] font-black uppercase tracking-wide', speakerChip(seg.p).tone)}>
                                  {speakerChip(seg.p).text}
                                </span>
                              )}
                              {seg.t}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-slate-400">No transcript is kept for this call.</p>
                  )}
                  {r.segments?.some((s) => s.f) && <p className="pt-1 text-[10px] font-semibold text-slate-400">Faded lines: the speech recogniser was unsure — listen to them.</p>}
                  {r.sttLanguage === 'translated-en' && <p className="pt-1 text-[10px] font-semibold text-slate-400">Translated from the spoken language by the speech recogniser — the recording is the record.</p>}
                </Section>
              </div>
            </div>

            {/* Is this right? */}
            <footer className="space-y-3 border-t border-slate-100 bg-slate-50/50 px-6 py-4 sm:rounded-b-3xl">
              {r.status === 'done' && (
                feedbackMode === 'idle' ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-xs font-bold text-slate-600">Is this verdict right?</span>
                    <button type="button" disabled={feedback.isPending} onClick={() => feedback.mutate({ verdictOk: true })}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-green-300 hover:text-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#093339]/40">
                      <ThumbsUp className="h-3.5 w-3.5" /> Right
                    </button>
                    <button type="button" onClick={() => { setFeedbackMode('wrong'); setNotice(null) }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-rose-300 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#093339]/40">
                      <ThumbsDown className="h-3.5 w-3.5" /> Wrong
                    </button>
                    {isAdmin && (
                      <span className="ml-auto flex gap-2">
                        <button type="button" disabled={reanalyse.isPending} onClick={() => reanalyse.mutate(false)}
                          className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] font-bold text-slate-500 transition hover:bg-white hover:text-slate-800">
                          <RefreshCw className={cn('h-3.5 w-3.5', reanalyse.isPending && 'animate-spin')} /> Review again
                        </button>
                      </span>
                    )}
                  </div>
                ) : (
                  <form
                    className="flex flex-col gap-2 sm:flex-row sm:items-end"
                    onSubmit={(e) => { e.preventDefault(); feedback.mutate({ verdictOk: false, correctedVerdict: corrected || null, note: note.trim() || null }) }}
                  >
                    <label className="flex flex-col gap-1 text-[11px] font-bold text-slate-500">
                      The right verdict
                      <select value={corrected} onChange={(e) => setCorrected(e.target.value as Verdict | '')}
                        className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#093339]/40">
                        <option value="">Choose…</option>
                        {VERDICTS.map((v) => <option key={v} value={v}>{VERDICT_LABELS[v]}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-1 flex-col gap-1 text-[11px] font-bold text-slate-500">
                      What did it get wrong? (optional)
                      <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} placeholder="e.g. customer was happy, only asked for the bill"
                        className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#093339]/40" />
                    </label>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setFeedbackMode('idle')} className="h-9 rounded-xl px-3 text-xs font-bold text-slate-500 hover:bg-white">Cancel</button>
                      <button type="submit" disabled={feedback.isPending || (!corrected && !note.trim())}
                        className="h-9 rounded-xl bg-[#093339] px-4 text-xs font-bold text-white transition hover:bg-[#0b434b] disabled:opacity-50">
                        {feedback.isPending ? 'Saving…' : 'Save correction'}
                      </button>
                    </div>
                  </form>
                )
              )}
              {r.status === 'failed' && isAdmin && (
                <button type="button" disabled={reanalyse.isPending} onClick={() => reanalyse.mutate(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#093339] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">
                  <RefreshCw className="h-3.5 w-3.5" /> Try again
                </button>
              )}
              {notice && <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><CheckCircle2 className="h-3.5 w-3.5 text-[#093339]" />{notice}</p>}
              {r.feedback.length > 0 && (
                <ul className="space-y-0.5 text-[11px] text-slate-500">
                  {r.feedback.slice(0, 3).map((f) => (
                    <li key={f.id}>
                      <span className="font-bold text-slate-600">{f.userName || 'Someone'}</span> marked it {f.verdictOk ? 'right' : `wrong${f.correctedVerdict ? ` → ${VERDICT_LABELS[f.correctedVerdict]}` : ''}`}
                      {f.note ? ` — “${f.note}”` : ''} · {callTime(f.createdAt)}
                    </li>
                  ))}
                </ul>
              )}
              {a && (
                <p className="text-[10px] font-medium text-slate-400">
                  Written by AI from the recording{r.analysedAt ? ` · ${callTime(r.analysedAt)}` : ''} · confidence {Math.round(a.confidence * 100)}%. Verdicts can be wrong — the recording is the record.
                </p>
              )}
            </footer>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
