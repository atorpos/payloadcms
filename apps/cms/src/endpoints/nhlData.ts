import type { Endpoint, PayloadRequest } from 'payload'

import { hockeyApi, HockeyApiError } from '../nhl/hockeyApi'

/**
 * What the NHL data screens (src/components/NhlData) save: changes to the NHL data in the HockeyPoolCap API's
 * PostgreSQL database, sent on with its admin key (src/nhl/hockeyApi.ts). Only for logged-in users (src/proxy.ts
 * also asks them for their two-factor code). Errors answer `{ errors: [{ message }], fieldErrors: { field: message } }`.
 */

/** `PATCH /api/nhl-data/teams/:abbreviation`: `{ name, city, conference, division, keptFields }`, only what changed */
export const nhlTeamSaveEndpoint: Endpoint = {
  handler: async (req) => {
    const abbreviation = String(req.routeParams?.abbreviation ?? '')

    if (!/^[A-Za-z]{2,5}$/.test(abbreviation)) {
      return notFound()
    }

    return forward(req, 'PATCH', `/api/v1/admin/teams/${abbreviation.toUpperCase()}`)
  },
  method: 'patch',
  path: '/nhl-data/teams/:abbreviation',
}

/** `PATCH /api/nhl-data/players/:id`: the player's fields that changed, and `keptFields` */
export const nhlPlayerSaveEndpoint: Endpoint = {
  handler: async (req) => {
    const id = playerID(req)

    return id ? forward(req, 'PATCH', `/api/v1/admin/players/${id}`) : notFound()
  },
  method: 'patch',
  path: '/nhl-data/players/:id',
}

/** `PUT /api/nhl-data/players/:id/stats/:season`: all his stats that season, which replace what was there */
export const nhlPlayerStatsSaveEndpoint: Endpoint = {
  handler: async (req) => {
    const id = playerID(req)
    const season = routeSeason(req)

    return id && season ? forward(req, 'PUT', `/api/v1/admin/players/${id}/stats/${season}`) : notFound()
  },
  method: 'put',
  path: '/nhl-data/players/:id/stats/:season',
}

/** `DELETE /api/nhl-data/players/:id/stats/:season`: `204` */
export const nhlPlayerStatsDeleteEndpoint: Endpoint = {
  handler: async (req) => {
    const id = playerID(req)
    const season = routeSeason(req)

    return id && season ? forward(req, 'DELETE', `/api/v1/admin/players/${id}/stats/${season}`) : notFound()
  },
  method: 'delete',
  path: '/nhl-data/players/:id/stats/:season',
}

/**
 * `PUT /api/nhl-data/players/:id/career`: the player's whole researched career, which replaces what's stored (his
 * contracts included). Answers it as stored, with `warnings` for what the API couldn't use.
 */
export const nhlCareerSaveEndpoint: Endpoint = {
  handler: async (req) => {
    const id = playerID(req)

    return id ? forward(req, 'PUT', `/api/v1/admin/players/${id}/career`) : notFound()
  },
  method: 'put',
  path: '/nhl-data/players/:id/career',
}

/** `PUT /api/nhl-data/players/:id/career/status`: `{ researchStatus: 'VERIFIED' }` marks it checked */
export const nhlCareerStatusEndpoint: Endpoint = {
  handler: async (req) => {
    const id = playerID(req)

    return id ? forward(req, 'PUT', `/api/v1/admin/players/${id}/career/status`) : notFound()
  },
  method: 'put',
  path: '/nhl-data/players/:id/career/status',
}

/** `POST /api/nhl-data/teams/:abbreviation/cap-summaries`: works out and stores the team's cap this season and next */
export const nhlCapSummariesEndpoint: Endpoint = {
  handler: async (req) => {
    const abbreviation = String(req.routeParams?.abbreviation ?? '')

    if (!/^[A-Za-z]{2,5}$/.test(abbreviation)) {
      return notFound()
    }

    return forward(req, 'POST', `/api/v1/admin/cap-summaries?team=${abbreviation.toUpperCase()}`, { body: false })
  },
  method: 'post',
  path: '/nhl-data/teams/:abbreviation/cap-summaries',
}

/** Sends the request's JSON body on to the API and answers what it answered */
const forward = async (
  req: PayloadRequest,
  method: string,
  path: string,
  { body: hasBody = method !== 'DELETE' }: { body?: boolean } = {},
) => {
  if (!req.user) {
    return Response.json({ errors: [{ message: 'Log in to change the NHL data.' }] }, { status: 401 })
  }

  let body: unknown

  if (hasBody) {
    body = await req.json?.().catch(() => null)

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ errors: [{ message: 'The body must be a JSON object.' }] }, { status: 400 })
    }
  }

  try {
    const answer = await hockeyApi<unknown>(path, { body, method })

    return answer === undefined ? new Response(null, { status: 204 }) : Response.json(answer)
  } catch (error) {
    if (error instanceof HockeyApiError) {
      return Response.json(
        { errors: [{ message: error.message }], fieldErrors: error.fieldErrors },
        { status: error.status },
      )
    }

    throw error
  }
}

const playerID = (req: PayloadRequest) => {
  const id = String(req.routeParams?.id ?? '')

  return /^\d{1,18}$/.test(id) ? id : null
}

const routeSeason = (req: PayloadRequest) => {
  const season = String(req.routeParams?.season ?? '')

  return /^\d{4}$/.test(season) ? season : null
}

const notFound = () => Response.json({ errors: [{ message: 'Not Found' }] }, { status: 404 })
