import type { Endpoint } from 'payload'

import { refuseWithoutAppApiKey } from './appApiKey'

/**
 * How reports from the VgemsAI app's chats reach the team (Chat reports, under "VgemsAI App"), and how their decisions
 * go back: awoz-api sends each new report, then every minute asks for the decisions waiting to be carried out, carries
 * them out (removes the message, suspends the sender) and says so. Server to server only, with
 * `X-API-Key: <APP_API_KEY>` (see ./appApiKey.ts); while APP_API_KEY is empty the endpoints answer 404.
 */

const REASONS = ['harassment', 'inappropriate', 'other', 'scam', 'spam']

type AppAccount = {
  appUserId?: unknown
  company?: unknown
  email?: unknown
  name?: unknown
}

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null

/**
 * `POST /api/app/chat-reports` - a new report:
 *
 *   { appReportId, reason: "spam" | "harassment" | "inappropriate" | "scam" | "other", details, messageId,
 *     messageText, reportedAt, reporter: { appUserId, name, email, company }, reported: { … } }
 *
 * Answers `201 { doc: { id } }`, or `200` with the report already made for this `appReportId`, so awoz-api can try
 * again after a lost answer.
 */
export const appChatReportsEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const body = (await req.json?.().catch(() => null)) as null | Record<string, unknown>
    if (!body || !isPositiveInteger(body.appReportId) || !REASONS.includes(String(body.reason))) {
      return Response.json(
        {
          errors: [
            { message: 'appReportId and a known reason are required.', path: 'appReportId' },
          ],
        },
        { status: 400 },
      )
    }

    const { docs } = await req.payload.find({
      collection: 'chat-reports',
      depth: 0,
      limit: 1,
      // Internal collection: this endpoint's API key check replaces the logged-in check
      overrideAccess: true,
      pagination: false,
      select: {},
      where: { appReportId: { equals: body.appReportId } },
    })
    if (docs[0]) {
      return Response.json({ doc: { id: docs[0].id } })
    }

    const accounts = [body.reporter, body.reported] as (AppAccount | undefined)[]
    const appUserIds = accounts.map((account) => account?.appUserId).filter(isPositiveInteger)
    const { docs: clients } = await req.payload.find({
      collection: 'clients',
      depth: 0,
      overrideAccess: true,
      pagination: false,
      select: { appUserId: true },
      where: { appUserId: { in: appUserIds } },
    })
    const clientOf = new Map(clients.map((client) => [client.appUserId, client.id]))
    const person = (account: AppAccount | undefined) => {
      const appUserId = isPositiveInteger(account?.appUserId) ? account.appUserId : null
      return {
        name: text(account?.name, 100),
        appUserId,
        client: appUserId ? (clientOf.get(appUserId) ?? null) : null,
        company: text(account?.company, 200),
        email: text(account?.email, 255),
      }
    }

    const reportedAt =
      typeof body.reportedAt === 'string' && !Number.isNaN(Date.parse(body.reportedAt))
        ? body.reportedAt
        : new Date().toISOString()
    const report = await req.payload.create({
      collection: 'chat-reports',
      data: {
        appReportId: body.appReportId,
        decision: 'none',
        details: text(body.details, 1000),
        messageId: isPositiveInteger(body.messageId) ? body.messageId : null,
        messageText: text(body.messageText, 4000),
        reason: body.reason as 'harassment' | 'inappropriate' | 'other' | 'scam' | 'spam',
        reported: person(body.reported as AppAccount),
        reportedAt,
        reporter: person(body.reporter as AppAccount),
        status: 'open',
      },
      depth: 0,
      overrideAccess: true,
    })

    return Response.json({ doc: { id: report.id } }, { status: 201 })
  },
  method: 'post',
  path: '/app/chat-reports',
}

/**
 * `GET /api/app/chat-reports/decided` - decisions waiting to be carried out:
 *
 *   { docs: [{ id, appReportId, messageId, reportedUserId, decision: "dismissed" | "remove-message" | "suspend-user" }] }
 */
export const appChatReportsDecidedEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const { docs } = await req.payload.find({
      collection: 'chat-reports',
      depth: 0,
      limit: 50,
      overrideAccess: true,
      sort: 'decidedAt',
      where: { status: { equals: 'decided' } },
    })

    return Response.json({
      docs: docs.map((report) => ({
        id: report.id,
        appReportId: report.appReportId ?? null,
        decision: report.decision,
        messageId: report.messageId ?? null,
        reportedUserId: report.reported?.appUserId ?? null,
      })),
    })
  },
  method: 'get',
  path: '/app/chat-reports/decided',
}

/** `POST /api/app/chat-reports/:id/applied` - the decision was carried out in the app. `200 { ok: true }`. */
export const appChatReportAppliedEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const id = req.routeParams?.id
    if (typeof id !== 'string' || !id) {
      return Response.json({ errors: [{ message: 'Not Found' }] }, { status: 404 })
    }
    const { docs } = await req.payload.find({
      collection: 'chat-reports',
      depth: 0,
      limit: 1,
      overrideAccess: true,
      pagination: false,
      where: { id: { equals: id } },
    })
    const report = docs[0]
    if (!report) {
      return Response.json({ errors: [{ message: 'Not Found' }] }, { status: 404 })
    }
    if (report.status !== 'applied') {
      await req.payload.update({
        id,
        collection: 'chat-reports',
        data: { appliedAt: new Date().toISOString(), status: 'applied' },
        depth: 0,
        overrideAccess: true,
      })
    }

    return Response.json({ ok: true })
  },
  method: 'post',
  path: '/app/chat-reports/:id/applied',
}
