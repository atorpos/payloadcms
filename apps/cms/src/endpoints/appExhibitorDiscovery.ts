import type { Endpoint, PayloadRequest, Where } from 'payload'

import type { Company, Event, EventExhibitor } from '../payload-types'

import {
  categories,
  type CompanyDetails,
  enrichment,
  type FieldSource,
  matchCompany,
  matchTokens,
  MAX_LIST_ITEMS,
  normalizeName,
  type SourceKind,
  TEXT_FIELDS,
  websiteDomain,
  withSources,
} from '../exhibitors/companyMatching'
import { applyWebsiteReport } from '../exhibitors/eventWebsite'
import { localDay } from '../zonedTime'
import { refuseWithoutAppApiKey } from './appApiKey'

/**
 * awoz-api's exhibitor search (ExhibitorDiscoveryService there): after its weekly event search, it reads
 * the official exhibitor lists of upcoming events and saves their companies here. Server to server only,
 * with `X-API-Key: <APP_API_KEY>` (./appApiKey.ts); while APP_API_KEY is empty every endpoint answers 404.
 *
 *   GET  /api/app/exhibitor-discovery/events              upcoming events and how their search went
 *   POST /api/app/exhibitor-discovery/events/:id/claim    takes an event for one run (409 if another has it)
 *   POST /api/app/exhibitor-discovery/events/:id/status   records how the run went, and lets go of the event
 *   POST /api/app/exhibitor-discovery/events/:id/exhibitors  saves exhibitors found on one page of the list
 *   GET  /api/app/exhibitor-discovery/companies           companies missing details, to read their websites
 *   POST /api/app/exhibitor-discovery/companies/:id/enrichment  saves what the company's website shows
 *
 * Every write goes through Payload (hooks, validation, the unique index of Event exhibitors), marked
 * `context.fromAwozApi`, so awoz-api isn't told about its own changes (../hooks/notifyAwozApi.ts).
 */

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_EXHIBITORS_PER_REQUEST = 100
const MAX_CLAIM_MINUTES = 6 * 60
/** Candidate companies looked at for each exhibitor */
const MAX_CANDIDATES = 50
/** A complete run that finds at least this share of the exhibitors listed before marks the rest withdrawn */
const WITHDRAW_SHARE = 0.8
const STATUSES = ['running', 'found', 'noDirectory', 'unreadable', 'failed'] as const

type Search = NonNullable<Event['exhibitorSearch']>

/** What awoz-api sends for each exhibitor: only what the page showed, checked against its text */
type FoundExhibitor = {
  address?: null | string
  booth?: null | string
  city?: null | string
  contactPageUrl?: null | string
  country?: null | string
  description?: null | string
  /** The exhibitor's own page on the list */
  detailUrl?: null | string
  email?: null | string
  facebookUrl?: null | string
  hall?: null | string
  /** Categories: a list, or older API versions' text */
  industry?: null | string | string[]
  instagramUrl?: null | string
  legalName?: null | string
  linkedinUrl?: null | string
  localName?: null | string
  name?: null | string
  otherLinks?: null | string[]
  phone?: null | string
  /** exhibitorList (default): from a page of the list; exhibitorProfile: from the exhibitor's own page */
  sourceKind?: null | string
  sourceUrl?: null | string
  website?: null | string
}

/** How many other pages of a list are kept to read next */
const MAX_PENDING_PAGES = 500
/** Social media, and the websites their links must be on */
const SOCIAL_HOSTS = {
  facebookUrl: ['facebook.com', 'fb.com'],
  instagramUrl: ['instagram.com'],
  linkedinUrl: ['linkedin.com'],
} as const

type Outcome = {
  companyId?: string
  /** created: a new company; matched: an existing one, unchanged; enriched: an existing one, filled in */
  company?: 'created' | 'enriched' | 'matched' | 'possibleDuplicate'
  conflicts?: string[]
  exhibitorId?: string
  link?: 'created' | 'unchanged' | 'updated'
  name: string
  problems?: string[]
}

const fromAwozApi = { fromAwozApi: true }

/**
 * `GET /api/app/exhibitor-discovery/events?days=365` - events that aren't over or cancelled and start
 * within `days`, without "Don't search for exhibitors"; or, with `?ids=a,b`, those events:
 *
 *   { events: [{ id, name, edition, startDate: "2027-03-04", endDate, venue, city, country, organizer,
 *                website, websiteCheck: { status, checkedAt, sourceUrl, suggestedUrl },
 *                search: { status, directoryUrl, resumeUrl, pendingPages, readPages, pagesRead, complete,
 *                          lastRunAt, attempts, claimedUntil, skip } }] }
 */
export const appExhibitorDiscoveryEventsEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const ids = String(req.searchParams.get('ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 100)
    const days = Math.min(Math.max(Number(req.searchParams.get('days')) || 365, 1), 800)
    const now = Date.now()
    const where: Where = ids.length
      ? { id: { in: ids } }
      : {
          and: [
            { status: { not_equals: 'cancelled' } },
            { 'exhibitorSearch.skip': { not_equals: true } },
            { startDate: { less_than: new Date(now + days * DAY_MS).toISOString() } },
            {
              or: [
                { endDate: { greater_than_equal: new Date(now - DAY_MS).toISOString() } },
                { startDate: { greater_than_equal: new Date(now - DAY_MS).toISOString() } },
              ],
            },
          ],
        }

    const { docs } = await req.payload.find({
      collection: 'events',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      select: {
        name: true,
        edition: true,
        endDate: true,
        endDate_tz: true,
        exhibitorSearch: true,
        location: { city: true, country: true, venue: true },
        organizer: true,
        startDate: true,
        startDate_tz: true,
        status: true,
        website: true,
        websiteCheck: true,
      },
      sort: 'startDate',
      where,
    })

    return Response.json({ events: docs.map(toDiscoveryEvent) })
  },
  method: 'get',
  path: '/app/exhibitor-discovery/events',
}

/**
 * `POST /api/app/exhibitor-discovery/events/:id/claim` `{ "minutes": 120 }` - takes the event for one run
 * until it reports back (…/status) or the minutes are over, so two API servers never read the same list
 * at once. 409 while another run has it.
 */
export const appExhibitorDiscoveryClaimEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const event = await findEvent(req)

    if (!event) {
      return notFound()
    }

    const body = (await req.json?.().catch(() => null)) as null | { minutes?: unknown }
    const minutes = Math.min(Math.max(Number(body?.minutes) || 120, 1), MAX_CLAIM_MINUTES)
    const now = new Date()
    const search = event.exhibitorSearch ?? {}

    if (search.claimedUntil && new Date(search.claimedUntil) > now) {
      return Response.json(
        {
          errors: [
            { message: `Another run reads this event's exhibitors until ${search.claimedUntil}.` },
          ],
        },
        { status: 409 },
      )
    }

    const updated = await updateSearch(req, event, {
      claimedUntil: new Date(now.getTime() + minutes * 60_000).toISOString(),
      lastRunAt: now.toISOString(),
      status: 'running',
    })

    return Response.json({ event: toDiscoveryEvent(updated) })
  },
  method: 'post',
  path: '/app/exhibitor-discovery/events/:id/claim',
}

/**
 * `POST /api/app/exhibitor-discovery/events/:id/status` - how the run went, and lets go of the event:
 *
 *   { "status": "found", "directoryUrl": "https://…", "resumeUrl": null, "pendingPages": [],
 *     "readPages": [], "found": 412, "saved": 410, "pagesRead": 14, "attempts": 0, "problems": "…",
 *     "complete": true, "runStartedAt": "2026-11-16T03:20:00Z",
 *     "website": { "url": "https://…", "sourceUrl": "https://…", "verified": true, "note": "…" } }
 *
 * `pendingPages` are other pages of the same list still to read (letters, categories), for the next
 * run; `readPages` those read since the list was last read from its start, so they aren't read again.
 * `website` is the official website the search found for this edition (../exhibitors/eventWebsite.ts):
 * verified when Claude fetched its page and the page names the event and the year. A verified website,
 * or one the team entered, is kept; a different one is only suggested.
 *
 * `complete` means the whole list was read: exhibitors it listed before but no longer does are then
 * marked withdrawn, unless far fewer were found than before (a list that changed its pages, not hundreds
 * of withdrawals). Answers `{ event, withdrawn }`.
 */
export const appExhibitorDiscoveryStatusEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const event = await findEvent(req)

    if (!event) {
      return notFound()
    }

    const body = ((await req.json?.().catch(() => null)) ?? {}) as Record<string, unknown>
    const status = STATUSES.find((value) => value === body.status)

    if (!status) {
      return badRequest(`status must be one of ${STATUSES.join(', ')}.`, 'status')
    }

    const patch: Partial<Search> = { claimedUntil: null, status }

    if (body.directoryUrl !== undefined) {
      patch.directoryUrl = httpUrl(body.directoryUrl)
    }
    if (body.resumeUrl !== undefined) {
      patch.resumeUrl = httpUrl(body.resumeUrl)
    }
    for (const field of ['pendingPages', 'readPages'] as const) {
      const pages = body[field]

      if (pages !== undefined) {
        patch[field] = Array.isArray(pages)
          ? [...new Set(pages.map(httpUrl).filter((url): url is string => Boolean(url)))].slice(
              0,
              MAX_PENDING_PAGES,
            )
          : []
      }
    }
    for (const field of ['found', 'saved', 'pagesRead', 'attempts'] as const) {
      if (typeof body[field] === 'number' && Number.isFinite(body[field])) {
        patch[field] = Math.max(0, Math.round(body[field]))
      }
    }
    if (typeof body.complete === 'boolean') {
      patch.complete = body.complete
    }
    if (body.problems !== undefined) {
      patch.problems = text(body.problems, 4000)
    }

    const website = websiteReport(body.website)
    const updated = await updateSearch(
      req,
      event,
      patch,
      website ? applyWebsiteReport(event, website, new Date().toISOString()) : {},
    )
    const runStartedAt = typeof body.runStartedAt === 'string' ? new Date(body.runStartedAt) : null
    const withdrawn =
      body.complete === true && runStartedAt && !Number.isNaN(runStartedAt.getTime())
        ? await withdrawUnlisted({
            eventId: event.id,
            found: Number(patch.found) || 0,
            req,
            runStartedAt,
          })
        : 0

    return Response.json({ event: toDiscoveryEvent(updated), withdrawn })
  },
  method: 'post',
  path: '/app/exhibitor-discovery/events/:id/status',
}

