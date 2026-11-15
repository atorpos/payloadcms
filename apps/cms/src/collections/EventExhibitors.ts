import type { CollectionConfig } from 'payload'

import { loggedIn } from '../access/loggedIn'
import { notifyAwozApiAfterChange, notifyAwozApiAfterDelete } from '../hooks/notifyAwozApi'

/**
 * Which company exhibits at which event: one record per event and company (a unique index), with
 * the stand as the event lists it. awoz-api's exhibitor search adds them from the event's official
 * exhibitor list (../endpoints/appExhibitorDiscovery.ts); the team can add or correct them by hand.
 *
 * Attendance: "Listed" was on the official list when last read; "Confirmed" the team checked it, and
 * the search then leaves the stand as entered; "Withdrawn" no longer on the list, or cancelled.
 */
export const EventExhibitors: CollectionConfig = {
  slug: 'event-exhibitors',
  access: {
    create: loggedIn,
    delete: loggedIn,
    read: loggedIn,
    update: loggedIn,
  },
  admin: {
    defaultColumns: ['listedName', 'event', 'company', 'booth', 'hall', 'attendanceStatus'],
    group: 'Business',
    listSearchableFields: ['listedName', 'booth', 'hall'],
    useAsTitle: 'listedName',
  },
  defaultSort: 'listedName',
  hooks: {
    afterChange: [notifyAwozApiAfterChange],
    afterDelete: [notifyAwozApiAfterDelete],
  },
  // A company is listed once per event
  indexes: [{ fields: ['event', 'company'], unique: true }],
  labels: {
    plural: 'Event exhibitors',
    singular: 'Event exhibitor',
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'event',
          type: 'relationship',
          index: true,
          relationTo: 'events',
          required: true,
        },
        {
          name: 'company',
          type: 'relationship',
          index: true,
          relationTo: 'companies',
          required: true,
        },
      ],
    },
    {
      name: 'listedName',
      type: 'text',
      admin: {
        description: 'The exhibitor’s name as the event lists it',
      },
      label: 'Listed as',
      maxLength: 300,
      required: true,
    },
    {
      type: 'row',
      fields: [
        {
          name: 'booth',
          type: 'text',
          admin: { description: 'Booth or stand number, as listed' },
          maxLength: 200,
        },
        {
          name: 'hall',
          type: 'text',
          admin: { description: 'Hall or exhibition zone, as listed' },
          maxLength: 200,
        },
      ],
    },
    {
      name: 'attendanceStatus',
      type: 'select',
      defaultValue: 'listed',
      label: 'Attendance',
      options: [
        { label: 'Listed (on the official exhibitor list)', value: 'listed' },
        { label: 'Confirmed (checked by the team)', value: 'confirmed' },
        { label: 'Withdrawn', value: 'withdrawn' },
      ],
      required: true,
    },
    {
      name: 'sourceUrl',
      type: 'text',
      admin: { description: 'The exhibitor list page it was found on' },
      label: 'Source',
      maxLength: 1000,
    },
    {
      type: 'row',
      fields: [
        {
          name: 'discoveredAt',
          type: 'date',
          admin: { date: { pickerAppearance: 'dayAndTime' }, readOnly: true },
          label: 'Found',
        },
        {
          name: 'lastVerifiedAt',
          type: 'date',
          admin: { date: { pickerAppearance: 'dayAndTime' } },
          label: 'Last seen on the list',
        },
      ],
    },
    {
      name: 'foundBy',
      type: 'select',
      admin: {
        condition: (data) => Boolean(data?.foundBy),
        position: 'sidebar',
        readOnly: true,
      },
      label: 'Found by',
      options: [{ label: 'Claude (exhibitor search)', value: 'claude' }],
    },
  ],
  timestamps: true,
}
