import type { CollectionConfig } from 'payload'

import { loggedIn } from '../access/loggedIn'
import { fantasyPlayersField } from './HockeyFantasyLeagues'

/**
 * The fantasy teams people followed in the HockeyPoolCap app before it had leagues (the NHL players they picked in
 * their league), saved to their account. Each belongs to the member of that account and shows on it
 * (src/collections/HockeyMembers.ts). The app now keeps one league per account, with its teams in it
 * (src/collections/HockeyFantasyLeagues.ts), and offers to move these into it; older versions of the app still use them.
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
      "Fantasy teams from before the HockeyPoolCap app had leagues, saved to people's accounts. The app offers to move them into their league (Fantasy Leagues); older versions of the app still show them.",
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
    fantasyPlayersField(),
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
