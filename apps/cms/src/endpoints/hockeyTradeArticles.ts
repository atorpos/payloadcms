import type { Endpoint, PayloadRequest } from 'payload'

import type { HockeyTradeArticle } from '../payload-types'

import { articleData, cannotPublish, invalidArticle, type IncomingTradeArticle } from '../nhl/tradeArticles'
import { refuseWithoutHockeyApiKey } from './hockeyMembers'

/**
 * The HockeyPoolCap API's side of the trade articles (Trade Articles, under "HockeyPoolCap App"): it writes each
 * trade's article as a draft, publishes it only when every check passed and auto-publishing is on, and reads it for
 * the app. Server to server only, with `X-API-Key: <HOCKEY_API_KEY>`; while HOCKEY_API_KEY is empty the endpoints
 * answer 404.
 *
 * Each answers the article: `{ id, slug, title, seoDescription, status, sections, analysisNote, verification,
 * publishedAt, updatedAt, editedByEditor }`.
 */

/** `PUT /api/hockey/trade-articles/by-trade/:tradeId`: writes the draft, or updates it (an editor's text stays) */
export const hockeyTradeArticleSaveEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutHockeyApiKey(req)
    if (refused) {
      return refused
    }
    const tradeId = routeTradeId(req)
    const article = (await req.json?.().catch(() => null)) as IncomingTradeArticle | null
    const invalid = invalidArticle(article) ?? (article?.tradeId !== tradeId ? 'tradeId differs from the path.' : null)
    if (!tradeId || !article || invalid) {
      return Response.json({ errors: [{ message: invalid ?? 'No trade.' }] }, { status: 400 })
    }
    const stored = await findArticle(req, tradeId)
    const data = articleData(article, stored)
    const saved = stored
      ? await req.payload.update({
          id: stored.id,
          collection: 'hockey-trade-articles',
          context: { tradeApi: true },
          data,
          overrideAccess: true,
        })
      : await req.payload.create({
          collection: 'hockey-trade-articles',
          context: { tradeApi: true },
          data: data as Omit<HockeyTradeArticle, 'createdAt' | 'id' | 'updatedAt'>,
          overrideAccess: true,
        })
    return Response.json(answer(saved))
  },
  method: 'put',
  path: '/hockey/trade-articles/by-trade/:tradeId',
}

/** `POST /api/hockey/trade-articles/by-trade/:tradeId/publish`: `409` while its trade needs review */
export const hockeyTradeArticlePublishEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutHockeyApiKey(req)
    if (refused) {
      return refused
    }
    const tradeId = routeTradeId(req)
    const stored = tradeId ? await findArticle(req, tradeId) : null
    if (!stored) {
      return Response.json({ errors: [{ message: 'No article for this trade.' }] }, { status: 404 })
    }
    const reason = cannotPublish(stored.verification)
    if (reason) {
      return Response.json({ errors: [{ message: reason }] }, { status: 409 })
    }
    const saved = await req.payload.update({
      id: stored.id,
      collection: 'hockey-trade-articles',
      context: { tradeApi: true },
      data: { status: 'published' },
      overrideAccess: true,
    })
    return Response.json(answer(saved))
  },
  method: 'post',
  path: '/hockey/trade-articles/by-trade/:tradeId/publish',
}

/** `GET /api/hockey/trade-articles/by-trade/:tradeId`: `404` when there's none */
export const hockeyTradeArticleEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutHockeyApiKey(req)
    if (refused) {
      return refused
    }
    const tradeId = routeTradeId(req)
    const stored = tradeId ? await findArticle(req, tradeId) : null
    return stored
      ? Response.json(answer(stored))
      : Response.json({ errors: [{ message: 'No article for this trade.' }] }, { status: 404 })
  },
  method: 'get',
  path: '/hockey/trade-articles/by-trade/:tradeId',
}

const routeTradeId = (req: PayloadRequest) => {
  const id = Number(req.routeParams?.tradeId)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

const findArticle = async (req: PayloadRequest, tradeId: number) => {
  const { docs } = await req.payload.find({
    collection: 'hockey-trade-articles',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { tradeId: { equals: tradeId } },
  })
  return docs[0] ?? null
}

const answer = (article: HockeyTradeArticle) => ({
  analysisNote: article.analysisNote ?? null,
  editedByEditor: Boolean(article.editedByEditor),
  id: article.id,
  publishedAt: article.publishedAt ?? null,
  sections: (article.sections ?? []).map((section) => ({
    body: section.body,
    heading: section.heading ?? null,
    kind: section.kind,
  })),
  seoDescription: article.seoDescription ?? null,
  slug: article.slug,
  status: article.status,
  title: article.title,
  updatedAt: article.updatedAt,
  verification: article.verification ?? null,
})
