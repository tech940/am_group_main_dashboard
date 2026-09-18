import 'server-only'

import { mapWithConcurrency } from '@/lib/db/concurrency'
import { analyseTranscript, type ChatFn } from './analyse'
import { callAiConfig, llmCostUsd, PROMPT_VERSION, sttCostUsd } from './config'
import { DownloadError, supabaseCreSource, type CreRecording, type CreSource } from './cre-source'
import { discover, istToday, type DiscoveryStats } from './discovery'
import { AiProviderError } from './errors'
import type { WhisperResult } from './groq'
import { sttPrompt, TRANSLATED_EN } from './prompt'
import { providerChat, providerTranscribe } from './providers'
import {
  addAudioSeconds,
  claimJobs,
  completeDone,
  completeSkipped,
  markFailed,
  readState,
  requeue,
  saveTranscript,
  writeState,
  type ClaimedJob,
} from './queue'
import { contentTypeFor, filterSegments, sniffAudio } from './stt-filter'
import type { Segment } from './types'

/**
 * One run of the AI Call Review pipeline: discover new recordings, then transcribe and review as many queued
 * ones as fit before the deadline. Called by the cron route every 10 minutes and by the backfill script.
 *
 * The CRE source and both Groq calls are injected, so scripts/verify-call-ai.ts runs this exact code against a
 * fake handset project and a fake Groq with the real database (inside a rolled-back transaction).
 */

export type TranscribeFn = (input: {
  audio: Uint8Array
  fileName: string
  contentType: string
  model: string
  language?: string | null
  prompt?: string | null
  task?: 'transcribe' | 'translate'
  timeoutMs: number
}) => Promise<WhisperResult>

export type WorkerDeps = {
  source: CreSource
  transcribe: TranscribeFn
  chat: ChatFn
  now?: () => Date
  /** Injectable so tests do not really wait out a rate limit. */
  sleep?: (ms: number) => Promise<void>
}

/** Retry-afters up to this are per-minute limits: the run waits and continues instead of pausing the pipeline. */
const SHORT_RATE_LIMIT_SECONDS = 60
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function defaultDeps(): WorkerDeps {
  return {
    source: supabaseCreSource(),
    transcribe: providerTranscribe(),
    chat: providerChat(),
  }
}

export type RunStats = {
  startedAt: string
  ms: number
  discovery: DiscoveryStats | null
  discoveryError: string | null
  claimed: number
  done: number
  skipped: number
  failed: number
  requeued: number
  rateLimited: boolean
  audioSeconds: number
  costUsd: number
  stoppedBecause: 'drained' | 'deadline' | 'rate_limited' | 'audio_cap' | 'disabled' | 'config_error'
  errors: string[]
}

type JobOutcome = { kind: 'done' | 'skipped' | 'failed' | 'requeued' | 'rate_limited' | 'config'; audioSeconds: number; costUsd: number; error?: string; retryAfter?: number }

/** 5 min, 10 min, 20 min … for a job that hit a transient error. */
function backoffSeconds(attempts: number): number {
  return Math.min(6 * 3600, 300 * 2 ** Math.max(0, attempts - 1))
}

