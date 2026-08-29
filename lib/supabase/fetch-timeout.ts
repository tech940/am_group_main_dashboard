export function fetchWithTimeout(timeoutMs = 10_000): typeof fetch {
  return async (input, init) => {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      try {
        return await fetch(input, {
          ...init,
          signal: controller.signal,
        })
      } catch (error) {
        lastError = error
        const isTimeout =
          error instanceof Error &&
          (error.name === 'AbortError' ||
            error.name === 'ConnectTimeoutError' ||
            ('code' in error && (error as { code?: unknown }).code === 'UND_ERR_CONNECT_TIMEOUT'))
        if (attempt === 0 && isTimeout) {
          continue
        }
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error(`Fetch timed out after ${timeoutMs}ms`)
        }
        throw error
      } finally {
        clearTimeout(timeoutId)
      }
    }
    throw lastError
  }
}