/**
 * `POST /api/app/exhibitor-discovery/events/:id/exhibitors` - saves the exhibitors of one page of the
 * event's list (at most 100):
 *
 *   { "runStartedAt": "2026-11-16T03:20:00Z",
 *     "exhibitors": [{ "name": "Wing Fat Jewellery Co., Ltd.", "localName": "永發珠寶有限公司",
 *                      "country": "Hong Kong", "address": null, "phone": "+852 2345 6789",
 *                      "email": null, "website": "https://www.wingfat.com.hk", "industry": "Pearls",
 *                      "booth": "1C-B01", "hall": "Hall 1", "sourceUrl": "https://…/exhibitors?page=2",
 *                      "industry": ["Pearls"], "city": "Hong Kong", "legalName": null, "description": null,
 *                      "contactPageUrl": null, "linkedinUrl": null, "instagramUrl": null,
 *                      "facebookUrl": null, "otherLinks": [], "detailUrl": "https://…/exhibitor/123",
 *                      "sourceKind": "exhibitorList" }] }
 *
 * `sourceKind` "exhibitorProfile" sends what the exhibitor's own page on the list showed (its
 * `sourceUrl`): it fills in the company and the link's profile page, and leaves the link's source as
 * the list page. Each value the company gets is recorded with where it's from (Companies → Sources).
 *
 * Each is matched to the companies saved (../exhibitors/companyMatching.ts): the same company is filled
 * in where it's missing something and linked to the event; a new one is created; a possible duplicate is
 * created too, flagged for review with the companies it may be. Event and company are linked once (a
 * unique index), and a link the team confirmed keeps its stand. One that fails doesn't stop the others:
 *
 *   { results: [{ name, company: "created"|"matched"|"enriched"|"possibleDuplicate", companyId,
 *                 link: "created"|"updated"|"unchanged", exhibitorId, conflicts?, problems? }],
 *     summary: { created, matched, enriched, possibleDuplicate, linked, rejected } }
 */
export const appExhibitorDiscoverySaveEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const event = await findEvent(req)

    if (!event) {
      return notFound()
    }

    const body = (await req.json?.().catch(() => null)) as null | {
      exhibitors?: unknown
      runStartedAt?: unknown
    }
    const found = body?.exhibitors

    if (!Array.isArray(found) || found.length > MAX_EXHIBITORS_PER_REQUEST) {
      return badRequest(
        `exhibitors must be a list of at most ${MAX_EXHIBITORS_PER_REQUEST} exhibitors.`,
        'exhibitors',
      )
    }

    const runStartedAt =
      typeof body?.runStartedAt === 'string' && !Number.isNaN(Date.parse(body.runStartedAt))
        ? new Date(body.runStartedAt)
        : new Date()
    const results: Outcome[] = []

    for (const item of found as unknown[]) {
      const exhibitor = (item && typeof item === 'object' ? item : {}) as FoundExhibitor
      const name = text(exhibitor.name, 300) ?? '(no name)'

      try {
        results.push(await saveExhibitor({ eventId: event.id, exhibitor, req, runStartedAt }))
      } catch (error) {
        req.payload.logger.warn({ err: error, msg: `Could not save the exhibitor "${name}"` })
        results.push({ name, problems: [(error as Error).message] })
      }
    }

    const count = (test: (outcome: Outcome) => boolean) => results.filter(test).length

    return Response.json({
      results,
      summary: {
        created: count((outcome) => outcome.company === 'created'),
        enriched: count((outcome) => outcome.company === 'enriched'),
        linked: count((outcome) => outcome.link === 'created'),
        matched: count((outcome) => outcome.company === 'matched'),
        possibleDuplicate: count((outcome) => outcome.company === 'possibleDuplicate'),
        rejected: count((outcome) => !outcome.link),
      },
    })
  },
  method: 'post',
  path: '/app/exhibitor-discovery/events/:id/exhibitors',
}

/** The details a company's website can add, and the suggestions a web search can make */
const MISSING_FIELDS = ['email', 'phone', 'address', 'city', 'description'] as const
const ENRICHMENT_STATUSES = ['done', 'nothingNew', 'noWebsite', 'failed'] as const
const MAX_ENRICHMENT_BATCH = 100

