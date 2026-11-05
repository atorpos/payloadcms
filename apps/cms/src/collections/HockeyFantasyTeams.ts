import type { CollectionConfig } from 'payload'

import { loggedIn } from '../access/loggedIn'

/**
 * The fantasy teams people follow in the HockeyPoolCap app (the NHL players they picked in their league), saved to
 * their account. Each belongs to the member of that account and shows on it (src/collections/HockeyMembers.ts).
 *
 * The app's backend, the HockeyPoolCap API, saves them through src/endpoints/hockeyFantasyTeams.ts and adds the
 * players' points from its stats. People without an account keep their teams on the phone instead, never here.
 * Private: every operation, including reading, requires a logged-in user.
 */
export const HockeyFantasyTeams: CollectionConfig = {
  slug: 'hockey-fantasy-teams',
  access: {
    // Teams come from the app, for a member
    create: () => false,
    delete: loggedIn,
    read: loggedIn,
    update: loggedIn,
  },
  admin: {
    defaultColumns: ['name', 'league', 'member', 'updatedAt'],
    description:
      'Fantasy teams people follow in the HockeyPoolCap app, saved to their account. What you change here shows in the app.',
    group: 'HockeyPoolCap App',
    listSearchableFields: ['name', 'league'],
    useAsTitle: 'name',
  },
  defaultSort: '-createdAt',
  labels: {
    plural: 'Fantasy Teams',
    singular: 'Fantasy Team',
  },
  typescript: {
    interface: 'HockeyFantasyTeam',
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'name',
          type: 'text',
          maxLength: 60,
          required: true,
        },
        {
          name: 'league',
          type: 'text',
          admin: {
            description: 'The fantasy league it plays in, e.g. Office pool',
          },
          maxLength: 60,
        },
      ],
    },
    {
      name: 'players',
      type: 'array',
      admin: {
        description:
          'In the order they were picked. Name, position and team are as they were then; the app shows them fresh, with their points.',
      },
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'fullName',
              type: 'text',
              maxLength: 100,
            },
            {
              name: 'position',
              type: 'text',
              admin: {
                description: 'C, LW, RW, D or G',
              },
              maxLength: 5,
            },
            {
              name: 'team',
              type: 'text',
              admin: {
                description: 'NHL team abbreviation, e.g. COL',
              },
              maxLength: 5,
            },
            {
              name: 'playerId',
              type: 'number',
              admin: {
                description: 'The player in the HockeyPoolCap API',
              },
              min: 1,
              required: true,
            },
          ],
        },
      ],
      labels: {
        plural: 'Players',
        singular: 'Player',
      },
      maxRows: 40,
    },
    {
      name: 'member',
      type: 'relationship',
      admin: {
        description: 'Whose team it is. Set by the app.',
        position: 'sidebar',
        readOnly: true,
      },
      index: true,
      relationTo: 'hockey-members',
      required: true,
    },
  ],
}
