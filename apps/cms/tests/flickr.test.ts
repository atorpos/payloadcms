import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { flickrGalleryEndpoint, flickrSyncEndpoint } from '../src/personal/flickr/endpoints.ts'

const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }
afterEach(() => {
  globalThis.fetch = originalFetch
  process.env = { ...originalEnv }
})

const photo = {
  id: '123', owner: '123@N01', title: 'A photo', ispublic: 1, media: 'photo',
  url_z: 'https://live.staticflickr.com/1/123_a_z.jpg', width_z: 640, height_z: 480,
}
const request = (payload: unknown, authorization = 'Bearer secret', url = 'http://cms/api/flickr-sync') => ({
  headers: new Headers({ authorization }), url, payload,
}) as never
const handler = flickrSyncEndpoint.handler as (req: never) => Promise<Response>

test('rejects a sync without the correct secret before contacting Flickr', async () => {
  process.env.FLICKR_SYNC_SECRET = 'secret'
  let called = false
  globalThis.fetch = (async () => { called = true; throw new Error('unexpected') }) as typeof fetch
  const res = await handler(request({}, 'Bearer wrong'))
  assert.equal(res.status, 401)
  assert.equal(called, false)
})

test('updates public photos without overwriting editorial visibility and reconciles only after a complete fetch', async () => {
  process.env.FLICKR_SYNC_SECRET = 'secret'
  process.env.FLICKR_API_KEY = 'key'
  process.env.FLICKR_USER_ID = '123@N01'
  globalThis.fetch = (async () => Response.json({ stat: 'ok', photos: { page: 1, pages: 1, total: 1, photo: [photo] } })) as typeof fetch
  const writes: Record<string, unknown>[] = []
  const payload = {
    find: async () => ({ docs: [{ id: 'db1', flickrId: '123', displayOnWebsite: false }] }),
    update: async (data: Record<string, unknown>) => { writes.push(data); return { errors: [] } },
    create: async () => { throw new Error('unexpected create') },
    logger: { error: () => {} },
  }
  const res = await handler(request(payload))
  assert.equal(res.status, 200)
  assert.equal(writes.length, 3)
  assert.equal((writes[0].data as Record<string, unknown>).displayOnWebsite, undefined)
  assert.equal((writes[0].data as Record<string, unknown>).flickrUrl, 'https://www.flickr.com/photos/123%40N01/123/')
  assert.equal((writes[1].data as Record<string, unknown>).isPublic, false)
  assert.ok((writes[2].data as Record<string, unknown>).lastSyncedAt)
})

test('does not reconcile or publish a partial Flickr snapshot', async () => {
  process.env.FLICKR_SYNC_SECRET = 'secret'
  process.env.FLICKR_API_KEY = 'key'
  process.env.FLICKR_USER_ID = '123@N01'
  globalThis.fetch = (async () => Response.json({ stat: 'ok', photos: { page: 1, pages: 1, total: 2, photo: [photo] } })) as typeof fetch
  let writes = 0
  const payload = { find: async () => { writes++; return { docs: [] } }, update: async () => { writes++ }, create: async () => { writes++ }, logger: { error: () => {} } }
  const res = await handler(request(payload))
  assert.equal(res.status, 502)
  assert.equal(writes, 0)
})

test('public gallery enforces visibility, freshness and a 30 photo limit', async () => {
  let query: Record<string, unknown> = {}
  const payload = { find: async (args: Record<string, unknown>) => { query = args; return { docs: [], totalPages: 0, totalDocs: 0 } } }
  const gallery = flickrGalleryEndpoint.handler as (req: never) => Promise<Response>
  const res = await gallery(request(payload, '', 'http://cms/api/flickr-gallery?page=2'))
  assert.equal(query.limit, 30)
  assert.equal(query.page, 2)
  const clauses = (query.where as { and: Record<string, unknown>[] }).and
  assert.deepEqual(clauses[0], { isPublic: { equals: true } })
  assert.deepEqual(clauses[1], { displayOnWebsite: { equals: true } })
  assert.ok(clauses[2].lastSyncedAt)
  assert.equal(res.headers.get('cache-control'), 'no-store')
})
