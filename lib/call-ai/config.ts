/**
 * AI Call Review — settings. Every knob is an environment variable with a safe default, read at call time so a
 * test can change one without reloading the module.
 *
 * Providers (owner, 2026-09-18): ElevenLabs Scribe transcribes, Claude Opus 5 writes the verdict. Groq (Whisper +
 * gpt-oss) was the test stack and stays selectable: CALL_AI_STT_PROVIDER=groq / CALL_AI_LLM_PROVIDER=groq.
 */

function num(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name])
  if (!Number.isFinite(raw) || raw === 0 && process.env[name]?.trim() !== '0') return fallback
  return Math.min(max, Math.max(min, raw))
}

function flag(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? '').trim().toLowerCase()
  if (!raw) return fallback
  return !['0', 'false', 'off', 'no'].includes(raw)
}

function pick<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = (process.env[name] ?? '').trim().toLowerCase() as T
  return allowed.includes(raw) ? raw : fallback
}

export type SttProvider = 'elevenlabs' | 'groq'
export type LlmProvider = 'anthropic' | 'groq'
export type LlmEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export function callAiConfig() {
  const sttProvider = pick<SttProvider>('CALL_AI_STT_PROVIDER', ['elevenlabs', 'groq'], 'elevenlabs')
  const llmProvider = pick<LlmProvider>('CALL_AI_LLM_PROVIDER', ['anthropic', 'groq'], 'anthropic')
  /**
   * Groq only. 'translate' (default): Whisper's speech-to-English mode. Measured on the pilot (2026-09-18): Whisper's
   * Hindi transcription of Jammu phone calls was unreadable on about half the calls, while the SAME audio translated
   * to English was clear on every one. ElevenLabs always transcribes the spoken language (with speakers).
   */
  const sttMode = pick<'transcribe' | 'translate'>('CALL_AI_STT_MODE', ['transcribe', 'translate'], 'translate')
  const sttModelEnv = (process.env.CALL_AI_STT_MODEL || '').trim()
  const sttModel = sttProvider === 'elevenlabs'
    ? (sttModelEnv && sttModelEnv.startsWith('scribe') ? sttModelEnv : 'scribe_v2')
    // Translation needs whisper-large-v3 (turbo cannot translate).
    : (() => {
      const model = sttModelEnv && sttModelEnv.startsWith('whisper') ? sttModelEnv : 'whisper-large-v3'
      return sttMode === 'translate' && /turbo/i.test(model) ? 'whisper-large-v3' : model
    })()
  const llmModelEnv = (process.env.CALL_AI_LLM_MODEL || '').trim()
  const llmModel = llmProvider === 'anthropic'
    ? (llmModelEnv && llmModelEnv.startsWith('claude') ? llmModelEnv : 'claude-opus-5')
    : (llmModelEnv && !llmModelEnv.startsWith('claude') ? llmModelEnv : 'openai/gpt-oss-120b')

  return {
    /** Hard off switch (redeploy to change). The DB `enabled` flag is the soft one, toggled from the dashboard. */
    enabled: flag('CALL_AI_ENABLED', true),
    /** Comma-separated scope keys — see lib/call-ai/scope.ts. Phase 1: AM Hyundai only. */
    scope: (process.env.CALL_AI_SCOPE || 'hyundai').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    sttProvider,
    sttMode,
    sttModel,
    /**
     * Forced to Hindi by default (pilot, 2026-09-18): left to detect, Whisper wrote Jammu Hindi in Urdu script on
     * some calls, and in Devanagari on others for the same speech. 'auto' lets the transcriber detect again.
     */
    sttLanguage: ((process.env.CALL_AI_STT_LANGUAGE || 'hi').trim().toLowerCase() === 'auto' ? null : (process.env.CALL_AI_STT_LANGUAGE || 'hi').trim()),
    llmProvider,
    llmModel,
    /** Claude only. A verdict is a classification job — medium thinking is ample and keeps the cost predictable. */
    llmEffort: pick<LlmEffort>('CALL_AI_LLM_EFFORT', ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'),
    concurrency: num('CALL_AI_CONCURRENCY', 4, 1, 8),
    /** Below this a recording is ringing or a hang-up; it is skipped before any money is spent. */
    minSeconds: num('CALL_AI_MIN_SECONDS', 6, 0, 120),
    /** Transcribed audio per IST day. Default 6 h — ~3x the Hyundai load, so only a runaway ever meets it. */
    dailyAudioCapSeconds: num('CALL_AI_DAILY_AUDIO_CAP_SECONDS', 6 * 3600, 60, 48 * 3600),
    maxAttempts: 3,
    /** Groq accepts 25 MB on the free tier; the largest recording seen is 21.7 MB. */
    maxAudioBytes: 24 * 1024 * 1024,
    leaseMinutes: 6,
    timeouts: { downloadMs: 20_000, sttMs: 120_000, llmMs: 120_000 },
  }
}

export type CallAiConfig = ReturnType<typeof callAiConfig>

/**
 * Prices in USD (verified 2026-09-18) — for the cost column and the status panel, an estimate, not an invoice.
 * ElevenLabs Scribe v2 $0.22/audio hour. Groq Whisper bills a 10-second minimum per file.
 * Claude: cache reads bill at 0.1x input, cache writes (5-minute) at 1.25x.
 */
export const PRICES = {
  sttPerHour: { scribe_v2: 0.22, scribe_v1: 0.22, 'whisper-large-v3': 0.111, 'whisper-large-v3-turbo': 0.04 } as Record<string, number>,
  llmPerMillion: {
    'claude-opus-5': { in: 5, out: 25 },
    'claude-sonnet-5': { in: 2, out: 10 },
    'claude-haiku-4-5': { in: 1, out: 5 },
    'openai/gpt-oss-120b': { in: 0.15, out: 0.6 },
    'openai/gpt-oss-20b': { in: 0.075, out: 0.3 },
  } as Record<string, { in: number; out: number }>,
}

export function sttCostUsd(model: string, audioSeconds: number): number {
  const perHour = PRICES.sttPerHour[model] ?? 0.22
  const billed = model.startsWith('whisper') ? Math.max(10, audioSeconds) : audioSeconds
  return (billed / 3600) * perHour
}

export function llmCostUsd(model: string, tokensIn: number, tokensOut: number, cacheRead = 0, cacheWrite = 0): number {
  const price = PRICES.llmPerMillion[model] ?? PRICES.llmPerMillion[model.replace(/-\d{8}$/, '')] ?? { in: 5, out: 25 }
  return (tokensIn * price.in + cacheRead * price.in * 0.1 + cacheWrite * price.in * 1.25 + tokensOut * price.out) / 1_000_000
}

/** Bumped whenever the prompt or schema changes; reviews made under an older version can be re-analysed. */
export const PROMPT_VERSION = 'v4-2026-09-18'
