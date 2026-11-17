import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  categories,
  changedFields,
  countriesAgree,
  enrichment,
  matchCompany,
  matchTokens,
  MAX_FIELD_SOURCES,
  namesAlike,
  normalizeName,
  urlKey,
  websiteDomain,
  withSources,
} from '../src/exhibitors/companyMatching.ts'

test('legal forms, case, punctuation and spellings do not tell companies apart', () => {
  assert.equal(normalizeName('Wing Fat Jewellery Co., Ltd.'), 'wing fat jewelry')
  assert.equal(normalizeName('WING FAT JEWELRY LIMITED'), 'wing fat jewelry')
  assert.equal(normalizeName('A & B Gems Pvt. Ltd'), 'a b gems')
  assert.equal(normalizeName('周大福珠寶金行有限公司'), '周大福珠寶金行')
  assert.equal(normalizeName('Ｔｅｓｔ　Ｇｅｍｓ　ＧｍｂＨ'), 'test gems')
})

test('a website of its own has a domain; shared hosts do not', () => {
  assert.equal(websiteDomain('https://www.wingfat.com.hk/en/'), 'wingfat.com.hk')
  assert.equal(websiteDomain('wingfat.com.hk'), 'wingfat.com.hk')
  assert.equal(websiteDomain('https://www.facebook.com/wingfat'), null)
  assert.equal(websiteDomain('https://wingfat.en.alibaba.com'), null)
  assert.equal(websiteDomain('not a url'), null)
})

test('countries agree when equal by alias, or one is unknown', () => {
  assert.ok(countriesAgree('Hong Kong SAR', 'hong kong'))
  assert.ok(countriesAgree('USA', 'United States'))
  assert.ok(countriesAgree(null, 'India'))
  assert.ok(!countriesAgree('India', 'Thailand'))
})

const wingFat = {
  id: 'c1',
  name: 'Wing Fat Jewellery Co., Ltd.',
  country: 'Hong Kong',
  website: null,
}

test('same name in the same country is the same company', () => {
  const match = matchCompany({ name: 'WING FAT JEWELRY LIMITED', country: 'Hong Kong SAR' }, [
    wingFat,
  ])
  assert.deepEqual(match, { company: wingFat, kind: 'same' })
})

test('the same website under another name is only possibly the same: a group can share one', () => {
  const ruby = {
    id: 'c2',
    name: 'Ruby House',
    country: 'Thailand',
    website: 'https://rubyhouse.co.th',
  }
  const match = matchCompany(
    { name: 'RH Gems', country: 'Thailand', website: 'http://www.rubyhouse.co.th/contact' },
    [ruby],
  )
  assert.deepEqual(match, { companies: [ruby], kind: 'possible' })

  // Two companies of one group on one website
  const ctf = {
    id: 'c5',
    name: 'Chow Tai Fook Jewellery',
    country: 'Hong Kong',
    website: 'https://ctf.com.hk',
  }
  assert.equal(
    matchCompany(
      { name: 'Chow Tai Fook Enterprises', country: 'Hong Kong', website: 'ctf.com.hk' },
      [ctf],
    ).kind,
    'possible',
  )
})

test('the same website with an alike name is the same company', () => {
  const ruby = {
    id: 'c2',
    name: 'Ruby House',
    country: 'Thailand',
    website: 'https://rubyhouse.co.th',
  }
  // One name's words are all in the other's
  assert.equal(
    matchCompany(
      { name: 'Ruby House Gems Co., Ltd.', country: null, website: 'www.rubyhouse.co.th' },
      [ruby],
    ).kind,
    'same',
  )
  // Nearly the same name
  assert.ok(namesAlike('wing fat jewelry hk', 'wing fat jewelry'))
  assert.ok(!namesAlike('chow tai fook jewelry', 'chow tai fook enterprises'))
  // Alike, but in another country
  assert.equal(
    matchCompany({ name: 'Ruby House', country: 'India', website: 'rubyhouse.co.th' }, [ruby]).kind,
    'possible',
  )
})

test('the legal name matches too', () => {
  const company = {
    id: 'c6',
    name: 'Lumière',
    legalName: 'Lumiere Diamonds SARL',
    country: 'France',
  }
  assert.equal(
    matchCompany({ name: 'LUMIERE DIAMONDS', country: 'France' }, [company]).kind,
    'same',
  )
})

test('an alias or the local name matches', () => {
  const ctf = {
    id: 'c3',
    name: 'Chow Tai Fook',
    localName: '周大福珠寶金行有限公司',
    country: 'Hong Kong',
  }
  assert.equal(matchCompany({ name: '周大福珠寶金行', country: null }, [ctf]).kind, 'same')
  const aliased = {
    id: 'c4',
    name: 'Star Pearls',
    aliases: ['Star Pearl Trading Co'],
    country: 'Japan',
  }
  assert.equal(
    matchCompany({ name: 'STAR PEARL TRADING CO., LTD.', country: 'Japan' }, [aliased]).kind,
    'same',
  )
})

test('the same name in another country is only possibly the same', () => {
  const match = matchCompany({ name: 'Wing Fat Jewellery Ltd', country: 'India' }, [wingFat])
  assert.equal(match.kind, 'possible')
})

test('a similar name is a possible duplicate, never merged', () => {
  const match = matchCompany({ name: 'Wing Fat Fine Jewellery', country: 'Hong Kong' }, [wingFat])
  assert.equal(match.kind, 'possible')
})

