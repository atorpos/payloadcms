import type { CollectionConfig } from 'payload'

import { loggedIn } from '../access/loggedIn'

/**
 * Companies in the VgemsAI app, as awoz-api keeps them (src/endpoints/appOrganizations.ts): their name, email domain
 * and people, each linked to their client record. Read-only here: people create, join and leave companies in the
 * app, and a company deleted there is deleted here too.
 */
export const Organizations: CollectionConfig = {
  slug: 'organizations',
  access: {
    create: () => false,
    delete: () => false,
    read: loggedIn,
    update: () => false,
  },
  admin: {
    defaultColumns: ['name', 'emailDomain', 'memberCount', 'updatedAt'],
    description:
      'Companies in the VgemsAI app and the people in them. Kept up to date by the app: people create, join and leave companies there.',
    group: 'Business',
    listSearchableFields: ['name', 'emailDomain'],
    useAsTitle: 'name',
  },
  defaultSort: 'name',
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'emailDomain',
      type: 'text',
      admin: {
        description:
          'People who verify an email at this domain join the company by themselves. Empty when its creator uses a free email such as Gmail.',
      },
      label: 'Email domain',
    },
    {
      name: 'members',
      type: 'array',
      fields: [
        {
          type: 'row',
          fields: [
            {
              name: 'client',
              type: 'relationship',
              admin: {
                description: 'Their client record, from their app signup',
              },
              relationTo: 'clients',
            },
            {
              name: 'role',
              type: 'select',
              options: [
                { label: 'Admin', value: 'admin' },
                { label: 'Staff', value: 'staff' },
              ],
              required: true,
            },
            {
              name: 'joinedVia',
              type: 'select',
              label: 'Joined',
              options: [
                { label: 'Created the company', value: 'created' },
                { label: 'With their company email', value: 'email' },
                { label: 'With the code, approved by an admin', value: 'code' },
              ],
              required: true,
            },
            {
              name: 'joinedAt',
              type: 'date',
              admin: {
                date: { pickerAppearance: 'dayAndTime' },
              },
              label: 'Since',
            },
          ],
        },
        {
          name: 'appUserId',
          type: 'number',
          admin: {
            description: 'Their account in the app',
          },
          index: true,
          label: 'VgemsAI App Account',
          required: true,
        },
      ],
      labels: {
        plural: 'People',
        singular: 'Person',
      },
    },
    {
      name: 'memberCount',
      type: 'number',
      admin: {
        position: 'sidebar',
      },
      label: 'People',
    },
    {
      name: 'appOrganizationId',
      type: 'number',
      admin: {
        description: 'The company in the app',
        position: 'sidebar',
      },
      index: true,
      label: 'VgemsAI App Company',
      required: true,
      unique: true,
    },
  ],
  labels: {
    plural: 'Organizations',
    singular: 'Organization',
  },
}
