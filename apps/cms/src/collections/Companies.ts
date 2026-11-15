import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { loggedIn } from '../access/loggedIn'
import { matchTokens, normalizeName, websiteDomain } from '../exhibitors/companyMatching'
import { notifyAwozApiAfterChange, notifyAwozApiAfterDelete } from '../hooks/notifyAwozApi'

/**
 * Companies that exhibit at trade shows, one record per company however many events it attends
 * (see Event exhibitors). awoz-api's exhibitor search adds them from the events' official exhibitor
 * lists (../endpoints/appExhibitorDiscovery.ts); the team can add and correct them by hand.
 *
 * Only what an exhibitor list shows is saved: an empty field means it wasn't there, never a guess.
 * A company found again fills in fields that are still empty and never changes one that's filled
 * in, so corrections made here stay. "Keep as entered" stops the search changing anything.
 *
 * The app shows companies through awoz-api (../endpoints/appCompanies.ts): never the review fields.
 */
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
    beforeChange: [
      (({ data, originalDoc }) => {
        // The keys a found exhibitor is matched by, kept in step with the names and the website
        const company = { ...originalDoc, ...data }
        const names = [company.name, company.localName, ...(company.aliases ?? [])]

        data.matchName = normalizeName(company.name)
        data.matchNames = [...new Set(names.map(normalizeName).filter(Boolean))]
        data.matchTokens = matchTokens(names)
        data.matchDomain = websiteDomain(company.website)
        return data
      }) satisfies CollectionBeforeChangeHook,
    ],
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
          name: 'industry',
          type: 'text',
          admin: {
            description: 'Business category, as listed, e.g. Diamonds, Pearls',
          },
          maxLength: 200,
        },
      ],
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
      name: 'website',
      type: 'text',
      maxLength: 500,
      validate: (value: null | string | undefined) =>
        !value || /^https?:\/\/\S+$/.test(value) || 'Enter a full URL, e.g. https://…',
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
    // Matching keys, filled in by the hook above (companyMatching.ts)
    { name: 'matchName', type: 'text', admin: { hidden: true }, index: true },
    { name: 'matchNames', type: 'text', admin: { hidden: true }, hasMany: true, index: true },
    { name: 'matchTokens', type: 'text', admin: { hidden: true }, hasMany: true, index: true },
    { name: 'matchDomain', type: 'text', admin: { hidden: true }, index: true },
  ],
  timestamps: true,
}
