'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as React from 'react'
import { useForm, FormProvider } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface FormFieldConfig {
  name: string
  label: string
  type?: 'text' | 'email' | 'password' | 'number' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[]
}

interface FormProps<T extends z.ZodType> {
  schema: T
  fields: FormFieldConfig[]
  onSubmit: (values: z.infer<T>) => void
  submitLabel?: string
  defaultValues?: z.infer<T>
  isLoading?: boolean
}

export function ReusableForm<T extends z.ZodType>({
  schema,
  fields,
  onSubmit,
  submitLabel = 'Submit',
  defaultValues,
  isLoading = false,
}: FormProps<T>) {
  const form = useForm({
    resolver: zodResolver(schema as any),
    defaultValues: defaultValues as any,
  })

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit as any)} autoComplete="off" className="space-y-6">
        {fields.map((field) => (
          <FormField
            key={field.name}
            control={form.control}
            name={field.name as any}
            render={({ field: formField }) => (
              <FormItem>
                <FormLabel>{field.label}</FormLabel>
                <FormControl>
                  {field.type === 'select' ? (
                    <Select
                      onValueChange={formField.onChange}
                      defaultValue={formField.value}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={field.placeholder} />
                      </SelectTrigger>
                      <SelectContent>
                        {field.options?.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type={field.type || 'text'}
                      placeholder={field.placeholder}
                      {...formField}
                    />
                  )}
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
        <Button type="submit" disabled={isLoading} className="w-full">
          {isLoading ? 'Loading...' : submitLabel}
        </Button>
      </form>
    </FormProvider>
  )
}
