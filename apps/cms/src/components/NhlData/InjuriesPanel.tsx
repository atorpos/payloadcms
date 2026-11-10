'use client'

import { Button, toast, useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

import type { InjuryInput, NhlPlayer, TeamInjuries } from '../../nhl/types'

import { formatMoney, INJURY_STATUSES, optionLabel } from '../../nhl/types'
import { NumberInput, TextInput } from './CareerInputs'
import { NhlSaveError, sendNhlChange } from './sendChange'

const EMPTY: InjuryInput = {
  capRoomAtPlacement: null,
  expectedReturn: null,
  injuredOn: null,
  injury: null,
  notes: null,
  placedOn: null,
  status: 'OUT',
}

/**
 * The team's injured players, from the research script's injury report (`python research_players.py injuries`) or
 * set here. Saving one sets his injury in the HockeyPoolCap API, which also puts him on (or takes him off) injured
 * reserve and works the team's cap out again: players on LTIR give it cap relief.
 */
export function InjuriesPanel({ injuries, roster }: { injuries: null | TeamInjuries; roster: NhlPlayer[] }) {
  const [editing, setEditing] = useState<null | number>(null)
  const [adding, setAdding] = useState<null | number>(null)

  if (!injuries) {
    return (
      <p className="nhl-data__empty">The HockeyPoolCap API doesn’t have injuries yet: deploy its latest version.</p>
    )
  }

  const injured = new Set(injuries.injuries.map((injury) => injury.playerId))
  const healthy = roster.filter((player) => !injured.has(player.id) && player.rosterStatus !== 'PROSPECT')

  return (
    <div className="nhl-data__injuries">
      <p className="nhl-data__hint">
        {injuries.reportedAt
          ? `Last injury report ${new Date(injuries.reportedAt).toUTCString()}${injuries.model ? `, by ${injuries.model}` : ''}. `
          : 'No injury report yet: run `python research_players.py injuries --team ' +
            injuries.team.abbreviation +
            '`. '}
        A change here lasts until the next report replaces it.
      </p>
      <p>
        On LTIR: <strong>{formatMoney(injuries.ltirCapHit)}</strong> · LTIR relief this season:{' '}
        <strong>{formatMoney(injuries.ltirRelief)}</strong>
      </p>
      {injuries.notes && <p className="nhl-data__hint">Notes from the report: {injuries.notes}</p>}
      {injuries.sources.length > 0 && (
        <details>
          <summary>Sources · {injuries.sources.length}</summary>
          <ul className="nhl-data__sources">
            {injuries.sources.map((source) => (
              <li key={source}>
                <a href={source} rel="noreferrer noopener" target="_blank">
                  {source}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      {injuries.injuries.length > 0 ? (
        <div className="nhl-data__table-wrap">
          <table className="nhl-data__table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Status</th>
                <th>Injury</th>
                <th>Hurt</th>
                <th>Placed</th>
                <th>Expected back</th>
                <th className="nhl-data__number">Cap space at placement</th>
                <th>From</th>
                <th>
                  <span className="nhl-data__sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {injuries.injuries.map((injury) =>
                editing === injury.playerId ? (
                  <tr key={injury.playerId}>
                    <td colSpan={9}>
                      <InjuryForm
                        initial={injury}
                        name={injury.fullName}
                        onDone={() => setEditing(null)}
                        playerId={injury.playerId}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={injury.playerId}>
                    <td>{injury.fullName}</td>
                    <td>
                      <span className={`nhl-data__status nhl-data__status--${injury.status.toLowerCase()}`}>
                        {optionLabel(INJURY_STATUSES, injury.status)}
                      </span>
                    </td>
                    <td>{injury.injury ?? '—'}</td>
                    <td>{injury.injuredOn ?? '—'}</td>
                    <td>{injury.placedOn ?? '—'}</td>
                    <td>{injury.expectedReturn ?? '—'}</td>
                    <td className="nhl-data__number">
                      {injury.status === 'LONG_TERM_INJURED_RESERVE'
                        ? injury.capRoomAtPlacement === null || injury.capRoomAtPlacement === undefined
                          ? 'Unknown'
                          : formatMoney(injury.capRoomAtPlacement)
                        : ''}
                    </td>
                    <td title={new Date(injury.updatedAt).toUTCString()}>
                      {injury.source === 'ADMIN' ? 'Edited here' : 'Report'}
                    </td>
                    <td className="nhl-data__row-actions">
                      <button
                        className="nhl-data__link-button"
                        onClick={() => setEditing(injury.playerId)}
                        type="button"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="nhl-data__empty">Nobody is hurt.</p>
      )}

      {adding !== null ? (
        <div className="nhl-data__stats-form">
          <InjuryForm
            initial={EMPTY}
            isNew
            name={healthy.find((player) => player.id === adding)?.fullName ?? ''}
            onDone={() => setAdding(null)}
            playerId={adding}
          />
        </div>
      ) : (
        healthy.length > 0 && (
          <div className="nhl-data__actions">
            <select
              aria-label="Player to add an injury for"
              defaultValue=""
              onChange={(event) => event.target.value && setAdding(Number(event.target.value))}
            >
              <option value="">Add an injury…</option>
              {healthy.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.fullName}
                </option>
              ))}
            </select>
          </div>
        )
      )}
    </div>
  )
}

/** One player's injury, to save, or to clear when he's healthy again */
function InjuryForm({
  initial,
  isNew = false,
  name,
  onDone,
  playerId,
}: {
  initial: InjuryInput
  isNew?: boolean
  name: string
  onDone: () => void
  playerId: number
}) {
  const {
    config: {
      routes: { api: apiRoute },
    },
  } = useConfig()
  const router = useRouter()
  const [injury, setInjury] = useState<InjuryInput>({
    capRoomAtPlacement: initial.capRoomAtPlacement ?? null,
    expectedReturn: initial.expectedReturn ?? null,
    injuredOn: initial.injuredOn ?? null,
    injury: initial.injury ?? null,
    notes: initial.notes ?? null,
    placedOn: initial.placedOn ?? null,
    status: initial.status,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const set = (patch: Partial<InjuryInput>) => setInjury({ ...injury, ...patch })
  const ltir = injury.status === 'LONG_TERM_INJURED_RESERVE'

  const send = async (method: 'DELETE' | 'PUT') => {
    setIsSaving(true)
    setErrors({})
    try {
      await sendNhlChange(apiRoute, `/players/${playerId}/injury`, method, method === 'PUT' ? injury : undefined)
      toast.success(method === 'PUT' ? `${name}: injury saved.` : `${name} is healthy again.`)
      onDone()
      router.refresh()
    } catch (error) {
      if (error instanceof NhlSaveError) {
        setErrors(error.fieldErrors)
      }
      toast.error((error as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form
      className="nhl-data__form"
      onSubmit={(event) => {
        event.preventDefault()
        void send('PUT')
      }}
    >
      <strong>{name}</strong>
      <div className="nhl-data__grid">
        <div className="nhl-data__field">
          <label htmlFor={`injury-status-${playerId}`}>Status</label>
          <select
            id={`injury-status-${playerId}`}
            onChange={(event) => set({ status: event.target.value as InjuryInput['status'] })}
            value={injury.status}
          >
            {INJURY_STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <Field error={errors.injury} label="Injury">
          <TextInput
            label="Injury"
            maxLength={200}
            onChange={(value) => set({ injury: value })}
            placeholder="e.g. Lower body"
            value={injury.injury}
          />
        </Field>
        <Field error={errors.injuredOn} label="Hurt on">
          <TextInput
            label="Hurt on"
            onChange={(value) => set({ injuredOn: value })}
            type="date"
            value={injury.injuredOn}
          />
        </Field>
        <Field error={errors.placedOn} label="Placed on IR / LTIR">
          <TextInput
            label="Placed on IR / LTIR"
            onChange={(value) => set({ placedOn: value })}
            type="date"
            value={injury.placedOn}
          />
        </Field>
        <Field error={errors.expectedReturn} label="Expected back">
          <TextInput
            label="Expected back"
            maxLength={100}
            onChange={(value) => set({ expectedReturn: value })}
            placeholder="e.g. Late December"
            value={injury.expectedReturn}
          />
        </Field>
        {ltir && (
          <Field error={errors.capRoomAtPlacement} label="Team’s cap space at placement">
            <NumberInput
              label="Team’s cap space at placement"
              onChange={(value) => set({ capRoomAtPlacement: value })}
              placeholder="Unknown: its cap space now"
              value={injury.capRoomAtPlacement}
            />
          </Field>
        )}
        <Field error={errors.notes} label="Notes" wide>
          <TextInput label="Notes" maxLength={1000} onChange={(value) => set({ notes: value })} value={injury.notes} />
        </Field>
      </div>
      {ltir && (
        <p className="nhl-data__hint">
          LTIR relief is his cap hit above the team’s cap space when he was put on LTIR. Leave it empty if you don’t
          know it: the team’s cap space now is used.
        </p>
      )}
      <div className="nhl-data__actions">
        <Button disabled={isSaving} type="submit">
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        {!isNew && (
          <Button buttonStyle="secondary" disabled={isSaving} onClick={() => void send('DELETE')}>
            He’s healthy
          </Button>
        )}
        <Button buttonStyle="secondary" disabled={isSaving} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

function Field({
  children,
  error,
  label,
  wide = false,
}: {
  children: React.ReactNode
  error?: string
  label: string
  wide?: boolean
}) {
  return (
    <div className={`nhl-data__field${wide ? ' nhl-data__field--wide' : ''}`}>
      <label>{label}</label>
      {children}
      {error && <p className="nhl-data__field-error">{error}</p>}
    </div>
  )
}
