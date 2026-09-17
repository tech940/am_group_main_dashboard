'use client'

import * as React from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { PAPERWORK_STATUS_LABELS, PAPERWORK_STATUS_VALUES, type FileKind } from '@/lib/h-promise/constants'
import { DOCUMENT_FILE_KINDS } from '@/lib/h-promise/schemas'
import type { HpVehicleDetail } from '@/lib/h-promise/types'
import { hpSend, useHpMutation } from '../hp-data'
import { useHpSection } from '../hp-context'
import { day, inr } from '../hp-format'
import { DateInput, FileSlot, FormField, FormGrid, FormSection, NativeSelect, TextArea, type StagedFile } from '../hp-form'
import { HpButton, Notice } from '../hp-ui'
import { FormFooter } from './form-footer'

type DocKind = (typeof DOCUMENT_FILE_KINDS)[number]

const DOC_GROUPS: Array<{ title: string; description: string; kinds: DocKind[] }> = [
  { title: 'Registration and seller KYC', description: 'Every sold car needs these four, with the insurance copy.', kinds: ['rc', 'seller_aadhaar', 'seller_pan', 'credit_note'] },
  { title: 'Insurance', description: 'The end date drives the insurance alerts for cars in stock.', kinds: ['insurance_copy'] },
  { title: 'Hypothecation and RTO', description: 'Form 35 once the loan is closed; the RTO mail once the record is updated.', kinds: ['form_35', 'rto_mail'] },
]

function useStaged<K extends FileKind>() {
  const [staged, setStaged] = React.useState<Partial<Record<K, StagedFile>>>({})
  const setOne = (kind: K) => (file: StagedFile | null) => setStaged((current) => ({ ...current, [kind]: file ?? undefined }))
  const ids = () => Object.fromEntries(Object.entries(staged).map(([kind, file]) => [kind, (file as StagedFile).fileId]))
  return { staged, setOne, ids, count: Object.values(staged).filter(Boolean).length }
}

export function DocumentsForm({ vehicle, onDone, onCancel }: { vehicle: HpVehicleDetail; onDone: () => void; onCancel: () => void }) {
  const [insuranceEndDate, setInsurance] = React.useState(vehicle.insuranceEndDate ?? '')
  const [hypothecation, setHyp] = React.useState(vehicle.hypothecation ?? '')
  const [rtoStatus, setRto] = React.useState(vehicle.rtoStatus ?? '')
  const [documentsRemarks, setRemarks] = React.useState(vehicle.documentsRemarks ?? '')
  const files = useStaged<DocKind>()
  const [serverError, setServerError] = React.useState<string | null>(null)
  const mutation = useHpMutation((payload: Record<string, unknown>) => hpSend(`/api/h-promise/vehicles/${vehicle.id}/documents`, 'PUT', payload))
  const statusOptions = PAPERWORK_STATUS_VALUES.map((value) => ({ value, label: PAPERWORK_STATUS_LABELS[value] }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setServerError(null)
    const payload: Record<string, unknown> = { expectedUpdatedAt: vehicle.updatedAt, files: files.ids() }
    if (insuranceEndDate !== (vehicle.insuranceEndDate ?? '')) payload.insuranceEndDate = insuranceEndDate
    if (hypothecation !== (vehicle.hypothecation ?? '')) payload.hypothecation = hypothecation
    if (rtoStatus !== (vehicle.rtoStatus ?? '')) payload.rtoStatus = rtoStatus
    if (documentsRemarks !== (vehicle.documentsRemarks ?? '')) payload.documentsRemarks = documentsRemarks
    if (Object.keys(payload).length === 2 && files.count === 0) {
      onDone()
      return
    }
    try {
      await mutation.mutateAsync(payload)
      onDone()
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'The documents could not be saved.')
    }
  }

  const current = (kind: FileKind) => vehicle.files.find((file) => file.kind === kind) ?? null
  const sold = vehicle.stage === 'sold'

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="hp-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        {sold && vehicle.flags.docsMissing && (
          <Notice tone="pending" icon={<AlertTriangle className="h-4 w-4" />}>
            Sold, and still missing: {vehicle.flags.missingDocs.map((kind) => kind.replace(/_/g, ' ')).join(', ')}.
          </Notice>
        )}
        {DOC_GROUPS.map((group) => (
          <FormSection key={group.title} title={group.title} description={group.description}>
            {group.title === 'Insurance' && (
              <FormGrid>
                <FormField label="Insurance ends on" htmlFor="df-insurance">
                  <DateInput id="df-insurance" value={insuranceEndDate} onValue={setInsurance} />
                </FormField>
              </FormGrid>
            )}
            {group.title === 'Hypothecation and RTO' && (
              <FormGrid>
                <FormField label="Hypothecation removal" htmlFor="df-hyp">
                  <NativeSelect id="df-hyp" value={hypothecation} onValue={setHyp} options={statusOptions} placeholder="Not recorded" />
                </FormField>
                <FormField label="RTO update" htmlFor="df-rto">
                  <NativeSelect id="df-rto" value={rtoStatus} onValue={setRto} options={statusOptions} placeholder="Not recorded" />
                </FormField>
              </FormGrid>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {group.kinds.map((kind) => (
                <FileSlot
                  key={kind}
                  kind={kind}
                  required={sold && ['rc', 'seller_aadhaar', 'seller_pan', 'insurance_copy'].includes(kind)}
                  existing={current(kind)}
                  staged={files.staged[kind] ?? null}
                  onStaged={files.setOne(kind)}
                />
              ))}
            </div>
          </FormSection>
        ))}
        <FormSection title="Remarks">
          <TextArea id="df-remarks" value={documentsRemarks} onValue={setRemarks} rows={2} maxLength={1000} placeholder="What is pending and with whom" />
        </FormSection>
        {serverError && <Notice tone="rejected" icon={<AlertTriangle className="h-4 w-4" />}>{serverError}</Notice>}
      </div>
      <FormFooter note={vehicle.documentsUpdatedAt ? `Last updated by ${vehicle.documentsUpdatedByName ?? '—'}` : undefined}>
        <HpButton variant="ghost" onClick={onCancel} disabled={mutation.isPending}>Cancel</HpButton>
        <HpButton type="submit" variant="accent" busy={mutation.isPending}>Save documents</HpButton>
      </FormFooter>
    </form>
  )
}

