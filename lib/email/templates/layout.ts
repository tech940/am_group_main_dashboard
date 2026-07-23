// Shared, inline-styled HTML wrapper for all transactional emails. Kept table-free-ish
// with inline styles so it renders consistently across clients (Gmail, Outlook, Apple
// Mail). New templates should reuse `emailLayout` so branding stays in one place.
//
// The AM Group logo is referenced via `cid:am-brand-logo` — the send layer
// (`email-service.ts`) attaches the logo file inline on every send, which renders far
// more reliably than remote URLs (no image-proxy blocking) or data URIs (Gmail strips).

export const BRAND = 'AM Kia'
export const BRAND_LOGO_CID = 'am-brand-logo'
export const BRAND_LOGO_URL = 'https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/logo.svg'

// Refined, modern palette — a soft neutral canvas with an indigo→violet accent
// (echoing the dashboard's Midnight Lavender theme). Deliberately NOT a heavy red.
const CANVAS = '#eef0f5'
const CARD = '#ffffff'
const HAIRLINE = '#e6e8f0'
const INK = '#111827'
const INK_SOFT = '#4b5563'
const INK_FAINT = '#9aa2b1'
const ACCENT = '#055B65'
const ACCENT_2 = '#2f8f83'
const ACCENT_TINT = '#edf7f4'

export type EmailLayoutOptions = {
  heading: string
  bodyHtml: string
  preheader?: string
  /** Small eyebrow label above the heading, e.g. 'Order Update'. */
  eyebrow?: string
  brand?: string
  logoUrl?: string
}

export function emailLayout({ heading, bodyHtml, preheader, eyebrow, brand = BRAND, logoUrl = BRAND_LOGO_URL }: EmailLayoutOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light only" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${CANVAS};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};-webkit-font-smoothing:antialiased;">
    ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ''}
    <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
      <div style="background:${CARD};border:1px solid ${HAIRLINE};border-radius:22px;overflow:hidden;box-shadow:0 10px 30px rgba(17,24,39,0.08);">

        <!-- Accent strip -->
        <div style="height:5px;background:linear-gradient(90deg,${ACCENT},${ACCENT_2});"></div>

        <!-- Brand header -->
        <div style="padding:28px 28px 10px;text-align:center;background:transparent;">
          <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(brand)}" height="48" style="height:48px;max-height:50px;width:auto;display:inline-block;border:0;outline:none;text-decoration:none;background:transparent;" />
        </div>

        <!-- Heading -->
        <div style="padding:6px 28px 22px;text-align:center;border-bottom:1px solid ${HAIRLINE};">
          ${eyebrow ? `<p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:${ACCENT};">${escapeHtml(eyebrow)}</p>` : ''}
          <h1 style="margin:0;font-size:23px;font-weight:800;letter-spacing:-0.01em;color:${INK};line-height:1.3;">${escapeHtml(heading)}</h1>
        </div>

        <!-- Body -->
        <div style="padding:28px;font-size:15px;line-height:1.65;color:${INK_SOFT};">
          ${bodyHtml}
        </div>

        <!-- Footer -->
        <div style="padding:22px 28px;border-top:1px solid ${HAIRLINE};background:${ACCENT_TINT};">
          <p style="margin:0;font-size:13px;color:${INK_SOFT};">Warm regards,</p>
          <p style="margin:3px 0 0;font-size:15px;font-weight:800;color:${INK};">The ${escapeHtml(brand)} Team</p>
        </div>
      </div>
      <p style="margin:18px 0 0;text-align:center;font-size:11px;line-height:1.6;color:${INK_FAINT};">
        This is an automated message from ${escapeHtml(brand)}. Please do not reply to this email.<br />
        &copy; ${escapeHtml(brand)}. All rights reserved.
      </p>
    </div>
  </body>
</html>`
}

/** Renders a compact label/value detail card for email bodies. */
export function detailTable(rows: Array<[label: string, value: string | null | undefined]>): string {
  const visible = rows.filter(([, value]) => value != null && String(value).trim() !== '')
  const cells = visible
    .map(([label, value], index) => `
      <tr>
        <td style="padding:11px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${INK_FAINT};white-space:nowrap;vertical-align:top;border-top:${index === 0 ? '0' : `1px solid ${HAIRLINE}`};">${escapeHtml(label)}</td>
        <td style="padding:11px 16px;font-size:14px;font-weight:600;color:${INK};text-align:right;vertical-align:top;border-top:${index === 0 ? '0' : `1px solid ${HAIRLINE}`};">${escapeHtml(String(value))}</td>
      </tr>`)
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:8px 0;border-collapse:collapse;border:1px solid ${HAIRLINE};border-radius:14px;overflow:hidden;background:#fbfbfd;">${cells}</table>`
}

/** A primary call-to-action button, gradient-filled and rounded. */
export function primaryButton(href: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px;border-collapse:separate;">
      <tr>
        <td style="border-radius:12px;background:linear-gradient(90deg,${ACCENT},${ACCENT_2});box-shadow:0 6px 16px rgba(5,91,101,0.24);">
          <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 34px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`
}

/** A secondary call-to-action button — outlined/tinted, to sit beside the primary one. */
export function secondaryButton(href: string, label: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:10px auto 8px;border-collapse:separate;">
      <tr>
        <td style="border-radius:12px;background:${ACCENT_TINT};border:1px solid ${ACCENT};">
          <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 32px;font-size:15px;font-weight:700;color:${ACCENT};text-decoration:none;border-radius:12px;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
