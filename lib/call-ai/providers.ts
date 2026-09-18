/**
 * Which service transcribes and which writes the verdict — chosen by config (lib/call-ai/config.ts), used by the
 * worker, the pilot and the backfill alike. Defaults: ElevenLabs Scribe + Claude Opus 5.
 */
import type { ChatFn } from './analyse'
import { chatClaude } from './claude'
import { callAiConfig } from './config'
import { transcribeElevenLabs } from './elevenlabs'
import { chatJson, transcribe } from './groq'
import type { TranscribeFn } from './worker'

export function providerTranscribe(): TranscribeFn {
  const cfg = callAiConfig()
  if (cfg.sttProvider === 'elevenlabs') {
    return (input) => transcribeElevenLabs({
      audio: input.audio,
      fileName: input.fileName,
      contentType: input.contentType,
      model: input.model,
      language: input.language,
      timeoutMs: input.timeoutMs,
    })
  }
  return (input) => transcribe(input)
}

export function providerChat(): ChatFn {
  const cfg = callAiConfig()
  if (cfg.llmProvider === 'anthropic') return (input) => chatClaude({ ...input, effort: cfg.llmEffort })
  return (input) => chatJson(input)
}
