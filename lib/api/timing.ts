type TimingEntry = {
  name: string
  durationMs: number
}

export function createApiTimer(label: string) {
  const startedAt = performance.now()
  const entries: TimingEntry[] = []

  async function time<T>(name: string, work: () => Promise<T>): Promise<T> {
    const stepStartedAt = performance.now()
    try {
      return await work()
    } finally {
      entries.push({
        name,
        durationMs: performance.now() - stepStartedAt,
      })
    }
  }

  function finish() {
    const totalMs = performance.now() - startedAt
    const detail = entries
      .map((entry) => `${entry.name}=${Math.round(entry.durationMs)}ms`)
      .join(' ')

    if (process.env.NODE_ENV !== 'production' || totalMs > 1000) {
      console.info(`[api:${label}] total=${Math.round(totalMs)}ms${detail ? ` ${detail}` : ''}`)
    }

    return {
      totalMs,
      serverTiming: [
        `total;dur=${Math.round(totalMs)}`,
        ...entries.map((entry) => `${entry.name};dur=${Math.round(entry.durationMs)}`),
      ].join(', '),
    }
  }

  return { time, finish }
}

export function withServerTiming<T extends Response>(response: T, serverTiming: string) {
  response.headers.set('Server-Timing', serverTiming)
  return response
}
