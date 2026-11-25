import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import {
  hashNetwork,
  networkOf,
  offerCodeApps,
  offerCodeAvailabilityEndpoint,
  offerCodeClaimEndpoint,
  parseOfferCodesCsv,
  redeemUrl,
} from '../src/offerCodes/offerCodes.ts'

const originalEnv = { ...process.env }
afterEach(() => {
  process.env = { ...originalEnv }
})

const app = offerCodeApps[0]
const link = (code: string, id = app.appStoreId) =>
  `https://apps.apple.com/redeem?ctx=offercodes&id=${id}&code=${code}`

test('reads Apple’s CSV and reports every line it can’t use', () => {
  const csv = [
    'Code,URL',
    `TESTAAAA0000000001,${link('TESTAAAA0000000001')}`,
    '',
    `"TESTBBBB0000000002","${link('TESTBBBB0000000002')}"\r`,
    `TESTAAAA0000000001,${link('TESTAAAA0000000001')}`,
    `TESTCCCC0000000003,${link('TESTCCCC0000000003', '123')}`,
    `TESTDDDD0000000004,${link('TESTEEEE0000000005')}`,
    `bad code,${link('bad')}`,
    `TESTFFFF0000000006,https://example.com/redeem?code=TESTFFFF0000000006`,
    'TESTGGGG0000000007',
  ].join('\n')

  const { codes, duplicates, errors } = parseOfferCodesCsv(csv, app)

  assert.deepEqual(
    codes.map(({ code, line }) => [code, line]),
    [
      ['TESTAAAA0000000001', 2],
      ['TESTBBBB0000000002', 4],
      ['TESTGGGG0000000007', 10],
    ],
  )
  assert.equal(codes[1]!.url, link('TESTBBBB0000000002'))
  // A file with codes only gets Apple's links
  assert.equal(codes[2]!.url, redeemUrl(app, 'TESTGGGG0000000007'))
  assert.deepEqual(duplicates, [5])
  assert.deepEqual(
    errors.map(({ line }) => line),
    [6, 7, 8, 9],
  )
  assert.match(errors[0]!.message, /Apple ID 123/)
  assert.match(errors[1]!.message, /for the code "TESTEEEE0000000005"/)
})

test('a first line with a code is not taken for a header', () => {
  const { codes } = parseOfferCodesCsv(`TESTAAAA0000000001,${link('TESTAAAA0000000001')}`, app)
  assert.equal(codes.length, 1)
})

test('keeps only the network of an IP address', () => {
  assert.equal(networkOf(' 203.0.113.7 '), '203.0.113.7')
  assert.equal(networkOf('::ffff:203.0.113.7'), '203.0.113.7')
  assert.equal(networkOf('2001:db8:85a3::8a2e:370:7334'), '2001:db8:85a3:0::/64')
  assert.equal(networkOf('2001:0db8:85a3:0000:1111:2222:3333:4444%en0'), '2001:db8:85a3:0::/64')
  assert.equal(
    hashNetwork('2001:db8:85a3::1', 's'),
    hashNetwork('2001:db8:85a3:0:ffff:ffff:ffff:ffff', 's'),
  )
  assert.notEqual(hashNetwork('203.0.113.7', 's'), hashNetwork('203.0.113.8', 's'))
  assert.notEqual(hashNetwork('203.0.113.7', 's'), hashNetwork('203.0.113.7', 'other secret'))
  assert.match(hashNetwork('203.0.113.7', 's'), /^[0-9a-f]{32}$/)
})

type Call = Record<string, unknown>

const fakePayload = ({
  claimed = { code: 'ABCDEF123456', id: 'c1', url: link('ABCDEF123456') } as null | Record<string, unknown>,
  counts = [] as number[],
} = {}) => {
  const calls = { count: [] as Call[], updateOne: [] as Call[] }

  return {
    calls,
    payload: {
      count: async (args: Call) => {
        calls.count.push(args)
        return { totalDocs: counts.shift() ?? 0 }
      },
      db: {
        updateOne: async (args: Call) => {
          calls.updateOne.push(args)
          return claimed
        },
      },
      logger: { error: () => {}, info: () => {} },
    },
  }
}

const request = ({
  apiKey = 'key',
  body = { app: 'lockinminder', ip: '203.0.113.7' } as unknown,
  payload = {} as unknown,
  url = 'http://cms/api/offer-codes/claim',
} = {}) =>
  ({
    headers: new Headers(apiKey ? { 'x-api-key': apiKey } : {}),
    json: async () => body,
    payload,
    url,
  }) as never

