import 'server-only'

/**
 * Google Workspace OAuth2 + Nodemailer email service.
 *
 * - NO App Passwords. Auth is OAuth2 with a long-lived refresh token; access
 *   tokens are obtained (and auto-refreshed) from the refresh token.
 * - The Nodemailer transporter is created ONCE and reused across requests.
 *   Nodemailer's built-in XOAuth2 refreshes the access token as it nears expiry;
 *   we additionally prime the first token via googleapis and rebuild + retry once
 *   if a send fails with an auth error.
 * - Server-side only (`server-only`). Credentials never reach the client.
 */

import fs from 'node:fs'
import path from 'node:path'
import nodemailer, { type Transporter } from 'nodemailer'
import { google } from 'googleapis'
import { BRAND_LOGO_CID } from './templates/layout'

export type EmailAttachment = {
  filename: string
  content?: Buffer | string
  path?: string
  contentType?: string
  /** Content-ID for inline images referenced in HTML via `cid:<value>`. */
  cid?: string
}

// The brand logo, read once and reused. Attached inline (via cid) on every send so
// the email header renders reliably without depending on a public image URL.
let cachedBrandLogo: EmailAttachment | null | undefined
function brandLogoAttachment(): EmailAttachment | null {
  if (cachedBrandLogo !== undefined) return cachedBrandLogo
  try {
    const logoPath = path.join(process.cwd(), 'public', 'assets', 'am-group-logo-pdf.jpg')
    const content = fs.readFileSync(logoPath)
    cachedBrandLogo = { filename: 'am-kia-logo.jpg', content, contentType: 'image/jpeg', cid: BRAND_LOGO_CID }
  } catch {
    cachedBrandLogo = null
  }
  return cachedBrandLogo
}

export type SendEmailOptions = {
  to: string | string[]
  subject: string
  html: string
  text?: string
  cc?: string | string[]
  bcc?: string | string[]
  /**
   * Where a REPLY should go, when that is not the sending mailbox.
   *
   * Transactional mail here goes out as tech@amgroupind.com, so hitting Reply reaches a mailbox
   * nobody in the conversation reads. Setting this points the reply at the human who caused the
   * mail — the person delegating a task, for instance — so the recipient's "Done" actually lands
   * somewhere useful.
   */
  replyTo?: string | string[]
  attachments?: EmailAttachment[]
}

// developers.google.com/oauthplayground is the canonical redirect for
// playground-issued refresh tokens; it is not called at send time.
const OAUTH_REDIRECT_URI = 'https://developers.google.com/oauthplayground'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Email service is not configured: missing ${name}. ` +
      'Set EMAIL_USER, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REFRESH_TOKEN.',
    )
  }
  return value
}

function getOAuth2Client() {
  const clientId = requireEnv('GOOGLE_CLIENT_ID')
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET')
  const refreshToken = requireEnv('GOOGLE_REFRESH_TOKEN')

  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, OAUTH_REDIRECT_URI)
  oAuth2Client.setCredentials({ refresh_token: refreshToken })
  return oAuth2Client
}

async function fetchAccessToken(): Promise<string> {
  const oAuth2Client = getOAuth2Client()
  const { token } = await oAuth2Client.getAccessToken()
  if (!token) {
    throw new Error('Failed to obtain a Google access token from the refresh token.')
  }
  return token
}

// Cached, reused transporter — do NOT recreate per request.
let cachedTransporter: Transporter | null = null

async function buildTransporter(): Promise<Transporter> {
  const user = requireEnv('EMAIL_USER')
  const clientId = requireEnv('GOOGLE_CLIENT_ID')
  const clientSecret = requireEnv('GOOGLE_CLIENT_SECRET')
  const refreshToken = requireEnv('GOOGLE_REFRESH_TOKEN')
  const accessToken = await fetchAccessToken()

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user,
      clientId,
      clientSecret,
      refreshToken,
      // Priming token; nodemailer refreshes from refreshToken as it expires.
      accessToken,
    },
  })
}

async function getTransporter(forceRefresh = false): Promise<Transporter> {
  if (forceRefresh) cachedTransporter = null
  if (!cachedTransporter) cachedTransporter = await buildTransporter()
  return cachedTransporter
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || `AM Kia <${requireEnv('EMAIL_USER')}>`
}

function looksLikeAuthError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    message.includes('invalid_grant') ||
    message.includes('invalid credentials') ||
    message.includes('unauthorized') ||
    message.includes('access token') ||
    message.includes('401') ||
    message.includes('535')
  )
}

/**
 * Send an email via Google OAuth2. Supports PDF (and any) attachments as either
 * an in-memory `content` Buffer or a `path`. Throws a meaningful error on hard
 * failure; retries once with a freshly-minted access token first.
 */
export async function sendEmail(options: SendEmailOptions) {
  // Always append the inline brand logo (referenced as cid:am-brand-logo in the HTML).
  const logo = brandLogoAttachment()
  const allAttachments = [...(options.attachments || []), ...(logo ? [logo] : [])]
  const message = {
    from: fromAddress(),
    to: options.to,
    cc: options.cc,
    bcc: options.bcc,
    // Omitted entirely when unset, so existing senders keep replying to the from-address.
    ...(options.replyTo ? { replyTo: options.replyTo } : {}),
    subject: options.subject,
    text: options.text,
    html: options.html,
    attachments: allAttachments.length
      ? allAttachments.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          path: attachment.path,
          contentType: attachment.contentType,
          cid: attachment.cid,
          // Logo is inline; other attachments (PDFs) stay as downloads.
          contentDisposition: attachment.cid ? ('inline' as const) : undefined,
        }))
      : undefined,
  }
  const recipients = Array.isArray(options.to) ? options.to.join(', ') : options.to

  try {
    const transporter = await getTransporter()
    const info = await transporter.sendMail(message)
    console.log('[email] sent', {
      recipient: recipients,
      subject: options.subject,
      messageId: info.messageId,
      at: new Date().toISOString(),
    })
    return info
  } catch (error) {
    // The access token may have gone stale — rebuild the transporter once and retry.
    if (!looksLikeAuthError(error)) {
      console.error('[email] send failed (non-auth)', { recipient: recipients, subject: options.subject, error })
      throw error instanceof Error ? error : new Error('Failed to send email')
    }
    console.warn('[email] auth error on first attempt, refreshing token and retrying', {
      recipient: recipients,
      subject: options.subject,
    })
    const transporter = await getTransporter(true)
    const info = await transporter.sendMail(message)
    console.log('[email] sent on retry', {
      recipient: recipients,
      subject: options.subject,
      messageId: info.messageId,
      at: new Date().toISOString(),
    })
    return info
  }
}
