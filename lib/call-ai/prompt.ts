/**
 * What the models are told. Pure: builds strings and the JSON schema, touches nothing.
 *
 * PRIVACY RULE: the LLM receives the transcript, the team, the direction, the date and the length — never the
 * customer's phone number, the contact name saved on the handset, or the recording's file name (which embeds
 * the number). Numbers spoken during the call are masked by {@link maskNumbers} before the text leaves.
 */
import { z } from 'zod'
import { AnalysisSchema, type Segment } from './types'

/**
 * Whisper prompt — OFF by default, and it must stay off unless the pilot proves a prompt helps.
 *
 * ⚠️ Measured 2026-09-18 on real AM Hyundai calls: a glossary prompt ("Service, booking, delivery, test drive …")
 * was (1) REPEATED BACK as invented transcript lines wherever the audio went quiet, and (2) pushed Whisper to
 * answer in English, turning Hindi speech into a loose English paraphrase. Both make a transcript lie.
 * If CALL_AI_STT_PROMPT is ever set, stt-filter.ts drops any line that is mostly the prompt's own words.
 */
export function sttPrompt(): string | null {
  const value = (process.env.CALL_AI_STT_PROMPT || '').trim()
  return value ? value.slice(0, 600) : null
}

/** stt_language value for a transcript Whisper translated to English (CALL_AI_STT_MODE=translate). */
export const TRANSLATED_EN = 'translated-en'

// Latin, Devanagari, Gurmukhi and Arabic-Indic digits, with the separators people read numbers out with.
const DIGIT = '[0-9०-९੦-੯٠-٩۰-۹]'
const NUMBER_RUN = new RegExp(`${DIGIT}(?:[\\s.-]?${DIGIT}){6,}`, 'g')

/** Any run of seven or more digits (a phone, account, chassis or Aadhaar number) becomes "[number]". */
export function maskNumbers(text: string): string {
  return text.replace(NUMBER_RUN, '[number]')
}

function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export const SYSTEM_PROMPT = `You review recorded phone calls for AM Hyundai, a Hyundai car dealership in Jammu (Jammu & Kashmir, India). A manager reads your review instead of listening to the call, so it must be accurate, short and fair.

About the transcript (automatic speech recognition of a phone recording):
- It is either the call AS SPOKEN (Hindi, Dogri, Punjabi or Urdu mixed with English) or an English machine translation of it — the call details say which. Words, names and places can be misheard ("गंग्याल" = Gangyal, "हुंडई"/"M.Honda" = AM Hyundai). Judge the meaning.
- When lines start with a voice label (S1, S2 …), the speech recogniser separated the voices: the same label is the same person. Decide which label is dealership staff (CRE, sales consultant, service advisor) and which is the customer from what they say — on an outgoing call the dealership usually speaks first. Voice separation can merge or split people on a phone line; trust meaning over labels when they conflict.
- Without labels, work out who is staff and who is the customer from what they say.
- People mix Hindi, Dogri, Punjabi, Urdu and English. The text may be in Devanagari, Urdu or Latin script.
- The transcript WILL contain misheard words and odd spellings — "टैनल" for "ten on ten", "हुड़ाई" for Hyundai, "kreta" for Creta. Read for the meaning. Misheard words are normal and are NOT a reason to call the call unclear.
- Phone and other long numbers were replaced with [number].
- [n] is the segment number, mm:ss the time into the call.

Rules:
- Write every English field in plain, short English a busy manager can scan. No filler.
- Use only what is in the transcript. Never invent names, prices, dates or promises.
- If the audio is too garbled to judge, or the call is sensitive (legal threat, abuse, serious complaint), set needs_human_review to true.
- Never output a phone number or any other long number.

Fields:
- conversation: "customer_call" when a customer, prospect or vehicle owner talks with the dealership; "internal_staff" when staff talk to each other or to a bank, insurer or vendor about work; "personal" for a private or family call; "wrong_number"; "voicemail_ivr" when only a machine, IVR, voicemail or ringback is heard; "no_conversation" when nobody really speaks.
- language: the languages actually spoken, e.g. "Hindi + English".
- intent: the customer's main purpose. new_car_enquiry (model, price, variants, availability), test_drive, booking_payment (booking amount, payment, on-road price after deciding), delivery_status (when will my car come), service_booking (book a service or repair), service_followup (status of a car in the workshop, post-service call), complaint, insurance, finance_loan, exchange_used_car, accessories_parts, documents_rc (RC, number plate, registration, papers), feedback (dealer's feedback/satisfaction call), other.
- mood_end: how the CUSTOMER sounds at the END of the call.
- satisfaction: 1 (very unhappy) to 5 (very happy), or null when the call gives no signal.
- headline_en: the gist in at most 12 words, e.g. "Asked Creta SX delivery date; staff promised update tomorrow".
- customer_wanted: one sentence — what the customer wanted or said.
- summary_en: at most 3 sentences: what was asked, what the dealership answered or did, how it ended.
- lead.temperature: "hot" = ready to buy or book soon (on-road price, booking, test drive this week, negotiating); "warm" = interested, not soon; "cold" = only asking; "none" = not a sales conversation. lead.models: Hyundai models mentioned. lead.exchange_vehicle: the car they want to exchange, else null. lead.finance_needed: true, false or null.
- complaint.is_complaint: true only when the customer complains (vehicle fault, service quality, delay, staff behaviour, billing). about: a few words. severity: low, medium or high; null when there is no complaint.
- commitments: promises made in the call. by "dealer" when the dealership promised (call back, send quotation, arrange test drive, deliver on a date); by "customer" when the customer promised (visit tomorrow, pay by Friday). due: YYYY-MM-DD worked out from the call date ("kal" = next day, "parson" = two days later), or null when no time was said.
- next_action: what the dealership should do next. needed false when nothing is pending. owner: cre, sales, service, accounts, manager, or customer when only the customer must act. due: YYYY-MM-DD or null.
- red_flags: only those clearly present — rude_staff (the DEALERSHIP's staff member is rude or dismissive; never because the customer is annoyed), price_dispute, refund, legal_threat, competitor, delay, repeat_issue.
- staff_handling.score: 1 to 5 for how well the staff member handled the call (greeting, politeness, answered the question, agreed a clear next step); null when it is not a customer call. notes: one short sentence.
- evidence: 1 to 3 short quotes that justify your review, copied EXACTLY from one segment as it is written in the transcript, in its original script (no translation, no rewording, no "..." inside, no voice label), with that segment's number, who probably said it, and its plain meaning in English (repeat the quote if it is already clear English).
- speakers: for every voice label that appears (S1, S2 …), whether it is "staff", "customer" or "other" (a third person, IVR, a colleague on the line). An empty list when the transcript has no labels.
- confidence: 0 to 1, how sure you are of the review as a whole. Go below 0.5 ONLY when you truly cannot tell what the call was about (just greetings, noise, a few disconnected words). If you can tell the purpose, confidence is 0.6 or more even when many words are misheard.

When conversation is not "customer_call": headline_en is a few words ("Personal call", "Staff talking to bank"), customer_wanted and summary_en are "", intent "other", mood_end "neutral", satisfaction null, lead temperature "none", no commitments, no evidence, and repeat no private details. Still fill speakers when there are labels.`

