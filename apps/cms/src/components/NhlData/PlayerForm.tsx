'use client'

import { Button, toast, useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useId, useState } from 'react'

import type { NhlPlayer } from '../../nhl/types'

import { POSITIONS, ROSTER_STATUSES } from '../../nhl/types'
import { keptAfterSave, NhlSaveError, sendNhlChange } from './sendChange'

type Option = { label: string; value: string }

type Field = {
  /** The field the import keeps when this one is changed (Player.IMPORTED_FIELDS in the API) */
  keptAs?: string
  label: string
  max?: number
  min?: number
  /** The API's name for it, in PATCH /api/v1/admin/players/{id} */
  name: string
  options?: Option[]
  type: 'date' | 'number' | 'select' | 'text'
}

const HANDS: Option[] = [
  { label: 'Left', value: 'L' },
  { label: 'Right', value: 'R' },
]

/** Its value in the form, as text */
const formValue = (player: NhlPlayer, name: string): string => {
  const value =
    name === 'team'
      ? player.team?.abbreviation
      : name === 'draftYear'
        ? player.draft?.year
        : name === 'draftRound'
          ? player.draft?.round
          : name === 'draftOverall'
            ? player.draft?.overall
            : name === 'draftTeam'
              ? player.draft?.team?.abbreviation
              : (player as unknown as Record<string, unknown>)[name]

  return value === null || value === undefined ? '' : String(value)
}

/** Changes a player's details in the HockeyPoolCap API: only what changed is sent */
export function PlayerForm({ player, teams }: { player: NhlPlayer & { keptFields: string[] }; teams: Option[] }) {
  const {
    config: {
      routes: { api: apiRoute },
    },
  } = useConfig()
  const router = useRouter()
  const id = useId()

  const fields: Field[] = [
    { keptAs: 'name', label: 'First name', max: 100, name: 'firstName', type: 'text' },
    { keptAs: 'name', label: 'Last name', max: 100, name: 'lastName', type: 'text' },
    { keptAs: 'position', label: 'Position', name: 'position', options: POSITIONS, type: 'select' },
    {
      keptAs: 'shootsCatches',
      label: player.position === 'G' ? 'Catches' : 'Shoots',
      name: 'shootsCatches',
      options: HANDS,
      type: 'select',
    },
    { keptAs: 'jerseyNumber', label: 'Number', max: 99, min: 0, name: 'jerseyNumber', type: 'number' },
    { keptAs: 'birthDate', label: 'Birth date', name: 'birthDate', type: 'date' },
    { keptAs: 'birthCountry', label: 'Birth country', max: 100, name: 'birthCountry', type: 'text' },
    { keptAs: 'team', label: 'Team', name: 'team', options: teams, type: 'select' },
    { keptAs: 'rosterStatus', label: 'Roster status', name: 'rosterStatus', options: ROSTER_STATUSES, type: 'select' },
    { keptAs: 'draft', label: 'Draft year', max: 2100, min: 1960, name: 'draftYear', type: 'number' },
    { keptAs: 'draft', label: 'Draft round', max: 20, min: 1, name: 'draftRound', type: 'number' },
    { keptAs: 'draft', label: 'Draft pick (overall)', max: 400, min: 1, name: 'draftOverall', type: 'number' },
    { keptAs: 'draft', label: 'Drafted by', name: 'draftTeam', options: teams, type: 'select' },
  ]

  const initial = Object.fromEntries(fields.map((field) => [field.name, formValue(player, field.name)]))
  const [values, setValues] = useState<Record<string, string>>(initial)
  const [keep, setKeep] = useState(true)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)

  const changed = fields.filter((field) => (values[field.name] ?? '').trim() !== (initial[field.name] ?? '').trim())

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')

    const problems: Record<string, string> = {}
    const body: Record<string, unknown> = {}

    for (const field of changed) {
      const value = values[field.name].trim()

      if (!value) {
        problems[field.name] =
          field.name === 'team'
            ? 'can’t be emptied: set the roster status to Free agent or Retired instead'
            : 'can’t be emptied here'
      } else if (field.type === 'number') {
        const number = Number(value)
        if (!Number.isInteger(number)) {
          problems[field.name] = 'must be a whole number'
        } else {
          body[field.name] = number
        }
      } else {
        body[field.name] = value
      }
    }

    setFieldErrors(problems)

    if (Object.keys(problems).length) {
      return
    }

    const keptChanges = [...new Set(changed.map((field) => field.keptAs).filter((name): name is string => !!name))]
    setIsSaving(true)

    try {
      await sendNhlChange(apiRoute, `/players/${player.id}`, 'PATCH', {
        ...body,
        keptFields: keptAfterSave(player.keptFields, keptChanges, keep),
      })
      toast.success(`${player.fullName} saved.`)
      router.refresh()
    } catch (caught) {
      setError((caught as Error).message)
      setFieldErrors(caught instanceof NhlSaveError ? caught.fieldErrors : {})
    } finally {
      setIsSaving(false)
    }
  }

  const renderInput = (field: Field) => {
    const common = {
      'aria-invalid': Boolean(fieldErrors[field.name]),
      id: `${id}-${field.name}`,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
        setValues({ ...values, [field.name]: event.target.value }),
      value: values[field.name] ?? '',
    }

    if (field.type === 'select') {
      const options = field.options ?? []
      return (
        <select {...common}>
          {/* Shown only while empty: an empty choice can't be saved */}
          {!initial[field.name] && <option value="">—</option>}
          {initial[field.name] && !options.some((option) => option.value === initial[field.name]) && (
            <option value={initial[field.name]}>{initial[field.name]}</option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
    }

    return <input {...common} max={field.max} maxLength={field.type === 'text' ? field.max : undefined} min={field.min} type={field.type} />
  }

  return (
    <form className="nhl-data__form" noValidate onSubmit={submit}>
      <div className="nhl-data__grid">
        {fields.map((field) => (
          <div className="nhl-data__field" key={field.name}>
            <label htmlFor={`${id}-${field.name}`}>
              {field.label}
              {field.keptAs && player.keptFields.includes(field.keptAs) && (
                <span className="nhl-data__pill">Kept</span>
              )}
            </label>
            {renderInput(field)}
            {fieldErrors[field.name] && <span className="nhl-data__field-error">{fieldErrors[field.name]}</span>}
          </div>
        ))}
      </div>

      <label className="nhl-data__checkbox">
        <input checked={keep} onChange={(event) => setKeep(event.target.checked)} type="checkbox" />
        Keep my changes from the daily import (otherwise the NHL’s values come back tomorrow)
      </label>

      {error && (
        <p className="nhl-data__form-error" role="alert">
          {error}
        </p>
      )}

      <div className="nhl-data__actions">
        <Button disabled={isSaving || changed.length === 0} type="submit">
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        {changed.length > 0 && !isSaving && (
          <Button buttonStyle="secondary" onClick={() => setValues(initial)}>
            Undo changes
          </Button>
        )}
      </div>
    </form>
  )
}
