import type { AdminViewServerProps } from 'payload'

import React from 'react'

import type { TradeSummary } from '../../nhl/trades'

import { errorMessage, hockeyApi } from '../../nhl/hockeyApi'
import { TRADE_STATUS_LABELS } from '../../nhl/trades'
import { NhlLoadError, NhlPage, nhlURL } from './NhlPage'
import { DetectButton } from './TradeActions'

type TrackerPoll = { changed_at?: string; entries?: number; last_error?: string; polled_at?: string }

/**
 * `/admin/nhl/trades`: every NHL trade the HockeyPoolCap API found in the league's trade tracker, or an admin entered,
 * with where it is on its way to the app (detected, verified, applied, cap checked, article, published, notified),
 * why one waits, and how many times a stage was tried.
 */
export async function NhlTradesView(props: AdminViewServerProps) {
  let trades: TradeSummary[] = []
  let tracker: TrackerPoll = {}
  let error: null | string = null
  try {
    const [list, status] = await Promise.all([
      hockeyApi<TradeSummary[]>('/api/v1/admin/trades?limit=100'),
      hockeyApi<{ tracker: TrackerPoll }>('/api/v1/admin/trades/status'),
    ])
    trades = list
    tracker = status.tracker ?? {}
  } catch (caught) {
    error = errorMessage(caught)
  }

  return (
    <NhlPage
      description="Trades from the NHL’s official trade tracker, read every five minutes. Each is verified against the official announcements, applied to the players, picks and caps, written up as an article for an editor to publish, and notified to the app’s users only once you approve it."
      props={props}
      title="Trades"
    >
      {error ? (
        <NhlLoadError message={error} what="The trades" />
      ) : (
        <>
          <section className="nhl-data__section">
            <p className="nhl-data__hint">
              Tracker last read: {tracker.polled_at ? new Date(tracker.polled_at).toLocaleString() : 'never'}
              {tracker.changed_at ? ` · last changed ${new Date(tracker.changed_at).toLocaleString()}` : ''}
              {typeof tracker.entries === 'number' ? ` · ${tracker.entries} trades listed` : ''}
              {tracker.last_error ? ` · last problem: ${tracker.last_error}` : ''}
            </p>
            <DetectButton />
          </section>
          {trades.length === 0 ? (
            <p className="nhl-data__empty">No trades yet.</p>
          ) : (
            <table className="nhl-data__table">
              <thead>
                <tr>
                  <th>Made on</th>
                  <th>Trade</th>
                  <th>Teams</th>
                  <th>Status</th>
                  <th>Waiting for</th>
                  <th>Article</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade) => (
                  <tr key={trade.id}>
                    <td>{trade.madeOn}</td>
                    <td>
                      <a href={nhlURL(props, `/trades/${trade.id}`)}>{trade.headline}</a>
                    </td>
                    <td>{trade.teams.join(', ')}</td>
                    <td>
                      <span className={`nhl-data__status nhl-data__status--${trade.status.toLowerCase()}`}>
                        {TRADE_STATUS_LABELS[trade.status]}
                      </span>
                    </td>
                    <td>
                      {trade.reviewReason?.split('\n')[0] ??
                        (trade.nextAttemptAt && trade.attempts > 0
                          ? `Try ${trade.attempts + 1} at ${new Date(trade.nextAttemptAt).toLocaleTimeString()}: ${trade.lastError ?? ''}`
                          : '')}
                    </td>
                    <td>{trade.articleStatus ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </NhlPage>
  )
}
