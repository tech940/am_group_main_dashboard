/**
 * AI Call Review — proves the pipeline, its privacy rules and its access rules.
 *
 *   npm run verify:call-ai
 *
 * 1–3 are pure (no network, no db). 4 runs the REAL worker, queue and reads against the live database inside ONE
 * transaction that is always rolled back (tsconfig.hp-flow.json maps @/lib/db to the rollback shim), with a FAKE
 * CRE project and a FAKE Groq — no audio leaves this machine, no model is called, no email is sent.
 * 5 proves FOR UPDATE SKIP LOCKED with two real connections on a throwaway table (created and dropped here).
 * 6 is read-only against the real CRE project: the keyset paging and the Hyundai scope on real rows.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import crypto from 'node:crypto'
import postgres from 'postgres'
import { sql } from 'drizzle-orm'
import { realDb, testClient, useOuterTransaction } from './_shims/hp-test-db'
import { analyseTranscript, sanitizeAnalysis, type ChatFn } from '../lib/call-ai/analyse'
import type { CreRecording, CreSource } from '../lib/call-ai/cre-source'
import { DownloadError, supabaseCreSource } from '../lib/call-ai/cre-source'
import { phoneKey, preSkipReason, istToday } from '../lib/call-ai/discovery'
import { sendDailyDigest } from '../lib/call-ai/digest'
import { chatJson, GroqError, transcribe, type WhisperResult, type WhisperSegment } from '../lib/call-ai/groq'
import { chatClaude } from '../lib/call-ai/claude'
import { groupScribeWords, transcribeElevenLabs } from '../lib/call-ai/elevenlabs'
import { AiProviderError } from '../lib/call-ai/errors'
import { callAiConfig } from '../lib/call-ai/config'
import { analysisJsonSchema, buildUserMessage, maskNumbers } from '../lib/call-ai/prompt'
import { claimJobs, completeSkipped, readState, writeState } from '../lib/call-ai/queue'
import { getReview, listReviews, lookupVerdicts, parseReviewFilters, requeueReview, saveFeedback } from '../lib/call-ai/read'
import { classifyScope } from '../lib/call-ai/scope'
import { audioExtension, filterSegments, sniffAudio } from '../lib/call-ai/stt-filter'
import {
  dealerFollowUpDue,
  deriveVerdict,
  needsAttention,
  type Analysis,
} from '../lib/call-ai/types'
import { runCallAi, type WorkerDeps } from '../lib/call-ai/worker'
import { authorizeCronRequest } from '../lib/maintenance/cron-auth'
import type { CreDirectory } from '../lib/cre-calls/directory'

class Rollback extends Error {}
let failures = 0
let passes = 0
function assert(label: string, condition: unknown, detail?: string) {
  if (condition) {
    passes += 1
    console.log(`  [PASS] ${label}`)
  } else {
    failures += 1
    console.log(`  [FAIL] ${label}${detail ? `\n         ${detail}` : ''}`)
  }
}
const read = (path: string) => readFileSync(path, 'utf8')

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────

function analysis(over: Partial<Analysis> = {}): Analysis {
  return {
    conversation: 'customer_call',
    language: 'Hindi + English',
    intent: 'new_car_enquiry',
    mood_end: 'neutral',
    satisfaction: 3,
    headline_en: 'Asked about Creta price',
    customer_wanted: 'Wanted the on-road price of a Creta.',
    summary_en: 'Customer asked for the Creta on-road price. Staff shared it.',
    lead: { temperature: 'warm', models: ['Creta'], exchange_vehicle: null, finance_needed: null },
    complaint: { is_complaint: false, about: null, severity: null },
    commitments: [],
    next_action: { needed: false, what: null, owner: null, due: null },
    red_flags: [],
    staff_handling: { score: 4, notes: 'Polite and clear.' },
    speakers: [],
    evidence: [],
    confidence: 0.8,
    needs_human_review: false,
    ...over,
  }
}

const ids = {
  creH: crypto.randomUUID(), creRaman: crypto.randomUUID(), creHeena: crypto.randomUUID(), creKia: crypto.randomUUID(),
  creUnmapped: crypto.randomUUID(), creHonda: crypto.randomUUID(),
  bHyundai: crypto.randomUUID(), bKia: crypto.randomUUID(), bSpecial: crypto.randomUUID(), bHonda: crypto.randomUUID(),
}

/** Just the directory fields the scope and branch rules read. */
const fakeDir = {
  profileName: new Map([
    [ids.creH, 'Hyundai Desk One'], [ids.creRaman, 'Raman Bali'], [ids.creHeena, 'Heena Digital CRM'],
    [ids.creKia, 'Kia Desk One'], [ids.creUnmapped, 'Unmapped Specialist'], [ids.creHonda, 'Honda Desk One'],
  ]),
  profileBranch: new Map([
    [ids.creH, ids.bHyundai], [ids.creRaman, ids.bSpecial], [ids.creHeena, ids.bSpecial],
    [ids.creKia, ids.bKia], [ids.creUnmapped, ids.bSpecial], [ids.creHonda, ids.bHonda],
  ]),
  canonicalBranchId: new Map([[ids.bHyundai, ids.bHyundai], [ids.bKia, ids.bKia], [ids.bSpecial, ids.bSpecial], [ids.bHonda, ids.bHonda]]),
  branchBrand: new Map([[ids.bHyundai, 'Hyundai'], [ids.bKia, 'Kia'], [ids.bSpecial, 'Special Team'], [ids.bHonda, 'Honda']]),
  branchName: new Map([[ids.bHyundai, 'Hyundai Jammu'], [ids.bKia, 'AM Kia'], [ids.bSpecial, 'Special Branch'], [ids.bHonda, 'Honda Jammu']]),
} as unknown as CreDirectory

const PHONE = '9000000001'
const CONTACT = 'Secret Contact Name'
const FILE_NAME = `REC_${PHONE}_20260918.m4a`
const M4A = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 1, 2, 3, 4])

function rec(id: string, over: Partial<CreRecording> & { minutesAgo?: number } = {}): CreRecording {
  const minutesAgo = over.minutesAgo ?? 30
  const at = new Date(Date.now() - minutesAgo * 60_000).toISOString()
  const { minutesAgo: _drop, ...rest } = over
  void _drop
  return {
    id,
    call_id: crypto.randomUUID(),
    cre_id: ids.creH,
    branch_id: null,
    call_type: 'incoming',
    duration_seconds: 90,
    recorded_at: at,
    uploaded_at: at,
    updated_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    deleted_at: null,
    upload_status: 'uploaded',
    storage_path: `recordings/${id}.m4a`,
    format: 'm4a',
    mime_type: 'audio/mp4',
    size_bytes: 120_000,
    phone: PHONE,
    contact_name: CONTACT,
    ...rest,
  }
}

function seg(text: string, start: number, over: Partial<WhisperSegment> = {}): WhisperSegment {
  return { id: start, start, end: start + 4, text, avg_logprob: -0.3, no_speech_prob: 0.02, compression_ratio: 1.5, ...over }
}

