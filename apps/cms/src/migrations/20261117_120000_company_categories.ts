import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-mongodb'

import { categories } from '../exhibitors/companyMatching'

/**
 * Companies had one business category as text (`industry`, e.g. "Diamonds, Pearls"); it's now a list
 * (["Diamonds", "Pearls"]). Splits each company's text at commas and semicolons. Companies have no
 * versions or drafts.
 *
 * Runs once by itself when the CMS starts in production (prodMigrations in payload.config.ts);
 * locally, run `pnpm payload migrate`. `down` joins the lists back into text.
 */
export async function up({ payload, session }: MigrateUpArgs): Promise<void> {
  const companies = payload.db.collections.companies.collection
  const docs = await companies
    .find({ industry: { $type: 'string' } }, { projection: { industry: 1 }, session })
    .toArray()

  if (docs.length) {
    await companies.bulkWrite(
      docs.map((doc) => ({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { industry: categories(doc.industry) } },
        },
      })),
      { session },
    )
  }

  payload.logger.info(`Companies: made the category of ${docs.length} companies a list`)
}

export async function down({ payload, session }: MigrateDownArgs): Promise<void> {
  const companies = payload.db.collections.companies.collection
  const docs = await companies
    .find({ industry: { $type: 'array' } }, { projection: { industry: 1 }, session })
    .toArray()

  if (docs.length) {
    await companies.bulkWrite(
      docs.map((doc) => ({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              industry: (doc.industry as string[]).length
                ? (doc.industry as string[]).join(', ')
                : null,
            },
          },
        },
      })),
      { session },
    )
  }
}
