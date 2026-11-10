import type { Endpoint, PayloadRequest } from 'payload'

import type { HockeyFantasyLeague, HockeyMember } from '../payload-types'

import { MAX_LEAGUE_TEAMS, MAX_TEAM_PLAYERS } from '../collections/HockeyFantasyLeagues'
import {
  findMember,
  invalidAppUserId,
  refuseWithoutHockeyApiKey,
  routeAppUserId,
  text,
  validationErrors,
} from './hockeyMembers'

/**
 * Endpoints for the HockeyPoolCap API: the fantasy league of an app account, kept under its member in the private
 * HockeyPoolCap Fantasy Leagues collection (src/collections/HockeyFantasyLeagues.ts). For now an account has one
 * league, with one team of its own (`mine`) and the teams it plays against. The API adds the players' points from
 * its own stats; this CMS only keeps the teams and who is on them.
 *
 * Server to server only, with `X-API-Key: <HOCKEY_API_KEY>` like src/endpoints/hockeyMembers.ts. `:appUserId` is
 * the account's ID in the API.
 *
 * The league, as every endpoint answers it:
 * `{ id, name, teams: [{ id, name, manager, mine, players: [{ playerId, fullName, position, team }] }], createdAt,
 * updatedAt }`, empty fields as null, teams and players in the order they were added.
 */

/** What the API sends to set up or change the league: all of it */
type LeagueInput = {
  name?: unknown
  teams?: unknown
}

/** A path and message for a `400` */
type Invalid = { message: string; path?: string }

/** `GET /api/hockey/members/:appUserId/fantasy-league` - the account's league; `404` when it has none */
export const hockeyFantasyLeagueEndpoint: Endpoint = {
  handler: async (req) => {
    const member = await routeMember(req)

    if (member instanceof Response) {
      return member
    }

    const league = member ? await findLeague(req, member) : null

    return league ? Response.json(toAppLeague(league)) : leagueNotFound()
  },
  method: 'get',
  path: '/hockey/members/:appUserId/fantasy-league',
}

/**
 * `PUT /api/hockey/members/:appUserId/fantasy-league` - sets up the account's league, or replaces it, all at once.
 * Body: `{ name, teams: [{ id, name, manager, mine, players: [{ playerId, fullName, position, team }] }] }`, at most
 * 20 teams of 40 players, one of them `mine`. A team sent with the `id` it has keeps it; one without is added.
 *
 * Answers the league with `201` when it was set up, `200` when it was changed; `404` without a member, which the API
 * adds first (`PUT /api/hockey/members/:appUserId`). Invalid fields get `400` with `{ errors: [{ message, path }] }`.
 */
export const hockeyFantasyLeagueSaveEndpoint: Endpoint = {
  handler: async (req) => {
    const member = await routeMember(req)

    if (member instanceof Response) {
      return member
    }
    if (!member) {
      return Response.json({ errors: [{ message: 'Member not found.' }] }, { status: 404 })
    }

    const existing = await findLeague(req, member)
    const data = await leagueData(req, existing)

    if (data instanceof Response) {
      return data
    }

    try {
      if (existing) {
        const updated = await req.payload.update({
          id: existing.id,
          collection: 'hockey-fantasy-leagues',
          data,
          depth: 0,
          // Private collection: the API key check replaces the logged-in check
          overrideAccess: true,
        })

        return Response.json(toAppLeague(updated))
      }

      const created = await req.payload.create({
        collection: 'hockey-fantasy-leagues',
        data: { ...data, member: member.id },
        depth: 0,
        overrideAccess: true,
      })

      return Response.json(toAppLeague(created), { status: 201 })
    } catch (error) {
      return validationErrors(error)
    }
  },
  method: 'put',
  path: '/hockey/members/:appUserId/fantasy-league',
}

/**
 * `DELETE /api/hockey/members/:appUserId/fantasy-league` - deletes the account's league with its teams; `204` whether
 * or not it had one, so the API can safely try again
 */
