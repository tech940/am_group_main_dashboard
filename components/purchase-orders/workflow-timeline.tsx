'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  CheckCircle,
  XCircle,
  Clock,
  User,
  MessageSquare,
  Calendar,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface WorkflowHistoryItem {
  id: string
  action: string
  stage: string
  performedBy: string
  userRole: string
  remarks?: string | null
  previousStatus?: string | null
  newStatus?: string | null
  createdAt: string
  metadata?: Record<string, any>
}

interface WorkflowTimelineProps {
  history: WorkflowHistoryItem[]
  currentStatus: string
}

export function WorkflowTimeline({ history, currentStatus }: WorkflowTimelineProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const getActionIcon = (action: string) => {
    if (action.includes('approved') || action.includes('completed')) {
      return <CheckCircle className="h-5 w-5 text-green-500" />
    }
    if (action.includes('denied') || action.includes('rejected')) {
      return <XCircle className="h-5 w-5 text-red-500" />
    }
    return <Clock className="h-5 w-5 text-blue-500" />
  }

  const getActionColor = (action: string) => {
    if (action.includes('approved') || action.includes('completed')) {
      return 'bg-green-100 border-green-300'
    }
    if (action.includes('denied') || action.includes('rejected')) {
      return 'bg-red-100 border-red-300'
    }
    return 'bg-blue-100 border-blue-300'
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata'
    }).format(date)
  }

  const getRoleBadgeColor = (role: string) => {
    if (!role) return 'bg-gray-100 text-gray-800'
    switch (role.toLowerCase()) {
      case 'admin':
        return 'bg-purple-100 text-purple-800'
      case 'purchase_manager':
        return 'bg-blue-100 text-blue-800'
      case 'ea':
        return 'bg-green-100 text-green-800'
      case 'md':
        return 'bg-orange-100 text-orange-800'
      case 'accounts':
        return 'bg-teal-100 text-teal-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const formatRoleName = (role: string | undefined | null) => {
    if (!role) return 'Unknown'
    const roleMap: Record<string, string> = {
      'admin': 'Admin',
      'purchase_manager': 'Purchase Manager',
      'ea': 'EA',
      'md': 'MD',
      'accounts': 'Accounts',
      'manager': 'Manager',
      'viewer': 'User'
    }
    return roleMap[role.toLowerCase()] || role
  }

  return (
    <Card className="border-none shadow-xl">
      <CardHeader
        className="bg-gradient-to-r from-slate-700 to-slate-800 text-white cursor-pointer hover:from-slate-600 hover:to-slate-700 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <CardTitle className="text-xl font-black flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Workflow Timeline
          </div>
          {isExpanded ? (
            <ChevronUp className="h-5 w-5" />
          ) : (
            <ChevronDown className="h-5 w-5" />
          )}
        </CardTitle>
      </CardHeader>
      {isExpanded && (
      <CardContent className="p-6">
        {history.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <Clock className="h-12 w-12 mx-auto mb-3 text-slate-300" />
            <p>No workflow history yet</p>
          </div>
        ) : (
          <div className="space-y-4">
            {history.map((item, index) => (
              <div
                key={item.id}
                className={cn(
                  'relative pl-8 pb-4',
                  index !== history.length - 1 && 'border-l-2 border-slate-200'
                )}
              >
                {/* Timeline dot */}
                <div className="absolute left-0 top-0 -translate-x-1/2">
                  <div className={cn(
                    'rounded-full p-2 border-2',
                    getActionColor(item.action)
                  )}>
                    {getActionIcon(item.action)}
                  </div>
                </div>

                {/* Content */}
                <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-800 mb-1">
                        {item.action || 'Action'}
                      </h4>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge className={cn('text-xs', getRoleBadgeColor(item.userRole))}>
                          {formatRoleName(item.userRole)}
                        </Badge>
                        <span className="text-slate-600 flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {item.performedBy || 'System'}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(item.createdAt)}
                    </div>
                  </div>

                  {/* Status change */}
                  {item.previousStatus && item.newStatus && (
                    <div className="flex items-center gap-2 text-sm mb-2">
                      <Badge variant="outline" className="text-xs">
                        {item.previousStatus}
                      </Badge>
                      <span className="text-slate-400">→</span>
                      <Badge variant="outline" className="text-xs">
                        {item.newStatus}
                      </Badge>
                    </div>
                  )}

                  {/* Remarks */}
                  {item.remarks && (
                    <div className="mt-2 p-3 bg-slate-50 rounded-md border border-slate-200">
                      <div className="flex items-start gap-2">
                        <MessageSquare className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                        <p className="text-sm text-slate-700">{item.remarks}</p>
                      </div>
                    </div>
                  )}

                  {/* Stage info */}
                  <div className="mt-2 text-xs text-slate-500">
                    Stage: <span className="font-medium">{item.stage}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Current Status */}
        <div className="mt-6 p-4 bg-gradient-to-r from-teal-50 to-blue-50 rounded-lg border-2 border-teal-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600 mb-1">Current Status</p>
              <Badge className="bg-teal-500 text-white text-sm px-3 py-1">
                {currentStatus}
              </Badge>
            </div>
            <Clock className="h-8 w-8 text-teal-400" />
          </div>
        </div>
      </CardContent>
      )}
    </Card>
  )
}

// Made with Bob