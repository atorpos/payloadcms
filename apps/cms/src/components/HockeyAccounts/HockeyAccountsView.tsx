import type { AdminViewServerProps } from 'payload'

import { formatAdminURL } from 'payload/shared'
import React from 'react'

import type { HockeyAccountPage } from '../../hockeyAccounts/types'

import { formatDateTime } from '../../hockeyAccounts/types'
import { errorMessage, hockeyApi } from '../../nhl/hockeyApi'
import { NhlLoadError, NhlPage } from '../NhlData/NhlPage'

const PAGE_SIZE = 50

/** The admin URL of a HockeyPoolCap Accounts screen, e.g. `/admin/hockey-accounts/12` */
export const accountsURL = (props: AdminViewServerProps, path = '') =>
  formatAdminURL({ adminRoute: props.initPageResult.req.payload.config.routes.admin, path: `/hockey-accounts${path}` })

/**
 * `/admin/hockey-accounts?q=&page=`: the HockeyPoolCap app's accounts, newest first. They live in the API's PostgreSQL
 * database (names and emails encrypted there); this screen reads them through its admin endpoints and stores nothing.
 */
export async function HockeyAccountsView(props: AdminViewServerProps) {
  const raw = props.searchParams?.q
  const q = (Array.isArray(raw) ? raw[0] : raw)?.toString().trim() ?? ''
  const rawPage = props.searchParams?.page
  const page = Math.max(1, Number.parseInt((Array.isArray(rawPage) ? rawPage[0] : rawPage)?.toString() ?? '', 10) || 1)

  let accounts: HockeyAccountPage | null = null
  let error: null | string = null

  try {
    const query = new URLSearchParams({ page: String(page - 1), size: String(PAGE_SIZE) })
    if (q) {
      query.set('q', q)
    }
    accounts = await hockeyApi<HockeyAccountPage>(`/api/v1/admin/users?${query}`)
  } catch (caught) {
    error = errorMessage(caught)
  }

  const pageURL = (to: number) => {
    const params = new URLSearchParams()
    if (q) {
      params.set('q', q)
    }
    params.set('page', String(to))
    return `${accountsURL(props)}?${params}`
  }

  return (
    <NhlPage
      description="Everyone with an account in the Hockolic app. The accounts are kept in the HockeyPoolCap API’s database, not in this CMS: open one to change it, turn it off, or end its logins."
      props={props}
      section="HockeyPoolCap Accounts"
      title="Accounts"
    >
      <form action={accountsURL(props)} className="nhl-data__filters" method="get" role="search">
        <div className="nhl-data__field">
          <label htmlFor="hockey-accounts-q">Name or email</label>
          <input defaultValue={q} id="hockey-accounts-q" name="q" placeholder="e.g. olivia@" type="search" />
        </div>
        <div className="nhl-data__filter-actions">
          <button className="nhl-data__button" type="submit">
            Search
          </button>
          {q && <a href={accountsURL(props)}>Show all</a>}
        </div>
      </form>

      {error ? (
        <NhlLoadError message={error} what="The accounts" />
      ) : (
        accounts && (
          <>
            <p className="nhl-data__count">
              {accounts.totalElements === 1 ? '1 account' : `${accounts.totalElements} accounts`}
              {accounts.totalPages > 1 && ` · page ${page} of ${accounts.totalPages}`}
            </p>
            {accounts.content.length > 0 ? (
              <div className="nhl-data__table-wrap">
                <table className="nhl-data__table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Status</th>
                      <th>Two-step sign-in</th>
                      <th className="nhl-data__number">Passkeys</th>
                      <th>Last sign-in</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accounts.content.map((account) => (
                      <tr key={account.id}>
                        <td>
                          <a href={accountsURL(props, `/${account.id}`)}>{account.name}</a>
                          {account.admin && <span className="nhl-data__pill">Admin</span>}
                        </td>
                        <td>{account.email}</td>
                        <td>
                          <span
                            className={`nhl-data__status nhl-data__status--${account.disabled ? 'none' : 'verified'}`}
                          >
                            {account.disabled ? 'Turned off' : 'Active'}
                          </span>
                        </td>
                        <td>{account.twoFactorEmail ? 'On (email)' : 'Off'}</td>
                        <td className="nhl-data__number">{account.passkeys}</td>
                        <td>{formatDateTime(account.lastLoginAt)}</td>
                        <td>{formatDateTime(account.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="nhl-data__empty">
                {q ? `No account’s name or email has “${q}”.` : 'No accounts yet: people sign up in the app.'}
              </p>
            )}
            {accounts.totalPages > 1 && (
              <nav aria-label="Pages" className="nhl-data__pages">
                {page > 1 ? <a href={pageURL(page - 1)}>← Previous</a> : <span />}
                {page < accounts.totalPages && <a href={pageURL(page + 1)}>Next →</a>}
              </nav>
            )}
          </>
        )
      )}
    </NhlPage>
  )
}
