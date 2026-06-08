type JsonErrorPayload = {
  error?: unknown
  message?: unknown
}

function payloadMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as JsonErrorPayload
  if (typeof record.error === 'string') return record.error
  if (typeof record.message === 'string') return record.message
  return ''
}

export async function readPlatinumJson<T>(response: Response, label: string): Promise<T> {
  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()

  if (!contentType.toLowerCase().includes('application/json')) {
    const snippet = text.trim().slice(0, 140).replace(/\s+/g, ' ')
    const pageHint = snippet.startsWith('<!DOCTYPE') || snippet.startsWith('<html')
      ? ' The server returned an HTML page instead of API JSON.'
      : snippet
        ? ` Response starts with: ${snippet}`
        : ''
    throw new Error(`${label} failed (${response.status}). Expected JSON but received ${contentType || 'unknown content type'}.${pageHint}`)
  }

  let payload: unknown
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new Error(`${label} failed (${response.status}). API returned invalid JSON.`)
  }

  if (!response.ok) {
    throw new Error(payloadMessage(payload) || `${label} failed (${response.status})`)
  }

  return payload as T
}
