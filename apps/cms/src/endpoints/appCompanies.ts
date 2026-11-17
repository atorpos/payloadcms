import type { Endpoint, PayloadRequest, Where } from 'payload'

import type { Company, Event, EventExhibitor } from '../payload-types'

import { categories } from '../exhibitors/companyMatching'
import { localDay } from '../zonedTime'
import { refuseWithoutAppApiKey } from './appApiKey'

/**
 * Companies and the events they exhibit at, for the VgemsAI app's backend (awoz-api), which caches
 * them and passes them on to the app. Server to server only, with `X-API-Key: <APP_API_KEY>`
 * (./appApiKey.ts); while APP_API_KEY is empty they answer 404.
 *
 *   GET /api/app/events/:id/exhibitors   an event's exhibitors, with their companies
 *   GET /api/app/companies               the company catalog
 *   GET /api/app/companies/:id           a company and its events
 *   GET /api/app/companies/:id/events    the editions it exhibited at, newest first, page by page
 *
 * Only what an exhibitor list or the company's website publishes leaves the CMS (names, country, city,
 * address, phone, email, website, contact page, social media, categories, description, source): never
 * the review fields, sources, suggestions, aliases or who added it. Lists take `page` (from 1),
 * `limit` (1 to 100, 50 by default) and `sort` (see each), and answer as Payload's REST API does:
 * `{ docs, totalDocs, page, limit, totalPages, hasNextPage }`.
 */

/** The orders a list can be sorted in, and Payload's sort for each */
const COMPANY_SORTS: Record<string, string[]> = {
  '-lastVerifiedAt': ['-lastVerifiedAt', 'name'],
  '-name': ['-name'],
  country: ['country', 'name'],
  name: ['name'],
}
const EXHIBITOR_SORTS: Record<string, string[]> = {
  '-listedName': ['-listedName'],
  booth: ['booth', 'listedName'],
  listedName: ['listedName'],
}

const MAX_LIMIT = 100

/**
 * `GET /api/app/events/:id/exhibitors?search=&country=&hall=&sort=&page=&limit=` - who exhibits, by
 * listed name (`sort`: listedName, -listedName or booth); `search` looks in the listed and company
 * names and the booth; withdrawn exhibitors are left out. Also answers the event, and each country
 * with how many exhibitors, for a country filter:
 *
 *   { event: { id, name, edition, exhibitorListUrl }, docs: [{ id, listedName, booth, hall,
 *     attendanceStatus, discoveredAt, lastVerifiedAt, company: {…} }],
 *     countries: [{ country: "Hong Kong", count: 120 }], totalDocs, page, … }
 */
export const appEventExhibitorsEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const event = await findById<Event>(req, 'events')

    if (!event || event.status === 'cancelled') {
      return notFound('Event')
    }

    const search = param(req, 'search')
    const country = param(req, 'country')
    const hall = param(req, 'hall')
    const base: Where[] = [
      { event: { equals: event.id } },
      { attendanceStatus: { not_equals: 'withdrawn' } },
    ]
    const filters: Where[] = [...base]

    if (search) {
      filters.push({
        or: [
          { listedName: { like: search } },
          { 'company.name': { like: search } },
          { 'company.localName': { like: search } },
          { booth: { like: search } },
        ],
      })
    }
    if (country) {
      filters.push({ 'company.country': { equals: country } })
    }
    if (hall) {
      filters.push({ hall: { equals: hall } })
    }

    const { limit, page } = paging(req)
    const result = await req.payload.find({
      collection: 'event-exhibitors',
      depth: 1,
      limit,
      overrideAccess: true,
      page,
      sort: EXHIBITOR_SORTS[param(req, 'sort') ?? ''] ?? EXHIBITOR_SORTS.listedName,
      where: { and: filters },
    })

    return Response.json({
      ...pageOf(result),
      countries: await countriesOf(req, base),
      docs: result.docs.map((exhibitor) => ({
        ...publicLink(exhibitor),
        company: publicCompany(exhibitor.company as Company),
      })),
      event: {
        id: event.id,
        name: event.name,
        edition: event.edition ?? null,
        exhibitorListUrl: event.exhibitorSearch?.directoryUrl ?? null,
      },
    })
  },
  method: 'get',
  path: '/app/events/:id/exhibitors',
}

/**
 * `GET /api/app/companies?search=&country=&industry=&event=&sort=&page=&limit=` - companies by name
 * (`sort`: name, -name, country or -lastVerifiedAt); `search` looks in the names and website,
 * `industry` in the categories, and `event` keeps those exhibiting at that event.
 */
