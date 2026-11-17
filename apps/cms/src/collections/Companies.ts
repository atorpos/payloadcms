import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { loggedIn } from '../access/loggedIn'
import {
  categories,
  changedFields,
  ENRICHABLE_FIELDS,
  type FieldSource,
  matchTokens,
  normalizeName,
  websiteDomain,
  withSources,
} from '../exhibitors/companyMatching'
import { notifyAwozApiAfterChange, notifyAwozApiAfterDelete } from '../hooks/notifyAwozApi'

/**
 * Companies that exhibit at trade shows, one record per company however many events it attends
 * (see Event exhibitors). awoz-api's exhibitor search adds them from the events' official exhibitor
 * lists (../endpoints/appExhibitorDiscovery.ts); the team can add and correct them by hand.
 *
 * Only what an exhibitor list, its profile pages or the company's own website (linked from the list)
 * shows is saved, each value with where it's from (Sources): an empty field means it wasn't there,
 * never a guess. A company found again fills in fields that are still empty and never changes one
 * that's filled in; a field the team edits, also one they empty, is never touched again
 * (`curatedFields`). "Keep as entered" stops the search changing anything.
 *
 * What the search found elsewhere (a website found by a web search, and what that website shows) is
 * only a suggestion: it stays under Suggestions, is never shown in the app or used to match, until
 * the team ticks "Use the suggestions".
 *
 * The app shows companies through awoz-api (../endpoints/appCompanies.ts): never the review fields,
 * sources or suggestions.
 */

/** The fields a suggestion can fill in */
const SUGGESTED_FIELDS = ['website', 'email', 'phone', 'address', 'city'] as const

/** Matching keys, categories as a list, the team's edits, and accepted suggestions */
const prepareCompany: CollectionBeforeChangeHook = ({
  context,
  data,
  operation,
  originalDoc,
  req,
}) => {
  const byTeam = Boolean(req.user) && !context.fromAwozApi

  if ('industry' in data) {
    data.industry = categories(data.industry)
  }

  if (byTeam) {
    const now = new Date().toISOString()
    const edited =
      operation === 'create'
        ? ENRICHABLE_FIELDS.filter((field) => categories(data[field]).length > 0)
        : changedFields(originalDoc, data)
    let sources: FieldSource[] = data.fieldSources ?? originalDoc?.fieldSources ?? []
    const curated = new Set<string>([...(originalDoc?.curatedFields ?? []), ...edited])

    if (edited.length) {
      sources = withSources(sources, edited, {
        confidence: 'high',
        seenAt: now,
        sourceKind: 'team',
      })
    }

    // "Use the suggestions": each fills its field when it's still empty, as checked by the team
    const suggestions = { ...originalDoc?.suggestions, ...data.suggestions }

    if (suggestions.accept) {
      const accepted = SUGGESTED_FIELDS.filter(
        (field) => suggestions[field] && !String(data[field] ?? originalDoc?.[field] ?? '').trim(),
      )

      for (const field of accepted) {
        data[field] = suggestions[field]
        curated.add(field)
      }
      if (accepted.length) {
        sources = withSources(sources, accepted, {
          confidence: 'high',
          seenAt: now,
          sourceKind: 'webSearch',
          sourceUrl: suggestions.sourceUrl ?? null,
        })
      }
      data.suggestions = {}
    }

    data.fieldSources = sources
    data.curatedFields = [...curated]
  }

  // The keys a found exhibitor is matched by, kept in step with the names and the website
  const company = { ...originalDoc, ...data }
  const names = [company.name, company.localName, company.legalName, ...(company.aliases ?? [])]

  data.matchName = normalizeName(company.name)
  data.matchNames = [...new Set(names.map(normalizeName).filter(Boolean))]
  data.matchTokens = matchTokens(names)
  data.matchDomain = websiteDomain(company.website)
  return data
}

const url = (value: null | string | undefined) =>
  !value || /^https?:\/\/\S+$/.test(value) || 'Enter a full URL, e.g. https://…'
