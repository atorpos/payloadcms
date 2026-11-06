import type { AdminViewServerProps } from 'payload'

import React from 'react'

import type { NhlPage as Page, NhlPlayer, NhlTeam } from '../../nhl/types'

import { errorMessage, hockeyApi } from '../../nhl/hockeyApi'
import { formatMoney, optionLabel, POSITIONS, ROSTER_STATUSES } from '../../nhl/types'
import { NhlLoadError, NhlPage, nhlURL } from './NhlPage'

const PAGE_SIZE = 50

/** `/admin/nhl/players?q=&team=&position=&status=&page=`: the players in the HockeyPoolCap API, by last name */
export async function NhlPlayersView(props: AdminViewServerProps) {
  const filter = (name: string) => {
    const value = props.searchParams?.[name]
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
  }
  const q = filter('q')
  const team = filter('team').toUpperCase()
  const position = filter('position').toUpperCase()
  const status = filter('status').toUpperCase()
  const page = Math.max(1, Number.parseInt(filter('page'), 10) || 1)

  const query = new URLSearchParams({ page: String(page - 1), size: String(PAGE_SIZE) })
  if (q) query.set('q', q)
  if (/^[A-Z]{2,5}$/.test(team)) query.set('team', team)
  if (POSITIONS.some((option) => option.value === position)) query.set('position', position)
  if (ROSTER_STATUSES.some((option) => option.value === status)) query.set('status', status)

  let teams: NhlTeam[] = []
  let players: null | Page<NhlPlayer> = null
  let error: null | string = null

  try {
    ;[teams, players] = await Promise.all([
      hockeyApi<NhlTeam[]>('/api/v1/teams'),
      hockeyApi<Page<NhlPlayer>>(`/api/v1/players?${query}`),
    ])
  } catch (caught) {
    error = errorMessage(caught)
  }

  /** This list's URL with another page */
  const pageURL = (to: number) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (team) params.set('team', team)
    if (position) params.set('position', position)
    if (status) params.set('status', status)
    params.set('page', String(to))
    return `${nhlURL(props, '/players')}?${params}`
  }

  return (
    <NhlPage
      description="The players and prospects in the HockeyPoolCap API’s database. Open one to change him or his stats."
      props={props}
      title="Players"
    >
      <form action={nhlURL(props, '/players')} className="nhl-data__filters" method="get" role="search">
        <div className="nhl-data__field nhl-data__field--wide">
          <label htmlFor="nhl-q">Name</label>
          <input defaultValue={q} id="nhl-q" name="q" placeholder="e.g. MacKinnon" type="search" />
        </div>
        <div className="nhl-data__field">
          <label htmlFor="nhl-team">Team</label>
          <select defaultValue={team} id="nhl-team" name="team">
            <option value="">All teams</option>
            {[...teams]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((option) => (
                <option key={option.abbreviation} value={option.abbreviation}>
                  {option.name}
                </option>
              ))}
          </select>
        </div>
        <div className="nhl-data__field">
          <label htmlFor="nhl-position">Position</label>
          <select defaultValue={position} id="nhl-position" name="position">
            <option value="">All positions</option>
            {POSITIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="nhl-data__field">
          <label htmlFor="nhl-status">Status</label>
          <select defaultValue={status} id="nhl-status" name="status">
            <option value="">All</option>
            {ROSTER_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="nhl-data__filter-actions">
          <button className="nhl-data__button" type="submit">
            Search
          </button>
          {(q || team || position || status) && <a href={nhlURL(props, '/players')}>Clear</a>}
        </div>
      </form>

      {error || !players ? (
        <NhlLoadError message={error ?? ''} />
      ) : (
        <>
          <p className="nhl-data__count">
            {players.totalElements === 1 ? '1 player' : `${players.totalElements} players`}
            {players.totalPages > 1 && ` · page ${page} of ${players.totalPages}`}
          </p>
          <div className="nhl-data__table-wrap">
            <table className="nhl-data__table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Position</th>
                  <th>#</th>
                  <th>Team</th>
                  <th>Status</th>
                  <th className="nhl-data__number">Cap hit</th>
                </tr>
              </thead>
              <tbody>
                {players.content.map((player) => (
                  <tr key={player.id}>
                    <td>
                      <a href={nhlURL(props, `/players/${player.id}`)}>{player.fullName}</a>
                    </td>
                    <td>{optionLabel(POSITIONS, player.position)}</td>
                    <td>{player.jerseyNumber ?? '—'}</td>
                    <td>
                      {player.team ? (
                        <a href={nhlURL(props, `/teams/${player.team.abbreviation}`)}>{player.team.abbreviation}</a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{optionLabel(ROSTER_STATUSES, player.rosterStatus)}</td>
                    <td className="nhl-data__number">{formatMoney(player.capHit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {players.content.length === 0 && <p className="nhl-data__empty">No players match.</p>}
          {players.totalPages > 1 && (
            <nav aria-label="Pages" className="nhl-data__pages">
              {page > 1 ? <a href={pageURL(page - 1)}>← Previous</a> : <span />}
              {page < players.totalPages && <a href={pageURL(page + 1)}>Next →</a>}
            </nav>
          )}
        </>
      )}
    </NhlPage>
  )
}
