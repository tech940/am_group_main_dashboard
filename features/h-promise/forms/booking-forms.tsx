'use client'

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { bookingSchema, refundSchema } from '@/lib/h-promise/schemas'
import type { HpBooking, HpVehicleDetail } from '@/lib/h-promise/types'
import { hpSend, useHpMutation } from '../hp-data'
import { useHpSection } from '../hp-context'
import { day, inr } from '../hp-format'
import { DateInput, FileSlot, FormField, FormGrid, FormSection, MoneyInput, TextArea, validate, type FieldErrors, type StagedFile } from '../hp-form'
import { HpButton, Notice } from '../hp-ui'
import { FormFooter } from './form-footer'

/** Record a booking — or, with `booking`, correct one. Only an approver may change the amount. */
export function BookingForm({ vehicle, booking, onDone, onCancel }: { vehicle: HpVehicleDetail; booking?: HpBooking; onDone: () => void; onCancel: () => void }) {
  const { meta, caps } = useHpSection()
  const editing = Boolean(booking)
  const [bookingDate, setBookingDate] = React.useState(booking?.bookingDate ?? meta?.today ?? '')
  const [amount, setAmount] = React.useState(booking ? String(booking.amount) : '')
  const [remarks, setRemarks] = React.useState(booking?.remarks ?? '')
  const [reason, setReason] = React.useState('')
  const [receipt, setReceipt] = React.useState<StagedFile | null>(null)
  const [errors, setErrors] = React.useState<FieldErrors>({})
  const [serverError, setServerError] = React.useState<string | null>(null)
  const existingReceipt = booking?.files.find((file) => file.kind === 'booking_receipt') ?? null
  const amountLocked = editing && !caps.approvals.approve
  const amountChanged = editing && Number(amount.replace(/[,\s]/g, '')) !== booking!.amount

  const mutation = useHpMutation((payload: Record<string, unknown>) =>
    editing
      ? hpSend(`/api/h-promise/bookings/${booking!.id}`, 'PATCH', payload)
      : hpSend(`/api/h-promise/vehicles/${vehicle.id}/bookings`, 'POST', payload),
  )

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setServerError(null)
    const files = receipt ? { booking_receipt: receipt.fileId } : {}
    const check = validate(bookingSchema, { bookingDate, amount, remarks, files })
    const next: FieldErrors = check.ok ? {} : { ...check.errors }
    if (!receipt && !existingReceipt) next.receipt = 'Attach the booking receipt.'
    if (meta?.today && bookingDate > meta.today) next.bookingDate = 'The booking date cannot be in the future.'
    if (bookingDate && bookingDate < vehicle.purchaseDate) next.bookingDate = `The booking cannot be before the purchase (${day(vehicle.purchaseDate)}).`
    if (amountChanged && reason.trim().length < 5) next.reason = 'Say why the amount is being corrected.'
    setErrors(next)
    if (Object.keys(next).length) return
    try {
      if (editing) {
        const payload: Record<string, unknown> = { files }
        if (bookingDate !== booking!.bookingDate) payload.bookingDate = bookingDate
        if (remarks !== (booking!.remarks ?? '')) payload.remarks = remarks
        if (amountChanged) payload.amount = amount
        if (reason.trim()) payload.reason = reason.trim()
        await mutation.mutateAsync(payload)
      } else {
        await mutation.mutateAsync({ bookingDate, amount, remarks, files })
      }
      onDone()
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'The booking could not be saved.')
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="hp-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        <FormSection title={editing ? 'Correct the booking' : 'Booking'} description="Money taken from a customer to hold this car.">
          <FormGrid>
            <FormField label="Booking date" htmlFor="bf-date" required error={errors.bookingDate}>
              <DateInput id="bf-date" value={bookingDate} onValue={setBookingDate} min={vehicle.purchaseDate} max={meta?.today} invalid={Boolean(errors.bookingDate)} />
            </FormField>
            <FormField label="Amount received" htmlFor="bf-amount" required error={errors.amount}
              hint={amountLocked ? 'Only an approver can correct the amount.' : undefined}>
              <MoneyInput id="bf-amount" value={amount} onValue={setAmount} invalid={Boolean(errors.amount)} disabled={amountLocked} />
            </FormField>
            <FormField label="Remarks" htmlFor="bf-remarks" error={errors.remarks} wide>
              <TextArea id="bf-remarks" value={remarks} onValue={setRemarks} rows={2} maxLength={500} placeholder="Customer, balance due, delivery plan…" />
            </FormField>
            <div className="sm:col-span-2">
              <FileSlot kind="booking_receipt" required existing={existingReceipt} staged={receipt} onStaged={setReceipt} error={errors.receipt} />
            </div>
            {amountChanged && (
              <FormField label="Why the amount changes" htmlFor="bf-reason" required error={errors.reason} wide>
                <TextArea id="bf-reason" value={reason} onValue={setReason} rows={2} maxLength={500} />
              </FormField>
            )}
          </FormGrid>
        </FormSection>
        {serverError && <Notice tone="rejected" icon={<AlertTriangle className="h-4 w-4" />}>{serverError}</Notice>}
      </div>
      <FormFooter>
        <HpButton variant="ghost" onClick={onCancel} disabled={mutation.isPending}>Cancel</HpButton>
        <HpButton type="submit" variant="accent" busy={mutation.isPending}>{editing ? 'Save booking' : 'Record booking'}</HpButton>
      </FormFooter>
    </form>
  )
}

