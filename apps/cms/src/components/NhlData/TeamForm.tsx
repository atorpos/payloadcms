'use client'

import { Button, toast, useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useId, useState } from 'react'

import type { NhlTeamAdmin } from '../../nhl/types'

import { keptAfterSave, NhlSaveError, sendNhlChange } from './sendChange'

const FIELDS = [
  { label: 'Name', maxLength: 100, name: 'name' },
  { label: 'City', maxLength: 100, name: 'city' },
  { label: 'Conference', maxLength: 50, name: 'conference' },
  { label: 'Division', maxLength: 50, name: 'division' },
] as const

type FieldName = (typeof FIELDS)[number]['name']

/** Changes a team's details in the HockeyPoolCap API: only what changed is sent */
export function TeamForm({ team }: { team: NhlTeamAdmin }) {
  const {
    config: {
      routes: { api: apiRoute },
    },
  } = useConfig()
  const router = useRouter()
  const id = useId()
  const initial = Object.fromEntries(FIELDS.map((field) => [field.name, team[field.name] ?? ''])) as Record<
    FieldName,
    string
  >
  const [values, setValues] = useState(initial)
  const [keep, setKeep] = useState(true)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)

  const changed = FIELDS.filter((field) => values[field.name].trim() !== initial[field.name].trim()).map(
    (field) => field.name,
  )

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')

    const emptied = changed.filter((name) => !values[name].trim())

    if (emptied.length) {
      setFieldErrors(Object.fromEntries(emptied.map((name) => [name, 'can’t be emptied here'])))
      return
    }

    setFieldErrors({})
    setIsSaving(true)

    try {
      await sendNhlChange(apiRoute, `/teams/${team.abbreviation}`, 'PATCH', {
        ...Object.fromEntries(changed.map((name) => [name, values[name].trim()])),
        keptFields: keptAfterSave(team.keptFields, changed, keep),
      })
      toast.success(`${values.name.trim() || team.name} saved.`)
      router.refresh()
    } catch (caught) {
      setError((caught as Error).message)
      setFieldErrors(caught instanceof NhlSaveError ? caught.fieldErrors : {})
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form className="nhl-data__form" noValidate onSubmit={submit}>
      <div className="nhl-data__grid">
        {FIELDS.map((field) => (
          <div className="nhl-data__field" key={field.name}>
            <label htmlFor={`${id}-${field.name}`}>
              {field.label}
              {team.keptFields.includes(field.name) && <span className="nhl-data__pill">Kept</span>}
            </label>
            <input
              aria-invalid={Boolean(fieldErrors[field.name])}
              id={`${id}-${field.name}`}
              maxLength={field.maxLength}
              onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
              type="text"
              value={values[field.name]}
            />
            {fieldErrors[field.name] && <span className="nhl-data__field-error">{fieldErrors[field.name]}</span>}
          </div>
        ))}
        <div className="nhl-data__field">
          <label htmlFor={`${id}-abbreviation`}>Abbreviation</label>
          <input disabled id={`${id}-abbreviation`} type="text" value={team.abbreviation} />
          <span className="nhl-data__hint">Everything names the team by it, so it can’t be changed.</span>
        </div>
      </div>

      <label className="nhl-data__checkbox">
        <input checked={keep} onChange={(event) => setKeep(event.target.checked)} type="checkbox" />
        Keep my changes from the daily import (otherwise API Ninjas’ values come back tomorrow)
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
