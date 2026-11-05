import type { Endpoint, PayloadRequest } from 'payload'

import { ValidationError } from 'payload'

import type { HockeyMember } from '../payload-types'

import { refuseWithoutApiKey } from './appApiKey'

/**
 * Endpoints for the HockeyPoolCap API, the backend of the HockeyPoolCap app (iOS and Android). People log in to
 * the app with the API, which keeps their email and password; their profile details live here, in the private
 * HockeyPoolCap Members collection (src/collections/HockeyMembers.ts), where the team can see and change them.
 *
 * Server to server only: the API sends `X-API-Key: <HOCKEY_API_KEY>`, its own key, separate from the VgemsAI
 * app's. While HOCKEY_API_KEY is empty every `/api/hockey/...` endpoint answers 404, as if it didn't exist.
 */
export const refuseWithoutHockeyApiKey = (req: PayloadRequest) =>
  refuseWithoutApiKey(req, process.env.HOCKEY_API_KEY)

/** What the API sends: the account's name and email, and the profile people fill in in the app */
type MemberInput = {
  email?: unknown
  name?: unknown
  profile?: {
    displayName?: unknown
    favoriteTeam?: unknown
    location?: {
      city?: unknown
      country?: unknown
      state?: unknown
    }
    phone?: unknown
  } | null
}

/**
 * `PUT /api/hockey/members/:appUserId` - adds or updates the member of an app account, where `:appUserId` is the
 * account's ID in the HockeyPoolCap API. The API calls it after signup, and whenever the name or profile changes.
 *
 * Body: `{ name, email, profile: { displayName, favoriteTeam, phone, location: { city, state, country } } }`.
 * `name` is required. Without `profile` (or with `null`), the profile stays as it is, e.g. when only the name
 * changed; with it, all its fields are set, so one left out or empty is cleared. Notes stay as the team wrote them.
 *
 * Answers the member like the `GET`: `201` when it was added, `200` when it already existed. Sending the same
 * request again changes nothing, so the API can safely try again after a lost answer. Invalid fields get `400`
 * with `{ errors: [{ message, path }] }`.
 */
export const hockeyMemberSaveEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutHockeyApiKey(req)

    if (refused) {
      return refused
    }

    const appUserId = routeAppUserId(req)
    const body = (await req.json?.().catch(() => null)) as MemberInput | null

    if (!appUserId) {
      return invalidAppUserId()
    }
    if (!body || typeof body !== 'object') {
      return Response.json({ errors: [{ message: 'The body must be JSON.' }] }, { status: 400 })
    }

    const data = {
      ...(body.profile && typeof body.profile === 'object' ? profileFields(body.profile) : {}),
      email: text(body.email),
      // Required: Payload refuses an empty one
      name: text(body.name) ?? '',
    }

    try {
      const existing = await findMember(req, appUserId)

      if (existing) {
        const updated = await req.payload.update({
          id: existing.id,
          collection: 'hockey-members',
          data,
          depth: 0,
          // Private collection: the API key check replaces the logged-in check
          overrideAccess: true,
        })

        return Response.json(toAppMember(updated), { status: 200 })
      }

      const created = await req.payload.create({
        collection: 'hockey-members',
        data: { ...data, appUserId },
        depth: 0,
        overrideAccess: true,
      })

      return Response.json(toAppMember(created), { status: 201 })
    } catch (error) {
      return validationErrors(error)
    }
  },
  method: 'put',
  path: '/hockey/members/:appUserId',
}

/**
 * `GET /api/hockey/members/:appUserId` - the member of an app account, for the app's profile screen:
 * `{ id, appUserId, name, email, displayName, favoriteTeam, phone, location: { city, state, country }, updatedAt }`,
 * empty fields as null. Never the team's notes. `404` when the account has no member yet.
 */
export const hockeyMemberEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutHockeyApiKey(req)

    if (refused) {
      return refused
    }

    const appUserId = routeAppUserId(req)

    if (!appUserId) {
      return invalidAppUserId()
    }

    const member = await findMember(req, appUserId)

    return member
      ? Response.json(toAppMember(member))
      : Response.json({ errors: [{ message: 'Member not found.' }] }, { status: 404 })
  },
  method: 'get',
  path: '/hockey/members/:appUserId',
}

/**
 * `DELETE /api/hockey/members/:appUserId` - deletes the member of an app account, with its fantasy teams, when its
 * owner deletes the account in the app. Answers `204` whether or not there was one, so the API can safely try again.
 */
export const hockeyMemberDeleteEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutHockeyApiKey(req)

    if (refused) {
      return refused
    }

    const appUserId = routeAppUserId(req)

    if (!appUserId) {
      return invalidAppUserId()
    }

    await req.payload.delete({
      collection: 'hockey-members',
      depth: 0,
      overrideAccess: true,
      where: { appUserId: { equals: appUserId } },
    })

    return new Response(null, { status: 204 })
  },
  method: 'delete',
  path: '/hockey/members/:appUserId',
}

/** The profile fields people fill in in the app; an empty one is cleared */
const profileFields = (profile: NonNullable<MemberInput['profile']>) => {
  const value = (field: unknown) => text(field) ?? null

  return {
    displayName: value(profile.displayName),
    favoriteTeam: value(profile.favoriteTeam),
    location: {
      city: value(profile.location?.city),
      country: value(profile.location?.country),
      state: value(profile.location?.state),
    },
    phone: value(profile.phone),
  }
}

/** What the app may see of a member: never the notes */
const toAppMember = (member: HockeyMember) => ({
  appUserId: member.appUserId,
  displayName: member.displayName ?? null,
  email: member.email ?? null,
  favoriteTeam: member.favoriteTeam ?? null,
  id: member.id,
  location: {
    city: member.location?.city ?? null,
    country: member.location?.country ?? null,
    state: member.location?.state ?? null,
  },
  name: member.name,
  phone: member.phone ?? null,
  updatedAt: member.updatedAt,
})

export const findMember = async (req: PayloadRequest, appUserId: number) => {
  const { docs } = await req.payload.find({
    collection: 'hockey-members',
    depth: 0,
    // Only the member: not its fantasy teams
    joins: false,
    limit: 1,
    overrideAccess: true,
    pagination: false,
    where: { appUserId: { equals: appUserId } },
  })

  return docs[0] ?? null
}

/** The `:appUserId` route parameter, when it is a positive whole number */
export const routeAppUserId = (req: PayloadRequest) => {
  const appUserId = Number(req.routeParams?.appUserId)

  return Number.isSafeInteger(appUserId) && appUserId > 0 ? appUserId : null
}

export const invalidAppUserId = () =>
  Response.json(
    { errors: [{ message: 'appUserId must be a positive whole number.', path: 'appUserId' }] },
    { status: 400 },
  )

/** `400` with each invalid field's message and path */
export const validationErrors = (error: unknown) => {
  if (error instanceof ValidationError) {
    return Response.json(
      { errors: error.data.errors.map(({ message, path }) => ({ message, path })) },
      { status: 400 },
    )
  }

  throw error
}

/** Trimmed text; anything else, or only spaces, is left out */
export const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined
