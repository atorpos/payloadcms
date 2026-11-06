import type { Endpoint, PayloadRequest } from 'payload'

import { forward, notFound } from './nhlData'

/**
 * What the HockeyPoolCap Accounts screens (src/components/HockeyAccounts) change: the HockeyPoolCap app's accounts, which live in
 * the API's PostgreSQL database. Each is passed on to the API's /api/v1/admin/users endpoints with its admin key
 * (src/nhl/hockeyApi.ts); nothing is stored here. Only for logged-in users (src/proxy.ts also asks them for their
 * two-factor code). Errors answer `{ errors: [{ message }], fieldErrors: { field: message } }`.
 */

const WHAT = 'HockeyPoolCap accounts'

/** `PATCH /api/hockey-accounts/:id`: `{ name, email, disabled, twoFactorEmail: false }`, only what changed */
export const hockeyAccountSaveEndpoint: Endpoint = {
  handler: async (req) => {
    const id = accountID(req)

    return id ? forward(req, 'PATCH', `/api/v1/admin/users/${id}`, { what: WHAT }) : notFound()
  },
  method: 'patch',
  path: '/hockey-accounts/:id',
}

/** `POST /api/hockey-accounts/:id/sign-out`: ends every login of the account (`204`) */
export const hockeyAccountSignOutEndpoint: Endpoint = {
  handler: async (req) => {
    const id = accountID(req)

    return id ? forward(req, 'POST', `/api/v1/admin/users/${id}/sign-out`, { body: false, what: WHAT }) : notFound()
  },
  method: 'post',
  path: '/hockey-accounts/:id/sign-out',
}

/** `POST /api/hockey-accounts/:id/password-reset`: emails the account a code to choose a new password */
export const hockeyAccountPasswordResetEndpoint: Endpoint = {
  handler: async (req) => {
    const id = accountID(req)

    return id
      ? forward(req, 'POST', `/api/v1/admin/users/${id}/password-reset`, { body: false, what: WHAT })
      : notFound()
  },
  method: 'post',
  path: '/hockey-accounts/:id/password-reset',
}

/** `DELETE /api/hockey-accounts/:id/passkeys/:passkeyId`: removes one of the account's passkeys (`204`) */
export const hockeyAccountPasskeyDeleteEndpoint: Endpoint = {
  handler: async (req) => {
    const id = accountID(req)
    const passkeyId = String(req.routeParams?.passkeyId ?? '')

    return id && /^\d{1,18}$/.test(passkeyId)
      ? forward(req, 'DELETE', `/api/v1/admin/users/${id}/passkeys/${passkeyId}`, { what: WHAT })
      : notFound()
  },
  method: 'delete',
  path: '/hockey-accounts/:id/passkeys/:passkeyId',
}

const accountID = (req: PayloadRequest) => {
  const id = String(req.routeParams?.id ?? '')

  return /^\d{1,18}$/.test(id) ? id : null
}
