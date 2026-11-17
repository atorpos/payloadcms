import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { loggedIn } from '../access/loggedIn'
import { editionOf, sameWebsite, seriesKeyOf } from '../exhibitors/eventWebsite'
import { locateEvent } from '../hooks/locateEvent'
import { localDay } from '../zonedTime'

/**
 * Sales events, exhibitions and trade shows around the world: when, where, and which clients were
 * involved. Internal only: every operation, including reading, requires a logged-in user.
 *
 * The coordinates of each event's place come from Apple Maps when it's saved (../hooks/locateEvent.ts).
 * awoz-api adds the gem, jewellery and raw material trade shows Claude finds on the web every week
 * (../endpoints/appEventDiscovery.ts), then reads their official exhibitor lists into Companies and
 * Event exhibitors (../endpoints/appExhibitorDiscovery.ts); "Exhibitor search" shows how that went.
 *
 * Each record is one edition of a show (its dates, its exhibitors); the editions of one show share
 * `seriesKey`, the name without its year. The search also checks the official website of the edition
 * ("Official website check", ../exhibitors/eventWebsite.ts): a website the team enters is theirs and
 * the search never changes it.
 */

/** Fills in the edition and the series key, and marks a website the team entered as theirs */
const editionAndWebsite: CollectionBeforeChangeHook = ({ context, data, originalDoc, req }) => {
  const event = { ...originalDoc, ...data }
  const timeZone = event.startDate_tz || 'UTC'

  if (!event.edition && event.startDate) {
    data.edition = editionOf(localDay(event.startDate, timeZone))
  }
  data.seriesKey = seriesKeyOf(event.name)

  const websiteChanged =
    'website' in data && (data.website || null) !== (originalDoc?.website || null)

  if (websiteChanged && req.user && !context.fromAwozApi) {
    const check = { ...originalDoc?.websiteCheck, ...data.websiteCheck }

    data.websiteCheck = data.website
      ? {
          ...check,
          checkedAt: new Date().toISOString(),
          note: null,
          sourceUrl: null,
          status: 'team',
          suggestedUrl: sameWebsite(check.suggestedUrl, data.website) ? null : check.suggestedUrl,
        }
      : { ...check, checkedAt: null, note: null, sourceUrl: null, status: null }
  }

  return data
}
export const Events: CollectionConfig = {
  slug: 'events',
  access: {
    create: loggedIn,
    delete: loggedIn,
    read: loggedIn,
    update: loggedIn,
  },
  admin: {
    defaultColumns: ['name', 'type', 'startDate', 'location.city', 'location.country', 'status'],
    group: 'Business',
    listSearchableFields: ['name', 'organizer', 'location.city', 'location.country'],
    useAsTitle: 'name',
  },
  // Most recent first
  defaultSort: '-startDate',
  hooks: {
    beforeChange: [locateEvent, editionAndWebsite],
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
        },
        {
          name: 'type',
          type: 'select',
          defaultValue: 'exhibition',
          options: [
            { label: 'Exhibition', value: 'exhibition' },
            { label: 'Trade show', value: 'tradeShow' },
            { label: 'Sales event', value: 'salesEvent' },
            { label: 'Conference', value: 'conference' },
            { label: 'Meeting', value: 'meeting' },
            { label: 'Other', value: 'other' },
          ],
          required: true,
        },
      ],
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'What the event is about, e.g. "B2B wholesale jewellery trade show"',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'startDate',
          type: 'date',
          admin: {
            date: {
              pickerAppearance: 'dayAndTime',
            },
          },
          required: true,
          // Stores the event's time zone next to the date (startDate_tz)
          timezone: true,
        },
        {
          name: 'endDate',
          type: 'date',
          admin: {
            date: {
              pickerAppearance: 'dayAndTime',
            },
            description: 'Leave empty for a single-day event',
          },
          timezone: true,
          validate: (value: Date | null | string | undefined, { siblingData }) => {
            const start = (siblingData as { startDate?: Date | string })?.startDate

            return !value || !start || new Date(value) >= new Date(start)
              ? true
              : 'The end date must be on or after the start date.'
          },
        },
      ],
    },
    {
      name: 'edition',
      type: 'text',
      admin: {
        description: 'Which edition, e.g. 2026 or 45th. The start year when left empty.',
      },
      maxLength: 60,
    },
    {
      name: 'location',
      type: 'group',
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'venue',
              type: 'text',
              admin: {
                description: 'e.g. Hong Kong Convention and Exhibition Centre',
              },
            },
            {
              name: 'booth',
              type: 'text',
              admin: {
                description: 'Hall / booth number',
              },
            },
          ],
        },
        {
          name: 'address',
          type: 'text',
        },
        {
          type: 'row',
          fields: [
            {
              name: 'city',
              type: 'text',
              required: true,
            },
            {
              name: 'country',
              type: 'text',
              required: true,
            },
          ],
        },
        {
          type: 'row',
          fields: [
            {
              name: 'coordinates',
              type: 'point',
              admin: {
                description:
                  'Filled in from Apple Maps when the venue, address, city or country changes. Correct them if the pin is in the wrong place; clear them to look the place up again.',
              },
            },
            {
              name: 'coordinatesSource',
              type: 'select',
              admin: {
                description: 'How precise the coordinates are',
                readOnly: true,
              },
              label: 'Coordinates of',
              options: [
                { label: 'The venue (Apple Maps)', value: 'venue' },
                { label: 'The street address (Apple Maps)', value: 'address' },
                { label: 'Only the city (Apple Maps)', value: 'city' },
                { label: 'Only the country (Apple Maps)', value: 'country' },
                { label: 'Set by hand', value: 'manual' },
              ],
            },
          ],
        },
        {
          name: 'coordinatesProblem',
          type: 'text',
          admin: {
            // Only while there is one
            condition: (_data, siblingData) => Boolean(siblingData?.coordinatesProblem),
            readOnly: true,
          },
          label: 'Why there are no coordinates',
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'organizer',
          type: 'text',
        },
        {
          name: 'website',
          type: 'text',
          admin: {
            description: "The edition's official website",
          },
          validate: (value: null | string | undefined) =>
            !value || /^https?:\/\/\S+$/.test(value) || 'Enter a full URL, e.g. https://…',
        },
      ],
    },
    {
      // ../exhibitors/eventWebsite.ts
      name: 'websiteCheck',
      type: 'group',
      admin: {
        description:
          "awoz-api checks that the website is this edition's: its page names the event and the year. A website you enter is kept as it is.",
      },
      label: 'Official website check',
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'status',
              type: 'select',
              admin: { readOnly: true },
              options: [
                { label: 'Verified (its page names this edition)', value: 'verified' },
                { label: 'Not verified', value: 'unverified' },
                { label: 'Entered by the team', value: 'team' },
              ],
            },
            {
              name: 'checkedAt',
              type: 'date',
              admin: { date: { pickerAppearance: 'dayAndTime' }, readOnly: true },
              label: 'Checked',
            },
          ],
        },
        {
          name: 'sourceUrl',
          type: 'text',
          admin: {
            condition: (_data, siblingData) => Boolean(siblingData?.sourceUrl),
            description: 'The page that showed it',
            readOnly: true,
          },
          label: 'Shown on',
        },
        {
          name: 'suggestedUrl',
          type: 'text',
          admin: {
            condition: (_data, siblingData) => Boolean(siblingData?.suggestedUrl),
            description:
              'Another website found for this edition. If it is the right one, copy it into Website.',
            readOnly: true,
          },
          label: 'Suggested website',
        },
        {
          name: 'note',
          type: 'textarea',
          admin: {
            condition: (_data, siblingData) => Boolean(siblingData?.note),
            readOnly: true,
          },
        },
      ],
    },
    {
      name: 'clients',
      type: 'relationship',
      admin: {
        description: 'Clients you met or worked with at this event',
      },
      hasMany: true,
      relationTo: 'clients',
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: {
        description: 'Results, leads, follow-ups',
      },
    },
    {
      name: 'status',
      type: 'select',
      admin: {
        position: 'sidebar',
      },
      defaultValue: 'planned',
      options: [
        { label: 'Planned', value: 'planned' },
        { label: 'Confirmed', value: 'confirmed' },
        { label: 'Completed', value: 'completed' },
        { label: 'Cancelled', value: 'cancelled' },
      ],
      required: true,
    },
    {
      name: 'foundBy',
      type: 'select',
      admin: {
        // Only on events awoz-api's weekly search added
        condition: (data) => Boolean(data?.foundBy),
        description:
          "Added by awoz-api's weekly web search; its sources are in the notes. Check the dates and the place.",
        position: 'sidebar',
        readOnly: true,
      },
      label: 'Found by',
      options: [{ label: 'Claude (weekly web search)', value: 'claude' }],
    },
    {
      name: 'attachments',
      type: 'upload',
      admin: {
        description: 'Brochures, floor plans, photos',
        position: 'sidebar',
      },
      hasMany: true,
      relationTo: 'media',
    },
    {
      name: 'exhibitors',
      type: 'join',
      admin: {
        defaultColumns: ['listedName', 'company', 'booth', 'hall', 'attendanceStatus'],
        description: 'Companies exhibiting, from the official exhibitor list (Event exhibitors)',
      },
      collection: 'event-exhibitors',
      defaultLimit: 50,
      defaultSort: 'listedName',
      on: 'event',
    },
    {
      // awoz-api's exhibitor search (../endpoints/appExhibitorDiscovery.ts): how it went for this event
      name: 'exhibitorSearch',
      type: 'group',
      admin: {
        description:
          "awoz-api reads the event's official exhibitor list and adds its companies under Exhibitors.",
      },
      label: 'Exhibitor search',
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'status',
              type: 'select',
              admin: { readOnly: true },
              options: [
                { label: 'Reading the list', value: 'running' },
                { label: 'Exhibitors found', value: 'found' },
                { label: 'No exhibitor list yet', value: 'noDirectory' },
                { label: "List can't be read (app, login or PDF)", value: 'unreadable' },
                { label: 'Failed: tried again later', value: 'failed' },
              ],
            },
            {
              name: 'skip',
              type: 'checkbox',
              admin: { description: 'e.g. an event without exhibitors' },
              label: "Don't search for exhibitors",
            },
          ],
        },
        {
          name: 'directoryUrl',
          type: 'text',
          admin: {
            description:
              'The official exhibitor list. Found by the search; enter it to have this list read instead.',
          },
          label: 'Exhibitor list',
          validate: (value: null | string | undefined) =>
            !value || /^https?:\/\/\S+$/.test(value) || 'Enter a full URL, e.g. https://…',
        },
        {
          type: 'row',
          fields: [
            {
              name: 'lastRunAt',
              type: 'date',
              admin: { date: { pickerAppearance: 'dayAndTime' }, readOnly: true },
              label: 'Last searched',
            },
            {
              name: 'found',
              type: 'number',
              admin: { readOnly: true },
              label: 'Exhibitors found',
            },
            {
              name: 'saved',
              type: 'number',
              admin: { readOnly: true },
              label: 'Saved',
            },
            {
              name: 'pagesRead',
              type: 'number',
              admin: { readOnly: true },
              label: 'Pages read',
            },
            {
              name: 'complete',
              type: 'checkbox',
              admin: { readOnly: true },
              label: 'Read to its end',
            },
          ],
        },
        {
          name: 'problems',
          type: 'textarea',
          admin: {
            condition: (_data, siblingData) => Boolean(siblingData?.problems),
            readOnly: true,
          },
        },
        // Where to go on when the last run stopped early, its attempts, and which run holds it now
        { name: 'resumeUrl', type: 'text', admin: { hidden: true } },
        // Other pages of the same list still to read (letters, categories), in order
        { name: 'pendingPages', type: 'text', admin: { hidden: true }, hasMany: true },
        // The pages of the list read since it was last read from its start, so a run going on doesn't read them again
        { name: 'readPages', type: 'text', admin: { hidden: true }, hasMany: true },
        { name: 'attempts', type: 'number', admin: { hidden: true } },
        { name: 'claimedUntil', type: 'date', admin: { hidden: true } },
      ],
    },
    // The editions of one show share it: the name without years (../exhibitors/eventWebsite.ts)
    { name: 'seriesKey', type: 'text', admin: { hidden: true }, index: true },
  ],
}