export type CallMeta = {
  team: string | null
  callType: string | null
  recordedAt: string | null
  durationSeconds: number | null
  sttLanguage: string | null
}

function teamLine(team: string | null): string {
  if (!team) return 'AM Hyundai'
  const special = /special branch \((.+)\)/i.exec(team)
  return special ? `AM Hyundai — ${special[1]} desk` : `AM Hyundai — ${team}`
}

function directionLine(callType: string | null): string {
  const t = String(callType || '').toLowerCase()
  if (t === 'incoming') return 'incoming (the customer called the dealership)'
  if (t === 'outgoing') return 'outgoing (the dealership called the customer)'
  return 'unknown'
}

function istDateLine(iso: string | null): string {
  if (!iso) return 'unknown'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unknown'
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} (${get('weekday')}), ${get('hour')}:${get('minute')}`
}

export function buildUserMessage(meta: CallMeta, segments: Segment[]): string {
  const minutes = Math.floor((meta.durationSeconds ?? 0) / 60)
  const seconds = (meta.durationSeconds ?? 0) % 60
  const lines = segments.map((seg, index) => `[${index}] ${mmss(seg.s)}${seg.p ? ` ${seg.p}:` : ''} ${maskNumbers(seg.t)}`)
  return [
    'Call details',
    `- Dealership team: ${teamLine(meta.team)}`,
    `- Direction: ${directionLine(meta.callType)}`,
    `- Call date and time (IST): ${istDateLine(meta.recordedAt)}`,
    `- Length: ${minutes} min ${seconds} s`,
    meta.sttLanguage === TRANSLATED_EN
      ? '- Transcript: machine translation of the call into English'
      : `- Transcript: the call as spoken (speech recognition language: ${meta.sttLanguage || 'auto'})${segments.some((seg) => seg.p) ? ', voices labelled S1, S2 …' : ''}`,
    '',
    'Transcript',
    ...lines,
  ].join('\n')
}

// ── Strict JSON schema from the zod schema ───────────────────────────────────────────────────────

/** Keywords Groq's strict mode does not need (and may reject); zod still enforces them after the reply. */
const DROP_KEYS = new Set(['$schema', 'pattern', 'format', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'default'])

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify)
  if (!node || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (DROP_KEYS.has(key)) continue
    out[key] = strictify(value)
  }
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.required = Object.keys(out.properties as Record<string, unknown>)
    out.additionalProperties = false
  }
  return out
}

let cachedSchema: Record<string, unknown> | null = null

/** The response schema sent to Groq: every property required, no extra properties, nulls via anyOf. */
export function analysisJsonSchema(): Record<string, unknown> {
  if (!cachedSchema) cachedSchema = strictify(z.toJSONSchema(AnalysisSchema)) as Record<string, unknown>
  return cachedSchema
}
