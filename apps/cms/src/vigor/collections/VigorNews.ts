import type { CollectionConfig } from 'payload'

import { text, textarea } from 'payload/shared'

import { publishedOrLoggedIn } from '../../access/publishedOrLoggedIn'
import { bodyField, dayField, imageField, requiredInEnglish, slugField } from '../fields'
import { newsCategories } from '../options'
import { revalidateVigorAfterChange, revalidateVigorAfterDelete } from '../revalidate'

/**
 * The Vigor website's newsroom: /news and an article page at /news/<slug>. Market articles (category Market) are
 * also shown in the VgemsAI app's Research tab; awoz-api's market news agent drafts one a week
 * (../../endpoints/appMarketNews.ts), with the price chart, the sources and online deals below, for the team to check
 * and publish.
 */
export const VigorNews: CollectionConfig = {
  slug: 'vigor-news',
  access: {
    read: publishedOrLoggedIn,
  },
  admin: {
    defaultColumns: ['title', 'date', 'category', '_status'],
    group: 'Vigor website',
    listSearchableFields: ['title', 'slug'],
    useAsTitle: 'title',
  },
  // Latest first
  defaultSort: '-date',
  fields: [
    {
      name: 'title',
      type: 'text',
      localized: true,
      required: true,
      validate: requiredInEnglish(text),
    },
    {
      name: 'summary',
      type: 'textarea',
      localized: true,
      required: true,
      validate: requiredInEnglish(textarea),
    },
    bodyField,
    imageField(),
    {
      type: 'row',
      fields: [
        {
          name: 'imageCredit',
          type: 'text',
          admin: {
            description:
              'Who made the picture and its licence, shown under it, e.g. "Photo: J. Smith, CC BY 4.0"',
          },
          label: 'Picture credit',
        },
        {
          name: 'imageCreditUrl',
          type: 'text',
          admin: { description: 'The picture’s page with its licence, e.g. on Wikimedia Commons' },
          label: 'Credit link',
          validate: (value: null | string | undefined) =>
            !value || /^https?:\/\/\S+$/.test(value) || 'Enter a full URL, e.g. https://…',
        },
      ],
    },
    slugField({ from: 'title' }),
    dayField({ sidebar: true }),
    {
      name: 'category',
      type: 'select',
      admin: {
        position: 'sidebar',
      },
      options: newsCategories,
      required: true,
    },
    {
      // A Market article's price trend: the chart is the weekly prices when it was written, so it stays as it was
      name: 'market',
      type: 'group',
      admin: {
        condition: (data) => data?.category === 'Market',
        description: 'The price trend this article is about, as the price chart under it shows it.',
      },
      label: 'Market',
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'material', type: 'relationship', relationTo: 'market-materials' },
            {
              // Kept with the article: the website can't read the private market materials
              name: 'materialName',
              type: 'text',
              admin: { description: 'As the article names it, e.g. Gold' },
              label: 'Material name',
            },
            {
              name: 'week',
              type: 'text',
              admin: {
                description:
                  'The week it covers, e.g. 2026-W47: the agent writes one article a week',
                readOnly: true,
              },
              index: true,
            },
          ],
        },
        {
          type: 'row',
          fields: [
            { name: 'periodStart', type: 'date', label: 'From' },
            { name: 'periodEnd', type: 'date', label: 'To' },
            { name: 'unit', type: 'text', admin: { description: 'e.g. USD/oz' } },
          ],
        },
        {
          type: 'row',
          fields: [
            { name: 'startPrice', type: 'number', label: 'Price at the start' },
            { name: 'endPrice', type: 'number', label: 'Price at the end' },
            { name: 'changePercent', type: 'number', label: 'Change (%)' },
          ],
        },
        {
          name: 'chart',
          type: 'json',
          admin: {
            description:
              'The weekly prices the chart shows: [{ "date": "2026-11-13", "price": 2650.5 }, …]',
          },
          label: 'Chart prices',
        },
      ],
    },
    {
      name: 'sources',
      type: 'array',
      admin: {
        condition: (data) => data?.category === 'Market',
        description: 'The news pages the article draws on, listed under it',
      },
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'title', type: 'text', required: true },
            { name: 'publisher', type: 'text' },
            {
              name: 'publishedAt',
              type: 'text',
              admin: { description: 'e.g. 2026-11-14' },
              label: 'Date',
            },
          ],
        },
        {
          name: 'url',
          type: 'text',
          required: true,
          validate: (value: null | string | undefined) =>
            !value || /^https?:\/\/\S+$/.test(value) || 'Enter a full URL, e.g. https://…',
        },
      ],
    },
    {
      name: 'deals',
      type: 'array',
      admin: {
        condition: (data) => data?.category === 'Market',
        description:
          'Products of this material offered online, each with its price as the store showed it on the day it was seen',
      },
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'product', type: 'text', required: true },
            { name: 'store', type: 'text', required: true },
          ],
        },
        {
          type: 'row',
          fields: [
            { name: 'price', type: 'number', required: true },
            { name: 'currency', type: 'text', admin: { description: 'e.g. USD' }, required: true },
            {
              name: 'seenAt',
              type: 'date',
              admin: { date: { pickerAppearance: 'dayOnly' } },
              label: 'Seen on',
              required: true,
            },
          ],
        },
        {
          name: 'url',
          type: 'text',
          required: true,
          validate: (value: null | string | undefined) =>
            !value || /^https?:\/\/\S+$/.test(value) || 'Enter a full URL, e.g. https://…',
        },
      ],
    },
    {
      name: 'foundBy',
      type: 'select',
      admin: {
        condition: (data) => Boolean(data?.foundBy),
        description:
          "Drafted by awoz-api's market news agent: check the text, sources, deals and picture before publishing.",
        position: 'sidebar',
        readOnly: true,
      },
      label: 'Written by',
      options: [{ label: 'Claude (market news agent)', value: 'claude' }],
    },
  ],
  hooks: {
    afterChange: [revalidateVigorAfterChange],
    afterDelete: [revalidateVigorAfterDelete],
  },
  labels: {
    plural: 'News',
    singular: 'News article',
  },
  typescript: {
    interface: 'VigorNewsArticle',
  },
  versions: {
    drafts: true,
  },
}
