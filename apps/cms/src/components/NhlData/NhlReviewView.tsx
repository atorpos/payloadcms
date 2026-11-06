import type { AdminViewServerProps } from 'payload'

import React from 'react'

import type { NhlPage as Page, NhlTeam, ResearchEntry } from '../../nhl/types'

import { errorMessage, hockeyApi } from '../../nhl/hockeyApi'
import { optionLabel, POSITIONS, RESEARCH_STATUSES } from '../../nhl/types'
import { NhlLoadError, NhlPage, nhlURL } from './NhlPage'

const PAGE_SIZE = 50

/**
 * `/admin/nhl/review?status=&team=&page=`: players whose career the research script imported, to check and correct
 * (NEEDS_REVIEW by default), and those already verified or never researched.
 */
export async function NhlReviewView(props: AdminViewServerProps) {
  const filter = (name: string) => {
    const value = props.searchParams?.[name]
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? ''
  }
  const status = filter('status').toUpperCase() || 'NEEDS_REVIEW'
  const team = filter('team').toUpperCase()
  const page = Math.max(1, Number.parseInt(filter('page'), 10) || 1)

  const query = new URLSearchParams({ page: String(page - 1), size: String(PAGE_SIZE) })
  if (status !== 'ALL') query.set('status', status)
  if (/^[A-Z]{2,5}$/.test(team)) query.set('team', team)

  let teams: NhlTeam[] = []
  let entries: null | Page<ResearchEntry> = null
  let error: null | string = null

  try {
    ;[teams, entries] = await Promise.all([
      hockeyApi<NhlTeam[]>('/api/v1/teams'),
      hockeyApi<Page<ResearchEntry>>(`/api/v1/admin/research?${query}`),
    ])
  } catch (caught) {
    error = errorMessage(caught)
  }

  const pageURL = (to: number) =>
    `${nhlURL(props, '/review')}?${new URLSearchParams({ page: String(to), status, ...(team ? { team } : {}) })}`

  return (
    <NhlPage
      description="Careers the research script found with Claude: contracts, trades, achievements and stats. Open a player to check them against the sources, correct what’s wrong, and mark him verified."
      props={props}
      title="Review"
    >
      <form action={nhlURL(props, '/review')} className="nhl-data__filters nhl-data__filters--review" method="get">
        <div className="nhl-data__field">
          <label htmlFor="nhl-review-status">Research</label>
          <select defaultValue={status} id="nhl-review-status" name="status">
            {RESEARCH_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value="ALL">All players</option>
          </select>
        </div>
        <div className="nhl-data__field">
          <label htmlFor="nhl-review-team">Team</label>
          <select defaultValue={team} id="nhl-review-team" name="team">
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
        <div className="nhl-data__filter-actions">
          <button className="nhl-data__button" type="submit">
            Show
          </button>
        </div>
      </form>

      {error || !entries ? (
        <NhlLoadError message={error ?? ''} />
      ) : (
        <>
          <p className="nhl-data__count">
            {entries.totalElements === 1 ? '1 player' : `${entries.totalElements} players`}
            {entries.totalPages > 1 && ` · page ${page} of ${entries.totalPages}`}
          </p>
          <div className="nhl-data__table-wrap">
            <table className="nhl-data__table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Position</th>
                  <th>Team</th>
                  <th>Research</th>
                  <th>Researched</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {entries.content.map(({ model, player, researchedAt, researchStatus }) => (
                  <tr key={player.id}>
                    <td>
                      <a href={`${nhlURL(props, `/players/${player.id}`)}#career`}>{player.fullName}</a>
                    </td>
                    <td>{optionLabel(POSITIONS, player.position)}</td>
                    <td>{player.team?.abbreviation ?? '—'}</td>
                    <td>
                      <span className={`nhl-data__status nhl-data__status--${(researchStatus ?? 'none').toLowerCase()}`}>
                        {optionLabel(RESEARCH_STATUSES, researchStatus ?? 'NONE')}
                      </span>
                    </td>
                    <td>{researchedAt ? new Date(researchedAt).toISOString().slice(0, 10) : '—'}</td>
                    <td>{model ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {entries.content.length === 0 && (
            <p className="nhl-data__empty">
              {status === 'NEEDS_REVIEW'
                ? 'Nothing to review. Run the research script (HockeyPoolCap API: scripts/research) to research players.'
                : 'No players match.'}
            </p>
          )}
          {entries.totalPages > 1 && (
            <nav aria-label="Pages" className="nhl-data__pages">
              {page > 1 ? <a href={pageURL(page - 1)}>← Previous</a> : <span />}
              {page < entries.totalPages && <a href={pageURL(page + 1)}>Next →</a>}
            </nav>
          )}
        </>
      )}
    </NhlPage>
  )
}
