'use client'

import { useState, useEffect } from 'react'
import {
  ScrapTransaction,
  ScrapLocation,
  ScrapDepartment,
  ScrapType,
  ScrapDescription,
  ScrapPaymentMode,
  ScrapHandoverUser,
  ScrapGroup,
  ScrapAttachment,
} from '@/lib/scrap-erp/types'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Pencil, Save, Calculator, FileText, FileCheck, ImageIcon, Upload, X } from 'lucide-react'
import { compressAndConvertToWebp } from './image-optimizer'

export function EditScrapRecordModal({
  transaction,
  isOpen,
  onClose,
  groups = [],
  locations = [],
  departments = [],
  scrapTypes = [],
  descriptions = [],
  paymentModes = [],
  handoverUsers = [],
  onSaveUpdate,
}: {
  transaction: ScrapTransaction | null
  isOpen: boolean
  onClose: () => void
  groups?: ScrapGroup[]
  locations?: ScrapLocation[]
  departments?: ScrapDepartment[]
  scrapTypes?: ScrapType[]
  descriptions?: ScrapDescription[]
  paymentModes?: ScrapPaymentMode[]
  handoverUsers?: ScrapHandoverUser[]
  onSaveUpdate: (updatedTxn: ScrapTransaction) => Promise<void>
}) {
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')
  const [selectedLocationId, setSelectedLocationId] = useState<string>('')
  const [selectedDeptId, setSelectedDeptId] = useState<string>('')
  const [selectedTypeId, setSelectedTypeId] = useState<string>('')
  const [descriptionInput, setDescriptionInput] = useState<string>('')
  const [weightQty, setWeightQty] = useState<string>('')
  const [ratePerUnit, setRatePerUnit] = useState<string>('')
  const [amountReceivedInput, setAmountReceivedInput] = useState<string>('')
  const [soldTo, setSoldTo] = useState<string>('')
  const [soldDate, setSoldDate] = useState<string>('')
  const [selectedPaymentModeId, setSelectedPaymentModeId] = useState<string>('')
  const [selectedHandoverUserId, setSelectedHandoverUserId] = useState<string>('')
  const [remarks, setRemarks] = useState<string>('')

  const [attachmentsList, setAttachmentsList] = useState<ScrapAttachment[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (transaction) {
      setSelectedGroupId(transaction.groupId || groups[0]?.id || '')
      setSelectedLocationId(transaction.locationId || locations[0]?.id || '')
      setSelectedDeptId(transaction.departmentId || departments[0]?.id || '')
      setSelectedTypeId(transaction.scrapTypeId || scrapTypes[0]?.id || '')
      setDescriptionInput(transaction.description || '')
      setWeightQty(String(transaction.weightQty || ''))
      setRatePerUnit(String(transaction.ratePerUnit || ''))
      setAmountReceivedInput(String(transaction.amountReceived || ''))
      setSoldTo(transaction.soldTo || '')
      setSoldDate(transaction.soldDate || transaction.timestamp?.slice(0, 10) || new Date().toISOString().split('T')[0])
      setSelectedPaymentModeId(transaction.paymentModeId || paymentModes[0]?.id || '')
      setSelectedHandoverUserId(transaction.paymentHandoverToId || handoverUsers[0]?.id || '')
      setRemarks(transaction.remarks || '')
      setAttachmentsList(transaction.attachments || [])
    }
  }, [transaction, isOpen])

  if (!transaction) return null

  // Recalculate valuations dynamically
  const wt = parseFloat(weightQty) || 0
  const rate = parseFloat(ratePerUnit) || 0
  const calculatedTotal = Math.round(wt * rate * 100) / 100
  const amountReceived = amountReceivedInput !== '' ? parseFloat(amountReceivedInput) : calculatedTotal
  const outstandingAmount = Math.max(0, calculatedTotal - (amountReceived || 0))

  const selectedType = scrapTypes.find((t) => t.id === selectedTypeId) || scrapTypes[0]

  const handleFileUploadMock = async (file: File, type: 'weight_picture' | 'tally_receipt' | 'scrap_picture') => {
    try {
      setIsSubmitting(true)
      const { dataUrl } = await compressAndConvertToWebp(file)
      const newAtt: ScrapAttachment = {
        id: `att-edit-${Date.now()}`,
        transactionId: transaction.id,
        type,
        url: dataUrl,
        fileName: file.name.replace(/\.[^/.]+$/, '') + '.webp',
      }
      setAttachmentsList((prev) => [...prev, newAtt])
    } catch (err) {
      console.error(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRemoveAttachment = (attId: string) => {
    setAttachmentsList(attachmentsList.filter((a) => a.id !== attId))
  }

  const handleSubmitUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    const groupObj = groups.find((g) => g.id === selectedGroupId)
    const locObj = locations.find((l) => l.id === selectedLocationId)
    const deptObj = departments.find((d) => d.id === selectedDeptId)
    const typeObj = scrapTypes.find((t) => t.id === selectedTypeId)
    const pmObj = paymentModes.find((p) => p.id === selectedPaymentModeId)
    const hoObj = handoverUsers.find((h) => h.id === selectedHandoverUserId)

    const updatedTxn: ScrapTransaction = {
      ...transaction,
      groupId: selectedGroupId || transaction.groupId,
      groupName: groupObj?.name || transaction.groupName,
      locationId: selectedLocationId || transaction.locationId,
      locationName: locObj?.name || transaction.locationName,
      departmentId: selectedDeptId || transaction.departmentId,
      departmentName: deptObj?.name || transaction.departmentName,
      scrapTypeId: selectedTypeId || transaction.scrapTypeId,
      scrapTypeName: typeObj?.name || transaction.scrapTypeName,
      unit: typeObj?.unit || transaction.unit,
      description: descriptionInput || transaction.description,
      weightQty: wt,
      ratePerUnit: rate,
      calculatedTotal,
      amountReceived: amountReceived || 0,
      outstandingAmount: outstandingAmount || 0,
      soldTo: soldTo || transaction.soldTo,
      soldDate: soldDate || transaction.soldDate,
      paymentModeId: selectedPaymentModeId || transaction.paymentModeId,
      paymentModeName: pmObj?.name || transaction.paymentModeName,
      paymentHandoverToId: selectedHandoverUserId || transaction.paymentHandoverToId,
      paymentHandoverToName: hoObj?.name || transaction.paymentHandoverToName,
      remarks,
      status: outstandingAmount >= 1 ? 'FLAGGED' : 'COMPLETED',
      attachments: attachmentsList,
      updatedAt: new Date().toISOString(),
    }

    try {
      await onSaveUpdate(updatedTxn)
      onClose()
    } catch (err) {
      console.error(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] lg:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col rounded-2xl p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
        <DialogHeader className="shrink-0 border-b border-slate-100 dark:border-slate-800 pb-4">
          <DialogTitle className="text-base font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Pencil className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Edit Scrap Record #{transaction.transactionNumber}
          </DialogTitle>
          <p className="text-xs text-slate-500 font-medium">
            Update disposal weight, valuation rate, received amount, payment handover details, or remarks.
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmitUpdate} className="flex-1 overflow-y-auto min-h-0 pt-3 space-y-4 pr-1">
          {/* Classification Section */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-4 space-y-3">
            <h4 className="text-xs font-black uppercase text-slate-800 dark:text-slate-200">
              1. Dealership Classification
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Group</Label>
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-900 dark:text-slate-100"
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Location</Label>
                <select
                  value={selectedLocationId}
                  onChange={(e) => setSelectedLocationId(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-900 dark:text-slate-100"
                >
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Department</Label>
                <select
                  value={selectedDeptId}
                  onChange={(e) => setSelectedDeptId(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-900 dark:text-slate-100"
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Material & Valuation */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-4 space-y-3">
            <h4 className="text-xs font-black uppercase text-slate-800 dark:text-slate-200">
              2. Material Valuation & Weight
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Scrap Type</Label>
                <select
                  value={selectedTypeId}
                  onChange={(e) => setSelectedTypeId(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-900 dark:text-slate-100"
                >
                  {scrapTypes.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Description</Label>
                <Input
                  type="text"
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  className="h-9 rounded-xl text-xs font-bold border-slate-300 dark:border-slate-700"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Weight Qty ({selectedType?.unit || 'Kg'})
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={weightQty}
                  onChange={(e) => setWeightQty(e.target.value)}
                  className="h-9 rounded-xl text-xs font-black border-slate-300 dark:border-slate-700"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Rate / Unit (₹)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={ratePerUnit}
                  onChange={(e) => setRatePerUnit(e.target.value)}
                  className="h-9 rounded-xl text-xs font-black border-slate-300 dark:border-slate-700"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-black text-emerald-700 dark:text-emerald-400">Total Valuation (₹)</Label>
                <div className="h-9 w-full rounded-xl border border-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-3 flex items-center justify-between text-sm font-black text-emerald-800 dark:text-emerald-200">
                  <span>₹{calculatedTotal.toLocaleString('en-IN')}</span>
                  <Calculator className="h-3.5 w-3.5 opacity-60" />
                </div>
              </div>
            </div>
          </div>

          {/* Payment & Handover Details */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-4 space-y-3">
            <h4 className="text-xs font-black uppercase text-slate-800 dark:text-slate-200">
              3. Payment & Buyer Handover
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Amount Received (₹)</Label>
                <Input
                  type="number"
                  value={amountReceivedInput}
                  onChange={(e) => setAmountReceivedInput(e.target.value)}
                  className="h-9 rounded-xl text-xs font-black text-emerald-700 border-slate-300 dark:border-slate-700"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Sold Date</Label>
                <Input
                  type="date"
                  value={soldDate}
                  onChange={(e) => setSoldDate(e.target.value)}
                  className="h-9 rounded-xl text-xs font-bold border-slate-300 dark:border-slate-700"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Sold To (Merchant)</Label>
                <Input
                  type="text"
                  value={soldTo}
                  onChange={(e) => setSoldTo(e.target.value)}
                  className="h-9 rounded-xl text-xs font-bold border-slate-300 dark:border-slate-700"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Payment Mode</Label>
                <select
                  value={selectedPaymentModeId}
                  onChange={(e) => setSelectedPaymentModeId(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-900 dark:text-slate-100"
                >
                  {paymentModes.map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 space-y-1">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Payment Handover To</Label>
                <select
                  value={selectedHandoverUserId}
                  onChange={(e) => setSelectedHandoverUserId(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-900 dark:text-slate-100"
                >
                  {handoverUsers.map((ho) => (
                    <option key={ho.id} value={ho.id}>
                      {ho.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 space-y-1">
                <Label className="text-xs font-bold text-slate-700 dark:text-slate-300">Remarks & Notes</Label>
                <Textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  rows={2}
                  className="rounded-xl text-xs font-medium border-slate-300 dark:border-slate-700"
                />
              </div>
            </div>
          </div>

          {/* Verification Attachments */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-4 space-y-3">
            <h4 className="text-xs font-black uppercase text-slate-800 dark:text-slate-200">
              4. Verification Attachments ({attachmentsList.length})
            </h4>
            <div className="flex items-center gap-2 flex-wrap">
              {attachmentsList.map((att) => (
                <div key={att.id} className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-xs font-bold shadow-xs">
                  <span>{att.fileName}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(att.id)}
                    className="text-slate-400 hover:text-rose-600 p-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <label className="cursor-pointer inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 px-3 py-1.5 rounded-xl border border-emerald-200 hover:bg-emerald-100 transition-colors">
                <Upload className="h-3.5 w-3.5" /> Upload File
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => e.target.files?.[0] && handleFileUploadMock(e.target.files[0], 'scrap_picture')}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="rounded-xl text-xs font-bold border-slate-300 dark:border-slate-700"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
              style={{ backgroundColor: 'var(--dashboard-action-bg)', color: 'var(--dashboard-action-fg)' }}
              className="rounded-xl font-black text-xs h-9 px-5 shadow-md border-0 cursor-pointer flex items-center gap-1.5"
            >
              <Save className="h-3.5 w-3.5" /> Save Changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
