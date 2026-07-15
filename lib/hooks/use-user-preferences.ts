'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

export interface UserPreference {
  id: string
  userId: string
  preferenceKey: string
  preferenceValue: unknown
  createdAt: string
  updatedAt: string
}

// ONE shared query for ALL of the user's preferences.
//
// This used to be a raw useEffect fetch of ONE key per hook instance: every mount re-hit
// /api/user-preferences (no React Query cache), and two components asking for the same key fired two
// requests and then held two divergent copies of the same state. The route already supports a batched
// read (GET with no ?key= returns every preference), so we fetch that once, cache it under a single
// key, and let each caller select its own slice. The per-key public API is unchanged.
const PREFERENCES_QUERY_KEY = ['user-preferences'] as const

type PreferenceMap = Record<string, unknown>

async function fetchAllPreferences(): Promise<PreferenceMap> {
  const response = await fetch('/api/user-preferences')
  if (!response.ok) throw new Error(`Failed to load preferences: ${response.status}`)
  const data = (await response.json()) as { preferences?: UserPreference[] }
  const map: PreferenceMap = {}
  for (const preference of data.preferences ?? []) {
    map[preference.preferenceKey] = preference.preferenceValue
  }
  return map
}

export function useUserPreferences<T = Record<string, unknown>>(
  key: string,
  defaultValue: T
) {
  const queryClient = useQueryClient()

  // Inherits the global defaults (30min staleTime, no refetch on mount/focus/reconnect).
  const query = useQuery({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: fetchAllPreferences,
  })

  const stored = query.data ? query.data[key] : undefined
  const value = (stored === undefined ? defaultValue : stored) as T

  // Writes straight into the shared cache, so every component on this key updates together.
  const setValue = useCallback((next: T) => {
    queryClient.setQueryData<PreferenceMap>(PREFERENCES_QUERY_KEY, (current) => ({
      ...(current ?? {}),
      [key]: next,
    }))
  }, [queryClient, key])

  const savePreference = useCallback(async (newValue: T) => {
    setValue(newValue) // optimistic — the server is the durable copy, the cache is the live one
    const response = await fetch('/api/user-preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: newValue }),
    })
    if (!response.ok) throw new Error('Failed to save preference')
  }, [key, setValue])

  const deletePreference = useCallback(async () => {
    const response = await fetch(`/api/user-preferences?key=${encodeURIComponent(key)}`, { method: 'DELETE' })
    if (!response.ok) throw new Error('Failed to delete preference')
    queryClient.setQueryData<PreferenceMap>(PREFERENCES_QUERY_KEY, (current) => {
      const next = { ...(current ?? {}) }
      delete next[key]
      return next
    })
  }, [queryClient, key])

  return {
    value,
    loading: query.isLoading,
    error: query.error ? (query.error as Error).message : null,
    savePreference,
    deletePreference,
    setValue, // For optimistic updates
  }
}

// Specific hook for purchase orders view preferences
export interface PurchaseOrdersViewPreference {
  viewMode: 'card' | 'table'
  stickyHeader: boolean
  hiddenColumns: string[]
  approvalFilter: 'all' | 'pending' | 'approved' | 'rejected' | 'hold' | 'completed'
  completedDateStart: string
  completedDateEnd: string
}

const DEFAULT_PURCHASE_ORDERS_VIEW_PREFERENCE: PurchaseOrdersViewPreference = {
  viewMode: 'table',
  stickyHeader: false,
  hiddenColumns: [],
  approvalFilter: 'pending',
  completedDateStart: '',
  completedDateEnd: '',
}

export function usePurchaseOrdersViewPreference() {
  return useUserPreferences<PurchaseOrdersViewPreference>(
    'purchase_orders_view_mode',
    DEFAULT_PURCHASE_ORDERS_VIEW_PREFERENCE
  )
}
