/** The HockeyPoolCap API's trades, as its /api/v1/admin/trades endpoints answer (TradeViews.Admin*) */

export type TradeStatus =
  | 'ARTICLE_READY'
  | 'CAP_VALIDATED'
  | 'COMPLETED'
  | 'DATA_APPLIED'
  | 'DETECTED'
  | 'FAILED'
  | 'NEEDS_REVIEW'
  | 'NOTIFICATION_QUEUED'
  | 'PUBLISHED'
  | 'REVERTED'
  | 'VERIFIED'

export type TradeSummary = {
  articleStatus: null | string
  attempts: number
  correlationId: string
  detectedAt: string
  headline: string
  id: number
  lastError: null | string
  madeOn: string
  nextAttemptAt: null | string
  origin: 'ADMIN' | 'TRACKER'
  reviewReason: null | string
  status: TradeStatus
  teams: string[]
  tradeKey: string
  updatedAt: string
}

export type TradeAsset = {
  applied: boolean
  conditional: boolean
  conditions: null | string
  confidence: 'CONFIRMED' | 'INFERRED' | 'UNRESOLVED'
  description: string
  from: string
  id: number
  notes: null | string
  pickOriginalTeam: null | string
  pickRound: null | number
  pickYear: null | number
  playerId: null | number
  playerName: null | string
  playerNhlId: null | number
  retainedPercent: null | number
  to: string
  type: 'DRAFT_PICK' | 'FUTURE_CONSIDERATIONS' | 'PLAYER' | 'PROSPECT_RIGHTS'
}

export type TradeNotification = {
  accepted: null | number
  approvedAt: null | string
  approvedBy: null | string
  attempted: null | number
  audience: 'breakingNews' | 'tradeFollowers'
  body: string
  cmsNotificationId: null | string
  deliveryEventId: string
  failed: null | number
  id: number
  invalid: null | number
  lastError: null | string
  queuedAt: null | string
  recipients: null | number
  rejected: null | number
  sentAt: null | string
  status: 'APPROVED' | 'AWAITING_APPROVAL' | 'CANCELLED' | 'FAILED' | 'QUEUED' | 'SENT'
  title: string
}

export type TradeDetail = {
  articleId: null | string
  articleSlug: null | string
  assets: TradeAsset[]
  cap: {
    capHit: number
    capSpace: null | number
    capUpperLimit: null | number
    contracts: number
    id: number
    ltirRelief: number
    phase: 'AFTER' | 'BEFORE'
    reportedCapSpace: null | number
    retained: number
    season: string
    team: string
  }[]
  effectiveOn: null | string
  findings: null | string
  history: { at: string; level: 'ERROR' | 'INFO' | 'WARN'; message: string; status: TradeStatus }[]
  notifications: TradeNotification[]
  sources: { publishedAt: null | string; publisher: string; title: null | string; url: string }[]
  stages: { at: string; secondsFromAnnouncement: number; stage: string }[]
  summary: string
  trade: TradeSummary
}

export type BroadcastPreview = {
  article: null | { id: string; slug: string; status: string }
  assets: { confidence: string; description: string; notes: null | string }[]
  findings: string[]
  headline: string
  notifications: TradeNotification[]
  recipients: Record<string, number>
  registeredDevices: number
  status: TradeStatus
  tradeId: number
  verification: string
}

export const TRADE_STATUS_LABELS: Record<TradeStatus, string> = {
  ARTICLE_READY: 'Article waiting for an editor',
  CAP_VALIDATED: 'Cap checked',
  COMPLETED: 'Completed',
  DATA_APPLIED: 'Applied',
  DETECTED: 'Detected',
  FAILED: 'Failed',
  NEEDS_REVIEW: 'Needs review',
  NOTIFICATION_QUEUED: 'Notifications waiting for approval',
  PUBLISHED: 'Published',
  REVERTED: 'Reverted',
  VERIFIED: 'Verified',
}

export const AUDIENCE_LABELS: Record<string, string> = {
  breakingNews: 'Everyone with breaking news on',
  tradeFollowers: 'Fans and followers of its teams and players',
}

/** "$8,700,000" */
export const money = (value: null | number | undefined) =>
  value === null || value === undefined
    ? '–'
    : new Intl.NumberFormat('en-US', { currency: 'USD', maximumFractionDigits: 0, style: 'currency' }).format(value)

/** "3 min 20 s" */
export const duration = (seconds: number) => {
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`
  return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`
}
