'use client'

import { Button, toast, useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useId, useState } from 'react'

import type { NhlPlayerStats } from '../../nhl/types'

import { seasonLabel } from '../../nhl/types'
import { NhlSaveError, sendNhlChange } from './sendChange'

type StatField = { decimals?: number; label: string; name: keyof NhlPlayerStats; required?: boolean; title: string }

const SKATER: StatField[] = [
  { label: 'GP', name: 'gamesPlayed', required: true, title: 'Games played' },
  { label: 'G', name: 'goals', title: 'Goals' },
  { label: 'A', name: 'assists', title: 'Assists' },
  { label: 'PTS', name: 'points', title: 'Points (empty: goals + assists)' },
  { label: '+/-', name: 'plusMinus', title: 'Plus/minus' },
  { label: 'PIM', name: 'penaltyMinutes', title: 'Penalty minutes' },
  { label: 'GWG', name: 'gameWinningGoals', title: 'Game-winning goals' },
  { label: 'PPG', name: 'powerPlayGoals', title: 'Power-play goals' },
  { label: 'PPP', name: 'powerPlayPoints', title: 'Power-play points' },
  { label: 'SHG', name: 'shorthandedGoals', title: 'Short-handed goals' },
  { label: 'SHP', name: 'shorthandedPoints', title: 'Short-handed points' },
  { label: 'OTG', name: 'overtimeGoals', title: 'Overtime goals' },
  { label: 'S', name: 'shots', title: 'Shots on goal' },
]

const GOALIE: StatField[] = [
  { label: 'GP', name: 'gamesPlayed', required: true, title: 'Games played' },
  { label: 'W', name: 'wins', title: 'Wins' },
  { label: 'L', name: 'losses', title: 'Losses' },
  { label: 'OTL', name: 'overtimeLosses', title: 'Overtime losses' },
  { label: 'SO', name: 'shutouts', title: 'Shutouts' },
  { decimals: 2, label: 'GAA', name: 'goalsAgainstAverage', title: 'Goals against average, e.g. 2.45' },
  { decimals: 3, label: 'SV%', name: 'savePercentage', title: 'Save percentage, e.g. 0.915' },
  { label: 'GS', name: 'gamesStarted', title: 'Games started' },
  { label: 'SA', name: 'shotsAgainst', title: 'Shots against' },
  { label: 'GA', name: 'goalsAgainst', title: 'Goals against' },
]

/** Every number the API keeps for a season: what the form doesn't show is sent as it was, so nothing is lost */
const ALL: (keyof NhlPlayerStats)[] = [...new Set([...SKATER, ...GOALIE].map((field) => field.name))]

type Props = {
  /** The season the form starts with, e.g. 2026 for 2026-27 */
  currentSeason: number
  isGoalie: boolean
  playerID: number
  /** Newest first */
  stats: NhlPlayerStats[]
}

