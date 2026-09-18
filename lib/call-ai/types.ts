/**
 * AI Call Review — the vocabulary shared by the pipeline, the API and the dashboard. Client-safe.
 *
 * The LLM fills {@link AnalysisSchema}. The one-word VERDICT the MD scans is NOT asked of the model: it is
 * derived here from the model's separate answers (intent, mood, complaint, lead, promises), so the same call
 * always gets the same chip and each ingredient can be measured on its own against the MD's corrections.
 */
import { z } from 'zod'

export const CONVERSATIONS = ['customer_call', 'internal_staff', 'personal', 'wrong_number', 'voicemail_ivr', 'no_conversation'] as const
export type Conversation = (typeof CONVERSATIONS)[number]

export const INTENTS = [
  'new_car_enquiry',
  'test_drive',
  'booking_payment',
  'delivery_status',
  'service_booking',
  'service_followup',
  'complaint',
  'insurance',
  'finance_loan',
  'exchange_used_car',
  'accessories_parts',
  'documents_rc',
  'feedback',
  'other',
] as const
export type Intent = (typeof INTENTS)[number]

export const MOODS = ['satisfied', 'neutral', 'dissatisfied', 'angry'] as const
export type Mood = (typeof MOODS)[number]

export const LEAD_TEMPERATURES = ['hot', 'warm', 'cold', 'none'] as const
export const SEVERITIES = ['low', 'medium', 'high'] as const
export const ACTION_OWNERS = ['cre', 'sales', 'service', 'accounts', 'manager', 'customer'] as const
export const SPEAKERS = ['dealer', 'customer', 'unclear'] as const
export const RED_FLAGS = ['rude_staff', 'price_dispute', 'refund', 'legal_threat', 'competitor', 'delay', 'repeat_issue'] as const
export type RedFlag = (typeof RED_FLAGS)[number]

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * What the model must return. Every field is required (strict structured output demands it); "no answer" is
 * `null`, never an omitted key. Lengths are enforced by {@link normalizeAnalysisInput} before this runs, so an
 * over-long sentence is trimmed rather than failing the whole call.
 */
export const AnalysisSchema = z.object({
  conversation: z.enum(CONVERSATIONS),
  language: z.string(),
  intent: z.enum(INTENTS),
  mood_end: z.enum(MOODS),
  satisfaction: z.number().int().min(1).max(5).nullable(),
  headline_en: z.string(),
  customer_wanted: z.string(),
  summary_en: z.string(),
  lead: z.object({
    temperature: z.enum(LEAD_TEMPERATURES),
    models: z.array(z.string()),
    exchange_vehicle: z.string().nullable(),
    finance_needed: z.boolean().nullable(),
  }),
  complaint: z.object({
    is_complaint: z.boolean(),
    about: z.string().nullable(),
    severity: z.enum(SEVERITIES).nullable(),
  }),
  commitments: z.array(z.object({
    by: z.enum(['dealer', 'customer']),
    what: z.string(),
    due: isoDate.nullable(),
  })),
  next_action: z.object({
    needed: z.boolean(),
    what: z.string().nullable(),
    owner: z.enum(ACTION_OWNERS).nullable(),
    due: isoDate.nullable(),
  }),
  red_flags: z.array(z.enum(RED_FLAGS)),
  staff_handling: z.object({
    score: z.number().int().min(1).max(5).nullable(),
    notes: z.string().nullable(),
  }),
  evidence: z.array(z.object({
    segment: z.number().int().min(0),
    speaker_guess: z.enum(SPEAKERS),
    quote: z.string(),
    meaning_en: z.string(),
  })),
  /** Which voice label (S1, S2 …) is dealership staff and which the customer. Empty when there are no labels. */
  speakers: z.array(z.object({
    label: z.string(),
    role: z.enum(['staff', 'customer', 'other']),
  })),
  confidence: z.number().min(0).max(1),
  needs_human_review: z.boolean(),
})
export type Analysis = z.infer<typeof AnalysisSchema>

/** Caps applied before validation — the model's prose is trimmed, never rejected, for being long. */
export const ANALYSIS_LIMITS = {
  language: 40,
  headline_en: 120,
  customer_wanted: 300,
  summary_en: 600,
  model: 40,
  models: 5,
  exchange_vehicle: 80,
  complaint_about: 200,
  commitment_what: 200,
  commitments: 6,
  next_action_what: 200,
  staff_notes: 300,
  quote: 220,
  meaning_en: 220,
  evidence: 3,
} as const

