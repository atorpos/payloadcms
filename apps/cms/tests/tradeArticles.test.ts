import assert from 'node:assert/strict'
import { test } from 'node:test'

import { articleData, cannotPublish, invalidArticle } from '../src/nhl/tradeArticles.ts'

const incoming = {
  analysisNote: '“What comes next” is HockeyPoolCap’s analysis…',
  capImpact: [{ capHitAfter: 102441666, capHitBefore: 100491666, season: '2026-27', team: 'MTL' }],
  findings: ['WARNING: a conditional 1st-round pick in the 2029 NHL Draft: conditional, conditions not recorded'],
  madeOn: '2026-11-22',
  sections: [
    { body: 'The Detroit Red Wings traded Dylan Larkin to the Montréal Canadiens…', heading: null, kind: 'facts' as const },
    { body: '- MTL: about $1,558,334 of cap space left…', heading: 'What comes next', kind: 'analysis' as const },
  ],
  seoDescription: 'Dylan Larkin traded to Canadiens by Red Wings on Nov 22, 2026: every asset in the deal…',
  slug: '2026-11-22-dylan-larkin-traded-to-canadiens-by-red-wings',
  sources: [{ publisher: 'NHL.com', title: 'Larkin traded to Canadiens', url: 'https://www.nhl.com/news/x' }],
  teams: ['DET', 'MTL'],
  title: 'Dylan Larkin traded to Canadiens by Red Wings',
  tradeId: 12,
  tradeKey: '2026-11-22:DET-MTL:DACH',
  verification: 'verifiedWithNotes',
}

test('a new article is stored whole, as a draft', () => {
  assert.equal(invalidArticle(incoming), null)
  const data = articleData(incoming, null)
  assert.equal(data.status, 'draft')
  assert.equal(data.title, incoming.title)
  assert.equal(data.sections?.length, 2)
  assert.equal(data.sections?.[1].kind, 'analysis')
  assert.equal(data.verification, 'verifiedWithNotes')
  assert.deepEqual(data.findings, [{ finding: incoming.findings[0] }])
})

test('an article an editor changed or published keeps its text: only the checks are updated', () => {
  for (const stored of [{ editedByEditor: true, status: 'draft' }, { editedByEditor: false, status: 'published' }]) {
    const data = articleData({ ...incoming, title: 'A new title', verification: 'verified' }, stored)
    assert.equal('title' in data, false)
    assert.equal('sections' in data, false)
    assert.equal('status' in data, false)
    assert.equal(data.verification, 'verified')
  }
})

test('an untouched draft is rewritten, and a published one stays published', () => {
  assert.equal(articleData(incoming, { editedByEditor: false, status: 'draft' }).title, incoming.title)
})

test('what it can’t store, and what can’t be published', () => {
  assert.match(invalidArticle({ ...incoming, tradeId: 0 }) ?? '', /tradeId/)
  assert.match(invalidArticle({ ...incoming, sections: [] }) ?? '', /sections/)
  assert.match(
    invalidArticle({ ...incoming, sections: [{ body: 'x', kind: 'opinion' as never }] }) ?? '',
    /facts or analysis/,
  )
  assert.equal(articleData({ ...incoming, verification: 'made up' }, null).verification, 'needsReview')
  assert.match(cannotPublish('needsReview') ?? '', /needs review/)
  assert.equal(cannotPublish('verifiedWithNotes'), null)
})
