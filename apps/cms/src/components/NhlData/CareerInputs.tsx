'use client'

import React, { useEffect, useState } from 'react'

/** A number field that keeps what's typed until it's a number: whole numbers, or decimals when `decimal` */
export function NumberInput({
  decimal = false,
  label,
  onChange,
  placeholder,
  value,
}: {
  decimal?: boolean
  label: string
  onChange: (value: null | number) => void
  placeholder?: string
  value: null | number | undefined
}) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value))
  const [invalid, setInvalid] = useState(false)

  // Shows a value changed from outside (e.g. after saving)
  useEffect(() => {
    if (parse(text, decimal) !== (value ?? null)) {
      setText(value === null || value === undefined ? '' : String(value))
      setInvalid(false)
    }
    // Only when the value changes, not while typing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <input
      aria-invalid={invalid}
      aria-label={label}
      inputMode={decimal ? 'decimal' : 'numeric'}
      onChange={(event) => {
        setText(event.target.value)
        const parsed = parse(event.target.value, decimal)
        setInvalid(parsed === undefined)
        if (parsed !== undefined) {
          onChange(parsed)
        }
      }}
      placeholder={placeholder}
      title={invalid ? (decimal ? 'A number, e.g. 2.45' : 'A whole number') : undefined}
      type="text"
      value={text}
    />
  )
}

/** null for empty, undefined for not a number */
const parse = (text: string, decimal: boolean): null | number | undefined => {
  const trimmed = text.trim().replace(/[$,_\s]/g, '')
  if (!trimmed) {
    return null
  }
  const number = Number(trimmed)
  if (!Number.isFinite(number) || (!decimal && !Number.isInteger(number))) {
    return undefined
  }
  return number
}

/** A text field; empty is null */
export function TextInput({
  label,
  maxLength,
  onChange,
  placeholder,
  type = 'text',
  value,
}: {
  label: string
  maxLength?: number
  onChange: (value: null | string) => void
  placeholder?: string
  type?: 'date' | 'text'
  value: null | string | undefined
}) {
  return (
    <input
      aria-label={label}
      maxLength={maxLength}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      placeholder={placeholder}
      type={type}
      value={value ?? ''}
    />
  )
}

/** One item per line, e.g. what a team got in a trade */
export function LinesInput({
  label,
  onChange,
  value,
}: {
  label: string
  onChange: (value: string[]) => void
  value: string[]
}) {
  const [text, setText] = useState(value.join('\n'))

  return (
    <textarea
      aria-label={label}
      onChange={(event) => {
        setText(event.target.value)
        onChange(
          event.target.value
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        )
      }}
      rows={Math.max(2, value.length + 1)}
      value={text}
    />
  )
}

/** A small "Remove" button for a row */
export function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button aria-label={label} className="nhl-data__link-button nhl-data__link-button--danger" onClick={onClick} type="button">
      Remove
    </button>
  )
}

/** The list with one item changed */
export const replaceAt = <T,>(list: T[], index: number, patch: Partial<T>): T[] =>
  list.map((item, i) => (i === index ? { ...item, ...patch } : item))

export const removeAt = <T,>(list: T[], index: number): T[] => list.filter((_, i) => i !== index)
