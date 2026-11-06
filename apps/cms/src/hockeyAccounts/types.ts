/**
 * What the HockeyPoolCap API answers for the HockeyPoolCap Accounts screens (src/components/HockeyAccounts). The accounts live in
 * the API's PostgreSQL database; nothing about them is stored in this CMS.
 */

/** `GET /api/v1/admin/users`: one row of the list */
export type HockeyAccountSummary = {
  /** In the API's ADMIN_EMAILS: may change the NHL data */
  admin: boolean
  /** ISO date-time */
  createdAt: string
  disabled: boolean
  email: string
  id: number
  lastLoginAt?: null | string
  name: string
  /** How many passkeys it has */
  passkeys: number
  twoFactorEmail: boolean
}

export type HockeyAccountPasskey = {
  createdAt: string
  id: number
  lastUsedAt?: null | string
  name: string
  /** Backed up and synced, e.g. by iCloud Keychain; null when unknown */
  synced?: boolean | null
}

/** `GET /api/v1/admin/users/{id}` */
export type HockeyAccount = {
  /** On how many devices it's signed in */
  activeLogins: number
  admin: boolean
  createdAt: string
  disabled: boolean
  disabledAt?: null | string
  email: string
  id: number
  lastLoginAt?: null | string
  name: string
  passkeys: HockeyAccountPasskey[]
  passwordChangedAt?: null | string
  twoFactorEmail: boolean
  updatedAt: string
}

export type HockeyAccountPage = {
  content: HockeyAccountSummary[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

/** e.g. "6 Nov 2026, 15:39", in the CMS server's time zone; "—" for none */
export const formatDateTime = (value?: null | string) => {
  if (!value) {
    return '—'
  }
  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
}
