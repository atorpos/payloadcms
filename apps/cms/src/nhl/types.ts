/**
 * What the HockeyPoolCap API (atorpos/HockeyPoolCap-API) answers for the NHL data screens. Fields the API leaves
 * out when empty are optional.
 */

export type NhlTeamRef = { abbreviation: string; name?: null | string }

export type NhlTeam = {
  abbreviation: string
  city?: null | string
  /** The NHL's short name, e.g. Avalanche */
  commonName?: null | string
  conference?: null | string
  division?: null | string
  id: number
  /** The NHL's logo (SVG) for dark backgrounds */
  logoDarkUrl?: null | string
  /** The NHL's logo (SVG) for light backgrounds */
  logoUrl?: null | string
  name: string
  /** e.g. Colorado */
  placeName?: null | string
}

/** `GET /api/v1/teams/{team}/stats`: its record in a season; the standing fields come from the NHL's standings */
export type NhlTeamStats = {
  conferenceRank?: null | number
  divisionRank?: null | number
  gamesPlayed: number
  goalsAgainst?: null | number
  goalsFor?: null | number
  homeRecord?: null | string
  /** Wins-losses-OT losses in the last ten games, e.g. 5-4-1 */
  lastTen?: null | string
  leagueRank?: null | number
  losses: number
  overtimeLosses: number
  pointPercentage?: null | number
  points: number
  regulationWins?: null | number
  roadRecord?: null | string
  season: number
  seasonLabel: string
  /** e.g. W3: three wins in a row */
  streak?: null | string
  updatedAt?: null | string
  wins: number
}

/** `GET /api/v1/admin/teams/{team}` */
export type NhlTeamAdmin = {
  /** API Ninjas' team_id, from the import before the NHL's */
  externalId?: null | string
  /** The fields the daily import leaves as an admin set them */
  keptFields: string[]
} & NhlTeam

export type NhlPlayer = {
  birthCountry?: null | string
  /** e.g. Halifax, Nova Scotia, CAN */
  birthPlace?: null | string
  headshotUrl?: null | string
  heightCm?: null | number
  /** The NHL's player ID, e.g. 8477492; null for a player the NHL import hasn't found */
  nhlId?: null | number
  weightKg?: null | number
  /** e.g. "1997-09-17" */
  birthDate?: null | string
  /** This season's cap hit, in US dollars */
  capHit?: null | number
  draft?: {
    overall?: null | number
    round?: null | number
    team?: NhlTeamRef | null
    year?: null | number
  } | null
  firstName?: null | string
  fullName: string
  id: number
  jerseyNumber?: null | number
  lastName?: null | string
  position?: null | string
  rosterStatus?: null | string
  shootsCatches?: null | string
  team?: NhlTeamRef | null
}

export type NhlPlayerStats = {
  assists?: null | number
  gamesPlayed: number
  goals?: null | number
  goalsAgainstAverage?: null | number
  losses?: null | number
  overtimeLosses?: null | number
  penaltyMinutes?: null | number
  plusMinus?: null | number
  points?: null | number
  savePercentage?: null | number
  season: number
  seasonLabel: string
  shutouts?: null | number
  wins?: null | number
}

export type NhlContract = {
  capHit: number
  contractType?: null | string
  endSeason: number
  expiryStatus?: null | string
  id: number
  noMovementClause?: boolean | null
  noTradeClause?: boolean | null
  seasons?: null | string
  startSeason: number
  totalValue?: null | number
  years?: null | number
}

/** `GET /api/v1/admin/players/{id}` */
export type NhlPlayerAdmin = {
  contracts: NhlContract[]
  /** API Ninjas' player_id, from the import before the NHL's */
  externalId?: null | string
  keptFields: string[]
  lastImportedAt?: null | string
  player: NhlPlayer
  sourceRosterStatus?: null | string
  /** Newest season first */
  stats: NhlPlayerStats[]
  updatedAt?: null | string
}

