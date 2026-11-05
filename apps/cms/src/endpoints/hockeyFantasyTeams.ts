import type { Endpoint, PayloadRequest } from 'payload'

import type { HockeyFantasyTeam, HockeyMember } from '../payload-types'

import {
  findMember,
  invalidAppUserId,
  refuseWithoutHockeyApiKey,
  routeAppUserId,
  text,
  validationErrors,
} from './hockeyMembers'

/**
 * Endpoints for the HockeyPoolCap API: the fantasy teams of an app account, kept under its member in the private
 * HockeyPoolCap Fantasy Teams collection (src/collections/HockeyFantasyTeams.ts). The API adds the players' points
 * from its own stats; this CMS only keeps who is on each team.
 *
 * Server to server only, with `X-API-Key: <HOCKEY_API_KEY>` like src/endpoints/hockeyMembers.ts. `:appUserId` is
 * the account's ID in the API; a team of another account answers `404`, as if it didn't exist.
 *
 * A team, as every endpoint answers it:
 * `{ id, name, league, players: [{ playerId, fullName, position, team }], createdAt, updatedAt }`, empty fields
 * as null, the players in the order they were picked.
 */

/** What the API sends to add or change a team: all of it */
type TeamInput = {
  league?: unknown
  name?: unknown
  players?: unknown
}

/** The most players on one team, as the collection allows */
const MAX_PLAYERS = 40

/**
 * `GET /api/hockey/members/:appUserId/fantasy-teams` - the account's teams, the newest first: `{ docs: [team] }`.
 * None, not `404`, when the account has no member yet.
 */
export const hockeyFantasyTeamsEndpoint: Endpoint = {
  handler: async (req) => {
    const member = await routeMember(req)

    if (member instanceof Response) {
      return member
    }
    if (!member) {
      return Response.json({ docs: [] })
    }

    const { docs } = await req.payload.find({
      collection: 'hockey-fantasy-teams',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      sort: '-createdAt',
      where: { member: { equals: member.id } },
    })

    return Response.json({ docs: docs.map(toAppTeam) })
  },
  method: 'get',
  path: '/hockey/members/:appUserId/fantasy-teams',
}

/**
 * `POST /api/hockey/members/:appUserId/fantasy-teams` - adds a team to the account's member, which the API adds
 * first (`PUT /api/hockey/members/:appUserId`). Body: `{ name, league, players: [{ playerId, fullName, position,
 * team }] }`. Answers the team with `201`; `404` without a member; invalid fields get `400` with
 * `{ errors: [{ message, path }] }`.
 */
export const hockeyFantasyTeamCreateEndpoint: Endpoint = {
  handler: async (req) => {
    const member = await routeMember(req)

    if (member instanceof Response) {
      return member
    }
    if (!member) {
      return Response.json({ errors: [{ message: 'Member not found.' }] }, { status: 404 })
    }

    const data = await teamData(req)

    if (data instanceof Response) {
      return data
    }

    try {
      const created = await req.payload.create({
        collection: 'hockey-fantasy-teams',
        data: { ...data, member: member.id },
        depth: 0,
        // Private collection: the API key check replaces the logged-in check
        overrideAccess: true,
      })

      return Response.json(toAppTeam(created), { status: 201 })
    } catch (error) {
      return validationErrors(error)
    }
  },
  method: 'post',
  path: '/hockey/members/:appUserId/fantasy-teams',
}

/** `GET /api/hockey/members/:appUserId/fantasy-teams/:teamId` - one of the account's teams */
export const hockeyFantasyTeamEndpoint: Endpoint = {
  handler: async (req) => {
    const team = await routeTeam(req)

    return team instanceof Response ? team : Response.json(toAppTeam(team))
  },
  method: 'get',
  path: '/hockey/members/:appUserId/fantasy-teams/:teamId',
}

/**
 * `PUT /api/hockey/members/:appUserId/fantasy-teams/:teamId` - replaces the team's name, league and players, with
 * the same body as the `POST`. A league left out is cleared.
 */
