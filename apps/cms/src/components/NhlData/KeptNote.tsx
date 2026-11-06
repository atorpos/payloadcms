'use client'

import { Button, toast, useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

import { sendNhlChange } from './sendChange'

type Props = {
  /** The fields the import keeps, by their API name */
  kept: string[]
  /** API name → label, e.g. jerseyNumber → Number */
  labels: Record<string, string>
  /** e.g. `/teams/COL`, for `PATCH /api/nhl-data/teams/COL` */
  path: string
}

/** Which fields the daily import leaves as they were set here, and a way to let it update them again */
export function KeptNote({ kept, labels, path }: Props) {
  const {
    config: {
      routes: { api: apiRoute },
    },
  } = useConfig()
  const router = useRouter()
  const [isSaving, setIsSaving] = useState(false)

  if (kept.length === 0) {
    return (
      <p className="nhl-data__kept">The daily import from API Ninjas updates every field it has.</p>
    )
  }

  const release = async () => {
    setIsSaving(true)

    try {
      await sendNhlChange(apiRoute, path, 'PATCH', { keptFields: [] })
      toast.success('The daily import updates these fields again.')
      router.refresh()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="nhl-data__kept">
      <p>
        <strong>Kept from the daily import:</strong> {kept.map((field) => labels[field] ?? field).join(', ')}. The
        import from API Ninjas leaves them as they were set here.
      </p>
      <Button buttonStyle="secondary" disabled={isSaving} onClick={release} size="medium">
        Let the import update them again
      </Button>
    </div>
  )
}
