import type { Endpoint, PayloadRequest, Where } from 'payload'

import { slugify } from 'payload/shared'

import type { MarketMaterial, Media, VigorNewsArticle } from '../payload-types'

import { refuseWithoutAppApiKey } from './appApiKey'

/**
 * Market news: the weekly raw material articles awoz-api's market news agent writes (MarketNewsJob there), saved as
 * drafts in Vigor website → News (category Market) for the team to check and publish; then on the Vigor website's
 * newsroom and in the VgemsAI app's Research tab. Server to server only, with `X-API-Key: <APP_API_KEY>`
 * (./appApiKey.ts); while APP_API_KEY is empty every endpoint answers 404.
 *
 *   GET  /api/app/market-news/weeks/:week   whether that week's article exists, and the last few articles' titles
 *   POST /api/app/market-news               saves a new article as a draft, with its picture
 *   GET  /api/app/market-news               the published ones, newest first (for the app)
 *   GET  /api/app/market-news/:slug         one published article, whole
 */

const MAX_PARAGRAPHS = 12
const MAX_SOURCES = 10
const MAX_DEALS = 10
const MAX_CHART_POINTS = 600
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const MAX_LIMIT = 50
/** Where pictures may be downloaded from: Wikimedia Commons' file server, unless MARKET_NEWS_IMAGE_HOSTS says */
const imageHosts = () =>
  (process.env.MARKET_NEWS_IMAGE_HOSTS || 'upload.wikimedia.org')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)

const fromAwozApi = { disableRevalidate: true, fromAwozApi: true }

/**
 * `GET /api/app/market-news/weeks/:week` - e.g. `2026-W47`: `{ exists, id, slug, status }` for that week's article
 * (draft or published), and `recent: [{ title, material, week }]`, the last 6 market articles, so the agent doesn't
 * repeat them.
 */
export const appMarketNewsWeekEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const week = String(req.routeParams?.week ?? '')
    const existing = await findWeek(req, week)
    const { docs } = await req.payload.find({
      collection: 'vigor-news',
      depth: 1,
      draft: true,
      limit: 6,
      locale: 'en',
      overrideAccess: true,
      sort: '-date',
      where: { category: { equals: 'Market' } },
    })

    return Response.json({
      exists: Boolean(existing),
      id: existing?.id ?? null,
      recent: docs.map((doc) => ({
        material: materialOf(doc)?.key ?? null,
        title: doc.title,
        week: doc.market?.week ?? null,
      })),
      slug: existing?.slug ?? null,
      status: existing?._status ?? null,
    })
  },
  method: 'get',
  path: '/app/market-news/weeks/:week',
}

/**
 * `POST /api/app/market-news` - saves the week's article as a **draft**, unless that week has one already (then it
 * answers that one, `status: "exists"`):
 *
 *   { "week": "2026-W47", "material": "gold", "title": "…", "summary": "…", "paragraphs": ["…", "…"],
 *     "period": { "start": "2026-11-09", "end": "2026-11-16", "startPrice": 2601.2, "endPrice": 2650.5,
 *                 "changePercent": 1.9, "unit": "USD/oz" },
 *     "chart": [{ "date": "2025-11-17", "price": 2402.1 }, …],
 *     "sources": [{ "title": "…", "publisher": "Reuters", "url": "https://…", "publishedAt": "2026-11-14" }],
 *     "deals": [{ "product": "1 oz gold bar", "store": "…", "price": 2712, "currency": "USD", "url": "https://…",
 *                 "seenAt": "2026-11-16" }],
 *     "image": { "url": "https://upload.wikimedia.org/…", "alt": "Gold bars", "credit": "Photo: …, CC BY-SA 4.0",
 *                "creditUrl": "https://commons.wikimedia.org/wiki/File:…" } }
 *
 * The picture is downloaded into the media library (only from MARKET_NEWS_IMAGE_HOSTS, Wikimedia Commons by default);
 * when that fails, the article is saved without it and `problems` says why. Answers
 * `201 { status: "created", id, slug, problems }`.
 */
