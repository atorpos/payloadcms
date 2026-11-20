import type { Endpoint } from 'payload'

import { timingSafeEqual } from 'node:crypto'

// A separate collection avoids turning Flickr images into CMS uploads. Local API access is
// intentionally privileged: the sync is a server operation authenticated by its own secret.
type Photo = {
  id: string
  flickrId: string
  displayOnWebsite?: boolean
  [key: string]: unknown
}
type FlickrPayload = {
  find: (args: Record<string, unknown>) => Promise<{ docs: Photo[]; totalDocs: number; totalPages: number }>
  create: (args: Record<string, unknown>) => Promise<unknown>
  update: (args: Record<string, unknown>) => Promise<unknown>
}

type FlickrPhoto = {
  id: string
  owner: string
  title?: string
  ispublic?: number | string
  media?: string
  description?: { _content?: string }
  tags?: string
  license?: string
  datetaken?: string
  dateupload?: string
  [key: string]: unknown
}

type FlickrResult = {
  stat: string
  photos?: { page: number; pages: number; total: number | string; photo: FlickrPhoto[] }
}

const collection = 'flickr-photos'
const maxAgeHours = 20
let isSyncing = false

export const flickrSyncEndpoint: Endpoint = {
  path: '/flickr-sync',
  method: 'post',
  handler: async (req) => {
    const secret = process.env.FLICKR_SYNC_SECRET || ''
    const provided = req.headers.get('authorization') || ''
    const expected = `Bearer ${secret}`
    if (!secret || Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
        !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!process.env.FLICKR_API_KEY || !process.env.FLICKR_USER_ID) {
      return Response.json({ error: 'Flickr is not configured' }, { status: 503 })
    }
    if (isSyncing) return Response.json({ error: 'Sync already in progress' }, { status: 409 })
    isSyncing = true
    try {
      const payload = req.payload as unknown as FlickrPayload
      const photos = await fetchAllPhotos({ apiKey: process.env.FLICKR_API_KEY, userId: process.env.FLICKR_USER_ID })
      const syncedAt = new Date().toISOString()
      for (const photo of photos) {
        const current = await payload.find({ collection, where: { flickrId: { equals: photo.flickrId } }, limit: 1, overrideAccess: true })
        if (current.docs[0]) {
          await payload.update({ collection, id: current.docs[0].id, data: photo, overrideAccess: true })
        } else {
          await payload.create({ collection, data: { ...photo, displayOnWebsite: true }, overrideAccess: true })
        }
      }
      // Only reconcile after every Flickr page and every upsert succeeds. The timestamp also
      // expires old records if a sync fails or the scheduler stops for an extended period.
      const seen = photos.map((photo) => photo.flickrId)
      const reconciled = await payload.update({ collection, where: seen.length ? { flickrId: { not_in: seen } } : { isPublic: { equals: true } }, data: { isPublic: false }, overrideAccess: true }) as { errors?: unknown[] }
      if (reconciled.errors?.length) throw new Error('Could not reconcile all Flickr photos')
      // Mark the snapshot fresh only after reconciliation; partial runs never extend visibility.
      if (seen.length) {
        const refreshed = await payload.update({ collection, where: { flickrId: { in: seen } }, data: { lastSyncedAt: syncedAt }, overrideAccess: true }) as { errors?: unknown[] }
        if (refreshed.errors?.length) throw new Error('Could not refresh all Flickr photos')
      }
      return Response.json({ synced: photos.length, syncedAt })
    } catch (err) {
      req.payload.logger.error({ err, msg: 'Flickr sync failed' })
      return Response.json({ error: 'Flickr sync failed; check server logs' }, { status: 502 })
    } finally {
      isSyncing = false
    }
  },
}

export const flickrGalleryEndpoint: Endpoint = {
  path: '/flickr-gallery',
  method: 'get',
  handler: async (req) => {
    const url = new URL(req.url || 'http://localhost')
    const requestedPage = Number(url.searchParams.get('page') || 1)
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const payload = req.payload as unknown as FlickrPayload
    const result = await payload.find({
      collection, overrideAccess: true, depth: 0, page, limit: 30, sort: '-dateUploaded',
      where: { and: [
        { isPublic: { equals: true } },
        { displayOnWebsite: { equals: true } },
        { lastSyncedAt: { greater_than: new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString() } },
      ] },
    })
    return Response.json({
      docs: result.docs.map(({ flickrId, title, flickrUrl, imageUrl, width, height }) => ({ flickrId, title, flickrUrl, imageUrl, width, height })),
      page, totalPages: result.totalPages, totalDocs: result.totalDocs,
    }, { headers: { 'Cache-Control': 'no-store' } })
  },
}

async function fetchAllPhotos({ apiKey, userId }: { apiKey: string; userId: string }) {
  const items: FlickrPhoto[] = []
  let expectedTotal: number | undefined
  let expectedPages: number | undefined
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({
      method: 'flickr.people.getPublicPhotos', api_key: apiKey, user_id: userId,
      extras: 'description,date_upload,date_taken,tags,license,media,url_m,url_z,url_c,url_l',
      per_page: '500', page: String(page), format: 'json', nojsoncallback: '1',
    })
    const response = await fetch(`https://www.flickr.com/services/rest/?${params}`, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Flickr returned HTTP ${response.status}`)
    const result = await response.json() as FlickrResult
    const data = result.photos
    if (result.stat !== 'ok' || !data || !Array.isArray(data.photo)) throw new Error('Invalid Flickr response')
    const total = Number(data.total)
    const pages = Number(data.pages)
    if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(pages) || pages < 0 || Number(data.page) !== page ||
        (expectedTotal !== undefined && (expectedTotal !== total || expectedPages !== pages))) {
      throw new Error('Flickr pagination changed during sync')
    }
    expectedTotal = total
    expectedPages = pages
    items.push(...data.photo)
    if (page >= pages) break
    if (page > 10000) throw new Error('Flickr pagination limit exceeded')
  }
  if (items.length !== expectedTotal || new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error('Flickr returned an incomplete photo list')
  }
  return items.filter((item) => String(item.ispublic) === '1' && (!item.media || item.media === 'photo')).map((item) => {
    if (!/^\d+$/.test(item.id) || item.owner !== userId) throw new Error('Unexpected Flickr photo identity')
    const size = ['l', 'c', 'z', 'm'].find((key) => {
      const imageUrl = item[`url_${key}`]
      try {
        const parsed = new URL(String(imageUrl))
        return parsed.protocol === 'https:' && parsed.hostname === 'live.staticflickr.com' && Number(item[`width_${key}`]) > 0 && Number(item[`height_${key}`]) > 0
      } catch { return false }
    })
    if (!size) throw new Error(`Flickr photo ${item.id} has no usable image`)
    return {
      flickrId: item.id,
      title: item.title?.trim() || 'Untitled photo',
      description: item.description?._content || '',
      flickrUrl: `https://www.flickr.com/photos/${encodeURIComponent(userId)}/${item.id}/`,
      imageUrl: String(item[`url_${size}`]), width: Number(item[`width_${size}`]), height: Number(item[`height_${size}`]),
      tags: (item.tags || '').split(' ').filter(Boolean), license: item.license || '', dateTaken: item.datetaken || '',
      dateUploaded: Number(item.dateupload) || 0, isPublic: true,
    }
  })
}
