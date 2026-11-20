import type { CollectionConfig } from 'payload'

import { personalWebsiteGroup } from '../fields'

// Public access goes through /api/flickr-gallery, which enforces freshness as well as visibility.
export const FlickrPhotos: CollectionConfig = {
  slug: 'flickr-photos',
  access: {
    create: ({ req }) => Boolean(req.user),
    delete: ({ req }) => Boolean(req.user),
    read: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
  },
  admin: {
    group: personalWebsiteGroup,
    useAsTitle: 'title',
    defaultColumns: ['title', 'displayOnWebsite', 'isPublic', 'lastSyncedAt'],
    description: 'Public Flickr photos. Untick Display on website to hide a photo independently of Flickr.',
  },
  fields: [
    { name: 'flickrId', type: 'text', required: true, unique: true, index: true, admin: { readOnly: true } },
    { name: 'title', type: 'text', required: true, admin: { readOnly: true } },
    { name: 'description', type: 'textarea', admin: { readOnly: true } },
    { name: 'flickrUrl', type: 'text', required: true, admin: { readOnly: true } },
    { name: 'imageUrl', type: 'text', required: true, admin: { readOnly: true } },
    { name: 'width', type: 'number', required: true, admin: { readOnly: true } },
    { name: 'height', type: 'number', required: true, admin: { readOnly: true } },
    { name: 'tags', type: 'text', hasMany: true, admin: { readOnly: true } },
    { name: 'license', type: 'text', admin: { readOnly: true } },
    { name: 'dateTaken', type: 'text', admin: { readOnly: true } },
    { name: 'dateUploaded', type: 'number', admin: { readOnly: true } },
    { name: 'isPublic', type: 'checkbox', defaultValue: false, index: true, admin: { readOnly: true } },
    { name: 'lastSyncedAt', type: 'date', index: true, admin: { readOnly: true } },
    { name: 'displayOnWebsite', type: 'checkbox', defaultValue: true, index: true },
  ],
}
