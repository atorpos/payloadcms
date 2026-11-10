import type { AdminViewServerProps } from 'payload'

import React from 'react'

import type { NhlPlayer, NhlTeamAdmin, NhlTeamStats, TeamCapSummary, TeamInjuries } from '../../nhl/types'

import { TEAM_FIELD_LABELS } from '../../nhl/fields'
import { errorMessage, hockeyApi, HockeyApiError } from '../../nhl/hockeyApi'
import { formatMoney, optionLabel, POSITIONS, ROSTER_STATUSES } from '../../nhl/types'
import { CapSummaries } from './CapSummaries'
import { InjuriesPanel } from './InjuriesPanel'
import { KeptNote } from './KeptNote'
import { NhlLoadError, NhlPage, nhlURL, segments } from './NhlPage'
import { TeamForm } from './TeamForm'

/** `/admin/nhl/teams/:abbreviation`: a team's details, to change, and its players */
export async function NhlTeamView(props: AdminViewServerProps) {
  const abbreviation = (segments(props)[2] ?? '').toUpperCase()
  const breadcrumbs = [{ href: nhlURL(props, '/teams'), label: 'Teams' }]

  let team: NhlTeamAdmin | null = null
  let roster: NhlPlayer[] = []
  let capSummaries: TeamCapSummary[] = []
  let standings: NhlTeamStats[] = []
  let injuries: null | TeamInjuries = null
  let error: null | string = null

  if (!/^[A-Z]{2,5}$/.test(abbreviation)) {
    error = `There’s no team ${abbreviation}.`
  } else {
    try {
      ;[team, roster, capSummaries, standings, injuries] = await Promise.all([
        hockeyApi<NhlTeamAdmin>(`/api/v1/admin/teams/${abbreviation}`),
        hockeyApi<NhlPlayer[]>(`/api/v1/teams/${abbreviation}/roster`),
        hockeyApi<TeamCapSummary[]>(`/api/v1/admin/cap-summaries?team=${abbreviation}`),
        hockeyApi<NhlTeamStats[]>(`/api/v1/teams/${abbreviation}/stats`),
        // An API from before injuries doesn't have them: the page shows without
        hockeyApi<TeamInjuries>(`/api/v1/teams/${abbreviation}/injuries`).catch(() => null),
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
      {team.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- the NHL's SVG, as it is
        <img alt={`${team.name} logo`} className="nhl-data__logo nhl-data__logo--large" height={96} src={team.logoUrl} width={96} />
      )}

      <section className="nhl-data__section">
        <h2>Standing</h2>
        <Standing standing={standings[0]} />
      </section>

      <section className="nhl-data__section">
        <h2>Details</h2>
        <KeptNote kept={team.keptFields} labels={TEAM_FIELD_LABELS} path={`/teams/${team.abbreviation}`} />
        <TeamForm team={team} />
        {team.externalId && <p className="nhl-data__hint">API Ninjas’ ID, from the import before the NHL’s: {team.externalId}</p>}
      </section>

      <section className="nhl-data__section">
        <h2>Salary cap</h2>
        <p className="nhl-data__hint">
          As last worked out from the players’ contracts and stored: the research script does it after each run, and
          the API after each injury change. Players on LTIR still count, but let the team exceed the cap by its LTIR
          relief: “cap space with LTIR” is the room it really has.
        </p>
        <CapSummaries abbreviation={team.abbreviation} summaries={capSummaries} />
      </section>

      <section className="nhl-data__section">
        <h2>Injuries</h2>
        <InjuriesPanel injuries={injuries} roster={roster} />
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
                <th>
                  <span className="nhl-data__sr-only">Photo</span>
                </th>
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
                  <td className="nhl-data__photo-cell">
                    {player.headshotUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- the NHL's photo, as it is
                      <img alt="" className="nhl-data__headshot nhl-data__headshot--small" height={32} loading="lazy" src={player.headshotUrl} width={32} />
                    )}
                  </td>
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

/** This season's standing, as the import from the NHL last brought it: record, points, ranks and form */
function Standing({ standing }: { standing?: NhlTeamStats }) {
  if (!standing) {
    return <p className="nhl-data__empty">No standing yet: it arrives with the import from the NHL (NHL Data → Import).</p>
  }
  const rank = (value?: null | number) => (value ? `#${value}` : '—')
  const items: [string, null | number | string | undefined][] = [
    ['Record (W-L-OTL)', `${standing.wins}-${standing.losses}-${standing.overtimeLosses}`],
    ['Points', standing.points],
    ['Games played', standing.gamesPlayed],
    ['Point %', standing.pointPercentage?.toFixed(3)],
    ['Regulation wins', standing.regulationWins],
    ['Goals for / against', standing.goalsFor !== null && standing.goalsFor !== undefined
      ? `${standing.goalsFor} / ${standing.goalsAgainst ?? '—'}` : null],
    ['League', rank(standing.leagueRank)],
    ['Conference', rank(standing.conferenceRank)],
    ['Division', rank(standing.divisionRank)],
    ['Streak', standing.streak],
    ['Last 10', standing.lastTen],
    ['Home', standing.homeRecord],
    ['Road', standing.roadRecord],
  ]

  return (
    <>
      <p className="nhl-data__hint">
        {standing.seasonLabel}, from the NHL’s standings
        {standing.updatedAt ? `, as of ${new Date(standing.updatedAt).toUTCString()}` : ''}.
      </p>
      <dl className="nhl-data__standing">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}
