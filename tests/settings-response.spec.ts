import { describe, expect, it } from 'vitest'
import { readSettingsResponse } from '../src/settings-response.ts'

describe('settings response errors', () => {
  it('decodes a successful JSON response', async () => {
    await expect(readSettingsResponse(Response.json({ configured: true }))).resolves.toEqual({ configured: true })
  })
  it('preserves the HTTP code and structured error', async () => {
    await expect(readSettingsResponse(Response.json({ error: 'untrusted origin' }, { status: 403 }))).rejects.toThrow('HTTP 403: untrusted origin')
  })
  it.each([[403, 'forbidden'], [502, '<html>Bad Gateway</html>'], [504, '']] as const)('handles non-JSON HTTP %s', async (status, body) => {
    await expect(readSettingsResponse(new Response(body, { status }))).rejects.toThrow(`HTTP ${status}: settings request failed (non-JSON response)`)
  })
  it('rejects malformed success responses explicitly', async () => {
    await expect(readSettingsResponse(new Response('not json'))).rejects.toThrow('HTTP 200: invalid settings response (expected JSON)')
  })
})
