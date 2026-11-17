/**
 * How an exhibitor found on an event's exhibitor list is matched to a company already in Companies
 * (../collections/Companies.ts), and what it may add to it. Pure functions, used by
 * ../endpoints/appExhibitorDiscovery.ts.
 *
 * A match is only certain when the two share their name (also an alias or the local name) once legal
 * forms such as "Co., Ltd." or "有限公司" are left out, or share their website's domain and have alike
 * names, and their countries agree (or one is unknown). A shared domain alone isn't enough: several
 * companies of a group can share one website. Anything less certain, e.g. similar names, the same
 * website under another name, or the same name in another country, is a *possible* duplicate: a new
 * company is made and flagged for the team to review, never merged by itself.
 */

/** Legal forms and filler that don't tell two companies apart */
const LEGAL_WORDS = new Set([
  'ab',
  'ag',
  'and',
  'as',
  'bhd',
  'bv',
  'co',
  'company',
  'corp',
  'corporation',
  'gmbh',
  'inc',
  'incorporated',
  'kg',
  'kk',
  'limited',
  'llc',
  'llp',
  'ltd',
  'nv',
  'oy',
  'plc',
  'private',
  'pt',
  'pte',
  'pty',
  'pvt',
  'sa',
  'sarl',
  'sas',
  'sdn',
  'spa',
  'srl',
  'the',
])

/** Chinese legal forms, longest first */
const CJK_LEGAL_SUFFIXES = [
  '股份有限公司',
  '有限责任公司',
  '有限責任公司',
  '有限公司',
  '股份公司',
  '公司',
]

/** Spellings of the same word */
const WORD_VARIANTS: Record<string, string> = {
  jewellers: 'jewelers',
  jewellery: 'jewelry',
  jewelery: 'jewelry',
  jewellry: 'jewelry',
}

/**
 * Words so many exhibitors share that a name match on them alone means nothing; left out when
 * looking for candidates (matchTokens), not when comparing names
 */
const COMMON_WORDS = new Set([
  'art',
  'arts',
  'china',
  'collection',
  'creation',
  'creations',
  'design',
  'designs',
  'diamond',
  'diamonds',
  'enterprise',
  'enterprises',
  'export',
  'exports',
  'factory',
  'fine',
  'gem',
  'gems',
  'gemstone',
  'gemstones',
  'gold',
  'group',
  'hong',
  'india',
  'industrial',
  'industries',
  'industry',
  'international',
  'jewelers',
  'jewelry',
  'kong',
  'manufacturing',
  'pearl',
  'pearls',
  'precious',
  'silver',
  'stone',
  'stones',
  'thailand',
  'trading',
])

/** Websites shared by many companies: their domain says nothing about which company it is */
const SHARED_HOSTS = [
  '1688.com',
  '163.com',
  'alibaba.com',
  'aliexpress.com',
  'blogspot.com',
  'etsy.com',
  'facebook.com',
  'gmail.com',
  'google.com',
  'hotmail.com',
  'instagram.com',
  'linkedin.com',
  'made-in-china.com',
  'outlook.com',
  'qq.com',
  'taobao.com',
  'tiktok.com',
  'twitter.com',
  'weebly.com',
  'weibo.com',
  'wix.com',
  'wixsite.com',
  'x.com',
  'yahoo.com',
  'youtube.com',
]

/** Other names of countries, lowercased */
const COUNTRY_ALIASES: Record<string, string> = {
  'china (mainland)': 'china',
  'great britain': 'united kingdom',
  'hong kong sar': 'hong kong',
  'hong kong, china': 'hong kong',
  'mainland china': 'china',
  "people's republic of china": 'china',
  prc: 'china',
  'republic of korea': 'south korea',
  korea: 'south korea',
  'taiwan, china': 'taiwan',
  turkiye: 'turkey',
  uae: 'united arab emirates',
  uk: 'united kingdom',
  'united states of america': 'united states',
  us: 'united states',
  usa: 'united states',
  香港: 'hong kong',
  中国: 'china',
  中國: 'china',
  台灣: 'taiwan',
  台湾: 'taiwan',
}