/**
 * `GET /api/app/exhibitor-discovery/companies?limit=50&recheckDays=180&retryDays=7` - companies the
 * search may read the website of: not "Keep as entered", missing an email, phone, address, city or
 * description, and not read in `recheckDays` (or `retryDays` after a failure). Those never read
 * first. `websiteFrom` says where their website is from: only one from the exhibitor list (or its
 * profile page) or the team may be read for details; for one without, the search only suggests.
 *
 *   { companies: [{ id, name, localName, legalName, country, city, website, websiteFrom, missing,
 *                   curatedFields }] }
 */
export const appExhibitorDiscoveryCompaniesEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const number = (name: string, fallback: number, max: number) =>
      Math.min(Math.max(Math.trunc(Number(req.searchParams.get(name))) || fallback, 1), max)
    const limit = number('limit', 50, MAX_ENRICHMENT_BATCH)
    const now = Date.now()
    const recheck = new Date(now - number('recheckDays', 180, 3650) * DAY_MS).toISOString()
    const retry = new Date(now - number('retryDays', 7, 365) * DAY_MS).toISOString()

    const { docs } = await req.payload.find({
      collection: 'companies',
      depth: 0,
      limit,
      overrideAccess: true,
      sort: ['enrichment.lastTriedAt', 'createdAt'],
      where: {
        and: [
          { locked: { not_equals: true } },
          { or: MISSING_FIELDS.map((field) => ({ [field]: { equals: null } })) },
          {
            or: [
              { 'enrichment.lastTriedAt': { equals: null } },
              { 'enrichment.lastTriedAt': { less_than: recheck } },
              {
                and: [
                  { 'enrichment.status': { equals: 'failed' } },
                  { 'enrichment.lastTriedAt': { less_than: retry } },
                ],
              },
            ],
          },
        ],
      },
    })

    return Response.json({
      companies: docs.map((company) => ({
        id: company.id,
        name: company.name,
        city: company.city ?? null,
        country: company.country ?? null,
        curatedFields: company.curatedFields ?? [],
        legalName: company.legalName ?? null,
        localName: company.localName ?? null,
        missing: MISSING_FIELDS.filter((field) => !company[field]),
        website: company.website ?? null,
        websiteFrom: company.website ? websiteSource(company) : null,
      })),
    })
  },
  method: 'get',
  path: '/app/exhibitor-discovery/companies',
}

/**
 * `POST /api/app/exhibitor-discovery/companies/:id/enrichment` - what the company's own website
 * showed (only what's in the page's text, checked by awoz-api), or what a web search suggests:
 *
 *   { "status": "done", "sourceUrl": "https://www.wingfat.com.hk/contact",
 *     "details": { "email": "…", "phone": "…", "address": "…", "city": "…", "description": "…",
 *                  "legalName": "…", "contactPageUrl": "…", "linkedinUrl": "…", … },
 *     "suggestions": { "website": "…", "email": "…", "phone": "…", "address": "…", "city": "…",
 *                      "sourceUrl": "…", "note": "…" } }
 *
 * Details are only taken from a page on the company's website as saved, when that website is from
 * the exhibitor list or the team: they fill in empty fields (never curated ones), each recorded as
 * from the company website. Suggestions are kept apart until the team accepts them, and only for a
 * company without a website. Answers `{ status, filled, conflicts, suggested, problems }`.
 */
export const appExhibitorDiscoveryEnrichmentEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const company = await findCompany(req)

    if (!company) {
      return Response.json({ errors: [{ message: 'Company not found.' }] }, { status: 404 })
    }

    const body = ((await req.json?.().catch(() => null)) ?? {}) as Record<string, unknown>
    let status = ENRICHMENT_STATUSES.find((value) => value === body.status)

    if (!status) {
      return badRequest(`status must be one of ${ENRICHMENT_STATUSES.join(', ')}.`, 'status')
    }

    const now = new Date().toISOString()
    const problems: string[] = []
    const data: Partial<Company> = {}
    let filled: string[] = []
    let conflicts: string[] = []
    const sourceUrl = httpUrl(body.sourceUrl)
    const found = body.details && typeof body.details === 'object' ? body.details : null

    if (found && !company.locked) {
      const readable = company.website && websiteSource(company) !== null
      const onSite =
        sourceUrl && company.website && websiteDomain(sourceUrl) === websiteDomain(company.website)

      if (!readable || !onSite) {
        problems.push(
          readable
            ? "The page isn't on the company's website: its details were left out."
            : "The company's website isn't from the exhibitor list or the team: its details were left out.",
        )
      } else {
        const { details, problems: cleaning } = cleanDetails({
          ...(found as FoundExhibitor),
          name: company.name,
          website: null,
        })

        problems.push(...cleaning)
        if (details) {
          const result = enrichment(existingDetails(company), details, company.curatedFields ?? [])

          delete result.patch.aliases
          Object.assign(data, result.patch)
          filled = result.filled
          conflicts = result.conflicts
          if (filled.length) {
            data.fieldSources = withSources(sourcesOf(company), filled, {
              confidence: 'high',
              seenAt: now,
              sourceKind: 'companyWebsite',
              sourceUrl,
            })
          }
        }
      }
    }

    const suggested = suggestionsOf(body.suggestions, company)

    if (suggested && !company.locked) {
      data.suggestions = { ...suggested, accept: false, foundAt: now }
    }

    if (status === 'done' && !filled.length) {
      status = 'nothingNew'
    }
    data.enrichment = {
      attempts: status === 'failed' ? (company.enrichment?.attempts ?? 0) + 1 : 0,
      lastTriedAt: now,
      status,
    }

    await req.payload.update({
      collection: 'companies',
      context: fromAwozApi,
      data,
      id: company.id,
      overrideAccess: true,
    })

    return Response.json({ conflicts, filled, problems, status, suggested: Boolean(suggested) })
  },
  method: 'post',
  path: '/app/exhibitor-discovery/companies/:id/enrichment',
}

