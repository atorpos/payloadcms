'use client'

import { Button, toast, useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useId, useState } from 'react'

import type { HockeyAccount } from '../../hockeyAccounts/types'

import { NhlSaveError, sendCmsChange } from '../NhlData/sendChange'

/**
 * Changes an account's name and email in the HockeyPoolCap API, and turns it off or on. Only what changed is sent.
 * A new email is what the account signs in with from then on.
 */
export function AccountForm({ account }: { account: HockeyAccount }) {
  const {
    config: {
      routes: { api: apiRoute },
    },
  } = useConfig()
  const router = useRouter()
  const id = useId()
  const [name, setName] = useState(account.name)
  const [email, setEmail] = useState(account.email)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)

  const changes: Record<string, string> = {}
  if (name.trim() !== account.name) {
    changes.name = name.trim()
  }
  if (email.trim().toLowerCase() !== account.email) {
    changes.email = email.trim()
  }
  const hasChanges = Object.keys(changes).length > 0

  const save = async (body: Record<string, boolean | string>, done: string) => {
    setError('')
    setFieldErrors({})
    setIsSaving(true)
    try {
      await sendCmsChange(apiRoute, `/hockey-accounts/${account.id}`, 'PATCH', body)
      toast.success(done)
      router.refresh()
    } catch (caught) {
      setError((caught as Error).message)
      setFieldErrors(caught instanceof NhlSaveError ? caught.fieldErrors : {})
    } finally {
      setIsSaving(false)
    }
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!changes.name && 'name' in changes) {
      setFieldErrors({ name: 'can’t be empty' })
      return
    }
    if (
      changes.email &&
      !window.confirm(`Change the email to ${changes.email}? The account then signs in with it, not ${account.email}.`)
    ) {
      return
    }
    void save(changes, `${changes.name ?? account.name} saved.`)
  }

  const toggleDisabled = () => {
    if (account.disabled) {
      void save({ disabled: false }, `${account.name} can sign in again.`)
    } else if (
      window.confirm(
        `Turn off ${account.name}’s account? They’re signed out of the app on every device right away, and can’t sign in until it’s turned back on.`,
      )
    ) {
      void save({ disabled: true }, `${account.name}’s account is turned off.`)
    }
  }

  return (
    <form className="nhl-data__form" noValidate onSubmit={submit}>
      <div className="nhl-data__grid">
        <div className="nhl-data__field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input
            aria-invalid={Boolean(fieldErrors.name)}
            id={`${id}-name`}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            type="text"
            value={name}
          />
          {fieldErrors.name && <span className="nhl-data__field-error">{fieldErrors.name}</span>}
        </div>
        <div className="nhl-data__field">
          <label htmlFor={`${id}-email`}>Email</label>
          <input
            aria-invalid={Boolean(fieldErrors.email)}
            autoComplete="off"
            id={`${id}-email`}
            maxLength={255}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
          {fieldErrors.email && <span className="nhl-data__field-error">{fieldErrors.email}</span>}
          <span className="nhl-data__hint">What they sign in with.</span>
        </div>
      </div>

      {error && (
        <p className="nhl-data__form-error" role="alert">
          {error}
        </p>
      )}

      <div className="nhl-data__actions">
        <Button disabled={isSaving || !hasChanges} type="submit">
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        {hasChanges && !isSaving && (
          <Button
            buttonStyle="secondary"
            onClick={() => {
              setName(account.name)
              setEmail(account.email)
              setFieldErrors({})
            }}
          >
            Undo changes
          </Button>
        )}
        <Button buttonStyle={account.disabled ? 'primary' : 'destructive'} disabled={isSaving} onClick={toggleDisabled}>
          {account.disabled ? 'Turn account on' : 'Turn account off'}
        </Button>
      </div>
    </form>
  )
}
