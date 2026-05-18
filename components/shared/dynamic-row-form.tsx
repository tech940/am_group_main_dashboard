'use client'

import React, { useState, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ChevronLeft, ChevronRight, Plus, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FieldConfig {
  name: string
  type: 'text' | 'number' | 'date'
  required: boolean
}

interface DynamicRowFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sheetId: string
  sheetName: string
  columns: string[]
  existingData: Record<string, unknown>[]
  onSuccess: () => void
}

export function DynamicRowForm({
  open,
  onOpenChange,
  sheetId,
  sheetName,
  columns,
  existingData,
  onSuccess
}: DynamicRowFormProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // Auto-detect field types from existing data and filter out serial number fields
  const fieldConfigs = useMemo<FieldConfig[]>(() => {
    return columns
      .filter(col => {
        // Exclude serial number columns (case-insensitive)
        const colLower = col.toLowerCase().trim()
        return !['s no', 'sno', 's.no', 'no', 'sr no', 'sr.no', 'serial no', 'serial number', '#'].includes(colLower)
      })
      .map(col => {
        const config: FieldConfig = {
          name: col,
          type: 'text',
          required: false
        }

        // Sample first 10 rows to detect type
        const samples = existingData.slice(0, 10).map(row => row[col])
        const nonNullSamples = samples.filter(val => val !== null && val !== undefined && val !== '')

        if (nonNullSamples.length > 0) {
          // Check if all samples are numbers
          const allNumbers = nonNullSamples.every(val =>
            typeof val === 'number' || !isNaN(Number(val))
          )
          if (allNumbers) {
            config.type = 'number'
          }

          // Check if samples look like dates
          const allDates = nonNullSamples.every(val => {
            const str = String(val)
            return /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(str) ||
                   /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(str) ||
                   !isNaN(Date.parse(str))
          })
          if (allDates && !allNumbers) {
            config.type = 'date'
          }
        }

        return config
      })
  }, [columns, existingData])

  // Split fields into steps (6 fields per step)
  const fieldsPerStep = 6
  const totalSteps = Math.ceil(fieldConfigs.length / fieldsPerStep)
  const isMultiStep = fieldConfigs.length > 6

  const currentFields = useMemo(() => {
    const start = currentStep * fieldsPerStep
    const end = start + fieldsPerStep
    return fieldConfigs.slice(start, end)
  }, [currentStep, fieldConfigs])

  const handleInputChange = (fieldName: string, value: string) => {
    setFormData(prev => ({ ...prev, [fieldName]: value }))
    // Clear error when user starts typing
    if (errors[fieldName]) {
      setErrors(prev => {
        const newErrors = { ...prev }
        delete newErrors[fieldName]
        return newErrors
      })
    }
  }

  // Handle Enter key press to move to next step
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, fieldIndex: number) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      
      // If this is the last field in the current step
      if (fieldIndex === currentFields.length - 1) {
        // If not on the last step, move to next step
        if (currentStep < totalSteps - 1) {
          if (validateStep()) {
            handleNext()
          }
        } else {
          // On last step, submit the form
          handleSubmit()
        }
      } else {
        // Move focus to next input field
        const nextInput = document.querySelector<HTMLInputElement>(
          `input[id="${currentFields[fieldIndex + 1].name}"]`
        )
        if (nextInput) {
          nextInput.focus()
        }
      }
    }
  }

  const validateStep = () => {
    const newErrors: Record<string, string> = {}

    currentFields.forEach(field => {
      const value = formData[field.name]

      if (field.required && (!value || value.trim() === '')) {
        newErrors[field.name] = 'This field is required'
      }

      if (value && value.trim() !== '') {
        if (field.type === 'number' && isNaN(Number(value))) {
          newErrors[field.name] = 'Please enter a valid number'
        }

        if (field.type === 'date') {
          const dateValue = new Date(value)
          if (isNaN(dateValue.getTime())) {
            newErrors[field.name] = 'Please enter a valid date'
          }
        }
      }
    })

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleNext = () => {
    if (validateStep()) {
      setCurrentStep(prev => Math.min(prev + 1, totalSteps - 1))
    }
  }

  const handlePrevious = () => {
    setCurrentStep(prev => Math.max(prev - 1, 0))
  }

  const handleSubmit = async () => {
    if (!validateStep()) return

    setSubmitting(true)
    try {
      // Find serial number column and auto-generate value
      const serialNumberCol = columns.find(col => {
        const colLower = col.toLowerCase().trim()
        return ['s no', 'sno', 's.no', 'no', 'sr no', 'sr.no', 'serial no', 'serial number', '#'].includes(colLower)
      })

      // Prepare row data with auto-generated serial number
      const rowDataWithSerial: Record<string, string | number> = { ...formData }
      if (serialNumberCol) {
        rowDataWithSerial[serialNumberCol] = existingData.length + 1
      }

      const response = await fetch('/api/brands/kia/business-excellence/rows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheetId,
          rowData: rowDataWithSerial
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to add row')
      }

      // Reset form
      setFormData({})
      setCurrentStep(0)
      setErrors({})
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      console.error('Error adding row:', error)
      alert(error instanceof Error ? error.message : 'Failed to add row')
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    setFormData({})
    setCurrentStep(0)
    setErrors({})
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl bg-white border-slate-200 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-slate-800 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-teal-50 flex items-center justify-center border border-teal-100">
              <Plus className="h-5 w-5 text-teal-600" />
            </div>
            Add New Row to {sheetName}
          </DialogTitle>
          {isMultiStep && (
            <div className="flex items-center gap-2 mt-4">
              {Array.from({ length: totalSteps }, (_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-all duration-300",
                    i <= currentStep ? "bg-teal-600" : "bg-slate-200"
                  )}
                />
              ))}
            </div>
          )}
        </DialogHeader>

        <div className="space-y-6 py-4">
          {isMultiStep && (
            <div className="text-center">
              <p className="text-sm font-bold text-slate-600">
                Step {currentStep + 1} of {totalSteps}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Fill in the fields below • Press <kbd className="px-1.5 py-0.5 text-xs font-semibold bg-slate-100 border border-slate-300 rounded">Enter</kbd> to move to next field/step
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto pr-2">
            {currentFields.map((field, index) => (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={field.name} className="text-sm font-bold text-slate-700">
                  {field.name}
                  {field.required && <span className="text-rose-500 ml-1">*</span>}
                </Label>
                <Input
                  id={field.name}
                  type={field.type}
                  value={formData[field.name] || ''}
                  onChange={(e) => handleInputChange(field.name, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(e, index)}
                  placeholder={`Enter ${field.name.toLowerCase()}`}
                  className={cn(
                    "rounded-lg border-slate-200 focus:border-teal-500 focus:ring-teal-500",
                    errors[field.name] && "border-rose-500 focus:border-rose-500 focus:ring-rose-500"
                  )}
                  autoFocus={index === 0}
                />
                {errors[field.name] && (
                  <p className="text-xs text-rose-600 font-semibold">{errors[field.name]}</p>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            {isMultiStep ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePrevious}
                  disabled={currentStep === 0}
                  className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  Previous
                </Button>

                {currentStep < totalSteps - 1 ? (
                  <Button
                    type="button"
                    onClick={handleNext}
                    className="rounded-xl bg-teal-600 hover:bg-teal-700 text-white shadow-lg"
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Row
                      </>
                    )}
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  className="rounded-xl border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Add Row
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Made with Bob