async function main() {
  // ── 1. Pure: transcript cleaning, audio checks, masking, schema ──────────────────────────────────
  console.log('\n1) Cleaning Whisper output and checking audio')
  {
    const out = filterSegments([
      seg('Namaste sir, AM Hyundai se bol raha hoon', 0),
      seg('Thank you for watching.', 4, { no_speech_prob: 0.5, avg_logprob: -0.9 }),
      seg('ok ok ok ok ok ok ok ok ok ok ok ok', 8, { compression_ratio: 3.1 }),
      seg('', 12),
      seg('...', 16, { no_speech_prob: 0.9, avg_logprob: -1.4 }),
      seg('hello?', 20), seg('hello?', 24), seg('hello?', 28), seg('hello?', 32),
      seg('Creta ki delivery kab hogi?', 36, { avg_logprob: -1.2 }),
    ])
    assert('real speech is kept', out.segments.some((s) => s.t.startsWith('Namaste')))
    assert('a "thank you for watching" outro on silence is dropped', !out.segments.some((s) => /watching/i.test(s.t)) && out.quality.droppedOutro === 1)
    assert('a repetition loop (compression ratio > 2.4) is dropped', out.quality.droppedRepetition === 1)
    assert('silence Whisper filled with text is dropped', out.quality.droppedSilence === 2)
    assert('the same line more than twice is a loop — the extra copies are dropped', out.segments.filter((s) => s.t === 'hello?').length === 2 && out.quality.droppedDuplicate === 2)
    assert('a low-confidence line is kept but flagged', out.segments.find((s) => s.t.startsWith('Creta'))?.f === 1)
    assert('there is a conversation', !out.noConversation && out.speechSeconds > 3)
    const ringing = filterSegments([seg('Thank you for watching!', 0, { no_speech_prob: 0.7, avg_logprob: -0.6 }), seg('.', 5, { no_speech_prob: 0.95, avg_logprob: -2 })])
    assert('ringing with an invented outro counts as "no conversation"', ringing.noConversation)
    assert('an empty transcript counts as "no conversation"', filterSegments([]).noConversation)
    const glossary = 'AM Hyundai Jammu. Service, booking, delivery, test drive, insurance, EMI, loan, exchange, Samba, Udhampur.'
    const echoed = filterSegments([seg('Haan ji, Creta ki service kab hai?', 0), seg('Service, booking, delivery, test drive, insurance, EMI, loan, exchange, Samba, Udhampur.', 4)], { prompt: glossary })
    assert('a line that is just the Whisper prompt read back (seen on real calls) is dropped', echoed.segments.length === 1 && echoed.quality.droppedPromptEcho === 1)
    assert('…while a real line that shares a word or two with it is kept', echoed.segments[0].t.startsWith('Haan ji'))

    assert('m4a is recognised from its ftyp box', sniffAudio(M4A) === 'm4a')
    assert('mp3 is recognised (ID3 and frame sync)', sniffAudio(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0])) === 'mp3' && sniffAudio(new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0])) === 'mp3')
    assert('an HTML error page is not audio', sniffAudio(new TextEncoder().encode('<!DOCTYPE html><html>')) === null)
    assert('mime → extension: audio/mp4 → m4a, audio/mpeg → mp3, amr → unsupported', audioExtension('audio/mp4', null) === 'm4a' && audioExtension('audio/mpeg', null) === 'mp3' && audioExtension(null, 'amr') === null)

    assert('a spoken phone number is masked', maskNumbers('mera number 9876543210 hai') === 'mera number [number] hai')
    assert('…also when read out in groups', maskNumbers('98765 43210') === '[number]' && maskNumbers('98-765-43210') === '[number]')
    assert('…and in Devanagari digits', maskNumbers('नंबर ९८७६५४३२१० है') === 'नंबर [number] है')
    assert('short numbers (a price, a model year) are left alone', maskNumbers('2 lakh ka discount, 2024 model') === '2 lakh ka discount, 2024 model')
  }

  console.log('\n2) The verdict: schema, derivation, sanitising')
  {
    const schema = analysisJsonSchema() as Record<string, any>
    let objects = 0
    let strictObjects = 0
    let banned = 0
    const walk = (node: any) => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (!node || typeof node !== 'object') return
      if (node.type === 'object') {
        objects += 1
        const keys = Object.keys(node.properties || {})
        if (node.additionalProperties === false && JSON.stringify([...node.required].sort()) === JSON.stringify([...keys].sort())) strictObjects += 1
      }
      for (const key of ['pattern', 'maxLength', 'minimum', 'maximum', '$schema']) if (key in node) banned += 1
      Object.values(node).forEach(walk)
    }
    walk(schema)
    assert('every object in the response schema is strict (all keys required, no extras)', objects > 5 && objects === strictObjects, `${strictObjects}/${objects}`)
    assert('keywords strict mode may reject are stripped (zod still checks them)', banned === 0)
    assert('nullable fields are expressed as anyOf … null', JSON.stringify(schema).includes('"type":"null"'))

    const cases: Array<[string, Analysis, string]> = [
      ['a complaint', analysis({ complaint: { is_complaint: true, about: 'delay', severity: 'high' }, mood_end: 'angry' }), 'complaint'],
      ['an angry customer without a complaint', analysis({ mood_end: 'angry' }), 'unhappy'],
      ['a hot lead', analysis({ lead: { temperature: 'hot', models: ['Creta'], exchange_vehicle: null, finance_needed: true } }), 'hot_lead'],
      ['a dealer promise', analysis({ commitments: [{ by: 'dealer', what: 'Call back with price', due: '2026-09-19' }] }), 'follow_up'],
      ['a service booking', analysis({ intent: 'service_booking' }), 'service'],
      ['a service slot booked for tomorrow (routine, not a follow-up)', analysis({ intent: 'service_booking', commitments: [{ by: 'dealer', what: 'Service at 3 pm', due: '2026-09-19' }] }), 'service'],
      ['a garbled call (confidence 0.3)', analysis({ confidence: 0.3, needs_human_review: true }), 'unclear'],
      ['…unless it is clearly a complaint', analysis({ confidence: 0.3, complaint: { is_complaint: true, about: 'x', severity: 'low' } }), 'complaint'],
      ['a delivery question', analysis({ intent: 'delivery_status' }), 'enquiry'],
      ['a happy feedback call', analysis({ intent: 'feedback', mood_end: 'satisfied' }), 'satisfied'],
      ['something else', analysis({ intent: 'other' }), 'general'],
      ['a personal call', analysis({ conversation: 'personal' }), 'not_customer'],
    ]
    for (const [label, a, expected] of cases) assert(`${label} → ${expected}`, deriveVerdict(a) === expected, deriveVerdict(a))
    assert('complaints and unhappy customers need attention', needsAttention(cases[0][1], 'complaint') && needsAttention(cases[1][1], 'unhappy'))
    assert('rude staff on an ordinary enquiry needs attention', needsAttention(analysis({ red_flags: ['rude_staff'] }), 'enquiry'))
    assert('a sensitive call the model understood but flags for a human needs attention', needsAttention(analysis({ needs_human_review: true }), 'enquiry'))
    assert('a garbled call does NOT flood the attention queue', !needsAttention(analysis({ needs_human_review: true, confidence: 0.3 }), 'unclear'))
    assert('…unless it carries a serious red flag', needsAttention(analysis({ confidence: 0.3, red_flags: ['legal_threat'] }), 'unclear'))
    assert('a routine enquiry does not', !needsAttention(analysis(), 'enquiry'))
    assert('the follow-up date is the dealer\'s earliest promise — the customer\'s promises do not count', dealerFollowUpDue(analysis({
      commitments: [{ by: 'customer', what: 'Will visit', due: '2026-09-19' }, { by: 'dealer', what: 'Send quote', due: '2026-09-21' }],
      next_action: { needed: true, what: 'Call back', owner: 'sales', due: '2026-09-20' },
    })) === '2026-09-20')

    const segments = [{ s: 0, e: 4, t: 'Gaadi ki delivery teen din se late hai' }, { s: 4, e: 8, t: 'Main kal tak update dunga sir' }]
    const cleaned = sanitizeAnalysis(analysis({
      evidence: [
        { segment: 0, speaker_guess: 'customer', quote: '"delivery teen din se late"', meaning_en: 'Delivery is three days late' },
        { segment: 1, speaker_guess: 'dealer', quote: 'I will refund you', meaning_en: 'invented' },
        { segment: 9, speaker_guess: 'dealer', quote: 'late hai', meaning_en: 'wrong segment' },
      ],
      commitments: [{ by: 'dealer', what: 'Update', due: '2026-09-19' }, { by: 'dealer', what: 'Deliver', due: '2031-01-01' }],
    }), segments, '2026-09-18T08:00:00Z')
    assert('a real quote is kept (surrounding quote marks trimmed)', cleaned.evidence.length === 1 && cleaned.evidence[0].quote === 'delivery teen din se late')
    assert('a quote that is not in its segment — or cites a segment that does not exist — is dropped', !cleaned.evidence.some((e) => e.meaning_en === 'invented' || e.meaning_en === 'wrong segment'))
    assert('a due date years away is dropped, a sane one kept', cleaned.commitments[0].due === '2026-09-19' && cleaned.commitments[1].due === null)
    const personal = sanitizeAnalysis(analysis({ conversation: 'personal', summary_en: 'Talked to his wife about dinner', evidence: [{ segment: 0, speaker_guess: 'dealer', quote: 'Gaadi', meaning_en: 'x' }] }), segments, null)
    assert('a personal call keeps its class and nothing about the conversation', personal.summary_en === '' && personal.evidence.length === 0 && personal.intent === 'other')

    // The model call itself: a bad first answer gets one repair turn.
    let calls = 0
    const chat: ChatFn = async () => {
      calls += 1
      return calls === 1
        ? { content: '{"conversation": "customer_call", oops', tokensIn: 100, tokensOut: 10, model: 'm' }
        : { content: JSON.stringify(analysis({ headline_en: 'x'.repeat(500) })), tokensIn: 200, tokensOut: 50, model: 'm' }
    }
    const outcome = await analyseTranscript({ segments, meta: { team: 'Hyundai Jammu', callType: 'incoming', recordedAt: '2026-09-18T08:00:00Z', durationSeconds: 60, sttLanguage: 'hi' }, model: 'm', timeoutMs: 1000, chat })
    assert('invalid JSON gets one repair turn, then succeeds', outcome.calls === 2 && calls === 2)
    assert('tokens from both turns are counted', outcome.tokensIn === 300 && outcome.tokensOut === 60)
    assert('an over-long headline is trimmed, not rejected', outcome.analysis.headline_en.length === 120)
    let refused = false
    try {
      await analyseTranscript({ segments, meta: { team: null, callType: null, recordedAt: null, durationSeconds: null, sttLanguage: null }, model: 'm', timeoutMs: 1000, chat: async () => ({ content: '{}', tokensIn: 1, tokensOut: 1, model: 'm' }) })
    } catch (error) { refused = error instanceof AiProviderError && error.kind === 'transient' }
    assert('an answer that fails validation twice is a retryable failure, not a stored verdict', refused)

    // Groq's own strict check can reject a generation with a 400 (seen on a real call) — one retry in JSON mode.
    const savedKey = process.env.CALL_GROQ_API_KEY
    process.env.CALL_GROQ_API_KEY = 'test-key-not-real'
    const formats: string[] = []
    const fakeFetch = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      formats.push(body.response_format.type)
      if (body.response_format.type === 'json_schema') {
        return new Response(JSON.stringify({ error: { message: 'Generated JSON does not match the expected schema. Please adjust your prompt.', code: 'json_validate_failed' } }), { status: 400 })
      }
      return new Response(JSON.stringify({ model: 'm', choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }), { status: 200 })
    }
    const recovered = await chatJson({ model: 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'x' }], schemaName: 's', schema: { type: 'object' }, maxTokens: 10, timeoutMs: 1000, fetchImpl: fakeFetch })
    assert('a 400 "does not match the expected schema" is retried once in JSON mode, not failed', recovered.content === '{"ok":true}' && JSON.stringify(formats) === '["json_schema","json_object"]')
    let hardFail = false
    try {
      await chatJson({ model: 'm', messages: [], schemaName: 's', schema: {}, maxTokens: 10, timeoutMs: 1000, fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 400 }) })
    } catch (error) { hardFail = error instanceof GroqError && error.kind === 'permanent' }
    assert('…any other 400 is still a permanent error', hardFail)
    // Translate mode (the default since the pilot): Whisper's speech-to-English endpoint, no language pinned.
    const seen: Array<{ url: string; language: FormDataEntryValue | null; granularity: FormDataEntryValue | null }> = []
    const whisperFetch = async (url: string, init?: RequestInit) => {
      const form = init?.body as FormData
      seen.push({ url, language: form.get('language'), granularity: form.get('timestamp_granularities[]') })
      return new Response(JSON.stringify({ language: 'English', duration: 12, text: 'Hello', segments: [{ id: 0, start: 0, end: 2, text: 'Hello sir', avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.2 }] }), { status: 200 })
    }
    const common = { audio: new Uint8Array([1, 2, 3]), fileName: `${crypto.randomUUID()}.m4a`, contentType: 'audio/mp4', model: 'whisper-large-v3', language: 'hi', timeoutMs: 1000, fetchImpl: whisperFetch }
    const translated = await transcribe({ ...common, task: 'translate' })
    await transcribe({ ...common, task: 'transcribe' })
    assert('translate mode calls /audio/translations and does not pin a language', seen[0].url.endsWith('/audio/translations') && seen[0].language === null && translated.segments[0].text === 'Hello sir')
    assert('transcribe mode calls /audio/transcriptions with the language and segment timestamps', seen[1].url.endsWith('/audio/transcriptions') && seen[1].language === 'hi' && seen[1].granularity === 'segment')

    // ── The production stack: ElevenLabs Scribe transcribes, Claude writes the verdict ──
    const savedEnv = { ...process.env }
    delete process.env.CALL_AI_STT_PROVIDER
    delete process.env.CALL_AI_LLM_PROVIDER
    delete process.env.CALL_AI_LLM_MODEL
    delete process.env.CALL_AI_STT_MODEL
    const defaults = callAiConfig()
    assert('by default ElevenLabs Scribe v2 transcribes and Claude Opus 5 writes the verdict', defaults.sttProvider === 'elevenlabs' && defaults.sttModel === 'scribe_v2' && defaults.llmProvider === 'anthropic' && defaults.llmModel === 'claude-opus-5' && defaults.llmEffort === 'medium')
    process.env.CALL_AI_STT_PROVIDER = 'groq'
    process.env.CALL_AI_LLM_PROVIDER = 'groq'
    assert('Groq stays selectable for testing', callAiConfig().sttModel === 'whisper-large-v3' && callAiConfig().llmModel === 'openai/gpt-oss-120b')
    process.env = { ...savedEnv }

    const scribeWords = [
      { text: 'नमस्ते', type: 'word', start: 0.0, end: 0.4, speaker_id: 'speaker_1', logprob: -0.1 },
      { text: ' ', type: 'spacing', start: 0.4, end: 0.5, speaker_id: 'speaker_1' },
      { text: 'सर', type: 'word', start: 0.5, end: 0.8, speaker_id: 'speaker_1', logprob: -0.2 },
      { text: '(laughs)', type: 'audio_event', start: 0.8, end: 1.0, speaker_id: 'speaker_1' },
      { text: 'हाँ', type: 'word', start: 1.1, end: 1.4, speaker_id: 'speaker_0', logprob: -0.3 },
      { text: ' ', type: 'spacing', start: 1.4, end: 1.5, speaker_id: 'speaker_0' },
      { text: 'बोलिए', type: 'word', start: 1.5, end: 1.9, speaker_id: 'speaker_0', logprob: -0.1 },
      { text: 'Creta', type: 'word', start: 4.0, end: 4.4, speaker_id: 'speaker_0', logprob: -0.5 },
      { text: 'ठीक', type: 'word', start: 4.6, end: 4.9, speaker_id: 'speaker_1', logprob: -0.1 },
    ]
    const lines = groupScribeWords(scribeWords)
    assert('Scribe words become lines, a new line on each change of voice', lines.length === 4 && lines[0].text === 'नमस्ते सर' && lines[1].text === 'हाँ बोलिए')
    assert('…and after a pause of over a second from the same voice', lines[2].text === 'Creta' && lines[2].speaker === lines[1].speaker)
    assert('voices are named S1, S2 in order of first appearance, and audio events are not speech', lines[0].speaker === 'S1' && lines[1].speaker === 'S2' && lines[3].speaker === 'S1' && !lines.some((l) => l.text.includes('laughs')))
    const filteredScribe = filterSegments(lines)
    assert('the voice label survives the transcript filter', filteredScribe.segments.every((seg) => seg.p === 'S1' || seg.p === 'S2'))
    const labelled = buildUserMessage({ team: 'Hyundai Jammu', callType: 'outgoing', recordedAt: '2026-09-18T08:30:00Z', durationSeconds: 5, sttLanguage: 'hi' }, filteredScribe.segments)
    assert('the model sees each line with its voice label', labelled.includes('S1: नमस्ते सर') && labelled.includes('S2: हाँ बोलिए') && labelled.includes('voices labelled S1, S2'))

    const keyBefore = process.env.ELEVENLABS_API_KEY
    process.env.ELEVENLABS_API_KEY = 'test-key-not-real'
    const scribeSeen: Array<{ url: string; model: FormDataEntryValue | null; diarize: FormDataEntryValue | null; language: FormDataEntryValue | null; key: string | null; file: string }> = []
    const scribeFetch = async (url: string, init?: RequestInit) => {
      const form = init?.body as FormData
      const file = form.get('file') as File
      scribeSeen.push({ url, model: form.get('model_id'), diarize: form.get('diarize'), language: form.get('language_code'), key: new Headers(init?.headers).get('xi-api-key'), file: file?.name ?? '' })
      if (scribeSeen.length === 2) return new Response(JSON.stringify({ detail: { message: 'Too many concurrent requests' } }), { status: 429, headers: { 'retry-after': '7' } })
      return new Response(JSON.stringify({ language_code: 'hin', text: 'x', audio_duration_secs: 5.2, words: scribeWords }), { status: 200 })
    }
    const scribeFile = `${crypto.randomUUID()}.m4a`
    const scribe = await transcribeElevenLabs({ audio: new Uint8Array([1, 2, 3]), fileName: scribeFile, contentType: 'audio/mp4', model: 'scribe_v2', language: 'hi', timeoutMs: 1000, fetchImpl: scribeFetch })
    assert('ElevenLabs is called with Scribe v2, speaker separation on, Hindi, the xi-api-key header and the recording-id file name', scribeSeen[0].url === 'https://api.elevenlabs.io/v1/speech-to-text' && scribeSeen[0].model === 'scribe_v2' && scribeSeen[0].diarize === 'true' && scribeSeen[0].language === 'hi' && scribeSeen[0].key === 'test-key-not-real' && scribeSeen[0].file === scribeFile)
    assert('…and its reply becomes speaker-labelled lines with the audio length', scribe.segments.length === 4 && scribe.duration === 5.2 && scribe.language === 'hin')
    let scribe429: AiProviderError | null = null
    try { await transcribeElevenLabs({ audio: new Uint8Array([1]), fileName: scribeFile, contentType: 'audio/mp4', model: 'scribe_v2', timeoutMs: 1000, fetchImpl: scribeFetch }) } catch (error) { scribe429 = error as AiProviderError }
    assert('an ElevenLabs 429 is a rate limit with its retry-after', scribe429 instanceof AiProviderError && scribe429.kind === 'rate_limited' && scribe429.retryAfterSeconds === 7)
    delete process.env.ELEVENLABS_API_KEY
    let noScribeKey = false
    try { await transcribeElevenLabs({ audio: new Uint8Array([1]), fileName: scribeFile, contentType: 'audio/mp4', model: 'scribe_v2', timeoutMs: 1000, fetchImpl: scribeFetch }) } catch (error) { noScribeKey = error instanceof AiProviderError && error.kind === 'config' }
    assert('no ELEVENLABS_API_KEY stops the run as a configuration error', noScribeKey)
    if (keyBefore === undefined) delete process.env.ELEVENLABS_API_KEY
    else process.env.ELEVENLABS_API_KEY = keyBefore

    const anthropicBefore = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real'
    const claudeBodies: Array<Record<string, any>> = []
    const claudeHeaders: string[] = []
    let claudeMode: 'ok' | 'refusal' | 'rate' | 'auth' = 'ok'
    const claudeFetch = async (url: string, init?: RequestInit) => {
      claudeBodies.push(JSON.parse(String(init?.body)))
      claudeHeaders.push(new Headers(init?.headers).get('anthropic-beta') ?? '')
      if (claudeMode === 'rate') return new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }), { status: 429, headers: { 'retry-after': '1', 'content-type': 'application/json' } })
      if (claudeMode === 'auth') return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5',
        content: claudeMode === 'refusal' ? [] : [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: JSON.stringify(analysis()) }],
        stop_reason: claudeMode === 'refusal' ? 'refusal' : 'end_turn', stop_sequence: null,
        usage: { input_tokens: 900, output_tokens: 700, cache_read_input_tokens: 1600, cache_creation_input_tokens: 0 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const claudeOut = await analyseTranscript({
      segments: filteredScribe.segments,
      meta: { team: 'Hyundai Jammu', callType: 'outgoing', recordedAt: '2026-09-18T08:30:00Z', durationSeconds: 5, sttLanguage: 'hin' },
      model: 'claude-opus-5', timeoutMs: 5000,
      chat: (input) => chatClaude({ ...input, effort: 'medium', fetchImpl: claudeFetch }),
    })
    const sent = claudeBodies[0]
    assert('Claude gets the verdict schema as a strict JSON output format, effort medium, and the refusal fallback', sent.model === 'claude-opus-5' && sent.output_config?.format?.type === 'json_schema' && sent.output_config?.effort === 'medium' && sent.fallbacks === 'default' && claudeHeaders[0].includes('server-side-fallback-2026-07-01'))
    assert('the fixed instructions are sent as a cached system prompt, the call as the user turn', Array.isArray(sent.system) && sent.system[0].cache_control?.type === 'ephemeral' && sent.system[0].text.includes('AM Hyundai') && sent.messages.length === 1 && sent.messages[0].role === 'user')
    assert('Claude\'s JSON (after a thinking block) becomes the verdict, with cache tokens counted', claudeOut.verdict === 'enquiry' && claudeOut.tokensIn === 900 && claudeOut.cacheReadTokens === 1600 && claudeOut.tokensOut === 700)
    assert('no phone number or contact name reaches Claude', !JSON.stringify(claudeBodies).includes(PHONE) && !JSON.stringify(claudeBodies).includes(CONTACT))
    const claudeError = async (mode: typeof claudeMode) => {
      claudeMode = mode
      try {
        await chatClaude({ model: 'claude-opus-5', messages: [{ role: 'user', content: 'x' }], schemaName: 's', schema: { type: 'object' }, maxTokens: 10, timeoutMs: 5000, fetchImpl: claudeFetch })
        return null
      } catch (error) { return error as AiProviderError }
    }
    const refusal = await claudeError('refusal')
    assert('a refusal the fallback chain could not rescue is a permanent failure, not an empty verdict', refusal instanceof AiProviderError && refusal.kind === 'permanent')
    const rate = await claudeError('rate')
    assert('a Claude 429 (after the SDK\'s own retries) is a rate limit with its retry-after', rate instanceof AiProviderError && rate.kind === 'rate_limited' && rate.retryAfterSeconds === 1)
    const auth = await claudeError('auth')
    assert('a refused Claude key is a configuration error', auth instanceof AiProviderError && auth.kind === 'config')
    delete process.env.ANTHROPIC_API_KEY
    const noKey = await claudeError('ok')
    assert('no ANTHROPIC_API_KEY stops the run as a configuration error', noKey instanceof AiProviderError && noKey.kind === 'config')
    if (anthropicBefore === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = anthropicBefore
    if (savedKey === undefined) delete process.env.CALL_GROQ_API_KEY
    else process.env.CALL_GROQ_API_KEY = savedKey
  }

  console.log('\n3) Scope (AM Hyundai only), privacy, skip rules, access wiring')
  {
    const scopes = ['hyundai']
    const inScope = (row: { cre_id: string; branch_id: string | null }) => classifyScope(row, fakeDir, scopes)
    const hyundai = inScope({ cre_id: ids.creH, branch_id: null })
    assert('a Hyundai Jammu call with no branch on the row (profile fallback) is IN', hyundai.inScope && hyundai.team === 'Hyundai Jammu')
    const raman = inScope({ cre_id: ids.creRaman, branch_id: ids.bSpecial })
    assert('the special-team Hyundai service CRE is IN', raman.inScope && raman.team === 'Special Branch (Hyundai service)')
    assert('the H Promise desk is OUT (owner excluded it)', !inScope({ cre_id: ids.creHeena, branch_id: ids.bSpecial }).inScope)
    assert('a Kia call is OUT', !inScope({ cre_id: ids.creKia, branch_id: null }).inScope)
    assert('a Honda call is OUT', !inScope({ cre_id: ids.creHonda, branch_id: ids.bHonda }).inScope)
    assert('a special-team CRE nobody has mapped is OUT', !inScope({ cre_id: ids.creUnmapped, branch_id: null }).inScope)
    assert('a Kia CRE whose ROW says Hyundai counts as Hyundai (the row wins, as on the Recordings tab)', inScope({ cre_id: ids.creKia, branch_id: ids.bHyundai }).inScope)
    assert('widening is config only: scope "kia" takes the Kia call', classifyScope({ cre_id: ids.creKia, branch_id: null }, fakeDir, ['kia']).inScope)

    const k1 = phoneKey('+91 90000 00001')
    const k2 = phoneKey('9000000001')
    assert('the phone key is the same for the same number in any format', Boolean(k1) && k1 === k2)
    assert('…and carries none of its digits', !String(k1).includes('90000') && !String(k1).includes(PHONE))

    const base = rec(crypto.randomUUID())
    assert('under 6 s is skipped before any spend', preSkipReason({ ...base, duration_seconds: 4 }) === 'too_short')
    assert('missed / rejected calls are skipped', preSkipReason({ ...base, call_type: 'missed' }) === 'not_connected' && preSkipReason({ ...base, call_type: 'rejected' }) === 'not_connected')
    assert('an unsupported format is skipped', preSkipReason({ ...base, mime_type: 'audio/amr', format: 'amr' }) === 'unsupported_format')
    assert('an over-size file is skipped', preSkipReason({ ...base, size_bytes: 30 * 1024 * 1024 }) === 'too_large')
    assert('an ordinary call is transcribed', preSkipReason(base) === null)

    const message = buildUserMessage({ team: 'Special Branch (Hyundai service)', callType: 'incoming', recordedAt: '2026-09-18T08:30:00Z', durationSeconds: 102, sttLanguage: 'hi' },
      [{ s: 0, e: 3, t: `mera number ${PHONE} hai` }])
    assert('the model is told the team, direction, IST date and length', message.includes('Hyundai service desk') && message.includes('incoming') && message.includes('2026-09-18') && message.includes('14:00') && message.includes('1 min 42 s'))
    assert('…and never the number spoken in the call', !message.includes(PHONE) && message.includes('[number]'))

    // Every call-analysis route uses the page's access rule.
    const routes: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (name === 'route.ts') routes.push(path)
      }
    }
    walk('app/api/call-analysis')
    const offenders = routes.filter((path) => !read(path).includes('requireCallAnalysisApi()') || read(path).includes('canViewCallAnalysis('))
    assert(`all ${routes.length} /api/call-analysis routes use requireCallAnalysisApi (role OR grant, like the page)`, routes.length >= 16 && offenders.length === 0, offenders.join(', '))
    for (const path of ['app/api/call-analysis/ai/run/route.ts', 'app/api/call-analysis/ai/status/route.ts', 'app/api/call-analysis/ai/reviews/[id]/reanalyse/route.ts', 'app/api/call-analysis/ai/digest/route.ts']) {
      assert(`${path.replace('app/api/call-analysis/ai/', 'ai/')} is MD / developer only`, read(path).includes('isCallAiAdmin('))
    }
    assert('the worker and the digest are behind the fail-closed cron gate', read('app/api/call-analysis/ai/run/route.ts').includes('authorizeCronRequest(') && read('app/api/call-analysis/ai/digest/route.ts').includes('authorizeCronRequest('))
    const digestRoute = read('app/api/call-analysis/ai/digest/route.ts')
    assert('a signed-in person can only PREVIEW the digest, never send it', /dryRun: true/.test(digestRoute) && digestRoute.indexOf('dryRun: true') > digestRoute.indexOf('requireCallAnalysisApi()'))
    const crons = JSON.parse(read('vercel.json')).crons as Array<{ path: string; schedule: string }>
    assert('vercel.json runs the worker every 10 min and the email at 09:00 IST', crons.some((c) => c.path === '/api/call-analysis/ai/run' && c.schedule === '*/10 * * * *') && crons.some((c) => c.path === '/api/call-analysis/ai/digest' && c.schedule === '30 3 * * *'))

    const saved = { cron: process.env.CRON_SECRET }
    const url = new URL('https://x.test/api/call-analysis/ai/run')
    delete process.env.CRON_SECRET
    assert('cron gate: no secret configured → 503 (refuses to run)', authorizeCronRequest(new Request(url), url, { secret: undefined, secretEnvName: 'X' }).ok === false
      && (authorizeCronRequest(new Request(url), url, { secret: undefined, secretEnvName: 'X' }) as { status: number }).status === 503)
    process.env.CRON_SECRET = 'cron-test-secret'
    const wrong = authorizeCronRequest(new Request(url, { headers: { authorization: 'Bearer nope' } }), url, { secret: undefined, secretEnvName: 'X' })
    assert('cron gate: a wrong secret → 403', !wrong.ok && (wrong as { status: number }).status === 403)
    assert('cron gate: the right Bearer → allowed', authorizeCronRequest(new Request(url, { headers: { authorization: 'Bearer cron-test-secret' } }), url, { secret: undefined, secretEnvName: 'X' }).ok)
    if (saved.cron === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = saved.cron
  }

  // ── 4. The real worker + database, with a fake CRE project and a fake Groq ───────────────────────
  console.log('\n4) The real pipeline against the database (fake handsets, fake Groq, rolled back)')
  const R = {
    complaint: crypto.randomUUID(), hot: crypto.randomUUID(), personal: crypto.randomUUID(), silence: crypto.randomUUID(),
    short: crypto.randomUUID(), missed: crypto.randomUUID(), heena: crypto.randomUUID(), kia: crypto.randomUUID(),
    honda: crypto.randomUUID(), transient: crypto.randomUUID(), fail: crypto.randomUUID(), rateLimited: crypto.randomUUID(),
    script: crypto.randomUUID(),
  }
  const recordings = new Map<string, CreRecording>([
    [R.complaint, rec(R.complaint, { minutesAgo: 20 })],
    [R.hot, rec(R.hot, { minutesAgo: 21, call_type: 'outgoing', cre_id: ids.creRaman, branch_id: ids.bSpecial })],
    [R.personal, rec(R.personal, { minutesAgo: 22 })],
    [R.silence, rec(R.silence, { minutesAgo: 23 })],
    [R.short, rec(R.short, { minutesAgo: 24, duration_seconds: 3 })],
    [R.missed, rec(R.missed, { minutesAgo: 25, call_type: 'missed' })],
    [R.heena, rec(R.heena, { minutesAgo: 26, cre_id: ids.creHeena, branch_id: ids.bSpecial })],
    [R.kia, rec(R.kia, { minutesAgo: 27, cre_id: ids.creKia })],
    [R.honda, rec(R.honda, { minutesAgo: 28, cre_id: ids.creHonda, branch_id: ids.bHonda })],
    [R.transient, rec(R.transient, { minutesAgo: 29 })],
    [R.fail, rec(R.fail, { minutesAgo: 31 })],
    [R.script, rec(R.script, { minutesAgo: 32 })],
  ])
  const transcript: Record<string, WhisperSegment[]> = {
    [R.complaint]: [seg('Sir meri Creta ki delivery teen din se late hai', 0), seg(`mera number ${PHONE} hai, CASE_COMPLAINT`, 4)],
    [R.hot]: [seg('Venue ka on-road price batao, main kal booking karunga CASE_HOT', 0)],
    [R.personal]: [seg('Haan beta ghar aa raha hoon, CASE_PERSONAL', 0)],
    [R.silence]: [seg('Thank you for watching!', 0, { no_speech_prob: 0.8, avg_logprob: -0.7 })],
    [R.transient]: [seg('Service ki date chahiye CASE_TRANSIENT', 0)],
    [R.fail]: [seg('Insurance renew karna hai CASE_FAIL', 0)],
    [R.script]: [seg('Exchange offer kya hai CASE_SCRIPT', 0)],
    [R.rateLimited]: [seg('Test drive chahiye CASE_RATE', 0)],
  }
  const tomorrow = (() => { const d = new Date(`${istToday()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) })()
  const answers: Record<string, () => Analysis> = {
    CASE_COMPLAINT: () => analysis({
      intent: 'delivery_status', mood_end: 'angry', satisfaction: 1, headline_en: 'Creta delivery three days late; customer angry',
      complaint: { is_complaint: true, about: 'Delivery delay', severity: 'high' }, red_flags: ['delay'],
      evidence: [{ segment: 0, speaker_guess: 'customer', quote: 'delivery teen din se late hai', meaning_en: 'Delivery is three days late' }],
    }),
    CASE_HOT: () => analysis({
      intent: 'booking_payment', mood_end: 'satisfied', headline_en: 'Venue price asked; will book tomorrow',
      lead: { temperature: 'hot', models: ['Venue'], exchange_vehicle: null, finance_needed: null },
      commitments: [{ by: 'dealer', what: 'Share on-road price on WhatsApp', due: tomorrow }],
    }),
    CASE_PERSONAL: () => analysis({ conversation: 'personal', headline_en: 'Personal call' }),
    CASE_TRANSIENT: () => analysis({ intent: 'service_booking', headline_en: 'Wants a service date' }),
    CASE_SCRIPT: () => analysis({ headline_en: '<script>alert(1)</script> exchange offer', intent: 'exchange_used_car', mood_end: 'dissatisfied' }),
    CASE_RATE: () => analysis({ intent: 'test_drive' }),
  }

  const counters = { transcribe: new Map<string, number>(), chat: 0 }
  const captured: { fileNames: string[]; chatBodies: string[] } = { fileNames: [], chatBodies: [] }
  let transientTripped = false
  let rateLimitArmed = true
  let rateLimitSeconds = 3600

  const source: CreSource = {
    loadDirectory: async () => fakeDir,
    listChanged: async (sinceAt, after, limit) => [...recordings.values()]
      .filter((r) => !r.deleted_at && r.upload_status === 'uploaded' && r.updated_at >= sinceAt)
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at) || a.id.localeCompare(b.id))
      .filter((r) => !after || r.updated_at > after.at || (r.updated_at === after.at && r.id > after.id))
      .slice(0, limit),
    listRecorded: async (fromIso, toIso, afterId, limit) => [...recordings.values()]
      .filter((r) => !r.deleted_at && r.recorded_at! >= fromIso && r.recorded_at! < toIso)
      .sort((a, b) => a.id.localeCompare(b.id))
      .filter((r) => !afterId || r.id > afterId)
      .slice(0, limit),
    listDeleted: async (sinceAt) => [...recordings.values()].filter((r) => r.deleted_at && r.deleted_at > sinceAt).map((r) => ({ id: r.id, deleted_at: r.deleted_at! })),
    getByIds: async (list) => list.map((id) => recordings.get(id)).filter(Boolean) as CreRecording[],
    signPaths: async (paths) => new Map(paths.map((p) => [p, `fake://${p}`])),
    download: async (url) => {
      if (url.includes('missing')) throw new DownloadError('Audio file not found (404)', true)
      return M4A
    },
  }
  const recIdOf = (fileName: string) => fileName.split('.')[0]
  const deps: WorkerDeps = {
    source,
    transcribe: async (input) => {
      captured.fileNames.push(input.fileName)
      const id = recIdOf(input.fileName)
      counters.transcribe.set(id, (counters.transcribe.get(id) ?? 0) + 1)
      if (id === R.rateLimited && rateLimitArmed) throw new GroqError('Groq rate limit: slow down', 'rate_limited', 429, rateLimitSeconds)
      const segments = transcript[id] ?? [seg('Hello', 0)]
      const result: WhisperResult = { language: 'hi', duration: 30, text: segments.map((s) => s.text).join(' '), segments }
      return result
    },
    chat: async (input) => {
      counters.chat += 1
      const body = JSON.stringify(input.messages)
      captured.chatBodies.push(body)
      const marker = Object.keys(answers).find((key) => body.includes(key))
      if (body.includes('CASE_TRANSIENT') && !transientTripped) { transientTripped = true; throw new GroqError('Groq 503: busy', 'transient', 503) }
      if (body.includes('CASE_FAIL')) throw new GroqError('Groq 503: still busy', 'transient', 503)
      return { content: JSON.stringify((answers[marker ?? ''] ?? (() => analysis()))()), tokensIn: 1200, tokensOut: 300, model: 'openai/gpt-oss-120b' }
    },
  }

  const env = { ...process.env }
  process.env.CALL_AI_SCOPE = 'hyundai'
  process.env.CALL_AI_ENABLED = 'true'
  process.env.CALL_AI_PHONE_KEY_SECRET = 'verify-secret'
  const deadline = () => Date.now() + 15 * 60_000

  try {
    await realDb.transaction(async (tx) => {
      let executes = 0
      const counting = new Proxy(tx as object, {
        get(target, prop) {
          const value = (target as Record<PropertyKey, unknown>)[prop]
          if (prop === 'execute' && typeof value === 'function') return (...args: unknown[]) => { executes += 1; return (value as (...a: unknown[]) => unknown).apply(target, args) }
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
        },
      })
      useOuterTransaction(counting as unknown as typeof realDb)
      // A clean state row for the test (the real one is restored by the rollback).
      await tx.execute(sql`UPDATE call_ai_state SET enabled = true, live_since = NULL, discover_cursor_at = NULL, discover_cursor_id = NULL,
        delete_cursor_at = NULL, swept_on = NULL, rate_limited_until = NULL, audio_day = NULL, audio_seconds_day = 0 WHERE id = 1`)
      // Real queued calls are visible inside this transaction; park them (rolled back) so the test only works its own.
      await tx.execute(sql`UPDATE call_ai_reviews SET next_attempt_at = 'infinity' WHERE status IN ('queued', 'processing') AND lock_token IS NULL`)
      await tx.execute(sql`UPDATE call_ai_reviews SET status = 'queued', lock_token = NULL, locked_until = NULL, next_attempt_at = 'infinity' WHERE status = 'processing'`)
      const beforeCount = Number((await tx.execute(sql`SELECT count(*)::int AS n FROM call_ai_reviews`) as unknown as Array<{ n: number }>)[0].n)

      const first = await runCallAi({ deadlineMs: deadline(), deps })
      const reviews = (await tx.execute(sql`SELECT cre_recording_id::text AS id, status, skip_reason, verdict, needs_attention, segments IS NULL AS no_segments,
          attempts, team_label, cre_name, phone_key, follow_up_due::text AS due, cost_usd::float AS cost FROM call_ai_reviews WHERE cre_recording_id::text IN (${sql.join(Object.values(R).map((id) => sql`${id}`), sql`, `)})`)) as unknown as Array<Record<string, any>>
      const by = new Map(reviews.map((r) => [r.id, r]))
      assert('discovery queued exactly the AM Hyundai recordings', [R.complaint, R.hot, R.personal, R.silence, R.short, R.missed, R.transient, R.fail, R.script].every((id) => by.has(id)))
      assert('Kia, Honda and the H Promise desk were never queued (no row, no cost)', ![R.kia, R.honda, R.heena].some((id) => by.has(id)))
      assert('a complaint call → Complaint, needs attention', by.get(R.complaint)?.status === 'done' && by.get(R.complaint)?.verdict === 'complaint' && by.get(R.complaint)?.needs_attention === true)
      assert('the special-team Hyundai call is labelled with its desk', by.get(R.hot)?.team_label === 'Special Branch (Hyundai service)' && by.get(R.hot)?.cre_name === 'Raman Bali')
      assert('a hot lead with a dealer promise → Hot lead, follow-up due tomorrow', by.get(R.hot)?.verdict === 'hot_lead' && by.get(R.hot)?.due === tomorrow)
      assert('a personal call → Not a customer call, and its transcript is wiped', by.get(R.personal)?.verdict === 'not_customer' && by.get(R.personal)?.no_segments === true)
      assert('a recording with no speech is skipped and never reaches the model', by.get(R.silence)?.status === 'skipped' && by.get(R.silence)?.skip_reason === 'no_conversation')
      assert('a 3-second call and a missed call are skipped before any spend', by.get(R.short)?.skip_reason === 'too_short' && by.get(R.missed)?.skip_reason === 'not_connected' && !counters.transcribe.has(R.short) && !counters.transcribe.has(R.missed))
      assert('a transient model error puts the job back, with its transcript kept', by.get(R.transient)?.status === 'queued' && by.get(R.transient)?.no_segments === false && by.get(R.transient)?.attempts === 1)
      assert('the phone key is stored, the phone is not', Boolean(by.get(R.complaint)?.phone_key) && !JSON.stringify(reviews).includes(PHONE))
      assert('cost is recorded per call', Number(by.get(R.complaint)?.cost) > 0)
      assert('the run reports what it did (pre-skips are decided at discovery, not counted as processed)', first.done === 4 && first.skipped === 1 && first.requeued === 2 && first.stoppedBecause === 'drained', JSON.stringify({ done: first.done, skipped: first.skipped, requeued: first.requeued, stopped: first.stoppedBecause, errors: first.errors, discoveryError: first.discoveryError }))

      await runCallAi({ deadlineMs: deadline(), deps })
      const afterSecond = Number((await tx.execute(sql`SELECT count(*)::int AS n FROM call_ai_reviews`) as unknown as Array<{ n: number }>)[0].n)
      assert('running discovery again queues nothing twice', afterSecond - beforeCount === 9, `${afterSecond - beforeCount}`)

      // The transient job again, once its backoff has passed: no second Whisper call.
      await tx.execute(sql`UPDATE call_ai_reviews SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE cre_recording_id::text = ${R.transient}`)
      await runCallAi({ deadlineMs: deadline(), deps, skipDiscovery: true })
      const transientRow = (await tx.execute(sql`SELECT status, verdict FROM call_ai_reviews WHERE cre_recording_id::text = ${R.transient}`) as unknown as Array<Record<string, any>>)[0]
      assert('a retried verdict reuses the saved transcript — Whisper is paid once', transientRow.status === 'done' && transientRow.verdict === 'service' && counters.transcribe.get(R.transient) === 1)

      // Three strikes.
      for (let i = 0; i < 3; i += 1) {
        await tx.execute(sql`UPDATE call_ai_reviews SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE cre_recording_id::text = ${R.fail} AND status = 'queued'`)
        await runCallAi({ deadlineMs: deadline(), deps, skipDiscovery: true })
      }
      const failRow = (await tx.execute(sql`SELECT status, attempts, last_error FROM call_ai_reviews WHERE cre_recording_id::text = ${R.fail}`) as unknown as Array<Record<string, any>>)[0]
      assert('a job that keeps failing gives up after 3 attempts', failRow.status === 'failed' && failRow.attempts === 3 && String(failRow.last_error).includes('503'), JSON.stringify(failRow))
      assert('…with Whisper still called only once', counters.transcribe.get(R.fail) === 1)

      // An hourly/daily cap (long retry-after): the job goes back without spending an attempt, and the pipeline pauses.
      recordings.set(R.rateLimited, rec(R.rateLimited, { minutesAgo: 5 }))
      const limited = await runCallAi({ deadlineMs: deadline(), deps })
      const rlRow = (await tx.execute(sql`SELECT status, attempts FROM call_ai_reviews WHERE cre_recording_id::text = ${R.rateLimited}`) as unknown as Array<Record<string, any>>)[0]
      const stateAfter = await readState()
      assert('a 429 re-queues the job with its attempt given back', rlRow?.status === 'queued' && rlRow.attempts === 0, JSON.stringify(rlRow))
      assert('…and pauses the pipeline until retry-after', limited.stoppedBecause === 'rate_limited' && Boolean(stateAfter.rateLimitedUntil) && new Date(stateAfter.rateLimitedUntil!) > new Date())
      const paused = await runCallAi({ deadlineMs: deadline(), deps })
      assert('a run during the pause does nothing', paused.stoppedBecause === 'rate_limited' && paused.claimed === 0)
      await writeState({ rateLimitedUntil: null })
      rateLimitArmed = false
      await tx.execute(sql`UPDATE call_ai_reviews SET next_attempt_at = NULL WHERE cre_recording_id::text = ${R.rateLimited}`)
      await runCallAi({ deadlineMs: deadline(), deps, skipDiscovery: true })
      const rlDone = (await tx.execute(sql`SELECT status FROM call_ai_reviews WHERE cre_recording_id::text = ${R.rateLimited}`) as unknown as Array<Record<string, any>>)[0]
      assert('after the pause it is processed normally', rlDone?.status === 'done')

      // A per-minute limit (short retry-after, the free tier's 8K tokens/min): the run waits and carries on.
      rateLimitArmed = true
      rateLimitSeconds = 5
      await tx.execute(sql`UPDATE call_ai_reviews SET status = 'queued', next_attempt_at = NULL, segments = NULL, attempts = 0 WHERE cre_recording_id::text = ${R.rateLimited}`)
      const waits: number[] = []
      // The fake sleep stands in for the wait: it lets the retry time arrive (the requeued job's next_attempt_at).
      const shortRun = await runCallAi({ deadlineMs: deadline(), skipDiscovery: true, deps: { ...deps, sleep: async (ms) => {
        waits.push(ms)
        rateLimitArmed = false
        await tx.execute(sql`UPDATE call_ai_reviews SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE cre_recording_id::text = ${R.rateLimited} AND status = 'queued'`)
      } } })
      const shortRow = (await tx.execute(sql`SELECT status FROM call_ai_reviews WHERE cre_recording_id::text = ${R.rateLimited}`) as unknown as Array<Record<string, any>>)[0]
      const shortState = await readState()
      assert('a per-minute limit is waited out inside the run, and the call is finished in the same run', shortRow?.status === 'done' && waits.length === 1 && waits[0] >= 5000 && shortRun.done >= 1)
      assert('…without pausing the whole pipeline', !shortState.rateLimitedUntil || new Date(shortState.rateLimitedUntil) <= new Date())

      // Leases: a stale lease is reclaimed and the old worker can no longer write.
      await tx.execute(sql`UPDATE call_ai_reviews SET status = 'queued', next_attempt_at = NULL WHERE cre_recording_id::text = ${R.script}`)
      const [claimedA] = await claimJobs(1, 6)
      await tx.execute(sql`UPDATE call_ai_reviews SET locked_until = clock_timestamp() - interval '1 second' WHERE id = ${claimedA.id}::uuid`)
      const [claimedB] = await claimJobs(1, 6)
      assert('a lease that ran out is reclaimed with a new token', claimedB?.id === claimedA.id && claimedB.lockToken !== claimedA.lockToken)
      assert('the old worker\'s write is refused (compare-and-swap on the token)', (await completeSkipped(claimedA.id, claimedA.lockToken, 'too_short')) === false)
      assert('the current worker\'s write is accepted', (await completeSkipped(claimedB.id, claimedB.lockToken, 'too_short')) === true)
      await tx.execute(sql`UPDATE call_ai_reviews SET status = 'queued', skip_reason = NULL, attempts = 0 WHERE id = ${claimedA.id}::uuid`)
      await runCallAi({ deadlineMs: deadline(), deps, skipDiscovery: true })

      // Reads.
      const filters = (extra: Record<string, string> = {}) => parseReviewFilters(new URLSearchParams({ from: istToday(), to: istToday(), pageSize: '100', ...extra }))
      executes = 0
      const attention = await listReviews(filters())
      assert('the list is ONE database statement', executes === 1, `${executes}`)
      const attentionIds = new Set(attention.rows.map((r) => r.recordingId))
      assert('"Needs attention" has the complaint, the unhappy customer and today/overdue promises', attentionIds.has(R.complaint) && attentionIds.has(R.script))
      assert('…and not the personal call or the routine service call', !attentionIds.has(R.personal) && !attentionIds.has(R.transient))
      assert('the digest counts add up', attention.digest.complaints >= 1 && attention.digest.unhappy >= 1 && attention.digest.hotLeads >= 1 && attention.digest.skipped >= 3 && attention.digest.inScope >= 10)
      const hot = await listReviews(filters({ queue: 'hot' }))
      assert('"Hot leads" has the hot lead', hot.rows.some((r) => r.recordingId === R.hot))
      const notCustomer = await listReviews(filters({ queue: 'not_customer' }))
      assert('"Not customer calls" has the personal call and the skipped ones', notCustomer.rows.some((r) => r.recordingId === R.personal) && notCustomer.rows.some((r) => r.recordingId === R.short))
      const search = await listReviews(filters({ queue: 'all', q: 'delivery late' }))
      assert('English search finds "delivery late"', search.rows.some((r) => r.recordingId === R.complaint) && !search.rows.some((r) => r.recordingId === R.hot))
      const byTeam = await listReviews(filters({ queue: 'all', team: 'Special Branch (Hyundai service)' }))
      assert('filtering by desk works', byTeam.rows.length >= 1 && byTeam.rows.every((r) => r.team === 'Special Branch (Hyundai service)'))

      const complaintId = attention.rows.find((r) => r.recordingId === R.complaint)!.id
      executes = 0
      const detail = await getReview(complaintId)
      assert('the detail is ONE statement and carries the transcript and the analysis', executes === 1 && (detail?.segments?.length ?? 0) === 2 && detail?.analysis?.complaint.is_complaint === true)
      assert('the stored transcript has the spoken number exactly as heard (masking is for what leaves, not what is kept)', JSON.stringify(detail?.segments).includes(PHONE) === true)
      const verdicts = await lookupVerdicts([R.complaint, R.kia, 'not-a-uuid'])
      assert('the Recordings-tab lookup returns in-scope verdicts only', verdicts[R.complaint]?.verdict === 'complaint' && !verdicts[R.kia])

      const userRow = (await tx.execute(sql`SELECT id FROM users WHERE is_active ORDER BY created_at LIMIT 1`) as unknown as Array<{ id: string }>)[0]
      assert('the MD can correct a verdict', await saveFeedback({ reviewId: complaintId, userId: userRow.id, userName: 'MD', verdictOk: false, correctedVerdict: 'unhappy', note: 'Not a formal complaint' }))
      const corrected = await getReview(complaintId)
      assert('…the correction is shown instead of the AI verdict, and kept in the history', corrected?.overrideVerdict === 'unhappy' && corrected.feedback.length === 1 && corrected.feedback[0].note === 'Not a formal complaint')
      assert('re-analysis puts a call back on the queue', await requeueReview(complaintId, false))

      // The 9 AM email — the send function is a stub; nothing leaves this machine.
      const sent: Array<{ to: string[]; subject: string; html: string }> = []
      const send = async (input: { to: string[]; subject: string; html: string }) => { sent.push(input); return { ok: true } }
      process.env.CALL_AI_DIGEST_RECIPIENTS = ''
      const none = await sendDailyDigest({ date: istToday(), send, source })
      assert('no recipients configured → no email at all', none.status === 'no_recipients' && sent.length === 0)
      process.env.CALL_AI_DIGEST_RECIPIENTS = 'md@example.test'
      const once = await sendDailyDigest({ date: istToday(), send, source })
      const twice = await sendDailyDigest({ date: istToday(), send, source })
      assert('the digest goes out once for a day, never twice', once.status === 'sent' && twice.status === 'already_sent' && sent.length === 1)
      assert('everything the AI wrote is escaped in the email', sent[0].html.includes('&lt;script&gt;') && !sent[0].html.includes('<script>'))
      assert('the email carries no phone number', !sent[0].html.includes(PHONE) && !sent[0].html.includes('90000'))
      assert('the subject counts the unhappy calls and hot leads', /unhappy/.test(sent[0].subject) && /hot lead/.test(sent[0].subject))

      // Deletion on the handset side removes the review.
      recordings.set(R.hot, { ...recordings.get(R.hot)!, deleted_at: new Date().toISOString() })
      await writeState({ sweptOn: '2000-01-01' })
      await runCallAi({ deadlineMs: deadline(), deps })
      const hotLeft = (await tx.execute(sql`SELECT count(*)::int AS n FROM call_ai_reviews WHERE cre_recording_id::text = ${R.hot}`) as unknown as Array<{ n: number }>)[0].n
      assert('a recording deleted on the CRE side is purged here, verdict and all', hotLeft === 0)

      // Privacy of everything that went to "Groq".
      assert('every file sent for transcription is named <recording id>.<ext> — never the handset\'s name', captured.fileNames.length > 0 && captured.fileNames.every((n) => /^[0-9a-f-]{36}\.(m4a|mp3)$/.test(n)))
      const allChat = captured.chatBodies.join('\n')
      assert('no phone number, contact name or file name was ever sent to the model', !allChat.includes(PHONE) && !allChat.includes(CONTACT) && !allChat.includes(FILE_NAME) && allChat.includes('[number]'))

      throw new Rollback()
    })
  } catch (error) {
    if (!(error instanceof Rollback)) {
      failures += 1
      console.error('\n[FAIL] the flow stopped:', error)
    }
  } finally {
    useOuterTransaction(null)
    process.env = env
  }
  const [leftover] = (await realDb.execute(sql`SELECT count(*)::int AS n FROM call_ai_reviews WHERE cre_recording_id::text IN (${sql.join(Object.values(R).map((id) => sql`${id}`), sql`, `)})`)) as unknown as Array<{ n: number }>
  assert('nothing the test wrote survived', leftover.n === 0)

  // ── 5. SKIP LOCKED with two real connections ───────────────────────────────────────────────────
  console.log('\n5) Two overlapping runs never take the same job (two real connections)')
  {
    const url = new URL(process.env.DATABASE_URL!)
    if (url.port === '6543') url.port = '5432'
    const a = postgres(url.toString(), { prepare: false, max: 1, ssl: { rejectUnauthorized: false } })
    const b = postgres(url.toString(), { prepare: false, max: 1, ssl: { rejectUnauthorized: false } })
    try {
      await a`CREATE TABLE IF NOT EXISTS public.call_ai_skiplock_probe (id int PRIMARY KEY, status text NOT NULL)`
      await a`REVOKE ALL ON public.call_ai_skiplock_probe FROM anon, authenticated, PUBLIC`
      await a`INSERT INTO public.call_ai_skiplock_probe SELECT g, 'queued' FROM generate_series(1, 6) g ON CONFLICT DO NOTHING`
      let first: number[] = []
      let second: number[] = []
      await a.begin(async (txA) => {
        first = (await txA`SELECT id FROM public.call_ai_skiplock_probe WHERE status = 'queued' ORDER BY id LIMIT 3 FOR UPDATE SKIP LOCKED`).map((r) => r.id)
        second = (await b`SELECT id FROM public.call_ai_skiplock_probe WHERE status = 'queued' ORDER BY id LIMIT 3 FOR UPDATE SKIP LOCKED`).map((r) => r.id)
      })
      assert('run A takes 1–3, run B skips them and takes 4–6', JSON.stringify(first) === '[1,2,3]' && JSON.stringify(second) === '[4,5,6]', `${first} / ${second}`)
    } finally {
      await a`DROP TABLE IF EXISTS public.call_ai_skiplock_probe`.catch(() => {})
      await a.end()
      await b.end()
    }
  }

  // ── 6. Read-only against the real CRE project ──────────────────────────────────────────────────
  console.log('\n6) The real CRE project (read only)')
  if (!process.env.AM_GROUP_CRE_SUPABASE_URL) {
    console.log('  [skip] AM_GROUP_CRE_SUPABASE_URL is not set')
  } else {
    const real = supabaseCreSource()
    const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const page1 = await real.listChanged(since, null, 5)
    const last = page1[page1.length - 1]
    const page2 = last ? await real.listChanged(since, { at: last.updated_at, id: last.id }, 5) : []
    const overlap = page2.filter((r) => page1.some((p) => p.id === r.id))
    assert('keyset paging on (updated_at, id) returns the next page with no overlap', page1.length === 5 && page2.length > 0 && overlap.length === 0
      && (page2[0].updated_at > last.updated_at || (page2[0].updated_at === last.updated_at && page2[0].id > last.id)))
    const dir = await real.loadDirectory()
    const sample = await real.listRecorded(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), new Date().toISOString(), null, 1000)
    const classified = sample.map((r) => classifyScope(r, dir, ['hyundai']))
    const teams = new Set(classified.filter((c) => c.inScope).map((c) => (c as { team: string }).team))
    const share = classified.filter((c) => c.inScope).length / Math.max(1, sample.length)
    assert('on real rows, only Hyundai Jammu and the Hyundai service desk are in scope', teams.size > 0 && [...teams].every((t) => t === 'Hyundai Jammu' || t === 'Special Branch (Hyundai service)'), [...teams].join(', '))
    assert('…which is roughly a quarter of all recordings (measured 24% over 30 days)', share > 0.1 && share < 0.45, `${Math.round(share * 100)}%`)
  }

  await testClient.end()
  console.log(failures === 0 ? `\n=== ALL ${passes} CALL-AI CHECKS PASSED ===` : `\n=== ${failures} FAILURE(S), ${passes} passed ===`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  await testClient.end().catch(() => {})
  process.exit(1)
})
