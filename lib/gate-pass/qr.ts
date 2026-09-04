import 'server-only'

import QRCode from 'qrcode'

/**
 * QR generation for the gate pass.
 *
 * ── There is deliberately no QR *scanner* anywhere in this module ─────────────────────────────
 * The QR encodes a plain https URL, so the guard's own phone camera — iOS Camera and Android
 * Camera/Lens both — decodes it and offers to open the link. No app to install, nothing to teach a
 * guard, and it sidesteps the trap that would otherwise decide this feature: `BarcodeDetector` has
 * never shipped in Safari, and every iOS browser is WebKit underneath, so an in-page scanner would
 * be broken on roughly half the phones at the gate.
 *
 * Generation only. If a staff-side "scan to look up a pass" is ever wanted, that is the point to
 * add a decoder — and it will need a JS one, not the browser API.
 */

/** Error correction 'M' survives a scuffed or partly-covered printed pass without bloating the code. */
const OPTIONS = { errorCorrectionLevel: 'M' as const, margin: 1, width: 512 }

/** PNG bytes, for embedding in an email as an inline cid attachment. */
export async function qrPngBuffer(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, { ...OPTIONS, type: 'png' })
}

/** SVG, for the printable pass — stays crisp at any size, unlike a 512px raster. */
export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { ...OPTIONS, type: 'svg' })
}

/** Data URL, for showing the code on screen without a second round trip. */
export async function qrDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, OPTIONS)
}