/** A player's season stats: each season's line, changed or deleted, and new seasons added */
export function StatsEditor({ currentSeason, isGoalie, playerID, stats }: Props) {
  const {
    config: {
      routes: { api: apiRoute },
    },
  } = useConfig()
  const router = useRouter()
  const id = useId()
  const fields = isGoalie ? GOALIE : SKATER

  const formFor = (season: number) => {
    const existing = stats.find((line) => line.season === season)
    return Object.fromEntries(
      ALL.map((name) => [name, existing?.[name] === null || existing?.[name] === undefined ? '' : String(existing[name])]),
    )
  }

  const [season, setSeason] = useState(currentSeason)
  const [values, setValues] = useState<Record<string, string>>(() => formFor(currentSeason))
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const edit = (to: number) => {
    setSeason(to)
    setValues(formFor(to))
    setError('')
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')

    const body: Record<string, number> = {}

    for (const name of ALL) {
      const text = (values[name] ?? '').trim()
      if (!text) {
        continue
      }
      const number = Number(text)
      if (!Number.isFinite(number)) {
        setError(`${[...SKATER, ...GOALIE].find((field) => field.name === name)?.title ?? name} must be a number.`)
        return
      }
      body[name] = number
    }

    if (body.gamesPlayed === undefined) {
      setError('Enter the games played.')
      return
    }

    setIsSaving(true)

    try {
      await sendNhlChange(apiRoute, `/players/${playerID}/stats/${season}`, 'PUT', body)
      toast.success(`${seasonLabel(season)} stats saved.`)
      router.refresh()
    } catch (caught) {
      const fieldErrors = caught instanceof NhlSaveError ? caught.fieldErrors : {}
      const first = Object.entries(fieldErrors)[0]
      setError(first ? `${first[0]} ${first[1]}` : (caught as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  const remove = async (line: NhlPlayerStats) => {
    if (!window.confirm(`Delete the ${line.seasonLabel} stats?`)) {
      return
    }

    try {
      await sendNhlChange(apiRoute, `/players/${playerID}/stats/${line.season}`, 'DELETE')
      toast.success(`${line.seasonLabel} stats deleted.`)
      router.refresh()
    } catch (caught) {
      toast.error((caught as Error).message)
    }
  }

  const show = (line: NhlPlayerStats, field: StatField) => {
    const value =
      field.name === 'points' && (line.points === null || line.points === undefined)
        ? (line.goals ?? 0) + (line.assists ?? 0)
        : line[field.name]
    if (value === null || value === undefined) {
      return '—'
    }
    return field.decimals ? Number(value).toFixed(field.decimals) : String(value)
  }

  return (
    <div className="nhl-data__stats">
      {stats.length > 0 ? (
        <div className="nhl-data__table-wrap">
          <table className="nhl-data__table">
            <thead>
              <tr>
                <th>Season</th>
                {fields.map((field) => (
                  <th className="nhl-data__number" key={field.name} title={field.title}>
                    {field.label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {stats.map((line) => (
                <tr aria-selected={line.season === season} key={line.season}>
                  <td>{line.seasonLabel}</td>
                  {fields.map((field) => (
                    <td className="nhl-data__number" key={field.name}>
                      {show(line, field)}
                    </td>
                  ))}
                  <td className="nhl-data__row-actions">
                    <button className="nhl-data__link-button" onClick={() => edit(line.season)} type="button">
                      Edit
                    </button>
                    <button
                      className="nhl-data__link-button nhl-data__link-button--danger"
                      onClick={() => remove(line)}
                      type="button"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="nhl-data__empty">No stats yet. Points in the app’s fantasy teams come from these.</p>
      )}

      <form className="nhl-data__form nhl-data__stats-form" noValidate onSubmit={save}>
        <h3>{stats.some((line) => line.season === season) ? `Change ${seasonLabel(season)}` : `Add ${seasonLabel(season)}`}</h3>
        <div className="nhl-data__grid nhl-data__grid--stats">
          <div className="nhl-data__field">
            <label htmlFor={`${id}-season`}>Season</label>
            <select id={`${id}-season`} onChange={(event) => edit(Number(event.target.value))} value={season}>
              {Array.from({ length: 8 }, (_, index) => currentSeason + 1 - index).map((year) => (
                <option key={year} value={year}>
                  {seasonLabel(year)}
                </option>
              ))}
            </select>
          </div>
          {fields.map((field) => (
            <div className="nhl-data__field" key={field.name}>
              <label htmlFor={`${id}-${field.name}`} title={field.title}>
                {field.title.replace(/ \(.*\)|, e\.g\..*/, '')}
                {field.required && ' *'}
              </label>
              <input
                id={`${id}-${field.name}`}
                inputMode={field.decimals ? 'decimal' : 'numeric'}
                onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                placeholder={field.name === 'points' ? 'G + A' : field.decimals === 3 ? '0.915' : field.decimals ? '2.45' : ''}
                type="text"
                value={values[field.name] ?? ''}
              />
            </div>
          ))}
        </div>
        {error && (
          <p className="nhl-data__form-error" role="alert">
            {error}
          </p>
        )}
        <div className="nhl-data__actions">
          <Button disabled={isSaving} type="submit">
            {isSaving ? 'Saving…' : `Save ${seasonLabel(season)}`}
          </Button>
        </div>
      </form>
    </div>
  )
}