/** Where the company's website is from: the list, its profile page, the team, or null (unknown) */
const websiteSource = (company: Company): null | SourceKind => {
  const entry = [...(company.fieldSources ?? [])].reverse().find((item) => item.field === 'website')

  if (entry) {
    return ['exhibitorList', 'exhibitorProfile', 'team', 'webSearch'].includes(entry.sourceKind)
      ? entry.sourceKind
      : null
  }
  // Saved before sources were recorded: the search only ever saved websites from exhibitor lists
  return company.foundBy === 'claude' ? 'exhibitorList' : 'team'
}

/** A web search's suggestions, as they may be kept; null without any, or for a company with a website */
const suggestionsOf = (value: unknown, company: Company) => {
  if (!value || typeof value !== 'object' || company.website) {
    return null
  }
  const found = value as Record<string, unknown>
  const { details } = cleanDetails({
    address: found.address as string,
    city: found.city as string,
    email: found.email as string,
    name: company.name,
    phone: found.phone as string,
    website: found.website as string,
  })
  const website = details?.website && websiteDomain(details.website) ? details.website : null
  const suggestion = {
    address: details?.address ?? null,
    city: details?.city ?? null,
    email: details?.email ?? null,
    note: text(found.note, 1000),
    phone: details?.phone ?? null,
    sourceUrl: httpUrl(found.sourceUrl),
    website,
  }

  return suggestion.website || suggestion.email || suggestion.phone || suggestion.address
    ? suggestion
    : null
}

const findCompany = async (req: PayloadRequest): Promise<Company | null> => {
  const id = req.routeParams?.id

  if (typeof id !== 'string' && typeof id !== 'number') {
    return null
  }
  try {
    return await req.payload.findByID({
      collection: 'companies',
      depth: 0,
      disableErrors: true,
      id,
      overrideAccess: true,
    })
  } catch {
    return null
  }
}

/** One exhibitor: its company found, made or filled in, then linked to the event */
const saveExhibitor = async ({
  eventId,
  exhibitor,
  req,
  runStartedAt,
}: {
  eventId: string
  exhibitor: FoundExhibitor
  req: PayloadRequest
  runStartedAt: Date
}): Promise<Outcome> => {
  const { details, problems } = cleanDetails(exhibitor)
  const sourceUrl = httpUrl(exhibitor.sourceUrl)
  const sourceKind: SourceKind =
    exhibitor.sourceKind === 'exhibitorProfile' ? 'exhibitorProfile' : 'exhibitorList'

  if (!details) {
    return { name: text(exhibitor.name) ?? '(no name)', problems }
  }
  if (!sourceUrl) {
    return { name: details.name, problems: [...problems, 'The source page is missing.'] }
  }

  const now = new Date().toISOString()
  const candidates = await findCandidates(req, details)
  const match = matchCompany(details, candidates)
  let company: Company
  let outcome: Outcome['company']
  let conflicts: string[] = []

  const source = { confidence: 'high' as const, seenAt: now, sourceKind, sourceUrl }

  if (match.kind === 'same') {
    const existing = candidates.find((candidate) => candidate.id === match.company.id)!
    const {
      conflicts: found,
      filled,
      patch,
    } = existing.locked
      ? { conflicts: [], filled: [], patch: {} }
      : enrichment(existingDetails(existing), details, existing.curatedFields ?? [])

    conflicts = found
    company = await req.payload.update({
      collection: 'companies',
      context: fromAwozApi,
      data: {
        ...patch,
        ...(filled.length
          ? { fieldSources: withSources(sourcesOf(existing), filled, source) }
          : {}),
        lastVerifiedAt: now,
        sourceUrl: existing.sourceUrl || sourceUrl,
      },
      id: existing.id,
      overrideAccess: true,
    })
    outcome = filled.length ? 'enriched' : 'matched'
  } else {
    company = await req.payload.create({
      collection: 'companies',
      context: fromAwozApi,
      data: {
        ...details,
        fieldSources: withSources([], filledFields(details), source),
        foundBy: 'claude',
        lastVerifiedAt: now,
        possibleDuplicates:
          match.kind === 'possible' ? match.companies.map((other) => other.id).slice(0, 10) : [],
        reviewStatus: match.kind === 'possible' ? 'possibleDuplicate' : 'ok',
        sourceUrl,
      },
      overrideAccess: true,
    })
    outcome = match.kind === 'possible' ? 'possibleDuplicate' : 'created'
  }

  const { exhibitorId, link } = await linkToEvent({
    booth: text(exhibitor.booth, 200),
    companyId: company.id,
    detailUrl: sourceKind === 'exhibitorProfile' ? sourceUrl : httpUrl(exhibitor.detailUrl),
    eventId,
    fromProfile: sourceKind === 'exhibitorProfile',
    hall: text(exhibitor.hall, 200),
    listedName: details.name,
    req,
    runStartedAt,
    sourceUrl,
  })

  return {
    company: outcome,
    companyId: company.id,
    ...(conflicts.length ? { conflicts } : {}),
    exhibitorId,
    link,
    name: details.name,
    ...(problems.length ? { problems } : {}),
  }
}