export type NhlPage<T> = {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export const POSITIONS = [
  { label: 'Center', value: 'C' },
  { label: 'Left wing', value: 'LW' },
  { label: 'Right wing', value: 'RW' },
  { label: 'Defense', value: 'D' },
  { label: 'Goalie', value: 'G' },
]

export const ROSTER_STATUSES = [
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Injured reserve', value: 'INJURED_RESERVE' },
  { label: 'Long-term injured reserve', value: 'LONG_TERM_INJURED_RESERVE' },
  { label: 'Minors', value: 'MINORS' },
  { label: 'Prospect', value: 'PROSPECT' },
  { label: 'Free agent', value: 'FREE_AGENT' },
  { label: 'Retired', value: 'RETIRED' },
]

export const optionLabel = (options: { label: string; value: string }[], value?: null | string) =>
  options.find((option) => option.value === value)?.label ?? value ?? '—'

/** e.g. "$12.50M" */
export const formatMoney = (dollars?: null | number) =>
  dollars === null || dollars === undefined
    ? '—'
    : `$${(dollars / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}M`

/** The season whose cap year today is in: 2026 from July 1, 2026 to June 30, 2027, as the API counts */
export const currentSeason = (now = new Date()) =>
  now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1

export const seasonLabel = (season: number) => `${season}-${String((season + 1) % 100).padStart(2, '0')}`

// --- Researched careers (PUT /api/v1/admin/players/{id}/career; the API's CareerDocument) ----------------------------

export type ResearchStatus = 'NEEDS_REVIEW' | 'VERIFIED'

export type CareerBio = {
  birthCountry: null | string
  birthDate: null | string
  birthPlace: null | string
  draft: {
    overall: null | number
    round: null | number
    team: null | string
    year: null | number
  } | null
  heightCm: null | number
  position: null | string
  shootsCatches: null | string
  weightKg: null | number
}

/** Where it came from: NHL (the daily import replaces these) or RESEARCH (the research script, or someone here) */
export type CareerSource = 'NHL' | 'RESEARCH'

export type CareerAchievement = { detail: null | string; season: null | number; source?: CareerSource; title: string }

export type TransactionType = 'BUYOUT' | 'DRAFT' | 'OTHER' | 'RELEASE' | 'SIGNING' | 'TRADE' | 'WAIVER_CLAIM'

export type CareerTransaction = {
  acquired: string[]
  date: null | string
  fromTeam: null | string
  given: string[]
  notes: null | string
  retainedPercent: null | number
  season: null | number
  toTeam: null | string
  type: TransactionType
}

export type CareerContractYear = {
  baseSalary: null | number
  clause: null | string
  performanceBonus: null | number
  season: number
  signingBonus: null | number
}

export type CareerContract = {
  capHit: number
  clauses: null | string
  contractType: 'ENTRY_LEVEL' | 'STANDARD' | 'THIRTY_FIVE_PLUS'
  description: null | string
  endSeason: number
  expiryStatus: 'RFA' | 'UFA' | null
  noMovementClause: boolean | null
  noTradeClause: boolean | null
  notes: null | string
  retentions: { percent: number; team: string }[]
  signedOn: null | string
  signingTeam: null | string
  startSeason: number
  totalValue: null | number
  twoWay: boolean | null
  years: CareerContractYear[]
}

export type CareerStatLine = {
  age: null | number
  assists: null | number
  gamesPlayed: number
  gameType: 'PLAYOFFS' | 'REGULAR'
  goals: null | number
  goalsAgainstAverage: null | number
  losses: null | number
  note: null | string
  overtimeLosses: null | number
  penaltyMinutes: null | number
  plusMinus: null | number
  points: null | number
  savePercentage: null | number
  season: number
  shutouts: null | number
  source?: CareerSource
  team: string
  wins: null | number
}

/** `GET /api/v1/admin/import`: whether an import from the NHL runs, how far it got, and what the last one did */
export type NhlImportStatus = {
  lastResult?: NhlImportResult | null
  phase?: null | string
  playersDone: number
  playersTotal: number
  running: boolean
  startedAt?: null | string
  team?: null | string
}

export type NhlImportResult = {
  awards: number
  errors: string[]
  finishedAt: string
  playerPagesRead: number
  playersCreated: number
  playersFailed: number
  playersMatched: number
  playersMissing: number
  playersSkipped: number
  playersUpdated: number
  startedAt: string
  statLines: number
  team?: null | string
  teamsCreated: number
  teamsUpdated: number
}

export type Career = {
  achievements: CareerAchievement[]
  bio: CareerBio | null
  contracts: CareerContract[]
  model: null | string
  notes: null | string
  researchedAt: null | string
  researchStatus: null | ResearchStatus
  sources: string[]
  stats: CareerStatLine[]
  transactions: CareerTransaction[]
}

/** `GET /api/v1/admin/players/{id}/career`, and what saving it answers */
export type CareerResponse = { career: Career; fullName: string; playerId: number; warnings: string[] }

/** `GET /api/v1/admin/research` */
export type ResearchEntry = {
  model?: null | string
  player: NhlPlayer
  researchedAt?: null | string
  researchStatus?: null | ResearchStatus
}

/** `GET /api/v1/admin/cap-summaries`: a team's cap in a season, as last calculated */
export type TeamCapSummary = {
  calculatedAt: string
  capHit: number
  capLowerLimit?: null | number
  capSpace?: null | number
  capUpperLimit?: null | number
  contractLimit: number
  contracts: number
  ltirCapHit: number
  season: number
  seasonLabel: string
  team: NhlTeamRef
}

export const RESEARCH_STATUSES = [
  { label: 'Needs review', value: 'NEEDS_REVIEW' },
  { label: 'Verified', value: 'VERIFIED' },
  { label: 'Never researched', value: 'NONE' },
]

export const TRANSACTION_TYPES: { label: string; value: TransactionType }[] = [
  { label: 'Draft', value: 'DRAFT' },
  { label: 'Trade', value: 'TRADE' },
  { label: 'Signing', value: 'SIGNING' },
  { label: 'Waiver claim', value: 'WAIVER_CLAIM' },
  { label: 'Release', value: 'RELEASE' },
  { label: 'Buyout', value: 'BUYOUT' },
  { label: 'Other', value: 'OTHER' },
]
