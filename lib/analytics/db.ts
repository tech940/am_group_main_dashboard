import { getAnalyticsProvider } from './index'

/**
 * Drop-in analytics database executor for dashboard API routes and lib modules.
 * Defaults to Postgres until ANALYTICS_READ_SOURCE is set to dual or bigquery.
 */
export const analyticsDb = {
  async execute(query: unknown) {
    const result = await getAnalyticsProvider().execute(query)
    return result.rows
  },
  tableExists: (tableName: string) => getAnalyticsProvider().tableExists(tableName),
}

export async function analyticsExecute<T = Record<string, unknown>>(query: unknown): Promise<T[]> {
  const result = await getAnalyticsProvider().execute(query)
  return result.rows as T[]
}
