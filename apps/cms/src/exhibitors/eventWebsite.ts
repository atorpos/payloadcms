/**
 * An event's official website and edition (../collections/Events.ts). Pure functions, used by the
 * Events hook and by awoz-api's exhibitor search (../endpoints/appExhibitorDiscovery.ts).
 *
 * The exhibitor search reports the official website it found for the event's edition, and whether it
 * was verified: Claude fetched the page, and its text has the event's name and the edition's year.
 * A verified website, or one the team entered, is kept: a different one found later is only suggested.
 * A website that isn't verified (e.g. what the weekly event search found) is replaced by a verified one.
 */

export type WebsiteStatus = 'team' | 'unverified' | 'verified'

export type WebsiteCheck = {
  checkedAt?: null | string
  note?: null | string
  sourceUrl?: null | string
  status?: null | WebsiteStatus
  suggestedUrl?: null | string
}

/** What the exhibitor search found */
export type WebsiteReport = {
  note?: null | string
  /** The page whose text showed it's this edition's website */
  sourceUrl?: null | string
  url: null | string
  verified: boolean
}

/** Two addresses of the same website: the same host, without "www." */
export const sameWebsite = (a: null | string | undefined, b: null | string | undefined) => {
  const first = hostOf(a)

  return first !== null && first === hostOf(b)
}

const hostOf = (url: null | string | undefined) => {
  if (!url) {
    return null
  }
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname
      .toLowerCase()
      .replace(/^www\d?\./, '')
  } catch {
    return null
  }
}

/**
 * The event's website and its check once the search's report is taken in: what the event should be
 * saved with. `now` is an ISO date.
 */
export const applyWebsiteReport = (
  event: { website?: null | string; websiteCheck?: null | WebsiteCheck },
  report: WebsiteReport,
  now: string,
): { website?: null | string; websiteCheck: WebsiteCheck } => {
  const check: WebsiteCheck = { ...event.websiteCheck }
  const current = event.website ?? null
  const kept = check.status === 'team' || check.status === 'verified'
  const note = report.note?.trim().slice(0, 1000) || null

  if (!report.url) {
    return { websiteCheck: { ...check, note: note ?? check.note ?? null } }
  }

  if (current && sameWebsite(current, report.url)) {
    if (!report.verified) {
      return { websiteCheck: { ...check, note, status: check.status ?? 'unverified' } }
    }
    return {
      websiteCheck: {
        ...check,
        checkedAt: now,
        note,
        sourceUrl: report.sourceUrl ?? report.url,
        status: check.status === 'team' ? 'team' : 'verified',
        suggestedUrl: sameWebsite(check.suggestedUrl, report.url)
          ? null
          : (check.suggestedUrl ?? null),
      },
    }
  }

  if (kept) {
    // Another website than the one checked: the team decides
    return {
      websiteCheck: {
        ...check,
        note: report.verified
          ? `Another official website was found: ${report.url}. ${note ?? ''}`.trim()
          : (check.note ?? null),
        suggestedUrl: report.verified ? report.url : (check.suggestedUrl ?? null),
      },
    }
  }

  if (report.verified) {
    return {
      website: report.url,
      websiteCheck: {
        checkedAt: now,
        note: current ? `Replaced ${current}, which wasn't verified. ${note ?? ''}`.trim() : note,
        sourceUrl: report.sourceUrl ?? report.url,
        status: 'verified',
        suggestedUrl: null,
      },
    }
  }

  return {
    websiteCheck: {
      ...check,
      note,
      status: 'unverified',
      suggestedUrl: current ? (check.suggestedUrl ?? null) : report.url,
    },
  }
}

/** The year an event starts in, as its edition when the team didn't name one ("2026") */
export const editionOf = (localStartDay: null | string | undefined) =>
  localStartDay && /^\d{4}-/.test(localStartDay) ? localStartDay.slice(0, 4) : null

/**
 * The editions of one show share this key: the name without years, ordinals or "edition", e.g.
 * "Jewellery & Gem WORLD Hong Kong 2026" and "Jewellery & Gem WORLD Hong Kong 2027" both give
 * "jewellery and gem world hong kong".
 */
export const seriesKeyOf = (name: null | string | undefined) =>
  (name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\b\d+(st|nd|rd|th)\b/g, ' ')
    .replace(/第\s*\d+\s*届|第\s*\d+\s*屆/g, ' ')
    .replace(/\bedition\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 200) || null
