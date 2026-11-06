import type { AdminViewServerProps } from 'payload'

import React from 'react'

import type { NhlPlayerAdmin, NhlTeam } from '../../nhl/types'

import { PLAYER_FIELD_LABELS } from '../../nhl/fields'
import { errorMessage, hockeyApi, HockeyApiError } from '../../nhl/hockeyApi'
import { currentSeason, formatMoney, optionLabel, POSITIONS } from '../../nhl/types'
import { KeptNote } from './KeptNote'
import { NhlLoadError, NhlPage, nhlURL, segments } from './NhlPage'
import { PlayerForm } from './PlayerForm'
import { StatsEditor } from './StatsEditor'

const CONTRACT_TYPES: Record<string, string> = {
  ENTRY_LEVEL: 'Entry-level',
  STANDARD: 'Standard',
  THIRTY_FIVE_PLUS: '35+',
}

/** `/admin/nhl/players/:id`: a player's details and season stats, to change, and his contracts */
export async function NhlPlayerView(props: AdminViewServerProps) {
  const id = segments(props)[2] ?? ''
  const breadcrumbs = [{ href: nhlURL(props, '/players'), label: 'Players' }]

  let detail: NhlPlayerAdmin | null = null
  let teams: NhlTeam[] = []
  let error: null | string = null

  if (!/^\d{1,18}$/.test(id)) {
    error = 'There’s no such player.'
  } else {
    try {
      ;[detail, teams] = await Promise.all([
        hockeyApi<NhlPlayerAdmin>(`/api/v1/admin/players/${id}`),
        hockeyApi<NhlTeam[]>('/api/v1/teams'),
      ])
    } catch (caught) {
      error =
        caught instanceof HockeyApiError && caught.status === 404 ? 'There’s no such player.' : errorMessage(caught)
    }
  }

  if (!detail) {
    return (
      <NhlPage breadcrumbs={breadcrumbs} props={props} title="Player">
        <NhlLoadError message={error ?? ''} />
      </NhlPage>
    )
  }

  const { contracts, player, stats } = detail
  const teamOptions = [...teams]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((team) => ({ label: `${team.name} (${team.abbreviation})`, value: team.abbreviation }))
  const description = [
    player.jerseyNumber !== null && player.jerseyNumber !== undefined ? `#${player.jerseyNumber}` : null,
    optionLabel(POSITIONS, player.position),
    player.team?.name ?? player.team?.abbreviation ?? 'No team',
    player.capHit ? `${formatMoney(player.capHit)} cap hit` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <NhlPage breadcrumbs={breadcrumbs} description={description} props={props} title={player.fullName}>
      <section className="nhl-data__section">
        <h2>Details</h2>
        {detail.externalId ? (
          <KeptNote kept={detail.keptFields} labels={PLAYER_FIELD_LABELS} path={`/players/${player.id}`} />
        ) : (
          <p className="nhl-data__kept">Added by hand: the daily import never changes him.</p>
        )}
        <PlayerForm player={{ ...player, keptFields: detail.keptFields }} teams={teamOptions} />
        {player.team && (
          <p className="nhl-data__hint">
            <a href={nhlURL(props, `/teams/${player.team.abbreviation}`)}>See {player.team.name ?? player.team.abbreviation}</a>
          </p>
        )}
      </section>

      <section className="nhl-data__section">
        <h2>Season stats</h2>
        <p className="nhl-data__hint">
          Entered by hand (API Ninjas has none). The app’s top players lists and fantasy points come from them.
        </p>
        <StatsEditor currentSeason={currentSeason()} isGoalie={player.position === 'G'} playerID={player.id} stats={stats} />
      </section>

      <section className="nhl-data__section">
        <h2>Contracts</h2>
        {contracts.length === 0 ? (
          <p className="nhl-data__empty">No contracts.</p>
        ) : (
          <div className="nhl-data__table-wrap">
            <table className="nhl-data__table">
              <thead>
                <tr>
                  <th>Seasons</th>
                  <th>Type</th>
                  <th className="nhl-data__number">Cap hit</th>
                  <th className="nhl-data__number">Total</th>
                  <th>Then</th>
                  <th>Clauses</th>
                </tr>
              </thead>
              <tbody>
                {[...contracts].reverse().map((contract) => (
                  <tr key={contract.id}>
                    <td>{contract.seasons ?? `${contract.startSeason}–${contract.endSeason}`}</td>
                    <td>{CONTRACT_TYPES[contract.contractType ?? ''] ?? contract.contractType ?? '—'}</td>
                    <td className="nhl-data__number">{formatMoney(contract.capHit)}</td>
                    <td className="nhl-data__number">{formatMoney(contract.totalValue)}</td>
                    <td>{contract.expiryStatus ?? '—'}</td>
                    <td>
                      {[contract.noMovementClause && 'NMC', contract.noTradeClause && 'NTC'].filter(Boolean).join(', ') ||
                        '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="nhl-data__hint">Contracts are changed with the API’s admin endpoints (README: “Endpoints”).</p>
      </section>

      <section className="nhl-data__section nhl-data__source">
        <h2>Source</h2>
        <dl>
          <dt>API Ninjas’ ID</dt>
          <dd>{detail.externalId ?? 'None: added by hand'}</dd>
          <dt>Roster status, as API Ninjas wrote it</dt>
          <dd>{detail.sourceRosterStatus ?? '—'}</dd>
          <dt>Last imported</dt>
          <dd>{detail.lastImportedAt ? new Date(detail.lastImportedAt).toUTCString() : 'Never'}</dd>
          <dt>Last changed</dt>
          <dd>{detail.updatedAt ? new Date(detail.updatedAt).toUTCString() : '—'}</dd>
          <dt>HockeyPoolCap ID</dt>
          <dd>{player.id}</dd>
        </dl>
      </section>
    </NhlPage>
  )
}
