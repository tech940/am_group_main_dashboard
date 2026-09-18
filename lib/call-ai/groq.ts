/**
 * The one Groq client for AI Call Review: speech to text (Whisper) and a strict-JSON chat call.
 *
 * Every other Groq call site in this repo is a bare fetch with no timeout and no 429 handling. This one
 * classifies every failure, because the worker's behaviour depends on the class:
 *   - RateLimited → put the job back WITHOUT spending an attempt, pause the whole pipeline until retry-after;
 *   - Transient   → retry later with backoff (timeouts, 5xx, network);
 *   - Permanent   → the request itself is wrong (bad audio, 400) — retrying will not help;
 *   - Config      → no key / bad key; stop the run.
 *
 * `fetchImpl` is injectable so the verifier can run the whole pipeline without touching the network.
 */

import { AiProviderError, type AiErrorKind } from './errors'

const GROQ_BASE = 'https://api.groq.com/openai/v1'

export type GroqErrorKind = AiErrorKind

/** Groq's failures, classified the same way as every other provider's (errors.ts). */
export class GroqError extends AiProviderError {
  constructor(message: string, kind: AiErrorKind, status: number | null = null, retryAfterSeconds: number | null = null) {
    super(message, kind, status, retryAfterSeconds)
    this.name = 'GroqError'
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Call analysis has its OWN Groq key (owner, 2026-09-18), so its quota never competes with the Business
 * Excellence AI summaries on GROQ_API_KEY. Deliberately no fallback to the shared key: a missing
 * CALL_GROQ_API_KEY stops the pipeline visibly (status strip, 'config_error') instead of silently draining it.
 */
function apiKey(): string {
  const key = process.env.CALL_GROQ_API_KEY?.trim()
  if (!key) throw new GroqError('CALL_GROQ_API_KEY is not set', 'config')
  return key
}

function retryAfter(response: Response): number | null {
  const header = response.headers.get('retry-after')
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds))
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.max(1, Math.ceil((at - Date.now()) / 1000)) : null
}

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {}
}