export const appCompaniesEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const filters: Where[] = []
    const search = param(req, 'search')
    const country = param(req, 'country')
    const industry = param(req, 'industry')
    const eventId = param(req, 'event')

    if (search) {
      filters.push({
        or: [
          { name: { like: search } },
          { localName: { like: search } },
          { legalName: { like: search } },
          { website: { like: search } },
        ],
      })
    }
    if (country) {
      filters.push({ country: { equals: country } })
    }
    if (industry) {
      filters.push({ industry: { like: industry } })
    }
    if (eventId) {
      const { docs } = await req.payload.find({
        collection: 'event-exhibitors',
        depth: 0,
        overrideAccess: true,
        pagination: false,
        select: { company: true },
        where: {
          and: [{ event: { equals: eventId } }, { attendanceStatus: { not_equals: 'withdrawn' } }],
        },
      })

      filters.push({ id: { in: docs.map((link) => idOf(link.company)) } })
    }

    const { limit, page } = paging(req)
    const result = await req.payload.find({
      collection: 'companies',
      depth: 0,
      limit,
      overrideAccess: true,
      page,
      sort: COMPANY_SORTS[param(req, 'sort') ?? ''] ?? COMPANY_SORTS.name,
      where: filters.length ? { and: filters } : {},
    })

    return Response.json({ ...pageOf(result), docs: result.docs.map(publicCompany) })
  },
  method: 'get',
  path: '/app/companies',
}

/**
 * `GET /api/app/companies/:id` - the company and the events it exhibits at, soonest first, withdrawn
 * and cancelled ones left out:
 *
 *   { company: {…}, events: [{ id, name, edition, startDate, startDate_tz, endDate, city, country,
 *                              website, listedName, booth, hall, attendanceStatus, discoveredAt,
 *                              lastVerifiedAt }] }
 */
export const appCompanyEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const company = await findById<Company>(req, 'companies')

    if (!company) {
      return notFound('Company')
    }

    const { docs } = await req.payload.find({
      collection: 'event-exhibitors',
      depth: 1,
      overrideAccess: true,
      pagination: false,
      where: {
        and: [
          { company: { equals: company.id } },
          { attendanceStatus: { not_equals: 'withdrawn' } },
        ],
      },
    })
    const events = docs
      .map((link) => ({ event: link.event as Event, link }))
      .filter(({ event }) => event && typeof event === 'object' && event.status !== 'cancelled')
      .sort((a, b) => Date.parse(a.event.startDate) - Date.parse(b.event.startDate))
      .map(({ event, link }) => companyEvent(event, link))

    return Response.json({ company: publicCompany(company), events })
  },
  method: 'get',
  path: '/app/companies/:id',
}

/**
 * `GET /api/app/companies/:id/events?page=&limit=` - the editions the company exhibited at, newest
 * first, past ones included: its history. Withdrawn and cancelled ones are left out.
 *
 *   { company: { id, name }, docs: [{ id, name, edition, startDate, …, discoveredAt, lastVerifiedAt }],
 *     totalDocs, page, … }
 */
export const appCompanyEventsEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const company = await findById<Company>(req, 'companies')

    if (!company) {
      return notFound('Company')
    }

    // A company exhibits at a few dozen editions at most: all of them, then the page asked for
    const { docs: links } = await req.payload.find({
      collection: 'event-exhibitors',
      depth: 1,
      overrideAccess: true,
      pagination: false,
      populate: {
        events: {
          name: true,
          edition: true,
          endDate: true,
          endDate_tz: true,
          location: true,
          startDate: true,
          startDate_tz: true,
          status: true,
          website: true,
        },
      },
      where: {
        and: [
          { company: { equals: company.id } },
          { attendanceStatus: { not_equals: 'withdrawn' } },
        ],
      },
    })
    const all = links
      .map((link) => ({ event: link.event as Event, link }))
      .filter(({ event }) => event && typeof event === 'object' && event.status !== 'cancelled')
      .sort((a, b) => Date.parse(b.event.startDate) - Date.parse(a.event.startDate))
    const { limit, page } = paging(req)
    const totalPages = Math.max(1, Math.ceil(all.length / limit))
    const docs = all
      .slice((page - 1) * limit, page * limit)
      .map(({ event, link }) => companyEvent(event, link))
    const result = {
      hasNextPage: page < totalPages,
      limit,
      page,
      totalDocs: all.length,
      totalPages,
    }

    return Response.json({
      ...pageOf(result),
      company: { id: company.id, name: company.name },
      docs,
    })
  },
  method: 'get',
  path: '/app/companies/:id/events',
}

