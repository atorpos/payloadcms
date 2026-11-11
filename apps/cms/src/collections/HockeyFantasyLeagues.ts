import type { ArrayField, CollectionConfig } from 'payload'

import { ValidationError } from 'payload'

import { loggedIn } from '../access/loggedIn'

/** The most teams in one league, as the app and the API allow */
export const MAX_LEAGUE_TEAMS = 20

/** The most players on one team */
export const MAX_TEAM_PLAYERS = 40

/**
 * The players of a fantasy team: each by his ID in the HockeyPoolCap API, with his name, position and team as they
 * were when picked. A new object each time, so each collection gets its own copy of the field.
 */
export const fantasyPlayersField = (): ArrayField => ({
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
  maxRows: MAX_TEAM_PLAYERS,
})

/**
 * The fantasy league someone sets up in the HockeyPoolCap app, saved to their account: its name and every team in
 * it. Their own team is marked `mine`; the others are the teams they play against, which they add themselves, with
 * who runs each. For now each member has one league, with one team of their own in it.
 *
 * The app's backend, the HockeyPoolCap API, saves it through src/endpoints/hockeyFantasyLeague.ts. Each team's
 * total points are kept here (`points`): every night at 3:30 Eastern the API adds the day's points of the players on
 * the team then (src/endpoints/hockeyFantasyPoints.ts), so trades don't move points already earned, and admins can
 * correct a total. People without an account keep their league on the phone instead, never here.
 * Private: every operation, including reading, requires a logged-in user.
 */
export const HockeyFantasyLeagues: CollectionConfig = {
  slug: 'hockey-fantasy-leagues',
  access: {
    // Leagues come from the app, for a member
    create: () => false,
    delete: loggedIn,
    read: loggedIn,
    update: loggedIn,
  },
  admin: {
    defaultColumns: ['name', 'member', 'updatedAt'],
    description:
      'The fantasy league each person sets up in the HockeyPoolCap app: its teams, with theirs marked as theirs. What you change here shows in the app.',
    group: 'HockeyPoolCap App',
    listSearchableFields: ['name'],
    useAsTitle: 'name',
  },
  defaultSort: '-createdAt',
  hooks: {
    // One team is theirs: the app shows it as "My Team" and the others as the teams they play against
    beforeChange: [
      ({ data, req }) => {
        const mine = (data?.teams ?? []).filter((team: { mine?: boolean }) => team?.mine)

        if (mine.length > 1) {
          throw new ValidationError({
            collection: 'hockey-fantasy-leagues',
            errors: [{ message: 'Only one team can be theirs.', path: 'teams' }],
            req,
          })
        }

        return data
      },
    ],
  },
  labels: {
    plural: 'Fantasy Leagues',
    singular: 'Fantasy League',
  },
  typescript: {
    interface: 'HockeyFantasyLeague',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      admin: {
        description: 'e.g. Office pool',
      },
      maxLength: 60,
      required: true,
    },
    {
      name: 'teams',
      type: 'array',
      admin: {
        description:
          'Every team in the league: theirs (checked "Their team") and the ones they play against, in the order they were added.',
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
              name: 'manager',
              type: 'text',
              admin: {
                description: 'Who runs it, for the teams they play against',
              },
              maxLength: 60,
            },
            {
              name: 'mine',
              type: 'checkbox',
              admin: {
                description: 'Their own team. Only one.',
              },
              defaultValue: false,
              label: 'Their team',
            },
          ],
        },
        fantasyPlayersField(),
        {
          type: 'row',
          fields: [
            {
              name: 'points',
              type: 'number',
              admin: {
                description:
                  "Their fantasy points this season. Every night at 3:30 Eastern the HockeyPoolCap API adds the day's points of the players on the team then, so a player traded away keeps his points with the team he earned them for. Change it to correct an error: the next night adds to what you set. Empty until the first night counts it.",
                step: 1,
              },
              label: 'Total Points',
            },
            {
              name: 'pointsThrough',
              type: 'text',
              admin: {
                description: 'The last game day (Eastern) the nightly count added, e.g. 2026-11-10',
                readOnly: true,
              },
              label: 'Counted Through',
              maxLength: 10,
            },
          ],
        },
        {
          name: 'pointsLog',
          type: 'array',
          admin: {
            description:
              "What each night added, newest last: the first line is the starting total (the players' points so far when the count began). Your changes to Total Points are not listed.",
            initCollapsed: true,
            readOnly: true,
          },
          fields: [
            {
              type: 'row',
              fields: [
                { name: 'date', type: 'text', maxLength: 10, required: true },
                { name: 'points', type: 'number', required: true },
                { name: 'note', type: 'text', maxLength: 60 },
              ],
            },
          ],
          label: 'Points by Day',
          labels: {
            plural: 'Days',
            singular: 'Day',
          },
        },
      ],
      labels: {
        plural: 'Teams',
        singular: 'Team',
      },
      maxRows: MAX_LEAGUE_TEAMS,
    },
    {
      name: 'member',
      type: 'relationship',
      admin: {
        description: 'Whose league it is. Set by the app.',
        position: 'sidebar',
        readOnly: true,
      },
      index: true,
      relationTo: 'hockey-members',
      required: true,
    },
  ],
}