/** Companies the exhibitor may be: same match name, alias, website domain, or a distinctive word */
const findCandidates = async (req: PayloadRequest, details: CompanyDetails) => {
  const names = [details.name, details.localName].map(normalizeName).filter(Boolean)
  const domain = websiteDomain(details.website)
  const tokens = matchTokens([details.name, details.localName])
  const or: Where[] = [{ matchNames: { in: names } }]

  if (domain) {
    or.push({ matchDomain: { equals: domain } })
  }
  if (tokens.length) {
    or.push({ matchTokens: { in: tokens } })
  }

  const { docs } = await req.payload.find({
    collection: 'companies',
    depth: 0,
    limit: MAX_CANDIDATES,
    overrideAccess: true,
    pagination: false,
    where: { or },
  })

  return docs
}

const existingDetails = (company: Company): CompanyDetails => ({
  address: company.address,
  aliases: company.aliases,
  city: company.city,
  contactPageUrl: company.contactPageUrl,
  country: company.country,
  description: company.description,
  email: company.email,
  facebookUrl: company.facebookUrl,
  industry: categories(company.industry),
  instagramUrl: company.instagramUrl,
  legalName: company.legalName,
  linkedinUrl: company.linkedinUrl,
  localName: company.localName,
  name: company.name,
  otherLinks: company.otherLinks,
  phone: company.phone,
  website: company.website,
})

/** The fields with a value: those a new company gets from the page */
const filledFields = (details: CompanyDetails) =>
  [...TEXT_FIELDS, 'industry' as const, 'otherLinks' as const].filter((field) => {
    const value = details[field]

    return Array.isArray(value) ? value.length > 0 : Boolean(value)
  })

const sourcesOf = (company: Company): FieldSource[] => company.fieldSources ?? []

/**
 * The event–company link, made once. Found again, it's marked seen and listed; its stand follows the
 * list unless the team confirmed it. Listed twice on the same run (two stands), both stands are kept.
 */
const linkToEvent = async ({
  booth,
  companyId,
  detailUrl,
  eventId,
  fromProfile,
  hall,
  listedName,
  req,
  runStartedAt,
  sourceUrl,
}: {
  booth: null | string
  companyId: string
  detailUrl: null | string
  eventId: string
  /** From the exhibitor's own page: the list page stays the source */
  fromProfile: boolean
  hall: null | string
  listedName: string
  req: PayloadRequest
  runStartedAt: Date
  sourceUrl: string
}): Promise<{ exhibitorId: string; link: NonNullable<Outcome['link']> }> => {
  const update = { booth, detailUrl, fromProfile, hall, req, runStartedAt, sourceUrl }
  const now = new Date().toISOString()
  const existing = await findLink(req, eventId, companyId)

  if (!existing) {
    try {
      const created = await req.payload.create({
        collection: 'event-exhibitors',
        context: fromAwozApi,
        data: {
          attendanceStatus: 'listed',
          booth,
          company: companyId,
          detailUrl,
          discoveredAt: now,
          event: eventId,
          foundBy: 'claude',
          hall,
          lastVerifiedAt: now,
          listedName,
          sourceUrl,
        },
        overrideAccess: true,
      })

      return { exhibitorId: created.id, link: 'created' }
    } catch (error) {
      // Linked meanwhile, e.g. by another request: the unique index refused a second link
      const linked = await findLink(req, eventId, companyId)

      if (!linked) {
        throw error
      }
      return updateLink({ ...update, existing: linked, now })
    }
  }

  return updateLink({ ...update, existing, now })
}

