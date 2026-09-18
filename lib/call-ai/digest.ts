import 'server-only'

import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { getAppBaseUrl } from '@/lib/approvals/decision-emails'
import { sendTrackedEmail } from '@/lib/email/email-log'
import { emailLayout, escapeHtml } from '@/lib/email/templates'
import { primaryButton } from '@/lib/email/templates/layout'
import { callAiConfig } from './config'
import { supabaseCreSource, type CreSource } from './cre-source'
import { istToday } from './discovery'
import { rows } from './queue'
import { attachCustomers, listReviews, parseReviewFilters } from './read'
import { scopeLabel } from './scope'
import { VERDICT_LABELS, type ReviewDigest, type ReviewRow, type Verdict } from './types'

/**
 * The 9 AM email: yesterday's AM Hyundai calls, in the order the MD acts on them.
 *
 * Rules that matter:
 *   - NO RECIPIENTS, NO EMAIL. An empty CALL_AI_DIGEST_RECIPIENTS sends nothing. (lib/callyzer/alerts.ts falls
 *     back to a default list; that is deliberately not copied — a transcript summary must never reach an
 *     inbox nobody chose.)
 *   - ONE EMAIL PER DAY. The call_ai_digests row is claimed before sending; a second run finds it and stops.
 *   - EVERYTHING IS ESCAPED. The body is mostly text an LLM wrote from what a caller said.
 *   - NO PHONE NUMBERS. Names only; the number is one click away behind the dashboard's login.
 */

export type SendFn = (input: { to: string[]; subject: string; html: string }) => Promise<{ ok: boolean; error?: string }>

