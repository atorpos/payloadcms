import type { CollectionConfig } from 'payload'

import { loggedIn } from '../access/loggedIn'

/**
 * The people with an account in the HockeyPoolCap app (iOS and Android), and the details the app shows on their
 * profile screen. The app's backend, the HockeyPoolCap API, adds each account here after signup and saves what
 * people change in the app, through src/endpoints/hockeyMembers.ts. It reads the details back from here every
 * time the profile screen opens, so a change made here shows in the app.
 *
 * The login itself (email and password) stays in the HockeyPoolCap API: name and email are copies, changed only
 * in the app. Their fantasy league is in src/collections/HockeyFantasyLeagues.ts (and their teams from before leagues
 * in src/collections/HockeyFantasyTeams.ts); both are deleted with them.
 * Private: every operation, including reading, requires a logged-in user.
 */
export const HockeyMembers: CollectionConfig = {
  slug: 'hockey-members',
  access: {
    // Members come from the app: the API adds one for each account
    create: () => false,
    delete: loggedIn,
    read: loggedIn,
    update: loggedIn,
  },
  admin: {
    defaultColumns: ['name', 'displayName', 'favoriteTeam', 'location.country', 'createdAt'],
    description:
      'Everyone with an account in the HockeyPoolCap app. What you change here shows on their profile in the app. Deleting a member deletes their fantasy league and teams too.',
    group: 'HockeyPoolCap App',
    listSearchableFields: ['name', 'email', 'displayName'],
    useAsTitle: 'name',
  },
  defaultSort: '-createdAt',
  hooks: {
    // Their fantasy league and teams mean nothing without them: deleted with them, from the app or here
    afterDelete: [
      async ({ doc, req }) => {
        for (const collection of ['hockey-fantasy-leagues', 'hockey-fantasy-teams'] as const) {
          await req.payload.db.deleteMany({
            collection,
            req,
            where: { member: { equals: doc.id } },
          })
        }
      },
    ],
  },
  labels: {
    plural: 'Members',
    singular: 'Member',
  },
  typescript: {
    interface: 'HockeyMember',
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'name',
          type: 'text',
          admin: {
            description: 'From their app account; they change it in the app',
            readOnly: true,
          },
          required: true,
        },
        {
          name: 'email',
          type: 'email',
          admin: {
            description: 'Their login; it never changes',
            readOnly: true,
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'displayName',
          type: 'text',
          admin: {
            description: 'Nickname shown to other pool members',
          },
          maxLength: 40,
        },
        {
          name: 'favoriteTeam',
          type: 'text',
          admin: {
            description: 'NHL team abbreviation, e.g. TOR',
          },
          hooks: {
            beforeValidate: [
              ({ value }) =>
                typeof value === 'string' ? value.trim().toUpperCase() || null : value,
            ],
          },
          validate: (value: null | string | undefined) =>
            !value || /^[A-Z]{2,5}$/.test(value) || 'Enter a team abbreviation, e.g. TOR',
        },
        {
          name: 'phone',
          type: 'text',
          admin: {
            description: 'With country code, e.g. +1 416 555 0123',
          },
          maxLength: 30,
        },
      ],
    },
    {
      name: 'location',
      type: 'group',
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'city',
              type: 'text',
              maxLength: 100,
            },
            {
              name: 'state',
              type: 'text',
              label: 'State / Province',
              maxLength: 100,
            },
            {
              name: 'country',
              type: 'text',
              maxLength: 100,
            },
          ],
        },
      ],
    },
    {
      name: 'notes',
      type: 'textarea',
      admin: {
        description: 'For the team only: never sent to the app',
      },
    },
    {
      name: 'fantasyLeague',
      type: 'join',
      admin: {
        defaultColumns: ['name', 'updatedAt'],
        description:
          'The fantasy league they set up in the app, with their team and the teams they play against.',
      },
      collection: 'hockey-fantasy-leagues',
      defaultSort: '-createdAt',
      label: 'Fantasy League',
      on: 'member',
    },
    {
      name: 'fantasyTeams',
      type: 'join',
      admin: {
        defaultColumns: ['name', 'league', 'updatedAt'],
        description: 'Their fantasy teams from before the app had leagues.',
      },
      collection: 'hockey-fantasy-teams',
      defaultSort: '-createdAt',
      label: 'Fantasy Teams',
      on: 'member',
    },
    {
      name: 'appUserId',
      type: 'number',
      admin: {
        description: 'The ID of their account in the HockeyPoolCap API. Set by the app.',
        position: 'sidebar',
        readOnly: true,
      },
      label: 'HockeyPoolCap Account',
      required: true,
      unique: true,
    },
  ],
}