const findLink = async (req: PayloadRequest, eventId: string, companyId: string) => {
  const { docs } = await req.payload.find({
    collection: 'event-exhibitors',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { and: [{ event: { equals: eventId } }, { company: { equals: companyId } }] },
  })

  return docs[0]
}

const updateLink = async ({
  booth,
  detailUrl,
  existing,
  fromProfile,
  hall,
  now,
  req,
  runStartedAt,
  sourceUrl,
}: {
  booth: null | string
  detailUrl: null | string
  existing: EventExhibitor
  fromProfile: boolean
  hall: null | string
  now: string
  req: PayloadRequest
  runStartedAt: Date
  sourceUrl: string
}): Promise<{ exhibitorId: string; link: 'unchanged' | 'updated' }> => {
  const data: Partial<EventExhibitor> = { lastVerifiedAt: now }

  if (detailUrl && !existing.detailUrl) {
    data.detailUrl = detailUrl
  }
  if (existing.attendanceStatus !== 'confirmed') {
    const seenThisRun = existing.lastVerifiedAt && new Date(existing.lastVerifiedAt) >= runStartedAt

    data.attendanceStatus = 'listed'
    data.withdrawnAt = null
    data.sourceUrl = fromProfile ? (existing.sourceUrl ?? sourceUrl) : sourceUrl
    data.booth = seenThisRun ? combine(existing.booth, booth) : (booth ?? existing.booth)
    data.hall = seenThisRun ? combine(existing.hall, hall) : (hall ?? existing.hall)
  }

  const changed =
    data.attendanceStatus !== undefined &&
    (data.attendanceStatus !== existing.attendanceStatus ||
      (data.booth ?? null) !== (existing.booth ?? null) ||
      (data.hall ?? null) !== (existing.hall ?? null))

  await req.payload.update({
    collection: 'event-exhibitors',
    context: fromAwozApi,
    data,
    id: existing.id,
    overrideAccess: true,
  })

  return { exhibitorId: existing.id, link: changed ? 'updated' : 'unchanged' }
}

/** "1A-01" and "3C-12" listed for one company on the same run: "1A-01, 3C-12" */
const combine = (current: null | string | undefined, found: null | string) => {
  if (!found) {
    return current ?? null
  }
  if (!current) {
    return found
  }
  const parts = current.split(', ')

  return parts.includes(found) ? current : [...parts, found].join(', ').slice(0, 200)
}

/**
 * After a complete run: the exhibitors it found listed before but not now are no longer on the list.
 * Only those the search added and the team hasn't confirmed, and only when the run found most of them.
 */
const withdrawUnlisted = async ({
  eventId,
  found,
  req,
  runStartedAt,
}: {
  eventId: string
  found: number
  req: PayloadRequest
  runStartedAt: Date
}) => {
  const listed: Where = {
    and: [
      { event: { equals: eventId } },
      { attendanceStatus: { equals: 'listed' } },
      { foundBy: { equals: 'claude' } },
    ],
  }
  const { totalDocs: listedBefore } = await req.payload.count({
    collection: 'event-exhibitors',
    overrideAccess: true,
    where: listed,
  })

  if (listedBefore === 0 || found < listedBefore * WITHDRAW_SHARE) {
    return 0
  }

  const { docs } = await req.payload.update({
    collection: 'event-exhibitors',
    context: fromAwozApi,
    data: { attendanceStatus: 'withdrawn', withdrawnAt: new Date().toISOString() },
    overrideAccess: true,
    where: {
      and: [
        ...(listed.and as Where[]),
        { lastVerifiedAt: { less_than: runStartedAt.toISOString() } },
      ],
    },
  })

  return docs.length
}

