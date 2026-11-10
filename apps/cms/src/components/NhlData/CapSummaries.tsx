'use client'

import { Button, toast, useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

import type { TeamCapSummary } from '../../nhl/types'

import { formatMoney } from '../../nhl/types'
import { sendNhlChange } from './sendChange'

/** The team's cap this season and next as last calculated and stored, and a button to work it out again */
export function CapSummaries({ abbreviation, summaries }: { abbreviation: string; summaries: TeamCapSummary[] }) {
  const {
    config: {
      routes: { api: apiRoute },
    },
  } = useConfig()
  const router = useRouter()
  const [isWorking, setIsWorking] = useState(false)

  const recalculate = async () => {
    setIsWorking(true)
    try {
      await sendNhlChange(apiRoute, `/teams/${abbreviation}/cap-summaries`, 'POST')
      toast.success('Cap worked out again.')
      router.refresh()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <>
      {summaries.length > 0 ? (
        <div className="nhl-data__table-wrap">
          <table className="nhl-data__table">
            <thead>
              <tr>
                <th>Season</th>
                <th className="nhl-data__number">Ceiling</th>
                <th className="nhl-data__number">Cap hit</th>
                <th className="nhl-data__number">Cap space</th>
                <th className="nhl-data__number">On LTIR</th>
                <th className="nhl-data__number">LTIR relief</th>
                <th className="nhl-data__number">Cap space with LTIR</th>
                <th className="nhl-data__number">Contracts</th>
                <th>Calculated</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((summary) => (
                <tr key={summary.season}>
                  <td>{summary.seasonLabel}</td>
                  <td className="nhl-data__number">{formatMoney(summary.capUpperLimit)}</td>
                  <td className="nhl-data__number">{formatMoney(summary.capHit)}</td>
                  <td
                    className={`nhl-data__number${(summary.capSpace ?? 0) < 0 ? ' nhl-data__over' : ''}`}
                  >
                    {formatMoney(summary.capSpace)}
                  </td>
                  <td className="nhl-data__number">{formatMoney(summary.ltirCapHit)}</td>
                  <td className="nhl-data__number">{formatMoney(summary.ltirRelief)}</td>
                  <td
                    className={`nhl-data__number${(summary.capSpaceWithLtir ?? 0) < 0 ? ' nhl-data__over' : ''}`}
                  >
                    {formatMoney(summary.capSpaceWithLtir)}
                  </td>
                  <td className="nhl-data__number">
                    {summary.contracts} / {summary.contractLimit}
                  </td>
                  <td>{new Date(summary.calculatedAt).toUTCString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="nhl-data__empty">Not calculated yet.</p>
      )}
      <div className="nhl-data__actions">
        <Button buttonStyle="secondary" disabled={isWorking} onClick={recalculate}>
          {isWorking ? 'Working it out…' : 'Recalculate this season and next'}
        </Button>
      </div>
    </>
  )
}
