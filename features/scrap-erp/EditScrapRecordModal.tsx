'use client'

import { useState, useEffect, useMemo } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { Pencil, Save, Calculator, FileText, FileCheck, ImageIcon, Upload, X, Eye, Download, ZoomIn, ZoomOut, RotateCw, Trash2 } from 'lucide-react'
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

  // Preview modal state
  const [previewAtt, setPreviewAtt] = useState<ScrapAttachment | null>(null)
  const [previewZoom, setPreviewZoom] = useState<number>(1)
  const [previewRotation, setPreviewRotation] = useState<number>(0)

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

  const availableDescriptionOptions = useMemo(() => {
    const set = new Set<string>()
    descriptions.forEach((d) => {
      if (d.name) set.add(d.name)
    })
    scrapTypes.forEach((st) => {
      if (st.name) set.add(st.name)
    })
    if (descriptionInput && descriptionInput.trim()) {
      set.add(descriptionInput.trim())
    }
    return Array.from(set)
  }, [descriptions, scrapTypes, descriptionInput])

  // Recalculate valuations dynamically
  const wt = parseFloat(weightQty) || 0
  const rate = parseFloat(ratePerUnit) || 0
  // Mirrors ScrapEntryFormView: derive only when both inputs exist, else keep the stored total.
  // Without this, editing any field on a record whose total is stated directly (no qty/rate) wrote
  // a zero over real money.
  const calculatedTotal = (wt > 0 && rate > 0)
    ? Math.round(wt * rate * 100) / 100
    : Math.round(Number(transaction?.calculatedTotal || 0) * 100) / 100
  const amountReceived = amountReceivedInput !== '' ? parseFloat(amountReceivedInput) : calculatedTotal
  const outstandingAmount = Math.max(0, calculatedTotal - (amountReceived || 0))

  const selectedType = scrapTypes.find((t) => t.id === selectedTypeId) || scrapTypes[0]

  const readFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = (err) => reject(err)
      reader.readAsDataURL(file)
    })
  }

  const handleMultipleFileUpload = async (files: FileList, type: 'weight_picture' | 'tally_receipt' | 'scrap_picture') => {
    try {
      setIsSubmitting(true)
      const fileArray = Array.from(files)
      const newAtts: ScrapAttachment[] = []

      for (const file of fileArray) {
        const isImg = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(file.name)
        let dataUrl = ''
        try {
          if (isImg) {
            const res = await compressAndConvertToWebp(file)
            dataUrl = res.dataUrl
          } else {
            dataUrl = await readFileAsDataUrl(file)
          }
        } catch {
          dataUrl = await readFileAsDataUrl(file)
        }

        newAtts.push({
          id: `att-edit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          transactionId: transaction.id,
          type,
          url: dataUrl,
          fileName: file.name,
        })
      }

      setAttachmentsList((prev) => [...prev, ...newAtts])
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
                <select
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-bold text-slate-900 dark:text-slate-100"
                >
                  <option value="">Select Description...</option>
                  {availableDescriptionOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
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
                  step="0.01"
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
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black uppercase text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Upload className="h-3.5 w-3.5 text-emerald-600" />
                4. Verification Attachments
              </h4>
              <Badge className="bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 font-extrabold text-[10px]">
                {attachmentsList.length} uploaded
              </Badge>
            </div>

            {/* Attachment categories */}
            {(['weight_picture', 'tally_receipt', 'scrap_picture'] as const).map((attType) => {
              const label = attType === 'weight_picture' ? 'Weight Slips' : attType === 'tally_receipt' ? 'Tally Vouchers' : 'Scrap Photos'
              const color = attType === 'weight_picture' ? 'emerald' : attType === 'tally_receipt' ? 'teal' : 'cyan'
              const catItems = attachmentsList.filter((a) => a.type === attType)

              return (
                <div key={attType} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black text-slate-700 dark:text-slate-300">{label}</span>
                    <div className="flex items-center gap-1.5">
                      <Badge className={`font-bold text-[10px] ${catItems.length > 0 ? `bg-${color}-100 text-${color}-800 dark:bg-${color}-950 dark:text-${color}-300` : 'bg-slate-100 text-slate-400 dark:bg-slate-800'}`}>
                        {catItems.length}
                      </Badge>
                      <label className="cursor-pointer inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-900 hover:bg-emerald-100 transition-colors">
                        <Upload className="h-3 w-3" /> Add Files
                        <input
                          type="file"
                          multiple
                          accept="image/*,.pdf,.doc,.docx"
                          onChange={(e) => e.target.files && handleMultipleFileUpload(e.target.files, attType)}
                          className="hidden"
                        />
                      </label>
                    </div>
                  </div>

                  {catItems.length > 0 ? (
                    <div className="space-y-1">
                      {catItems.map((att) => {
                        const isImg = att.url.startsWith('data:image/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(att.fileName)
                        const isPdf = att.url.startsWith('data:application/pdf') || att.url.includes('.pdf') || att.fileName.toLowerCase().endsWith('.pdf')
                        return (
                          <div key={att.id} className="group flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5 hover:border-emerald-300 dark:hover:border-emerald-700 transition-all">
                            <div
                              className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
                              onClick={() => { setPreviewAtt(att); setPreviewZoom(1); setPreviewRotation(0) }}
                              title="Click to preview"
                            >
                              {isImg ? (
                                <div className="h-7 w-7 rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 shrink-0">
                                  <img src={att.url} alt={att.fileName} className="h-full w-full object-cover" />
                                </div>
                              ) : (
                                <div className="h-7 w-7 rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 text-red-600 flex items-center justify-center shrink-0 font-black text-[8px]">
                                  PDF
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block truncate group-hover:text-emerald-600">{att.fileName}</span>
                                <span className="text-[10px] text-slate-400 flex items-center gap-0.5"><Eye className="h-2.5 w-2.5 text-emerald-500" /> Preview</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveAttachment(att.id)}
                              className="text-slate-300 hover:text-rose-600 p-1 transition-colors shrink-0"
                              title="Remove"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <p className="text-[10px] text-slate-400 italic font-medium pl-1">No {label.toLowerCase()} uploaded yet.</p>
                  )}
                </div>
              )
            })}
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

        {/* Document Preview Modal */}
        <Dialog open={Boolean(previewAtt)} onOpenChange={(open) => !open && setPreviewAtt(null)}>
          <DialogContent className="max-w-3xl max-h-[88vh] overflow-hidden rounded-2xl p-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col">
            <DialogHeader className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-row items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div>
                  <DialogTitle className="text-sm font-black text-slate-900 dark:text-slate-100 truncate max-w-sm">
                    {previewAtt?.fileName || 'Document Preview'}
                  </DialogTitle>
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    {previewAtt?.type === 'weight_picture' ? 'Weight Slip' : previewAtt?.type === 'tally_receipt' ? 'Tally Receipt' : 'Scrap Photo'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 pr-8">
                {previewAtt && !(previewAtt.url.startsWith('data:application/pdf') || previewAtt.url.includes('.pdf') || previewAtt.fileName.toLowerCase().endsWith('.pdf')) && (
                  <>
                    <Button type="button" variant="outline" size="icon" onClick={() => setPreviewZoom((z) => Math.min(z + 0.25, 3))} className="h-7 w-7 rounded-lg" title="Zoom In">
                      <ZoomIn className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="outline" size="icon" onClick={() => setPreviewZoom((z) => Math.max(z - 0.25, 0.5))} className="h-7 w-7 rounded-lg" title="Zoom Out">
                      <ZoomOut className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" variant="outline" size="icon" onClick={() => setPreviewRotation((r) => (r + 90) % 360)} className="h-7 w-7 rounded-lg" title="Rotate">
                      <RotateCw className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
                <a
                  href={previewAtt?.url}
                  download={previewAtt?.fileName}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-7 px-2.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[11px] font-bold flex items-center gap-1 hover:opacity-90"
                >
                  <Download className="h-3 w-3" /> Download
                </a>
              </div>
            </DialogHeader>

            <div className="flex-1 overflow-auto bg-slate-950/5 dark:bg-slate-950 p-4 flex items-center justify-center min-h-[360px]">
              {previewAtt && (
                previewAtt.url.startsWith('data:application/pdf') || previewAtt.url.includes('.pdf') || previewAtt.fileName.toLowerCase().endsWith('.pdf') ? (
                  <iframe
                    src={previewAtt.url}
                    className="w-full h-[480px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white"
                    title={previewAtt.fileName}
                  />
                ) : (
                  <div className="flex items-center justify-center p-2">
                    <img
                      src={previewAtt.url}
                      alt={previewAtt.fileName}
                      className="max-h-[450px] max-w-full object-contain transition-transform duration-200 rounded-lg shadow-md"
                      style={{ transform: `scale(${previewZoom}) rotate(${previewRotation}deg)` }}
                    />
                  </div>
                )
              )}
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
