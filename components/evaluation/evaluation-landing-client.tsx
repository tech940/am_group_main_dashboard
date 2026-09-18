'use client'

import React, { useState, useMemo, useTransition } from 'react'
import {
  CAR_BRANDS_DATA,
  MANUFACTURING_YEARS,
  FUEL_TYPES,
  TRANSMISSION_TYPES,
  KM_RANGES,
  JAMMU_AREAS,
  calculateEstimatedValuation,
} from '@/lib/evaluation/car-data'
import {
  Car,
  Calendar,
  Phone,
  User,
  MapPin,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  Clock,
  Banknote,
  FileCheck,
  Upload,
  Camera,
  MessageSquare,
  Sparkles,
  ChevronDown,
  RotateCcw,
} from 'lucide-react'

export function EvaluationLandingClient() {
  // Step navigation: 1 = Car Details, 2 = Contact Details & Date, 3 = Confirmation & Valuation Result
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [isPending, startTransition] = useTransition()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Step 1 State: Vehicle
  const [brand, setBrand] = useState('Hyundai')
  const [model, setModel] = useState('Creta')
  const [customModel, setCustomModel] = useState('')
  const [year, setYear] = useState<number>(2021)
  const [fuelType, setFuelType] = useState('petrol')
  const [transmission, setTransmission] = useState('manual')
  const [kmRange, setKmRange] = useState('40k_70k')

  // Step 2 State: Customer Lead Capture
  const [customerName, setCustomerName] = useState('')
  const [mobile, setMobile] = useState('')
  const [cityArea, setCityArea] = useState('Jammu City')
  const [evaluationDate, setEvaluationDate] = useState('Tomorrow')
  const [customDate, setCustomDate] = useState('')
  const [interestedInNewCar, setInterestedInNewCar] = useState(false)

  // Step 3 State: Submission Result & Photos
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [valuationResult, setValuationResult] = useState<{
    minPriceFormatted: string
    maxPriceFormatted: string
    minPriceLakhs: number
    maxPriceLakhs: number
  } | null>(null)

  // Photo upload state
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([])
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([])
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false)
  const [photosUploadedSuccessfully, setPhotosUploadedSuccessfully] = useState(false)

  // Filter models for the selected brand
  const brandModels = useMemo(() => {
    const found = CAR_BRANDS_DATA.find((b) => b.brand === brand)
    return found ? found.models : []
  }, [brand])

  // Handle brand change
  const handleBrandChange = (newBrand: string) => {
    setBrand(newBrand)
    const bData = CAR_BRANDS_DATA.find((b) => b.brand === newBrand)
    if (bData && bData.models.length > 0) {
      setModel(bData.models[0].name)
    } else {
      setModel('Other Car Model')
    }
  }

  // Real-time valuation estimation calculation for preview
  const liveValuation = useMemo(() => {
    const activeModel = model === 'Other Car Model' && customModel ? customModel : model
    return calculateEstimatedValuation({
      brand,
      model: activeModel,
      year,
      fuelType,
      transmission,
      kmRangeId: kmRange,
    })
  }, [brand, model, customModel, year, fuelType, transmission, kmRange])

  // Handle Step 1 -> Step 2
  const handleProceedToContact = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)
    if (!brand || !model) {
      setErrorMessage('Please select your vehicle brand and model')
      return
    }
    setStep(2)
    // Scroll to top of card smoothly
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Handle Step 2 -> Submit
  const handleSubmitLead = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    if (!customerName.trim()) {
      setErrorMessage('Please enter your full name')
      return
    }

    const cleanMobile = mobile.replace(/\D/g, '')
    if (cleanMobile.length !== 10) {
      setErrorMessage('Please enter a valid 10-digit mobile number')
      return
    }

    const activeModel = model === 'Other Car Model' && customModel ? customModel : model
    const finalDate = evaluationDate === 'Custom' ? (customDate || 'Upcoming Week') : evaluationDate

    startTransition(async () => {
      try {
        const payload = {
          customerName: customerName.trim(),
          mobile: cleanMobile,
          brand,
          model: activeModel,
          manufacturingYear: Number(year),
          fuelType,
          transmission,
          kilometersDriven: kmRange,
          evaluationDate: finalDate,
          cityArea,
          interestedInNewCar,
          estimatedPriceMin: liveValuation.minPriceLakhs,
          estimatedPriceMax: liveValuation.maxPriceLakhs,
          source: 'whatsapp_campaign',
        }

        const res = await fetch('/api/evaluations/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        const data = await res.json()

        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Failed to submit evaluation request')
        }

        setSubmissionId(data.data.id)
        setValuationResult(data.data.valuation)
        setStep(3)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } catch (err: any) {
        setErrorMessage(err.message || 'Something went wrong. Please try again.')
      }
    })
  }

  // Handle Photo selection
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    const files = Array.from(e.target.files).slice(0, 4)
    setSelectedPhotos(files)

    const previews = files.map((file) => URL.createObjectURL(file))
    setPhotoPreviews(previews)
  }

  // Handle Photo upload
  const handleUploadPhotos = async () => {
    if (!submissionId || selectedPhotos.length === 0) return
    setIsUploadingPhotos(true)

    try {
      const formData = new FormData()
      formData.append('evaluationId', submissionId)
      selectedPhotos.forEach((photo) => formData.append('photos', photo))

      const res = await fetch('/api/evaluations/upload-photos', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()
      if (res.ok && data.success) {
        setPhotosUploadedSuccessfully(true)
      }
    } catch (err) {
      console.error('Photo upload error:', err)
    } finally {
      setIsUploadingPhotos(false)
    }
  }

  const activeModelDisplay = model === 'Other Car Model' && customModel ? customModel : model
  const resolvedDate = evaluationDate === 'Custom' ? (customDate || 'Upcoming Week') : evaluationDate

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-blue-600 selection:text-white">
      {/* Top Brand Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 items-center justify-center rounded-lg bg-[#002C6C] px-2.5 text-white font-extrabold text-sm tracking-wider">
              AM GROUP
            </div>
            <div className="hidden sm:block">
              <div className="text-xs font-bold text-slate-800 uppercase tracking-tight">
                Used Car Valuation Desk
              </div>
              <div className="text-[11px] text-slate-500 font-medium">Jammu & Kashmir</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              100% Free Doorstep Valuation
            </span>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        {/* Hero Title Area */}
        <div className="mb-6 text-center sm:mb-8">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 mb-3 border border-blue-100">
            <Sparkles className="h-3.5 w-3.5 text-blue-600" />
            Instant AI-Assisted Market Valuation • Jammu
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900 leading-tight">
            Get Instant Fair Price For Your Car
          </h1>
          <p className="mt-1.5 text-sm sm:text-base text-slate-600 max-w-lg mx-auto">
            Doorstep evaluation in Jammu, same-day instant payment & free RC transfer.
          </p>
        </div>

        {/* Wizard Form Card */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-8 shadow-sm">
          {/* Step Indicator Bar */}
          <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  step >= 1 ? 'bg-[#002C6C] text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                1
              </span>
              <span className={`text-xs font-bold ${step === 1 ? 'text-slate-900' : 'text-slate-500'}`}>
                Car Details
              </span>
            </div>

            <div className="h-0.5 flex-1 mx-3 bg-slate-100" />

            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  step >= 2 ? 'bg-[#002C6C] text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                2
              </span>
              <span className={`text-xs font-bold ${step === 2 ? 'text-slate-900' : 'text-slate-500'}`}>
                Free Inspection
              </span>
            </div>

            <div className="h-0.5 flex-1 mx-3 bg-slate-100" />

            <div className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                  step === 3 ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                3
              </span>
              <span className={`text-xs font-bold ${step === 3 ? 'text-slate-900' : 'text-slate-500'}`}>
                Instant Valuation
              </span>
            </div>
          </div>

          {errorMessage && (
            <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
              {errorMessage}
            </div>
          )}

          {/* ================= STEP 1: VEHICLE DETAILS ================= */}
          {step === 1 && (
            <form onSubmit={handleProceedToContact} className="space-y-6">
              {/* Brand Selector */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                  1. Select Car Brand
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {CAR_BRANDS_DATA.map((b) => {
                    const isSelected = brand === b.brand
                    return (
                      <button
                        key={b.brand}
                        type="button"
                        onClick={() => handleBrandChange(b.brand)}
                        className={`flex items-center justify-center rounded-xl border py-2.5 px-2 text-xs font-bold transition-all ${
                          isSelected
                            ? 'border-[#002C6C] bg-blue-50/70 text-[#002C6C] shadow-xs ring-1 ring-[#002C6C]'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        {b.brand}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Model Selector */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                    2. Select Model
                  </label>
                  <span className="text-[11px] font-medium text-slate-500">{brand} Models</span>
                </div>
                <div className="relative">
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-semibold text-slate-800 shadow-xs focus:border-[#002C6C] focus:outline-hidden focus:ring-1 focus:ring-[#002C6C]"
                  >
                    {brandModels.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} {m.bodyType ? `(${m.bodyType})` : ''}
                      </option>
                    ))}
                    <option value="Other Car Model">Other Model (Type manually)</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3.5 top-3.5 h-4 w-4 text-slate-400" />
                </div>

                {model === 'Other Car Model' && (
                  <input
                    type="text"
                    placeholder="Enter your exact car model name"
                    value={customModel}
                    onChange={(e) => setCustomModel(e.target.value)}
                    className="mt-2.5 w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-medium text-slate-800 focus:border-[#002C6C] focus:outline-hidden"
                  />
                )}
              </div>

              {/* Manufacturing Year & Fuel Type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Year */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                    3. Manufacturing Year
                  </label>
                  <div className="relative">
                    <select
                      value={year}
                      onChange={(e) => setYear(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-semibold text-slate-800 shadow-xs focus:border-[#002C6C] focus:outline-hidden focus:ring-1 focus:ring-[#002C6C]"
                    >
                      {MANUFACTURING_YEARS.map((yr) => (
                        <option key={yr} value={yr}>
                          {yr}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3.5 top-3.5 h-4 w-4 text-slate-400" />
                  </div>
                </div>

                {/* Fuel Type */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                    4. Fuel Type
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {FUEL_TYPES.slice(0, 3).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFuelType(f.id)}
                        className={`rounded-lg border py-2.5 text-center text-xs font-bold transition-all ${
                          fuelType === f.id
                            ? 'border-[#002C6C] bg-blue-50/70 text-[#002C6C] ring-1 ring-[#002C6C]'
                            : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Transmission & Kilometers Driven */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Transmission */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                    5. Transmission
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {TRANSMISSION_TYPES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTransmission(t.id)}
                        className={`rounded-lg border py-2.5 text-center text-xs font-bold transition-all ${
                          transmission === t.id
                            ? 'border-[#002C6C] bg-blue-50/70 text-[#002C6C] ring-1 ring-[#002C6C]'
                            : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Kilometers */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                    6. Kilometers Driven
                  </label>
                  <div className="relative">
                    <select
                      value={kmRange}
                      onChange={(e) => setKmRange(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-semibold text-slate-800 shadow-xs focus:border-[#002C6C] focus:outline-hidden focus:ring-1 focus:ring-[#002C6C]"
                    >
                      {KM_RANGES.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3.5 top-3.5 h-4 w-4 text-slate-400" />
                  </div>
                </div>
              </div>

              {/* Live Preview Teaser */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-blue-700">
                      Estimated Jammu Market Range
                    </div>
                    <div className="text-xs text-slate-600 font-medium">
                      {year} {brand} {activeModelDisplay} ({transmission.toUpperCase()} • {fuelType.toUpperCase()})
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black text-slate-900 tracking-tight">
                      {liveValuation.minPriceFormatted} – {liveValuation.maxPriceFormatted}
                    </div>
                    <div className="text-[10px] text-emerald-600 font-bold">● High Demand in Jammu</div>
                  </div>
                </div>
              </div>

              {/* Submit Step 1 Button */}
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#002C6C] py-3.5 px-6 text-sm font-bold text-white shadow-sm hover:bg-[#002255] active:scale-[0.99] transition-all"
              >
                Continue To Free Doorstep Inspection
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          )}

          {/* ================= STEP 2: LEAD CAPTURE & SCHEDULE ================= */}
          {step === 2 && (
            <form onSubmit={handleSubmitLead} className="space-y-6">
              {/* Selected Car Recap */}
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-800">
                    <Car className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      {year} {brand} {activeModelDisplay}
                    </div>
                    <div className="text-xs text-slate-500 font-medium">
                      {fuelType.toUpperCase()} • {transmission.toUpperCase()} • {KM_RANGES.find((k) => k.id === kmRange)?.label}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-900 hover:underline"
                >
                  <RotateCcw className="h-3 w-3" />
                  Edit Car
                </button>
              </div>

              {/* Customer Name */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Your Full Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    placeholder="Enter your full name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-3 pl-10 text-sm font-semibold text-slate-800 shadow-xs focus:border-[#002C6C] focus:outline-hidden focus:ring-1 focus:ring-[#002C6C]"
                  />
                  <User className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
                </div>
              </div>

              {/* Mobile Number */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  WhatsApp / Mobile Number <span className="text-red-500">*</span>
                </label>
                <div className="relative flex">
                  <span className="inline-flex items-center rounded-l-xl border border-r-0 border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-600">
                    🇮🇳 +91
                  </span>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    placeholder="10-digit mobile number"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value.replace(/\D/g, ''))}
                    className="w-full rounded-r-xl border border-slate-200 px-3.5 py-3 text-sm font-semibold text-slate-800 shadow-xs focus:border-[#002C6C] focus:outline-hidden focus:ring-1 focus:ring-[#002C6C]"
                  />
                </div>
                <span className="mt-1 block text-[11px] text-slate-500 font-medium">
                  We will share your certified valuation report & inspection confirmation on this number.
                </span>
              </div>

              {/* Jammu Area & Preferred Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Jammu Area */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                    Location / Area in Jammu <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={cityArea}
                      onChange={(e) => setCityArea(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 pl-10 text-sm font-semibold text-slate-800 shadow-xs focus:border-[#002C6C] focus:outline-hidden focus:ring-1 focus:ring-[#002C6C]"
                    >
                      {JAMMU_AREAS.map((area) => (
                        <option key={area} value={area}>
                          {area}
                        </option>
                      ))}
                    </select>
                    <MapPin className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-slate-400" />
                    <ChevronDown className="pointer-events-none absolute right-3.5 top-3.5 h-4 w-4 text-slate-400" />
                  </div>
                </div>

                {/* Preferred Date */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                    Preferred Evaluation Date <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['Today', 'Tomorrow', 'Custom'].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setEvaluationDate(d)}
                        className={`rounded-lg border py-2.5 text-center text-xs font-bold transition-all ${
                          evaluationDate === d
                            ? 'border-[#002C6C] bg-blue-50/70 text-[#002C6C] ring-1 ring-[#002C6C]'
                            : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>

                  {evaluationDate === 'Custom' && (
                    <input
                      type="date"
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className="mt-2 w-full rounded-lg border border-slate-200 p-2 text-xs font-semibold text-slate-800"
                    />
                  )}
                </div>
              </div>

              {/* Interested in New Car Exchange */}
              <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-900">
                      Are you interested in exchanging for a New Car?
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium">
                      Special exchange bonus discounts available on Hyundai, Kia, Tata & Honda.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setInterestedInNewCar(true)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                        interestedInNewCar
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      Yes (Exchange)
                    </button>
                    <button
                      type="button"
                      onClick={() => setInterestedInNewCar(false)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                        !interestedInNewCar
                          ? 'bg-slate-800 text-white shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      No (Only Sell)
                    </button>
                  </div>
                </div>
              </div>

              {/* Submit CTA */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 px-6 text-sm font-bold text-white shadow-md hover:bg-emerald-700 active:scale-[0.99] transition-all disabled:opacity-70"
                >
                  {isPending ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Generating Valuation...
                    </>
                  ) : (
                    <>
                      Unlock Valuation & Schedule Free Inspection
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
                <div className="mt-2 text-center text-[11px] text-slate-500 font-medium">
                  🔒 Zero spam guarantee • 100% Free Doorstep Inspection by AM Group Jammu
                </div>
              </div>
            </form>
          )}

          {/* ================= STEP 3: RESULT & CONFIRMATION ================= */}
          {step === 3 && valuationResult && (
            <div className="space-y-6 text-center">
              {/* Success Badge */}
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 mb-1">
                <CheckCircle2 className="h-8 w-8" />
              </div>

              <div>
                <h2 className="text-xl font-black text-slate-900 sm:text-2xl">
                  Evaluation Scheduled Successfully!
                </h2>
                <p className="mt-1 text-xs sm:text-sm text-slate-600">
                  Thank you, <strong className="text-slate-900">{customerName}</strong>. Our certified valuation engineer will contact you shortly.
                </p>
              </div>

              {/* Price Estimate Card */}
              <div className="rounded-2xl border-2 border-emerald-500/30 bg-emerald-50/50 p-6 text-center shadow-xs">
                <div className="text-xs font-bold uppercase tracking-widest text-emerald-800 mb-1">
                  Estimated Jammu Market Valuation Range
                </div>
                <div className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight my-2">
                  {valuationResult.minPriceFormatted} – {valuationResult.maxPriceFormatted}
                </div>
                <div className="inline-block rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">
                  {year} {brand} {activeModelDisplay}
                </div>
                <div className="mt-3 text-[11px] text-slate-500">
                  *Final certified price will be confirmed after rapid 15-min doorstep physical inspection.
                </div>
              </div>

              {/* Appointment Summary Box */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                  Inspection Summary
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-500">Preferred Date:</span>{' '}
                    <span className="font-bold text-slate-800">{resolvedDate}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Location:</span>{' '}
                    <span className="font-bold text-slate-800">{cityArea}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Phone:</span>{' '}
                    <span className="font-bold text-slate-800">+91 {mobile}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Exchange Plan:</span>{' '}
                    <span className="font-bold text-slate-800">
                      {interestedInNewCar ? 'Exchange for New Car' : 'Direct Sale'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Direct WhatsApp CTA Button */}
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href={`https://wa.me/919419198000?text=${encodeURIComponent(
                    `Hello AM Group, I just booked a car evaluation for my ${year} ${brand} ${activeModelDisplay} on ${resolvedDate} in ${cityArea}. My phone is ${mobile}.`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] py-3.5 px-4 text-sm font-bold text-white shadow-sm hover:bg-[#20bd5a] transition-all"
                >
                  <MessageSquare className="h-4 w-4" />
                  Chat on WhatsApp for Fast-Track
                </a>
                <a
                  href="tel:+919419198000"
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-3.5 px-5 text-sm font-bold text-slate-800 shadow-2xs hover:bg-slate-50 transition-all"
                >
                  <Phone className="h-4 w-4" />
                  Call Valuation Desk
                </a>
              </div>

              {/* Optional Photo Upload Section */}
              <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-5 text-left">
                <div className="flex items-center gap-2 mb-2">
                  <Camera className="h-4 w-4 text-blue-600" />
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Upload Car Photos (Optional - Get Instant Quotation)
                  </div>
                </div>
                <p className="text-xs text-slate-500 mb-3">
                  Upload 1 to 4 photos of your vehicle (Front, Rear, Odometer, Interior) to lock in the highest certified offer before inspection.
                </p>

                {photosUploadedSuccessfully ? (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs font-bold text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Photos received! Our valuation manager is analyzing them.
                  </div>
                ) : (
                  <div>
                    <input
                      type="file"
                      id="car-photos-input"
                      multiple
                      accept="image/*"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <label
                        htmlFor="car-photos-input"
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-all"
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {selectedPhotos.length > 0 ? `${selectedPhotos.length} photos selected` : 'Select Photos'}
                      </label>

                      {selectedPhotos.length > 0 && (
                        <button
                          type="button"
                          onClick={handleUploadPhotos}
                          disabled={isUploadingPhotos}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#002C6C] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#002255] transition-all disabled:opacity-50"
                        >
                          {isUploadingPhotos ? 'Uploading...' : 'Submit Photos'}
                        </button>
                      )}
                    </div>

                    {photoPreviews.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {photoPreviews.map((src, i) => (
                          <img
                            key={i}
                            src={src}
                            alt="Vehicle Preview"
                            className="h-14 w-14 rounded-lg object-cover border border-slate-200 shadow-2xs"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ================= VALUE PROPOSITION & TRUST PILLARS ================= */}
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
          <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-700 mb-2.5">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div className="text-xs font-bold text-slate-900">Highest Price</div>
            <div className="text-[11px] text-slate-500 font-medium mt-0.5 leading-snug">
              Competitive evaluation based on real Jammu market demand.
            </div>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 mb-2.5">
              <Clock className="h-4 w-4" />
            </div>
            <div className="text-xs font-bold text-slate-900">Doorstep Visit</div>
            <div className="text-[11px] text-slate-500 font-medium mt-0.5 leading-snug">
              Certified technician inspects at your home or office.
            </div>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-700 mb-2.5">
              <Banknote className="h-4 w-4" />
            </div>
            <div className="text-xs font-bold text-slate-900">Instant Payment</div>
            <div className="text-[11px] text-slate-500 font-medium mt-0.5 leading-snug">
              Direct instant bank transfer before vehicle handover.
            </div>
          </div>

          <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-700 mb-2.5">
              <FileCheck className="h-4 w-4" />
            </div>
            <div className="text-xs font-bold text-slate-900">Free RC Transfer</div>
            <div className="text-[11px] text-slate-500 font-medium mt-0.5 leading-snug">
              100% legal paperwork and RC transfer handled by AM Group.
            </div>
          </div>
        </div>

        {/* ================= FAQ SECTION ================= */}
        <div className="mt-10 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xs">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900 mb-4">
            Frequently Asked Questions
          </h3>

          <div className="space-y-4 text-xs">
            <div className="border-b border-slate-100 pb-3">
              <div className="font-bold text-slate-800">Is the doorstep inspection really 100% free?</div>
              <div className="text-slate-600 mt-1 leading-relaxed">
                Yes, absolutely. There are zero inspection fees, zero valuation charges, and no obligation to sell even after the engineer evaluates your vehicle.
              </div>
            </div>

            <div className="border-b border-slate-100 pb-3">
              <div className="font-bold text-slate-800">Which documents are required during evaluation?</div>
              <div className="text-slate-600 mt-1 leading-relaxed">
                Only the vehicle Registration Certificate (RC) and owner’s Aadhaar card/ID. Valid insurance and service records help fetch an even higher certified price.
              </div>
            </div>

            <div>
              <div className="font-bold text-slate-800">Can I exchange my old car for a brand new car?</div>
              <div className="text-slate-600 mt-1 leading-relaxed">
                Yes! AM Group operates authorized dealerships for Hyundai, Kia, Tata, and Honda across Jammu & Kashmir. You get additional exchange bonus benefits on new car purchases.
              </div>
            </div>
          </div>
        </div>

        {/* Micro Footer */}
        <div className="mt-8 text-center text-xs text-slate-400 font-medium">
          © {new Date().getFullYear()} AM Group Automotive • Jammu & Kashmir
        </div>
      </main>
    </div>
  )
}
