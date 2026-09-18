/**
 * Transcript → validated verdict. The model call is injected, so this runs unchanged in tests.
 *
 * Trust nothing the model returns:
 *   - strict json_schema keeps the SHAPE right; zod checks it again (models drift, providers change);
 *   - prose is trimmed, impossible dates are dropped, not failed on (types.ts normalizeAnalysisInput);
 *   - an evidence quote survives only if it really is in the segment it cites — a quote the model "remembered"
 *     is worse than none, because the MD would trust it;
 *   - the verdict chip is derived in code (types.ts deriveVerdict), not asked of the model.
 */
import { z } from 'zod'
import { AiProviderError } from './errors'
import type { ChatMessage, ChatResult } from './groq'
import { analysisJsonSchema, buildUserMessage, maskNumbers, SYSTEM_PROMPT, type CallMeta } from './prompt'
import {
  AnalysisSchema,
  dealerFollowUpDue,
  deriveVerdict,
  needsAttention,
  normalizeAnalysisInput,
  type Analysis,
  type Segment,
  type Verdict,
} from './types'

export type ChatFn = (input: {
  model: string
  messages: ChatMessage[]
  schemaName: string
  schema: Record<string, unknown>
  maxTokens: number
  timeoutMs: number
}) => Promise<ChatResult>

export type AnalysisOutcome = {
  analysis: Analysis
  verdict: Verdict
  needsAttention: boolean
  followUpDue: string | null
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  cacheWriteTokens: number
  model: string
  calls: number
}

function parseJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  return JSON.parse(trimmed)
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** The IST calendar date of the call, YYYY-MM-DD. */
export function istDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Everything the model said that cannot be true is removed here, before anything is stored. */
export function sanitizeAnalysis(a: Analysis, segments: Segment[], recordedAt: string | null): Analysis {
  const callDay = istDate(recordedAt)
  const earliest = callDay ? addDays(callDay, -1) : null
  const latest = callDay ? addDays(callDay, 180) : null
  const inWindow = (due: string | null) => (due && earliest && latest && due >= earliest && due <= latest ? due : callDay ? null : due)

  const evidence = a.evidence
    .map((item) => ({ ...item, quote: maskNumbers(item.quote.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim()) }))
    .filter((item) => {
      const seg = segments[item.segment]
      if (!seg || item.quote.length < 2) return false
      return squash(maskNumbers(seg.t)).includes(squash(item.quote))
    })

  const cleaned: Analysis = {
    ...a,
    headline_en: maskNumbers(a.headline_en),
    customer_wanted: maskNumbers(a.customer_wanted),
    summary_en: maskNumbers(a.summary_en),
    commitments: a.commitments.map((c) => ({ ...c, what: maskNumbers(c.what), due: inWindow(c.due) })),
    next_action: { ...a.next_action, what: a.next_action.what ? maskNumbers(a.next_action.what) : null, due: inWindow(a.next_action.due) },
    evidence,
  }

  // Not a customer call: keep the class, drop everything that could describe someone's private life.
  if (cleaned.conversation !== 'customer_call') {
    return {
      ...cleaned,
      intent: 'other',
      mood_end: 'neutral',
      satisfaction: null,
      customer_wanted: '',
      summary_en: '',
      lead: { temperature: 'none', models: [], exchange_vehicle: null, finance_needed: null },
      complaint: { is_complaint: false, about: null, severity: null },
      commitments: [],
      next_action: { needed: false, what: null, owner: null, due: null },
      red_flags: [],
      staff_handling: { score: null, notes: null },
      evidence: [],
    }
  }
  return cleaned
}

export async function analyseTranscript(input: {
  segments: Segment[]
  meta: CallMeta
  model: string
  timeoutMs: number
  chat: ChatFn
}): Promise<AnalysisOutcome> {
  const schema = analysisJsonSchema()
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(input.meta, input.segments) },
  ]

  let tokensIn = 0
  let tokensOut = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let model = input.model
  let lastProblem = ''

  for (let call = 1; call <= 2; call += 1) {
    const result = await input.chat({ model: input.model, messages, schemaName: 'call_review', schema, maxTokens: 3000, timeoutMs: input.timeoutMs })
    tokensIn += result.tokensIn
    tokensOut += result.tokensOut
    cacheReadTokens += result.cacheReadTokens ?? 0
    cacheWriteTokens += result.cacheWriteTokens ?? 0
    model = result.model

    let parsed: unknown
    try {
      parsed = parseJson(result.content)
    } catch {
      lastProblem = 'The reply was not valid JSON.'
      messages.push({ role: 'assistant', content: result.content.slice(0, 4000) }, { role: 'user', content: `${lastProblem} Reply again with only the JSON object.` })
      continue
    }
    const checked = AnalysisSchema.safeParse(normalizeAnalysisInput(parsed))
    if (!checked.success) {
      lastProblem = z.prettifyError(checked.error).slice(0, 1500)
      messages.push({ role: 'assistant', content: result.content.slice(0, 4000) }, { role: 'user', content: `That JSON failed validation:\n${lastProblem}\nReply again with the corrected JSON object only.` })
      continue
    }

    const analysis = sanitizeAnalysis(checked.data, input.segments, input.meta.recordedAt)
    const verdict = deriveVerdict(analysis)
    return {
      analysis,
      verdict,
      needsAttention: needsAttention(analysis, verdict),
      followUpDue: verdict === 'not_customer' ? null : dealerFollowUpDue(analysis),
      tokensIn,
      tokensOut,
      cacheReadTokens,
      cacheWriteTokens,
      model,
      calls: call,
    }
  }
  throw new AiProviderError(`The model's answer failed validation twice: ${lastProblem.slice(0, 300)}`, 'transient')
}
