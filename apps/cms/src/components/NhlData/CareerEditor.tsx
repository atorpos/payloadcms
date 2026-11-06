'use client'

import { Button, toast, useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

import type {
  Career,
  CareerContract,
  CareerResponse,
  CareerStatLine,
  CareerTransaction,
  ResearchStatus,
} from '../../nhl/types'

import { formatMoney, seasonLabel, TRANSACTION_TYPES } from '../../nhl/types'
import { LinesInput, NumberInput, RemoveButton, removeAt, replaceAt, TextInput } from './CareerInputs'
import { sendNhlChange } from './sendChange'

type Props = {
  /** The season the app is in now, e.g. 2026, for new rows */
  currentSeason: number
  initial: CareerResponse
  isGoalie: boolean
}

const CONTRACT_TYPES = [
  { label: 'Entry-level', value: 'ENTRY_LEVEL' },
  { label: 'Standard', value: 'STANDARD' },
  { label: '35+', value: 'THIRTY_FIVE_PLUS' },
] as const

/**
 * A player's whole researched career, to check and correct: bio details the import doesn't have, achievements,
 * transactions, contracts (with each season's pay and the teams that kept part of the cap hit) and stat lines. Saving
 * replaces all of it in the HockeyPoolCap API, and adds the stat lines up into his season stats again.
 */
export function CareerEditor({ currentSeason, initial, isGoalie }: Props) {
  const {
    config: {
      routes: { api: apiRoute },
    },
  } = useConfig()
  const router = useRouter()
  const [saved, setSaved] = useState(initial.career)
  const [career, setCareer] = useState(initial.career)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const changed = JSON.stringify(career) !== JSON.stringify(saved)
  const set = (patch: Partial<Career>) => setCareer({ ...career, ...patch })

  const save = async (researchStatus: null | ResearchStatus) => {
    const problem = check(career)
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    setIsSaving(true)
    try {
      const answer = await sendNhlChange<CareerResponse>(apiRoute, `/players/${initial.playerId}/career`, 'PUT', {
        ...career,
        researchStatus: researchStatus ?? career.researchStatus,
        stats: sortLines(career.stats),
      })
      if (answer) {
        setSaved(answer.career)
        setCareer(answer.career)
        setWarnings(answer.warnings)
      }
      toast.success(researchStatus === 'VERIFIED' ? `${initial.fullName}: saved and verified.` : 'Career saved.')
      router.refresh()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  const markNeedsReview = async () => {
    setIsSaving(true)
    try {
      await sendNhlChange(apiRoute, `/players/${initial.playerId}/career/status`, 'PUT', {
        researchStatus: 'NEEDS_REVIEW',
      })
      setSaved({ ...saved, researchStatus: 'NEEDS_REVIEW' })
      setCareer({ ...career, researchStatus: 'NEEDS_REVIEW' })
      router.refresh()
    } catch (caught) {
      toast.error((caught as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  const bio = career.bio ?? {
    birthCountry: null,
    birthDate: null,
    birthPlace: null,
    draft: null,
    heightCm: null,
    position: null,
    shootsCatches: null,
    weightKg: null,
  }

  return (
    <div className="nhl-data__career">
      <ResearchBar career={career} onNotes={(notes) => set({ notes })} />

      <details className="nhl-data__panel" open>
        <summary>Bio</summary>
        <p className="nhl-data__hint">
          Birth date, position, shoots and draft are changed in Details above; these are only kept here.
        </p>
        <div className="nhl-data__grid">
          <div className="nhl-data__field">
            <label>Birthplace</label>
            <TextInput
              label="Birthplace"
              maxLength={200}
              onChange={(birthPlace) => set({ bio: { ...bio, birthPlace } })}
              placeholder="London, ON, Canada"
              value={bio.birthPlace}
            />
          </div>
          <div className="nhl-data__field">
            <label>Height (cm)</label>
            <NumberInput label="Height (cm)" onChange={(heightCm) => set({ bio: { ...bio, heightCm } })} value={bio.heightCm} />
          </div>
          <div className="nhl-data__field">
            <label>Weight (kg)</label>
            <NumberInput label="Weight (kg)" onChange={(weightKg) => set({ bio: { ...bio, weightKg } })} value={bio.weightKg} />
          </div>
        </div>
      </details>

      <details className="nhl-data__panel" open>
        <summary>Achievements · {career.achievements.length}</summary>
        <div className="nhl-data__table-wrap">
          <table className="nhl-data__table nhl-data__table--edit">
            <thead>
              <tr>
                <th>Season</th>
                <th>Title</th>
                <th>Detail</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {career.achievements.map((achievement, index) => (
                <tr key={index}>
                  <td className="nhl-data__cell--season">
                    <NumberInput
                      label="Season"
                      onChange={(season) => set({ achievements: replaceAt(career.achievements, index, { season }) })}
                      placeholder="2021"
                      value={achievement.season}
                    />
                  </td>
                  <td>
                    <TextInput
                      label="Title"
                      maxLength={200}
                      onChange={(title) => set({ achievements: replaceAt(career.achievements, index, { title: title ?? '' }) })}
                      value={achievement.title}
                    />
                  </td>
                  <td>
                    <TextInput
                      label="Detail"
                      maxLength={500}
                      onChange={(detail) => set({ achievements: replaceAt(career.achievements, index, { detail }) })}
                      value={achievement.detail}
                    />
                  </td>
                  <td>
                    <RemoveButton label="Remove achievement" onClick={() => set({ achievements: removeAt(career.achievements, index) })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AddButton onClick={() => set({ achievements: [...career.achievements, { detail: null, season: null, title: '' }] })}>
          Add an achievement
        </AddButton>
      </details>

      <details className="nhl-data__panel" open>
        <summary>Transactions · {career.transactions.length}</summary>
        {career.transactions.map((transaction, index) => (
          <TransactionCard
            key={index}
            onChange={(patch) => set({ transactions: replaceAt(career.transactions, index, patch) })}
            onRemove={() => set({ transactions: removeAt(career.transactions, index) })}
            transaction={transaction}
          />
        ))}
        <AddButton
          onClick={() =>
            set({
              transactions: [
                ...career.transactions,
                {
                  acquired: [],
                  date: null,
                  fromTeam: null,
                  given: [],
                  notes: null,
                  retainedPercent: null,
                  season: currentSeason,
                  toTeam: null,
                  type: 'TRADE',
                },
              ],
            })
          }
        >
          Add a transaction
        </AddButton>
      </details>

      <details className="nhl-data__panel" open>
        <summary>Contracts · {career.contracts.length}</summary>
        <p className="nhl-data__hint">
          These count against his team’s cap. After changing them, recalculate the team’s cap on its page.
        </p>
        {career.contracts.map((contract, index) => (
          <ContractCard
            contract={contract}
            key={index}
            onChange={(patch) => set({ contracts: replaceAt(career.contracts, index, patch) })}
            onRemove={() => set({ contracts: removeAt(career.contracts, index) })}
          />
        ))}
        <AddButton
          onClick={() =>
            set({
              contracts: [
                ...career.contracts,
                {
                  capHit: 0,
                  clauses: null,
                  contractType: 'STANDARD',
                  description: null,
                  endSeason: currentSeason,
                  expiryStatus: null,
                  noMovementClause: false,
                  noTradeClause: false,
                  notes: null,
                  retentions: [],
                  signedOn: null,
                  signingTeam: null,
                  startSeason: currentSeason,
                  totalValue: null,
                  twoWay: false,
                  years: [],
                },
              ],
            })
          }
        >
          Add a contract
        </AddButton>
      </details>

      {(['REGULAR', 'PLAYOFFS'] as const).map((gameType) => (
        <details className="nhl-data__panel" key={gameType} open>
          <summary>
            {gameType === 'REGULAR' ? 'Regular season' : 'Playoffs'} ·{' '}
            {career.stats.filter((line) => line.gameType === gameType).length} lines
          </summary>
          {gameType === 'REGULAR' && (
            <p className="nhl-data__hint">
              One line per team per season. Saving adds a season’s lines up into his season stats, which the app’s top
              players and fantasy points use.
            </p>
          )}
          <StatLines
            currentSeason={currentSeason}
            gameType={gameType}
            isGoalie={isGoalie}
            lines={career.stats}
            onChange={(stats) => set({ stats })}
          />
        </details>
      ))}

      {warnings.length > 0 && (
        <div className="nhl-data__warnings" role="status">
          <strong>Saved, with what the API couldn’t use:</strong>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p className="nhl-data__form-error" role="alert">
          {error}
        </p>
      )}

      <div className="nhl-data__actions nhl-data__actions--sticky">
        <Button disabled={isSaving || !changed} onClick={() => save(null)}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        {career.researchStatus !== 'VERIFIED' ? (
          <Button buttonStyle="secondary" disabled={isSaving} onClick={() => save('VERIFIED')}>
            {changed ? 'Save and mark verified' : 'Mark verified'}
          </Button>
        ) : (
          <Button buttonStyle="secondary" disabled={isSaving} onClick={markNeedsReview}>
            Mark as needs review
          </Button>
        )}
        {changed && !isSaving && (
          <Button buttonStyle="secondary" onClick={() => setCareer(saved)}>
            Undo changes
          </Button>
        )}
      </div>
    </div>
  )
}

/** Where the career came from, and the notes for the reviewer */
function ResearchBar({ career, onNotes }: { career: Career; onNotes: (notes: null | string) => void }) {
  const status = career.researchStatus

  return (
    <div className="nhl-data__research">
      <p>
        <span className={`nhl-data__status nhl-data__status--${(status ?? 'none').toLowerCase()}`}>
          {status === 'VERIFIED' ? 'Verified' : status === 'NEEDS_REVIEW' ? 'Needs review' : 'Never researched'}
        </span>
        {career.researchedAt && <> Researched {new Date(career.researchedAt).toUTCString()}</>}
        {career.model && <> by {career.model}</>}
      </p>
      {career.sources.length > 0 && (
        <details>
          <summary>Sources · {career.sources.length}</summary>
          <ul className="nhl-data__sources">
            {career.sources.map((source) => (
              <li key={source}>
                <a href={source} rel="noreferrer" target="_blank">
                  {source}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="nhl-data__field">
        <label htmlFor="nhl-career-notes">Notes (what the research wasn’t sure of)</label>
        <textarea
          id="nhl-career-notes"
          maxLength={4000}
          onChange={(event) => onNotes(event.target.value || null)}
          rows={2}
          value={career.notes ?? ''}
        />
      </div>
    </div>
  )
}

function TransactionCard({
  onChange,
  onRemove,
  transaction,
}: {
  onChange: (patch: Partial<CareerTransaction>) => void
  onRemove: () => void
  transaction: CareerTransaction
}) {
  return (
    <div className="nhl-data__card">
      <div className="nhl-data__grid nhl-data__grid--dense">
        <div className="nhl-data__field">
          <label>Type</label>
          <select
            aria-label="Type"
            onChange={(event) => onChange({ type: event.target.value as CareerTransaction['type'] })}
            value={transaction.type}
          >
            {TRANSACTION_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="nhl-data__field">
          <label>Date</label>
          <TextInput label="Date" onChange={(date) => onChange({ date })} type="date" value={transaction.date} />
        </div>
        <div className="nhl-data__field">
          <label>Season</label>
          <NumberInput label="Season" onChange={(season) => onChange({ season })} value={transaction.season} />
        </div>
        <div className="nhl-data__field">
          <label>From</label>
          <TextInput label="From team" maxLength={50} onChange={(fromTeam) => onChange({ fromTeam })} placeholder="TOR" value={transaction.fromTeam} />
        </div>
        <div className="nhl-data__field">
          <label>To</label>
          <TextInput label="To team" maxLength={50} onChange={(toTeam) => onChange({ toTeam })} placeholder="COL" value={transaction.toTeam} />
        </div>
        <div className="nhl-data__field">
          <label>Retained %</label>
          <NumberInput decimal label="Retained percent" onChange={(retainedPercent) => onChange({ retainedPercent })} value={transaction.retainedPercent} />
        </div>
      </div>
      <div className="nhl-data__grid nhl-data__grid--wide">
        <div className="nhl-data__field">
          <label>His new team got (one per line)</label>
          <LinesInput label="Acquired" onChange={(acquired) => onChange({ acquired })} value={transaction.acquired} />
        </div>
        <div className="nhl-data__field">
          <label>It gave up (one per line)</label>
          <LinesInput label="Given" onChange={(given) => onChange({ given })} value={transaction.given} />
        </div>
        <div className="nhl-data__field">
          <label>Notes</label>
          <TextInput label="Notes" maxLength={1000} onChange={(notes) => onChange({ notes })} value={transaction.notes} />
        </div>
      </div>
      <RemoveButton label="Remove transaction" onClick={onRemove} />
    </div>
  )
}

function ContractCard({
  contract,
  onChange,
  onRemove,
}: {
  contract: CareerContract
  onChange: (patch: Partial<CareerContract>) => void
  onRemove: () => void
}) {
  const fillYears = () => {
    const existing = new Map(contract.years.map((year) => [year.season, year]))
    const years = []
    for (let season = contract.startSeason; season <= contract.endSeason; season++) {
      years.push(
        existing.get(season) ?? { baseSalary: null, clause: null, performanceBonus: null, season, signingBonus: null },
      )
    }
    onChange({ years })
  }

  const carried =
    contract.capHit * (1 - contract.retentions.reduce((total, retention) => total + retention.percent, 0) / 100)

  return (
    <div className="nhl-data__card">
      <h3>
        {seasonLabel(contract.startSeason)} to {seasonLabel(contract.endSeason)} · {formatMoney(contract.capHit)} cap hit
        {contract.retentions.length > 0 && <> · {formatMoney(Math.round(carried))} carried by his team</>}
      </h3>
      <div className="nhl-data__grid nhl-data__grid--dense">
        <div className="nhl-data__field">
          <label>Type</label>
          <select
            aria-label="Contract type"
            onChange={(event) => onChange({ contractType: event.target.value as CareerContract['contractType'] })}
            value={contract.contractType}
          >
            {CONTRACT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="nhl-data__field">
          <label>First season</label>
          <NumberInput label="First season" onChange={(startSeason) => onChange({ startSeason: startSeason ?? 0 })} value={contract.startSeason} />
        </div>
        <div className="nhl-data__field">
          <label>Last season</label>
          <NumberInput label="Last season" onChange={(endSeason) => onChange({ endSeason: endSeason ?? 0 })} value={contract.endSeason} />
        </div>
        <div className="nhl-data__field">
          <label>Cap hit ($)</label>
          <NumberInput label="Cap hit" onChange={(capHit) => onChange({ capHit: capHit ?? 0 })} value={contract.capHit} />
        </div>
        <div className="nhl-data__field">
          <label>Total value ($)</label>
          <NumberInput label="Total value" onChange={(totalValue) => onChange({ totalValue })} value={contract.totalValue} />
        </div>
        <div className="nhl-data__field">
          <label>Then</label>
          <select
            aria-label="Expiry status"
            onChange={(event) => onChange({ expiryStatus: (event.target.value || null) as CareerContract['expiryStatus'] })}
            value={contract.expiryStatus ?? ''}
          >
            <option value="">—</option>
            <option value="UFA">UFA</option>
            <option value="RFA">RFA</option>
          </select>
        </div>
        <div className="nhl-data__field">
          <label>Signing team</label>
          <TextInput label="Signing team" maxLength={5} onChange={(signingTeam) => onChange({ signingTeam })} placeholder="CGY" value={contract.signingTeam} />
        </div>
        <div className="nhl-data__field">
          <label>Signed on</label>
          <TextInput label="Signed on" onChange={(signedOn) => onChange({ signedOn })} type="date" value={contract.signedOn} />
        </div>
      </div>
      <div className="nhl-data__checks">
        <label className="nhl-data__checkbox">
          <input checked={Boolean(contract.noMovementClause)} onChange={(event) => onChange({ noMovementClause: event.target.checked })} type="checkbox" />
          No-movement clause
        </label>
        <label className="nhl-data__checkbox">
          <input checked={Boolean(contract.noTradeClause)} onChange={(event) => onChange({ noTradeClause: event.target.checked })} type="checkbox" />
          No-trade clause
        </label>
        <label className="nhl-data__checkbox">
          <input checked={Boolean(contract.twoWay)} onChange={(event) => onChange({ twoWay: event.target.checked })} type="checkbox" />
          Two-way
        </label>
      </div>
      <div className="nhl-data__grid nhl-data__grid--wide">
        <div className="nhl-data__field">
          <label>Description</label>
          <TextInput label="Description" maxLength={200} onChange={(description) => onChange({ description })} value={contract.description} />
        </div>
        <div className="nhl-data__field">
          <label>Clauses</label>
          <TextInput label="Clauses" maxLength={1000} onChange={(clauses) => onChange({ clauses })} value={contract.clauses} />
        </div>
        <div className="nhl-data__field">
          <label>Notes</label>
          <TextInput label="Notes" maxLength={1000} onChange={(notes) => onChange({ notes })} value={contract.notes} />
        </div>
      </div>

      <h4>Each season</h4>
      <div className="nhl-data__table-wrap">
        <table className="nhl-data__table nhl-data__table--edit">
          <thead>
            <tr>
              <th>Season</th>
              <th>Base salary ($)</th>
              <th>Signing bonus ($)</th>
              <th>Max performance bonus ($)</th>
              <th>Clause</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {contract.years.map((year, index) => (
              <tr key={index}>
                <td className="nhl-data__cell--season">
                  <NumberInput label="Season" onChange={(season) => onChange({ years: replaceAt(contract.years, index, { season: season ?? 0 }) })} value={year.season} />
                </td>
                <td>
                  <NumberInput label="Base salary" onChange={(baseSalary) => onChange({ years: replaceAt(contract.years, index, { baseSalary }) })} value={year.baseSalary} />
                </td>
                <td>
                  <NumberInput label="Signing bonus" onChange={(signingBonus) => onChange({ years: replaceAt(contract.years, index, { signingBonus }) })} value={year.signingBonus} />
                </td>
                <td>
                  <NumberInput label="Performance bonus" onChange={(performanceBonus) => onChange({ years: replaceAt(contract.years, index, { performanceBonus }) })} value={year.performanceBonus} />
                </td>
                <td>
                  <TextInput label="Clause" maxLength={100} onChange={(clause) => onChange({ years: replaceAt(contract.years, index, { clause }) })} placeholder="NMC" value={year.clause} />
                </td>
                <td>
                  <RemoveButton label="Remove season" onClick={() => onChange({ years: removeAt(contract.years, index) })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddButton onClick={fillYears}>Add the seasons it covers</AddButton>

      <h4>Retained by</h4>
      {contract.retentions.map((retention, index) => (
        <div className="nhl-data__inline" key={index}>
          <TextInput
            label="Retaining team"
            maxLength={5}
            onChange={(team) => onChange({ retentions: replaceAt(contract.retentions, index, { team: (team ?? '').toUpperCase() }) })}
            placeholder="CGY"
            value={retention.team}
          />
          <NumberInput
            decimal
            label="Retained percent"
            onChange={(percent) => onChange({ retentions: replaceAt(contract.retentions, index, { percent: percent ?? 0 }) })}
            placeholder="20"
            value={retention.percent}
          />
          <span>%</span>
          <RemoveButton label="Remove retention" onClick={() => onChange({ retentions: removeAt(contract.retentions, index) })} />
        </div>
      ))}
      {contract.retentions.length < 2 && (
        <AddButton onClick={() => onChange({ retentions: [...contract.retentions, { percent: 0, team: '' }] })}>
          Add a team that kept part of it
        </AddButton>
      )}
      <div>
        <RemoveButton label="Remove contract" onClick={onRemove} />
      </div>
    </div>
  )
}

const SKATER_COLUMNS = [
  { label: 'G', name: 'goals' },
  { label: 'A', name: 'assists' },
  { label: 'PTS', name: 'points' },
  { label: '+/-', name: 'plusMinus' },
  { label: 'PIM', name: 'penaltyMinutes' },
] as const

const GOALIE_COLUMNS = [
  { label: 'W', name: 'wins' },
  { label: 'L', name: 'losses' },
  { label: 'OTL', name: 'overtimeLosses' },
  { label: 'SO', name: 'shutouts' },
  { decimal: true, label: 'GAA', name: 'goalsAgainstAverage' },
  { decimal: true, label: 'SV%', name: 'savePercentage' },
] as const

/** One game type's lines; the others pass through unchanged */
function StatLines({
  currentSeason,
  gameType,
  isGoalie,
  lines,
  onChange,
}: {
  currentSeason: number
  gameType: CareerStatLine['gameType']
  isGoalie: boolean
  lines: CareerStatLine[]
  onChange: (lines: CareerStatLine[]) => void
}) {
  const columns = isGoalie ? GOALIE_COLUMNS : SKATER_COLUMNS
  const shown = lines.map((line, index) => ({ index, line })).filter(({ line }) => line.gameType === gameType)
  const last = shown.at(-1)?.line

  return (
    <>
      <div className="nhl-data__table-wrap">
        <table className="nhl-data__table nhl-data__table--edit">
          <thead>
            <tr>
              <th>Season</th>
              <th>Team</th>
              <th>Age</th>
              <th>GP</th>
              {columns.map((column) => (
                <th key={column.name}>{column.label}</th>
              ))}
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map(({ index, line }) => (
              <tr key={index}>
                <td className="nhl-data__cell--season">
                  <NumberInput label="Season" onChange={(season) => onChange(replaceAt(lines, index, { season: season ?? 0 }))} value={line.season} />
                  <span className="nhl-data__hint">{line.season ? seasonLabel(line.season) : ''}</span>
                </td>
                <td className="nhl-data__cell--team">
                  <TextInput label="Team" maxLength={50} onChange={(team) => onChange(replaceAt(lines, index, { team: (team ?? '').toUpperCase() }))} value={line.team} />
                </td>
                <td className="nhl-data__cell--small">
                  <NumberInput label="Age" onChange={(age) => onChange(replaceAt(lines, index, { age }))} value={line.age} />
                </td>
                <td className="nhl-data__cell--small">
                  <NumberInput label="Games played" onChange={(gamesPlayed) => onChange(replaceAt(lines, index, { gamesPlayed: gamesPlayed ?? 0 }))} value={line.gamesPlayed} />
                </td>
                {columns.map((column) => (
                  <td className="nhl-data__cell--small" key={column.name}>
                    <NumberInput
                      decimal={'decimal' in column}
                      label={column.label}
                      onChange={(value) => onChange(replaceAt(lines, index, { [column.name]: value }))}
                      value={line[column.name]}
                    />
                  </td>
                ))}
                <td>
                  <TextInput label="Note" maxLength={300} onChange={(note) => onChange(replaceAt(lines, index, { note }))} value={line.note} />
                </td>
                <td>
                  <RemoveButton label="Remove line" onClick={() => onChange(removeAt(lines, index))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddButton
        onClick={() =>
          onChange([
            ...lines,
            {
              age: last?.age ? last.age + 1 : null,
              assists: null,
              gamesPlayed: 0,
              gameType,
              goals: null,
              goalsAgainstAverage: null,
              losses: null,
              note: null,
              overtimeLosses: null,
              penaltyMinutes: null,
              plusMinus: null,
              points: null,
              savePercentage: null,
              season: last ? last.season + 1 : currentSeason,
              shutouts: null,
              team: last?.team ?? '',
              wins: null,
            },
          ])
        }
      >
        Add a line
      </AddButton>
    </>
  )
}

function AddButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button className="nhl-data__link-button nhl-data__add" onClick={onClick} type="button">
      + {children}
    </button>
  )
}

/** Regular season first, then playoffs, each by season, as the API keeps them */
const sortLines = (lines: CareerStatLine[]) =>
  [...lines].sort(
    (a, b) => (a.gameType === b.gameType ? 0 : a.gameType === 'REGULAR' ? -1 : 1) || a.season - b.season,
  )

/** What the API would refuse, said plainly; null when it looks right */
const check = (career: Career): null | string => {
  for (const contract of career.contracts) {
    const which = `The contract from ${seasonLabel(contract.startSeason)}`
    if (!contract.capHit || contract.capHit <= 0) return `${which} needs a cap hit.`
    if (contract.endSeason < contract.startSeason) return `${which} ends before it starts.`
    if (contract.retentions.some((retention) => !retention.team || retention.percent <= 0 || retention.percent > 50)) {
      return `${which}: each retention needs a team and a percentage up to 50.`
    }
  }
  if (career.achievements.some((achievement) => !achievement.title.trim())) return 'Each achievement needs a title.'
  if (career.stats.some((line) => !line.team.trim() || !line.season)) return 'Each stat line needs a season and a team.'
  return null
}
