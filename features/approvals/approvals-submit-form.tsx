'use client'

import { useState, FormEvent, ChangeEvent, useEffect, useMemo, useRef } from 'react'
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
  PlusCircle, 
  Info,
  IndianRupee,
  FileCheck,
  Plus,
  AlertTriangle,
  Calculator,
  Tags,
  Hash
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { validateEmailDomain } from '@/lib/email-validator'

// Category/Approval Type to GL Code mapping
const APPROVAL_TYPE_TO_GL_CODE: Record<string, string> = {
  'Accessories Purchase': 'GL-017',
  'Advance Against Salary': 'GL-080',
  'Card Payment': 'GL-065',
  'Corporate Card Payment': 'GL-065',
  'Event': 'GL-033',
  'Promotion': 'GL-033',
  'Event / Promotion / Advertising': 'GL-033',
  'Fuel Filling': 'GL-047',
  'Fund Transfer': 'GL-079',
  'Fund Transfer (OEM / EW / Wallet)': 'GL-079',
  'House Keeping': 'GL-043',
  'Housekeeping': 'GL-043',
  'Incentive Disbursement': 'GL-025',
  'Maintenance': 'GL-039',
  'Maintenance & Repair': 'GL-039',
  'Others': 'GL-061',
  'Scope Gainer': 'GL-061',
  'Local Vendor': 'GL-061',
  'Pantry Items': 'GL-029',
  'Pantry / Refreshment': 'GL-029',
  'Petty Cash': 'GL-083',
  'Cash': 'GL-083',
  'Rent': 'GL-037',
  'Rents': 'GL-037',
  'Salary Disbursement': 'GL-024',
  'Releasing Hold Salary / Incentive': 'GL-024',
  'Spare Parts Purchase': 'GL-015',
  'Part Purchase': 'GL-015',
  'Purchase': 'GL-015',
  'Part Purchasing From Other Dealer': 'GL-016',
  'Staff Uniform': 'GL-027',
  'Uniform': 'GL-027',
  'Staff Welfare': 'GL-026',
  'Training Expenses': 'GL-028',
  'Travelling Charges': 'GL-052',
  'Travelling & Conveyance': 'GL-052',
  'Utility & Subscription': 'GL-055',
  'Vehicle Stock Transfer': 'GL-013',
  'Stock Transfer': 'GL-013',
  'Vendor Payment': 'GL-068',
  'Vendor Payment (Bill / Invoice)': 'GL-068',
  'Workshop / Job Work (Sublet)': 'GL-021',
  'Labour Payment': 'GL-021',
  'Freight & Courier': 'GL-050',
  'Fast Tag': 'GL-051',
  'PF': 'GL-030',
  'ESIC': 'GL-031',
  'RTO': 'GL-060',
  'Statutory Payment (PF / ESIC / GST / RTO)': 'GL-060',
  'Professional Fee': 'GL-057'
}

// GL Code to Vendor suggestions mapping
const GL_CODE_TO_VENDORS: Record<string, string[]> = {
  'GL-032': ['Creative Shadows', 'APK Advertiser', 'Chander Bhaga', 'Daily Excelsior', 'Hyperlocal', 'Havas', 'Radio Mirchi'],
  'GL-045': ['BD Security', 'Franknight', 'Kapahi Hawkeye', 'GDX Security'],
  'GL-055': ['Airtel', 'BSNL', 'Jio', 'Interakt'],
  'GL-036': ['Interakt'],
  'GL-044': ['Mahaveer Pest Control']
}

// Vendor search keyword to GL Code auto-select mapping
const VENDOR_TO_GL_CODE: Record<string, string> = {
  'mahaveer pest control': 'GL-044',
  'airtel': 'GL-055',
  'bsnl': 'GL-055',
  'jio': 'GL-055',
  'interakt': 'GL-036',
  'creative shadows': 'GL-032',
  'apk advertiser': 'GL-032',
  'chander bhaga': 'GL-032',
  'daily excelsior': 'GL-032',
  'hyperlocal': 'GL-032',
  'havas': 'GL-032',
  'radio mirchi': 'GL-032',
  'bd security': 'GL-045',
  'franknight': 'GL-045',
  'kapahi hawkeye': 'GL-045',
  'gdx security': 'GL-045'
}

