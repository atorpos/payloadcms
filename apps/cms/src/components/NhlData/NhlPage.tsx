import type { AdminViewServerProps } from 'payload'

import { Gutter, SetStepNav } from '@payloadcms/ui'
import { DefaultTemplate } from '@payloadcms/ui/rsc'
import { redirect } from 'next/navigation'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

import './index.css'

/** The admin URL of an NHL data screen, e.g. `/admin/nhl/players/12` */
export const nhlURL = (props: AdminViewServerProps, path: string) =>
  formatAdminURL({ adminRoute: props.initPageResult.req.payload.config.routes.admin, path: `/nhl${path}` })

/** The path segments after `/admin`, e.g. `['nhl', 'players', '12']` */
export const segments = (props: AdminViewServerProps) => {
  const value = props.params?.segments

  return Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
}

type Props = {
  /** The screens above this one, for the admin header's breadcrumbs, e.g. Players on a player's screen */
  breadcrumbs?: { href: string; label: string }[]
  children: React.ReactNode
  description?: React.ReactNode
  props: AdminViewServerProps
  title: string
}

/**
 * The frame of every NHL data screen: the admin panel's sidebar and header, and the page title. Custom screens
 * aren't protected by Payload, so it sends visitors who aren't logged in to the login page (src/proxy.ts then asks for
 * the two-factor code).
 */
export function NhlPage({ breadcrumbs = [], children, description, props, title }: Props) {
  const { initPageResult, params, searchParams } = props
  const { locale, permissions, req, visibleEntities } = initPageResult
  const adminRoute = req.payload.config.routes.admin

  if (!req.user) {
    const here = formatAdminURL({ adminRoute, path: `/${segments(props).join('/')}` })
    redirect(`${formatAdminURL({ adminRoute, path: '/login' })}?redirect=${encodeURIComponent(here)}`)
  }

  return (
    <DefaultTemplate
      i18n={req.i18n}
      locale={locale}
      params={params}
      payload={req.payload}
      permissions={permissions}
      req={req}
      searchParams={searchParams}
      user={req.user ?? undefined}
      viewType="nhl-data"
      visibleEntities={{ collections: visibleEntities?.collections, globals: visibleEntities?.globals }}
    >
      {/* The admin header's breadcrumbs: NHL Data / Players / Nathan MacKinnon */}
      <SetStepNav
        nav={[
          { label: 'NHL Data' },
          ...breadcrumbs.map((crumb) => ({ label: crumb.label, url: crumb.href })),
          { label: title },
        ]}
      />
      <Gutter className="nhl-data">
        <header className="nhl-data__header">
          <h1>{title}</h1>
          {description && <p className="nhl-data__description">{description}</p>}
        </header>
        {children}
      </Gutter>
    </DefaultTemplate>
  )
}

/** Shown instead of a screen's content when the API can't be read */
export function NhlLoadError({ message }: { message: string }) {
  return (
    <div className="nhl-data__error" role="alert">
      <strong>The NHL data can’t be loaded.</strong> {message}
    </div>
  )
}
