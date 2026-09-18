/**
 * Cleans Whisper's output before anything reads it. Pure — no network, no db.
 *
 * Whisper invents text when it hears none: on ring tones, hold music and silence it produces YouTube outros
 * ("thank you for watching"), the same line repeated, or a fluent sentence with near-zero confidence. Phone
 * recordings are full of exactly that audio, so every segment is checked against Whisper's own signals before
 * the LLM is allowed to treat it as something a customer said.
 */
import type { WhisperSegment } from './groq'
import type { Segment } from './types'

/** Whisper's own silence rule: likely no speech AND the words it produced are low-confidence. */
const NO_SPEECH_PROB = 0.6
const NO_SPEECH_LOGPROB = -0.8
/** gzip ratio of the text; above this it is a repetition loop, not speech. */
const MAX_COMPRESSION_RATIO = 2.4
/** Shown faded in the transcript — probably right, but Whisper was unsure. */
const LOW_CONFIDENCE_LOGPROB = -1.0

const OUTRO_PATTERNS = [
  /^(thank you|thanks) for watching/i,
  /^please (like|subscribe)/i,
  /(like|share) (and|&) subscribe/i,
  /^subtitles? (by|created)/i,
  /amara\.org/i,
  /^www\.\S+$/i,
  /^(सब्सक्राइब|लाइक)/,
  /^(ترجمہ|سبسکرائب)/,
]

export type SttQuality = {
  segmentsIn: number
  segmentsKept: number
  droppedSilence: number
  droppedRepetition: number
  droppedOutro: number
  droppedDuplicate: number
  droppedPromptEcho: number
  meanLogprob: number | null
}

export type FilteredTranscript = {
  segments: Segment[]
  speechSeconds: number
  quality: SttQuality
  /** Nothing a person said survived — ringing, IVR, silence, or an empty recording. */
  noConversation: boolean
}

function normal(text: string): string {
  return text.toLowerCase().replace(/[\s.,!?।"'“”‘’…-]+/g, ' ').trim()
}

function words(text: string): string[] {
  return normal(text).split(' ').filter((w) => w.length > 1)
}

/**
 * Whisper repeats its own prompt back on quiet audio (seen on real calls: a whole line of the glossary). A line
 * of four or more words that is mostly the prompt's words is that echo, not speech.
 */
function isPromptEcho(text: string, promptWords: Set<string>): boolean {
  if (promptWords.size === 0) return false
  const list = words(text)
  if (list.length < 4) return false
  return list.filter((w) => promptWords.has(w)).length / list.length >= 0.6
}

export function filterSegments(input: WhisperSegment[], options: { prompt?: string | null } = {}): FilteredTranscript {
  const promptWords = new Set(options.prompt ? words(options.prompt) : [])
  const quality: SttQuality = {
    segmentsIn: input.length,
    segmentsKept: 0,
    droppedSilence: 0,
    droppedRepetition: 0,
    droppedOutro: 0,
    droppedDuplicate: 0,
    droppedPromptEcho: 0,
    meanLogprob: null,
  }
  const kept: Segment[] = []
  const seen = new Map<string, number>()
  let logprobSum = 0
  let logprobCount = 0

  for (const seg of input) {
    const text = seg.text.replace(/\s+/g, ' ').trim()
    if (!text) { quality.droppedSilence += 1; continue }
    const noSpeech = seg.no_speech_prob ?? 0
    const logprob = seg.avg_logprob ?? 0
    if (noSpeech > NO_SPEECH_PROB && logprob < NO_SPEECH_LOGPROB) { quality.droppedSilence += 1; continue }
    if ((seg.compression_ratio ?? 0) > MAX_COMPRESSION_RATIO) { quality.droppedRepetition += 1; continue }
    if (OUTRO_PATTERNS.some((pattern) => pattern.test(text)) && (noSpeech > 0.2 || logprob < -0.5)) { quality.droppedOutro += 1; continue }
    if (isPromptEcho(text, promptWords)) { quality.droppedPromptEcho += 1; continue }

    // The same line over and over is a loop. Keep the first two (people do repeat "hello? hello?").
    const key = normal(text)
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    if (key && count > 2) { quality.droppedDuplicate += 1; continue }

    const start = Math.max(0, Math.round(seg.start * 10) / 10)
    const end = Math.max(start, Math.round(seg.end * 10) / 10)
    const line: Segment = { s: start, e: end, t: text }
    if (logprob < LOW_CONFIDENCE_LOGPROB) line.f = 1
    if (seg.speaker) line.p = seg.speaker
    kept.push(line)
    if (typeof seg.avg_logprob === 'number') { logprobSum += seg.avg_logprob; logprobCount += 1 }
  }

  quality.segmentsKept = kept.length
  quality.meanLogprob = logprobCount ? Math.round((logprobSum / logprobCount) * 1000) / 1000 : null
  const speechSeconds = Math.round(kept.reduce((sum, s) => sum + (s.e - s.s), 0) * 10) / 10
  const characters = kept.reduce((sum, s) => sum + s.t.length, 0)
  return { segments: kept, speechSeconds, quality, noConversation: speechSeconds < 3 || characters < 12 }
}

// ── Audio file checks ────────────────────────────────────────────────────────────────────────────

const EXT_BY_MIME: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
}
const SUPPORTED_EXT = new Set(['m4a', 'mp3', 'mp4', 'wav', 'ogg', 'webm', 'flac'])

/** The extension Groq needs, from the recording's mime type or format column; null when unsupported. */
export function audioExtension(mimeType: string | null | undefined, format: string | null | undefined): string | null {
  const byMime = EXT_BY_MIME[String(mimeType || '').toLowerCase().split(';')[0].trim()]
  if (byMime) return byMime
  const fmt = String(format || '').toLowerCase().replace(/^\./, '').trim()
  if (fmt === 'aac') return 'm4a'
  return SUPPORTED_EXT.has(fmt) ? fmt : null
}

export function contentTypeFor(ext: string): string {
  return ({ m4a: 'audio/mp4', mp4: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac' } as Record<string, string>)[ext] ?? 'application/octet-stream'
}

/**
 * Reads the first bytes, so an HTML error page or an empty object is never sent to Whisper as "audio".
 * Returns the container it found, or null.
 */
export function sniffAudio(bytes: Uint8Array): 'm4a' | 'mp3' | 'wav' | 'ogg' | 'webm' | 'flac' | null {
  if (bytes.length < 12) return null
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to))
  if (ascii(4, 8) === 'ftyp') return 'm4a'
  if (ascii(0, 3) === 'ID3') return 'mp3'
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav'
  if (ascii(0, 4) === 'OggS') return 'ogg'
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm'
  if (ascii(0, 4) === 'fLaC') return 'flac'
  return null
}
