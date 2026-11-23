/**
 * The trade articles the HockeyPoolCap API writes (its TradeArticleWriter): what it sends, and how a new version is
 * merged into the stored one. Pure functions, so they're tested apart (tests/tradeArticles.test.ts).
 */

export type TradeArticleSection = { body: string; heading?: null | string; kind: 'analysis' | 'facts' }

export type TradeArticleSource = {
  publishedAt?: null | string
  publisher: string
  title?: null | string
  url: string
}

export type TradeCapLine = {
  capHitAfter?: null | number
  capHitBefore?: null | number
  capSpaceAfter?: null | number
  capSpaceBefore?: null | number
  ltirReliefAfter?: null | number
  reportedCapSpace?: null | number
  season: string
  team: string
}

/** What the API sends: `PUT /api/hockey/trade-articles/by-trade/:tradeId` */
export type IncomingTradeArticle = {
  analysisNote?: null | string
  capImpact?: TradeCapLine[]
  findings?: string[]
  generatedAt?: null | string
  madeOn?: null | string
  sections?: TradeArticleSection[]
  seoDescription?: null | string
  slug?: null | string
  sources?: TradeArticleSource[]
  teams?: string[]
  title?: null | string
  tradeId?: number
  tradeKey?: null | string
  verification?: null | string
}

export const VERIFICATIONS = ['verified', 'verifiedWithNotes', 'needsReview'] as const

type Stored = { editedByEditor?: boolean | null; status?: null | string }

export type Verification = (typeof VERIFICATIONS)[number]

/** One of the three; anything else is treated as needing review */
export const verificationOf = (value: null | string | undefined): Verification =>
  VERIFICATIONS.includes(value as Verification) ? (value as Verification) : 'needsReview'

/** Whether the incoming article can be stored: its trade, a title and sections; the reason when it can't */
export const invalidArticle = (article: IncomingTradeArticle | null): null | string => {
  if (!article || typeof article !== 'object') {
    return 'The body must be a JSON object.'
  }
  if (!Number.isSafeInteger(article.tradeId) || (article.tradeId ?? 0) <= 0) {
    return 'tradeId is needed.'
  }
  if (!article.title?.trim()) {
    return 'title is needed.'
  }
  if (!Array.isArray(article.sections) || article.sections.length === 0) {
    return 'sections are needed.'
  }
  if (article.sections.some((section) => section.kind !== 'facts' && section.kind !== 'analysis')) {
    return 'Each section is facts or analysis.'
  }
  return null
}

/**
 * The fields to write: everything for a new article or an untouched draft; for one an editor changed or published,
 * only the checks, cap figures and sources, so their text stays theirs
 */
export const articleData = (article: IncomingTradeArticle, stored: null | Stored) => {
  const checks = {
    capImpact: article.capImpact ?? [],
    findings: (article.findings ?? []).map((finding) => ({ finding: finding.slice(0, 1000) })),
    generatedAt: article.generatedAt ?? new Date().toISOString(),
    sources: (article.sources ?? []).map((source) => ({
      publishedAt: source.publishedAt ?? null,
      publisher: source.publisher.slice(0, 100),
      title: source.title?.slice(0, 500) ?? null,
      url: source.url.slice(0, 1000),
    })),
    verification: verificationOf(article.verification),
  }
  if (stored && (stored.editedByEditor || stored.status === 'published')) {
    return checks
  }
  return {
    ...checks,
    analysisNote: article.analysisNote ?? null,
    madeOn: article.madeOn ?? null,
    sections: (article.sections ?? []).map((section) => ({
      body: section.body,
      heading: section.heading ?? null,
      kind: section.kind as 'analysis' | 'facts',
    })),
    seoDescription: article.seoDescription?.slice(0, 160) ?? null,
    slug: (article.slug ?? `trade-${article.tradeId}`).slice(0, 120),
    status: (stored?.status === 'published' ? 'published' : 'draft') as 'draft' | 'published',
    teams: article.teams ?? [],
    title: (article.title ?? '').slice(0, 200),
    tradeId: article.tradeId,
    tradeKey: article.tradeKey ?? null,
  }
}

/** Why it can't be published, or null: an article whose trade needs review waits */
export const cannotPublish = (verification: null | string | undefined): null | string =>
  verification === 'needsReview'
    ? 'Its trade needs review (NHL Data → Trades): publish it once the trade is verified.'
    : null
