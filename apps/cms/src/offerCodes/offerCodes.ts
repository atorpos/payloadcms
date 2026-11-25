/**
 * One-time-use App Store offer codes (README: "App Store offer codes"). Apple hands them out as a CSV of
 * `code,redeem URL` lines; deploy/import-offer-codes.sh stores each one in Offer codes
 * (src/collections/OfferCodes.ts), and the personal website gives every visitor of its redeem link the next
 * available one through `POST /api/offer-codes/claim`.
 *
 * Apple doesn't tell anyone when a code is redeemed, so the CMS tracks what it knows: whether a code has been
 * given out, when, and through which channel.
 *
 * Nothing here imports from the rest of the app, so tests/offerCodes.test.ts can load it with plain Node.
 */
import type { Endpoint, PayloadRequest, Where } from 'payload'

import crypto from 'node:crypto'

export const OFFER_CODES = 'offer-codes'

/**
 * The apps that have offer codes. `value` is what the website sends, so keep it once it's in use; `appStoreId`
 * is the app's Apple ID, the `id` in Apple's redeem links, which the import checks so that codes of one app
 * can't end up under another. To add an app, add a line here and deploy.
 */
export const offerCodeApps = [
  { appStoreId: '6830228333', label: 'LockinMinder', value: 'lockinminder' },
] as const

export type OfferCodeApp = (typeof offerCodeApps)[number]

export const offerCodeStatuses = [
  { label: 'Available', value: 'available' },
  { label: 'Given out', value: 'claimed' },
  { label: 'Disabled', value: 'disabled' },
]

export const offerCodeChannels = [
  { label: 'Redeem link on the website', value: 'link' },
  { label: 'By hand', value: 'manual' },
]

export const findOfferCodeApp = (value: unknown): OfferCodeApp | undefined =>
  offerCodeApps.find((app) => app.value === value)

// ---------------------------------------------------------------------------------------------------------
// Importing Apple's CSV
// ---------------------------------------------------------------------------------------------------------

/** Apple's codes are capital letters and digits, e.g. ABCD1234EFGH5678JK */
const CODE = /^[A-Z0-9]{6,64}$/

export type ParsedOfferCode = { code: string; line: number; url: string }

export type ParsedOfferCodeCsv = {
  codes: ParsedOfferCode[]
  /** Lines with a code that an earlier line already has */
  duplicates: number[]
  errors: { line: number; message: string }[]
}

/** Apple's redeem link for a code, the same as the ones in its CSV */
export const redeemUrl = (app: OfferCodeApp, code: string) =>
  `https://apps.apple.com/redeem?${new URLSearchParams({ code, ctx: 'offercodes', id: app.appStoreId })}`

const unquote = (cell: string) => cell.trim().replace(/^"(.*)"$/s, '$1').trim()

/**
 * Reads the CSV that App Store Connect exports for one-time-use offer codes: one `code,redeem URL` per line,
 * without a header. A header line, blank lines, quotes and Windows line ends are fine too, and so is a file
 * with codes only (their redeem links are made here). Every line with a problem is listed in `errors`, so a
 * wrong file is noticed before anything is saved.
 */
export const parseOfferCodesCsv = (text: string, app: OfferCodeApp): ParsedOfferCodeCsv => {
  const result: ParsedOfferCodeCsv = { codes: [], duplicates: [], errors: [] }
  const seen = new Set<string>()
  let isFirst = true

  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((raw, index) => {
      const line = index + 1
      const [code = '', url = '', ...rest] = raw.split(',').map(unquote)

      if (!code && !url && rest.every((cell) => !cell)) {
        return
      }

      // A header such as "Code,URL" on the first line
      if (isFirst && !CODE.test(code) && !/^https?:/i.test(url)) {
        isFirst = false
        return
      }

      isFirst = false

      if (!CODE.test(code)) {
        result.errors.push({ line, message: `"${code}" isn't an offer code` })
        return
      }

      const problem = url ? checkRedeemUrl(url, code, app) : null

      if (problem) {
        result.errors.push({ line, message: problem })
        return
      }

      if (seen.has(code)) {
        result.duplicates.push(line)
        return
      }

      seen.add(code)
      result.codes.push({ code, line, url: url || redeemUrl(app, code) })
    })

  return result
}