export function digestRecipients(): string[] {
  return (process.env.CALL_AI_DIGEST_RECIPIENTS || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
}

export function yesterdayIst(now: Date = new Date()): string {
  const today = istToday(now)
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export type DigestData = {
  date: string
  scope: string
  digest: ReviewDigest
  attention: ReviewRow[]
  hot: ReviewRow[]
  dueToday: ReviewRow[]
}

export async function collectDigest(date: string, source: CreSource = supabaseCreSource()): Promise<DigestData> {
  const day = (queue: string, pageSize: number, extra: Record<string, string> = {}) =>
    listReviews(parseReviewFilters(new URLSearchParams({ from: date, to: date, queue, pageSize: String(pageSize), ...extra })))
  const today = istToday()
  const back = new Date(`${today}T00:00:00Z`)
  back.setUTCDate(back.getUTCDate() - 14)
  const [attention, hot, followups] = await Promise.all([
    day('attention', 10),
    day('hot', 10),
    listReviews(parseReviewFilters(new URLSearchParams({ from: back.toISOString().slice(0, 10), to: today, queue: 'followups', pageSize: '50' }))),
  ])
  const dueToday = followups.rows.filter((row) => row.followUpDue === today).slice(0, 10)
  const named = await attachCustomers([...attention.rows, ...hot.rows, ...dueToday], source)
  const byId = new Map(named.map((row) => [row.id, row]))
  const pick = (list: ReviewRow[]) => list.map((row) => byId.get(row.id) ?? row)
  return {
    date,
    scope: scopeLabel(callAiConfig().scope),
    digest: attention.digest,
    attention: pick(attention.rows),
    hot: pick(hot.rows),
    dueToday: pick(dueToday),
  }
}

function prettyDate(ymd: string): string {
  return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`))
}

function time(iso: string | null): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso))
}

const TONE: Partial<Record<Verdict, string>> = {
  complaint: '#be123c',
  unhappy: '#c2410c',
  hot_lead: '#047857',
  follow_up: '#1d4ed8',
}

function item(row: ReviewRow): string {
  const verdict = (row.overrideVerdict ?? row.verdict) as Verdict | null
  const label = verdict ? VERDICT_LABELS[verdict] : 'Reviewed'
  const who = row.customer?.name || 'Unnamed caller'
  const meta = [time(row.recordedAt), row.creName, row.team].filter(Boolean).join(' · ')
  return `
    <tr><td style="padding:12px 0;border-top:1px solid #e6e8f0;">
      <p style="margin:0;font-size:11px;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:${TONE[verdict as Verdict] ?? '#475569'};">${escapeHtml(label)}${row.followUpDue ? ` · due ${escapeHtml(row.followUpDue)}` : ''}</p>
      <p style="margin:3px 0 0;font-size:15px;font-weight:700;color:#111827;">${escapeHtml(who)} — ${escapeHtml(row.headline || '')}</p>
      ${row.customerWanted ? `<p style="margin:3px 0 0;font-size:14px;color:#4b5563;">${escapeHtml(row.customerWanted)}</p>` : ''}
      <p style="margin:3px 0 0;font-size:12px;color:#9aa2b1;">${escapeHtml(meta)}</p>
    </td></tr>`
}

function section(title: string, list: ReviewRow[], empty: string): string {
  return `
    <h2 style="margin:26px 0 4px;font-size:16px;font-weight:800;color:#111827;">${escapeHtml(title)}</h2>
    ${list.length
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${list.map(item).join('')}</table>`
      : `<p style="margin:6px 0 0;font-size:14px;color:#9aa2b1;">${escapeHtml(empty)}</p>`}`
}

function stat(label: string, value: number, colour: string): string {
  return `<td style="padding:12px 8px;text-align:center;width:25%;">
      <p style="margin:0;font-size:24px;font-weight:800;color:${colour};">${escapeHtml(String(value))}</p>
      <p style="margin:2px 0 0;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">${escapeHtml(label)}</p>
    </td>`
}

export function buildDigestEmail(data: DigestData, baseUrl: string): { subject: string; html: string } {
  const d = data.digest
  const unhappy = d.complaints + d.unhappy
  const subject = `${data.scope} calls — ${prettyDate(data.date)}: ${unhappy} unhappy, ${d.hotLeads} hot lead${d.hotLeads === 1 ? '' : 's'}`
  const coverage = d.pending > 0
    ? `${d.reviewed} of ${d.inScope} calls reviewed; ${d.pending} still uploading or in progress.`
    : `${d.reviewed} of ${d.inScope} calls reviewed.`
  const bodyHtml = `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e6e8f0;border-radius:14px;border-collapse:separate;background:#fbfbfd;">
      <tr>
        ${stat('Reviewed', d.reviewed, '#111827')}
        ${stat('Unhappy / complaint', unhappy, '#be123c')}
        ${stat('Hot leads', d.hotLeads, '#047857')}
        ${stat('Promises due today', data.dueToday.length, '#1d4ed8')}
      </tr>
    </table>
    <p style="margin:10px 0 0;font-size:12px;color:#9aa2b1;">${escapeHtml(coverage)} ${escapeHtml(`${d.noConversation} were not customer conversations.`)}</p>
    ${section('Needs your attention', data.attention, 'Nothing needs attention — no complaints or unhappy customers.')}
    ${section('Hot leads', data.hot, 'No hot leads yesterday.')}
    ${section('Promises due today', data.dueToday, 'No promises fall due today.')}
    <p style="margin:22px 0 0;font-size:12px;color:#9aa2b1;">Verdicts are written by AI from the call recordings and can be wrong. Open a call to hear it; mark a wrong verdict so the review learns.</p>
    ${primaryButton(`${baseUrl}/call-analysis?tab=ai`, 'Open AI Call Review')}`
  const html = emailLayout({
    heading: `${data.scope} calls — ${prettyDate(data.date)}`,
    eyebrow: 'AI Call Review',
    preheader: `${unhappy} unhappy, ${d.hotLeads} hot leads, ${data.dueToday.length} promises due today`,
    bodyHtml,
    brand: 'AM Group',
  })
  return { subject, html }
}

export type DigestResult =
  | { status: 'dry_run'; subject: string; html: string; recipients: string[] }
  | { status: 'no_recipients' }
  | { status: 'already_sent'; date: string }
  | { status: 'sent' | 'failed'; date: string; recipients: string[]; error?: string }

export async function sendDailyDigest(options: {
  date?: string
  dryRun?: boolean
  request?: Request
  send?: SendFn
  source?: CreSource
}): Promise<DigestResult> {
  const date = options.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date) ? options.date : yesterdayIst()
  const recipients = digestRecipients()
  const data = await collectDigest(date, options.source)
  const { subject, html } = buildDigestEmail(data, getAppBaseUrl(options.request))
  if (options.dryRun) return { status: 'dry_run', subject, html, recipients }
  if (recipients.length === 0) return { status: 'no_recipients' }

  // Claim the day. A failed day may be retried; a sent or sending day is never mailed again.
  const claimed = rows<{ digest_date: string }>(await db.execute(sql`
    INSERT INTO call_ai_digests (digest_date, status, recipients, summary)
    VALUES (${date}::date, 'sending', ${recipients.join(', ')}, ${JSON.stringify(data.digest)}::jsonb)
    ON CONFLICT (digest_date) DO UPDATE SET status = 'sending', updated_at = clock_timestamp()
      WHERE call_ai_digests.status = 'failed'
    RETURNING digest_date`))
  if (claimed.length === 0) return { status: 'already_sent', date }

  const send: SendFn = options.send ?? ((input) => sendTrackedEmail({ ...input, emailType: 'call_ai_digest' }))
  const result = await send({ to: recipients, subject, html })
  await db.execute(sql`
    UPDATE call_ai_digests
    SET status = ${result.ok ? 'sent' : 'failed'}, sent_at = CASE WHEN ${result.ok}::boolean THEN clock_timestamp() ELSE NULL END,
        error = ${result.ok ? null : (result.error || 'send failed').slice(0, 500)}, updated_at = clock_timestamp()
    WHERE digest_date = ${date}::date`)
  return { status: result.ok ? 'sent' : 'failed', date, recipients, error: result.error }
}
