/**
 * Server side only: the HockeyPoolCap API's endpoints for the NHL data screens (src/components/NhlData). The NHL
 * data lives in the API's PostgreSQL database; these screens read it and send changes back with
 * `X-API-Key: <HOCKEY_API_ADMIN_KEY>` (the API's ADMIN_API_KEY), which opens its /api/v1/admin endpoints. Nothing is
 * stored in this CMS.
 */

const apiUrl = () => (process.env.HOCKEY_API_URL || '').trim().replace(/\/+$/, '')
const apiKey = () => (process.env.HOCKEY_API_ADMIN_KEY || '').trim()

export const isHockeyApiConfigured = () => Boolean(apiUrl() && apiKey())

/** A failed call: the message to show, the HTTP status to answer with, and the API's errors by field */
export class HockeyApiError extends Error {
  readonly fieldErrors: Record<string, string>
  readonly status: number

  constructor(message: string, status: number, fieldErrors: Record<string, string> = {}) {
    super(message)
    this.fieldErrors = fieldErrors
    this.status = status
  }
}

type Problem = { detail?: unknown; errors?: unknown; title?: unknown }

/**
 * Calls the API, e.g. `hockeyApi<NhlTeam[]>('/api/v1/teams')`. Answers undefined for `204 No Content`.
 *
 * @throws HockeyApiError when it isn't set up, can't be reached, or refuses
 */
export const hockeyApi = async <T>(
  path: string,
  { body, method = 'GET' }: { body?: unknown; method?: string } = {},
): Promise<T> => {
  if (!isHockeyApiConfigured()) {
    throw new HockeyApiError(
      'The NHL data screens need HOCKEY_API_URL and HOCKEY_API_ADMIN_KEY in the CMS’s .env.',
      503,
    )
  }

  let response: Response

  try {
    response = await fetch(`${apiUrl()}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        'X-API-Key': apiKey(),
      },
      method,
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new HockeyApiError(`The HockeyPoolCap API at ${apiUrl()} can’t be reached. Try again in a moment.`, 502)
  }

  if (response.status === 204) {
    return undefined as T
  }

  const data = (await response.json().catch(() => null)) as null | Problem

  if (!response.ok) {
    const fieldErrors =
      data?.errors && typeof data.errors === 'object' && !Array.isArray(data.errors)
        ? (data.errors as Record<string, string>)
        : {}
    const detail =
      typeof data?.detail === 'string' && data.detail !== 'Request validation failed' ? data.detail : null
    const firstFieldError = Object.entries(fieldErrors)
      .map(([field, message]) => `${field} ${message}`)
      .at(0)

    throw new HockeyApiError(
      detail ??
        firstFieldError ??
        (response.status === 401 || response.status === 403
          ? 'The HockeyPoolCap API refused the key: HOCKEY_API_ADMIN_KEY must be the API’s ADMIN_API_KEY.'
          : `The HockeyPoolCap API answered ${response.status}.`),
      response.status,
      fieldErrors,
    )
  }

  return data as T
}

/** The message to show for anything a call threw */
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Try again.'
