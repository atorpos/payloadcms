import type { Endpoint, PayloadRequest, Where } from 'payload'

import type { Company, Event, EventExhibitor } from '../payload-types'

import {
  type CompanyDetails,
  enrichment,
  matchCompany,
  matchTokens,
  normalizeName,
  websiteDomain,
} from '../exhibitors/companyMatching'
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

/** What awoz-api sends for each exhibitor: only what the list showed, checked against the page */
type FoundExhibitor = {
  address?: null | string
  booth?: null | string
  country?: null | string
  email?: null | string
  hall?: null | string
  industry?: null | string
  localName?: null | string
  name?: null | string
  phone?: null | string
  sourceUrl?: null | string
  website?: null | string
}

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
 *   { events: [{ id, name, startDate: "2027-03-04", endDate, venue, city, country, organizer, website,
 *                search: { status, directoryUrl, resumeUrl, lastRunAt, attempts, claimedUntil, skip } }] }
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
        endDate: true,
        endDate_tz: true,
        exhibitorSearch: true,
        location: { city: true, country: true, venue: true },
        organizer: true,
        startDate: true,
        startDate_tz: true,
        status: true,
        website: true,
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
 *   { "status": "found", "directoryUrl": "https://…", "resumeUrl": null, "found": 412, "saved": 410,
 *     "attempts": 0, "problems": "…", "complete": true, "runStartedAt": "2026-11-16T03:20:00Z" }
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
    for (const field of ['found', 'saved', 'attempts'] as const) {
      if (typeof body[field] === 'number' && Number.isFinite(body[field])) {
        patch[field] = Math.max(0, Math.round(body[field]))
      }
    }
    if (body.problems !== undefined) {
      patch.problems = text(body.problems, 4000)
    }

    const updated = await updateSearch(req, event, patch)
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
 *                      "booth": "1C-B01", "hall": "Hall 1", "sourceUrl": "https://…/exhibitors?page=2" }] }
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

  if (match.kind === 'same') {
    const existing = candidates.find((candidate) => candidate.id === match.company.id)!
    const { conflicts: found, patch } = existing.locked
      ? { conflicts: [], patch: {} }
      : enrichment(existingDetails(existing), details)

    conflicts = found
    company = await req.payload.update({
      collection: 'companies',
      context: fromAwozApi,
      data: {
        ...patch,
        lastVerifiedAt: now,
        sourceUrl: existing.sourceUrl || sourceUrl,
      },
      id: existing.id,
      overrideAccess: true,
    })
    outcome = Object.keys(patch).length ? 'enriched' : 'matched'
  } else {
    company = await req.payload.create({
      collection: 'companies',
      context: fromAwozApi,
      data: {
        ...details,
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
    eventId,
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
  country: company.country,
  email: company.email,
  industry: company.industry,
  localName: company.localName,
  name: company.name,
  phone: company.phone,
  website: company.website,
})

/**
 * The event–company link, made once. Found again, it's marked seen and listed; its stand follows the
 * list unless the team confirmed it. Listed twice on the same run (two stands), both stands are kept.
 */
const linkToEvent = async ({
  booth,
  companyId,
  eventId,
  hall,
  listedName,
  req,
  runStartedAt,
  sourceUrl,
}: {
  booth: null | string
  companyId: string
  eventId: string
  hall: null | string
  listedName: string
  req: PayloadRequest
  runStartedAt: Date
  sourceUrl: string
}): Promise<{ exhibitorId: string; link: NonNullable<Outcome['link']> }> => {
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
      return updateLink({ booth, existing: linked, hall, now, req, runStartedAt, sourceUrl })
    }
  }

  return updateLink({ booth, existing, hall, now, req, runStartedAt, sourceUrl })
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
  existing,
  hall,
  now,
  req,
  runStartedAt,
  sourceUrl,
}: {
  booth: null | string
  existing: EventExhibitor
  hall: null | string
  now: string
  req: PayloadRequest
  runStartedAt: Date
  sourceUrl: string
}): Promise<{ exhibitorId: string; link: 'unchanged' | 'updated' }> => {
  const data: Partial<EventExhibitor> = { lastVerifiedAt: now }

  if (existing.attendanceStatus !== 'confirmed') {
    const seenThisRun = existing.lastVerifiedAt && new Date(existing.lastVerifiedAt) >= runStartedAt

    data.attendanceStatus = 'listed'
    data.sourceUrl = sourceUrl
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
    data: { attendanceStatus: 'withdrawn' },
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
    country: text(exhibitor.country, 100),
    email: null,
    industry: text(exhibitor.industry, 200),
    localName: text(exhibitor.localName, 300),
    name,
    phone: null,
    website: null,
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

/** Saves the search fields; the others, and the event's place, stay as they are */
const updateSearch = (req: PayloadRequest, event: Event, patch: Partial<Search>) =>
  req.payload.update({
    collection: 'events',
    context: fromAwozApi,
    data: { exhibitorSearch: { ...event.exhibitorSearch, ...patch } },
    id: event.id,
    overrideAccess: true,
  })

const toDiscoveryEvent = (event: Partial<Event>) => {
  const timeZone = event.startDate_tz || 'UTC'
  const search = event.exhibitorSearch ?? {}

  return {
    id: event.id,
    name: event.name,
    city: event.location?.city ?? null,
    country: event.location?.country ?? null,
    endDate: event.endDate ? localDay(event.endDate, event.endDate_tz || timeZone) : null,
    organizer: event.organizer ?? null,
    search: {
      attempts: search.attempts ?? 0,
      claimedUntil: search.claimedUntil ?? null,
      directoryUrl: search.directoryUrl ?? null,
      lastRunAt: search.lastRunAt ?? null,
      resumeUrl: search.resumeUrl ?? null,
      skip: Boolean(search.skip),
      status: search.status ?? null,
    },
    startDate: event.startDate ? localDay(event.startDate, timeZone) : null,
    status: event.status,
    venue: event.location?.venue ?? null,
    website: event.website ?? null,
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
