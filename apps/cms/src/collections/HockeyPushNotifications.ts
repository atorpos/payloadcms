import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { ValidationError } from 'payload'

import { loggedIn } from '../access/loggedIn'

/** The NHL's teams, for "fans of these teams": the phones with one of them as a favorite team in the app */
export const nhlTeamOptions = [
  { label: 'Anaheim Ducks', value: 'ANA' },
  { label: 'Boston Bruins', value: 'BOS' },
  { label: 'Buffalo Sabres', value: 'BUF' },
  { label: 'Calgary Flames', value: 'CGY' },
  { label: 'Carolina Hurricanes', value: 'CAR' },
  { label: 'Chicago Blackhawks', value: 'CHI' },
  { label: 'Colorado Avalanche', value: 'COL' },
  { label: 'Columbus Blue Jackets', value: 'CBJ' },
  { label: 'Dallas Stars', value: 'DAL' },
  { label: 'Detroit Red Wings', value: 'DET' },
  { label: 'Edmonton Oilers', value: 'EDM' },
  { label: 'Florida Panthers', value: 'FLA' },
  { label: 'Los Angeles Kings', value: 'LAK' },
  { label: 'Minnesota Wild', value: 'MIN' },
  { label: 'Montréal Canadiens', value: 'MTL' },
  { label: 'Nashville Predators', value: 'NSH' },
  { label: 'New Jersey Devils', value: 'NJD' },
  { label: 'New York Islanders', value: 'NYI' },
  { label: 'New York Rangers', value: 'NYR' },
  { label: 'Ottawa Senators', value: 'OTT' },
  { label: 'Philadelphia Flyers', value: 'PHI' },
  { label: 'Pittsburgh Penguins', value: 'PIT' },
  { label: 'San Jose Sharks', value: 'SJS' },
  { label: 'Seattle Kraken', value: 'SEA' },
  { label: 'St. Louis Blues', value: 'STL' },
  { label: 'Tampa Bay Lightning', value: 'TBL' },
  { label: 'Toronto Maple Leafs', value: 'TOR' },
  { label: 'Utah Mammoth', value: 'UTA' },
  { label: 'Vancouver Canucks', value: 'VAN' },
  { label: 'Vegas Golden Knights', value: 'VGK' },
  { label: 'Washington Capitals', value: 'WSH' },
  { label: 'Winnipeg Jets', value: 'WPG' },
]

/**
 * Push notifications to the HockeyPoolCap app (iOS), like the VgemsAI app's (src/collections/PushNotifications.ts).
 * The team writes one here and chooses when it goes out; the HockeyPoolCap API checks every minute for the ones due
 * (src/endpoints/hockeyPushNotifications.ts), sends them through Firebase to the phones it keeps in PostgreSQL, and
 * writes back how many arrived. Deleting one that hasn't gone out yet cancels it.
 *
 * The daily game recaps (favorite teams' results, favorite players, the fantasy team) go out from the API by
 * themselves: they're not written here.
 */
