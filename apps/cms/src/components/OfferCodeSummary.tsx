import type { BeforeListTableServerProps, Where } from 'payload'

import React from 'react'

import { availableWhere, OFFER_CODES, offerCodeApps } from '../offerCodes/offerCodes'

/** Above the list of offer codes: per app, how many are left and how fast they are going */
export async function OfferCodeSummary({ payload }: BeforeListTableServerProps) {
  const now = new Date()
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const count = (where: Where) =>
    payload
      .count({ collection: OFFER_CODES, overrideAccess: true, where })
      .then(({ totalDocs }) => totalDocs)

  const apps = await Promise.all(
    offerCodeApps.map(async (app) => {
      const ofApp = { app: { equals: app.value } }
      const [total, available, givenOut, lastDay] = await Promise.all([
        count(ofApp),
        count(availableWhere(app.value, now)),
        count({ and: [ofApp, { status: { equals: 'claimed' } }] }),
        count({
          and: [ofApp, { status: { equals: 'claimed' } }, { claimedAt: { greater_than: dayAgo } }],
        }),
      ])

      return { available, givenOut, label: app.label, lastDay, total }
    }),
  )

  const withCodes = apps.filter(({ total }) => total > 0)

  if (withCodes.length === 0) {
    return null
  }

  return (
    <div style={{ display: 'grid', gap: 'calc(var(--base) / 2)', marginBottom: 'var(--base)' }}>
      {withCodes.map(({ available, givenOut, label, lastDay, total }) => {
        const unusable = total - available - givenOut

        return (
          <p key={label} style={{ margin: 0 }}>
            <strong>{label}</strong>: {available} of {total} codes available, {givenOut} given out
            ({lastDay} in the last 24 hours)
            {unusable > 0 && `, ${unusable} disabled or expired`}
          </p>
        )
      })}
    </div>
  )
}
