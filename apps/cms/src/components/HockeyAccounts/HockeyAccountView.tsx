import type { AdminViewServerProps } from 'payload'

import { formatAdminURL } from 'payload/shared'
import React from 'react'

import type { HockeyAccount } from '../../hockeyAccounts/types'

import { formatDateTime } from '../../hockeyAccounts/types'
import { errorMessage, hockeyApi, HockeyApiError } from '../../nhl/hockeyApi'
import { NhlLoadError, NhlPage, segments } from '../NhlData/NhlPage'
import { AccountForm } from './AccountForm'
import { AccountSecurity } from './AccountSecurity'
import { accountsURL } from './HockeyAccountsView'

/**
 * `/admin/hockey-accounts/:id`: one account of the Hockolic app, read from the HockeyPoolCap API: change its name or
 * email, turn it off, and manage its sign-in (two-step sign-in, passkeys, logins). The password is never shown: the
 * API only keeps a hash of it.
 */
export async function HockeyAccountView(props: AdminViewServerProps) {
  const id = segments(props)[1] ?? ''
  const breadcrumbs = [{ href: accountsURL(props), label: 'Accounts' }]

  let account: HockeyAccount | null = null
  let memberHref: null | string = null
  let error: null | string = null

  if (!/^\d{1,18}$/.test(id)) {
    error = 'There’s no such account.'
  } else {
    try {
      account = await hockeyApi<HockeyAccount>(`/api/v1/admin/users/${id}`)
    } catch (caught) {
      error =
        caught instanceof HockeyApiError && caught.status === 404 ? 'There’s no such account.' : errorMessage(caught)
    }
  }

  if (account) {
    // Their profile and fantasy league are kept here, under their member
    const { req } = props.initPageResult
    const member = await req.payload
      .find({
        collection: 'hockey-members',
        depth: 0,
        limit: 1,
        req,
        where: { appUserId: { equals: account.id } },
      })
      .catch(() => null)
    const memberId = member?.docs[0]?.id
    if (memberId) {
      memberHref = formatAdminURL({
        adminRoute: req.payload.config.routes.admin,
        path: `/collections/hockey-members/${memberId}`,
      })
    }
  }

  return (
    <NhlPage
      breadcrumbs={breadcrumbs}
      description={
        account
          ? `Account #${account.id}, created ${formatDateTime(account.createdAt)}. Kept in the HockeyPoolCap API’s database.`
          : undefined
      }
      props={props}
      section="HockeyPoolCap Accounts"
      title={account?.name ?? 'Account'}
    >
      {error || !account ? (
        <NhlLoadError message={error ?? 'There’s no such account.'} what="The account" />
      ) : (
        <>
          {account.disabled && (
            <div className="nhl-data__error" role="status">
              <strong>This account is turned off</strong> (since {formatDateTime(account.disabledAt)}): it can’t sign in
              to the app.
            </div>
          )}

          <section aria-labelledby="account-details" className="nhl-data__section">
            <h2 id="account-details">Details</h2>
            <AccountForm account={account} />
          </section>

          <AccountSecurity account={account} />

          <section aria-labelledby="account-activity" className="nhl-data__section">
            <h2 id="account-activity">Activity</h2>
            <div className="nhl-data__source">
              <dl>
                <dt>Created</dt>
                <dd>{formatDateTime(account.createdAt)}</dd>
                <dt>Last sign-in</dt>
                <dd>{formatDateTime(account.lastLoginAt)}</dd>
                <dt>Password changed</dt>
                <dd>
                  {account.passwordChangedAt
                    ? formatDateTime(account.passwordChangedAt)
                    : 'Never (the one chosen at sign-up)'}
                </dd>
                <dt>Last change</dt>
                <dd>{formatDateTime(account.updatedAt)}</dd>
                <dt>Admin</dt>
                <dd>
                  {account.admin ? 'Yes: may change the NHL data in the app’s API.' : 'No.'}{' '}
                  <span className="nhl-data__hint">Set by ADMIN_EMAILS on the API’s server.</span>
                </dd>
                <dt>Profile and fantasy league</dt>
                <dd>
                  {memberHref ? (
                    <a href={memberHref}>Open their member in HockeyPoolCap App → Members</a>
                  ) : (
                    'Not in the Members collection yet.'
                  )}
                </dd>
              </dl>
            </div>
          </section>
        </>
      )}
    </NhlPage>
  )
}
