import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  countriesAgree,
  enrichment,
  matchCompany,
  matchTokens,
  normalizeName,
  websiteDomain,
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

test('same website domain is the same company, even under another name', () => {
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
  assert.equal(match.kind, 'same')
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