function cut(value: unknown, max: number): unknown {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : value
}

type Loose = Record<string, unknown>
const loose = (value: unknown): Loose | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : null)

/** Trim prose, cap lists, and drop impossible dates before zod sees the object. Pure; never throws. */
export function normalizeAnalysisInput(raw: unknown): unknown {
  const r = loose(raw)
  if (!r) return raw
  const L = ANALYSIS_LIMITS
  const date = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null)
  const list = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(0, max) : [])
  const lead = loose(r.lead)
  const complaint = loose(r.complaint)
  const next = loose(r.next_action)
  const staff = loose(r.staff_handling)
  return {
    ...r,
    language: cut(r.language ?? '', L.language),
    headline_en: cut(r.headline_en ?? '', L.headline_en),
    customer_wanted: cut(r.customer_wanted ?? '', L.customer_wanted),
    summary_en: cut(r.summary_en ?? '', L.summary_en),
    lead: lead ? {
      ...lead,
      models: list(lead.models, L.models).map((m) => cut(m, L.model)).filter((m) => typeof m === 'string' && m),
      exchange_vehicle: lead.exchange_vehicle ? cut(lead.exchange_vehicle, L.exchange_vehicle) : null,
    } : r.lead,
    complaint: complaint ? {
      ...complaint,
      about: complaint.about ? cut(complaint.about, L.complaint_about) : null,
    } : r.complaint,
    commitments: list(r.commitments, L.commitments).map((c) => {
      const x = loose(c) ?? {}
      return { ...x, what: cut(x.what ?? '', L.commitment_what), due: date(x.due) }
    }),
    next_action: next ? {
      ...next,
      what: next.what ? cut(next.what, L.next_action_what) : null,
      due: date(next.due),
    } : r.next_action,
    red_flags: Array.isArray(r.red_flags) ? [...new Set(r.red_flags.filter((f: unknown) => (RED_FLAGS as readonly unknown[]).includes(f)))] : [],
    staff_handling: staff ? {
      ...staff,
      notes: staff.notes ? cut(staff.notes, L.staff_notes) : null,
    } : r.staff_handling,
    speakers: list(r.speakers, 6).map((x) => loose(x) ?? {}).filter((x) => typeof x.label === 'string'),
    evidence: list(r.evidence, L.evidence).map((e) => {
      const x = loose(e) ?? {}
      return { ...x, quote: cut(x.quote ?? '', L.quote), meaning_en: cut(x.meaning_en ?? '', L.meaning_en) }
    }),
  }
}

// ── The verdict chip ─────────────────────────────────────────────────────────────────────────────

export const VERDICTS = ['complaint', 'unhappy', 'hot_lead', 'follow_up', 'service', 'enquiry', 'satisfied', 'general', 'unclear', 'not_customer'] as const
export type Verdict = (typeof VERDICTS)[number]

export const VERDICT_LABELS: Record<Verdict, string> = {
  complaint: 'Complaint',
  unhappy: 'Unhappy customer',
  hot_lead: 'Hot lead',
  follow_up: 'Follow-up pending',
  service: 'Service request',
  enquiry: 'Enquiry',
  satisfied: 'Satisfied',
  general: 'General call',
  unclear: 'Unclear audio',
  not_customer: 'Not a customer call',
}

/** What each chip means, for the tooltip and the digest legend. */
export const VERDICT_HELP: Record<Verdict, string> = {
  complaint: 'The customer raised a complaint about the vehicle, service, staff or a delay.',
  unhappy: 'No formal complaint, but the customer ended the call dissatisfied or angry.',
  hot_lead: 'A buyer ready to act soon — test drive, booking or price negotiation.',
  follow_up: 'Someone at the dealership promised to call back or do something.',
  service: 'A service booking, service status or service follow-up call.',
  enquiry: 'The customer asked about a vehicle, price, finance, insurance, documents or delivery.',
  satisfied: 'The customer ended the call satisfied, with nothing pending.',
  general: 'A customer call that fits none of the above.',
  unclear: 'The recording was too unclear for the AI to judge — listen to it if it matters.',
  not_customer: 'Staff, personal, wrong-number or voicemail call.',
}

