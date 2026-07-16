'use client'

import { useState, useEffect, FormEvent, ChangeEvent } from 'react'
import { 
  FileText, 
  Upload, 
  CheckCircle, 
  AlertCircle, 
  Loader2, 
  MapPin, 
  Building2, 
  User, 
  Mail, 
  Briefcase, 
  PlusCircle, 
  Info,
  IndianRupee,
  FileCheck
} from 'lucide-react'

// ── Vendor type for dropdown ──
interface VendorOption {
  id: string
  name: string
  gstNumber: string
}

// Options extracted from Google Forms snippet
const LOCATION_OPTIONS = ['JAMMU', 'UDHAMPUR', 'BANIHAL']
const DEALER_CODE_OPTIONS = ['JK402', 'JK501']
const DEALER_NAME_OPTIONS = ['KIA JAMMU', 'KIA UDHAMPUR', 'KIA BANIHAL']

const DEPARTMENT_OPTIONS = [
  'HR',
  'ADMIN',
  'SALES',
  'SERVICE',
  'HP ROMISE',
  'BODY SHOP',
  'ACCOUNTS',
  'CRM',
  'INSURANCE',
  'EDP / IT',
  'SPARE PARTS',
  'SALES & SERVICE',
  'Accessories',
  'EMI',
  'NEW JOINING',
  'LABOUR CHARGES',
  'OTHER'
]

const APPROVAL_TYPE_OPTIONS = [
  'SALARY  DISBURSEMENT', // note: double space as in source
  'INCENTIVE DISBURSEMENT',
  'ADVANCE AGAINST SALARY',
  'TIRE / BATTERY APPROVAL',
  'CARD PAYMENT',
  'PANTRY ITEMS',
  'TRAINING EXPENSES',
  'TRAVELLING CHARGES',
  'VENDOR PAYMENT',
  'RENTS',
  'RTO',
  'PURCHASE',
  'CASH',
  'FREIGHT CHARGES',
  'FUND TRANSFER',
  'MAINTENANCE',
  'HOUSE KEEPING',
  'UNIFORM',
  'ESIC',
  'PF',
  'EVENT',
  'STOCK TRANSFER',
  'STAFF WELFARE',
  'PROMOTION',
  'RELEASING HOLD SALARY / INCENTIVE',
  'FAST TAG',
  'Petty cash',
  'GST',
  'LABOUR PAYMENT',
  'FINANCE PAYOUT',
  'OTHERS'
]

const PAYMENT_TYPE_OPTIONS = [
  'CREDIT',
  'CASH',
  'CHEQUE',
  'ONLINE TRANSFER',
  'Credit Card'
]

interface FormState {
  email: string
  name: string

  location: string
  dealerCode: string
  dealerName: string
  department: string
  specifyOtherDepartment: string
  approvalType: string
  vendorName: string
  specifyOtherApprovalType: string
  previousAdvance: string
  amount: string
  typeOfPayment: string
  remarks: string
  uploadBillUrl1: string
  uploadBillUrl2: string
  uploadDocUrl: string
}

interface UploadState {
  bill1: { name: string; loading: boolean; error: string }
  bill2: { name: string; loading: boolean; error: string }
  doc: { name: string; loading: boolean; error: string }
}

