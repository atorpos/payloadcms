/**
 * What the HockeyPoolCap API (atorpos/HockeyPoolCap-API) answers for the NHL data screens. Fields the API leaves
 * out when empty are optional.
 */

export type NhlTeamRef = { abbreviation: string; name?: null | string }

export type NhlTeam = {
  abbreviation: string
  city?: null | string
  conference?: null | string
  division?: null | string
  id: number
  name: string
}

/** `GET /api/v1/admin/teams/{team}` */
export type NhlTeamAdmin = {
  /** API Ninjas' team_id, e.g. nhl-tor */
  externalId?: null | string
  /** The fields the daily import leaves as an admin set them */
  keptFields: string[]
} & NhlTeam

export type NhlPlayer = {
  birthCountry?: null | string
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
  /** API Ninjas' player_id; null for a player added by hand */
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