/** An edition the company exhibits at, with its stand and when the search saw it there */
const companyEvent = (event: Event, link: EventExhibitor) => ({
  id: event.id,
  name: event.name,
  ...publicLink(link),
  city: event.location?.city ?? null,
  country: event.location?.country ?? null,
  edition:
    event.edition ??
    (event.startDate ? localDay(event.startDate, event.startDate_tz || 'UTC').slice(0, 4) : null),
  endDate: event.endDate ?? null,
  startDate: event.startDate,
  startDate_tz: event.startDate_tz ?? null,
  website: event.website ?? null,
})

/** Copies only the public fields, so a field added to Companies later never leaks by accident */
const publicCompany = (company: Company) => {
  const industries = categories(company.industry)

  return {
    id: company.id,
    name: company.name,
    address: textOrNull(company.address),
    city: textOrNull(company.city),
    contactPageUrl: textOrNull(company.contactPageUrl),
    country: textOrNull(company.country),
    description: textOrNull(company.description),
    email: textOrNull(company.email),
    facebookUrl: textOrNull(company.facebookUrl),
    industries,
    // As text, for app versions that show one category line
    industry: industries.length ? industries.join(', ') : null,
    instagramUrl: textOrNull(company.instagramUrl),
    lastVerifiedAt: textOrNull(company.lastVerifiedAt),
    legalName: textOrNull(company.legalName),
    linkedinUrl: textOrNull(company.linkedinUrl),
    localName: textOrNull(company.localName),
    otherLinks: (company.otherLinks ?? []).filter((link) => textOrNull(link)),
    phone: textOrNull(company.phone),
    sourceUrl: textOrNull(company.sourceUrl),
    updatedAt: company.updatedAt,
    website: textOrNull(company.website),
  }
}

const publicLink = (link: EventExhibitor) => ({
  attendanceStatus: link.attendanceStatus,
  booth: textOrNull(link.booth),
  detailUrl: textOrNull(link.detailUrl),
  discoveredAt: textOrNull(link.discoveredAt),
  hall: textOrNull(link.hall),
  exhibitorId: link.id,
  lastVerifiedAt: textOrNull(link.lastVerifiedAt),
  listedName: link.listedName,
  sourceUrl: textOrNull(link.sourceUrl),
})

/** Blank text (a field the team emptied) is null, as for a field never filled in */
const textOrNull = (value: null | string | undefined) =>
  typeof value === 'string' && value.trim() ? value : null

/** Each country of the event's exhibitors, most exhibitors first */
const countriesOf = async (req: PayloadRequest, where: Where[]) => {
  const { docs } = await req.payload.find({
    collection: 'event-exhibitors',
    depth: 1,
    overrideAccess: true,
    pagination: false,
    populate: { companies: { country: true } },
    select: { company: true },
    where: { and: where },
  })
  const counts = new Map<string, number>()

  for (const link of docs) {
    const country = typeof link.company === 'object' ? link.company?.country : null

    if (country) {
      counts.set(country, (counts.get(country) ?? 0) + 1)
    }
  }

  return [...counts]
    .map(([country, count]) => ({ count, country }))
    .sort((a, b) => b.count - a.count || a.country.localeCompare(b.country))
}

const pageOf = (result: {
  hasNextPage: boolean
  limit: number
  page?: number
  totalDocs: number
  totalPages: number
}) => ({
  hasNextPage: result.hasNextPage,
  limit: result.limit,
  page: result.page ?? 1,
  totalDocs: result.totalDocs,
  totalPages: result.totalPages,
})

const paging = (req: PayloadRequest) => ({
  limit: Math.min(Math.max(Math.trunc(Number(req.searchParams.get('limit'))) || 50, 1), MAX_LIMIT),
  page: Math.max(Math.trunc(Number(req.searchParams.get('page'))) || 1, 1),
})

const param = (req: PayloadRequest, name: string) => {
  const value = req.searchParams.get(name)?.trim()

  return value ? value.slice(0, 200) : null
}

const idOf = (value: unknown) =>
  value && typeof value === 'object' ? (value as { id: string }).id : (value as string)

const findById = async <T>(req: PayloadRequest, collection: 'companies' | 'events') => {
  const id = req.routeParams?.id

  if (typeof id !== 'string' && typeof id !== 'number') {
    return null
  }
  try {
    return (await req.payload.findByID({
      collection,
      depth: 0,
      disableErrors: true,
      id,
      overrideAccess: true,
    })) as null | T
  } catch {
    return null
  }
}

const notFound = (what: string) =>
  Response.json({ errors: [{ message: `${what} not found.` }] }, { status: 404 })
