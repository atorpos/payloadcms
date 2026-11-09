import type { AdminViewServerProps } from 'payload'

import React from 'react'

import type { NhlImportStatus, NhlTeam } from '../../nhl/types'

import { errorMessage, hockeyApi } from '../../nhl/hockeyApi'
import { ImportPanel } from './ImportPanel'
import { NhlLoadError, NhlPage } from './NhlPage'

/**
 * `/admin/nhl/import`: the import from the NHL's stats service, which the HockeyPoolCap API runs every day. Start
 * one now (every team, or one), and see how far it got and what the last one did.
 */
export async function NhlImportView(props: AdminViewServerProps) {
  let status: NhlImportStatus | null = null
  let teams: NhlTeam[] = []
  let error: null | string = null

  try {
    ;[status, teams] = await Promise.all([
      hockeyApi<NhlImportStatus>('/api/v1/admin/import'),
      hockeyApi<NhlTeam[]>('/api/v1/teams'),
    ])
  } catch (caught) {
    error = errorMessage(caught)
  }

  return (
    <NhlPage
      description="The HockeyPoolCap API brings the teams and players from the NHL’s own stats service every day: the standings, each team’s roster and prospects, and every player’s bio, draft, stats and awards. Contracts and trades come from the research script instead."
      props={props}
      title="Import from the NHL"
    >
      {error || !status ? (
        <NhlLoadError message={error ?? ''} what="The import" />
      ) : (
        <ImportPanel
          initial={status}
          teams={[...teams]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((team) => ({
              label: `${team.name} (${team.abbreviation})`,
              value: team.abbreviation,
            }))}
        />
      )}
    </NhlPage>
  )
}