/** Why `url` isn't Apple's redeem link for `code` of this app, or null when it is */
const checkRedeemUrl = (url: string, code: string, app: OfferCodeApp): null | string => {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return `"${url}" isn't a link`
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== 'apps.apple.com' || parsed.pathname !== '/redeem') {
    return `"${url}" isn't an App Store redeem link (https://apps.apple.com/redeem?...)`
  }

  if (parsed.searchParams.get('code') !== code) {
    return `the link is for the code "${parsed.searchParams.get('code') ?? ''}", not ${code}`
  }

  const id = parsed.searchParams.get('id')

  if (id && id !== app.appStoreId) {
    return `the link is for the app with Apple ID ${id}, not ${app.label} (${app.appStoreId})`
  }

  return null
}

// ---------------------------------------------------------------------------------------------------------
// Giving codes out
// ---------------------------------------------------------------------------------------------------------

/**
 * The part of an IP address that one person or household controls: the whole address for IPv4, and the /64
 * network for IPv6, since a single device can pick any address in its /64.
 */
export const networkOf = (ip: string): string => {
  const value = ip.trim().toLowerCase().replace(/%.*$/, '')
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value)

  if (mapped) {
    return mapped[1]!
  }

  if (!value.includes(':') || value.split('::').length > 2) {
    return value
  }

  const [head = '', tail] = value.split('::')
  const headGroups = head ? head.split(':') : []
  const tailGroups = tail ? tail.split(':') : []
  const groups =
    tail === undefined
      ? headGroups
      : [
          ...headGroups,
          ...Array<string>(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0'),
          ...tailGroups,
        ]

  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return value
  }

  return `${groups
    .slice(0, 4)
    .map((group) => group.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`
}

/**
 * What the CMS keeps of the visitor's IP address: a keyed hash of its network, which can tell that two codes
 * went to the same network but can't be turned back into the address.
 */
export const hashNetwork = (ip: string, secret: string) =>
  crypto.createHmac('sha256', `offer-codes:${secret}`).update(networkOf(ip)).digest('hex').slice(0, 32)

/** How many codes one network gets in 24 hours (OFFER_CODES_PER_NETWORK_PER_DAY, default 10; 0 turns it off) */
export const perNetworkLimit = () => {
  const value = process.env.OFFER_CODES_PER_NETWORK_PER_DAY?.trim()
  const limit = value ? Number(value) : 10

  return Number.isSafeInteger(limit) && limit >= 0 ? limit : 10
}

/** Codes of `app` that can still be given out: available, and not past the expiry date Apple gave them */
export const availableWhere = (app: string, now: Date): Where => ({
  and: [
    { app: { equals: app } },
    { status: { equals: 'available' } },
    { or: [{ expiresAt: { exists: false } }, { expiresAt: { greater_than: now.toISOString() } }] },
  ],
})

type OfferCodeDoc = { claimedAt?: null | string; code: string; id: number | string; url: string }

/** What the endpoints use of Payload, so the tests can stand in for it */
type OfferCodePayload = {
  count: (args: { collection: string; overrideAccess: true; where: Where }) => Promise<{ totalDocs: number }>
  db: {
    updateOne: (args: {
      collection: string
      data: Record<string, unknown>
      req: PayloadRequest
      where: Where
    }) => Promise<null | OfferCodeDoc>
  }
  logger: { error: (arg: unknown) => void; info: (arg: unknown) => void }
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { headers: { 'Cache-Control': 'no-store' }, status })

const error = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  json({ errors: [{ message }], ...extra }, status)

/** Constant-time comparison; hashing first makes both sides the same length */
const isSameSecret = (given: string, expected: string) =>
  crypto.timingSafeEqual(
    crypto.createHash('sha256').update(given).digest(),
    crypto.createHash('sha256').update(expected).digest(),
  )

/**
 * The endpoints are for the website's server only, with `X-API-Key: <OFFER_CODES_API_KEY>`, a key of their
 * own so that it can't open any other app's endpoints. While the key is empty they answer 404, as if they
 * didn't exist.
 */
const refuseWithoutKey = (req: PayloadRequest): null | Response => {
  const apiKey = process.env.OFFER_CODES_API_KEY

  if (!apiKey) {
    return error('Not Found', 404)
  }

  if (!isSameSecret(req.headers.get('x-api-key') ?? '', apiKey)) {
    return error('Invalid API key.', 401)
  }

  return null
}

