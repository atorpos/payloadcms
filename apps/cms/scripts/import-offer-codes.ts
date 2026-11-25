/**
 * Adds one-time-use App Store offer codes from the CSV that App Store Connect exports to Offer codes, as
 * available (README: "App Store offer codes").
 *
 *   pnpm payload run scripts/import-offer-codes.ts <codes.csv> --dry-run   # only check the file
 *   pnpm payload run scripts/import-offer-codes.ts <codes.csv> --batch "Launch, November 2026"
 *
 * Options:
 *   --app <app>          which app the codes are for (src/offerCodes/offerCodes.ts); default: the only one
 *   --batch <name>       a name to find this import by in the admin panel
 *   --expires <date>     the codes' expiry date in App Store Connect (YYYY-MM-DD); they aren't given out
 *                        from that day on
 *   --dry-run            check the file and show what would happen; nothing is saved
 *
 * On the server, deploy/import-offer-codes.sh runs this inside Docker.
 *
 * Every line is checked first: a code that isn't one, or a redeem link of another app, stops the import
 * before anything is saved. Codes that are already in the CMS are skipped, so importing the same file
 * again is safe and never makes a given-out code available again.
 */
/* eslint-disable no-console -- a command-line script */
import type { MongooseAdapter } from '@payloadcms/db-mongodb'

import { readFile } from 'fs/promises'
import { getPayload } from 'payload'

import config from '../src/payload.config'
import {
  findOfferCodeApp,
  OFFER_CODES,
  offerCodeApps,
  parseOfferCodesCsv,
} from '../src/offerCodes/offerCodes'

const USAGE =
  'Usage: pnpm payload run scripts/import-offer-codes.ts <codes.csv> [--app <app>] [--batch <name>] [--expires YYYY-MM-DD] [--dry-run]'
const WITH_VALUE = ['--app', '--batch', '--expires']

const fail = (message: string): never => {
  console.error(`${message}\n${USAGE}`)
  process.exit(1)
}

const options: Record<string, string> = {}
const files: string[] = []
let dryRun = false
const args = process.argv.slice(2)

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!

  if (arg === '--dry-run') {
    dryRun = true
  } else if (WITH_VALUE.includes(arg)) {
    const value = args[++i]

    if (!value || value.startsWith('--')) {
      fail(`${arg} needs a value.`)
    }

    options[arg] = value!
  } else if (arg.startsWith('--')) {
    // A mistyped --dry-run must not run a real import
    fail(`Unknown option: ${arg}`)
  } else {
    files.push(arg)
  }
}

if (files.length !== 1) {
  fail('Give the path of one CSV file.')
}

const app =
  options['--app'] !== undefined
    ? findOfferCodeApp(options['--app'])
    : offerCodeApps.length === 1
      ? offerCodeApps[0]
      : undefined

if (!app) {
  fail(`--app must be one of: ${offerCodeApps.map(({ value }) => value).join(', ')}.`)
}

let expiresAt: string | undefined

if (options['--expires'] !== undefined) {
  const date = options['--expires']

  // Midnight UTC at the start of that day: rather a few hours early than a code that no longer works
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    fail(`--expires must be a date such as 2027-05-24, not "${date}".`)
  }

  expiresAt = new Date(`${date}T00:00:00Z`).toISOString()

  if (Date.parse(expiresAt) <= Date.now()) {
    fail(`--expires ${date} is in the past: these codes no longer work.`)
  }
}

const batch = options['--batch']?.trim() || undefined
const file = files[0]!
const text = await readFile(file, 'utf8').catch((error: Error) => fail(`Can't read ${file}: ${error.message}`))
const { codes, duplicates, errors } = parseOfferCodesCsv(text, app!)

console.log(`${file}: ${codes.length} ${app!.label} codes`)

if (duplicates.length) {
  console.log(`  ${duplicates.length} lines repeat an earlier code and are left out (lines ${duplicates.join(', ')})`)
}

if (errors.length) {
  console.error(`\n${errors.length} lines can't be imported, so nothing was saved:`)
  errors.slice(0, 20).forEach(({ line, message }) => console.error(`  line ${line}: ${message}`))

  if (errors.length > 20) {
    console.error(`  ... and ${errors.length - 20} more`)
  }

  process.exit(1)
}

if (codes.length === 0) {
  fail('The file has no codes.')
}

const payload = await getPayload({ config })

// On a new database, MongoDB is still creating collections and indexes in the background, among them the
// unique index on the code
const models = Object.values((payload.db as MongooseAdapter).connection.models)
const indexBuilds = await Promise.allSettled(models.map((model) => model.init()))

indexBuilds.forEach((result, index) => {
  if (result.status === 'rejected') {
    console.warn(
      `Warning: MongoDB couldn't build an index in "${models[index]!.collection.name}" (README: "Troubleshooting"): ${result.reason instanceof Error ? result.reason.message : String(result.reason)}\n`,
    )
  }
})

const { docs: existing } = await payload.find({
  collection: OFFER_CODES,
  depth: 0,
  overrideAccess: true,
  pagination: false,
  select: { app: true, code: true },
  where: { code: { in: codes.map(({ code }) => code) } },
})
const existingApps = new Map(existing.map((doc) => [doc.code, doc.app]))
const otherApp = codes.filter(({ code }) => existingApps.has(code) && existingApps.get(code) !== app!.value)

if (otherApp.length) {
  console.warn(
    `  ${otherApp.length} codes are already in the CMS under another app (e.g. ${otherApp[0]!.code}); they are left as they are`,
  )
}

const toAdd = codes.filter(({ code }) => !existingApps.has(code))

console.log(`  ${existing.length} are already in the CMS and are skipped`)
console.log(`  ${toAdd.length} ${dryRun ? 'would be added' : 'to add'}${batch ? ` to the batch "${batch}"` : ''}`)

if (expiresAt) {
  console.log(`  they are given out until ${expiresAt.slice(0, 10)}`)
}

if (dryRun) {
  console.log('\nDry run: nothing was saved.')
  process.exit(0)
}

let added = 0

for (const { code, url } of toAdd) {
  await payload.create({
    collection: OFFER_CODES,
    data: {
      app: app!.value,
      code,
      status: 'available',
      url,
      ...(batch && { batch }),
      ...(expiresAt && { expiresAt }),
    },
    depth: 0,
    overrideAccess: true,
  })

  added++

  if (added % 100 === 0) {
    console.log(`  ... ${added} added`)
  }
}

const available = await payload.count({
  collection: OFFER_CODES,
  overrideAccess: true,
  where: { and: [{ app: { equals: app!.value } }, { status: { equals: 'available' } }] },
})

console.log(`\nAdded ${added} codes. ${app!.label} now has ${available.totalDocs} available codes.`)
console.log(`They are under App Store > Offer codes in the admin panel (${payload.config.serverURL}/admin).`)

process.exit(0)