export const hockeyFantasyTeamSaveEndpoint: Endpoint = {
  handler: async (req) => {
    const team = await routeTeam(req)

    if (team instanceof Response) {
      return team
    }

    const data = await teamData(req)

    if (data instanceof Response) {
      return data
    }

    try {
      const updated = await req.payload.update({
        id: team.id,
        collection: 'hockey-fantasy-teams',
        data,
        depth: 0,
        overrideAccess: true,
      })

      return Response.json(toAppTeam(updated))
    } catch (error) {
      return validationErrors(error)
    }
  },
  method: 'put',
  path: '/hockey/members/:appUserId/fantasy-teams/:teamId',
}

/** `DELETE /api/hockey/members/:appUserId/fantasy-teams/:teamId` - `204`, or `404` when the account has no such team */
export const hockeyFantasyTeamDeleteEndpoint: Endpoint = {
  handler: async (req) => {
    const team = await routeTeam(req)

    if (team instanceof Response) {
      return team
    }

    await req.payload.delete({
      id: team.id,
      collection: 'hockey-fantasy-teams',
      depth: 0,
      overrideAccess: true,
    })

    return new Response(null, { status: 204 })
  },
  method: 'delete',
  path: '/hockey/members/:appUserId/fantasy-teams/:teamId',
}

/** The member of `:appUserId` (null without one), or the response refusing the request */
const routeMember = async (req: PayloadRequest): Promise<HockeyMember | null | Response> => {
  const refused = refuseWithoutHockeyApiKey(req)

  if (refused) {
    return refused
  }

  const appUserId = routeAppUserId(req)

  return appUserId ? findMember(req, appUserId) : invalidAppUserId()
}

/** The `:teamId` team of the `:appUserId` member, or the response refusing the request (`404` when not theirs) */
const routeTeam = async (req: PayloadRequest): Promise<HockeyFantasyTeam | Response> => {
  const member = await routeMember(req)

  if (member instanceof Response) {
    return member
  }

  const teamId = String(req.routeParams?.teamId ?? '')

  // MongoDB IDs only: anything else can't be a team, and would fail the query
  if (!member || !/^[a-f\d]{24}$/i.test(teamId)) {
    return teamNotFound()
  }

  const { docs } = await req.payload.find({
    collection: 'hockey-fantasy-teams',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    pagination: false,
    where: { and: [{ id: { equals: teamId } }, { member: { equals: member.id } }] },
  })

  return docs[0] ?? teamNotFound()
}

/** The team's fields from the body, or a `400` response */
const teamData = async (req: PayloadRequest) => {
  const body = (await req.json?.().catch(() => null)) as null | TeamInput

  if (!body || typeof body !== 'object') {
    return Response.json({ errors: [{ message: 'The body must be JSON.' }] }, { status: 400 })
  }
  if (!Array.isArray(body.players)) {
    return Response.json(
      { errors: [{ message: 'players must be a list.', path: 'players' }] },
      { status: 400 },
    )
  }
  if (body.players.length > MAX_PLAYERS) {
    return Response.json(
      { errors: [{ message: `At most ${MAX_PLAYERS} players.`, path: 'players' }] },
      { status: 400 },
    )
  }

  const players = []

  for (const [index, player] of (body.players as unknown[]).entries()) {
    const fields = (player && typeof player === 'object' ? player : {}) as Record<string, unknown>
    const playerId = Number(fields.playerId)

    if (!Number.isSafeInteger(playerId) || playerId < 1) {
      return Response.json(
        {
          errors: [
            {
              message: 'playerId must be a positive whole number.',
              path: `players.${index}.playerId`,
            },
          ],
        },
        { status: 400 },
      )
    }

    players.push({
      fullName: text(fields.fullName) ?? null,
      playerId,
      position: text(fields.position) ?? null,
      team: text(fields.team) ?? null,
    })
  }

  return {
    league: text(body.league) ?? null,
    // Required: Payload refuses an empty one
    name: text(body.name) ?? '',
    players,
  }
}

/** What the API gets of a team */
const toAppTeam = (team: HockeyFantasyTeam) => ({
  createdAt: team.createdAt,
  id: team.id,
  league: team.league ?? null,
  name: team.name,
  players: (team.players ?? []).map((player) => ({
    fullName: player.fullName ?? null,
    playerId: player.playerId,
    position: player.position ?? null,
    team: player.team ?? null,
  })),
  updatedAt: team.updatedAt,
})

const teamNotFound = () =>
  Response.json({ errors: [{ message: 'Fantasy team not found.' }] }, { status: 404 })
