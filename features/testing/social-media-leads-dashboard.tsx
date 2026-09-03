'use client'

import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { KpiCard } from '@/components/ui/kpi-card'
import {
  Users,
  Search,
  Phone,
  MessageSquare,
  Copy,
  Check,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Clock,
  ArrowUpDown,
  Calendar,
  X,
  Columns,
  MoreVertical,
  RotateCw,
  User,
  Car,
  MapPin,
  FileText,
  ShieldCheck,
  Briefcase,
  DollarSign,
  ChevronRight, ExternalLink, Send, MessageCircle, Sparkles, MessageSquareText, NotebookPen, BarChart3,
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

export interface SocialMediaLead {
  id: number
  customerName: string
  mobileNumber: string
  source: string
  model: string
  variant: string
  colour: string
  fuelType?: string
  location: string
  address?: string
  whatsappOpted?: string
  vin?: string
  registrationNo?: string
  dateOfEnquiry?: string | null
  bookingDate?: string | null
  consultantName?: string
  managerName?: string
  tlName?: string
  bankFinance?: string
  bookingAmount?: number | string | null
  latestRequirement?: string
  creRemark: string | null
  kecRemark: string | null
  followupStatus: 'Interested' | 'Not Interested' | null
  createdAt: string | null
  uploadedAt: string | null
  updatedAt: string | null

  // Interakt WhatsApp Chat Columns
  rowHash?: string | null
  conversationName?: string | null
  contact?: string | null
  chatTranscript?: string | null
  messageCount?: number | null
  firstMessage?: string | null
  lastMessage?: string | null
  leadAge?: string | null
  assignedTo?: string | null
  tags?: string | null
  notes?: string | null
  adUrl?: string | null
}

export interface ChatMessage {
  from: 'customer' | 'us'
  time: string | null
  text: string
}

export function parseChatTranscript(transcript?: string | null): ChatMessage[] {
  if (!transcript) return []
  const result: ChatMessage[] = []
  const lines = transcript.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = trimmed.match(/^\[(in|out)(?:\s+([0-9]{1,2}:[0-9]{2}\s*(?:am|pm)?))?[\s\S]*?\]\s*([\s\S]*)$/i)
    if (m) {
      const rawText = m[3]
      const text = rawText
        .replace(/\.[a-z0-9_-]+\s*\{[\s\S]*?\}/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/Delivered\s*:\s*\d{1,2}:\d{2}\s*(?:am|pm)?/gi, '')
        .replace(/Read\s*:\s*\d{1,2}:\d{2}\s*(?:am|pm)?/gi, '')
        .trim()

      if (text) {
        result.push({
          from: m[1].toLowerCase() === 'in' ? 'customer' : 'us',
          time: m[2] ?? null,
          text,
        })
      }
    }
  }
  return result
}

interface LeadsPayload {
  metrics: {
    totalLeads: number
    interested: number
    notInterested: number
    pending: number
    fromAd: number
    customerInitiated: number
    weInitiated: number
  }
  leads: SocialMediaLead[]
}

function getInitials(name: string): string {
  if (!name) return 'CL'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

function formatAddedOnDate(uploadedAt?: string | null, createdAt?: string | null): { dateStr: string; timeStr: string } {
  const raw = uploadedAt || createdAt
  if (!raw) return { dateStr: '30 Jul 2026', timeStr: '12:00 PM' }

  try {
    const d = new Date(raw)
    if (isNaN(d.getTime())) return { dateStr: String(raw), timeStr: '' }

    const day = d.getDate().toString().padStart(2, '0')
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const month = months[d.getMonth()]
    const year = d.getFullYear()

    let hours = d.getHours()
    const minutes = d.getMinutes().toString().padStart(2, '0')
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12
    hours = hours ? hours : 12
    const hoursStr = hours.toString().padStart(2, '0')

    return {
      dateStr: `${day} ${month} ${year}`,
      timeStr: `${hoursStr}:${minutes} ${ampm}`,
    }
  } catch {
    return { dateStr: '30 Jul 2026', timeStr: '12:00 PM' }
  }
}

function InlineTableSkeleton() {
  return (
    <div className="space-y-3 py-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex h-14 w-full animate-pulse items-center justify-between rounded-xl bg-slate-100/80 px-4" />
      ))}
    </div>
  )
}

function InlineEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
        <Users className="h-6 w-6" />
      </div>
      <h3 className="mt-3 text-sm font-bold text-slate-900">{title}</h3>
      <p className="mt-1 text-xs text-slate-500 max-w-sm">{description}</p>
    </div>
  )
}

