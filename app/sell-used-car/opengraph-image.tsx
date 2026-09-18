import { ImageResponse } from 'next/og'

/*
 * The preview WhatsApp shows under the shared link — most people decide from this card whether to tap.
 * Built once at build time, in Lato to match the page. The font is fetched from Google Fonts, subset to just
 * the characters on the card; if that fetch fails the card still renders in the renderer's own font rather than
 * failing the build.
 */

export const alt = 'What’s your car worth? Free evaluation for any car, any brand — AM Group, Jammu'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const HEADLINE = 'What’s your car worth?'
const LINES = ['AM Group, Jammu', 'evaluates any car, any brand, free.', 'Since 1968 · 26 showrooms across J&K', 'Get my car’s price']

async function lato(weight: 400 | 900, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=Lato:wght@${weight}&text=${encodeURIComponent(text)}`)
    ).text()
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1]
    if (!url) return null
    const response = await fetch(url)
    return response.ok ? await response.arrayBuffer() : null
  } catch {
    return null
  }
}

export default async function OpenGraphImage() {
  const [black, regular] = await Promise.all([lato(900, HEADLINE + LINES[0]), lato(400, LINES.join(''))])
  const fonts = [
    ...(black ? [{ name: 'Lato', data: black, weight: 900 as const, style: 'normal' as const }] : []),
    ...(regular ? [{ name: 'Lato', data: regular, weight: 400 as const, style: 'normal' as const }] : []),
  ]

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#ffffff',
          fontFamily: fonts.length ? 'Lato' : undefined,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '84px 84px 0' }}>
          <div style={{ display: 'flex', color: '#13202c', fontSize: 112, fontWeight: 900, lineHeight: 1.04, letterSpacing: -2 }}>
            {HEADLINE}
          </div>
          <div style={{ display: 'flex', marginTop: 30, fontSize: 40, color: '#56687a' }}>
            <span style={{ color: '#c8470e', fontWeight: 900, marginRight: 12 }}>{LINES[0]}</span>
            {LINES[1]}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#edf1f4',
            padding: '34px 84px',
          }}
        >
          <div style={{ display: 'flex', color: '#13202c', fontSize: 30 }}>{LINES[2]}</div>
          <div
            style={{
              display: 'flex',
              background: '#c8470e',
              color: '#ffffff',
              fontSize: 30,
              padding: '18px 32px',
              borderRadius: 10,
            }}
          >
            {LINES[3]}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts },
  )
}
