import type { CollectionBeforeChangeHook, CollectionConfig, Field } from 'payload'

import { ValidationError } from 'payload'

import { loggedIn } from '../access/loggedIn'

/** A person in a report, as awoz-api sends it; empty once their account is deleted */
const person = (name: 'reported' | 'reporter', label: string): Field => ({
  name,
  type: 'group',
  admin: {
    readOnly: true,
  },
  fields: [
    {
      type: 'row',
      fields: [
        { name: 'name', type: 'text' },
        { name: 'email', type: 'email' },
        { name: 'company', type: 'text' },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'client', type: 'relationship', relationTo: 'clients' },
        { name: 'appUserId', type: 'number', label: 'VgemsAI App Account' },
      ],
    },
  ],
  label,
})

/**
 * Sets the status with the decision, and keeps a decision that was carried out from changing: awoz-api can't undo a
 * removed message or a suspension.
 */
const followDecision: CollectionBeforeChangeHook = ({ data, operation, originalDoc, req }) => {
  if (operation !== 'update') {
    return data
  }
  if (originalDoc?.status === 'applied' && data.decision !== originalDoc.decision) {
    throw new ValidationError({
      errors: [
        {
          message:
            'This decision was already carried out in the app. To lift a suspension, see the README ("Chat reports").',
          path: 'decision',
        },
      ],
    })
  }
  if (originalDoc?.status !== 'applied' && data.decision !== originalDoc?.decision) {
    const decided = Boolean(data.decision && data.decision !== 'none')
    data.status = decided ? 'decided' : 'open'
    data.decidedAt = decided ? new Date().toISOString() : null
    data.decidedBy = decided ? req.user?.email : null
  }
  return data
}

/**
 * Reports of people and messages in the VgemsAI app's chats, from awoz-api (src/endpoints/appChatReports.ts). The
 * App Store expects reports to be acted on within 24 hours. Choose a decision and save: within a minute awoz-api
 * removes the message, or also suspends the person who sent it, and the status becomes "Done".
 */
export const ChatReports: CollectionConfig = {
  slug: 'chat-reports',
  access: {
    create: () => false,
    delete: loggedIn,
    read: loggedIn,
    update: loggedIn,
  },
  admin: {
    defaultColumns: ['reason', 'reported.name', 'status', 'reportedAt'],
    description:
      'Reports from the chats in the VgemsAI app. Decide within 24 hours: choose a decision and save, and the app carries it out within a minute.',
    group: 'VgemsAI App',
    useAsTitle: 'reason',
  },
  defaultSort: '-reportedAt',
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'reason',
          type: 'select',
          admin: { readOnly: true },
          options: [
            { label: 'Spam', value: 'spam' },
            { label: 'Harassment', value: 'harassment' },
            { label: 'Inappropriate', value: 'inappropriate' },
            { label: 'Scam or fraud', value: 'scam' },
            { label: 'Something else', value: 'other' },
          ],
          required: true,
        },
        {
          name: 'reportedAt',
          type: 'date',
          admin: { date: { pickerAppearance: 'dayAndTime' }, readOnly: true },
          label: 'Reported',
        },
      ],
    },
    {
      name: 'messageText',
      type: 'textarea',
      admin: {
        description: 'The message as it was when reported. Empty when a person was reported.',
        readOnly: true,
      },
      label: 'Message',
    },
    {
      name: 'details',
      type: 'textarea',
      admin: { readOnly: true },
      label: 'What the reporter wrote',
    },
    person('reported', 'Reported'),
    person('reporter', 'Reported by'),
    {
      name: 'decision',
      type: 'select',
      admin: {
        description:
          'Remove the message: nobody sees it any more. Suspend: also signs the sender out everywhere; they can no longer log in or chat.',
        position: 'sidebar',
      },
      defaultValue: 'none',
      options: [
        { label: 'Not decided yet', value: 'none' },
        { label: 'Dismiss: nothing wrong', value: 'dismissed' },
        { label: 'Remove the message', value: 'remove-message' },
        { label: 'Remove the message and suspend the sender', value: 'suspend-user' },
      ],
      required: true,
    },
    {
      name: 'status',
      type: 'select',
      admin: {
        position: 'sidebar',
        readOnly: true,
      },
      defaultValue: 'open',
      options: [
        { label: 'Open', value: 'open' },
        { label: 'Decided, being carried out', value: 'decided' },
        { label: 'Done', value: 'applied' },
      ],
    },
    {
      name: 'decidedBy',
      type: 'text',
      admin: { position: 'sidebar', readOnly: true },
    },
    {
      name: 'decidedAt',
      type: 'date',
      admin: { date: { pickerAppearance: 'dayAndTime' }, position: 'sidebar', readOnly: true },
    },
    {
      name: 'appliedAt',
      type: 'date',
      admin: { date: { pickerAppearance: 'dayAndTime' }, position: 'sidebar', readOnly: true },
      label: 'Done at',
    },
    {
      type: 'row',
      admin: { position: 'sidebar' },
      fields: [
        {
          name: 'appReportId',
          type: 'number',
          admin: { readOnly: true },
          index: true,
          label: 'Report in the app',
          unique: true,
        },
        {
          name: 'messageId',
          type: 'number',
          admin: { readOnly: true },
          label: 'Message in the app',
        },
      ],
    },
  ],
  hooks: {
    beforeChange: [followDecision],
  },
  labels: {
    plural: 'Chat reports',
    singular: 'Chat report',
  },
}
