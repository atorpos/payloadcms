import type { Endpoint, PayloadRequest, Where } from 'payload'

import type { Company, Event, EventExhibitor } from '../payload-types'

import { refuseWithoutAppApiKey } from './appApiKey'

/**
 * Companies and the events they exhibit at, for the VgemsAI app's backend (awoz-api), which caches
 * them and passes them on to the app. Server to server only, with `X-API-Key: <APP_API_KEY>`
 * (./appApiKey.ts); while APP_API_KEY is empty they answer 404.
 *
 *   GET /api/app/events/:id/exhibitors   an event's exhibitors, with their companies
 *   GET /api/app/companies               the company catalog
 *   GET /api/app/companies/:id           a company and its events
 *
 * Only what an exhibitor list publishes leaves the CMS (name, other name, country, address, phone,
 * email, website, category, source): never the review fields, aliases or who added it. Lists take
 * `page` (from 1) and `limit` (1 to 100, 50 by default) and answer as Payload's REST API does:
 * `{ docs, totalDocs, page, limit, totalPages, hasNextPage }`.
 */

const MAX_LIMIT = 100

/**
 * `GET /api/app/events/:id/exhibitors?search=&country=&hall=&page=&limit=` - who exhibits, by listed
 * name; `search` looks in the listed and company names and the booth; withdrawn exhibitors are left
 * out. Also answers the event, and each country with how many exhibitors, for a country filter:
 *
 *   { event: { id, name }, docs: [{ id, listedName, booth, hall, attendanceStatus, company: {…} }],
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
      sort: 'listedName',
      where: { and: filters },
    })

    return Response.json({
      ...pageOf(result),
      countries: await countriesOf(req, base),
      docs: result.docs.map((exhibitor) => ({
        ...publicLink(exhibitor),
        company: publicCompany(exhibitor.company as Company),
      })),
      event: { id: event.id, name: event.name },
    })
  },
  method: 'get',
  path: '/app/events/:id/exhibitors',
}

/**
 * `GET /api/app/companies?search=&country=&industry=&event=&page=&limit=` - companies by name; `search`
 * looks in the name, other name and website, `industry` in the category, and `event` keeps those
 * exhibiting at that event.
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
      sort: 'name',
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
 *   { company: {…}, events: [{ id, name, startDate, startDate_tz, endDate, city, country, website,
 *                              listedName, booth, hall, attendanceStatus }] }
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
      .map(({ event, link }) => ({
        id: event.id,
        name: event.name,
        ...publicLink(link),
        city: event.location?.city ?? null,
        country: event.location?.country ?? null,
        endDate: event.endDate ?? null,
        startDate: event.startDate,
        startDate_tz: event.startDate_tz ?? null,
        website: event.website ?? null,
      }))

    return Response.json({ company: publicCompany(company), events })
  },
  method: 'get',
  path: '/app/companies/:id',
}

/** Copies only the public fields, so a field added to Companies later never leaks by accident */
const publicCompany = (company: Company) => ({
  id: company.id,
  name: company.name,
  address: company.address ?? null,
  country: company.country ?? null,
  email: company.email ?? null,
  industry: company.industry ?? null,
  lastVerifiedAt: company.lastVerifiedAt ?? null,
  localName: company.localName ?? null,
  phone: company.phone ?? null,
  sourceUrl: company.sourceUrl ?? null,
  updatedAt: company.updatedAt,
  website: company.website ?? null,
})

const publicLink = (link: EventExhibitor) => ({
  attendanceStatus: link.attendanceStatus,
  booth: link.booth ?? null,
  hall: link.hall ?? null,
  exhibitorId: link.id,
  listedName: link.listedName,
  sourceUrl: link.sourceUrl ?? null,
})

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
