import type { AdminViewServerProps } from 'payload'

import React from 'react'

import type { BroadcastPreview, TradeDetail } from '../../nhl/trades'

import { errorMessage, hockeyApi } from '../../nhl/hockeyApi'
import { duration, money, TRADE_STATUS_LABELS } from '../../nhl/trades'
import { NhlLoadError, NhlPage, nhlURL, segments } from './NhlPage'
import { AssetSettleForm, NotificationControls, TradeControls } from './TradeActions'

/**
 * `/admin/nhl/trades/:id`: one trade: what moved and how sure each detail is, each stage and how long it took from the
 * announcement, each team's cap before and after, its official sources, its notifications (with the broadcast
 * preview to approve them) and its full history. Settle what the pipeline couldn't, reprocess, or revert it here.
 */
export async function NhlTradeView(props: AdminViewServerProps) {
  const id = Number(segments(props)[2])
  let trade: null | TradeDetail = null
  let preview: BroadcastPreview | null = null
  let error: null | string = null
  try {
    ;[trade, preview] = await Promise.all([
      hockeyApi<TradeDetail>(`/api/v1/admin/trades/${id}`),
      hockeyApi<BroadcastPreview>(`/api/v1/admin/trades/${id}/broadcast-preview`),
    ])
  } catch (caught) {
    error = errorMessage(caught)
  }
  const breadcrumbs = [{ href: nhlURL(props, '/trades'), label: 'Trades' }]

  if (error || !trade || !preview) {
    return (
      <NhlPage breadcrumbs={breadcrumbs} props={props} title={`Trade ${id}`}>
        <NhlLoadError message={error ?? 'Not found.'} what="The trade" />
      </NhlPage>
    )
  }
  const findings = trade.findings ? trade.findings.split('\n') : []
  const cap = trade.cap.filter((row) => row.phase === 'AFTER')

  return (
    <NhlPage
      breadcrumbs={breadcrumbs}
      description={trade.summary}
      props={props}
      title={trade.trade.headline}
    >
      <section className="nhl-data__section">
        <p>
          <span className={`nhl-data__status nhl-data__status--${trade.trade.status.toLowerCase()}`}>
            {TRADE_STATUS_LABELS[trade.trade.status]}
          </span>{' '}
          Made on {trade.trade.madeOn}
          {trade.effectiveOn ? `, effective ${trade.effectiveOn}` : ''} · {trade.trade.origin === 'TRACKER'
            ? 'from the NHL’s trade tracker'
            : 'entered by an admin'} · correlation ID <code>{trade.trade.correlationId}</code>
        </p>
        {trade.trade.reviewReason && (
          <div className="nhl-data__error" role="alert">
            <strong>Needs review:</strong>
            <ul>
              {trade.trade.reviewReason.split('\n').map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
        {trade.trade.lastError && (
          <p className="nhl-data__hint">
            Last try ({trade.trade.attempts}) failed: {trade.trade.lastError}
            {trade.trade.nextAttemptAt ? ` · next try ${new Date(trade.trade.nextAttemptAt).toLocaleString()}` : ''}
          </p>
        )}
        <TradeControls id={trade.trade.id} status={trade.trade.status} />
      </section>

      <section className="nhl-data__section">
        <h2>Assets</h2>
        <table className="nhl-data__table">
          <thead>
            <tr>
              <th>From → to</th>
              <th>Asset</th>
              <th>Details</th>
              <th>Confidence</th>
              <th>Applied</th>
            </tr>
          </thead>
          <tbody>
            {trade.assets.map((asset) => (
              <tr key={asset.id}>
                <td>
                  {asset.from} → {asset.to}
                </td>
                <td>{asset.description}</td>
                <td>
                  {asset.playerId ? (
                    <a href={nhlURL(props, `/players/${asset.playerId}`)}>{asset.playerName ?? asset.playerId}</a>
                  ) : (
                    (asset.playerNhlId && `NHL ID ${asset.playerNhlId}`) || ''
                  )}
                  {asset.pickYear
                    ? `${asset.pickYear} round ${asset.pickRound}, ${asset.pickOriginalTeam ?? '?'}’s`
                    : ''}
                  {asset.conditions ? <p className="nhl-data__hint">Conditions: {asset.conditions}</p> : null}
                  {asset.conditional && !asset.conditions ? (
                    <p className="nhl-data__hint">Conditional: conditions not recorded</p>
                  ) : null}
                  {asset.retainedPercent !== null ? <p>{asset.retainedPercent}% retained</p> : null}
                  {asset.notes ? <p className="nhl-data__hint">{asset.notes}</p> : null}
                  {asset.confidence !== 'CONFIRMED' && !asset.applied ? (
                    <AssetSettleForm asset={asset} tradeId={trade.trade.id} />
                  ) : null}
                </td>
                <td>{asset.confidence}</td>
                <td>{asset.applied ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="nhl-data__section">
        <h2>Stages</h2>
        <table className="nhl-data__table">
          <thead>
            <tr>
              <th>Stage</th>
              <th>At</th>
              <th>From the announcement</th>
            </tr>
          </thead>
          <tbody>
            {trade.stages.map((stage) => (
              <tr key={stage.stage}>
                <td>{stage.stage}</td>
                <td>{new Date(stage.at).toLocaleString()}</td>
                <td>{duration(stage.secondsFromAnnouncement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="nhl-data__section">
        <h2>Cap, calculated by HockeyPoolCap</h2>
        <table className="nhl-data__table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Season</th>
              <th>Cap hit before → after</th>
              <th>Space before → after</th>
              <th>LTIR relief</th>
              <th>Contracts</th>
              <th>Reported space</th>
            </tr>
          </thead>
          <tbody>
            {cap.map((after) => {
              const before = trade.cap.find(
                (row) => row.phase === 'BEFORE' && row.team === after.team && row.season === after.season,
              )
              return (
                <tr key={after.id}>
                  <td>{after.team}</td>
                  <td>{after.season}</td>
                  <td>
                    {money(before?.capHit)} → {money(after.capHit)}
                  </td>
                  <td>
                    {money(before?.capSpace)} → {money(after.capSpace)}
                  </td>
                  <td>{money(after.ltirRelief)}</td>
                  <td>{after.contracts}</td>
                  <td>{money(after.reportedCapSpace)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {findings.length > 0 && (
          <ul>
            {findings.map((finding) => (
              <li key={finding}>{finding}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="nhl-data__section">
        <h2>Official sources</h2>
        <ul>
          {trade.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} rel="noreferrer" target="_blank">
                {source.title ?? source.url}
              </a>{' '}
              ({source.publisher}
              {source.publishedAt ? `, ${new Date(source.publishedAt).toLocaleString()}` : ''})
            </li>
          ))}
        </ul>
      </section>

      <section className="nhl-data__section">
        <h2>Notifications</h2>
        <p className="nhl-data__hint">
          Article: {preview.article ? `${preview.article.status} (Trade Articles)` : 'not written yet'} · data:{' '}
          {preview.verification} · {preview.registeredDevices} phones registered. Send a test to one phone first;
          approve only when the article is published and the data is right. Never during development or testing.
        </p>
        <NotificationControls preview={preview} tradeId={trade.trade.id} />
      </section>

      <section className="nhl-data__section">
        <h2>History</h2>
        <table className="nhl-data__table">
          <tbody>
            {trade.history.map((event, index) => (
              <tr key={index}>
                <td>{new Date(event.at).toLocaleString()}</td>
                <td>{event.level}</td>
                <td>{event.status}</td>
                <td>{event.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </NhlPage>
  )
}