/**
 * The name as it's compared: Unicode-normalized, lowercased, without punctuation, legal forms or
 * spelling variants. "Wing Fat Jewellery Co., Ltd." and "WING FAT JEWELRY LIMITED" both give
 * "wing fat jewelry"; "周大福珠寶金行有限公司" gives "周大福珠寶金行".
 */
export const normalizeName = (name: null | string | undefined): string => {
  if (!name) {
    return ''
  }

  let text = name.normalize('NFKC').toLowerCase().replace(/&/g, ' and ')

  for (const suffix of CJK_LEGAL_SUFFIXES) {
    if (text.endsWith(suffix) && text.length > suffix.length) {
      text = text.slice(0, -suffix.length)
      break
    }
  }

  return nameWords(text).join(' ')
}

/** The words of a name, without legal forms; CJK text without spaces stays one word */
const nameWords = (text: string): string[] =>
  text
    // Letters and digits of any script; everything else separates words
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => WORD_VARIANTS[word] ?? word)
    .filter((word) => !LEGAL_WORDS.has(word))

/** The distinctive words of a name, to find candidate companies with (an indexed field) */
export const matchTokens = (names: (null | string | undefined)[]): string[] => {
  const tokens = new Set<string>()

  for (const name of names) {
    const words = normalizeName(name).split(' ').filter(Boolean)
    const distinctive = words.filter((word) => !COMMON_WORDS.has(word) && word.length > 1)

    // A name made only of common words ("Diamond Gems") is still findable by them
    for (const word of distinctive.length ? distinctive : words) {
      tokens.add(word)
    }
  }

  return [...tokens].slice(0, 20)
}

/**
 * The website's domain, e.g. "wingfat.com.hk" for "https://www.wingfat.com.hk/en/", or null when it
 * isn't a website of its own (a Facebook page, an Alibaba shop, a free email provider).
 */
export const websiteDomain = (website: null | string | undefined): null | string => {
  if (!website) {
    return null
  }

  let host: string

  try {
    host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname
  } catch {
    return null
  }

  host = host.toLowerCase().replace(/^www\d?\./, '')

  if (!host.includes('.')) {
    return null
  }

  return SHARED_HOSTS.some((shared) => host === shared || host.endsWith(`.${shared}`)) ? null : host
}

/** The country as it's compared: lowercased, in English where an alias is known */
export const normalizeCountry = (country: null | string | undefined): null | string => {
  const text = country?.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')

  if (!text) {
    return null
  }

  return COUNTRY_ALIASES[text] ?? text
}

/** Two countries agree when they're the same or either is unknown */
export const countriesAgree = (a: null | string | undefined, b: null | string | undefined) => {
  const first = normalizeCountry(a)
  const second = normalizeCountry(b)

  return !first || !second || first === second
}

/** What's compared of a company */
export type MatchableCompany = {
  aliases?: null | string[]
  country?: null | string
  id: string
  legalName?: null | string
  localName?: null | string
  name: string
  website?: null | string
}

export type Match =
  | { companies: MatchableCompany[]; kind: 'possible' }
  | { company: MatchableCompany; kind: 'same' }
  | { kind: 'none' }

/** All the names a company goes by, normalized */
const allNames = (
  company: Pick<MatchableCompany, 'aliases' | 'legalName' | 'localName' | 'name'>,
) =>
  new Set(
    [company.name, company.localName, company.legalName, ...(company.aliases ?? [])]
      .map(normalizeName)
      .filter((name) => name.length > 0),
  )

/** How alike two names are, 0 to 1: shared words over all words */
export const nameSimilarity = (a: string, b: string): number => {
  const first = new Set(normalizeName(a).split(' ').filter(Boolean))
  const second = new Set(normalizeName(b).split(' ').filter(Boolean))

  if (!first.size || !second.size) {
    return 0
  }

  let shared = 0

  for (const word of first) {
    if (second.has(word)) {
      shared++
    }
  }

  return shared / (first.size + second.size - shared)
}

/** Names this alike, in the same country, may be the same company: the team decides */
const POSSIBLE_SIMILARITY = 0.6
/** Names this alike, on the same website, are the same company */
const SAME_SITE_SIMILARITY = 0.75

/**
 * Whether two normalized names on the same website are the same company: one's words are all in the
 * other ("wing fat" and "wing fat jewelry"), or they're nearly the same. "chow tai fook jewelry" and
 * "chow tai fook enterprises" aren't: two companies of one group.
 */
export const namesAlike = (a: string, b: string): boolean => {
  const first = a.split(' ').filter(Boolean)
  const second = b.split(' ').filter(Boolean)

  if (!first.length || !second.length) {
    return false
  }

  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first]
  const words = new Set(longer)

  return shorter.every((word) => words.has(word)) || nameSimilarity(a, b) >= SAME_SITE_SIMILARITY
}

/**
 * Whether the exhibitor is one of the candidate companies. "same" only when exactly one candidate is
 * certainly it; when several are, or one only may be, it's "possible".
 */
export const matchCompany = (
  exhibitor: Omit<MatchableCompany, 'id'>,
  candidates: MatchableCompany[],
): Match => {
  const domain = websiteDomain(exhibitor.website)
  const names = allNames(exhibitor)
  const same: MatchableCompany[] = []
  const possible: MatchableCompany[] = []

  for (const candidate of candidates) {
    const sameDomain = domain !== null && websiteDomain(candidate.website) === domain
    const candidateNames = allNames(candidate)
    const sameName = [...names].some((name) => candidateNames.has(name))
    const agree = countriesAgree(exhibitor.country, candidate.country)
    const alike = [...names].some((name) =>
      [...candidateNames].some((other) => namesAlike(name, other)),
    )

    if (agree && (sameName || (sameDomain && alike))) {
      same.push(candidate)
    } else if (sameDomain || sameName) {
      // The same name in another country (a branch, or another company altogether), or the same
      // website under another name (one company of a group that shares it)
      possible.push(candidate)
    } else if (
      agree &&
      [...names].some((name) =>
        [...candidateNames].some((other) => nameSimilarity(name, other) >= POSSIBLE_SIMILARITY),
      )
    ) {
      possible.push(candidate)
    }
  }

  if (same.length === 1) {
    return { company: same[0]!, kind: 'same' }
  }
  if (same.length > 1 || possible.length > 0) {
    return { companies: [...same, ...possible], kind: 'possible' }
  }

  return { kind: 'none' }
}

/** The text fields an exhibitor list, its profile pages or the company's website can tell */
export const TEXT_FIELDS = [
  'localName',
  'legalName',
  'country',
  'city',
  'address',
  'phone',
  'email',
  'website',
  'description',
  'contactPageUrl',
  'linkedinUrl',
  'instagramUrl',
  'facebookUrl',
] as const

/** The fields that are lists: categories, and other official social media pages */
export const LIST_FIELDS = ['industry', 'otherLinks'] as const

export const ENRICHABLE_FIELDS = [...TEXT_FIELDS, ...LIST_FIELDS] as const

export type TextField = (typeof TEXT_FIELDS)[number]
export type ListField = (typeof LIST_FIELDS)[number]
export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number]

/** At most this many categories or other links */
export const MAX_LIST_ITEMS = 10

export type CompanyDetails = Partial<Record<ListField, null | string[]>> &
  Partial<Record<TextField, null | string>> & {
    aliases?: null | string[]
    name: string
  }

/**
 * What a newly found exhibitor adds to an existing company: fields the company doesn't have yet, and
 * categories or links it doesn't list yet; never a different value over one it has (those are listed
 * in `conflicts`), and nothing in a field the team edited (`curated`). The name becomes an alias when
 * it's another name. `filled` are the fields the patch sets, whose source is then recorded.
 */
export const enrichment = (
  existing: CompanyDetails,
  found: CompanyDetails,
  curated: readonly string[] = [],
): { conflicts: string[]; filled: EnrichableField[]; patch: Partial<CompanyDetails> } => {
  const patch: Partial<CompanyDetails> = {}
  const conflicts: string[] = []
  const filled: EnrichableField[] = []
  const kept = new Set(curated)

  for (const field of TEXT_FIELDS) {
    const value = found[field]?.trim()
    const current = existing[field]?.trim()

    if (!value || kept.has(field)) {
      continue
    }
    if (!current) {
      patch[field] = value
      filled.push(field)
    } else if (!sameValue(field, current, value)) {
      conflicts.push(field)
    }
  }

  for (const field of LIST_FIELDS) {
    const current = (existing[field] ?? []).filter(Boolean)
    const known = new Set(current.map((item) => listKey(field, item)))
    const added = (found[field] ?? [])
      .map((item) => item?.trim())
      .filter((item): item is string => Boolean(item) && !known.has(listKey(field, item!)))

    if (!added.length || kept.has(field) || current.length >= MAX_LIST_ITEMS) {
      continue
    }
    const unique = added.filter(
      (item, index) =>
        added.findIndex((other) => listKey(field, other) === listKey(field, item)) === index,
    )

    patch[field] = [...current, ...unique].slice(0, MAX_LIST_ITEMS)
    filled.push(field)
  }

  const knownNames = allNames(existing)

  if (!knownNames.has(normalizeName(found.name))) {
    patch.aliases = [...(existing.aliases ?? []), found.name.trim()].slice(-20)
  }

  return { conflicts, filled, patch }
}

