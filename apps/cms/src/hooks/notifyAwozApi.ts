import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, PayloadRequest } from 'payload'

import { waitForCommit } from './revalidateWebsite'

/**
 * Tells awoz-api that a company or an event's exhibitors changed, so the app sees it at once rather than
 * when awoz-api's cache of them expires (5 to 10 minutes). Calls
 * `POST <AWOZ_API_URL>/api/v1/companies/cache/invalidate` with `X-API-Key: <APP_API_KEY>`, the key
 * awoz-api already uses for the CMS. Does nothing while AWOZ_API_URL is empty, or for changes awoz-api
 * makes itself (`context: { fromAwozApi: true }`), which it clears its cache for on its own.
 */
const apiURL = process.env.AWOZ_API_URL?.replace(/\/+$/, '') || ''

export const notifyAwozApiAfterChange: CollectionAfterChangeHook = ({ doc, req }) => {
  notify(req)
  return doc
}

export const notifyAwozApiAfterDelete: CollectionAfterDeleteHook = ({ doc, req }) => {
  notify(req)
  return doc
}

const notify = (req: PayloadRequest) => {
  const key = process.env.APP_API_KEY

  if (!apiURL || !key || req.context.fromAwozApi) {
    return
  }

  // Not awaited: saving in the admin panel shouldn't wait for awoz-api
  void waitForCommit({ req })
    .then(async () => {
      const res = await fetch(`${apiURL}/api/v1/companies/cache/invalidate`, {
        headers: { 'X-API-Key': key },
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`)
      }
    })
    .catch((err: unknown) => {
      req.payload.logger.warn({
        err,
        msg: 'Could not tell awoz-api that companies changed; the app sees it when its cache expires',
      })
    })
}
