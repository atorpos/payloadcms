import type { Endpoint, PayloadRequest } from 'payload'

import type { HockeyFantasyLeague } from '../payload-types'

import { refuseWithoutHockeyApiKey } from './hockeyMembers'

/**
 * The fantasy leagues' stored team points, for the HockeyPoolCap API's nightly count: every night at 3:30 Eastern it
 * reads every league, works out each team's points for the days since it last counted (from the games, for the
 * players on the team then), and adds them here. Points earned stay with the team that earned them, whatever trades
 * come after. Admins correct a total on the league (Total Points); the next night adds to what they set.
 *
 * Server to server only, with `X-API-Key: <HOCKEY_API_KEY>` like src/endpoints/hockeyMembers.ts.
 */

/** Leagues per page of the list */
const MAX_PAGE = 100

/** Lines of a team's Points by Day kept: about a season */
const MAX_LOG = 220

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * `GET /api/hockey/fantasy-leagues?page=1&limit=50` - every league, a page at a time, oldest first:
 *
 *   { docs: [{ id, name, teams: [{ id, name, points, pointsThrough, playerIds: [12, 40] }] }],
 *     page: 1, hasNextPage: false }
 *
 * `points` and `pointsThrough` are null for a team not counted yet.
 */
export const hockeyFantasyLeaguesEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutHockeyApiKey(req)

    if (refused) {
      return refused
    }

    const page = positive(req.searchParams.get('page')) ?? 1
    const limit = Math.min(positive(req.searchParams.get('limit')) ?? 50, MAX_PAGE)
    const result = await req.payload.find({
      collection: 'hockey-fantasy-leagues',
      depth: 0,
      limit,
      overrideAccess: true,
      page,
      sort: 'createdAt',
    })

    return Response.json({
      docs: result.docs.map((league) => ({
        id: league.id,
        name: league.name,
        teams: (league.teams ?? []).map((team) => ({
          id: team.id ?? null,
          name: team.name,
          playerIds: (team.players ?? []).map((player) => player.playerId),
          points: typeof team.points === 'number' ? team.points : null,
          pointsThrough: team.pointsThrough ?? null,
        })),
      })),
      hasNextPage: result.hasNextPage,
      page: result.page ?? page,
    })
  },
  method: 'get',
  path: '/hockey/fantasy-leagues',
}

/** One team's count, as the API sends it */
type TeamPoints = {
  /** Each day's points, oldest first: added to the total */
  days?: unknown
  /** The day the API saw it counted through: null for a team not counted yet */
  from?: unknown
  /** For a team not counted yet: its starting total, the players' points so far */
  start?: unknown
  teamId?: unknown
  /** The last day this count covers */
  through?: unknown
}

/**
 * `POST /api/hockey/fantasy-leagues/:id/points` - adds a count to the league's teams:
 *
 *   { teams: [{ teamId, from: "2026-11-09", through: "2026-11-10", days: [{ date: "2026-11-10", points: 12 }] },
 *             { teamId, from: null, through: "2026-11-10", start: 266 }] }
 *
 * A team counted before gets each day's points added to its total; one not counted yet starts at `start`. Either way
 * it's then counted through `through`. A team whose `pointsThrough` isn't `from` any more (counted already, e.g. the
 * count ran twice) is left as it is, so a count is never added twice. Answers how each team went:
 *
 *   { teams: [{ teamId, status: "added" | "skipped" | "missing", points }] }
 *
 * `404` when the league is gone; `400` for a body that doesn't fit.
 */
export const hockeyFantasyPointsAddEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutHockeyApiKey(req)

    if (refused) {
      return refused
    }

    const body = (await req.json?.().catch(() => null)) as null | { teams?: unknown }

    if (!body || !Array.isArray(body.teams)) {
      return badRequest('teams must be a list.', 'teams')
    }

    const counts = new Map<string, Count>()

    for (const [index, team] of (body.teams as unknown[]).entries()) {
      const count = countOf((team ?? {}) as TeamPoints, `teams.${index}`)

      if (typeof count === 'string') {
        return badRequest(count, `teams.${index}`)
      }
      counts.set(count.teamId, count)
    }

    const league = await findLeague(req)

    if (!league) {
      return Response.json({ errors: [{ message: 'Fantasy league not found.' }] }, { status: 404 })
    }

    const results: { points: null | number; status: string; teamId: string }[] = []
    const found = new Set<string>()
    const teams = (league.teams ?? []).map((team) => {
      const count = team.id ? counts.get(team.id) : undefined

      if (!count || !team.id) {
        return team
      }
      found.add(team.id)

      if ((team.pointsThrough ?? null) !== count.from) {
        results.push({ points: team.points ?? null, status: 'skipped', teamId: team.id })
        return team
      }

      const added =
        count.from === null
          ? [{ date: count.through, note: 'Starting total', points: count.start ?? 0 }]
          : count.days.map((day) => ({ date: day.date, note: null, points: day.points }))
      const points =
        count.from === null
          ? (count.start ?? 0)
          : (team.points ?? 0) + count.days.reduce((sum, day) => sum + day.points, 0)

      results.push({ points, status: 'added', teamId: team.id })

      return {
        ...team,
        points,
        pointsLog: [...(team.pointsLog ?? []), ...added].slice(-MAX_LOG),
        pointsThrough: count.through,
      }
    })

    for (const teamId of counts.keys()) {
      if (!found.has(teamId)) {
        results.push({ points: null, status: 'missing', teamId })
      }
    }

    if (results.some((result) => result.status === 'added')) {
      await req.payload.update({
        id: league.id,
        collection: 'hockey-fantasy-leagues',
        data: { teams },
        depth: 0,
        // Private collection: the API key check replaces the logged-in check
        overrideAccess: true,
      })
    }

    return Response.json({ teams: results })
  },
  method: 'post',
  path: '/hockey/fantasy-leagues/:id/points',
}

type Count = {
  days: { date: string; points: number }[]
  from: null | string
  start: null | number
  teamId: string
  through: string
}

/** The count from the body, or what's wrong with it */
const countOf = (team: TeamPoints, path: string): Count | string => {
  if (typeof team.teamId !== 'string' || !team.teamId) {
    return `${path}.teamId must be the team's ID.`
  }
  if (typeof team.through !== 'string' || !DAY.test(team.through)) {
    return `${path}.through must be a day, e.g. 2026-11-10.`
  }
  if (team.from !== null && (typeof team.from !== 'string' || !DAY.test(team.from))) {
    return `${path}.from must be a day, or null for a team not counted yet.`
  }
  if (team.from === null) {
    if (!isWhole(team.start)) {
      return `${path}.start must be a whole number for a team not counted yet.`
    }
    return { days: [], from: null, start: team.start, teamId: team.teamId, through: team.through }
  }

  const days = []

  for (const day of Array.isArray(team.days) ? team.days : []) {
    const fields = (day ?? {}) as { date?: unknown; points?: unknown }

    if (typeof fields.date !== 'string' || !DAY.test(fields.date) || !isWhole(fields.points)) {
      return `${path}.days must be [{ date: "2026-11-10", points: 12 }].`
    }
    days.push({ date: fields.date, points: fields.points })
  }

  return { days, from: team.from, start: null, teamId: team.teamId, through: team.through }
}

const findLeague = async (req: PayloadRequest): Promise<HockeyFantasyLeague | null> => {
  const id = req.routeParams?.id

  if (typeof id !== 'string' || !id) {
    return null
  }

  return req.payload
    .findByID({ id, collection: 'hockey-fantasy-leagues', depth: 0, overrideAccess: true })
    .catch(() => null)
}

const isWhole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value)

const positive = (value: null | string) => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

const badRequest = (message: string, path: string) =>
  Response.json({ errors: [{ message, path }] }, { status: 400 })
