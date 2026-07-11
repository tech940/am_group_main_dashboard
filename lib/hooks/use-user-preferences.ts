'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface UserPreference {
  id: string
  userId: string
  preferenceKey: string
  preferenceValue: unknown
  createdAt: string
  updatedAt: string
}

function preferenceValuesEqual(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true

  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

export function useUserPreferences<T = Record<string, unknown>>(
  key: string,
  defaultValue: T
) {
  const [value, setValue] = useState<T>(defaultValue)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const defaultValueRef = useRef(defaultValue)

  // Load preference on mount
  useEffect(() => {
    let isActive = true

    const loadPreference = async () => {
      try {
        if (isActive) setLoading(true)
        const response = await fetch(`/api/user-preferences?key=${encodeURIComponent(key)}`)
        
        if (!response.ok) {
          console.warn(`Failed to load preference for key "${key}":`, response.statusText)
          if (isActive) {
            setError(`Failed to load preference: ${response.status}`)
            setValue((current) => preferenceValuesEqual(current, defaultValueRef.current) ? current : defaultValueRef.current)
          }
          return
        }

        const data = await response.json()

        const nextValue = data.preference && data.preference.preferenceValue !== undefined
          ? data.preference.preferenceValue as T
          : defaultValueRef.current

        if (isActive) {
          setValue((current) => preferenceValuesEqual(current, nextValue) ? current : nextValue)
          setError(null)
        }
      } catch (err) {
        console.error('Error loading preference:', err)
        if (isActive) {
          setError(err instanceof Error ? err.message : 'Unknown error')
          setValue((current) => preferenceValuesEqual(current, defaultValueRef.current) ? current : defaultValueRef.current)
        }
      } finally {
        if (isActive) setLoading(false)
      }
    }

    void loadPreference()

    return () => {
      isActive = false
    }
  }, [key])

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

      setValue((current) => preferenceValuesEqual(current, defaultValueRef.current) ? current : defaultValueRef.current)
      setError(null)
    } catch (err) {
      console.error('Error deleting preference:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
      throw err
    }
  }, [key])

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
