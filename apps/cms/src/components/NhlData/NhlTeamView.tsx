import type { AdminViewServerProps } from 'payload'

import React from 'react'

import type { NhlPlayer, NhlTeamAdmin } from '../../nhl/types'

import { TEAM_FIELD_LABELS } from '../../nhl/fields'
import { errorMessage, hockeyApi, HockeyApiError } from '../../nhl/hockeyApi'
import { formatMoney, optionLabel, POSITIONS, ROSTER_STATUSES } from '../../nhl/types'
import { KeptNote } from './KeptNote'
import { NhlLoadError, NhlPage, nhlURL, segments } from './NhlPage'
import { TeamForm } from './TeamForm'

/** `/admin/nhl/teams/:abbreviation`: a team's details, to change, and its players */
export async function NhlTeamView(props: AdminViewServerProps) {
  const abbreviation = (segments(props)[2] ?? '').toUpperCase()
  const breadcrumbs = [{ href: nhlURL(props, '/teams'), label: 'Teams' }]

  let team: NhlTeamAdmin | null = null
  let roster: NhlPlayer[] = []
  let error: null | string = null

  if (!/^[A-Z]{2,5}$/.test(abbreviation)) {
    error = `There’s no team ${abbreviation}.`
  } else {
    try {
      ;[team, roster] = await Promise.all([
        hockeyApi<NhlTeamAdmin>(`/api/v1/admin/teams/${abbreviation}`),
        hockeyApi<NhlPlayer[]>(`/api/v1/teams/${abbreviation}/roster`),
      ])
    } catch (caught) {
      error =
        caught instanceof HockeyApiError && caught.status === 404
          ? `There’s no team ${abbreviation}.`
          : errorMessage(caught)
    }
  }

  if (!team) {
    return (
      <NhlPage breadcrumbs={breadcrumbs} props={props} title={abbreviation || 'Team'}>
        <NhlLoadError message={error ?? ''} />
      </NhlPage>
    )
  }

  return (
    <NhlPage
      breadcrumbs={breadcrumbs}
      description={[team.abbreviation, team.conference, team.division].filter(Boolean).join(' · ')}
      props={props}
      title={team.name}
    >
      <section className="nhl-data__section">
        <h2>Details</h2>
        <KeptNote kept={team.keptFields} labels={TEAM_FIELD_LABELS} path={`/teams/${team.abbreviation}`} />
        <TeamForm team={team} />
        {team.externalId && <p className="nhl-data__hint">API Ninjas’ ID: {team.externalId}</p>}
      </section>

      <section className="nhl-data__section">
        <h2>Players</h2>
        <p className="nhl-data__count">
          {roster.length === 1 ? '1 player' : `${roster.length} players`}, prospects included. Open one to change him
          or his stats.
        </p>
        <div className="nhl-data__table-wrap">
          <table className="nhl-data__table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Position</th>
                <th>Status</th>
                <th className="nhl-data__number">Cap hit</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((player) => (
                <tr key={player.id}>
                  <td>{player.jerseyNumber ?? '—'}</td>
                  <td>
                    <a href={nhlURL(props, `/players/${player.id}`)}>{player.fullName}</a>
                  </td>
                  <td>{optionLabel(POSITIONS, player.position)}</td>
                  <td>{optionLabel(ROSTER_STATUSES, player.rosterStatus)}</td>
                  <td className="nhl-data__number">{formatMoney(player.capHit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </NhlPage>
  )
}