export function BrokerRcForm({ vehicle, onDone, onCancel }: { vehicle: HpVehicleDetail; onDone: () => void; onCancel: () => void }) {
  const [remarks, setRemarks] = React.useState(vehicle.brokerRcRemarks ?? '')
  const files = useStaged<'rc_transfer'>()
  const [serverError, setServerError] = React.useState<string | null>(null)
  const mutation = useHpMutation((payload: Record<string, unknown>) => hpSend(`/api/h-promise/vehicles/${vehicle.id}/broker-rc`, 'PUT', payload))
  const existing = vehicle.files.find((file) => file.kind === 'rc_transfer') ?? null

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setServerError(null)
    const payload: Record<string, unknown> = { expectedUpdatedAt: vehicle.updatedAt, files: files.ids() }
    if (remarks !== (vehicle.brokerRcRemarks ?? '')) payload.brokerRcRemarks = remarks
    try {
      await mutation.mutateAsync(payload)
      onDone()
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'The RC status could not be saved.')
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="hp-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        <Notice tone="accent">
          Sold to a broker{vehicle.buyerName ? ` (${vehicle.buyerName})` : ''} on {day(vehicle.saleDate)}. Until the RC is in the new owner&apos;s name, the car is still ours on paper.
        </Notice>
        <FileSlot kind="rc_transfer" label="RC transfer proof" existing={existing} staged={files.staged.rc_transfer ?? null} onStaged={files.setOne('rc_transfer')} />
        <FormField label="Remarks" htmlFor="rc-remarks">
          <TextArea id="rc-remarks" value={remarks} onValue={setRemarks} rows={3} maxLength={1000} placeholder="Where the transfer stands, e.g. papers given to the broker on 12 Sep" />
        </FormField>
        {serverError && <Notice tone="rejected" icon={<AlertTriangle className="h-4 w-4" />}>{serverError}</Notice>}
      </div>
      <FormFooter>
        <HpButton variant="ghost" onClick={onCancel} disabled={mutation.isPending}>Cancel</HpButton>
        <HpButton type="submit" variant="accent" busy={mutation.isPending}>Save RC status</HpButton>
      </FormFooter>
    </form>
  )
}

/** Payment verification: accounts upload the ledger once. Replacing it is an admin act. */
export function LedgerForm({ vehicle, onDone, onCancel }: { vehicle: HpVehicleDetail; onDone: () => void; onCancel: () => void }) {
  const { caps } = useHpSection()
  const files = useStaged<'payment_ledger'>()
  const [remarks, setRemarks] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const mutation = useHpMutation((payload: Record<string, unknown>) => hpSend(`/api/h-promise/vehicles/${vehicle.id}/ledger`, 'POST', payload))
  const existing = vehicle.files.find((file) => file.kind === 'payment_ledger') ?? null
  const replacing = Boolean(existing)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!files.staged.payment_ledger) {
      setError('Attach the payment ledger.')
      return
    }
    try {
      await mutation.mutateAsync({ files: files.ids(), remarks })
      onDone()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The ledger could not be saved.')
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="hp-scroll min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
        <Notice tone="sold" icon={<ShieldCheck className="h-4 w-4" />}>
          Sold on {day(vehicle.saleDate)} for {inr(vehicle.sellingPrice)}{vehicle.soldBy ? ` by ${vehicle.soldBy}` : ''}. Upload the customer&apos;s account ledger showing the payment received.
        </Notice>
        {replacing && (
          <Notice tone="pending" icon={<AlertTriangle className="h-4 w-4" />}>
            A ledger is already on file. {caps.isSuperAdmin ? 'Uploading replaces it; the old one is kept in the history.' : 'Only an admin can replace it.'}
          </Notice>
        )}
        <FileSlot kind="payment_ledger" required existing={existing} staged={files.staged.payment_ledger ?? null} onStaged={files.setOne('payment_ledger')} error={error && !files.staged.payment_ledger ? error : undefined} />
        <FormField label="Remarks" htmlFor="lf-remarks">
          <TextArea id="lf-remarks" value={remarks} onValue={setRemarks} rows={2} maxLength={500} placeholder="Optional" />
        </FormField>
        {error && files.staged.payment_ledger && <Notice tone="rejected" icon={<AlertTriangle className="h-4 w-4" />}>{error}</Notice>}
      </div>
      <FormFooter>
        <HpButton variant="ghost" onClick={onCancel} disabled={mutation.isPending}>Cancel</HpButton>
        <HpButton type="submit" variant="accent" busy={mutation.isPending} disabled={replacing && !caps.isSuperAdmin}>
          {replacing ? 'Replace ledger' : 'Upload ledger'}
        </HpButton>
      </FormFooter>
    </form>
  )
}
