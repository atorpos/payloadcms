import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyWebsiteReport,
  editionOf,
  sameWebsite,
  seriesKeyOf,
} from '../src/exhibitors/eventWebsite.ts'

const now = '2026-11-17T05:00:00.000Z'

test('a verified website replaces one that was not verified', () => {
  const result = applyWebsiteReport(
    { website: 'https://news.example/jewellery-fair', websiteCheck: null },
    { sourceUrl: 'https://fair.example/2027', url: 'https://fair.example', verified: true },
    now,
  )
  assert.equal(result.website, 'https://fair.example')
  assert.equal(result.websiteCheck.status, 'verified')
  assert.equal(result.websiteCheck.sourceUrl, 'https://fair.example/2027')
  assert.equal(result.websiteCheck.checkedAt, now)
  assert.match(result.websiteCheck.note ?? '', /Replaced https:\/\/news\.example/)
})

test('the same website verified again only updates the check', () => {
  const result = applyWebsiteReport(
    {
      website: 'https://www.fair.example/en',
      websiteCheck: { status: 'verified', checkedAt: '2026-01-01' },
    },
    { sourceUrl: 'https://fair.example/2027', url: 'https://fair.example', verified: true },
    now,
  )
  assert.equal(result.website, undefined)
  assert.equal(result.websiteCheck.status, 'verified')
  assert.equal(result.websiteCheck.checkedAt, now)
})

test('a verified website, or one the team entered, is never replaced: another is only suggested', () => {
  for (const status of ['verified', 'team'] as const) {
    const result = applyWebsiteReport(
      { website: 'https://fair.example', websiteCheck: { status } },
      { url: 'https://other.example', verified: true },
      now,
    )
    assert.equal(result.website, undefined)
    assert.equal(result.websiteCheck.status, status)
    assert.equal(result.websiteCheck.suggestedUrl, 'https://other.example')
  }
  // The team's website stays the team's when it's verified
  assert.equal(
    applyWebsiteReport(
      { website: 'https://fair.example', websiteCheck: { status: 'team' } },
      { url: 'https://fair.example/', verified: true },
      now,
    ).websiteCheck.status,
    'team',
  )
})

test('a website that is not verified is never saved over one, only suggested for an event without', () => {
  const kept = applyWebsiteReport(
    { website: 'https://fair.example', websiteCheck: null },
    { url: 'https://other.example', verified: false },
    now,
  )
  assert.equal(kept.website, undefined)
  assert.equal(kept.websiteCheck.suggestedUrl ?? null, null)
  const none = applyWebsiteReport(
    { website: null },
    { url: 'https://other.example', verified: false },
    now,
  )
  assert.equal(none.website, undefined)
  assert.equal(none.websiteCheck.suggestedUrl, 'https://other.example')
  assert.equal(none.websiteCheck.status, 'unverified')
})

test('no website found leaves it as it is', () => {
  const result = applyWebsiteReport(
    { website: 'https://fair.example', websiteCheck: { status: 'verified' } },
    { note: 'No official site found', url: null, verified: false },
    now,
  )
  assert.equal(result.website, undefined)
  assert.equal(result.websiteCheck.status, 'verified')
})

test('websites are compared by domain', () => {
  assert.ok(sameWebsite('https://www.fair.example/en/', 'http://fair.example'))
  assert.ok(!sameWebsite('https://fair.example', 'https://fair.example.org'))
  assert.ok(!sameWebsite(null, 'https://fair.example'))
})

test('editions of one show share a series key', () => {
  assert.equal(
    seriesKeyOf('Jewellery & Gem WORLD Hong Kong 2026'),
    'jewellery and gem world hong kong',
  )
  assert.equal(
    seriesKeyOf('Jewellery & Gem WORLD Hong Kong 2027'),
    'jewellery and gem world hong kong',
  )
  assert.equal(seriesKeyOf('45th Bangkok Gems & Jewelry Fair'), 'bangkok gems and jewelry fair')
  assert.equal(seriesKeyOf('第42屆 香港國際珠寶展'), '香港國際珠寶展')
  assert.equal(editionOf('2027-03-04'), '2027')
  assert.equal(editionOf(null), null)
})