export const appMarketNewsSaveEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const body = ((await req.json?.().catch(() => null)) ?? {}) as Record<string, unknown>
    const checked = await checkArticle(req, body)

    if ('errors' in checked) {
      return Response.json({ errors: checked.errors }, { status: 400 })
    }

    const existing = await findWeek(req, checked.week)

    if (existing) {
      return Response.json({ id: existing.id, slug: existing.slug, status: 'exists' })
    }

    const problems: string[] = []
    let imageId: null | string = null

    if (checked.image) {
      try {
        imageId = await downloadImage(req, checked.image)
      } catch (error) {
        problems.push(`The picture couldn't be saved: ${(error as Error).message}`)
      }
    }

    const today = new Date().toISOString().slice(0, 10)
    const article = await req.payload.create({
      collection: 'vigor-news',
      context: fromAwozApi,
      data: {
        _status: 'draft',
        body: checked.paragraphs.join('\n\n'),
        category: 'Market',
        // Day-only dates are kept at 12:00 UTC on the day
        date: `${today}T12:00:00.000Z`,
        deals: checked.deals,
        foundBy: 'claude',
        image: imageId,
        imageCredit: imageId ? checked.image?.credit : null,
        imageCreditUrl: imageId ? checked.image?.creditUrl : null,
        market: {
          chart: checked.chart,
          changePercent: checked.period.changePercent,
          endPrice: checked.period.endPrice,
          material: checked.material.id,
          materialName: checked.material.name,
          periodEnd: `${checked.period.end}T12:00:00.000Z`,
          periodStart: `${checked.period.start}T12:00:00.000Z`,
          startPrice: checked.period.startPrice,
          unit: checked.period.unit,
          week: checked.week,
        },
        // Unique and readable: the title, and the week it's about
        slug: `${slugify(checked.title) || 'market'}-${checked.week.toLowerCase()}`.slice(0, 120),
        sources: checked.sources,
        summary: checked.summary,
        title: checked.title,
      },
      draft: true,
      locale: 'en',
      overrideAccess: true,
    })

    req.payload.logger.info({
      msg: `Market news draft saved: "${article.title}" (${checked.week})`,
    })

    return Response.json(
      { id: article.id, problems, slug: article.slug, status: 'created' },
      { status: 201 },
    )
  },
  method: 'post',
  path: '/app/market-news',
}

/**
 * `GET /api/app/market-news?page=&limit=` - the published market articles, newest first, without their text:
 *
 *   { docs: [{ id, slug, title, summary, date, image, imageCredit, imageCreditUrl,
 *              market: { material, materialName, unit, periodStart, periodEnd, startPrice, endPrice,
 *                        changePercent } }], totalDocs, page, limit, totalPages, hasNextPage }
 */
export const appMarketNewsListEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const limit = Math.min(
      Math.max(Math.trunc(Number(req.searchParams.get('limit'))) || 10, 1),
      MAX_LIMIT,
    )
    const page = Math.max(Math.trunc(Number(req.searchParams.get('page'))) || 1, 1)
    const result = await req.payload.find({
      collection: 'vigor-news',
      depth: 1,
      limit,
      locale: 'en',
      overrideAccess: true,
      page,
      sort: '-date',
      where: published,
    })

    return Response.json({
      docs: result.docs.map((doc) => summaryOf(req, doc)),
      hasNextPage: result.hasNextPage,
      limit: result.limit,
      page: result.page ?? 1,
      totalDocs: result.totalDocs,
      totalPages: result.totalPages,
    })
  },
  method: 'get',
  path: '/app/market-news',
}

/**
 * `GET /api/app/market-news/:slug` - one published market article: as in the list, plus `paragraphs`, `chart`,
 * `sources`, `deals` and `websiteUrl` (its page on the Vigor website, when VIGOR_WEBSITE_URL is set). 404 for a draft.
 */
export const appMarketNewsArticleEndpoint: Endpoint = {
  handler: async (req) => {
    const refused = refuseWithoutAppApiKey(req)

    if (refused) {
      return refused
    }

    const slug = String(req.routeParams?.slug ?? '')
    const { docs } = await req.payload.find({
      collection: 'vigor-news',
      depth: 1,
      limit: 1,
      locale: 'en',
      overrideAccess: true,
      where: { and: [published, { slug: { equals: slug } }] },
    })
    const article = docs[0]

    if (!article) {
      return Response.json({ errors: [{ message: 'Article not found.' }] }, { status: 404 })
    }

    const website = process.env.VIGOR_WEBSITE_URL?.replace(/\/+$/, '')

    return Response.json({
      ...summaryOf(req, article),
      chart: chartOf(article.market?.chart),
      deals: (article.deals ?? []).map((deal) => ({
        currency: deal.currency,
        price: deal.price,
        product: deal.product,
        seenAt: deal.seenAt?.slice(0, 10) ?? null,
        store: deal.store,
        url: deal.url,
      })),
      paragraphs: (article.body ?? '')
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean),
      sources: (article.sources ?? []).map((source) => ({
        publishedAt: source.publishedAt ?? null,
        publisher: source.publisher ?? null,
        title: source.title,
        url: source.url,
      })),
      websiteUrl: website ? `${website}/news/${article.slug}` : null,
    })
  },
  method: 'get',
  path: '/app/market-news/:slug',
}

const published: Where = {
  and: [{ category: { equals: 'Market' } }, { _status: { equals: 'published' } }],
}

