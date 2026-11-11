import type { Endpoint, PayloadRequest } from 'payload'

import { refuseWithoutAppApiKey } from './appApiKey'

/**
 * How awoz-api keeps its copy of each VgemsAI app company here (Organizations, under "Business"), after every change:
 * created, renamed, someone joined or left, deleted. Server to server only, with `X-API-Key: <APP_API_KEY>` (see
 * ./appApiKey.ts); while APP_API_KEY is empty the endpoints answer 404.
 */

const ROLES = ['admin', 'staff']
const JOINED_VIA = ['code', 'created', 'email']

type Member = { appUserId: number; joinedAt: null | string; joinedVia: string; role: string }

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const badRequest = (message: string, path: string) =>
  Response.json({ errors: [{ message, path }] }, { status: 400 })

const organizationId = (req: PayloadRequest) => Number(req.routeParams?.id)

/**
 * `PUT /api/app/organizations/:appOrganizationId` - creates or replaces the company:
 *
 *   { name, emailDomain: "acme.com" | null,
 *     members: [{ appUserId, role: "admin" | "staff", joinedVia: "created" | "email" | "code", joinedAt }] }
 *
 * Each person is linked to the client made from their signup, when there is one. Answers `200 { id }`.
 */
export const appOrganizationSaveEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const appOrganizationId = organizationId(req)
    if (!isPositiveInteger(appOrganizationId)) {
      return badRequest('The company ID must be a positive whole number.', 'id')
    }

    const body = (await req.json?.().catch(() => null)) as null | Record<string, unknown>
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 200) {
      return badRequest('name is required, at most 200 characters.', 'name')
    }
    const emailDomain = typeof body?.emailDomain === 'string' ? body.emailDomain.trim() : null
    const given = Array.isArray(body?.members) ? (body.members as Record<string, unknown>[]) : null
    if (!given) {
      return badRequest('members must be a list.', 'members')
    }
    const members: Member[] = []
    for (const [i, member] of given.entries()) {
      if (
        !isPositiveInteger(member?.appUserId) ||
        !ROLES.includes(String(member?.role)) ||
        !JOINED_VIA.includes(String(member?.joinedVia))
      ) {
        return badRequest(
          'Each member needs appUserId, a role (admin or staff) and joinedVia (created, email or code).',
          `members.${i}`,
        )
      }
      const joinedAt =
        typeof member.joinedAt === 'string' && !Number.isNaN(Date.parse(member.joinedAt))
      members.push({
        appUserId: member.appUserId,
        joinedAt: joinedAt ? (member.joinedAt as string) : null,
        joinedVia: String(member.joinedVia),
        role: String(member.role),
      })
    }

    // Each person's client record, made from their signup
    const { docs: clients } = await req.payload.find({
      collection: 'clients',
      depth: 0,
      // Internal collection: this endpoint's API key check replaces the logged-in check
      overrideAccess: true,
      pagination: false,
      select: { appUserId: true },
      where: { appUserId: { in: members.map((member) => member.appUserId) } },
    })
    const clientOf = new Map(clients.map((client) => [client.appUserId, client.id]))

    const data = {
      name,
      appOrganizationId,
      emailDomain,
      memberCount: members.length,
      members: members.map((member) => ({
        appUserId: member.appUserId,
        client: clientOf.get(member.appUserId) ?? null,
        joinedAt: member.joinedAt,
        joinedVia: member.joinedVia as 'code' | 'created' | 'email',
        role: member.role as 'admin' | 'staff',
      })),
    }

    const { docs } = await req.payload.find({
      collection: 'organizations',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      pagination: false,
      select: {},
      where: { appOrganizationId: { equals: appOrganizationId } },
    })
    const saved = docs[0]
      ? await req.payload.update({
          id: docs[0].id,
          collection: 'organizations',
          data,
          depth: 0,
          overrideAccess: true,
        })
      : await req.payload.create({
          collection: 'organizations',
          data,
          depth: 0,
          overrideAccess: true,
        })

    return Response.json({ id: saved.id })
  },
  method: 'put',
  path: '/app/organizations/:id',
}

/** `DELETE /api/app/organizations/:appOrganizationId` - the company was deleted in the app. `204`, even if it's not here. */
export const appOrganizationDeleteEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const appOrganizationId = organizationId(req)
    if (!isPositiveInteger(appOrganizationId)) {
      return badRequest('The company ID must be a positive whole number.', 'id')
    }

    await req.payload.delete({
      collection: 'organizations',
      overrideAccess: true,
      where: { appOrganizationId: { equals: appOrganizationId } },
    })

    return new Response(null, { status: 204 })
  },
  method: 'delete',
  path: '/app/organizations/:id',
}

/**
 * Links a client made from an app signup to the companies and chat reports that already name its account: awoz-api
 * sends a new account's company and reports on their own schedule, so they can arrive before its client.
 */
export const linkAppClient = async ({
  appUserId,
  clientId,
  req,
}: {
  appUserId: number
  clientId: string
  req: PayloadRequest
}) => {
  const { docs: organizations } = await req.payload.find({
    collection: 'organizations',
    depth: 0,
    overrideAccess: true,
    pagination: false,
    where: { 'members.appUserId': { equals: appUserId } },
  })
  for (const organization of organizations) {
    await req.payload.update({
      id: organization.id,
      collection: 'organizations',
      data: {
        members: (organization.members ?? []).map((member) =>
          member.appUserId === appUserId ? { ...member, client: clientId } : member,
        ),
      },
      depth: 0,
      overrideAccess: true,
    })
  }

  for (const side of ['reporter', 'reported'] as const) {
    const { docs: reports } = await req.payload.find({
      collection: 'chat-reports',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      where: { [`${side}.appUserId`]: { equals: appUserId } },
    })
    for (const report of reports) {
      await req.payload.update({
        id: report.id,
        collection: 'chat-reports',
        data: { [side]: { ...report[side], client: clientId } },
        depth: 0,
        overrideAccess: true,
      })
    }
  }
}