const SERVICE_INTENTS: readonly Intent[] = ['service_booking', 'service_followup']
const ENQUIRY_INTENTS: readonly Intent[] = [
  'new_car_enquiry', 'test_drive', 'booking_payment', 'delivery_status', 'insurance', 'finance_loan',
  'exchange_used_car', 'accessories_parts', 'documents_rc',
]

/** The dealership's own promises and next steps — the customer's promises do not create a follow-up. */
export function dealerFollowUpDue(a: Pick<Analysis, 'commitments' | 'next_action'>): string | null {
  const dates: string[] = []
  for (const c of a.commitments) if (c.by === 'dealer' && c.due) dates.push(c.due)
  if (a.next_action.needed && a.next_action.owner !== 'customer' && a.next_action.due) dates.push(a.next_action.due)
  return dates.sort()[0] ?? null
}

export function hasDealerPromise(a: Pick<Analysis, 'commitments' | 'next_action'>): boolean {
  return a.commitments.some((c) => c.by === 'dealer') || (a.next_action.needed && a.next_action.owner !== 'customer')
}

/** Below this the model is saying "I could not really tell" — the call gets its own chip, not a guess. */
export const UNCLEAR_CONFIDENCE = 0.5

/**
 * First match wins: the order is the MD's priority, most urgent first.
 *
 * Tuned on the first real pilot (2026-09-18, 40 AM Hyundai calls):
 *   - a SERVICE call wins over "follow-up": booking a slot ("3 pm tomorrow") is a dealer promise, but it is the
 *     routine outcome of a service call, and ranking it as a follow-up turned most of the list into one chip.
 *     The promised time still lands in the Promises queue through follow_up_due.
 *   - a garbled call is "Unclear audio", not a confident-looking General call or Enquiry.
 */
export function deriveVerdict(a: Analysis): Verdict {
  if (a.conversation !== 'customer_call') return 'not_customer'
  if (a.complaint.is_complaint || a.intent === 'complaint') return 'complaint'
  if (a.mood_end === 'dissatisfied' || a.mood_end === 'angry') return 'unhappy'
  if (a.lead.temperature === 'hot') return 'hot_lead'
  if (a.confidence < UNCLEAR_CONFIDENCE) return 'unclear'
  if (SERVICE_INTENTS.includes(a.intent)) return 'service'
  if (hasDealerPromise(a)) return 'follow_up'
  if (ENQUIRY_INTENTS.includes(a.intent)) return 'enquiry'
  if (a.mood_end === 'satisfied') return 'satisfied'
  return 'general'
}

const ATTENTION_FLAGS: readonly RedFlag[] = ['rude_staff', 'legal_threat', 'refund', 'repeat_issue']

/**
 * Stored flag for the "Needs attention" queue. A promise falling due is NOT folded in here — it depends on
 * today's date, so the queue query adds `follow_up_due <= today` itself.
 *
 * "Needs human review" alone only counts when the model understood the call (a sensitive one). On garbled
 * audio it is set on about a quarter of real calls, and would bury the complaints the queue exists for.
 */
export function needsAttention(a: Analysis, verdict: Verdict): boolean {
  if (verdict === 'not_customer' || verdict === 'unclear') return a.red_flags.some((flag) => ATTENTION_FLAGS.includes(flag))
  if (verdict === 'complaint' || verdict === 'unhappy') return true
  if (a.red_flags.some((flag) => ATTENTION_FLAGS.includes(flag))) return true
  return a.needs_human_review && a.confidence >= UNCLEAR_CONFIDENCE
}

// ── Labels the UI and the email share ────────────────────────────────────────────────────────────

export const INTENT_LABELS: Record<Intent, string> = {
  new_car_enquiry: 'New car enquiry',
  test_drive: 'Test drive',
  booking_payment: 'Booking / payment',
  delivery_status: 'Delivery status',
  service_booking: 'Service booking',
  service_followup: 'Service follow-up',
  complaint: 'Complaint',
  insurance: 'Insurance',
  finance_loan: 'Finance / loan',
  exchange_used_car: 'Exchange / used car',
  accessories_parts: 'Accessories / parts',
  documents_rc: 'Documents / RC',
  feedback: 'Feedback call',
  other: 'Other',
}