// Options from constants that remain static across all forms
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
  glAccountId: string
  gst: string
}

interface UploadState {
  bill1: { name: string; loading: boolean; error: string }
  bill2: { name: string; loading: boolean; error: string }
  doc: { name: string; loading: boolean; error: string }
}

interface VendorOption {
  id: string
  name: string
  gstNumber: string | null
}

interface LocationConfig {
  location: string
  dealerCode: string
  dealerName: string
}

export function ApprovalsSubmitForm({ brand }: { brand: string }) {
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
    uploadDocUrl: '',
    glAccountId: '',
    gst: ''
  })

  const [uploads, setUploads] = useState<UploadState>({
    bill1: { name: '', loading: false, error: '' },
    bill2: { name: '', loading: false, error: '' },
    doc: { name: '', loading: false, error: '' }
  })

  // Dynamic configuration state loaded from API
  const [brandDisplayName, setBrandDisplayName] = useState('')
  const [locations, setLocations] = useState<LocationConfig[]>([])
  const [approvalTypes, setApprovalTypes] = useState<string[]>([])
  const [loadingConfig, setLoadingConfig] = useState(true)

  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [vendorsLoading, setVendorsLoading] = useState(true)

  const [glAccounts, setGlAccounts] = useState<any[]>([])
  const [glLoading, setGlLoading] = useState(true)

  const [vendorSearch, setVendorSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [savingVendor, setSavingVendor] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [submitting, setSubmitting] = useState(false)
  const [submittedId, setSubmittedId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false)

  // 1. Fetch Brand Approvals Config
  useEffect(() => {
    setLoadingConfig(true)
    fetch(`/api/brands/${brand}/approvals/config`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setBrandDisplayName(data.brandDisplayName || brand.toUpperCase())
          setLocations(data.locations || [])
          setApprovalTypes((data.approvalTypes || []).filter((t: string) => t.toLowerCase() !== 'petty cash'))
        }
      })
      .catch(err => console.error('Error loading config:', err))
      .finally(() => setLoadingConfig(false))
  }, [brand])

  // 2. Fetch Vendors List
  useEffect(() => {
    setVendorsLoading(true)
    fetch(`/api/brands/${brand}/vendors`)
      .then(res => res.json())
      .then(data => setVendors(data.vendors || []))
      .catch(err => console.error('Error fetching vendors:', err))
      .finally(() => setVendorsLoading(false))
  }, [brand])

  // 3. Fetch GL Accounts List
  useEffect(() => {
    setGlLoading(true)
    fetch(`/api/brands/${brand}/gl-accounts`)
      .then(res => res.json())
      .then(data => {
        const rows = data.rows || []
        setGlAccounts(rows)
        setForm(prev => {
          if (prev.glAccountId) return prev
          const targetCode = APPROVAL_TYPE_TO_GL_CODE[prev.approvalType] || 'GL-001'
          const matched = rows.find((g: any) => g.glCode === targetCode) || rows[0]
          return { ...prev, glAccountId: matched?.id || '' }
        })
      })
      .catch(err => console.error('Error fetching GL accounts:', err))
      .finally(() => setGlLoading(false))
  }, [brand])

  // Auto-select GL from Vendor search input change
  useEffect(() => {
    const cleanName = vendorSearch.trim().toLowerCase()
    if (!cleanName) {
      const targetCode = APPROVAL_TYPE_TO_GL_CODE[form.approvalType] || 'GL-001'
      const matchedGl = glAccounts.find(g => g.glCode === targetCode) || glAccounts[0]
      if (matchedGl && form.glAccountId !== matchedGl.id) {
        setForm(prev => ({ ...prev, glAccountId: matchedGl.id }))
      }
      return
    }
    const matchedKey = Object.keys(VENDOR_TO_GL_CODE).find(k => cleanName.includes(k))
    const glCode = matchedKey ? VENDOR_TO_GL_CODE[matchedKey] : null
    if (glCode) {
      const matchedGl = glAccounts.find(g => g.glCode === glCode)
      if (matchedGl && form.glAccountId !== matchedGl.id) {
        setForm(prev => ({ ...prev, glAccountId: matchedGl.id }))
      }
    } else {
      const targetCode = APPROVAL_TYPE_TO_GL_CODE[form.approvalType] || 'GL-001'
      const matchedGl = glAccounts.find(g => g.glCode === targetCode) || glAccounts[0]
      if (matchedGl && form.glAccountId !== matchedGl.id) {
        setForm(prev => ({ ...prev, glAccountId: matchedGl.id }))
      }
    }
  }, [vendorSearch, glAccounts, form.approvalType])

  // Sync vendorSearch if form.vendorName is cleared or set externally
  useEffect(() => {
    if (form.vendorName) {
      setVendorSearch(form.vendorName)
    } else {
      setVendorSearch('')
    }
  }, [form.vendorName])

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredVendors = useMemo(() => {
    if (!vendorSearch.trim()) return vendors
    const query = vendorSearch.toLowerCase()
    return vendors.filter(v =>
      v.name.toLowerCase().includes(query) ||
      (v.gstNumber && v.gstNumber.toLowerCase().includes(query))
    )
  }, [vendors, vendorSearch])

  const handleQuickCreateVendor = async (nameToCreate: string) => {
    const name = nameToCreate.trim()
    if (!name) return
    setSavingVendor(true)
    try {
      const response = await fetch(`/api/brands/${brand}/vendors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      const data = await response.json()
      if (response.ok && data.vendor) {
        setVendors(prev => [data.vendor, ...prev])
        setForm(prev => ({ ...prev, vendorName: data.vendor.name }))
        setVendorSearch(data.vendor.name)
        setDropdownOpen(false)
      } else {
        alert(data.error || 'Failed to create vendor')
      }
    } catch (err) {
      console.error(err)
      alert('Failed to connect to the server')
    } finally {
      setSavingVendor(false)
    }
  }

  const handleTextChange = (key: keyof FormState, value: string) => {
    setForm(prev => {
      const next = { ...prev, [key]: value }
      
      // Auto-correlate Location / Dealer Code / Dealer Name dynamically
      if (key === 'location') {
        const found = locations.find(l => l.location === value)
        if (found) {
          next.dealerCode = found.dealerCode
          next.dealerName = found.dealerName
        } else {
          next.dealerCode = ''
          next.dealerName = ''
        }
      } else if (key === 'dealerCode') {
        const found = locations.find(l => l.dealerCode === value)
        if (found) {
          next.location = found.location
          next.dealerName = found.dealerName
        } else {
          next.location = ''
          next.dealerName = ''
        }
      } else if (key === 'dealerName') {
        const found = locations.find(l => l.dealerName === value)
        if (found) {
          next.location = found.location
          next.dealerCode = found.dealerCode
        } else {
          next.location = ''
          next.dealerCode = ''
        }
      } else if (key === 'approvalType') {
        const glCode = APPROVAL_TYPE_TO_GL_CODE[value]
        const matchedGl = glAccounts.find(g => g.glCode === (glCode || 'GL-001')) || glAccounts[0]
        if (matchedGl) {
          next.glAccountId = matchedGl.id
        }
      } else if (key === 'vendorName') {
        const cleanName = value.trim().toLowerCase()
        const matchedKey = Object.keys(VENDOR_TO_GL_CODE).find(k => cleanName.includes(k))
        const glCode = matchedKey ? VENDOR_TO_GL_CODE[matchedKey] : null
        if (glCode) {
          const matchedGl = glAccounts.find(g => g.glCode === glCode)
          if (matchedGl) {
            next.glAccountId = matchedGl.id
          }
        } else {
          const targetCode = APPROVAL_TYPE_TO_GL_CODE[next.approvalType] || 'GL-001'
          const matchedGl = glAccounts.find(g => g.glCode === targetCode) || glAccounts[0]
          if (matchedGl) {
            next.glAccountId = matchedGl.id
          }
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

      const res = await fetch(`/api/brands/${brand}/approvals/upload`, {
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

  const executeSubmit = async () => {
    setSubmitting(true)
    setErrorMsg('')

    // User vendor value check (fallback to typed input if not selected)
    const finalVendorName = form.vendorName || vendorSearch.trim()
    const submissionForm = {
      ...form,
      vendorName: finalVendorName
    }

    try {
      const res = await fetch(`/api/brands/${brand}/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submissionForm)
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMsg('')

    // Email Validation & Typo Domain Check
    const emailCheck = validateEmailDomain(form.email)
    if (!emailCheck.valid) {
      return setErrorMsg(emailCheck.error || 'Please enter a valid email address.')
    }
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
    if (!form.glAccountId) return setErrorMsg('GL Account is required.')

    if (brand === 'kia' && !form.uploadBillUrl1 && !form.uploadBillUrl2) {
      setShowConfirmSubmit(true)
      return
    }

    await executeSubmit()
  }

  if (loadingConfig) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-10 h-10 animate-spin text-slate-900" />
          <span className="text-sm font-semibold text-slate-500">Loading form configuration...</span>
        </div>
      </div>
    )
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
                uploadDocUrl: '',
                glAccountId: '',
                gst: ''
              })
              setUploads({
                bill1: { name: '', loading: false, error: '' },
                bill2: { name: '', loading: false, error: '' },
                doc: { name: '', loading: false, error: '' }
              })
              setVendorSearch('')
            }}
            className="w-full min-h-11 py-3 px-6 h-auto bg-slate-950 text-white rounded-2xl text-xs font-black shadow-lg shadow-slate-950/10 hover:bg-slate-800 transition-all whitespace-nowrap"
          >
            Submit Another Request / दूसरा अनुरोध भेजें
          </button>
        </div>
      </div>
    )
  }

  const uniqueNames = Array.from(new Set(locations.map(l => l.dealerName))).sort()

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8 animate-fadeIn">
        
        {/* Branding Header */}
        <div className="text-center space-y-3 flex flex-col items-center">
          {brand === 'kia' ? (
            <img 
              src="https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/am_kia.svg" 
              alt="AM Kia Logo" 
              className="h-12 w-auto object-contain mb-2"
            />
          ) : brand === 'hyundai' ? (
            <img 
              src="https://crreoeautoqzcgtlwlsd.supabase.co/storage/v1/object/public/Logos/am_hyundai.svg" 
              alt="AM Hyundai Logo" 
              className="h-12 w-auto object-contain mb-2"
            />
          ) : (
            <div className="inline-flex h-9 items-center justify-center rounded-full bg-slate-950 px-4 text-[10px] font-black uppercase tracking-[0.2em] text-white">
              {brandDisplayName}
            </div>
          )}
          <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
            {brandDisplayName} Approvals Form
          </h1>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
            {brandDisplayName} अनुमोदन फॉर्म
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
                    placeholder="Enter your email address (e.g. name@gmail.com)"
                    value={form.email}
                    onChange={e => handleTextChange('email', e.target.value)}
                    className="w-full h-11 pl-11 pr-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800"
                  />
                </div>
                {(() => {
                  if (!form.email.trim()) return null
                  const check = validateEmailDomain(form.email)
                  if (check.valid) return null
                  return (
                    <p className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl flex items-center gap-1.5 mt-1.5 animate-in fade-in duration-200">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>{check.error}</span>
                    </p>
                  )
                })()}
              </div>
            </div>
          </div>

          {/* Section 2: Dealer & Department */}
          <div className="space-y-5">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-950 text-white">
                <MapPin className="w-3.5 h-3.5" />
              </div>
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-950">Dealer & Department / डीलर और विभाग</h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
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
                  {uniqueNames.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
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
                <div className="sm:col-span-2 space-y-1.5">
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
                  {approvalTypes.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>

              <div className="space-y-1.5 relative" ref={dropdownRef}>
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex flex-wrap items-center gap-1">
                  Vendor Name / विक्रेता का नाम
                  {vendorsLoading && <span className="text-[9px] text-indigo-400 font-bold">(loading...)</span>}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Type to search vendor..."
                    value={vendorSearch}
                    onFocus={() => setDropdownOpen(true)}
                    onChange={e => {
                      setVendorSearch(e.target.value)
                      setDropdownOpen(true)
                      if (form.vendorName !== e.target.value) {
                        handleTextChange('vendorName', '')
                      }
                    }}
                    className="w-full h-11 px-4 pr-10 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-950 bg-slate-50/50 text-sm font-semibold text-slate-800"
                  />
                  {form.vendorName && (
                    <button
                      type="button"
                      onClick={() => {
                        handleTextChange('vendorName', '')
                        setVendorSearch('')
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {dropdownOpen && (
                  <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-60 overflow-y-auto">
                    {filteredVendors.map(v => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          handleTextChange('vendorName', v.name)
                          setVendorSearch(v.name)
                          setDropdownOpen(false)
                        }}
                        className="w-full px-4 py-2.5 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 border-b border-slate-100 last:border-b-0 flex justify-between items-center"
                      >
                        <span>{v.name}</span>
                        {v.gstNumber && <span className="text-[10px] text-slate-400 font-mono">{v.gstNumber}</span>}
                      </button>
                    ))}

                    <button
                      type="button"
                      disabled={savingVendor}
                      onClick={() => handleQuickCreateVendor(vendorSearch)}
                      className="w-full px-4 py-3 text-left text-sm font-bold text-indigo-600 hover:bg-indigo-50/50 border-t border-slate-100 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {savingVendor ? (
                        <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                      <span>Add & Select Vendor "{vendorSearch || 'New Vendor'}"</span>
                    </button>
                  </div>
                )}
              </div>

              {form.approvalType === 'Others' && (
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

      <Dialog open={showConfirmSubmit} onOpenChange={setShowConfirmSubmit}>
        <DialogContent className="rounded-3xl w-[calc(100vw-1.5rem)] sm:max-w-md bg-white p-6 shadow-2xl border border-slate-100">
          <DialogHeader className="flex flex-col items-center text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-amber-600" />
            </div>
            <DialogTitle className="text-lg font-black tracking-tight text-slate-900">
              Submit Without Invoice? / बिना इनवॉइस जमा करें?
            </DialogTitle>
          </DialogHeader>
          
          <div className="text-center py-2 space-y-4">
            <p className="text-sm font-semibold text-slate-700 leading-relaxed">
              Are you sure you want to submit the form without uploading any bill or invoice?
            </p>
            <p className="text-sm font-black text-slate-900 leading-relaxed bg-amber-50/50 p-3.5 border border-amber-100 rounded-2xl">
              क्या आप वाकई बिना बिल या इनवॉइस अपलोड किए फॉर्म सबमिट करना चाहते हैं?
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 justify-end mt-4">
            <button
              type="button"
              onClick={() => setShowConfirmSubmit(false)}
              className="h-11 rounded-2xl text-xs font-bold border border-slate-200 hover:bg-slate-50 transition-colors text-slate-700 px-6 order-last sm:order-none"
            >
              Cancel / रद्द करें
            </button>
            <button
              type="button"
              onClick={async () => {
                setShowConfirmSubmit(false)
                await executeSubmit()
              }}
              className="h-11 rounded-2xl text-xs font-black text-white hover:opacity-90 transition-all shadow-md shadow-emerald-500/10 px-6"
              style={{ backgroundColor: '#059669' }}
            >
              Yes, Submit / हाँ, भेजें
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