export const hockeyFantasyLeagueDeleteEndpoint: Endpoint = {
  handler: async (req) => {
    const member = await routeMember(req)

    if (member instanceof Response) {
      return member
    }
    if (member) {
      await req.payload.delete({
        collection: 'hockey-fantasy-leagues',
        depth: 0,
        overrideAccess: true,
        where: { member: { equals: member.id } },
      })
    }

    return new Response(null, { status: 204 })
  },
  method: 'delete',
  path: '/hockey/members/:appUserId/fantasy-league',
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

/** The member's league: the first one set up, should there ever be more */
const findLeague = async (req: PayloadRequest, member: HockeyMember) => {
  const { docs } = await req.payload.find({
    collection: 'hockey-fantasy-leagues',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    pagination: false,
    sort: 'createdAt',
    where: { member: { equals: member.id } },
  })

  return docs[0] ?? null
}

/** The league's fields from the body, or a `400` response. Team IDs the league doesn't have are dropped. */
const leagueData = async (req: PayloadRequest, existing: HockeyFantasyLeague | null) => {
  const body = (await req.json?.().catch(() => null)) as LeagueInput | null

  if (!body || typeof body !== 'object') {
    return badRequest({ message: 'The body must be JSON.' })
  }
  if (!Array.isArray(body.teams)) {
    return badRequest({ message: 'teams must be a list.', path: 'teams' })
  }
  if (body.teams.length > MAX_LEAGUE_TEAMS) {
    return badRequest({ message: `At most ${MAX_LEAGUE_TEAMS} teams.`, path: 'teams' })
  }

  const knownTeamIds = new Set((existing?.teams ?? []).map((team) => team.id).filter(Boolean))
  const teams = []

  for (const [index, team] of (body.teams as unknown[]).entries()) {
    const fields = (team && typeof team === 'object' ? team : {}) as Record<string, unknown>
    const players = playersData(fields.players, `teams.${index}.players`)

    if (!Array.isArray(players)) {
      return badRequest(players)
    }

    const id = typeof fields.id === 'string' && knownTeamIds.has(fields.id) ? fields.id : undefined

    teams.push({
      ...(id ? { id } : {}),
      manager: text(fields.manager) ?? null,
      mine: fields.mine === true,
      // Required: Payload refuses an empty one
      name: text(fields.name) ?? '',
      players,
    })
  }

  return {
    // Required: Payload refuses an empty one
    name: text(body.name) ?? '',
    teams,
  }
}

/** A team's players from the body, or what's wrong with them */
const playersData = (value: unknown, path: string) => {
  if (!Array.isArray(value)) {
    return { message: 'players must be a list.', path }
  }
  if (value.length > MAX_TEAM_PLAYERS) {
    return { message: `At most ${MAX_TEAM_PLAYERS} players.`, path }
  }

  const players = []

  for (const [index, player] of (value as unknown[]).entries()) {
    const fields = (player && typeof player === 'object' ? player : {}) as Record<string, unknown>
    const playerId = Number(fields.playerId)

    if (!Number.isSafeInteger(playerId) || playerId < 1) {
      return {
        message: 'playerId must be a positive whole number.',
        path: `${path}.${index}.playerId`,
      }
    }

    players.push({
      fullName: text(fields.fullName) ?? null,
      playerId,
      position: text(fields.position) ?? null,
      team: text(fields.team) ?? null,
    })
  }

  return players
}

/** What the API gets of a league */
const toAppLeague = (league: HockeyFantasyLeague) => ({
  createdAt: league.createdAt,
  id: league.id,
  name: league.name,
  teams: (league.teams ?? []).map((team) => ({
    id: team.id ?? null,
    manager: team.manager ?? null,
    mine: team.mine === true,
    name: team.name,
    players: (team.players ?? []).map((player) => ({
      fullName: player.fullName ?? null,
      playerId: player.playerId,
      position: player.position ?? null,
      team: player.team ?? null,
    })),
  })),
  updatedAt: league.updatedAt,
})

const badRequest = (invalid: Invalid) => Response.json({ errors: [invalid] }, { status: 400 })

const leagueNotFound = () =>
  Response.json({ errors: [{ message: 'Fantasy league not found.' }] }, { status: 404 })
