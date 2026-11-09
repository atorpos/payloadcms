/** The fields the daily import from the NHL sets, and so can be kept from it, with their labels (the API's names) */

export const TEAM_FIELD_LABELS: Record<string, string> = {
  city: 'City',
  conference: 'Conference',
  division: 'Division',
  name: 'Name',
}

export const PLAYER_FIELD_LABELS: Record<string, string> = {
  birthCountry: 'Birth country',
  birthDate: 'Birth date',
  draft: 'Draft',
  jerseyNumber: 'Number',
  name: 'Name',
  position: 'Position',
  rosterStatus: 'Roster status',
  shootsCatches: 'Shoots / catches',
  team: 'Team',
}