export function RefundForm({ vehicle, booking, onDone, onCancel }: { vehicle: HpVehicleDetail; booking: HpBooking; onDone: () => void; onCancel: () => void }) {
  const { meta } = useHpSection()
  const [refundDate, setRefundDate] = React.useState(meta?.today ?? '')
  const [refundRemarks, setRemarks] = React.useState('')
  const [cheque, setCheque] = React.useState<StagedFile | null>(null)
  const [errors, setErrors] = React.useState<FieldErrors>({})
  const [serverError, setServerError] = React.useState<string | null>(null)
  const mutation = useHpMutation((payload: Record<string, unknown>) => hpSend(`/api/h-promise/bookings/${booking.id}/refund`, 'POST', payload))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setServerError(null)
    const files = cheque ? { refund_cheque: cheque.fileId } : {}
    const check = validate(refundSchema, { refundDate, refundRemarks, files })
    const next: FieldErrors = check.ok ? {} : { ...check.errors }
    if (!cheque) next.cheque = 'Attach the refund cheque.'
    if (refundDate && refundDate < booking.bookingDate) next.refundDate = `The refund cannot be before the booking (${day(booking.bookingDate)}).`
    setErrors(next)
    if (Object.keys(next).length) return
    try {
      await mutation.mutateAsync({ refundDate, refundRemarks, files })
      onDone()
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'The refund could not be saved.')
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="hp-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        <Notice tone="booked">
          Refunding the {inr(booking.amount)} booking on {vehicle.model} taken on {day(booking.bookingDate)}. The car goes back to stock and can be booked again.
        </Notice>
        <FormGrid>
          <FormField label="Refund date" htmlFor="rf-date" required error={errors.refundDate}>
            <DateInput id="rf-date" value={refundDate} onValue={setRefundDate} min={booking.bookingDate} max={meta?.today} invalid={Boolean(errors.refundDate)} />
          </FormField>
          <FormField label="Why it was refunded" htmlFor="rf-remarks" required error={errors.refundRemarks} wide>
            <TextArea id="rf-remarks" value={refundRemarks} onValue={setRemarks} rows={2} maxLength={500} invalid={Boolean(errors.refundRemarks)} />
          </FormField>
          <div className="sm:col-span-2">
            <FileSlot kind="refund_cheque" required staged={cheque} onStaged={setCheque} error={errors.cheque} />
          </div>
        </FormGrid>
        {serverError && <Notice tone="rejected" icon={<AlertTriangle className="h-4 w-4" />}>{serverError}</Notice>}
      </div>
      <FormFooter>
        <HpButton variant="ghost" onClick={onCancel} disabled={mutation.isPending}>Cancel</HpButton>
        <HpButton type="submit" variant="reject" busy={mutation.isPending}>Record refund</HpButton>
      </FormFooter>
    </form>
  )
}

export function findBooking(vehicle: HpVehicleDetail, bookingId?: string): HpBooking | undefined {
  return vehicle.bookings.find((booking) => booking.id === bookingId) ?? vehicle.bookings.find((booking) => booking.status === 'active')
}