const unknownApp = () =>
  error(`app must be one of: ${offerCodeApps.map(({ value }) => value).join(', ')}.`, 400)

/**
 * `POST /api/offer-codes/claim` with `{ "app": "lockinminder", "ip": "<the visitor's IP address>" }` - gives
 * out the next available code of the app and marks it as given out, in one step, so two visitors at the same
 * moment never get the same code:
 *
 *   200 { app, code, url, claimedAt, available }   url: Apple's redeem link; available: codes left after this one
 *   410 { errors, available: 0 }                   none left
 *   429 { errors }                                 this network already got OFFER_CODES_PER_NETWORK_PER_DAY today
 *
 * `ip` is optional. Only a keyed hash of its network is stored (hashNetwork), for the daily limit.
 */
export const offerCodeClaimEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutKey(req)

    if (refused) {
      return refused
    }

    const body = (await req.json?.().catch(() => null)) as null | { app?: unknown; ip?: unknown }
    const app = findOfferCodeApp(body?.app)

    if (!app) {
      return unknownApp()
    }

    const payload = req.payload as unknown as OfferCodePayload
    const now = new Date()
    const ip = typeof body?.ip === 'string' ? body.ip.trim().slice(0, 100) : ''
    const networkHash = ip ? hashNetwork(ip, process.env.PAYLOAD_SECRET || '') : undefined
    const limit = perNetworkLimit()

    try {
      // Not in the same step as the claim, so a burst from one network can get a code or two over the limit
      if (networkHash && limit > 0) {
        const { totalDocs } = await payload.count({
          collection: OFFER_CODES,
          overrideAccess: true,
          where: {
            and: [
              { app: { equals: app.value } },
              { networkHash: { equals: networkHash } },
              { claimedAt: { greater_than: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString() } },
            ],
          },
        })

        if (totalDocs >= limit) {
          return error('This network has already received the most codes allowed today.', 429)
        }
      }

      // One findOneAndUpdate in MongoDB: the code is given out only if it is still available at that moment
      const claimed = await payload.db.updateOne({
        collection: OFFER_CODES,
        data: {
          claimedAt: now.toISOString(),
          claimedVia: 'link',
          status: 'claimed',
          ...(networkHash && { networkHash }),
        },
        req,
        where: availableWhere(app.value, now),
      })

      if (!claimed) {
        return error(`No ${app.label} offer codes are left.`, 410, { available: 0 })
      }

      const { totalDocs: available } = await payload.count({
        collection: OFFER_CODES,
        overrideAccess: true,
        where: availableWhere(app.value, now),
      })

      payload.logger.info({ msg: `Gave out ${app.label} offer code ${claimed.id}; ${available} left` })

      return json({
        app: app.value,
        available,
        claimedAt: now.toISOString(),
        code: claimed.code,
        url: claimed.url,
      })
    } catch (err) {
      payload.logger.error({ err, msg: `Could not give out a ${app.label} offer code` })
      return error('Could not give out a code.', 500)
    }
  },
  method: 'post',
  path: '/claim',
}

/**
 * `GET /api/offer-codes/availability?app=lockinminder` - `{ app, available, total }`: how many codes can still
 * be given out, and how many were imported. Never the codes themselves.
 */
export const offerCodeAvailabilityEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutKey(req)

    if (refused) {
      return refused
    }

    const asked = req.query?.app ?? new URL(req.url || 'http://localhost').searchParams.get('app')
    const app = findOfferCodeApp(asked)

    if (!app) {
      return unknownApp()
    }

    const payload = req.payload as unknown as OfferCodePayload
    const count = (where: Where) =>
      payload.count({ collection: OFFER_CODES, overrideAccess: true, where }).then(({ totalDocs }) => totalDocs)

    try {
      const [available, total] = await Promise.all([
        count(availableWhere(app.value, new Date())),
        count({ app: { equals: app.value } }),
      ])

      return json({ app: app.value, available, total })
    } catch (err) {
      payload.logger.error({ err, msg: `Could not count the ${app.label} offer codes` })
      return error('Could not count the codes.', 500)
    }
  },
  method: 'get',
  path: '/availability',
}
