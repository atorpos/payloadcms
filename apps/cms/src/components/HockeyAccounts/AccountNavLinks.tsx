'use client'

import { Link, NavGroup, useConfig, usePathname } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

/**
 * The sidebar’s "HockeyPoolCap Accounts" group: the Hockolic app's accounts, kept in the HockeyPoolCap API
 * (src/components/HockeyAccounts). Same markup as the sidebar's own links.
 */
export function AccountNavLinks() {
  const {
    config: {
      routes: { admin: adminRoute },
    },
  } = useConfig()
  const pathname = usePathname()
  const href = formatAdminURL({ adminRoute, path: '/hockey-accounts' })
  const isActive = pathname === href || pathname.startsWith(`${href}/`)

  return (
    <NavGroup label="HockeyPoolCap Accounts">
      <div className="nav__link-wrapper">
        <Link
          aria-current={isActive ? (pathname === href ? 'page' : 'location') : undefined}
          className={`nav__link${isActive ? ' nav__link--selected' : ''}`}
          href={href}
          id="nav-hockey-accounts"
          prefetch={false}
        >
          <span className="nav__link-label">Accounts</span>
        </Link>
      </div>
    </NavGroup>
  )
}
