'use client'

import { Button, toast, useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useId, useRef, useState } from 'react'

import type { NhlImportResult, NhlImportStatus } from '../../nhl/types'

import { sendNhlChange } from './sendChange'

type Option = { label: string; value: string }

/** Starts an import from the NHL and follows it: it reads every player's page, so a full one takes several minutes */
export function ImportPanel({ initial, teams }: { initial: NhlImportStatus; teams: Option[] }) {
  const {
    config: {
      routes: { api: apiRoute },
    },
  } = useConfig()
  const router = useRouter()
  const id = useId()
  const [status, setStatus] = useState(initial)
  const [team, setTeam] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  // Whether it ran at the last look, to say once when it's done (outside of rendering)
  const wasRunning = useRef(initial.running)

  const refresh = useCallback(async () => {
    const response = await fetch(`${apiRoute}/nhl-data/import`, { credentials: 'include' }).catch(() => null)
    if (response?.ok) {
      const next = (await response.json()) as NhlImportStatus
      setStatus(next)
      if (wasRunning.current && !next.running) {
        toast.success('The import from the NHL is done.')
        router.refresh()
      }
      wasRunning.current = next.running
    }
  }, [apiRoute, router])

  // Every 2 seconds while one runs
  useEffect(() => {
    if (!status.running) {
      return
    }
    const timer = setInterval(() => void refresh(), 2000)
    return () => clearInterval(timer)
  }, [status.running, refresh])

  const start = async () => {
    setIsStarting(true)
    try {
      const started = await sendNhlChange<NhlImportStatus>(
        apiRoute,
        `/import${team ? `?team=${encodeURIComponent(team)}` : ''}`,
        'POST',
        {},
      )
      if (started) {
        setStatus(started)
        wasRunning.current = started.running
      }
      toast.success(team ? `Importing ${team} from the NHL…` : 'Importing every team from the NHL…')
    } catch (caught) {
      toast.error((caught as Error).message)
      void refresh()
    } finally {
      setIsStarting(false)
    }
  }

  const progress = status.playersTotal > 0 ? Math.round((status.playersDone / status.playersTotal) * 100) : 0

  return (
    <>
      <section aria-labelledby={`${id}-now`} className="nhl-data__section">
        <h2 id={`${id}-now`}>Import now</h2>
        {status.running ? (
          <div className="nhl-data__import-progress" role="status">
            <p>
              <strong>Importing{status.team ? ` ${status.team}` : ' every team'}</strong>
              {status.phase ? ` · ${status.phase}` : ''}
              {status.playersTotal > 0 ? ` · ${status.playersDone} of ${status.playersTotal} players` : ''}
              {status.startedAt ? ` · started ${new Date(status.startedAt).toLocaleTimeString()}` : ''}
            </p>
            <progress max={100} value={status.playersTotal > 0 ? progress : undefined}>
              {progress}%
            </progress>
          </div>
        ) : (
          <>
            <p className="nhl-data__hint">
              It also runs by itself every day. A full import reads about 1,400 players’ pages, a few at a time, so it
              takes several minutes; one team takes under a minute.
            </p>
            <div className="nhl-data__filters">
              <div className="nhl-data__field">
                <label htmlFor={`${id}-team`}>Teams</label>
                <select id={`${id}-team`} onChange={(event) => setTeam(event.target.value)} value={team}>
                  <option value="">Every team</option>
                  {teams.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="nhl-data__filter-actions">
                <Button disabled={isStarting} onClick={start}>
                  {isStarting ? 'Starting…' : 'Import from the NHL'}
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      <section aria-labelledby={`${id}-last`} className="nhl-data__section">
        <h2 id={`${id}-last`}>Last import</h2>
        {status.lastResult ? (
          <LastResult result={status.lastResult} />
        ) : (
          <p className="nhl-data__empty">None since the HockeyPoolCap API last started.</p>
        )}
      </section>
    </>
  )
}

function LastResult({ result }: { result: NhlImportResult }) {
  const minutes = Math.max(
    1,
    Math.round((new Date(result.finishedAt).getTime() - new Date(result.startedAt).getTime()) / 60000),
  )
  const rows: [string, number | string][] = [
    ['Teams', `${result.teamsCreated} added, ${result.teamsUpdated} updated`],
    ['Players', `${result.playersCreated} added, ${result.playersUpdated} updated`],
    ['Matched to players already here', result.playersMatched],
    ['Player pages read', result.playerPagesRead],
    ['Stat lines', result.statLines],
    ['Awards', result.awards],
    ['Not on a roster or prospect list any more', result.playersMissing],
    ['Players that failed', result.playersFailed],
  ]

  return (
    <>
      <p className="nhl-data__hint">
        {result.team ? `${result.team} only` : 'Every team'} · finished {new Date(result.finishedAt).toUTCString()} ·
        about {minutes} minute{minutes === 1 ? '' : 's'}
      </p>
      <dl className="nhl-data__standing">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {result.errors.length > 0 && (
        <div className="nhl-data__warnings" role="status">
          <strong>What failed ({result.errors.length}); the rest was imported:</strong>
          <ul>
            {result.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
