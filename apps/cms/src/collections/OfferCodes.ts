import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { loggedIn } from '../access/loggedIn'
import {
  OFFER_CODES,
  offerCodeApps,
  offerCodeAvailabilityEndpoint,
  offerCodeChannels,
  offerCodeClaimEndpoint,
  offerCodeStatuses,
} from '../offerCodes/offerCodes'

/**
 * Keeps a code's "given out" details in step with its status when it is changed by hand: marking a code as
 * given out records when (and "By hand"), and making it available again forgets who had it.
 */
const trackStatus: CollectionBeforeChangeHook = ({ data, originalDoc }) => {
  if (data.status === 'claimed' && originalDoc?.status !== 'claimed') {
    data.claimedAt ||= new Date().toISOString()
    data.claimedVia ||= 'manual'
  }

  if (data.status === 'available') {
    data.claimedAt = null
    data.claimedVia = null
    data.networkHash = null
  }

  return data
}

/**
 * One-time-use App Store offer codes (README: "App Store offer codes"), imported from Apple's CSV with
 * deploy/import-offer-codes.sh. The personal website's redeem link gives each visitor the next available
 * one through this collection's endpoints (src/offerCodes/offerCodes.ts) and marks it as given out.
 */
export const OfferCodes: CollectionConfig = {
  slug: OFFER_CODES,
  access: {
    create: loggedIn,
    delete: loggedIn,
    read: loggedIn,
    update: loggedIn,
  },
  admin: {
    components: {
      // How many codes are left, per app
      beforeListTable: ['/components/OfferCodeSummary#OfferCodeSummary'],
    },
    defaultColumns: ['code', 'status', 'claimedAt', 'claimedVia', 'batch'],
    description:
      'One-time-use App Store offer codes. The redeem link on the website gives each visitor the next available code and marks it as given out. Apple doesn’t report redemptions back, so "Given out" means a visitor received the code.',
    group: 'App Store',
    listSearchableFields: ['code', 'batch', 'note'],
    pagination: {
      defaultLimit: 50,
    },
    useAsTitle: 'code',
  },
  // The codes given out most recently first, then the available ones
  defaultSort: '-claimedAt',
  endpoints: [offerCodeClaimEndpoint, offerCodeAvailabilityEndpoint],
  fields: [
    {
      name: 'code',
      type: 'text',
      access: {
        // Fixed once imported: Apple knows the code by exactly this text
        update: () => false,
      },
      admin: {
        description: 'The code as Apple wrote it, e.g. ABCD1234EFGH5678JK',
      },
      index: true,
      required: true,
      unique: true,
    },
    {
      name: 'url',
      type: 'text',
      access: {
        update: () => false,
      },
      admin: {
        description: 'Apple’s link that opens the App Store with the code filled in',
      },
      label: 'Redeem link',
      required: true,
    },
    {
      type: 'row',
      fields: [
        {
          name: 'app',
          type: 'select',
          defaultValue: offerCodeApps[0].value,
          index: true,
          options: offerCodeApps.map(({ label, value }) => ({ label, value })),
          required: true,
        },
        {
          name: 'batch',
          type: 'text',
          admin: {
            description: 'Which import it came from, e.g. "Launch, November 2026"',
          },
        },
      ],
    },
    {
      name: 'expiresAt',
      type: 'date',
      admin: {
        description:
          'The expiry date App Store Connect shows for these codes. Expired codes aren’t given out. Optional.',
      },
      index: true,
      label: 'Expires',
    },
    {
      name: 'note',
      type: 'textarea',
      admin: {
        description: 'e.g. who you gave it to by hand',
      },
    },
    {
      name: 'status',
      type: 'select',
      admin: {
        description:
          'Only available codes are given out. Set it back to Available to hand out a code again, e.g. one that was never used.',
        position: 'sidebar',
      },
      defaultValue: 'available',
      index: true,
      options: offerCodeStatuses,
      required: true,
    },
    {
      name: 'claimedAt',
      type: 'date',
      admin: {
        date: {
          pickerAppearance: 'dayAndTime',
        },
        position: 'sidebar',
      },
      index: true,
      label: 'Given out',
    },
    {
      name: 'claimedVia',
      type: 'select',
      admin: {
        position: 'sidebar',
      },
      label: 'Given out through',
      options: offerCodeChannels,
    },
    {
      // A keyed hash of the network of the visitor who got the code (never the IP address), for the
      // daily limit per network (src/offerCodes/offerCodes.ts)
      name: 'networkHash',
      type: 'text',
      hidden: true,
      index: true,
    },
  ],
  hooks: {
    beforeChange: [trackStatus],
  },
  labels: {
    plural: 'Offer codes',
    singular: 'Offer code',
  },
}