async function send(fetchImpl: FetchLike, path: string, init: RequestInit, timeoutMs: number): Promise<JsonObject> {
  let response: Response
  try {
    response = await fetchImpl(`${GROQ_BASE}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    throw new GroqError(
      name === 'TimeoutError' || name === 'AbortError' ? `Groq timed out after ${timeoutMs} ms` : `Groq unreachable: ${error instanceof Error ? error.message : String(error)}`,
      'transient',
    )
  }
  const text = await response.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (response.ok) {
    if (body === null || typeof body !== 'object') throw new GroqError('Groq returned a non-JSON response', 'transient', response.status)
    return asObject(body)
  }
  const message = String(asObject(asObject(body).error).message || text || response.statusText).slice(0, 300)
  if (response.status === 429) throw new GroqError(`Groq rate limit: ${message}`, 'rate_limited', 429, retryAfter(response) ?? 60)
  if (response.status === 401 || response.status === 403) throw new GroqError(`Groq refused the API key: ${message}`, 'config', response.status)
  if (response.status >= 500 || response.status === 408) throw new GroqError(`Groq ${response.status}: ${message}`, 'transient', response.status)
  throw new GroqError(`Groq ${response.status}: ${message}`, 'permanent', response.status)
}

// ── Speech to text ───────────────────────────────────────────────────────────────────────────────

export type WhisperSegment = {
  id: number
  start: number
  end: number
  text: string
  speaker?: string
  avg_logprob?: number
  no_speech_prob?: number
  compression_ratio?: number
}

export type WhisperResult = { language: string | null; duration: number; text: string; segments: WhisperSegment[] }

export async function transcribe(input: {
  audio: Uint8Array
  /** Must end in a real audio extension — Groq infers the container from it. Never the handset's file name. */
  fileName: string
  contentType: string
  model: string
  language?: string | null
  prompt?: string | null
  /** 'translate' = Whisper's speech-to-ENGLISH mode (/audio/translations). No `language` is sent for it. */
  task?: 'transcribe' | 'translate'
  timeoutMs: number
  fetchImpl?: FetchLike
}): Promise<WhisperResult> {
  const translate = input.task === 'translate'
  const form = new FormData()
  form.append('file', new Blob([input.audio as BlobPart], { type: input.contentType }), input.fileName)
  form.append('model', input.model)
  form.append('response_format', 'verbose_json')
  if (!translate) form.append('timestamp_granularities[]', 'segment')
  form.append('temperature', '0')
  if (input.language && !translate) form.append('language', input.language)
  if (input.prompt) form.append('prompt', input.prompt)

  const body = await send(input.fetchImpl ?? fetch, translate ? '/audio/translations' : '/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  }, input.timeoutMs)

  const num = (value: unknown) => (typeof value === 'number' ? value : undefined)
  const segments: WhisperSegment[] = Array.isArray(body.segments)
    ? body.segments.map((raw: unknown, index: number) => {
      const s = asObject(raw)
      return {
        id: typeof s.id === 'number' && Number.isFinite(s.id) ? s.id : index,
        start: Number(s.start) || 0,
        end: Number(s.end) || 0,
        text: String(s.text ?? ''),
        avg_logprob: num(s.avg_logprob),
        no_speech_prob: num(s.no_speech_prob),
        compression_ratio: num(s.compression_ratio),
      }
    })
    : []
  return {
    language: typeof body.language === 'string' ? body.language : null,
    duration: Number(body.duration) || (segments.at(-1)?.end ?? 0),
    text: String(body.text ?? ''),
    segments,
  }
}

// ── Strict JSON chat ─────────────────────────────────────────────────────────────────────────────

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }
export type ChatResult = {
  content: string
  tokensIn: number
  tokensOut: number
  model: string
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export async function chatJson(input: {
  model: string
  messages: ChatMessage[]
  schemaName: string
  schema: Record<string, unknown>
  maxTokens: number
  timeoutMs: number
  fetchImpl?: FetchLike
}): Promise<ChatResult> {
  const reasoning = /gpt-oss/i.test(input.model) ? { reasoning_effort: 'low' } : {}
  const request = (strict: boolean) => send(input.fetchImpl ?? fetch, '/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      messages: strict
        ? input.messages
        : [...input.messages, { role: 'user', content: `Reply with ONE JSON object that matches this JSON schema exactly:\n${JSON.stringify(input.schema)}` }],
      temperature: 0,
      max_completion_tokens: input.maxTokens,
      response_format: strict
        ? { type: 'json_schema', json_schema: { name: input.schemaName, strict: true, schema: input.schema } }
        : { type: 'json_object' },
      ...reasoning,
    }),
  }, input.timeoutMs)

  let body: JsonObject
  try {
    body = await request(true)
  } catch (error) {
    // Seen on real calls (pilot #18, 2026-09-18): Groq answers 400 "Generated JSON does not match the expected
    // schema" when the model's own output failed strict validation. That is a one-off generation failure, not a
    // bad request — ask once more in plain JSON mode; analyse.ts validates the result with zod either way.
    const schemaMiss = error instanceof GroqError && error.status === 400 && /does not match the expected schema|json_validate_failed|failed_generation/i.test(error.message)
    if (!schemaMiss) throw error
    body = await request(false)
  }

  const choice = asObject(Array.isArray(body.choices) ? body.choices[0] : null)
  const content = asObject(choice.message).content
  if (typeof content !== 'string' || !content.trim()) {
    const reason = choice.finish_reason ? ` (finish_reason ${String(choice.finish_reason)})` : ''
    throw new GroqError(`Groq returned no content${reason}`, 'transient')
  }
  const usage = asObject(body.usage)
  return {
    content,
    tokensIn: Number(usage.prompt_tokens) || 0,
    tokensOut: Number(usage.completion_tokens) || 0,
    model: String(body.model || input.model),
  }
}
