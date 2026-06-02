'use client'

import { useState, useEffect, useCallback } from 'react'

export interface UserPreference {
  id: string
  userId: string
  preferenceKey: string
  preferenceValue: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export function useUserPreferences<T = Record<string, unknown>>(
  key: string,
  defaultValue: T
) {
  const [value, setValue] = useState<T>(defaultValue)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load preference on mount
  useEffect(() => {
    const loadPreference = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/user-preferences?key=${encodeURIComponent(key)}`)
        
        if (!response.ok) {
          throw new Error('Failed to load preference')
        }

        const data = await response.json()
        
        if (data.preference && data.preference.preferenceValue) {
          setValue(data.preference.preferenceValue as T)
        } else {
          setValue(defaultValue)
        }
      } catch (err) {
        console.error('Error loading preference:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
        setValue(defaultValue)
      } finally {
        setLoading(false)
      }
    }

    loadPreference()
  }, [key, defaultValue])

  // Save preference
  const savePreference = useCallback(async (newValue: T) => {
    try {
      const response = await fetch('/api/user-preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key,
          value: newValue,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to save preference')
      }

      setValue(newValue)
      setError(null)
    } catch (err) {
      console.error('Error saving preference:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    }
  }, [key])

  // Delete preference
  const deletePreference = useCallback(async () => {
    try {
      const response = await fetch(`/api/user-preferences?key=${encodeURIComponent(key)}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete preference')
      }

      setValue(defaultValue)
      setError(null)
    } catch (err) {
      console.error('Error deleting preference:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    }
  }, [key, defaultValue])

  return {
    value,
    loading,
    error,
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

// Made with Bob