test('two certain candidates are not chosen between', () => {
  const twin = { ...wingFat, id: 'c9' }
  assert.equal(
    matchCompany({ name: 'Wing Fat Jewelry', country: 'Hong Kong' }, [wingFat, twin]).kind,
    'possible',
  )
})

test('an unrelated company does not match', () => {
  assert.deepEqual(matchCompany({ name: 'Blue Lagoon Pearls', country: 'Hong Kong' }, [wingFat]), {
    kind: 'none',
  })
})

test('enrichment fills in what is missing and never overwrites', () => {
  const { conflicts, patch } = enrichment(
    { name: 'Wing Fat Jewellery Co., Ltd.', phone: '+852 2345 6789', email: null, address: '' },
    {
      name: 'WING FAT JEWELRY LIMITED',
      phone: '+852 9999 0000',
      email: 'sales@wingfat.com.hk',
      address: '12 Nathan Road',
    },
  )
  assert.deepEqual(patch, { address: '12 Nathan Road', email: 'sales@wingfat.com.hk' })
  assert.deepEqual(enrichment({ name: 'X', email: null }, { name: 'X', email: 'a@x.com' }).filled, [
    'email',
  ])
  assert.deepEqual(conflicts, ['phone'])
  // Another name is kept as an alias
  const renamed = enrichment({ name: 'Wing Fat Jewellery' }, { name: 'WF Jewellery Group' })
  assert.deepEqual(renamed.patch.aliases, ['WF Jewellery Group'])
  // The same phone written differently is not a conflict
  assert.deepEqual(
    enrichment({ name: 'X', phone: '+852 2345-6789' }, { name: 'X', phone: '(852) 23456789' })
      .conflicts,
    [],
  )
})

test('candidates are looked up by distinctive words', () => {
  assert.deepEqual(matchTokens(['Wing Fat Jewellery Co., Ltd.']), ['wing', 'fat'])
  assert.deepEqual(matchTokens(['Diamond Gems Ltd']), ['diamond', 'gems'])
})

test('fields the team edited, emptied ones too, are never filled in or changed', () => {
  const { filled, patch } = enrichment(
    { name: 'X', email: null, phone: null },
    { name: 'X', email: 'old@x.com', phone: '+852 2345 6789' },
    ['email'],
  )
  assert.deepEqual(filled, ['phone'])
  assert.equal(patch.email, undefined)
})

test('categories and links are added to, never replaced', () => {
  const { filled, patch } = enrichment(
    { name: 'X', industry: ['Pearls'], otherLinks: ['https://www.youtube.com/@x'] },
    {
      name: 'X',
      industry: ['pearls', 'Diamonds'],
      otherLinks: ['youtube.com/@x/', 'https://weixin.qq.com/x'],
    },
  )
  assert.deepEqual(patch.industry, ['Pearls', 'Diamonds'])
  assert.deepEqual(patch.otherLinks, ['https://www.youtube.com/@x', 'https://weixin.qq.com/x'])
  assert.deepEqual(filled, ['industry', 'otherLinks'])
  // Nothing new: nothing filled
  assert.deepEqual(
    enrichment({ name: 'X', industry: ['Pearls'] }, { name: 'X', industry: ['PEARLS'] }).filled,
    [],
  )
})

test('social pages are compared without their scheme, www or trailing slash', () => {
  assert.equal(urlKey('https://www.LinkedIn.com/company/wingfat/'), 'linkedin.com/company/wingfat')
  assert.deepEqual(
    enrichment(
      { name: 'X', linkedinUrl: 'https://www.linkedin.com/company/wingfat/' },
      { name: 'X', linkedinUrl: 'linkedin.com/company/wingfat' },
    ).conflicts,
    [],
  )
})

test('text categories become a list, without repeats', () => {
  assert.deepEqual(categories('Diamonds, Pearls; Gold'), ['Diamonds', 'Pearls', 'Gold'])
  assert.deepEqual(categories(['Pearls', 'pearls', ' Jade ']), ['Pearls', 'Jade'])
  assert.deepEqual(categories('鑽石、珍珠'), ['鑽石', '珍珠'])
  assert.deepEqual(categories(null), [])
})

test("each field's source is its newest, and only so many are kept", () => {
  const first = withSources([], ['email', 'phone'], {
    confidence: 'high',
    seenAt: '2026-11-01T00:00:00.000Z',
    sourceKind: 'exhibitorList',
    sourceUrl: 'https://fair.example/list',
  })
  const second = withSources([{ ...first[0]!, id: 'row1' }, first[1]!], ['email'], {
    confidence: 'high',
    seenAt: '2026-11-17T00:00:00.000Z',
    sourceKind: 'companyWebsite',
    sourceUrl: 'https://x.example/contact',
  })
  assert.deepEqual(
    second.map((entry) => [entry.field, entry.sourceKind]),
    [
      ['phone', 'exhibitorList'],
      ['email', 'companyWebsite'],
    ],
  )
  const many = withSources(
    [],
    Array.from({ length: 50 }, (_, i) => `f${i}`),
    { sourceKind: 'team' },
  )
  assert.equal(many.length, MAX_FIELD_SOURCES)
})

test('the fields the team changed, emptied included, untouched empty ones not', () => {
  assert.deepEqual(
    changedFields(
      { email: 'a@x.com', phone: null, industry: ['Pearls'], city: 'Hong Kong' },
      { email: '', phone: '', industry: ['Pearls', 'Jade'], city: 'Hong Kong', name: 'X' },
    ),
    ['email', 'industry'],
  )
})