/** The company details as they may be saved, and what had to be left out */
const cleanDetails = (
  exhibitor: FoundExhibitor,
): { details: CompanyDetails | null; problems: string[] } => {
  const problems: string[] = []
  const name = text(exhibitor.name, 300)

  if (!name || normalizeName(name).length < 2) {
    return { details: null, problems: ['The name is missing.'] }
  }

  const email = text(exhibitor.email, 200)
  const website = text(exhibitor.website, 500)
  const phone = text(exhibitor.phone, 60)
  const details: CompanyDetails = {
    address: text(exhibitor.address, 500),
    city: text(exhibitor.city, 100),
    contactPageUrl: null,
    country: text(exhibitor.country, 100),
    description: text(exhibitor.description, 2000),
    email: null,
    industry: categories(exhibitor.industry),
    legalName: text(exhibitor.legalName, 300),
    localName: text(exhibitor.localName, 300),
    name,
    otherLinks: [],
    phone: null,
    website: null,
  }

  const contactPage = text(exhibitor.contactPageUrl, 1000)

  if (contactPage) {
    details.contactPageUrl = httpUrl(contactPage)
    if (!details.contactPageUrl) {
      problems.push(`"${contactPage}" isn't a web page: left out.`)
    }
  }
  for (const [field, hosts] of Object.entries(SOCIAL_HOSTS) as [
    keyof typeof SOCIAL_HOSTS,
    readonly string[],
  ][]) {
    const value = text(exhibitor[field], 500)
    const link = value ? httpUrl(/^https?:\/\//i.test(value) ? value : `https://${value}`) : null

    if (value && link && onHost(link, hosts)) {
      details[field] = link
    } else if (value) {
      problems.push(`"${value}" isn't a ${hosts[0]} page: left out.`)
    }
  }
  if (Array.isArray(exhibitor.otherLinks)) {
    details.otherLinks = [
      ...new Set(exhibitor.otherLinks.map(httpUrl).filter((url): url is string => Boolean(url))),
    ].slice(0, MAX_LIST_ITEMS)
  }

  if (email) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      details.email = email
    } else {
      problems.push(`"${email}" isn't an email address: left out.`)
    }
  }
  if (website) {
    const url = httpUrl(/^https?:\/\//i.test(website) ? website : `https://${website}`)

    if (url) {
      details.website = url
    } else {
      problems.push(`"${website}" isn't a website: left out.`)
    }
  }
  if (phone) {
    if (/^[+\d][\d\s().\-/ext]{5,}$/i.test(phone) && phone.replace(/\D/g, '').length >= 6) {
      details.phone = phone
    } else {
      problems.push(`"${phone}" isn't a phone number: left out.`)
    }
  }

  return { details, problems }
}

const findEvent = async (req: PayloadRequest): Promise<Event | null> => {
  const id = req.routeParams?.id

  if (typeof id !== 'string' && typeof id !== 'number') {
    return null
  }
  try {
    return await req.payload.findByID({
      collection: 'events',
      depth: 0,
      disableErrors: true,
      id,
      overrideAccess: true,
    })
  } catch {
    // Not an ID at all
    return null
  }
}

/** Saves the search fields, and the website check; the others, and the event's place, stay as they are */
const updateSearch = (
  req: PayloadRequest,
  event: Event,
  patch: Partial<Search>,
  website: Partial<Pick<Event, 'website' | 'websiteCheck'>> = {},
) =>
  req.payload.update({
    collection: 'events',
    context: fromAwozApi,
    data: { ...website, exhibitorSearch: { ...event.exhibitorSearch, ...patch } },
    id: event.id,
    overrideAccess: true,
  })

/** The official website awoz-api found, as it may be saved; null when it didn't report one */
const websiteReport = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const report = value as Record<string, unknown>

  return {
    note: text(report.note, 1000),
    sourceUrl: httpUrl(report.sourceUrl),
    url: httpUrl(report.url),
    verified: report.verified === true && Boolean(httpUrl(report.url)),
  }
}

const onHost = (url: string, hosts: readonly string[]) => {
  try {
    const host = new URL(url).hostname.toLowerCase()

    return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  } catch {
    return false
  }
}

const toDiscoveryEvent = (event: Partial<Event>) => {
  const timeZone = event.startDate_tz || 'UTC'
  const search = event.exhibitorSearch ?? {}

  const check = event.websiteCheck ?? {}

  return {
    id: event.id,
    name: event.name,
    city: event.location?.city ?? null,
    country: event.location?.country ?? null,
    edition: event.edition ?? null,
    endDate: event.endDate ? localDay(event.endDate, event.endDate_tz || timeZone) : null,
    organizer: event.organizer ?? null,
    search: {
      attempts: search.attempts ?? 0,
      claimedUntil: search.claimedUntil ?? null,
      complete: Boolean(search.complete),
      directoryUrl: search.directoryUrl ?? null,
      lastRunAt: search.lastRunAt ?? null,
      pagesRead: search.pagesRead ?? 0,
      pendingPages: search.pendingPages ?? [],
      readPages: search.readPages ?? [],
      resumeUrl: search.resumeUrl ?? null,
      skip: Boolean(search.skip),
      status: search.status ?? null,
    },
    startDate: event.startDate ? localDay(event.startDate, timeZone) : null,
    status: event.status,
    venue: event.location?.venue ?? null,
    website: event.website ?? null,
    websiteCheck: {
      checkedAt: check.checkedAt ?? null,
      sourceUrl: check.sourceUrl ?? null,
      status: check.status ?? null,
      suggestedUrl: check.suggestedUrl ?? null,
    },
  }
}

const text = (value: unknown, max = 300): null | string => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim().replace(/\s+/g, ' ')

  return trimmed ? trimmed.slice(0, max) : null
}

const httpUrl = (value: unknown): null | string => {
  const candidate = text(value, 1000)

  if (!candidate) {
    return null
  }
  try {
    const url = new URL(candidate)

    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

const notFound = () => Response.json({ errors: [{ message: 'Event not found.' }] }, { status: 404 })

const badRequest = (message: string, path: string) =>
  Response.json({ errors: [{ message, path }] }, { status: 400 })