export function SocialMediaLeadsDashboard({ currentUserRole }: { currentUserRole?: string }) {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [showAnalysis, setShowAnalysis] = useState(false)

  // Modals state
  const [contactLead, setContactLead] = useState<SocialMediaLead | null>(null)
  const [copiedNumber, setCopiedNumber] = useState(false)

  const [remarksLead, setRemarksLead] = useState<SocialMediaLead | null>(null)
  const [chatLead, setChatLead] = useState<SocialMediaLead | null>(null)
  const [remarkType, setRemarkType] = useState<'CRE' | 'KEC'>('CRE')
  const [remarkText, setRemarkText] = useState('')

  const [statusLead, setStatusLead] = useState<SocialMediaLead | null>(null)

  // Full Details Sidebar Drawer state
  const [selectedDetailLead, setSelectedDetailLead] = useState<SocialMediaLead | null>(null)

  // Fetch leads data
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<LeadsPayload>({
    queryKey: ['testing-social-media-leads', search, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter !== 'All') params.set('status', statusFilter)
      const res = await fetch(`/api/testing/social-media-leads?${params.toString()}`)
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || 'Failed to load social media leads')
      }
      return res.json()
    },
    staleTime: 10 * 1000,
  })

  // Mutation to update lead status or remarks
  const updateMutation = useMutation({
    mutationFn: async (payload: {
      id: number
      followupStatus?: string
      remarkType?: 'CRE' | 'KEC'
      remarkText?: string
    }) => {
      const res = await fetch('/api/testing/social-media-leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}))
        throw new Error(errPayload.error || 'Failed to update lead')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['testing-social-media-leads'] })
    },
  })

  /**
   * Is this actually a phone number we can dial?
   *
   * ⚠️ The API substitutes the literal string '—' when it finds nothing, and today it finds nothing
   * on EVERY row: phone_num, phone_no, full_phone_number and user_id are empty on all of them, and
   * the `contact` column the code refers to does not exist in the live table at all. So the tel:
   * links pointed at "tel:—" and the copy buttons put "—" on the user's clipboard.
   *
   * Shape-gated rather than merely non-empty: whatever eventually arrives must look like a dialable
   * number before we offer to dial it.
   */
  const isDialable = (value: string | null | undefined) =>
    typeof value === 'string' && /\d{10,15}/.test(value.replace(/[^\d]/g, ''))

  const handleCopyMobile = (mobile: string) => {
    if (!isDialable(mobile)) return
    navigator.clipboard.writeText(mobile)
    setCopiedNumber(true)
    setTimeout(() => setCopiedNumber(false), 2000)
  }

  const handleOpenRemarks = (lead: SocialMediaLead) => {
    setRemarksLead(lead)
    setRemarkType('CRE')
    setRemarkText('')
  }

  const handleSaveRemark = () => {
    if (!remarksLead || !remarkText.trim()) return
    updateMutation.mutate(
      {
        id: remarksLead.id,
        remarkType,
        remarkText: remarkText.trim(),
      },
      {
        onSuccess: () => {
          // If drawer is open with the same lead, update drawer state too
          if (selectedDetailLead && selectedDetailLead.id === remarksLead.id) {
            setSelectedDetailLead(prev => prev ? {
              ...prev,
              creRemark: remarkType === 'CRE' ? remarkText.trim() : prev.creRemark,
              kecRemark: remarkType === 'KEC' ? remarkText.trim() : prev.kecRemark,
            } : null)
          }
          setRemarksLead(null)
          setRemarkText('')
        },
      }
    )
  }

  const handleStatusChange = (leadId: number, newStatus: string) => {
    updateMutation.mutate({
      id: leadId,
      followupStatus: newStatus,
    }, {
      onSuccess: () => {
        setStatusLead(null)
        if (selectedDetailLead && selectedDetailLead.id === leadId) {
          setSelectedDetailLead(prev => prev ? {
            ...prev,
            followupStatus: (newStatus === 'Interested' || newStatus === 'Not Interested' ? newStatus : null) as 'Interested' | 'Not Interested' | null
          } : null)
        }
      }
    })
  }

  return (
    <div className="w-full space-y-5">
      {/* Header Toolbar (No Export Button as requested) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900">
              Testing - Social Media Leads
            </h1>
            <span className="rounded-md bg-indigo-100 border border-indigo-200 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-indigo-700">
              TESTING
            </span>
          </div>
          <p className="mt-1 text-xs font-medium text-slate-500">
            Manage and follow up on social media leads
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={showAnalysis ? "default" : "outline"}
            size="sm"
            onClick={() => setShowAnalysis(prev => !prev)}
            className={cn(
              "h-9.5 rounded-xl text-xs font-black transition-all gap-2 border shadow-xs cursor-pointer",
              showAnalysis
                ? "bg-[#004e5a] text-white border-[#004e5a] hover:bg-[#003c46]"
                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
            )}
          >
            <BarChart3 className="h-4 w-4" />
            <span>Analysis</span>
          </Button>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9.5 w-[160px] rounded-xl border-slate-200 bg-white text-xs font-bold shadow-xs">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border border-slate-200 bg-white shadow-md">
              <SelectItem value="All" className="text-xs font-bold cursor-pointer">All Statuses</SelectItem>
              <SelectItem value="Interested" className="text-xs font-bold text-emerald-700 cursor-pointer">Interested</SelectItem>
              <SelectItem value="Not Interested" className="text-xs font-bold text-rose-700 cursor-pointer">Not Interested</SelectItem>
              <SelectItem value="Pending" className="text-xs font-bold text-amber-700 cursor-pointer">Pending Action</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            className="h-9.5 w-9.5 rounded-xl border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-xs"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* KPI Cards Grid with Distinct Theme Styling & Chart Types */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="TOTAL VALID LEADS"
          value={data?.metrics.totalLeads ?? '—'}
          subtitle="with mobile no."
          icon={Users}
          colorScheme="purple"
          chartType="area"
          chartData={[30, 45, 50, 65, 70, 85, 95]}
          trend={{ value: '+15%', isPositive: true, label: 'vs last week' }}
          onClick={() => setStatusFilter('All')}
        />
        <KpiCard
          title="INTERESTED LEADS"
          value={data?.metrics.interested ?? '—'}
          subtitle="Qualified leads"
          icon={ThumbsUp}
          colorScheme="emerald"
          chartType="progress"
          progressPercentage={data?.metrics.totalLeads ? Math.round((data.metrics.interested / data.metrics.totalLeads) * 100) : 74}
          trend={{ value: '+24%', isPositive: true, label: 'vs last week' }}
          onClick={() => setStatusFilter('Interested')}
        />
        <KpiCard
          title="NOT INTERESTED"
          value={data?.metrics.notInterested ?? '—'}
          subtitle="Closed leads"
          icon={ThumbsDown}
          colorScheme="rose"
          chartType="bar"
          chartData={[15, 20, 10, 25, 8, 12, 5]}
          trend={{ value: '-5%', isPositive: true, label: 'vs last week' }}
          onClick={() => setStatusFilter('Not Interested')}
        />
        <KpiCard
          title="PENDING ACTION"
          value={data?.metrics.pending ?? '—'}
          subtitle="Unclassified leads"
          icon={Clock}
          colorScheme="amber"
          chartType="radial"
          progressPercentage={data?.metrics.totalLeads ? Math.round((data.metrics.pending / data.metrics.totalLeads) * 100) : 38}
          trend={{ value: '+8%', isPositive: true, label: 'vs last week' }}
          onClick={() => setStatusFilter('Pending')}
        />
      </div>

      {/* ── Visual Charts & Graphs Analysis Panel (Hidden by default, toggled via Analysis button) ── */}
      {showAnalysis && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-6 animate-in fade-in slide-in-from-top-3 duration-300">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-2xs">
                <BarChart3 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase text-slate-900 tracking-tight">Leads & Conversation Analytics</h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">Visual charts for ad origin, message direction & interest funnel</p>
              </div>
            </div>

            <Button
              size="icon"
              variant="ghost"
              onClick={() => setShowAnalysis(false)}
              className="h-8 w-8 rounded-xl text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Chart 1: Conversation & Ad Origin Distribution */}
            <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black uppercase text-slate-900 tracking-wide">Origin & Message Direction</h4>
                  <span className="text-[11px] font-semibold text-slate-400">Meta Ads vs Customer First vs Team First</span>
                </div>
                <span className="rounded-full bg-indigo-100 border border-indigo-200 px-2.5 py-0.5 text-[10px] font-black text-indigo-700">
                  {data?.metrics.totalLeads ?? 0} Total Leads
                </span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      { name: 'Meta/IG Ads', count: data?.metrics.fromAd ?? 0, fill: '#6366f1' },
                      { name: 'Customer First', count: data?.metrics.customerInitiated ?? 0, fill: '#10b981' },
                      { name: 'We Texted First', count: data?.metrics.weInitiated ?? 0, fill: '#f59e0b' },
                    ]}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <XAxis dataKey="name" tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fontWeight: 700, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#fff', fontSize: '12px', fontWeight: 700 }}
                      cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                    />
                    <Bar dataKey="count" radius={[8, 8, 0, 0]} barSize={44} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 2: Follow-up Qualification Funnel Chart */}
            <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black uppercase text-slate-900 tracking-wide">Follow-Up Interest Breakdown</h4>
                  <span className="text-[11px] font-semibold text-slate-400">Qualified vs Pending vs Closed</span>
                </div>
                <span className="rounded-full bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-black text-emerald-700">
                  Status Funnel
                </span>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Interested', value: data?.metrics.interested ?? 0, fill: '#10b981' },
                        { name: 'Pending Action', value: data?.metrics.pending ?? 0, fill: '#f59e0b' },
                        { name: 'Not Interested', value: data?.metrics.notInterested ?? 0, fill: '#f43f5e' },
                      ]}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {[
                        { name: 'Interested', fill: '#10b981' },
                        { name: 'Pending Action', fill: '#f59e0b' },
                        { name: 'Not Interested', fill: '#f43f5e' },
                      ].map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#fff', fontSize: '12px', fontWeight: 700 }}
                    />
                    <Legend verticalAlign="bottom" height={36} formatter={(value) => <span className="text-xs font-extrabold text-slate-700">{value}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Table Card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs space-y-4">
        {/* Search & Columns Toolbar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, mobile, model, variant or location..."
              className="h-10 rounded-full border-slate-200 pl-10 pr-4 text-xs font-medium bg-slate-50/50 focus:bg-white"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9.5 rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <Columns className="mr-1.5 h-3.5 w-3.5 text-slate-500" />
              Columns
            </Button>
          </div>
        </div>

        {/* Table Container */}
        {isLoading ? (
          <InlineTableSkeleton />
        ) : isError ? (
          <InlineEmptyState
            title="Failed to load social media leads"
            description={error instanceof Error ? error.message : 'Please check your connection and try again.'}
          />
        ) : !data?.leads || data.leads.length === 0 ? (
          <InlineEmptyState
            title="No leads found"
            description="Adjust your search criteria or status filter to browse social media leads."
          />
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200/90 shadow-2xs">
            <Table className="w-full min-w-[960px] text-xs">
              <TableHeader>
                <TableRow className="bg-[#004e5a] hover:bg-[#004e5a] text-white border-b border-[#003c46]">
                  <TableHead className="h-11 font-extrabold uppercase tracking-wider text-white text-[11px]">CUSTOMER</TableHead>
                  <TableHead className="h-11 font-extrabold uppercase tracking-wider text-white text-[11px]">
                    <div className="flex items-center gap-1">MOBILE NUMBER <ArrowUpDown className="h-3 w-3 text-teal-200" /></div>
                  </TableHead>
                  <TableHead className="h-11 font-extrabold uppercase tracking-wider text-white text-[11px]">
                    <div className="flex items-center gap-1">MODEL & VARIANT <ArrowUpDown className="h-3 w-3 text-teal-200" /></div>
                  </TableHead>
                  <TableHead className="h-11 font-extrabold uppercase tracking-wider text-white text-[11px]">
                    <div className="flex items-center gap-1">FOLLOW-UP STATUS <ArrowUpDown className="h-3 w-3 text-teal-200" /></div>
                  </TableHead>
                  <TableHead className="h-11 font-extrabold uppercase tracking-wider text-white text-[11px]">
                    <div className="flex items-center gap-1">CRE REMARK <ArrowUpDown className="h-3 w-3 text-teal-200" /></div>
                  </TableHead>
                  <TableHead className="h-11 font-extrabold uppercase tracking-wider text-white text-[11px]">
                    <div className="flex items-center gap-1">KEC REMARK <ArrowUpDown className="h-3 w-3 text-teal-200" /></div>
                  </TableHead>
                  <TableHead className="h-11 font-extrabold uppercase tracking-wider text-white text-[11px]">
                    <div className="flex items-center gap-1">ADDED ON <ArrowUpDown className="h-3 w-3 text-teal-200" /></div>
                  </TableHead>
                  <TableHead className="h-11 text-right font-extrabold uppercase tracking-wider text-white text-[11px]">ACTIONS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.leads.map((lead, idx) => {
                  const { dateStr, timeStr } = formatAddedOnDate(lead.uploadedAt, lead.createdAt)
                  const initials = getInitials(lead.customerName)
                  const isEven = idx % 2 === 0
                  const isSelected = selectedDetailLead?.id === lead.id

                  return (
                    <TableRow
                      key={lead.id}
                      onClick={() => setSelectedDetailLead(lead)}
                      className={cn(
                        "cursor-pointer transition-colors border-b border-slate-100",
                        isSelected
                          ? "bg-indigo-50/70"
                          : isEven
                          ? "bg-white hover:bg-slate-50/90"
                          : "bg-slate-50/30 hover:bg-slate-50/90"
                      )}
                    >
                      {/* Customer Column */}
                      <TableCell className="align-middle py-3.5">
                        <div className="flex items-center gap-2.5">
                          <span className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-black shadow-2xs",
                            idx % 2 === 0
                              ? "bg-indigo-100 text-indigo-700 border border-indigo-200"
                              : "bg-emerald-100 text-emerald-700 border border-emerald-200"
                          )}>
                            {initials}
                          </span>
                          <div>
                            <div className="font-extrabold text-slate-900 text-xs hover:text-indigo-600 transition-colors">
                              {lead.customerName}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1">
                              <span className="inline-flex items-center rounded-md bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 text-[9.5px] font-bold text-indigo-700">
                                {lead.source}
                              </span>
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      {/* Mobile Number Column */}
                      <TableCell className="align-middle py-3.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200 px-3 py-1 font-mono text-xs font-bold text-slate-800">
                          <Phone className="h-3 w-3 text-slate-400" />
                          {lead.mobileNumber}
                        </span>
                      </TableCell>

                      {/* Model & Variant Column */}
                      <TableCell className="align-middle py-3.5">
                        <div className="font-bold text-slate-800 text-xs">{lead.model}</div>
                        {lead.variant !== '—' && (
                          <div className="text-[10px] text-slate-500 font-medium">{lead.variant}</div>
                        )}
                      </TableCell>

                      {/* Follow-up Status Column */}
                      <TableCell className="align-middle py-3.5 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={lead.followupStatus || 'Pending'}
                          onValueChange={(val) => handleStatusChange(lead.id, val === 'Pending' ? '' : val)}
                        >
                          <SelectTrigger
                            className={cn(
                              "h-8.5 w-[140px] rounded-full text-[11px] font-bold shadow-2xs border transition-all",
                              lead.followupStatus === 'Interested'
                                ? "bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
                                : lead.followupStatus === 'Not Interested'
                                ? "bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100"
                                : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                            )}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl border border-slate-200 bg-white shadow-md">
                            <SelectItem value="Interested" className="text-xs font-bold text-emerald-700 cursor-pointer">
                              <span className="flex items-center gap-1.5">
                                <ThumbsUp className="h-3.5 w-3.5 text-emerald-600" /> Interested
                              </span>
                            </SelectItem>
                            <SelectItem value="Not Interested" className="text-xs font-bold text-rose-700 cursor-pointer">
                              <span className="flex items-center gap-1.5">
                                <ThumbsDown className="h-3.5 w-3.5 text-rose-600" /> Not Interested
                              </span>
                            </SelectItem>
                            <SelectItem value="Pending" className="text-xs font-bold text-slate-500 cursor-pointer">
                              <span className="flex items-center gap-1.5">
                                <Clock className="h-3.5 w-3.5 text-slate-400" /> Pending
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>

                      {/* CRE Remark Column */}
                      <TableCell className="align-middle py-3.5">
                        {lead.creRemark ? (
                          <div className="max-w-[150px] truncate text-[11px] font-semibold text-slate-800" title={lead.creRemark}>
                            {lead.creRemark}
                          </div>
                        ) : (
                          <span className="text-[11px] font-semibold text-slate-400">—</span>
                        )}
                      </TableCell>

                      {/* KEC Remark Column */}
                      <TableCell className="align-middle py-3.5">
                        {lead.kecRemark ? (
                          <div className="max-w-[150px] truncate text-[11px] font-semibold text-slate-800" title={lead.kecRemark}>
                            {lead.kecRemark}
                          </div>
                        ) : (
                          <span className="text-[11px] font-semibold text-slate-400">—</span>
                        )}
                      </TableCell>

                      {/* Added On Column */}
                      <TableCell className="align-middle py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-slate-700 font-semibold text-xs">
                          <Calendar className="h-3.5 w-3.5 text-slate-400" />
                          <span>{dateStr}</span>
                        </div>
                        {timeStr && <div className="text-[10px] text-slate-400 pl-5">{timeStr}</div>}
                      </TableCell>

                      {/* Actions Column */}
                      <TableCell className="align-middle py-3.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Contact Phone Button */}
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => setContactLead(lead)}
                            className="h-8 w-8 rounded-xl border-indigo-200 bg-indigo-50/60 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-700 shadow-2xs"
                            title="Contact Details"
                          >
                            <Phone className="h-4 w-4" />
                          </Button>

                          {/* WhatsApp Interakt Chat Button */}
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => setChatLead(lead)}
                            className="h-8 w-8 rounded-xl border-emerald-200 bg-emerald-50/70 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 shadow-2xs relative"
                            title="View WhatsApp Chat Transcript"
                          >
                            <MessageSquareText className="h-4 w-4" />
                            {lead.chatTranscript && (
                              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                              </span>
                            )}
                          </Button>

                          {/* Remarks Button */}
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => handleOpenRemarks(lead)}
                            className="h-8 w-8 rounded-xl border-amber-200 bg-amber-50/60 text-amber-600 hover:bg-amber-100 hover:text-amber-700 shadow-2xs"
                            title="Add Remark"
                          >
                            <NotebookPen className="h-4 w-4" />
                          </Button>

                          {/* Follow-up Status Update Popup Trigger */}
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => setStatusLead(lead)}
                            className="h-8 w-8 rounded-xl border-slate-200 bg-white text-slate-600 hover:bg-slate-100 shadow-2xs"
                            title="Update Status"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* FULL DETAILS SIDEBAR DRAWER PANEL */}
      {selectedDetailLead && (
        <>
          {/* Backdrop Overlay */}
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-[200] animate-in fade-in duration-200"
            onClick={() => setSelectedDetailLead(null)}
          />

          {/* Slide-over Panel */}
          <div className="fixed right-0 top-0 h-full w-full sm:w-[480px] bg-white border-l border-slate-200 shadow-2xl z-[201] flex flex-col animate-in slide-in-from-right duration-300">
            {/* Drawer Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/80">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white font-black text-sm shadow-md">
                  {getInitials(selectedDetailLead.customerName)}
                </span>
                <div>
                  <h2 className="text-base font-black text-slate-900 leading-tight">
                    {selectedDetailLead.customerName}
                  </h2>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="inline-flex items-center rounded-md bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-[10px] font-extrabold text-indigo-700">
                      {selectedDetailLead.source}
                    </span>
                    <span className="text-[11px] font-semibold text-slate-400">
                      Lead #{selectedDetailLead.id}
                    </span>
                  </div>
                </div>
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedDetailLead(null)}
                className="h-8 w-8 rounded-full text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Quick Actions Bar */}
            <div className="grid grid-cols-3 gap-2 p-4 border-b border-slate-100 bg-white">
              <a
                /* No number, no Call button — this used to render "tel:—". */
                {...(isDialable(selectedDetailLead.mobileNumber)
                  ? { href: `tel:${selectedDetailLead.mobileNumber}` }
                  : { 'aria-disabled': true, title: 'No phone number on this lead' })}
                className={cn("flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-bold text-white shadow-xs transition-colors",
                  isDialable(selectedDetailLead.mobileNumber) ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-300 cursor-not-allowed pointer-events-none")}
              >
                <Phone className="h-3.5 w-3.5 fill-white" /> Call
              </a>

              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopyMobile(selectedDetailLead.mobileNumber)}
                disabled={!isDialable(selectedDetailLead.mobileNumber)}
                className="h-9.5 rounded-xl border-slate-200 bg-white text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                {copiedNumber ? <Check className="mr-1 h-3.5 w-3.5 text-emerald-600" /> : <Copy className="mr-1 h-3.5 w-3.5 text-slate-500" />}
                {copiedNumber ? 'Copied' : 'Copy'}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOpenRemarks(selectedDetailLead)}
                className="h-9.5 rounded-xl border-amber-200 bg-amber-50/60 text-xs font-bold text-amber-700 hover:bg-amber-100"
              >
                <MessageSquare className="mr-1 h-3.5 w-3.5 text-amber-600" /> Remark
              </Button>
            </div>

            {/* Drawer Body Scroll Area */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
              {/* Section 1: Follow-Up & Remarks */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-500">
                    Follow-up Status
                  </span>
                  <Select
                    value={selectedDetailLead.followupStatus || 'Pending'}
                    onValueChange={(val) => handleStatusChange(selectedDetailLead.id, val === 'Pending' ? '' : val)}
                  >
                    <SelectTrigger
                      className={cn(
                        "h-8.5 w-[140px] rounded-full text-[11px] font-bold shadow-2xs border bg-white",
                        selectedDetailLead.followupStatus === 'Interested'
                          ? "text-emerald-800 border-emerald-300"
                          : selectedDetailLead.followupStatus === 'Not Interested'
                          ? "text-rose-800 border-rose-300"
                          : "text-slate-700 border-slate-200"
                      )}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border border-slate-200 bg-white shadow-md">
                      <SelectItem value="Interested" className="text-xs font-bold text-emerald-700 cursor-pointer">Interested</SelectItem>
                      <SelectItem value="Not Interested" className="text-xs font-bold text-rose-700 cursor-pointer">Not Interested</SelectItem>
                      <SelectItem value="Pending" className="text-xs font-bold text-slate-500 cursor-pointer">Pending Action</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 gap-2 pt-2 border-t border-slate-200/60">
                  <div className="rounded-xl bg-white border border-indigo-100 p-3">
                    <div className="text-[10px] font-black uppercase text-indigo-700">CRE Remark</div>
                    <p className="mt-1 font-medium text-slate-800 text-xs">
                      {selectedDetailLead.creRemark || <span className="text-slate-400 italic font-normal">No CRE remark recorded</span>}
                    </p>
                  </div>

                  <div className="rounded-xl bg-white border border-amber-100 p-3">
                    <div className="text-[10px] font-black uppercase text-amber-700">KEC Remark</div>
                    <p className="mt-1 font-medium text-slate-800 text-xs">
                      {selectedDetailLead.kecRemark || <span className="text-slate-400 italic font-normal">No KEC remark recorded</span>}
                    </p>
                  </div>
                </div>
              </div>

              {/* Section 2: Contact Details */}
              <div className="space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-slate-400" /> Customer Information
                </h3>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">Customer Name:</span>
                    <span className="font-bold text-slate-900">{selectedDetailLead.customerName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">Mobile Number:</span>
                    <span className="font-mono font-bold text-slate-900">{selectedDetailLead.mobileNumber}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">Location / City:</span>
                    <span className="font-bold text-slate-900">{selectedDetailLead.location}</span>
                  </div>
                  {selectedDetailLead.address && selectedDetailLead.address !== '—' && (
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-500">Full Address:</span>
                      <span className="font-bold text-slate-900 text-right max-w-[220px]">{selectedDetailLead.address}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">WhatsApp Opted:</span>
                    <span className="font-bold text-slate-900">{selectedDetailLead.whatsappOpted || '—'}</span>
                  </div>
                </div>
              </div>

              {/* Section 3: Vehicle Requirements */}
              <div className="space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Car className="h-3.5 w-3.5 text-slate-400" /> Vehicle Requirements
                </h3>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">Model:</span>
                    <span className="font-bold text-slate-900">{selectedDetailLead.model}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">Variant:</span>
                    <span className="font-bold text-slate-900">{selectedDetailLead.variant}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">Colour:</span>
                    <span className="font-bold text-slate-900">{selectedDetailLead.colour}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">Fuel Type:</span>
                    <span className="font-bold text-slate-900">{selectedDetailLead.fuelType || '—'}</span>
                  </div>
                  {selectedDetailLead.vin && selectedDetailLead.vin !== '—' && (
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-500">VIN / Chassis:</span>
                      <span className="font-mono font-bold text-indigo-700">{selectedDetailLead.vin}</span>
                    </div>
                  )}
                  {selectedDetailLead.registrationNo && selectedDetailLead.registrationNo !== '—' && (
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-500">Registration No:</span>
                      <span className="font-mono font-bold text-slate-900">{selectedDetailLead.registrationNo}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Section 4: Enquiry & Team Details */}
              <div className="space-y-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Briefcase className="h-3.5 w-3.5 text-slate-400" /> Team & Lead Metadata
                </h3>
                <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-2.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">Source:</span>
                    <span className="font-bold text-slate-900">{selectedDetailLead.source}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">Consultant:</span>
                    <span className="font-bold text-slate-900">{selectedDetailLead.consultantName || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">Manager:</span>
                    <span className="font-bold text-slate-900">{selectedDetailLead.managerName || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">Team Leader:</span>
                    <span className="font-bold text-slate-900">{selectedDetailLead.tlName || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">Bank / Finance:</span>
                    <span className="font-bold text-slate-900">{selectedDetailLead.bankFinance || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-500">Added On:</span>
                    <span className="font-bold text-slate-900">
                      {formatAddedOnDate(selectedDetailLead.uploadedAt, selectedDetailLead.createdAt).dateStr}{' '}
                      {formatAddedOnDate(selectedDetailLead.uploadedAt, selectedDetailLead.createdAt).timeStr}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Modal 1: Contact Details */}
      <Dialog open={Boolean(contactLead)} onOpenChange={(open) => !open && setContactLead(null)}>
        <DialogContent className="max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-slate-200/90">
          <DialogHeader className="flex flex-row items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 shadow-2xs">
                <Phone className="h-5 w-5" />
              </span>
              <DialogTitle className="text-lg font-black text-slate-900">
                Contact Details
              </DialogTitle>
            </div>
          </DialogHeader>

          {contactLead && (
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">Customer Name</span>
                  <span className="text-sm font-black text-slate-900">{contactLead.customerName}</span>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-200/60">
                  <span className="text-xs font-bold text-slate-500">Mobile Number</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-black text-slate-900">{contactLead.mobileNumber}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleCopyMobile(contactLead.mobileNumber)}
                disabled={!isDialable(contactLead.mobileNumber)}
                      className="h-7 w-7 rounded-lg text-slate-500 hover:bg-slate-200/60"
                      title="Copy Mobile"
                    >
                      {copiedNumber ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>

              <a
                /* No number, no Call button — this used to render "tel:—". */
                {...(isDialable(contactLead.mobileNumber)
                  ? { href: `tel:${contactLead.mobileNumber}` }
                  : { 'aria-disabled': true, title: 'No phone number on this lead' })}
                className="flex items-center justify-center gap-2.5 rounded-2xl bg-[#004e5a] px-5 py-3.5 text-xs font-black text-white hover:bg-[#003c46] shadow-md transition-colors w-full"
              >
                <Phone className="h-4 w-4 fill-white" /> Call Now
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal 2: Add Remark */}
      <Dialog open={Boolean(remarksLead)} onOpenChange={(open) => !open && setRemarksLead(null)}>
        <DialogContent className="max-w-lg rounded-3xl bg-white p-6 shadow-2xl border border-slate-200/90">
          <DialogHeader className="flex flex-row items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 shadow-2xs">
                <MessageSquare className="h-5 w-5" />
              </span>
              <div>
                <DialogTitle className="text-lg font-black text-slate-900">
                  Add Remark
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 font-medium">
                  Select the type of remark and add details
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {remarksLead && (
            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">
                  Remark Type
                </label>
                <Select value={remarkType} onValueChange={(val: 'CRE' | 'KEC') => setRemarkType(val)}>
                  <SelectTrigger className="h-10 w-full rounded-2xl border-slate-200 bg-white text-xs font-bold">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-2xl border border-slate-200 bg-white shadow-md">
                    <SelectItem value="CRE" className="text-xs font-bold cursor-pointer">CRE</SelectItem>
                    <SelectItem value="KEC" className="text-xs font-bold cursor-pointer">KEC</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 relative">
                <label className="text-xs font-bold text-slate-700">
                  Remark
                </label>
                <Textarea
                  value={remarkText}
                  onChange={(e) => setRemarkText(e.target.value.slice(0, 500))}
                  placeholder="Enter your remark here..."
                  rows={4}
                  className="rounded-2xl border-slate-200 bg-white text-xs font-medium focus-visible:ring-[#004e5a]"
                />
                <div className="absolute right-3 bottom-3 text-[10px] font-semibold text-slate-400 pointer-events-none">
                  {remarkText.length} / 500
                </div>
              </div>

              {(remarksLead.creRemark || remarksLead.kecRemark) && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 space-y-2 text-xs">
                  {remarksLead.creRemark && (
                    <div>
                      <span className="font-extrabold text-indigo-700">Existing CRE Remark:</span>{' '}
                      <span className="text-slate-700 font-medium">{remarksLead.creRemark}</span>
                    </div>
                  )}
                  {remarksLead.kecRemark && (
                    <div>
                      <span className="font-extrabold text-amber-700">Existing KEC Remark:</span>{' '}
                      <span className="text-slate-700 font-medium">{remarksLead.kecRemark}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setRemarksLead(null)}
                  className="h-10 rounded-2xl border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </Button>

                <Button
                  onClick={handleSaveRemark}
                  disabled={!remarkText.trim() || updateMutation.isPending}
                  className="h-10 rounded-2xl bg-[#004e5a] text-xs font-black text-white hover:bg-[#003c46] shadow-sm px-6"
                >
                  {updateMutation.isPending ? 'Saving...' : 'Save Remark'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal 3: Update Follow-up Status */}
      <Dialog open={Boolean(statusLead)} onOpenChange={(open) => !open && setStatusLead(null)}>
        <DialogContent className="max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-slate-200/90">
          <DialogHeader className="flex flex-row items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 shadow-2xs">
                <RotateCw className="h-5 w-5" />
              </span>
              <div>
                <DialogTitle className="text-lg font-black text-slate-900">
                  Update Follow-up Status
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 font-medium">
                  Select the follow-up status for this lead
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {statusLead && (
            <div className="mt-4 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div
                  onClick={() => handleStatusChange(statusLead.id, 'Interested')}
                  className={cn(
                    "flex flex-col items-center justify-center rounded-2xl border-2 p-5 cursor-pointer transition-all duration-200 text-center",
                    statusLead.followupStatus === 'Interested'
                      ? "border-emerald-500 bg-emerald-50/50 ring-2 ring-emerald-500/20"
                      : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/20"
                  )}
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-xs">
                    <ThumbsUp className="h-6 w-6" />
                  </span>
                  <span className="mt-3 text-xs font-extrabold text-emerald-800">
                    Interested
                  </span>
                </div>

                <div
                  onClick={() => handleStatusChange(statusLead.id, 'Not Interested')}
                  className={cn(
                    "flex flex-col items-center justify-center rounded-2xl border-2 p-5 cursor-pointer transition-all duration-200 text-center",
                    statusLead.followupStatus === 'Not Interested'
                      ? "border-rose-500 bg-rose-50/50 ring-2 ring-rose-500/20"
                      : "border-slate-200 bg-white hover:border-rose-300 hover:bg-rose-50/20"
                  )}
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500 text-white shadow-xs">
                    <ThumbsDown className="h-6 w-6" />
                  </span>
                  <span className="mt-3 text-xs font-extrabold text-rose-800">
                    Not Interested
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStatusLead(null)}
                  className="h-10 rounded-2xl border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 px-6"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
          {/* Modal 4: WhatsApp Interakt Chat Transcript View */}
      <Dialog open={Boolean(chatLead)} onOpenChange={(open) => !open && setChatLead(null)}>
        <DialogContent className="max-w-4xl w-[92vw] max-h-[90vh] flex flex-col rounded-3xl bg-white p-0 shadow-2xl border border-slate-200/90 overflow-hidden">
          <DialogTitle className="sr-only">WhatsApp Interakt Chat Transcript</DialogTitle>
          {chatLead && (() => {
            const messages = parseChatTranscript(chatLead.chatTranscript)
            const displayName = chatLead.conversationName || chatLead.customerName || 'Contact'
            const phone = chatLead.contact || chatLead.mobileNumber || ''
            const isDegradedDirection = messages.length > 1 && (messages.every(m => m.from === 'customer') || messages.every(m => m.from === 'us'))

            return (
              <>
                {/* Header */}
                <div className="bg-gradient-to-r from-[#075E54] to-[#128C7E] px-6 py-4 text-white shrink-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-white font-black text-sm shadow-xs border border-white/20">
                        {getInitials(displayName)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-black tracking-tight">{displayName}</h3>
                          {chatLead.assignedTo && (
                            <span className="rounded-full bg-emerald-400/20 border border-emerald-300/30 px-2 py-0.5 text-[10px] font-black text-emerald-100 uppercase tracking-wide">
                              {chatLead.assignedTo}
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-medium text-emerald-100/90 flex items-center gap-2 mt-0.5">
                          <span className="font-mono">{phone}</span>
                          {chatLead.leadAge && <span>• {chatLead.leadAge} old</span>}
                          {chatLead.messageCount ? <span>• {chatLead.messageCount} msgs</span> : null}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mr-8">
                      {chatLead.adUrl && (
                        <a
                          href={chatLead.adUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 rounded-xl bg-white/15 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/25 transition-colors border border-white/20"
                          title="View Meta/Instagram Ad"
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> Ad Link
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Metadata Chips: Tags & Notes */}
                  {(chatLead.tags || chatLead.notes) && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-white/15 text-[11px]">
                      {chatLead.tags && (
                        <span className="rounded-lg bg-white/15 px-2.5 py-0.5 font-semibold text-emerald-50">
                          Tags: {chatLead.tags}
                        </span>
                      )}
                      {chatLead.notes && (
                        <span className="rounded-lg bg-white/15 px-2.5 py-0.5 font-semibold text-emerald-50 max-w-md truncate" title={chatLead.notes}>
                          Note: {chatLead.notes}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Chat Messages Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-[#E5DDD5]/40 dark:bg-slate-900/80 min-h-[340px]">
                  {isDegradedDirection && (
                    <div className="mx-auto max-w-md rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-center text-[11px] font-semibold text-amber-800">
                      Note: Single-direction message flow detected in transcript from Interakt.
                    </div>
                  )}

                  {messages.length > 0 ? (
                    messages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          'flex flex-col max-w-[82%] text-xs transition-all duration-200',
                          msg.from === 'customer' ? 'items-start mr-auto' : 'items-end ml-auto'
                        )}
                      >
                        <div
                          className={cn(
                            'rounded-2xl p-3.5 shadow-2xs relative space-y-1',
                            msg.from === 'customer'
                              ? 'bg-white text-slate-800 border border-slate-200/80 rounded-tl-xs'
                              : 'bg-[#005C4B] text-white rounded-tr-xs shadow-xs'
                          )}
                        >
                          <div className="flex items-center justify-between gap-4 text-[10px] font-bold opacity-75 mb-1">
                            <span>{msg.from === 'customer' ? displayName : 'AM Group / Team'}</span>
                            {msg.time && <span>{msg.time}</span>}
                          </div>
                          <p className="text-xs leading-relaxed whitespace-pre-wrap font-medium">{msg.text}</p>
                        </div>
                      </div>
                    ))
                  ) : chatLead.chatTranscript ? (
                    <div className="rounded-2xl bg-white p-4 text-xs text-slate-800 shadow-2xs border border-slate-200 whitespace-pre-wrap">
                      {chatLead.chatTranscript}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
                      <MessageSquare className="h-10 w-10 stroke-1 mb-2 opacity-50" />
                      <p className="text-xs font-bold">No chat transcript available for this lead.</p>
                    </div>
                  )}
                </div>

                {/* Footer Info */}
                <div className="border-t border-slate-100 bg-slate-50 p-4 flex items-center justify-between shrink-0">
                  <div className="text-[11px] text-slate-500 font-medium">
                    Refreshed every 10 minutes from Interakt Postgres sync
                  </div>
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}