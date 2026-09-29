import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTrustedSettingsRequest, SETTINGS_PATH, settingsHandler } from '../src/settings-route.ts'

const servers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.close(() => { resolve() }) })))
})

describe('browser settings route', () => {
  it.each(['127.0.0.1:19387', 'localhost:19387', '[::1]:19387'])('accepts official Desktop origin on %s including cross-site fetch metadata', host => {
    for (const requireOrigin of [false, true]) {
      expect(isTrustedSettingsRequest({ headers: { host, origin: 'dsh-app://app', 'sec-fetch-site': 'cross-site' } }, requireOrigin)).toBe(true)
    }
  })

  it.each(['null', 'dsh-app://other', 'dsh-app://app.evil.test', 'dsh-app://app:19387', 'dsh-app://app/path', 'dsh-app://app/', 'https://evil.test', 'file://127.0.0.1:19387'])('rejects untrusted Desktop lookalike %s', origin => {
    expect(isTrustedSettingsRequest({ headers: { host: '127.0.0.1:19387', origin } }, true)).toBe(false)
  })

  it('does not expand Desktop access to non-loopback hosts or array origins', () => {
    for (const host of ['dsh.example:1443', '192.168.2.9:3080', 'localhost.evil.test:19387']) {
      expect(isTrustedSettingsRequest({ headers: { host, origin: 'dsh-app://app' } }, true)).toBe(false)
    }
    const malformed = { host: 'localhost:19387', origin: ['dsh-app://app'] } as unknown as IncomingHttpHeaders
    expect(isTrustedSettingsRequest({ headers: malformed }, false)).toBe(false)
  })

  it('serves Desktop reads, updates, tests and engine discovery through the HTTP bridge', async () => {
    const api = { read: vi.fn(async () => snapshot()), write: vi.fn(async () => snapshot()), test: vi.fn(async () => testResult()), discoverEngines: vi.fn(async () => []) }
    const base = await serve(api)
    const headers = { origin: 'dsh-app://app', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' }
    for (const [method, action] of [['GET', undefined], ['PUT', undefined], ['POST', undefined], ['POST', 'discover-engines']] as const) {
      const response = await fetch(`${base}${SETTINGS_PATH}`, { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify({ config: { provider: 'searxng' }, action }) }) })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('application/json')
      await response.json()
    }
    expect(api.read).toHaveBeenCalledOnce()
    expect(api.write).toHaveBeenCalledOnce()
    expect(api.test).toHaveBeenCalledOnce()
    expect(api.discoverEngines).toHaveBeenCalledOnce()
  })

  it('accepts an exact remote same-origin request without accepting cross-site writes', () => {
    const host = 'dsh.mochencloud.cn:1443'
    expect(isTrustedSettingsRequest({ headers: {
      host,
      origin: `https://${host}`,
      'sec-fetch-site': 'same-origin',
    } }, true)).toBe(true)
    expect(isTrustedSettingsRequest({ headers: { host } }, true)).toBe(false)
    expect(isTrustedSettingsRequest({ headers: {
      host,
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
    } }, true)).toBe(false)
  })

  it('returns credential status without returning values', async () => {
    const api = {
      read: vi.fn(async () => snapshot()),
      write: vi.fn(async () => snapshot()),
      test: vi.fn(async () => testResult()),
      discoverEngines: vi.fn(async () => []),
    }
    const origin = await serve(api)
    const response = await fetch(`${origin}${SETTINGS_PATH}`)
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('configured')
    expect(text).not.toContain('secret-value')
  })

  it('accepts a same-origin update and rejects cross-site writes', async () => {
    const api = {
      read: vi.fn(async () => snapshot()),
      write: vi.fn(async () => snapshot()),
      test: vi.fn(async () => testResult()),
      discoverEngines: vi.fn(async () => []),
    }
    const origin = await serve(api)
    const body = JSON.stringify({ config: { provider: 'tavily' }, apiKey: 'secret-value' })
    const accepted = await fetch(`${origin}${SETTINGS_PATH}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin' },
      body,
    })
    expect(accepted.status).toBe(200)
    expect(api.write).toHaveBeenCalledWith({ provider: 'tavily' }, 'secret-value')
    expect(await accepted.text()).not.toContain('secret-value')

    const rejected = await fetch(`${origin}${SETTINGS_PATH}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
      body,
    })
    expect(rejected.status).toBe(403)
    expect(rejected.headers.get('content-type')).toContain('application/json')
    expect(await rejected.json()).toEqual({ error: 'Forbidden: untrusted settings request origin' })
    expect(api.write).toHaveBeenCalledTimes(1)
  })

  it('tests a draft without writing settings or returning the API key', async () => {
    const api = {
      read: vi.fn(async () => snapshot()),
      write: vi.fn(async () => snapshot()),
      test: vi.fn(async () => testResult()),
      discoverEngines: vi.fn(async () => []),
    }
    const origin = await serve(api)
    const body = JSON.stringify({ config: { provider: 'brave' }, apiKey: 'secret-value' })
    const response = await fetch(`${origin}${SETTINGS_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin' },
      body,
    })
    expect(response.status).toBe(200)
    expect(api.test).toHaveBeenCalledWith({ provider: 'brave' }, 'secret-value')
    expect(api.write).not.toHaveBeenCalled()
    const text = await response.text()
    expect(text).toContain('Brave result')
    expect(text).not.toContain('secret-value')
  })

  it('discovers and probes SearXNG engines without writing settings', async () => {
    const api = {
      read: vi.fn(async () => snapshot()),
      write: vi.fn(async () => snapshot()),
      test: vi.fn(async () => testResult()),
      discoverEngines: vi.fn(async () => [{ name: 'bing', categories: ['general'], enabledByDefault: false, tested: true, available: true, resultCount: 3, truncated: false, durationMs: 42 }]),
    }
    const origin = await serve(api)
    const response = await fetch(`${origin}${SETTINGS_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ action: 'discover-engines', config: { provider: 'searxng' }, query: 'nomifun' }),
    })
    expect(response.status).toBe(200)
    expect(api.discoverEngines).toHaveBeenCalledWith({ provider: 'searxng' }, 'nomifun')
    expect(api.write).not.toHaveBeenCalled()
    expect(await response.json()).toEqual([{ name: 'bing', categories: ['general'], enabledByDefault: false, tested: true, available: true, resultCount: 3, truncated: false, durationMs: 42 }])
  })
})

function snapshot() {
  return {
    config: { provider: 'searxng' },
    credentials: {
      brave: { configured: false, writable: true },
      tavily: { configured: true, writable: true },
      gemini: { configured: false, writable: true },
    },
  }
}

function testResult() {
  return { provider: 'brave', resultCount: 1, durationMs: 42, firstTitle: 'Brave result' }
}

async function serve(api: Parameters<typeof settingsHandler>[0]): Promise<string> {
  const server = createServer(settingsHandler(api))
  servers.push(server)
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as AddressInfo).port
  return `http://127.0.0.1:${String(port)}`
}