export const Companies: CollectionConfig = {
  slug: 'companies',
  access: {
    create: loggedIn,
    delete: loggedIn,
    read: loggedIn,
    update: loggedIn,
  },
  admin: {
    defaultColumns: ['name', 'country', 'website', 'reviewStatus', 'lastVerifiedAt'],
    description:
      'Exhibitors of trade shows, found on their official exhibitor lists. Empty fields were not on the list.',
    group: 'Business',
    listSearchableFields: ['name', 'localName', 'country', 'website'],
    useAsTitle: 'name',
  },
  defaultSort: 'name',
  hooks: {
    afterChange: [notifyAwozApiAfterChange],
    afterDelete: [notifyAwozApiAfterDelete],
    beforeChange: [prepareCompany],
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'name',
          type: 'text',
          maxLength: 300,
          required: true,
        },
        {
          name: 'localName',
          type: 'text',
          admin: {
            description: 'The name in Chinese or another language, as listed',
          },
          label: 'Other name',
          maxLength: 300,
        },
      ],
    },
    {
      name: 'legalName',
      type: 'text',
      admin: {
        description: 'The registered name with its legal form, when shown and different from Name',
      },
      label: 'Legal name',
      maxLength: 300,
    },
    {
      name: 'aliases',
      type: 'text',
      admin: {
        description:
          'Other names it is listed under. A company found under one of these names is this one.',
      },
      hasMany: true,
      maxLength: 300,
    },
    {
      type: 'row',
      fields: [
        {
          name: 'country',
          type: 'text',
          admin: {
            description: 'In English, e.g. Hong Kong',
          },
          maxLength: 100,
        },
        {
          name: 'city',
          type: 'text',
          maxLength: 100,
        },
      ],
    },
    {
      name: 'industry',
      type: 'text',
      admin: {
        description: 'Business categories, as listed, e.g. Diamonds, Pearls',
      },
      hasMany: true,
      label: 'Categories',
      maxLength: 200,
      maxRows: 10,
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'What the company does, as the list or its website describes it',
      },
      maxLength: 2000,
    },
    {
      name: 'address',
      type: 'textarea',
      maxLength: 500,
    },
    {
      type: 'row',
      fields: [
        {
          name: 'phone',
          type: 'text',
          label: 'Telephone',
          maxLength: 60,
        },
        {
          name: 'email',
          type: 'text',
          label: 'Contact email',
          maxLength: 200,
          validate: (value: null | string | undefined) =>
            !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || 'Enter an email address.',
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'website',
          type: 'text',
          maxLength: 500,
          validate: url,
        },
        {
          name: 'contactPageUrl',
          type: 'text',
          label: 'Contact page',
          maxLength: 1000,
          validate: url,
        },
      ],
    },
    {
      type: 'collapsible',
      admin: { initCollapsed: true },
      label: 'Social media',
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'linkedinUrl', type: 'text', label: 'LinkedIn', maxLength: 500, validate: url },
            {
              name: 'instagramUrl',
              type: 'text',
              label: 'Instagram',
              maxLength: 500,
              validate: url,
            },
            { name: 'facebookUrl', type: 'text', label: 'Facebook', maxLength: 500, validate: url },
          ],
        },
        {
          name: 'otherLinks',
          type: 'text',
          admin: { description: 'Other official pages, e.g. WeChat, YouTube, X' },
          hasMany: true,
          label: 'Other',
          maxLength: 500,
          maxRows: 10,
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'sourceUrl',
          type: 'text',
          admin: {
            description: 'The page these details are from',
          },
          label: 'Source',
          maxLength: 1000,
        },
        {
          name: 'lastVerifiedAt',
          type: 'date',
          admin: {
            date: { pickerAppearance: 'dayAndTime' },
            description: 'When it was last seen on an exhibitor list',
          },
          label: 'Last verified',
        },
      ],
    },
    {
      name: 'fieldSources',
      type: 'array',
      admin: {
        description:
          'Where each value is from: the exhibitor list, its profile page, the company’s website, a web search (checked by the team) or the team',
        initCollapsed: true,
        readOnly: true,
      },
      label: 'Sources',
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'field', type: 'text', required: true },
            {
              name: 'sourceKind',
              type: 'select',
              label: 'From',
              options: [
                { label: 'Exhibitor list', value: 'exhibitorList' },
                { label: 'Profile on the exhibitor list', value: 'exhibitorProfile' },
                { label: 'Company website', value: 'companyWebsite' },
                { label: 'Web search, checked by the team', value: 'webSearch' },
                { label: 'The team', value: 'team' },
              ],
              required: true,
            },
            {
              name: 'confidence',
              type: 'select',
              options: [
                { label: 'High', value: 'high' },
                { label: 'Medium', value: 'medium' },
              ],
            },
          ],
        },
        {
          type: 'row',
          fields: [
            { name: 'sourceUrl', type: 'text', label: 'Page', maxLength: 1000 },
            { name: 'seenAt', type: 'date', admin: { date: { pickerAppearance: 'dayAndTime' } } },
          ],
        },
      ],
      maxRows: 40,
    },
    {
      name: 'suggestions',
      type: 'group',
      admin: {
        condition: (data) =>
          Boolean(
            data?.suggestions &&
            ['website', 'email', 'phone', 'address', 'city'].some(
              (field) => data.suggestions[field],
            ),
          ),
        description:
          'Found by a web search, not on the exhibitor list: check them, then tick "Use the suggestions" to fill in the empty fields with them. Never shown in the app until then.',
      },
      label: 'Suggestions',
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'website', type: 'text', admin: { readOnly: true }, maxLength: 500 },
            { name: 'email', type: 'text', admin: { readOnly: true }, maxLength: 200 },
            { name: 'phone', type: 'text', admin: { readOnly: true }, maxLength: 60 },
          ],
        },
        {
          type: 'row',
          fields: [
            { name: 'address', type: 'text', admin: { readOnly: true }, maxLength: 500 },
            { name: 'city', type: 'text', admin: { readOnly: true }, maxLength: 100 },
          ],
        },
        {
          type: 'row',
          fields: [
            {
              name: 'sourceUrl',
              type: 'text',
              admin: { readOnly: true },
              label: 'Found on',
              maxLength: 1000,
            },
            {
              name: 'foundAt',
              type: 'date',
              admin: { date: { pickerAppearance: 'dayAndTime' }, readOnly: true },
              label: 'Found',
            },
          ],
        },
        { name: 'note', type: 'textarea', admin: { readOnly: true }, maxLength: 1000 },
        { name: 'accept', type: 'checkbox', label: 'Use the suggestions' },
      ],
    },
    {
      name: 'events',
      type: 'join',
      admin: {
        defaultColumns: ['event', 'booth', 'hall', 'attendanceStatus'],
        description: 'The events it exhibits at',
      },
      collection: 'event-exhibitors',
      defaultLimit: 50,
      on: 'company',
    },
    {
      name: 'reviewStatus',
      type: 'select',
      admin: {
        description:
          "Possible duplicate: found under a name like another company's, or the same name in another country. Merge them by hand if they are the same, then mark it Checked.",
        position: 'sidebar',
      },
      defaultValue: 'ok',
      label: 'Review',
      options: [
        { label: 'OK', value: 'ok' },
        { label: 'Possible duplicate', value: 'possibleDuplicate' },
        { label: 'Checked', value: 'checked' },
      ],
    },
    {
      name: 'possibleDuplicates',
      type: 'relationship',
      admin: {
        condition: (data) => Boolean(data?.possibleDuplicates?.length),
        position: 'sidebar',
      },
      hasMany: true,
      label: 'May be the same as',
      relationTo: 'companies',
    },
    {
      name: 'locked',
      type: 'checkbox',
      admin: {
        description: 'The exhibitor search never changes this company',
        position: 'sidebar',
      },
      label: 'Keep as entered',
    },
    {
      name: 'foundBy',
      type: 'select',
      admin: {
        condition: (data) => Boolean(data?.foundBy),
        description: "Added by awoz-api's exhibitor search, from the event's exhibitor list",
        position: 'sidebar',
        readOnly: true,
      },
      label: 'Found by',
      options: [{ label: 'Claude (exhibitor search)', value: 'claude' }],
    },
    {
      // awoz-api's company website reading (../endpoints/appExhibitorDiscovery.ts)
      name: 'enrichment',
      type: 'group',
      admin: {
        condition: (data) => Boolean(data?.enrichment?.lastTriedAt),
        position: 'sidebar',
      },
      label: 'Company website reading',
      fields: [
        {
          name: 'status',
          type: 'select',
          admin: { readOnly: true },
          options: [
            { label: 'Details added', value: 'done' },
            { label: 'Nothing new', value: 'nothingNew' },
            { label: 'No website', value: 'noWebsite' },
            { label: 'Failed: tried again later', value: 'failed' },
          ],
        },
        {
          name: 'lastTriedAt',
          type: 'date',
          admin: { date: { pickerAppearance: 'dayAndTime' }, readOnly: true },
          label: 'Last read',
        },
        { name: 'attempts', type: 'number', admin: { hidden: true } },
      ],
    },
    // The fields the team edited: the search never changes them (companyMatching.ts)
    { name: 'curatedFields', type: 'text', admin: { hidden: true }, hasMany: true },
    // Matching keys, filled in by the hook above (companyMatching.ts)
    { name: 'matchName', type: 'text', admin: { hidden: true }, index: true },
    { name: 'matchNames', type: 'text', admin: { hidden: true }, hasMany: true, index: true },
    { name: 'matchTokens', type: 'text', admin: { hidden: true }, hasMany: true, index: true },
    { name: 'matchDomain', type: 'text', admin: { hidden: true }, index: true },
  ],
  timestamps: true,
}
