/**
 * Speech to text with ElevenLabs Scribe (owner, 2026-09-18: "in actual we will use Eleven Labs").
 *
 * Why Scribe over Whisper for these calls: on Jammu phone audio Whisper's Hindi transcription was word salad on
 * about half the calls (pilot, 2026-09-18). Scribe also separates the voices (`diarize`), so the transcript says
 * who spoke — the verdict model then knows which lines are the customer's.
 *
 * Scribe returns WORDS with times and a speaker id. They are grouped here into readable lines: a new line on a
 * change of speaker, a pause over ~1.2 s, or a long run ending in a full stop. Output uses the same shape as the
 * Whisper path (`WhisperResult`), so stt-filter.ts and everything after it are provider-neutral.
 *
 * `fetchImpl` is injectable so the verifier never calls the real API.
 */
import { AiProviderError, errorForStatus, retryAfterSeconds } from './errors'
import type { FetchLike, WhisperResult, WhisperSegment } from './groq'

const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text'

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY?.trim()
  if (!key) throw new AiProviderError('ELEVENLABS_API_KEY is not set', 'config')
  return key
}

type ScribeWord = { text?: unknown; type?: unknown; start?: unknown; end?: unknown; speaker_id?: unknown; logprob?: unknown }

const PAUSE_SECONDS = 1.2
const LONG_LINE_SECONDS = 18
const SENTENCE_END = /[.?!।॥]$/

/** Scribe words → speaker-labelled lines (S1, S2 … in order of first appearance). Pure. */
export function groupScribeWords(words: ScribeWord[]): WhisperSegment[] {
  const labels = new Map<string, string>()
  const label = (id: unknown) => {
    const key = String(id ?? 'unknown')
    if (!labels.has(key)) labels.set(key, `S${labels.size + 1}`)
    return labels.get(key)!
  }

  const segments: WhisperSegment[] = []
  let current: { start: number; end: number; text: string; speaker: string; logprobs: number[] } | null = null
  const flush = () => {
    if (!current) return
    const text = current.text.replace(/\s+/g, ' ').trim()
    if (text) {
      const mean = current.logprobs.length ? current.logprobs.reduce((a, b) => a + b, 0) / current.logprobs.length : undefined
      segments.push({ id: segments.length, start: current.start, end: current.end, text, avg_logprob: mean, speaker: current.speaker })
    }
    current = null
  }

  for (const w of words) {
    const type = String(w.type ?? 'word')
    const text = String(w.text ?? '')
    if (type === 'spacing') {
      if (current) current.text += text || ' '
      continue
    }
    if (type !== 'word') continue // audio events ("(laughs)") are not speech
    const start = Number(w.start) || 0
    const end = Number(w.end) || start
    const speaker = label(w.speaker_id)
    const newLine = !current
      || current.speaker !== speaker
      || start - current.end > PAUSE_SECONDS
      || (current.end - current.start > LONG_LINE_SECONDS && SENTENCE_END.test(current.text.trim()))
    if (newLine) {
      flush()
      current = { start, end, text: '', speaker, logprobs: [] }
    }
    current!.text += text
    current!.end = end
    if (typeof w.logprob === 'number') current!.logprobs.push(w.logprob)
  }
  flush()
  return segments
}

export async function transcribeElevenLabs(input: {
  audio: Uint8Array
  /** The recording id + extension — never the handset's file name, which embeds the customer's number. */
  fileName: string
  contentType: string
  model: string
  /** ISO-639-1/3, e.g. 'hi'. Null lets Scribe detect. */
  language?: string | null
  timeoutMs: number
  fetchImpl?: FetchLike
}): Promise<WhisperResult> {
  const form = new FormData()
  form.append('file', new Blob([input.audio as BlobPart], { type: input.contentType }), input.fileName)
  form.append('model_id', input.model)
  form.append('diarize', 'true')
  form.append('timestamps_granularity', 'word')
  form.append('tag_audio_events', 'false')
  if (input.language) form.append('language_code', input.language)

  let response: Response
  try {
    response = await (input.fetchImpl ?? fetch)(ENDPOINT, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey() },
      body: form,
      signal: AbortSignal.timeout(input.timeoutMs),
    })
  } catch (error) {
    if (error instanceof AiProviderError) throw error
    const name = error instanceof Error ? error.name : ''
    throw new AiProviderError(
      name === 'TimeoutError' || name === 'AbortError' ? `ElevenLabs timed out after ${input.timeoutMs} ms` : `ElevenLabs unreachable: ${error instanceof Error ? error.message : String(error)}`,
      'transient',
    )
  }
  const raw = await response.text()
  let body: Record<string, unknown> = {}
  try { body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {} } catch { body = {} }
  if (!response.ok) {
    const detail = body.detail as { message?: unknown } | string | undefined
    const message = String((typeof detail === 'object' && detail?.message) || detail || raw || response.statusText).slice(0, 300)
    throw errorForStatus('ElevenLabs', response.status, message, retryAfterSeconds(response.headers.get('retry-after')))
  }

  const words = Array.isArray(body.words) ? (body.words as ScribeWord[]) : []
  const segments = groupScribeWords(words)
  return {
    language: typeof body.language_code === 'string' ? body.language_code : null,
    duration: Number(body.audio_duration_secs) || (segments.at(-1)?.end ?? 0),
    text: String(body.text ?? ''),
    segments,
  }
}
