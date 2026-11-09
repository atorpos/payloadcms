import type { AdminViewServerProps } from 'payload'

import React from 'react'

import type { CareerResponse, NhlPlayerAdmin, NhlTeam } from '../../nhl/types'

import { PLAYER_FIELD_LABELS } from '../../nhl/fields'
import { errorMessage, hockeyApi, HockeyApiError } from '../../nhl/hockeyApi'
import { currentSeason, formatMoney, optionLabel, POSITIONS } from '../../nhl/types'
import { CareerEditor } from './CareerEditor'
import { KeptNote } from './KeptNote'
import { NhlLoadError, NhlPage, nhlURL, segments } from './NhlPage'
import { PlayerForm } from './PlayerForm'
import { StatsEditor } from './StatsEditor'

/** `/admin/nhl/players/:id`: a player's details, season stats and whole career, to check and change */
export async function NhlPlayerView(props: AdminViewServerProps) {
  const id = segments(props)[2] ?? ''
  const breadcrumbs = [{ href: nhlURL(props, '/players'), label: 'Players' }]

  let detail: NhlPlayerAdmin | null = null
  let career: CareerResponse | null = null
  let teams: NhlTeam[] = []
  let error: null | string = null

  if (!/^\d{1,18}$/.test(id)) {
    error = 'There’s no such player.'
  } else {
    try {
      ;[detail, teams, career] = await Promise.all([
        hockeyApi<NhlPlayerAdmin>(`/api/v1/admin/players/${id}`),
        hockeyApi<NhlTeam[]>('/api/v1/teams'),
        hockeyApi<CareerResponse>(`/api/v1/admin/players/${id}/career`),
      ])
    } catch (caught) {
      error =
        caught instanceof HockeyApiError && caught.status === 404 ? 'There’s no such player.' : errorMessage(caught)
    }
  }

  if (!detail || !career) {
    return (
      <NhlPage breadcrumbs={breadcrumbs} props={props} title="Player">
        <NhlLoadError message={error ?? ''} />
      </NhlPage>
    )
  }

  const { player, stats } = detail
  const hasStatLines = career.career.stats.length > 0
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
      <div className="nhl-data__profile">
        {player.headshotUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- the NHL's photo, as it is
          <img alt={player.fullName} className="nhl-data__headshot" height={120} src={player.headshotUrl} width={120} />
        )}
        <dl>
          <dt>Born</dt>
          <dd>
            {[player.birthDate, player.birthPlace ?? player.birthCountry].filter(Boolean).join(' · ') || '—'}
          </dd>
          <dt>Height / weight</dt>
          <dd>
            {player.heightCm ? `${player.heightCm} cm` : '—'} / {player.weightKg ? `${player.weightKg} kg` : '—'}
          </dd>
          <dt>Draft</dt>
          <dd>
            {player.draft?.year
              ? [
                  player.draft.year,
                  player.draft.round ? `round ${player.draft.round}` : null,
                  player.draft.overall ? `#${player.draft.overall} overall` : null,
                  player.draft.team?.abbreviation ? `by ${player.draft.team.abbreviation}` : null,
                ]
                  .filter(Boolean)
                  .join(', ')
              : 'Undrafted, or not known'}
          </dd>
          <dt>NHL ID</dt>
          <dd>
            {player.nhlId ? (
              <a href={`https://www.nhl.com/player/${player.nhlId}`} rel="noreferrer" target="_blank">
                {player.nhlId} on NHL.com
              </a>
            ) : (
              'Not found at the NHL yet'
            )}
          </dd>
        </dl>
      </div>

      <section className="nhl-data__section">
        <h2>Details</h2>
        {player.nhlId || detail.externalId ? (
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
        {hasStatLines ? (
          <>
            <p className="nhl-data__hint">
              Added up from his regular-season lines in Career below (one per team), which the daily import brings
              from the NHL. The app’s top players lists and fantasy points come from them.
            </p>
            <SeasonTotals isGoalie={player.position === 'G'} stats={stats} />
          </>
        ) : (
          <>
            <p className="nhl-data__hint">
              Entered by hand: the NHL has no NHL games for him yet. The app’s top players lists and fantasy points come
              from them.
            </p>
            <StatsEditor currentSeason={currentSeason()} isGoalie={player.position === 'G'} playerID={player.id} stats={stats} />
          </>
        )}
      </section>

      <section className="nhl-data__section" id="career">
        <h2>Career</h2>
        <p className="nhl-data__hint">
          His stats and awards come from the NHL (marked NHL), and the daily import replaces them. His contracts and
          transactions come from the research script, with Claude: check them against the sources, correct what’s
          wrong, and mark them verified. Saving replaces it all in the HockeyPoolCap API.
        </p>
        <CareerEditor currentSeason={currentSeason()} initial={career} isGoalie={player.position === 'G'} />
      </section>

      <section className="nhl-data__section nhl-data__source">
        <h2>Source</h2>
        <dl>
          <dt>NHL ID</dt>
          <dd>{player.nhlId ?? 'None: not found on an NHL roster or prospect list'}</dd>
          <dt>Last found on</dt>
          <dd>{detail.sourceRosterStatus ?? '—'}</dd>
          {detail.externalId && (
            <>
              <dt>API Ninjas’ ID (the import before the NHL’s)</dt>
              <dd>{detail.externalId}</dd>
            </>
          )}
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

/** His season stats, read-only: what his regular-season lines add up to */
function SeasonTotals({ isGoalie, stats }: { isGoalie: boolean; stats: NhlPlayerAdmin['stats'] }) {
  const columns: [string, (line: NhlPlayerAdmin['stats'][number]) => null | number | string | undefined][] = isGoalie
    ? [
        ['GP', (line) => line.gamesPlayed],
        ['W', (line) => line.wins],
        ['L', (line) => line.losses],
        ['OTL', (line) => line.overtimeLosses],
        ['SO', (line) => line.shutouts],
        ['GAA', (line) => line.goalsAgainstAverage?.toFixed(2)],
        ['SV%', (line) => line.savePercentage?.toFixed(3)],
      ]
    : [
        ['GP', (line) => line.gamesPlayed],
        ['G', (line) => line.goals],
        ['A', (line) => line.assists],
        ['PTS', (line) => line.points],
        ['+/-', (line) => line.plusMinus],
        ['PIM', (line) => line.penaltyMinutes],
      ]

  return (
    <div className="nhl-data__table-wrap">
      <table className="nhl-data__table">
        <thead>
          <tr>
            <th>Season</th>
            {columns.map(([label]) => (
              <th className="nhl-data__number" key={label}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map((line) => (
            <tr key={line.season}>
              <td>{line.seasonLabel}</td>
              {columns.map(([label, value]) => (
                <td className="nhl-data__number" key={label}>
                  {value(line) ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