/** A category or a link as it's compared */
const listKey = (field: ListField, item: string) =>
  field === 'otherLinks' ? urlKey(item) : item.normalize('NFKC').toLowerCase()

/** "https://www.LinkedIn.com/company/wingfat/" and "linkedin.com/company/wingfat" are the same page */
export const urlKey = (url: string) =>
  url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')

/** Where a field's value is from (Companies → Sources) */
export type SourceKind =
  | 'companyWebsite'
  | 'exhibitorList'
  | 'exhibitorProfile'
  | 'team'
  | 'webSearch'

export type FieldSource = {
  confidence?: 'high' | 'medium' | null
  field: string
  id?: null | string
  seenAt?: null | string
  sourceKind: SourceKind
  sourceUrl?: null | string
}

/** At most this many sources are kept; a field's newest replaces its older one */
export const MAX_FIELD_SOURCES = 40

/** The company's sources, with those of `fields` now from `source` */
export const withSources = (
  current: FieldSource[] | null | undefined,
  fields: readonly string[],
  source: Omit<FieldSource, 'field'>,
): FieldSource[] => {
  const changed = new Set(fields)
  const kept = (current ?? [])
    .filter((entry) => !changed.has(entry.field))
    .map(({ id: _id, ...entry }) => entry)

  return [...kept, ...fields.map((field) => ({ ...source, field }))].slice(-MAX_FIELD_SOURCES)
}

/**
 * The fields the team changed in an edit, emptied ones included: the exhibitor search then leaves
 * them as they are. Text is compared trimmed, so an untouched empty field isn't a change.
 */
export const changedFields = (
  before: Partial<Record<string, unknown>> | null | undefined,
  after: Partial<Record<string, unknown>>,
): EnrichableField[] =>
  ENRICHABLE_FIELDS.filter(
    (field) => field in after && comparable(before?.[field]) !== comparable(after[field]),
  )

const comparable = (value: unknown): string => {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((item) => String(item).trim()).filter(Boolean))
  }
  return typeof value === 'string' ? JSON.stringify(value.trim() ? [value.trim()] : []) : '[]'
}

/** "Diamonds, Pearls; Gold" as a list of categories */
export const categories = (value: unknown): string[] => {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const kept = new Map<string, string>()

  for (const item of items.flatMap((entry) =>
    typeof entry === 'string' ? entry.split(/\s*[,;，、|]\s*/) : [],
  )) {
    const category = item.trim().replace(/\s+/g, ' ').slice(0, 200)
    const key = category.normalize('NFKC').toLowerCase()

    // The first spelling of a repeated category is kept
    if (category && !kept.has(key)) {
      kept.set(key, category)
    }
  }

  return [...kept.values()].slice(0, MAX_LIST_ITEMS)
}

const sameValue = (field: string, a: string, b: string) => {
  switch (field) {
    case 'country':
      return normalizeCountry(a) === normalizeCountry(b)
    case 'email':
      return a.toLowerCase() === b.toLowerCase()
    case 'phone':
      return a.replace(/\D/g, '') === b.replace(/\D/g, '')
    case 'website':
      return websiteDomain(a) === websiteDomain(b)
    case 'contactPageUrl':
    case 'facebookUrl':
    case 'instagramUrl':
    case 'linkedinUrl':
      return urlKey(a) === urlKey(b)
    default:
      return a.normalize('NFKC').toLowerCase() === b.normalize('NFKC').toLowerCase()
  }
}