export const HockeyPushNotifications: CollectionConfig = {
  slug: 'hockey-push-notifications',
  access: {
    create: loggedIn,
    delete: loggedIn,
    read: loggedIn,
    update: loggedIn,
  },
  admin: {
    defaultColumns: ['title', 'audience', 'status', 'sendAt', 'results.delivered'],
    description:
      'Notifications on the phones of HockeyPoolCap app users with notifications on. Choose "Now" or a time under Send, and save: it goes out within a minute of that time. The daily game recaps go out by themselves.',
    group: 'HockeyPoolCap App',
    useAsTitle: 'title',
  },
  defaultSort: '-createdAt',
  fields: [
    {
      name: 'title',
      type: 'text',
      admin: {
        description: 'In bold on the notification, e.g. "Trade deadline tonight"',
      },
      maxLength: 100,
      required: true,
    },
    {
      name: 'body',
      type: 'textarea',
      label: 'Message',
      maxLength: 500,
      required: true,
    },
    {
      name: 'screen',
      type: 'select',
      admin: {
        description: 'The tab the app opens when the notification is tapped',
      },
      defaultValue: 'home',
      label: 'Opens',
      options: [
        { label: 'Home', value: 'home' },
        { label: 'Teams', value: 'teams' },
        { label: 'Players', value: 'players' },
        { label: 'Fantasy', value: 'fantasy' },
        { label: 'Settings', value: 'settings' },
      ],
      required: true,
    },
    {
      name: 'audience',
      type: 'radio',
      defaultValue: 'everyone',
      label: 'To',
      options: [
        { label: 'Everyone with notifications on', value: 'everyone' },
        { label: 'Fans of chosen teams', value: 'teamFans' },
        { label: 'Chosen members', value: 'members' },
      ],
      required: true,
    },
    {
      name: 'teams',
      type: 'select',
      admin: {
        condition: (_data, siblingData) => siblingData?.audience === 'teamFans',
        description: 'The phones with one of these as a favorite team in the app',
      },
      hasMany: true,
      options: nhlTeamOptions,
      validate: (value: unknown, { siblingData }: { siblingData: Record<string, unknown> }) =>
        siblingData?.audience !== 'teamFans' ||
        (Array.isArray(value) && value.length > 0) ||
        'Choose at least one team.',
    },
    {
      name: 'members',
      type: 'relationship',
      admin: {
        condition: (_data, siblingData) => siblingData?.audience === 'members',
        description:
          'Members get it on the phones they are signed in on in the app, with notifications on.',
      },
      hasMany: true,
      relationTo: 'hockey-members',
      validate: (value: unknown, { siblingData }: { siblingData: Record<string, unknown> }) =>
        siblingData?.audience !== 'members' ||
        (Array.isArray(value) && value.length > 0) ||
        'Choose at least one member.',
    },
    {
      name: 'delivery',
      type: 'radio',
      defaultValue: 'draft',
      hooks: {
        // A copy of a sent notification waits until someone chooses to send it
        beforeDuplicate: [() => 'draft'],
      },
      label: 'Send',
      options: [
        { label: 'Not yet (draft)', value: 'draft' },
        { label: 'Now', value: 'now' },
        { label: 'At a set time', value: 'scheduled' },
      ],
      required: true,
    },
    {
      name: 'sendAt',
      type: 'date',
      admin: {
        condition: (_data, siblingData) => siblingData?.delivery === 'scheduled',
        date: { pickerAppearance: 'dayAndTime' },
      },
      label: 'Send at',
      // Stores the time zone it was picked in next to it (sendAt_tz)
      timezone: true,
      validate: (value: unknown, { siblingData }: { siblingData: Record<string, unknown> }) =>
        siblingData?.delivery !== 'scheduled' || Boolean(value) || 'Choose when to send it.',
    },
    {
      name: 'status',
      type: 'select',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Waiting to send', value: 'queued' },
        { label: 'Sending', value: 'sending' },
        { label: 'Sent', value: 'sent' },
        { label: 'Failed', value: 'failed' },
      ],
      required: true,
    },
    {
      name: 'sentAt',
      type: 'date',
      admin: {
        condition: (data) => Boolean(data?.sentAt),
        date: { pickerAppearance: 'dayAndTime' },
        position: 'sidebar',
        readOnly: true,
      },
      label: 'Sent at',
    },
    {
      name: 'results',
      type: 'group',
      admin: {
        condition: (data) => data?.status === 'sent' || data?.status === 'failed',
        position: 'sidebar',
      },
      fields: [
        {
          name: 'devices',
          type: 'number',
          admin: { description: 'Phones it was sent to', readOnly: true },
        },
        {
          name: 'delivered',
          type: 'number',
          admin: { description: 'Accepted by Firebase', readOnly: true },
        },
        {
          name: 'failed',
          type: 'number',
          admin: { description: 'Not accepted, e.g. Firebase was busy', readOnly: true },
        },
        {
          name: 'removed',
          type: 'number',
          admin: {
            description: 'Phones that no longer have the app or notifications: never sent to again',
            readOnly: true,
          },
        },
      ],
    },
    {
      name: 'problem',
      type: 'text',
      admin: {
        condition: (data) => Boolean(data?.problem),
        position: 'sidebar',
        readOnly: true,
      },
      label: 'Why it failed',
    },
  ],
  hooks: {
    beforeChange: [
      (({ context, data, operation, originalDoc, req }) => {
        // The HockeyPoolCap API's progress (src/endpoints/hockeyPushNotifications.ts)
        if (context.pushProgress) {
          return data
        }

        // A copy (Duplicate) gets the original as originalDoc too, but is a new notification
        const status =
          operation === 'update' ? (originalDoc as { status?: string } | undefined)?.status : null

        if (status === 'sending' || status === 'sent') {
          throw new ValidationError({
            collection: 'hockey-push-notifications',
            errors: [
              {
                message:
                  'This notification has gone out and can no longer be changed. Duplicate it to send it again.',
                path: 'delivery',
              },
            ],
            req,
          })
        }

        const delivery = data.delivery ?? (operation === 'update' ? originalDoc?.delivery : null)

        // Results of an earlier try (a failed one, or the original of a copy) go
        const fresh = {
          ...data,
          problem: null,
          results: { delivered: null, devices: null, failed: null, removed: null },
          sentAt: null,
        }

        if (delivery !== 'now' && delivery !== 'scheduled') {
          return { ...fresh, status: 'draft' }
        }

        return {
          ...fresh,
          sendAt: delivery === 'now' ? new Date().toISOString() : data.sendAt,
          status: 'queued',
        }
      }) satisfies CollectionBeforeChangeHook,
    ],
  },
  labels: {
    plural: 'Push notifications',
    singular: 'Push notification',
  },
  typescript: {
    interface: 'HockeyPushNotification',
  },
}