const findWeek = async (req: PayloadRequest, week: string) => {
  if (!/^\d{4}-W\d{2}$/.test(week)) {
    return null
  }
  const { docs } = await req.payload.find({
    collection: 'vigor-news',
    depth: 0,
    draft: true,
    limit: 1,
    overrideAccess: true,
    where: { 'market.week': { equals: week } },
  })

  return docs[0] ?? null
}

const materialOf = (article: VigorNewsArticle): MarketMaterial | null =>
  article.market?.material && typeof article.market.material === 'object'
    ? article.market.material
    : null

const summaryOf = (req: PayloadRequest, article: VigorNewsArticle) => {
  const material = materialOf(article)

  return {
    id: article.id,
    date: article.date?.slice(0, 10) ?? null,
    image: appImage(req, article.image),
    imageCredit: article.imageCredit ?? null,
    imageCreditUrl: article.imageCreditUrl ?? null,
    market: {
      changePercent: article.market?.changePercent ?? null,
      endPrice: article.market?.endPrice ?? null,
      material: material?.key ?? null,
      materialName: article.market?.materialName ?? material?.name ?? null,
      periodEnd: article.market?.periodEnd?.slice(0, 10) ?? null,
      periodStart: article.market?.periodStart?.slice(0, 10) ?? null,
      startPrice: article.market?.startPrice ?? null,
      unit: article.market?.unit ?? material?.unit ?? null,
    },
    slug: article.slug,
    summary: article.summary,
    title: article.title,
  }
}

/** The chart's prices as saved, keeping only well-formed points */
const chartOf = (value: unknown): { date: string; price: number }[] =>
  Array.isArray(value)
    ? value
        .filter(
          (point): point is { date: string; price: number } =>
            Boolean(point) &&
            typeof point === 'object' &&
            typeof (point as { date?: unknown }).date === 'string' &&
            typeof (point as { price?: unknown }).price === 'number',
        )
        .map(({ date, price }) => ({ date, price }))
    : []

const appImage = (req: PayloadRequest, image: VigorNewsArticle['image']) => {
  if (!image || typeof image !== 'object' || !image.url) {
    return null
  }
  const media = image as Media
  const large = media.variants?.max1440

  return {
    alt: media.alt,
    height: large?.height ?? media.height ?? null,
    url: absolute(req, large?.url || media.url!),
    width: large?.width ?? media.width ?? null,
  }
}

/** Files on this server come with a path only: the app needs the whole address */
const absolute = (req: PayloadRequest, url: string) =>
  /^https?:\/\//.test(url) ? url : `${req.payload.config.serverURL ?? ''}${url}`

type CheckedArticle = {
  chart: { date: string; price: number }[]
  deals: {
    currency: string
    price: number
    product: string
    seenAt: string
    store: string
    url: string
  }[]
  image: null | { alt: string; credit: null | string; creditUrl: null | string; url: string }
  material: MarketMaterial
  paragraphs: string[]
  period: {
    changePercent: number
    end: string
    endPrice: number
    start: string
    startPrice: number
    unit: null | string
  }
  sources: { publishedAt: null | string; publisher: null | string; title: string; url: string }[]
  summary: string
  title: string
  week: string
}

