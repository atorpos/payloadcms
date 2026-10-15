import type { CollectionSlug, GraphQLExtension, PayloadRequest } from 'payload'

import { vigorCollections } from '.'

/**
 * GraphQL mutations that publish a Vigor item in every language at once, e.g.
 * `publishVigorProduct(id: "…")` for an app that adds products. `createVigorProduct` and
 * `updateVigorProduct` with `_status: published` publish only the language given as `locale`, and
 * an item that isn't published in a language doesn't appear on that language's website. This is
 * "Publish all locales" in the admin panel: languages without a translation show the English text.
 */
export const vigorGraphQLMutations: GraphQLExtension = (GraphQL, { collections }) =>
  Object.fromEntries(
    vigorCollections.map(({ slug }) => {
      const { type } = collections[slug]!.graphQL!

      return [
        `publish${type.name}`,
        {
          type,
          args: {
            id: { type: new GraphQL.GraphQLNonNull(GraphQL.GraphQLString) },
          },
          resolve: (_source: unknown, { id }: { id: string }, { req }: { req: PayloadRequest }) =>
            req.payload.update({
              id,
              collection: slug as CollectionSlug,
              data: { _status: 'published' },
              // GraphQL resolves the relationships itself
              depth: 0,
              overrideAccess: false,
              publishAllLocales: true,
              req,
            }),
        },
      ]
    }),
  )
