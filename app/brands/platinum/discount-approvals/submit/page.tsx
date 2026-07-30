'use client'

import { useState, useEffect } from 'react'
import {
  Loader2,
  CheckCircle,
  AlertCircle,
  User,
  DollarSign,
  Layers,
  ArrowRight,
  ChevronDown,
} from 'lucide-react'

export default function PlatinumDiscountApprovalSubmitPage() {
  const branch = 'platinum'
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [model, setModel] = useState('')
  const [variant, setVariant] = useState('')
  const [color, setColor] = useState('')
  const [discountAmount, setDiscountAmount] = useState('')
  const [accessoriesAmount, setAccessoriesAmount] = useState('')
  const [fetchedDeliveryDate, setFetchedDeliveryDate] = useState('')
  const [manualDeliveryDate, setManualDeliveryDate] = useState('')
  const [reference, setReference] = useState('')

  const [executives, setExecutives] = useState<string[]>([])
  const [tls, setTls] = useState<string[]>([])
  const [selectedExecutive, setSelectedExecutive] = useState('')
  const [otherExecutiveName, setOtherExecutiveName] = useState('')
  const [selectedTL, setSelectedTL] = useState('')
  const [otherTLName, setOtherTLName] = useState('')

  // State flags for lookup and submission
  const [isVerifying, setIsVerifying] = useState(false)
  const [verifySuccess, setVerifySuccess] = useState<boolean | null>(null)
  const [verifyMessage, setVerifyMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [submitMessage, setSubmitMessage] = useState('')

  // Load employees dynamically based on branch
  useEffect(() => {
    const loadEmployees = async () => {
      try {
        const res = await fetch(`/api/discount-approvals/employees?branch=${branch}`)
        if (res.ok) {
          const json = await res.json()
          setExecutives(json.salesExecutives || [])
          setTls(json.teamLeaders || [])
          setSelectedExecutive('')
          setOtherExecutiveName('')
          setSelectedTL('')
          setOtherTLName('')
        }
      } catch (err) {
        console.error('Error fetching employees:', err)
      }
    }
    loadEmployees()
  }, [])

  // Handle Customer ID verification / autofetch
  const handleVerifyCustomerId = async () => {
    if (!customerId.trim()) return

    setIsVerifying(true)
    setVerifySuccess(null)
    setVerifyMessage('')

    try {
      const res = await fetch(`/api/discount-approvals/lookup?branch=${branch}&vin=${encodeURIComponent(customerId)}`)
      const data = await res.json()

      if (!res.ok) {
        setVerifySuccess(false)
        setVerifyMessage(data.error || 'Record not found. Please enter details manually.')
        return
      }

      // Populate fetched data
      setCustomerName(data.customerName || '')
      setModel(data.model || '')
      setVariant(data.variant || '')
      setColor(data.color || '')
      
      // Auto-populate delivery date
      if (data.deliveryDate) {
        setFetchedDeliveryDate(data.deliveryDate)
      } else {
        setFetchedDeliveryDate('')
      }

      // Auto-populate sales consultant name (Make sure it matches list, or fallback to 'Other')
      if (data.consultantName) {
        const cName = data.consultantName.trim()
        const matchedExec = executives.find(
          (e) => e.toLowerCase().trim() === cName.toLowerCase()
        )
        if (matchedExec) {
          setSelectedExecutive(matchedExec)
          setOtherExecutiveName('')
        } else {
          setSelectedExecutive('Other')
          setOtherExecutiveName(cName)
        }
      }

      // Auto-populate team leader
      if (data.tlManager) {
        const manager = data.tlManager
        if (tls.includes(manager)) {
          setSelectedTL(manager)
        } else {
          setSelectedTL('Other')
          setOtherTLName(manager)
        }
      }
      
      setVerifySuccess(true)
      setVerifyMessage('Details successfully retrieved from booking records!')
    } catch (error) {
      console.error('Error verifying customer ID:', error)
      setVerifySuccess(false)
      setVerifyMessage('Failed to fetch details. Please fill manually.')
    } finally {
      setIsVerifying(false)
    }
  }

  // Handle Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const finalRequesterName = selectedExecutive === 'Other' ? otherExecutiveName : selectedExecutive
    const finalTlManager = selectedTL === 'Other' ? otherTLName : selectedTL

    if (!finalRequesterName.trim() || !customerId.trim() || !discountAmount.trim()) {
      setSubmitStatus('error')
      setSubmitMessage('Please fill all required fields.')
      return
    }

    setIsSubmitting(true)
    setSubmitStatus('idle')
    setSubmitMessage('')

    try {
      const res = await fetch('/api/discount-approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requesterName: finalRequesterName,
          branch,
          customerId,
          customerName,
          model,
          variant,
          color,
          discountAmount: Number(discountAmount),
          accessoriesAmount: accessoriesAmount ? Number(accessoriesAmount) : null,
          tlManager: finalTlManager,
          deliveryDate: manualDeliveryDate || fetchedDeliveryDate || null,
          reference,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setSubmitStatus('error')
        setSubmitMessage(data.error || 'Failed to submit request.')
        return
      }

      setSubmitStatus('success')
      setSubmitMessage('Discount approval request has been submitted successfully!')
      
      // Reset form fields
      setCustomerId('')
      setCustomerName('')
      setModel('')
      setVariant('')
      setColor('')
      setDiscountAmount('')
      setAccessoriesAmount('')
      setFetchedDeliveryDate('')
      setManualDeliveryDate('')
      setReference('')
      setSelectedExecutive('')
      setOtherExecutiveName('')
      setSelectedTL('')
      setOtherTLName('')
      setVerifySuccess(null)
    } catch (error) {
      console.error('Error submitting form:', error)
      setSubmitStatus('error')
      setSubmitMessage('Internal server error. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex items-center justify-center p-4 sm:p-6 lg:p-8 font-sans selection:bg-[#002c5f] selection:text-white relative overflow-hidden">
      {/* Dynamic Background Gradients */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-[#002c5f]/5 blur-[120px]" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#002c5f]/5 blur-[120px]" />

      <div className="w-full max-w-2xl bg-white border border-slate-100/90 rounded-3xl p-6 sm:p-8 lg:p-10 shadow-[0_20px_50px_rgba(15,23,42,0.06)] relative z-10">
        
        {/* Form Header */}
        <div className="space-y-4 text-center mb-8">
          <img
            src="https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/am_hyundai.svg"
            alt="AM Hyundai Logo"
            className="h-12 sm:h-14 mx-auto object-contain"
          />
          <div className="inline-flex items-center px-3.5 py-1.5 rounded-full bg-[#002c5f]/10 border border-[#002c5f]/25 text-[#002c5f] text-xs font-black tracking-wide uppercase">
            <span>Discount Approval Portal</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            AM Platinum Discount Approval
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto font-semibold">
            Please fill out this form to request manager approval for a vehicle discount. Fields marked with <span className="text-rose-500 font-bold">*</span> are required.
          </p>
        </div>

        {submitStatus === 'success' ? (
          /* Success Screen */
          <div className="py-8 text-center space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="mx-auto w-16 h-16 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shadow-md">
              <CheckCircle className="h-8 w-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold text-slate-900">Request Submitted!</h2>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                {submitMessage} Your request will be reviewed by the manager.
              </p>
            </div>
            <button
              onClick={() => setSubmitStatus('idle')}
              className="px-6 py-2.5 bg-[#002c5f] hover:bg-[#001e40] text-white rounded-xl text-sm font-extrabold transition-all shadow-md shadow-[#002c5f]/10 cursor-pointer"
            >
              Submit Another Request
            </button>
          </div>
        ) : (
          /* Form Content */
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Customer ID Lookup Section (MOVED TO TOP) */}
            <div className="space-y-2">
              <label htmlFor="customerId" className="text-xs font-black uppercase tracking-wider text-slate-550 block">
                Customer ID <span className="text-rose-500">*</span>
              </label>
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    id="customerId"
                    required
                    placeholder="e.g. C2024014491"
                    value={customerId}
                    onChange={(e) => setCustomerId(e.target.value)}
                    onBlur={handleVerifyCustomerId}
                    className="w-full h-11 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#002c5f] focus:ring-1 focus:ring-[#002c5f] rounded-xl pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 transition-all outline-hidden font-bold"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleVerifyCustomerId}
                  disabled={isVerifying || !customerId.trim()}
                  className="px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black flex items-center gap-2 cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm active:scale-95"
                >
                  {isVerifying ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span>Fetch Details</span>
                  )}
                </button>
              </div>

              {/* Verify feedback */}
              {verifySuccess !== null && (
                <div className={`p-3 rounded-xl border flex items-start gap-2.5 text-xs font-bold animate-in fade-in duration-200 ${
                  verifySuccess
                    ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                    : 'bg-amber-50 border-amber-100 text-amber-700'
                }`}>
                  {verifySuccess ? (
                    <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  )}
                  <span>{verifyMessage}</span>
                </div>
              )}
            </div>

            {/* Requester Name Dropdown */}
            <div className="space-y-2">
              <label htmlFor="selectedExecutive" className="text-xs font-black uppercase tracking-wider text-slate-550 block">
                Your Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 z-10" />
                <select
                  id="selectedExecutive"
                  required
                  value={selectedExecutive}
                  onChange={(e) => {
                    setSelectedExecutive(e.target.value)
                    if (e.target.value !== 'Other') {
                      setOtherExecutiveName('')
                    }
                  }}
                  className="w-full h-11 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#002c5f] focus:ring-1 focus:ring-[#002c5f] rounded-xl pl-10 pr-10 text-sm text-slate-900 transition-all outline-hidden font-bold appearance-none cursor-pointer"
                >
                  <option value="" disabled>Select your name</option>
                  {executives.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                  <option value="Other">Other (Type custom name)</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <ChevronDown className="h-4 w-4" />
                </div>
              </div>

              {selectedExecutive === 'Other' && (
                <div className="pt-2 animate-in fade-in slide-in-from-top-1 duration-150">
                  <input
                    type="text"
                    required
                    placeholder="Enter custom salesperson name"
                    value={otherExecutiveName}
                    onChange={(e) => setOtherExecutiveName(e.target.value)}
                    className="w-full h-11 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#002c5f] focus:ring-1 focus:ring-[#002c5f] rounded-xl px-4 text-sm text-slate-900 placeholder-slate-400 transition-all outline-hidden font-bold"
                  />
                </div>
              )}
            </div>

            {/* Vehicle & Customer details card */}
            <div className="bg-slate-50/50 border border-slate-150 rounded-2xl p-4 sm:p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-150 pb-2">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Autofetched Booking Data</span>
                <span className="text-[9px] font-black text-[#002c5f] bg-[#002c5f]/5 px-2 py-0.5 rounded-md">Live Lookup</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-bold">
                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase block">Customer Name</span>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Enter customer name manually"
                    className="w-full h-8 bg-transparent border-b border-slate-200 focus:border-[#002c5f] text-slate-800 placeholder-slate-400 outline-hidden transition-all font-bold"
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase block">Model</span>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="Enter vehicle model manually"
                    className="w-full h-8 bg-transparent border-b border-slate-200 focus:border-[#002c5f] text-slate-800 placeholder-slate-400 outline-hidden transition-all font-bold"
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase block">Variant</span>
                  <input
                    type="text"
                    value={variant}
                    onChange={(e) => setVariant(e.target.value)}
                    placeholder="Enter vehicle variant manually"
                    className="w-full h-8 bg-transparent border-b border-slate-200 focus:border-[#002c5f] text-slate-800 placeholder-slate-400 outline-hidden transition-all font-bold"
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase block">Color</span>
                  <input
                    type="text"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    placeholder="Enter vehicle color manually"
                    className="w-full h-8 bg-transparent border-b border-slate-200 focus:border-[#002c5f] text-slate-800 placeholder-slate-400 outline-hidden transition-all font-bold"
                  />
                </div>
              </div>
            </div>

            {/* Discount details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Discount Amount */}
              <div className="space-y-2">
                <label htmlFor="discountAmount" className="text-xs font-black uppercase tracking-wider text-slate-550 block">
                  Discount Amount (INR) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="number"
                    id="discountAmount"
                    required
                    min="1"
                    placeholder="e.g. 15000"
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(e.target.value)}
                    className="w-full h-11 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#002c5f] focus:ring-1 focus:ring-[#002c5f] rounded-xl pl-9 pr-4 text-sm text-slate-900 placeholder-slate-400 transition-all outline-hidden font-bold"
                  />
                </div>
              </div>

              {/* Accessories Amount */}
              <div className="space-y-2">
                <label htmlFor="accessoriesAmount" className="text-xs font-black uppercase tracking-wider text-slate-550 block">
                  Accessories Amount (INR)
                </label>
                <div className="relative">
                  <Layers className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <input
                    type="number"
                    id="accessoriesAmount"
                    placeholder="e.g. 7500"
                    value={accessoriesAmount}
                    onChange={(e) => setAccessoriesAmount(e.target.value)}
                    className="w-full h-11 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#002c5f] focus:ring-1 focus:ring-[#002c5f] rounded-xl pl-9 pr-4 text-sm text-slate-900 placeholder-slate-400 transition-all outline-hidden font-bold"
                  />
                </div>
              </div>
            </div>

            {/* TL / Manager & Reference in one row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* TL/Manager */}
              <div className="space-y-2">
                <label htmlFor="selectedTL" className="text-xs font-black uppercase tracking-wider text-slate-550 block">
                  TL / Manager
                </label>
                <div className="relative">
                  <select
                    id="selectedTL"
                    value={selectedTL}
                    onChange={(e) => {
                      setSelectedTL(e.target.value)
                      if (e.target.value !== 'Other') {
                        setOtherTLName('')
                      }
                    }}
                    className="w-full h-11 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#002c5f] focus:ring-1 focus:ring-[#002c5f] rounded-xl px-3 text-sm text-slate-900 transition-all outline-hidden font-bold appearance-none cursor-pointer pr-10"
                  >
                    <option value="">Select TL/Manager</option>
                    {tls.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                    <option value="Other">Other (Type custom name)</option>
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </div>

                {selectedTL === 'Other' && (
                  <div className="pt-2 animate-in fade-in slide-in-from-top-1 duration-150">
                    <input
                      type="text"
                      placeholder="Enter custom manager name"
                      value={otherTLName}
                      onChange={(e) => setOtherTLName(e.target.value)}
                      className="w-full h-11 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#002c5f] focus:ring-1 focus:ring-[#002c5f] rounded-xl px-3.5 text-sm text-slate-900 placeholder-slate-400 transition-all outline-hidden font-bold"
                    />
                  </div>
                )}
              </div>

              {/* Reference */}
              <div className="space-y-2">
                <label htmlFor="reference" className="text-xs font-black uppercase tracking-wider text-slate-550 block">
                  Reference
                </label>
                <input
                  type="text"
                  id="reference"
                  placeholder="e.g. Self / Corporate"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full h-11 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#002c5f] focus:ring-1 focus:ring-[#002c5f] rounded-xl px-3.5 text-sm text-slate-900 placeholder-slate-400 transition-all outline-hidden font-bold"
                />
              </div>
            </div>

            {/* Dates in one row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Autofetched Delivery Date (Read-only) */}
              <div className="space-y-2">
                <label htmlFor="fetchedDeliveryDate" className="text-xs font-black uppercase tracking-wider text-slate-550 block">
                  Delivery Date
                </label>
                <input
                  type="text"
                  id="fetchedDeliveryDate"
                  readOnly
                  placeholder="Not Available"
                  value={fetchedDeliveryDate}
                  className="w-full h-11 bg-slate-100 border border-slate-250 rounded-xl px-3.5 text-sm text-slate-550 outline-hidden cursor-not-allowed font-bold"
                />
              </div>

              {/* Manual Delivery Date (Editable) */}
              <div className="space-y-2">
                <label htmlFor="manualDeliveryDate" className="text-xs font-black uppercase tracking-wider text-slate-550 block">
                  Manual Delivery Date
                </label>
                <input
                  type="date"
                  id="manualDeliveryDate"
                  value={manualDeliveryDate}
                  onChange={(e) => setManualDeliveryDate(e.target.value)}
                  className="w-full h-11 bg-slate-50 border border-slate-200 focus:bg-white focus:border-[#002c5f] focus:ring-1 focus:ring-[#002c5f] rounded-xl px-3 text-sm text-slate-900 transition-all outline-hidden font-bold"
                />
              </div>
            </div>

            {/* Submit button & feedback alert */}
            <div className="space-y-4 pt-2">
              {submitStatus === 'error' && (
                <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-start gap-2.5 text-xs font-bold text-rose-700 animate-in fade-in duration-200">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{submitMessage}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-12 bg-[#002c5f] hover:bg-[#001e40] disabled:opacity-50 text-white rounded-xl text-sm font-black tracking-wide uppercase flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-[#002c5f]/10 active:scale-[0.99] transition-all"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Submitting request...</span>
                  </>
                ) : (
                  <>
                    <span>Submit Approval Request</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>

          </form>
        )}

      </div>
    </div>
  )
}
