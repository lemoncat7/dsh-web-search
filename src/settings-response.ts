/** Decode settings responses without hiding HTTP failures behind JSON errors. */
export async function readSettingsResponse<T>(response: Response): Promise<T> {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}: settings request failed (non-JSON response)`)
    throw new Error(`HTTP ${String(response.status)}: invalid settings response (expected JSON)`)
  }
  if (!response.ok) {
    const message = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : 'settings request failed'
    throw new Error(`HTTP ${String(response.status)}: ${message}`)
  }
  return value as T
}
