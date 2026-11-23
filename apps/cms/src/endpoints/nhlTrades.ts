import type { Endpoint, PayloadRequest } from 'payload'

import { hockeyApi, HockeyApiError } from '../nhl/hockeyApi'
import { forward } from './nhlData'

/**
 * What the Trades screens (src/components/NhlData/NhlTrade*View.tsx) do, sent on to the HockeyPoolCap API's
 * /api/v1/admin/trades endpoints with its admin key. Only for logged-in users; who acted is the logged-in user's
 * email, set here, not by the browser.
 */

const tradeId = (req: PayloadRequest) => {
  const id = Number(req.routeParams?.id)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

const notFound = () => Response.json({ errors: [{ message: 'Not found.' }] }, { status: 404 })

/** Calls the API with a body made here; answers like forward() */
const send = async (req: PayloadRequest, method: string, path: string, body: object) => {
  if (!req.user) {
    return Response.json({ errors: [{ message: 'Log in to work on trades.' }] }, { status: 401 })
  }
  try {
    const answer = await hockeyApi<unknown>(path, { body, method })
    return answer === undefined ? new Response(null, { status: 204 }) : Response.json(answer)
  } catch (error) {
    if (error instanceof HockeyApiError) {
      return Response.json({ errors: [{ message: error.message }], fieldErrors: error.fieldErrors }, { status: error.status })
    }
    throw error
  }
}

const who = (req: PayloadRequest) => (req.user as { email?: string } | null)?.email ?? 'a CMS user'

/** `POST /api/nhl-data/trades/detect`: reads the NHL's trade tracker now */
export const nhlTradesDetectEndpoint: Endpoint = {
  handler: (req) => send(req, 'POST', '/api/v1/admin/trades/detect', {}),
  method: 'post',
  path: '/nhl-data/trades/detect',
}

/** `POST /api/nhl-data/trades/:id/reprocess` */
export const nhlTradeReprocessEndpoint: Endpoint = {
  handler: (req) => {
    const id = tradeId(req)
    return id ? send(req, 'POST', `/api/v1/admin/trades/${id}/reprocess`, { by: who(req) }) : notFound()
  },
  method: 'post',
  path: '/nhl-data/trades/:id/reprocess',
}

/** `POST /api/nhl-data/trades/:id/revert`: undoes what it changed */
export const nhlTradeRevertEndpoint: Endpoint = {
  handler: (req) => {
    const id = tradeId(req)
    return id ? send(req, 'POST', `/api/v1/admin/trades/${id}/revert`, { by: who(req) }) : notFound()
  },
  method: 'post',
  path: '/nhl-data/trades/:id/revert',
}

/** `DELETE /api/nhl-data/trades/:id`: a trade that changed nothing */
export const nhlTradeDeleteEndpoint: Endpoint = {
  handler: (req) => {
    const id = tradeId(req)
    return id ? forward(req, 'DELETE', `/api/v1/admin/trades/${id}`, { what: 'trades' }) : notFound()
  },
  method: 'delete',
  path: '/nhl-data/trades/:id',
}

/** `PATCH /api/nhl-data/trades/:id/assets/:assetId`: settles an asset from the official sources */
export const nhlTradeAssetEndpoint: Endpoint = {
  handler: (req) => {
    const id = tradeId(req)
    const assetId = Number(req.routeParams?.assetId)
    return id && Number.isSafeInteger(assetId) && assetId > 0
      ? forward(req, 'PATCH', `/api/v1/admin/trades/${id}/assets/${assetId}`, { what: 'trades' })
      : notFound()
  },
  method: 'patch',
  path: '/nhl-data/trades/:id/assets/:assetId',
}

/** `POST /api/nhl-data/trades/:id/notifications/test`: `{ deviceId }` or `{ token }`: one phone only */
export const nhlTradeTestEndpoint: Endpoint = {
  handler: (req) => {
    const id = tradeId(req)
    return id ? forward(req, 'POST', `/api/v1/admin/trades/${id}/notifications/test`, { what: 'trades' }) : notFound()
  },
  method: 'post',
  path: '/nhl-data/trades/:id/notifications/test',
}

const audience = (req: PayloadRequest) => {
  const value = req.routeParams?.audience
  return value === 'breakingNews' || value === 'tradeFollowers' ? value : null
}

/** `POST /api/nhl-data/trades/:id/notifications/:audience/approve`: approved by the logged-in user */
export const nhlTradeApproveEndpoint: Endpoint = {
  handler: (req) => {
    const id = tradeId(req)
    const to = audience(req)
    return id && to
      ? send(req, 'POST', `/api/v1/admin/trades/${id}/notifications/${to}/approve`, { approvedBy: who(req) })
      : notFound()
  },
  method: 'post',
  path: '/nhl-data/trades/:id/notifications/:audience/approve',
}

/** `POST /api/nhl-data/trades/:id/notifications/:audience/cancel` */
export const nhlTradeCancelEndpoint: Endpoint = {
  handler: (req) => {
    const id = tradeId(req)
    const to = audience(req)
    return id && to
      ? send(req, 'POST', `/api/v1/admin/trades/${id}/notifications/${to}/cancel`, { by: who(req) })
      : notFound()
  },
  method: 'post',
  path: '/nhl-data/trades/:id/notifications/:audience/cancel',
}
