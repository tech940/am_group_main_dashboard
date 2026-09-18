/**
 * How every AI provider failure is classified, whoever the provider is (ElevenLabs, Anthropic, Groq). The worker's
 * behaviour depends only on the kind:
 *   - rate_limited → back on the queue WITHOUT spending an attempt; short waits are sat out inside the run,
 *                    long ones pause the whole pipeline until retry-after;
 *   - transient    → retry later with backoff (timeouts, 5xx, network, overloaded);
 *   - permanent    → the request itself is wrong (bad audio, a 400) — retrying will not help;
 *   - config       → missing or refused key; stop the run.
 */
export type AiErrorKind = 'rate_limited' | 'transient' | 'permanent' | 'config'

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: AiErrorKind,
    public readonly status: number | null = null,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message)
    this.name = 'AiProviderError'
  }
}

/** Seconds from a `retry-after` header (seconds or an HTTP date), or null. */
export function retryAfterSeconds(header: string | null | undefined): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds))
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.max(1, Math.ceil((at - Date.now()) / 1000)) : null
}

/** Map an HTTP failure to a kind, the same way for every provider. */
export function errorForStatus(provider: string, status: number, message: string, retryAfter: number | null): AiProviderError {
  const text = `${provider} ${status}: ${message}`.slice(0, 400)
  if (status === 429) return new AiProviderError(`${provider} rate limit: ${message}`.slice(0, 400), 'rate_limited', 429, retryAfter ?? 60)
  if (status === 401 || status === 403) return new AiProviderError(`${provider} refused the API key: ${message}`.slice(0, 400), 'config', status)
  if (status >= 500 || status === 408 || status === 409) return new AiProviderError(text, 'transient', status)
  return new AiProviderError(text, 'permanent', status)
}
