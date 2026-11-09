'use client'

import { Link, NavGroup, useConfig, usePathname } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

/**
 * The sidebar's "NHL Data" group: the screens for the NHL data in the HockeyPoolCap API (src/components/NhlData),
 * which aren't collections, so Payload doesn't list them by itself. Same markup as the sidebar's own links.
 */
export function NhlNavLinks() {
  const {
    config: {
      routes: { admin: adminRoute },
    },
  } = useConfig()
  const pathname = usePathname()

  const links = [
    { href: formatAdminURL({ adminRoute, path: '/nhl/teams' }), id: 'nav-nhl-teams', label: 'Teams' },
    { href: formatAdminURL({ adminRoute, path: '/nhl/players' }), id: 'nav-nhl-players', label: 'Players' },
    { href: formatAdminURL({ adminRoute, path: '/nhl/review' }), id: 'nav-nhl-review', label: 'Review' },
    { href: formatAdminURL({ adminRoute, path: '/nhl/import' }), id: 'nav-nhl-import', label: 'Import' },
  ]

  return (
    <NavGroup label="NHL Data">
      {links.map(({ href, id, label }) => {
        const isActive = pathname === href || pathname.startsWith(`${href}/`)

        return (
          <div className="nav__link-wrapper" key={href}>
            <Link
              aria-current={isActive ? (pathname === href ? 'page' : 'location') : undefined}
              className={`nav__link${isActive ? ' nav__link--selected' : ''}`}
              href={href}
              id={id}
              prefetch={false}
            >
              <span className="nav__link-label">{label}</span>
            </Link>
          </div>
        )
      })}
    </NavGroup>
  )
}
