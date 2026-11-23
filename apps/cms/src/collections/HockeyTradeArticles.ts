import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { ValidationError } from 'payload'

import { loggedIn } from '../access/loggedIn'
import { cannotPublish } from '../nhl/tradeArticles'

/**
 * Articles about NHL trades, for the HockeyPoolCap app. The HockeyPoolCap API writes each one as a draft once the
 * trade is verified, applied and its caps checked (its TradeArticleWriter: facts from the verified data, and a
 * "What comes next" analysis made by rules, marked as such). Editors read, edit and publish it here; the app shows it
 * once published, through the API. An article an editor changed keeps their text: the API only updates its checks,
 * cap figures and sources. The trade itself (players, picks, caps) stays in the API's PostgreSQL database.
 */
export const HockeyTradeArticles: CollectionConfig = {
  slug: 'hockey-trade-articles',
  access: {
    create: () => false,
    delete: loggedIn,
    read: loggedIn,
    update: loggedIn,
  },
  admin: {
    defaultColumns: ['title', 'status', 'verification', 'madeOn', 'publishedAt'],
    description:
      'Written by the HockeyPoolCap API for each verified trade. Check it, edit it if needed, and publish it: the app shows it, and the trade’s notifications can then be approved (NHL Data → Trades).',
    group: 'HockeyPoolCap App',
    useAsTitle: 'title',
  },
  defaultSort: '-madeOn',
  fields: [
    { name: 'title', type: 'text', maxLength: 200, required: true },
    {
      name: 'slug',
      type: 'text',
      admin: { position: 'sidebar' },
      index: true,
      maxLength: 120,
      required: true,
      unique: true,
    },
    {
      name: 'seoDescription',
      type: 'textarea',
      admin: { description: 'For search engines and link previews, up to 160 characters' },
      label: 'SEO description',
      maxLength: 160,
    },
    {
      name: 'sections',
      type: 'array',
      admin: {
        description:
          'Facts come from the official sources and HockeyPoolCap’s data; analysis is reasoning from them. Keep them apart.',
      },
      fields: [
        { name: 'heading', type: 'text', maxLength: 120 },
        {
          name: 'kind',
          type: 'select',
          defaultValue: 'facts',
          options: [
            { label: 'Facts', value: 'facts' },
            { label: 'Analysis', value: 'analysis' },
          ],
          required: true,
        },
        { name: 'body', type: 'textarea', required: true },
      ],
      minRows: 1,
      required: true,
    },
    {
      name: 'analysisNote',
      type: 'textarea',
      admin: { description: 'Shown with the article: how its analysis was made' },
    },
    {
      name: 'status',
      type: 'select',
      admin: { position: 'sidebar' },
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
      ],
      required: true,
    },
    {
      name: 'publishedAt',
      type: 'date',
      admin: { date: { pickerAppearance: 'dayAndTime' }, position: 'sidebar', readOnly: true },
    },
    {
      name: 'verification',
      type: 'select',
      admin: {
        description: 'From the API’s checks: “with notes” means some details are inferred or noted below',
        position: 'sidebar',
        readOnly: true,
      },
      options: [
        { label: 'Verified', value: 'verified' },
        { label: 'Verified, with notes', value: 'verifiedWithNotes' },
        { label: 'Needs review', value: 'needsReview' },
      ],
    },
    {
      name: 'findings',
      type: 'array',
      admin: { description: 'What the API’s checks found', readOnly: true },
      fields: [{ name: 'finding', type: 'text' }],
    },
    { name: 'tradeId', type: 'number', admin: { position: 'sidebar', readOnly: true }, index: true, unique: true },
    { name: 'tradeKey', type: 'text', admin: { position: 'sidebar', readOnly: true } },
    { name: 'madeOn', type: 'date', admin: { position: 'sidebar', readOnly: true }, label: 'Trade made on' },
    { name: 'teams', type: 'json', admin: { readOnly: true } },
    {
      name: 'sources',
      type: 'array',
      admin: { description: 'The official announcements it rests on', readOnly: true },
      fields: [
        { name: 'url', type: 'text', required: true },
        { name: 'publisher', type: 'text' },
        { name: 'title', type: 'text' },
        { name: 'publishedAt', type: 'date' },
      ],
    },
    {
      name: 'capImpact',
      type: 'json',
      admin: { description: 'Each team’s cap before and after, as calculated by the API', readOnly: true },
    },
    { name: 'generatedAt', type: 'date', admin: { position: 'sidebar', readOnly: true } },
    {
      name: 'editedByEditor',
      type: 'checkbox',
      admin: { description: 'An editor changed it: the API keeps their text', position: 'sidebar', readOnly: true },
      defaultValue: false,
    },
  ],
  hooks: {
    beforeChange: [
      (({ context, data, operation, originalDoc, req }) => {
        const next = { ...data }
        const previous = originalDoc as { publishedAt?: string; status?: string; verification?: string } | undefined
        const status = next.status ?? previous?.status
        if (status === 'published') {
          const reason = cannotPublish(next.verification ?? previous?.verification)
          if (reason) {
            throw new ValidationError({
              collection: 'hockey-trade-articles',
              errors: [{ message: reason, path: 'status' }],
              req,
            })
          }
          next.publishedAt = previous?.publishedAt ?? new Date().toISOString()
        }
        // An editor's change (not the API's): its text stays theirs
        if (operation === 'update' && !context.tradeApi && req.user &&
            (next.title !== undefined || next.sections !== undefined || next.seoDescription !== undefined)) {
          next.editedByEditor = true
        }
        return next
      }) satisfies CollectionBeforeChangeHook,
    ],
  },
  labels: {
    plural: 'Trade articles',
    singular: 'Trade article',
  },
  typescript: {
    interface: 'HockeyTradeArticle',
  },
}
