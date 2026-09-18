/**
 * The verdict with Claude (owner, 2026-09-18: Claude Opus 5 writes the verdicts; ElevenLabs transcribes).
 *
 *   - Official SDK (`@anthropic-ai/sdk`), beta surface for the server-side refusal fallback: if Claude's safety
 *     filters decline a call, `fallbacks: "default"` re-runs it on the recommended fallback model inside the same
 *     request instead of returning an empty verdict.
 *   - Structured output (`output_config.format` = the strict JSON schema from prompt.ts). The reply is still
 *     validated with zod in analyse.ts — models drift, schemas change.
 *   - `effort` keeps cost in line with a classification job; thinking is on by default on Opus 5 (adaptive).
 *   - The long, fixed system prompt is cached (`cache_control`): Opus 5 caches prefixes from 512 tokens, and every
 *     call after the first reads it at ~10% of the input price.
 *
 * `fetchImpl` is injectable so the verifier runs this against a fake API.
 */
import Anthropic from '@anthropic-ai/sdk'
import { AiProviderError, retryAfterSeconds } from './errors'
import type { ChatMessage, ChatResult, FetchLike } from './groq'

const clients = new Map<FetchLike | undefined, Anthropic>()

function client(fetchImpl?: FetchLike): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.ANTHROPIC_AUTH_TOKEN?.trim()) {
    throw new AiProviderError('ANTHROPIC_API_KEY is not set', 'config')
  }
  let existing = clients.get(fetchImpl)
  if (!existing) {
    // SDK retries 429 / 5xx / connection errors twice with backoff before we ever see them.
    existing = new Anthropic({ maxRetries: 2, ...(fetchImpl ? { fetch: fetchImpl as unknown as typeof fetch } : {}) })
    clients.set(fetchImpl, existing)
  }
  return existing
}

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export async function chatClaude(input: {
  model: string
  messages: ChatMessage[]
  schemaName: string
  schema: Record<string, unknown>
  maxTokens: number
  timeoutMs: number
  effort?: ClaudeEffort
  fetchImpl?: FetchLike
}): Promise<ChatResult> {
  const system = input.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const turns = input.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
    model: input.model,
    max_tokens: Math.max(input.maxTokens, 16000),
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: system ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : undefined,
    messages: turns,
    output_config: {
      effort: input.effort ?? 'medium',
      format: { type: 'json_schema', schema: input.schema },
    },
  }
  let response: Anthropic.Beta.Messages.BetaMessage
  try {
    response = await client(input.fetchImpl).beta.messages.create(params, { timeout: input.timeoutMs })
  } catch (error) {
    throw classify(error)
  }

  if (response.stop_reason === 'refusal') {
    // Only when the fallback chain declined too. Retrying the same request will not change the answer.
    throw new AiProviderError('Claude declined to review this call (safety filter)', 'permanent')
  }
  const text = response.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
  if (!text.trim()) {
    throw new AiProviderError(`Claude returned no text (stop_reason ${response.stop_reason ?? 'unknown'})`, 'transient')
  }
  const usage = response.usage
  return {
    content: text,
    tokensIn: Number(usage.input_tokens) || 0,
    tokensOut: Number(usage.output_tokens) || 0,
    cacheReadTokens: Number(usage.cache_read_input_tokens) || 0,
    cacheWriteTokens: Number(usage.cache_creation_input_tokens) || 0,
    model: String(response.model || input.model),
  }
}

/** SDK errors → the worker's kinds, most specific first. */
function classify(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error
  const headerOf = (e: { headers?: unknown }) => {
    const h = e.headers as Headers | Record<string, string> | undefined
    if (!h) return null
    return typeof (h as Headers).get === 'function' ? (h as Headers).get('retry-after') : (h as Record<string, string>)['retry-after'] ?? null
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiProviderError(`Claude rate limit: ${error.message}`.slice(0, 400), 'rate_limited', 429, retryAfterSeconds(headerOf(error)) ?? 60)
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new AiProviderError(`Claude refused the API key: ${error.message}`.slice(0, 400), 'config', error.status ?? null)
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AiProviderError(`Claude model not found: ${error.message}`.slice(0, 400), 'config', 404)
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.UnprocessableEntityError) {
    return new AiProviderError(`Claude ${error.status}: ${error.message}`.slice(0, 400), 'permanent', error.status ?? null)
  }
  if (error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) {
    return new AiProviderError(`Claude unavailable: ${error.message}`.slice(0, 400), 'transient', error instanceof Anthropic.APIError ? error.status ?? null : null)
  }
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0
    return new AiProviderError(`Claude ${status}: ${error.message}`.slice(0, 400), status >= 500 ? 'transient' : 'permanent', status || null)
  }
  return new AiProviderError(`Claude call failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 400), 'transient')
}