/** The article as it may be saved, or what's wrong with it */
const checkArticle = async (
  req: PayloadRequest,
  body: Record<string, unknown>,
): Promise<{ errors: { message: string; path: string }[] } | CheckedArticle> => {
  const errors: { message: string; path: string }[] = []
  const week = text(body.week, 10) ?? ''
  const title = text(body.title, 160)
  const summary = text(body.summary, 600)
  const paragraphs = (Array.isArray(body.paragraphs) ? body.paragraphs : [])
    .map((paragraph) => text(paragraph, 3000))
    .filter((paragraph): paragraph is string => Boolean(paragraph))
    .slice(0, MAX_PARAGRAPHS)
  const period = (body.period && typeof body.period === 'object' ? body.period : {}) as Record<
    string,
    unknown
  >

  if (!/^\d{4}-W\d{2}$/.test(week)) {
    errors.push({ message: 'week must be like 2026-W47.', path: 'week' })
  }
  if (!title) {
    errors.push({ message: 'The title is missing.', path: 'title' })
  }
  if (!summary) {
    errors.push({ message: 'The summary is missing.', path: 'summary' })
  }
  if (paragraphs.length < 2) {
    errors.push({ message: 'At least two paragraphs are needed.', path: 'paragraphs' })
  }

  const { docs: materials } = await req.payload.find({
    collection: 'market-materials',
    depth: 0,
    limit: 1,
    overrideAccess: true,
    where: { key: { equals: text(body.material, 40) ?? '' } },
  })
  const material = materials[0]

  if (!material) {
    errors.push({
      message: `"${String(body.material)}" isn't a market material's key.`,
      path: 'material',
    })
  }

  const start = day(period.start)
  const end = day(period.end)
  const numbers = ['startPrice', 'endPrice', 'changePercent'].map((field) =>
    typeof period[field] === 'number' && Number.isFinite(period[field])
      ? (period[field] as number)
      : null,
  )

  if (!start || !end || numbers.some((value) => value === null)) {
    errors.push({
      message: 'period needs start, end, startPrice, endPrice and changePercent.',
      path: 'period',
    })
  }

  const sources = (Array.isArray(body.sources) ? body.sources : [])
    .map((value) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {}))
    .map((source) => ({
      publishedAt: text(source.publishedAt, 20),
      publisher: text(source.publisher, 120),
      title: text(source.title, 300),
      url: httpUrl(source.url),
    }))
    .filter((source): source is CheckedArticle['sources'][number] =>
      Boolean(source.title && source.url),
    )
    .slice(0, MAX_SOURCES)

  if (!sources.length) {
    errors.push({ message: 'At least one source is needed.', path: 'sources' })
  }

  const deals = (Array.isArray(body.deals) ? body.deals : [])
    .map((value) => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {}))
    .map((deal) => ({
      currency: (text(deal.currency, 3) ?? '').toUpperCase(),
      price: typeof deal.price === 'number' && deal.price > 0 ? deal.price : 0,
      product: text(deal.product, 300) ?? '',
      seenAt: day(deal.seenAt) ? `${day(deal.seenAt)}T12:00:00.000Z` : '',
      store: text(deal.store, 120) ?? '',
      url: httpUrl(deal.url) ?? '',
    }))
    .filter(
      (deal) =>
        deal.product &&
        deal.store &&
        deal.price &&
        /^[A-Z]{3}$/.test(deal.currency) &&
        deal.url &&
        deal.seenAt,
    )
    .slice(0, MAX_DEALS)

  const chart = chartOf(body.chart)
    .filter((point) => day(point.date) && Number.isFinite(point.price))
    .slice(-MAX_CHART_POINTS)
  const imageBody = (
    body.image && typeof body.image === 'object' ? body.image : null
  ) as null | Record<string, unknown>
  const imageUrl = httpUrl(imageBody?.url)
  const image =
    imageBody && imageUrl
      ? {
          alt: text(imageBody.alt, 300) ?? title ?? 'Market news',
          credit: text(imageBody.credit, 300),
          creditUrl: httpUrl(imageBody.creditUrl),
          url: imageUrl,
        }
      : null

  if (errors.length || !material || !title || !summary || !start || !end) {
    return { errors }
  }

  return {
    chart,
    deals,
    image,
    material,
    paragraphs,
    period: {
      changePercent: numbers[2]!,
      end,
      endPrice: numbers[1]!,
      start,
      startPrice: numbers[0]!,
      unit: text(period.unit, 30) ?? material.unit ?? null,
    },
    sources,
    summary,
    title,
    week,
  }
}

/** Saves the picture in the media library; only from the allowed hosts, and only images */
const downloadImage = async (req: PayloadRequest, image: NonNullable<CheckedArticle['image']>) => {
  const url = new URL(image.url)

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('not a web address')
  }
  if (!imageHosts().includes(url.hostname.toLowerCase())) {
    throw new Error(`${url.hostname} isn't an allowed picture host (MARKET_NEWS_IMAGE_HOSTS)`)
  }

  const res = await fetch(url, {
    headers: { 'User-Agent': 'VigorCMS-MarketNews/1.0' },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`)
  }

  const mimetype = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimetype)) {
    throw new Error(`not a JPEG, PNG or WebP picture (${mimetype || 'no content type'})`)
  }

  const data = Buffer.from(await res.arrayBuffer())

  if (data.length > MAX_IMAGE_BYTES) {
    throw new Error('larger than 15 MB')
  }

  const extension = mimetype.slice('image/'.length).replace('jpeg', 'jpg')
  const name = (slugify(image.alt) ?? '').slice(0, 60) || 'market-news'
  const media = await req.payload.create({
    collection: 'media',
    context: fromAwozApi,
    data: { alt: image.alt },
    file: { data, mimetype, name: `${name}.${extension}`, size: data.length },
    overrideAccess: true,
  })

  return String(media.id)
}

const text = (value: unknown, max = 300): null | string => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()

  return trimmed ? trimmed.slice(0, max) : null
}

const day = (value: unknown): null | string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
    ? value
    : null

const httpUrl = (value: unknown): null | string => {
  const candidate = text(value, 1000)

  if (!candidate) {
    return null
  }
  try {
    const url = new URL(candidate)

    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}