export const MOOD_LABELS: Record<Mood, string> = {
  satisfied: 'Satisfied',
  neutral: 'Neutral',
  dissatisfied: 'Dissatisfied',
  angry: 'Angry',
}

export const RED_FLAG_LABELS: Record<RedFlag, string> = {
  rude_staff: 'Staff rude or dismissive',
  price_dispute: 'Price dispute',
  refund: 'Refund demanded',
  legal_threat: 'Legal / consumer-forum threat',
  competitor: 'Mentions a competitor',
  delay: 'Delay complained about',
  repeat_issue: 'Repeat issue',
}

export const SKIP_REASON_LABELS: Record<string, string> = {
  too_short: 'Too short to be a conversation',
  not_connected: 'Call was not connected',
  unsupported_format: 'Audio format not supported',
  too_large: 'Audio file too large',
  internal_number: 'Internal / staff number',
  no_conversation: 'No conversation in the audio',
  recording_deleted: 'Recording was deleted',
  audio_missing: 'Audio file is missing',
}

export const REVIEW_QUEUES = ['attention', 'hot', 'followups', 'all', 'not_customer'] as const
export type ReviewQueue = (typeof REVIEW_QUEUES)[number]

/** One compact transcript segment: start and end in seconds, text, low-confidence flag, voice label (S1, S2 …). */
export type Segment = { s: number; e: number; t: string; f?: 1; p?: string }

// ── API shapes ───────────────────────────────────────────────────────────────────────────────────

export type ReviewCustomer = {
  name: string | null
  phone: string | null
  sourceLabel: string | null
  notACustomer: string | null
}

export type ReviewRow = {
  id: string
  recordingId: string
  recordedAt: string | null
  creId: string | null
  creName: string | null
  team: string | null
  callType: string | null
  durationSeconds: number | null
  status: 'queued' | 'processing' | 'done' | 'skipped' | 'failed'
  skipReason: string | null
  verdict: Verdict | null
  overrideVerdict: Verdict | null
  intent: Intent | null
  mood: Mood | null
  satisfaction: number | null
  leadTemperature: string | null
  headline: string | null
  customerWanted: string | null
  followUpDue: string | null
  needsAttention: boolean
  customer: ReviewCustomer | null
}

export type ReviewDigest = {
  inScope: number
  reviewed: number
  pending: number
  skipped: number
  failed: number
  noConversation: number
  complaints: number
  unhappy: number
  hotLeads: number
  followUpsDueToday: number
  followUpsOverdue: number
  needsAttention: number
  byVerdict: Array<{ verdict: Verdict; count: number }>
  byIntent: Array<{ intent: Intent; count: number }>
}

export type ReviewListResponse = {
  rows: ReviewRow[]
  total: number
  page: number
  pageSize: number
  digest: ReviewDigest
  teams: Array<{ label: string; count: number }>
  agents: Array<{ id: string; name: string; count: number }>
  today: string
}

export type ReviewFeedback = {
  id: string
  userName: string | null
  verdictOk: boolean
  correctedVerdict: Verdict | null
  note: string | null
  createdAt: string
}

export type ReviewDetail = ReviewRow & {
  analysis: Analysis | null
  segments: Segment[] | null
  sttLanguage: string | null
  speechSeconds: number | null
  analysedAt: string | null
  llmModel: string | null
  sttModel: string | null
  lastError: string | null
  feedback: ReviewFeedback[]
}

export type VerdictLookup = Record<string, { id: string; status: ReviewRow['status']; verdict: Verdict | null; headline: string | null; skipReason: string | null }>

export type PipelineStatus = {
  enabled: boolean
  envEnabled: boolean
  scope: string[]
  rateLimitedUntil: string | null
  lastRunAt: string | null
  lastRun: Record<string, unknown> | null
  counts: Record<'queued' | 'processing' | 'done' | 'skipped' | 'failed', number>
  audioSecondsToday: number
  dailyAudioCapSeconds: number
  costTodayUsd: number
  costMonthUsd: number
  accuracy: { rated: number; correct: number }
  recentErrors: Array<{ recordingId: string; error: string; at: string }>
}
