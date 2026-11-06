/** A save the API refused: its message, and its errors by field */
export class NhlSaveError extends Error {
  readonly fieldErrors: Record<string, string>

  constructor(message: string, fieldErrors: Record<string, string> = {}) {
    super(message)
    this.fieldErrors = fieldErrors
  }
}

/**
 * From the browser: sends a change to the CMS's `/api/nhl-data/...` endpoints (src/endpoints/nhlData.ts), which pass
 * it on to the HockeyPoolCap API. Answers the saved record, or null for `204 No Content`.
 *
 * @throws NhlSaveError when it's refused
 */
export const sendNhlChange = async <T = unknown>(
  apiRoute: string,
  path: string,
  method: 'DELETE' | 'PATCH' | 'POST' | 'PUT',
  body?: object,
): Promise<null | T> => {
  let response: Response

  try {
    response = await fetch(`${apiRoute}/nhl-data${path}`, {
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      method,
    })
  } catch {
    throw new NhlSaveError('The CMS can’t be reached. Check your connection and try again.')
  }

  if (response.status === 204) {
    return null
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new NhlSaveError(data?.errors?.[0]?.message || 'Something went wrong. Try again.', data?.fieldErrors || {})
  }

  return data as T
}

/** The fields the import keeps after a save: those kept already, plus the ones changed when "keep" is ticked */
export const keptAfterSave = (kept: string[], changed: string[], keep: boolean) =>
  keep ? [...new Set([...kept, ...changed])].sort() : kept
