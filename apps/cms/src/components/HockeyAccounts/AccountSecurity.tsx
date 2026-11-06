'use client'

import { Button, toast, useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

import type { HockeyAccount } from '../../hockeyAccounts/types'

import { formatDateTime } from '../../hockeyAccounts/types'
import { sendCmsChange } from '../NhlData/sendChange'

/**
 * How the account signs in: two-step sign-in by email, its passkeys, its logins, and a password reset. All of it is
 * in the HockeyPoolCap API; nothing here can show the password, which the API only keeps as a hash.
 */
export function AccountSecurity({ account }: { account: HockeyAccount }) {
  const {
    config: {
      routes: { api: apiRoute },
    },
  } = useConfig()
  const router = useRouter()
  const [working, setWorking] = useState<null | string>(null)
  const [error, setError] = useState('')

  const run = async (key: string, method: 'DELETE' | 'PATCH' | 'POST', path: string, done: string, body?: object) => {
    setError('')
    setWorking(key)
    try {
      await sendCmsChange(apiRoute, `/hockey-accounts/${account.id}${path}`, method, body)
      toast.success(done)
      router.refresh()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setWorking(null)
    }
  }

  return (
    <section aria-labelledby="account-security" className="nhl-data__section">
      <h2 id="account-security">Sign-in and security</h2>

      {error && (
        <p className="nhl-data__form-error" role="alert">
          {error}
        </p>
      )}

      <div className="nhl-data__card">
        <h3>Two-step sign-in</h3>
        <p className="nhl-data__hint">
          {account.twoFactorEmail
            ? 'On: signing in with the password also needs a code emailed to them. Turn it off if they lost access to their email; only they can turn it back on, in the app.'
            : 'Off. They can turn it on in the app (Account → Two-Step Sign-In), which checks a code sent to their email.'}
        </p>
        {account.twoFactorEmail && (
          <div className="nhl-data__actions">
            <Button
              buttonStyle="secondary"
              disabled={working !== null}
              onClick={() => {
                if (
                  window.confirm(`Turn off two-step sign-in for ${account.name}? Their password alone signs in then.`)
                ) {
                  void run('two-factor', 'PATCH', '', 'Two-step sign-in turned off.', { twoFactorEmail: false })
                }
              }}
            >
              {working === 'two-factor' ? 'Turning off…' : 'Turn off two-step sign-in'}
            </Button>
          </div>
        )}
      </div>

      <div className="nhl-data__card">
        <h3>Passkeys</h3>
        {account.passkeys.length === 0 ? (
          <p className="nhl-data__hint">None. They can add one in the app, to sign in with Face ID.</p>
        ) : (
          <div className="nhl-data__table-wrap">
            <table className="nhl-data__table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Added</th>
                  <th>Last used</th>
                  <th>Synced</th>
                  <th>
                    <span className="nhl-data__sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {account.passkeys.map((passkey) => (
                  <tr key={passkey.id}>
                    <td>{passkey.name}</td>
                    <td>{formatDateTime(passkey.createdAt)}</td>
                    <td>{formatDateTime(passkey.lastUsedAt)}</td>
                    <td>{passkey.synced == null ? '—' : passkey.synced ? 'Yes' : 'No'}</td>
                    <td className="nhl-data__row-actions">
                      <button
                        className="nhl-data__link-button nhl-data__link-button--danger"
                        disabled={working !== null}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove the passkey “${passkey.name}”? It stops signing in to ${account.name}’s account.`,
                            )
                          ) {
                            void run(
                              `passkey-${passkey.id}`,
                              'DELETE',
                              `/passkeys/${passkey.id}`,
                              `Passkey “${passkey.name}” removed.`,
                            )
                          }
                        }}
                        type="button"
                      >
                        {working === `passkey-${passkey.id}` ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="nhl-data__card">
        <h3>Logins</h3>
        <p className="nhl-data__hint">
          {account.activeLogins === 0
            ? 'Not signed in anywhere.'
            : account.activeLogins === 1
              ? 'Signed in on 1 device.'
              : `Signed in on ${account.activeLogins} devices.`}
        </p>
        <div className="nhl-data__actions">
          <Button
            buttonStyle="secondary"
            disabled={working !== null || account.activeLogins === 0}
            onClick={() => {
              if (window.confirm(`Sign ${account.name} out on every device? They can sign in again.`)) {
                void run('sign-out', 'POST', '/sign-out', `${account.name} is signed out everywhere.`)
              }
            }}
          >
            {working === 'sign-out' ? 'Signing out…' : 'Sign out everywhere'}
          </Button>
          <Button
            buttonStyle="secondary"
            disabled={working !== null}
            onClick={() => {
              if (window.confirm(`Email ${account.email} a code to choose a new password?`)) {
                void run('reset', 'POST', '/password-reset', `A password reset code is on its way to ${account.email}.`)
              }
            }}
          >
            {working === 'reset' ? 'Sending…' : 'Email a password reset code'}
          </Button>
        </div>
      </div>
    </section>
  )
}
