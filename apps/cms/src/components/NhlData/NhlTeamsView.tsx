import type { AdminViewServerProps } from 'payload'

import React from 'react'

import type { NhlTeam } from '../../nhl/types'

import { errorMessage, hockeyApi } from '../../nhl/hockeyApi'
import { NhlLoadError, NhlPage, nhlURL } from './NhlPage'

/** `/admin/nhl/teams`: every team in the HockeyPoolCap API, by conference and division */
export async function NhlTeamsView(props: AdminViewServerProps) {
  let teams: NhlTeam[] = []
  let error: null | string = null

  try {
    teams = await hockeyApi<NhlTeam[]>('/api/v1/teams')
  } catch (caught) {
    error = errorMessage(caught)
  }

  const sorted = [...teams].sort(
    (a, b) =>
      (a.conference ?? '').localeCompare(b.conference ?? '') ||
      (a.division ?? '').localeCompare(b.division ?? '') ||
      a.name.localeCompare(b.name),
  )

  return (
    <NhlPage
      description="The NHL teams in the HockeyPoolCap API’s database, which the app shows. Open one to change it or see its players."
      props={props}
      title="Teams"
    >
      {error ? (
        <NhlLoadError message={error} />
      ) : (
        <>
          <p className="nhl-data__count">{teams.length === 1 ? '1 team' : `${teams.length} teams`}</p>
          <div className="nhl-data__table-wrap">
            <table className="nhl-data__table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Abbreviation</th>
                  <th>City</th>
                  <th>Conference</th>
                  <th>Division</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((team) => (
                  <tr key={team.abbreviation}>
                    <td>
                      <a href={nhlURL(props, `/teams/${team.abbreviation}`)}>{team.name}</a>
                    </td>
                    <td>{team.abbreviation}</td>
                    <td>{team.city ?? '—'}</td>
                    <td>{team.conference ?? '—'}</td>
                    <td>{team.division ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {teams.length === 0 && (
            <p className="nhl-data__empty">
              No teams yet: they arrive with the API’s import from API Ninjas (POST /api/v1/admin/import).
            </p>
          )}
        </>
      )}
    </NhlPage>
  )
}
