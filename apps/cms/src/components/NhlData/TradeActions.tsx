'use client'

import { Button, toast, useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

import type { BroadcastPreview, TradeAsset, TradeStatus } from '../../nhl/trades'

import { AUDIENCE_LABELS } from '../../nhl/trades'
import { sendNhlChange } from './sendChange'

/** Runs a change against /api/nhl-data/trades/…, says how it went, and reloads the screen */
const useTradeChange = () => {
  const {
    config: {
      routes: { api: apiRoute },
    },
  } = useConfig()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const run = async (path: string, method: 'DELETE' | 'PATCH' | 'POST', body: object, done: string) => {
    setBusy(true)
    try {
      await sendNhlChange(apiRoute, `/trades${path}`, method, body)
      toast.success(done)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'It didn’t work.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

export function DetectButton() {
  const { busy, run } = useTradeChange()
  return (
    <Button buttonStyle="secondary" disabled={busy} onClick={() => run('/detect', 'POST', {}, 'The tracker was read.')}>
      Read the tracker now
    </Button>
  )
}

/** Reprocess, revert, delete */
export function TradeControls({ id, status }: { id: number; status: TradeStatus }) {
  const { busy, run } = useTradeChange()
  const applied = !['DETECTED', 'FAILED', 'NEEDS_REVIEW', 'REVERTED', 'VERIFIED'].includes(status)
  return (
    <div className="nhl-data__actions">
      {(status === 'NEEDS_REVIEW' || status === 'FAILED' || status === 'REVERTED') && (
        <Button disabled={busy} onClick={() => run(`/${id}/reprocess`, 'POST', {}, 'On its way again.')}>
          Reprocess
        </Button>
      )}
      <Button
        buttonStyle="secondary"
        disabled={busy || status === 'REVERTED'}
        onClick={() => {
          if (window.confirm('Put the players, picks and retained salary back as they were before this trade?')) {
            void run(`/${id}/revert`, 'POST', {}, 'Reverted.')
          }
        }}
      >
        Revert
      </Button>
      {!applied && (
        <Button
          buttonStyle="secondary"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Delete this trade? It changed nothing here.')) {
              void run(`/${id}`, 'DELETE', {}, 'Deleted.')
            }
          }}
        >
          Delete
        </Button>
      )}
    </div>
  )
}

/** What an editor found in the official sources for an asset the pipeline couldn't settle */
export function AssetSettleForm({ asset, tradeId }: { asset: TradeAsset; tradeId: number }) {
  const { busy, run } = useTradeChange()
  const [value, setValue] = useState('')
  const [conditions, setConditions] = useState(asset.conditions ?? '')
  const isPick = asset.type === 'DRAFT_PICK'
  return (
    <form
      className="nhl-data__inline"
      onSubmit={(event) => {
        event.preventDefault()
        const body = isPick
          ? { conditions: conditions.trim() || undefined, pickOriginalTeam: value.trim().toUpperCase() || undefined }
          : { playerNhlId: Number(value) || undefined }
        void run(`/${tradeId}/assets/${asset.id}`, 'PATCH', body, 'Settled: reprocess the trade when all are.')
      }}
    >
      <input
        aria-label={isPick ? 'Original team, e.g. MTL' : 'The player’s NHL ID'}
        onChange={(event) => setValue(event.target.value)}
        placeholder={isPick ? 'Original team, e.g. MTL' : 'NHL ID, e.g. 8477946'}
        value={value}
      />
      {isPick && asset.conditional && (
        <textarea
          aria-label="Conditions, as officially written"
          onChange={(event) => setConditions(event.target.value)}
          placeholder="Conditions, as officially written"
          value={conditions}
        />
      )}
      <Button buttonStyle="secondary" disabled={busy || (!value && !conditions)} type="submit">
        Settle
      </Button>
    </form>
  )
}

/** The broadcast preview, a one-phone test, and approving or cancelling each audience */
export function NotificationControls({ preview, tradeId }: { preview: BroadcastPreview; tradeId: number }) {
  const { busy, run } = useTradeChange()
  const [device, setDevice] = useState('')
  if (preview.notifications.length === 0) {
    return <p>Made once the article is published.</p>
  }
  return (
    <>
      <form
        className="nhl-data__inline"
        onSubmit={(event) => {
          event.preventDefault()
          void run(
            `/${tradeId}/notifications/test`,
            'POST',
            /^\d+$/.test(device.trim()) ? { deviceId: Number(device.trim()) } : { token: device.trim() },
            'Test sent to one phone: check it arrives and opens the trade.',
          )
        }}
      >
        <input
          aria-label="A phone’s device ID or installation ID"
          onChange={(event) => setDevice(event.target.value)}
          placeholder="Test phone: device ID or installation ID"
          value={device}
        />
        <Button buttonStyle="secondary" disabled={busy || !device.trim()} type="submit">
          Send a test
        </Button>
      </form>
      <table className="nhl-data__table">
        <thead>
          <tr>
            <th>Audience</th>
            <th>Text</th>
            <th>Phones now</th>
            <th>Status</th>
            <th>Result</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {preview.notifications.map((notification) => (
            <tr key={notification.id}>
              <td>{AUDIENCE_LABELS[notification.audience] ?? notification.audience}</td>
              <td>
                <strong>{notification.title}</strong>
                <br />
                {notification.body}
              </td>
              <td>{preview.recipients[notification.audience] ?? 0}</td>
              <td>
                {notification.status}
                {notification.approvedBy ? ` by ${notification.approvedBy}` : ''}
              </td>
              <td>
                {notification.status === 'SENT'
                  ? `${notification.attempted} attempted, ${notification.accepted} accepted by Firebase, ${notification.failed} failed, ${notification.rejected} rejected, ${notification.invalid} invalid`
                  : (notification.lastError ?? '')}
              </td>
              <td>
                {notification.status === 'AWAITING_APPROVAL' && (
                  <Button
                    disabled={busy || preview.article?.status !== 'published'}
                    onClick={() => {
                      const phones = preview.recipients[notification.audience] ?? 0
                      if (window.confirm(`Send “${notification.title}” to ${phones} phone(s) now? This can’t be undone.`)) {
                        void run(`/${tradeId}/notifications/${notification.audience}/approve`, 'POST', {}, 'Approved: it goes out within a minute.')
                      }
                    }}
                  >
                    Approve
                  </Button>
                )}
                {(notification.status === 'AWAITING_APPROVAL' || notification.status === 'APPROVED') && (
                  <Button
                    buttonStyle="secondary"
                    disabled={busy}
                    onClick={() => run(`/${tradeId}/notifications/${notification.audience}/cancel`, 'POST', {}, 'Cancelled.')}
                  >
                    Cancel
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