const claim = offerCodeClaimEndpoint.handler as (req: never) => Promise<Response>
const availability = offerCodeAvailabilityEndpoint.handler as (req: never) => Promise<Response>

test('the endpoints don’t exist without OFFER_CODES_API_KEY and refuse a wrong key', async () => {
  delete process.env.OFFER_CODES_API_KEY
  const { calls, payload } = fakePayload()
  assert.equal((await claim(request({ payload }))).status, 404)
  assert.equal((await availability(request({ payload }))).status, 404)

  process.env.OFFER_CODES_API_KEY = 'key'
  assert.equal((await claim(request({ apiKey: 'wrong', payload }))).status, 401)
  assert.equal((await claim(request({ apiKey: '', payload }))).status, 401)
  assert.equal(calls.updateOne.length + calls.count.length, 0)
})

test('refuses an app it doesn’t know', async () => {
  process.env.OFFER_CODES_API_KEY = 'key'
  const { calls, payload } = fakePayload()
  const res = await claim(request({ body: { app: 'other' }, payload }))
  assert.equal(res.status, 400)
  assert.equal(calls.updateOne.length, 0)
})

test('gives out one available, unexpired code and stores only a hash of the network', async () => {
  process.env.OFFER_CODES_API_KEY = 'key'
  process.env.PAYLOAD_SECRET = 'secret'
  const { calls, payload } = fakePayload({ counts: [2, 41] })
  const res = await claim(request({ payload }))

  assert.equal(res.status, 200)
  assert.equal(res.headers.get('cache-control'), 'no-store')
  const body = (await res.json()) as Record<string, unknown>
  assert.equal(body.code, 'ABCDEF123456')
  assert.equal(body.url, link('ABCDEF123456'))
  assert.equal(body.available, 41)

  const [update] = calls.updateOne
  const data = update!.data as Record<string, unknown>
  assert.equal(update!.collection, 'offer-codes')
  assert.equal(data.status, 'claimed')
  assert.equal(data.claimedVia, 'link')
  assert.equal(data.networkHash, hashNetwork('203.0.113.7', 'secret'))
  assert.ok(!JSON.stringify(calls).includes('203.0.113.7'))

  const clauses = (update!.where as { and: Record<string, unknown>[] }).and
  assert.deepEqual(clauses[0], { app: { equals: 'lockinminder' } })
  assert.deepEqual(clauses[1], { status: { equals: 'available' } })
  assert.ok(JSON.stringify(clauses[2]).includes('expiresAt'))
})

test('stops a network at the daily limit before giving out a code', async () => {
  process.env.OFFER_CODES_API_KEY = 'key'
  process.env.OFFER_CODES_PER_NETWORK_PER_DAY = '3'
  const { calls, payload } = fakePayload({ counts: [3] })
  const res = await claim(request({ payload }))
  assert.equal(res.status, 429)
  assert.equal(calls.updateOne.length, 0)
})

test('without an IP address or with the limit off, nothing is counted before the claim', async () => {
  process.env.OFFER_CODES_API_KEY = 'key'
  const first = fakePayload({ counts: [10] })
  assert.equal((await claim(request({ body: { app: 'lockinminder' }, payload: first.payload }))).status, 200)
  assert.equal(first.calls.count.length, 1)
  assert.equal((first.calls.updateOne[0]!.data as Record<string, unknown>).networkHash, undefined)

  process.env.OFFER_CODES_PER_NETWORK_PER_DAY = '0'
  const second = fakePayload({ counts: [10] })
  assert.equal((await claim(request({ payload: second.payload }))).status, 200)
  assert.equal(second.calls.count.length, 1)
})

test('answers 410 once every code is given out', async () => {
  process.env.OFFER_CODES_API_KEY = 'key'
  const { payload } = fakePayload({ claimed: null })
  const res = await claim(request({ payload }))
  assert.equal(res.status, 410)
  assert.equal(((await res.json()) as Record<string, unknown>).available, 0)
})

test('availability counts codes without revealing any', async () => {
  process.env.OFFER_CODES_API_KEY = 'key'
  const { calls, payload } = fakePayload({ counts: [120, 500] })
  const res = await availability(
    request({ payload, url: 'http://cms/api/offer-codes/availability?app=lockinminder' }),
  )
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { app: 'lockinminder', available: 120, total: 500 })
  assert.equal(calls.count.length, 2)
  assert.equal(
    (await availability(request({ payload, url: 'http://cms/api/offer-codes/availability?app=x' }))).status,
    400,
  )
})