async function processJob(job: ClaimedJob, rec: CreRecording | undefined, signedUrl: string | undefined, deps: WorkerDeps): Promise<JobOutcome> {
  const cfg = callAiConfig()
  let audioSeconds = 0
  let costUsd = 0

  try {
    if (job.attempts > cfg.maxAttempts) {
      await markFailed(job.id, job.lockToken, `Gave up after ${cfg.maxAttempts} attempts`)
      return { kind: 'failed', audioSeconds, costUsd, error: 'max attempts' }
    }
    if (!rec || rec.deleted_at) {
      await completeSkipped(job.id, job.lockToken, 'recording_deleted')
      return { kind: 'skipped', audioSeconds, costUsd }
    }

    // ── Phase 1: speech to text (skipped when an earlier attempt already saved the transcript) ──
    let segments: Segment[] | null = job.segments
    let sttLanguage = job.sttLanguage
    if (!segments) {
      if (rec.upload_status !== 'uploaded' || !rec.storage_path || !signedUrl) {
        await completeSkipped(job.id, job.lockToken, 'audio_missing')
        return { kind: 'skipped', audioSeconds, costUsd }
      }
      const audio = await deps.source.download(signedUrl, cfg.maxAudioBytes, cfg.timeouts.downloadMs)
      const container = sniffAudio(audio)
      if (!container) {
        await completeSkipped(job.id, job.lockToken, 'audio_missing')
        return { kind: 'skipped', audioSeconds, costUsd, error: 'not an audio file' }
      }
      const ext = container === 'm4a' ? 'm4a' : container
      // Whisper-only knobs: a prompt and the translate task. Scribe takes neither.
      const groq = cfg.sttProvider === 'groq'
      const prompt = groq ? sttPrompt() : null
      const whisper = await deps.transcribe({
        audio,
        // The recording id, never the handset's file name — that embeds the customer's number.
        fileName: `${job.creRecordingId}.${ext}`,
        contentType: contentTypeFor(ext),
        model: cfg.sttModel,
        language: cfg.sttLanguage,
        task: groq ? cfg.sttMode : undefined,
        prompt: prompt,
        timeoutMs: cfg.timeouts.sttMs,
      })
      audioSeconds = Math.max(whisper.duration, Number(job.durationSeconds) || 0)
      const billed = groq ? Math.max(10, audioSeconds) : audioSeconds
      const sttCost = sttCostUsd(cfg.sttModel, audioSeconds)
      costUsd += sttCost
      const filtered = filterSegments(whisper.segments, { prompt })
      // A translated transcript is English whatever was spoken; say so, so the UI and the model know.
      sttLanguage = groq && cfg.sttMode === 'translate' ? TRANSLATED_EN : whisper.language
      const saved = await saveTranscript(job.id, job.lockToken, {
        sttModel: cfg.sttModel,
        language: sttLanguage,
        segments: filtered.segments,
        quality: filtered.quality,
        speechSeconds: filtered.speechSeconds,
        billedSeconds: billed,
        costUsd: sttCost,
      })
      if (!saved) return { kind: 'requeued', audioSeconds, costUsd, error: 'lease lost after transcription' }
      if (filtered.noConversation) {
        await completeSkipped(job.id, job.lockToken, 'no_conversation')
        return { kind: 'skipped', audioSeconds, costUsd }
      }
      segments = filtered.segments
    }

    // ── Phase 2: the verdict ──
    const outcome = await analyseTranscript({
      segments,
      meta: {
        team: job.team,
        callType: job.callType,
        recordedAt: job.recordedAt,
        durationSeconds: job.durationSeconds,
        sttLanguage,
      },
      model: cfg.llmModel,
      timeoutMs: cfg.timeouts.llmMs,
      chat: deps.chat,
    })
    const llmCost = llmCostUsd(outcome.model, outcome.tokensIn, outcome.tokensOut, outcome.cacheReadTokens, outcome.cacheWriteTokens)
    costUsd += llmCost
    const a = outcome.analysis
    const wipe = a.conversation === 'personal' || a.conversation === 'internal_staff'
    const saved = await completeDone(job.id, job.lockToken, {
      llmModel: outcome.model,
      promptVersion: PROMPT_VERSION,
      analysis: a,
      conversation: a.conversation,
      intent: a.intent,
      mood: a.mood_end,
      verdict: outcome.verdict,
      satisfaction: a.satisfaction,
      leadTemperature: a.lead.temperature,
      isComplaint: a.complaint.is_complaint,
      needsAttention: outcome.needsAttention,
      followUpDue: outcome.followUpDue,
      headline: a.headline_en,
      summary: a.summary_en,
      customerWanted: a.customer_wanted,
      tokensIn: outcome.tokensIn + outcome.cacheReadTokens + outcome.cacheWriteTokens,
      tokensOut: outcome.tokensOut,
      costUsd: llmCost,
      wipeTranscript: wipe,
    })
    return saved ? { kind: 'done', audioSeconds, costUsd } : { kind: 'requeued', audioSeconds, costUsd, error: 'lease lost before saving the verdict' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (error instanceof AiProviderError && error.kind === 'rate_limited') {
      const wait = error.retryAfterSeconds ?? 60
      await requeue(job.id, job.lockToken, { delaySeconds: wait, error: message, refundAttempt: true })
      return { kind: 'rate_limited', audioSeconds, costUsd, error: message, retryAfter: wait }
    }
    if (error instanceof AiProviderError && error.kind === 'config') {
      await requeue(job.id, job.lockToken, { delaySeconds: 900, error: message, refundAttempt: true })
      return { kind: 'config', audioSeconds, costUsd, error: message }
    }
    const permanent = (error instanceof AiProviderError && error.kind === 'permanent') || (error instanceof DownloadError && error.permanent)
    if (permanent || job.attempts >= cfg.maxAttempts) {
      await markFailed(job.id, job.lockToken, message)
      return { kind: 'failed', audioSeconds, costUsd, error: message }
    }
    await requeue(job.id, job.lockToken, { delaySeconds: backoffSeconds(job.attempts), error: message, refundAttempt: false })
    return { kind: 'requeued', audioSeconds, costUsd, error: message }
  }
}

export async function runCallAi(options: { deadlineMs: number; deps?: WorkerDeps; skipDiscovery?: boolean; maxJobs?: number }): Promise<RunStats> {
  const cfg = callAiConfig()
  const deps = options.deps ?? defaultDeps()
  const now = deps.now ?? (() => new Date())
  const started = now()
  const stats: RunStats = {
    startedAt: started.toISOString(),
    ms: 0,
    discovery: null,
    discoveryError: null,
    claimed: 0,
    done: 0,
    skipped: 0,
    failed: 0,
    requeued: 0,
    rateLimited: false,
    audioSeconds: 0,
    costUsd: 0,
    stoppedBecause: 'drained',
    errors: [],
  }
  const finish = async () => {
    stats.ms = now().getTime() - started.getTime()
    stats.costUsd = Math.round(stats.costUsd * 100000) / 100000
    await writeState({ lastRun: stats as unknown as Record<string, unknown> })
    return stats
  }

  const state = await readState()
  if (!cfg.enabled || !state.enabled) {
    stats.stoppedBecause = 'disabled'
    return finish()
  }
  if (state.rateLimitedUntil && new Date(state.rateLimitedUntil) > now()) {
    stats.stoppedBecause = 'rate_limited'
    stats.rateLimited = true
    return finish()
  }

  if (!options.skipDiscovery) {
    try {
      stats.discovery = await discover(deps.source, state, now())
    } catch (error) {
      // A discovery failure must not stop already-queued work from being processed.
      stats.discoveryError = error instanceof Error ? error.message.slice(0, 300) : String(error)
    }
  }

  const today = istToday(now())
  let audioToday = state.audioDay === today ? state.audioSecondsDay : 0
  const batchSize = cfg.concurrency * 2
  // Worst case for one batch: download + Whisper + two LLM calls, with the job timeouts.
  const worstBatchMs = cfg.timeouts.downloadMs + cfg.timeouts.sttMs + cfg.timeouts.llmMs * 2

  for (;;) {
    if (options.maxJobs !== undefined && stats.claimed >= options.maxJobs) break
    if (now().getTime() + worstBatchMs > options.deadlineMs) { stats.stoppedBecause = 'deadline'; break }
    if (audioToday >= cfg.dailyAudioCapSeconds) { stats.stoppedBecause = 'audio_cap'; break }

    const limit = options.maxJobs !== undefined ? Math.min(batchSize, options.maxJobs - stats.claimed) : batchSize
    const jobs = await claimJobs(limit, cfg.leaseMinutes)
    if (jobs.length === 0) { stats.stoppedBecause = 'drained'; break }
    stats.claimed += jobs.length

    // One CRE read and one signing call for the whole batch.
    const recs = new Map((await deps.source.getByIds(jobs.map((j) => j.creRecordingId))).map((r) => [r.id, r]))
    const needAudio = jobs.filter((j) => !j.segments).map((j) => recs.get(j.creRecordingId)?.storage_path).filter(Boolean) as string[]
    const signed = needAudio.length ? await deps.source.signPaths(needAudio, 600).catch(() => new Map<string, string>()) : new Map<string, string>()

    const outcomes = await mapWithConcurrency(jobs.map((job) => async () => {
      const rec = recs.get(job.creRecordingId)
      return processJob(job, rec, rec?.storage_path ? signed.get(rec.storage_path) : undefined, deps)
    }), cfg.concurrency)

    let stop: RunStats['stoppedBecause'] | null = null
    let shortWait = 0
    for (const outcome of outcomes) {
      stats.audioSeconds += outcome.audioSeconds
      stats.costUsd += outcome.costUsd
      if (outcome.kind === 'done') stats.done += 1
      else if (outcome.kind === 'skipped') stats.skipped += 1
      else if (outcome.kind === 'failed') stats.failed += 1
      else stats.requeued += 1
      if (outcome.error && stats.errors.length < 10) stats.errors.push(outcome.error.slice(0, 200))
      if (outcome.kind === 'rate_limited') {
        const wait = outcome.retryAfter ?? 60
        stats.rateLimited = true
        if (wait <= SHORT_RATE_LIMIT_SECONDS) {
          // A per-minute limit (seen on the free tier: 8K tokens/min): wait it out and carry on in this run.
          shortWait = Math.max(shortWait, wait)
        } else {
          // An hourly/daily cap: pause the whole pipeline until Groq says so — every run until then is a no-op.
          stop = 'rate_limited'
          await writeState({ rateLimitedUntil: new Date(now().getTime() + wait * 1000).toISOString() })
        }
      }
      if (outcome.kind === 'config') stop = 'config_error'
    }
    const batchAudio = outcomes.reduce((sum, o) => sum + o.audioSeconds, 0)
    if (batchAudio > 0) audioToday = await addAudioSeconds(today, batchAudio)
    if (stop) { stats.stoppedBecause = stop; break }
    if (shortWait > 0) {
      if (now().getTime() + shortWait * 1000 + worstBatchMs > options.deadlineMs) { stats.stoppedBecause = 'rate_limited'; break }
      await (deps.sleep ?? defaultSleep)(shortWait * 1000 + 500)
    }
  }

  if (!stats.rateLimited && state.rateLimitedUntil) await writeState({ rateLimitedUntil: null })
  return finish()
}