export default function KiaApprovalsSubmitPage() {
  const [form, setForm] = useState<FormState>({
    email: '',
    name: '',

    location: '',
    dealerCode: '',
    dealerName: '',
    department: '',
    specifyOtherDepartment: '',
    approvalType: '',
    vendorName: '',
    specifyOtherApprovalType: '',
    previousAdvance: '',
    amount: '',
    typeOfPayment: '',
    remarks: '',
    uploadBillUrl1: '',
    uploadBillUrl2: '',
    uploadDocUrl: ''
  })

  const [uploads, setUploads] = useState<UploadState>({
    bill1: { name: '', loading: false, error: '' },
    bill2: { name: '', loading: false, error: '' },
    doc: { name: '', loading: false, error: '' }
  })

  const [submitting, setSubmitting] = useState(false)
  const [submittedId, setSubmittedId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  // ── Vendor registry fetch ──
  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [vendorsLoading, setVendorsLoading] = useState(true)
  useEffect(() => {
    fetch('/api/brands/kia/vendors')
      .then(r => r.json())
      .then(data => setVendors(data.vendors || []))
      .catch(() => setVendors([]))
      .finally(() => setVendorsLoading(false))
  }, [])

  const handleTextChange = (key: keyof FormState, value: string) => {
    setForm(prev => {
      const next = { ...prev, [key]: value }
      
      // Auto-correlate Location / Dealer Code / Dealer Name to make form filling fast and error-free
      if (key === 'location') {
        if (value === 'JAMMU') {
          next.dealerCode = 'JK402'
          next.dealerName = 'KIA JAMMU'
        } else if (value === 'UDHAMPUR') {
          next.dealerCode = 'JK501'
          next.dealerName = 'KIA UDHAMPUR'
        }
      } else if (key === 'dealerCode') {
        if (value === 'JK402') {
          next.location = 'JAMMU'
          next.dealerName = 'KIA JAMMU'
        } else if (value === 'JK501') {
          next.location = 'UDHAMPUR'
          next.dealerName = 'KIA UDHAMPUR'
        }
      } else if (key === 'dealerName') {
        if (value === 'KIA JAMMU') {
          next.location = 'JAMMU'
          next.dealerCode = 'JK402'
        } else if (value === 'KIA UDHAMPUR') {
          next.location = 'UDHAMPUR'
          next.dealerCode = 'JK501'
        }
      }

      return next
    })
  }

  const handleFileUpload = async (key: 'bill1' | 'bill2' | 'doc', e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploads(prev => ({
      ...prev,
      [key]: { ...prev[key], loading: true, error: '', name: file.name }
    }))

    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('folder', 'approvals')

      const res = await fetch('/api/brands/kia/approvals/upload', {
        method: 'POST',
        body: fd
      })

      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Upload failed')
      }

      // Set URL in form state
      const urlField = key === 'bill1' ? 'uploadBillUrl1' : key === 'bill2' ? 'uploadBillUrl2' : 'uploadDocUrl'
      setForm(prev => ({ ...prev, [urlField]: data.url }))
      
      setUploads(prev => ({
        ...prev,
        [key]: { ...prev[key], loading: false, error: '' }
      }))
    } catch (err) {
      console.error(err)
      setUploads(prev => ({
        ...prev,
        [key]: { ...prev[key], loading: false, error: err instanceof Error ? err.message : 'Upload failed', name: '' }
      }))
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMsg('')

    // Basic Validation
    if (!form.email.trim()) return setErrorMsg('Email Address is required.')
    if (!form.name.trim()) return setErrorMsg('Name is required.')
    if (!form.location) return setErrorMsg('Location is required.')
    if (!form.dealerCode) return setErrorMsg('Dealer Code is required.')
    if (!form.dealerName) return setErrorMsg('Dealer Name is required.')
    if (!form.department) return setErrorMsg('Department is required.')
    if (!form.approvalType) return setErrorMsg('Approval Type is required.')
    if (!form.amount || isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
      return setErrorMsg('Please enter a valid amount greater than 0.')
    }
    if (!form.typeOfPayment) return setErrorMsg('Payment Type is required.')

    setSubmitting(true)

    try {
      const res = await fetch('/api/brands/kia/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })

      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error || 'Failed to submit request')
      }

      setSubmittedId(data.id)
    } catch (err) {
      console.error(err)
      setErrorMsg(err instanceof Error ? err.message : 'Connection failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submittedId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-xl bg-white rounded-3xl p-8 border border-slate-100 shadow-[0_20px_50px_rgba(15,23,42,0.08)] text-center space-y-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 mb-2">
            <CheckCircle className="w-10 h-10" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Submission Successful!</h1>
            <p className="text-sm font-semibold text-slate-500">Your approval request has been logged and sent to the accounts queue.</p>
          </div>
          <div className="bg-slate-50 rounded-2xl p-4 text-left border border-slate-100 space-y-3 font-semibold text-xs text-slate-700">
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-400 uppercase tracking-wider font-black">Request ID</span>
              <span className="font-mono text-slate-900 select-all">{submittedId}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-400 uppercase tracking-wider font-black">Requester</span>
              <span className="text-slate-950">{form.name}</span>
            </div>
            <div className="flex justify-between border-b border-slate-100 pb-2">
              <span className="text-slate-400 uppercase tracking-wider font-black">Amount</span>
              <span className="text-slate-950 font-black">₹{Number(form.amount).toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400 uppercase tracking-wider font-black">Approval Type</span>
              <span className="text-slate-950">{form.approvalType}</span>
            </div>
          </div>
          <button
            onClick={() => {
              setSubmittedId(null)
              setForm({
                email: '',
                name: '',

                location: '',
                dealerCode: '',
                dealerName: '',
                department: '',
                specifyOtherDepartment: '',
                approvalType: '',
                vendorName: '',
                specifyOtherApprovalType: '',
                previousAdvance: '',
                amount: '',
                typeOfPayment: '',
                remarks: '',
                uploadBillUrl1: '',
                uploadBillUrl2: '',
                uploadDocUrl: ''
              })
              setUploads({
                bill1: { name: '', loading: false, error: '' },
                bill2: { name: '', loading: false, error: '' },
                doc: { name: '', loading: false, error: '' }
              })
            }}
            className="w-full min-h-11 py-3 px-6 h-auto bg-slate-950 text-white rounded-2xl text-xs font-black shadow-lg shadow-slate-950/10 hover:bg-slate-800 transition-all whitespace-nowrap"
          >
            Submit Another Request / दूसरा अनुरोध भेजें
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8 animate-fadeIn">
        
        {/* Branding Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex h-9 items-center justify-center rounded-full bg-slate-950 px-4 text-[10px] font-black uppercase tracking-[0.2em] text-white">
            KIA AM GROUP
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
            KIA Approvals Form
          </h1>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
            KIA अनुमोदन फॉर्म
          </p>
        </div>

        {/* Form Container */}
        <form onSubmit={handleSubmit} className="bg-white rounded-[2.5rem] border border-slate-100 shadow-[0_30px_70px_rgba(15,23,42,0.06)] p-6 sm:p-10 space-y-8">
          {errorMsg && (
            <div className="flex gap-3 items-center rounded-2xl bg-rose-50 border border-rose-100 p-4 text-xs font-semibold text-rose-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Section 1: Requester Profile */}
          <div className="space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-950 text-white">
                <User className="w-3.5 h-3.5" />
              </div>
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-950">Requester Profile / आवेदक प्रोफ़ाइल</h2>
            </div>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                  Name / नाम <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    name="name"
                    autoComplete="name"
                    required
                    placeholder="Enter your full name"
                    value={form.name}
                    onChange={e => handleTextChange('name', e.target.value)}
                    className="w-full h-11 pl-11 pr-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                  Email Address / ईमेल पता <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    placeholder="Enter your email address"
                    value={form.email}
                    onChange={e => handleTextChange('email', e.target.value)}
                    className="w-full h-11 pl-11 pr-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800"
                  />
                </div>
              </div>

            </div>
          </div>

          {/* Section 2: Location & Scope */}
          <div className="space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-950 text-white">
                <MapPin className="w-3.5 h-3.5" />
              </div>
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-950">Location & Department / स्थान और विभाग</h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                  Location / स्थान <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={form.location}
                  onChange={e => handleTextChange('location', e.target.value)}
                  className="w-full h-11 px-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800 cursor-pointer appearance-none"
                >
                  <option value="">Choose Location / स्थान चुनें</option>
                  {LOCATION_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                  Dealer Code / डीलर कोड <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={form.dealerCode}
                  onChange={e => handleTextChange('dealerCode', e.target.value)}
                  className="w-full h-11 px-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800 cursor-pointer appearance-none"
                >
                  <option value="">Choose Code / कोड चुनें</option>
                  {DEALER_CODE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                  Dealer Name / डीलर का नाम <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={form.dealerName}
                  onChange={e => handleTextChange('dealerName', e.target.value)}
                  className="w-full h-11 px-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800 cursor-pointer appearance-none"
                >
                  <option value="">Choose Name / नाम चुनें</option>
                  {DEALER_NAME_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>

              <div className="sm:col-span-3 space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                  Department / विभाग <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={form.department}
                  onChange={e => handleTextChange('department', e.target.value)}
                  className="w-full h-11 px-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800 cursor-pointer appearance-none"
                >
                  <option value="">Choose Department / विभाग चुनें</option>
                  {DEPARTMENT_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>

              {form.department === 'OTHER' && (
                <div className="sm:col-span-3 space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                    Specify Department / विभाग निर्दिष्ट करें <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Enter department name"
                    value={form.specifyOtherDepartment}
                    onChange={e => handleTextChange('specifyOtherDepartment', e.target.value)}
                    className="w-full h-11 px-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Claim / Approval Specifications */}
          <div className="space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-950 text-white">
                <Building2 className="w-3.5 h-3.5" />
              </div>
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-950">Approval & Payment details / अनुमोदन और भुगतान विवरण</h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                  Approval Type / अनुमोदन प्रकार <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={form.approvalType}
                  onChange={e => handleTextChange('approvalType', e.target.value)}
                  className="w-full h-11 px-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800 cursor-pointer appearance-none"
                >
                  <option value="">Choose Approval Type / अनुमोदन प्रकार चुनें</option>
                  {APPROVAL_TYPE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                  Vendor Name / विक्रेता का नाम
                  {vendorsLoading && <span className="text-[9px] text-indigo-400 font-bold">(loading...)</span>}
                </label>
                <select
                  value={form.vendorName}
                  onChange={e => handleTextChange('vendorName', e.target.value)}
                  className="w-full h-11 px-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800 cursor-pointer appearance-none"
                >
                  <option value="">Select Vendor (if applicable)</option>
                  {vendors.map(v => (
                    <option key={v.id} value={v.name}>
                      {v.name} — {v.gstNumber}
                    </option>
                  ))}
                </select>
                {vendors.length === 0 && !vendorsLoading && (
                  <p className="text-[10px] text-slate-400 font-medium">
                    No vendors in registry yet.{' '}
                    <a href="/brands/kia/vendors" target="_blank" className="text-indigo-500 underline font-bold">Add vendors ↗</a>
                  </p>
                )}
              </div>

              {form.approvalType === 'OTHERS' && (
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                    Specify Approval Type / अन्य अनुमोदन प्रकार निर्दिष्ट करें <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Enter approval details"
                    value={form.specifyOtherApprovalType}
                    onChange={e => handleTextChange('specifyOtherApprovalType', e.target.value)}
                    className="w-full h-11 px-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800"
                  />
                </div>
              )}

              {form.approvalType.toUpperCase().includes('ADVANCE') && (
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                    Previous Advance / पिछला अग्रिम
                  </label>
                  <input
                    type="text"
                    placeholder="Outstanding previous advance (if any)"
                    value={form.previousAdvance}
                    onChange={e => handleTextChange('previousAdvance', e.target.value)}
                    className="w-full h-11 px-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                  Amount / राशि <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <IndianRupee className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                  <input
                    type="number"
                    required
                    min="1"
                    placeholder="Enter payment amount"
                    value={form.amount}
                    onChange={e => handleTextChange('amount', e.target.value)}
                    className="w-full h-11 pl-11 pr-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                  Type of Payment / भुगतान का प्रकार <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={form.typeOfPayment}
                  onChange={e => handleTextChange('typeOfPayment', e.target.value)}
                  className="w-full h-11 px-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800 cursor-pointer appearance-none"
                >
                  <option value="">Choose Payment Type / भुगतान प्रकार चुनें</option>
                  {PAYMENT_TYPE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Section 4: Remarks & Documents */}
          <div className="space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-950 text-white">
                <FileText className="w-3.5 h-3.5" />
              </div>
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-950">Remarks & Documents / टिप्पणियाँ और दस्तावेज़</h2>
            </div>

            <div className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                  Remarks / Notes / टिप्पणियाँ
                </label>
                <textarea
                  placeholder="Explain what this payment is for..."
                  rows={3}
                  value={form.remarks}
                  onChange={e => handleTextChange('remarks', e.target.value)}
                  className="w-full p-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800"
                />
              </div>

              {/* Uploads Panel */}
              <div className="grid gap-4 sm:grid-cols-3">
                
                {/* Bill 1 */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                    Upload Bill 1 / बिल 1 अपलोड करें
                  </label>
                  <label className={`flex flex-col items-center justify-center h-28 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
                    uploads.bill1.loading ? 'opacity-65 pointer-events-none' : ''
                  } ${
                    form.uploadBillUrl1 
                      ? 'border-emerald-200 bg-emerald-50/10 hover:bg-emerald-50/20' 
                      : 'border-slate-200 bg-slate-50/50 hover:bg-white hover:border-slate-400'
                  }`}>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={e => handleFileUpload('bill1', e)}
                      className="hidden"
                    />
                    {uploads.bill1.loading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
                    ) : form.uploadBillUrl1 ? (
                      <FileCheck className="w-6 h-6 text-emerald-600 mb-1" />
                    ) : (
                      <Upload className="w-6 h-6 text-slate-400 mb-1" />
                    )}
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 text-center px-2 truncate max-w-full">
                      {uploads.bill1.loading ? 'Verifying...' : form.uploadBillUrl1 ? 'Bill Uploaded' : 'Select Bill / बिल चुनें'}
                    </span>
                    {uploads.bill1.name && (
                      <span className="text-[9px] font-bold text-slate-400 max-w-[90%] truncate mt-0.5">{uploads.bill1.name}</span>
                    )}
                  </label>
                </div>

                {/* Bill 2 */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                    Upload Bill 2 / बिल 2 अपलोड करें
                  </label>
                  <label className={`flex flex-col items-center justify-center h-28 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
                    uploads.bill2.loading ? 'opacity-65 pointer-events-none' : ''
                  } ${
                    form.uploadBillUrl2 
                      ? 'border-emerald-200 bg-emerald-50/10 hover:bg-emerald-50/20' 
                      : 'border-slate-200 bg-slate-50/50 hover:bg-white hover:border-slate-400'
                  }`}>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={e => handleFileUpload('bill2', e)}
                      className="hidden"
                    />
                    {uploads.bill2.loading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
                    ) : form.uploadBillUrl2 ? (
                      <FileCheck className="w-6 h-6 text-emerald-600 mb-1" />
                    ) : (
                      <Upload className="w-6 h-6 text-slate-400 mb-1" />
                    )}
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 text-center px-2 truncate max-w-full">
                      {uploads.bill2.loading ? 'Verifying...' : form.uploadBillUrl2 ? 'Bill Uploaded' : 'Select Bill / बिल चुनें'}
                    </span>
                    {uploads.bill2.name && (
                      <span className="text-[9px] font-bold text-slate-400 max-w-[90%] truncate mt-0.5">{uploads.bill2.name}</span>
                    )}
                  </label>
                </div>

                {/* Documents */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                    Upload Documents / दस्तावेज़ अपलोड करें
                  </label>
                  <label className={`flex flex-col items-center justify-center h-28 border-2 border-dashed rounded-2xl cursor-pointer transition-all ${
                    uploads.doc.loading ? 'opacity-65 pointer-events-none' : ''
                  } ${
                    form.uploadDocUrl 
                      ? 'border-emerald-200 bg-emerald-50/10 hover:bg-emerald-50/20' 
                      : 'border-slate-200 bg-slate-50/50 hover:bg-white hover:border-slate-400'
                  }`}>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={e => handleFileUpload('doc', e)}
                      className="hidden"
                    />
                    {uploads.doc.loading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
                    ) : form.uploadDocUrl ? (
                      <FileCheck className="w-6 h-6 text-emerald-600 mb-1" />
                    ) : (
                      <Upload className="w-6 h-6 text-slate-400 mb-1" />
                    )}
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 text-center px-2 truncate max-w-full">
                      {uploads.doc.loading ? 'Verifying...' : form.uploadDocUrl ? 'Docs Uploaded' : 'Select Docs / दस्तावेज़ चुनें'}
                    </span>
                    {uploads.doc.name && (
                      <span className="text-[9px] font-bold text-slate-400 max-w-[90%] truncate mt-0.5">{uploads.doc.name}</span>
                    )}
                  </label>
                </div>

              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6 flex flex-col sm:flex-row items-center gap-4">
            <div className="flex gap-2 text-[10px] font-semibold text-slate-400">
              <Info className="w-4 h-4 flex-shrink-0" />
              <span>By submitting this form, you confirm that these details are correct and verify that all invoices are attached. / इस फॉर्म को जमा करके, आप पुष्टि करते हैं कि ये विवरण सही हैं और सत्यापित करते हैं कि सभी चालान संलग्न हैं।</span>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto sm:ml-auto min-h-11 py-3 px-8 bg-slate-950 text-white rounded-2xl text-xs font-black shadow-lg shadow-slate-950/15 hover:bg-slate-800 transition-all flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Submitting / जमा किया जा रहा है...
                </>
              ) : (
                'Submit Approval Request / अनुरोध भेजें'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
