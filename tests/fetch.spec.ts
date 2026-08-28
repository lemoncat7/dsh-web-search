import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPublicPage, validatePublicURL } from '../src/fetch.ts'

afterEach(() => vi.unstubAllGlobals())

describe('public web fetch', () => {
  it('retrieves public HTML through the standard fetch result contract', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<main>verified</main>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })))

    await expect(fetchPublicPage('https://1.1.1.1/source')).resolves.toEqual({
      url: 'https://1.1.1.1/source',
      statusCode: 200,
      body: { kind: 'html', content: '<main>verified</main>' },
      truncated: false,
    })
  })

  it.each([
    'file:///etc/passwd',
    'http://localhost/admin',
    'http://127.0.0.1/admin',
    'http://10.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/admin',
    'https://user:secret@example.com/',
  ])('rejects unsafe destination %s', async (url) => {
    await expect(validatePublicURL(url)).rejects.toMatchObject({
      code: expect.stringMatching(/^WEB_FETCH_(?:INVALID|BLOCKED)_URL$/),
    })
  })

  it('revalidates every redirect before following it', async () => {
    const request = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1/private' },
    }))
    vi.stubGlobal('fetch', request)

    await expect(fetchPublicPage('https://1.1.1.1/start')).rejects.toMatchObject({ code: 'WEB_FETCH_BLOCKED_URL' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('rejects binary response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'content-type': 'application/octet-stream' },
    })))

    await expect(fetchPublicPage('https://1.1.1.1/file')).rejects.toMatchObject({ code: 'WEB_FETCH_UNSUPPORTED_CONTENT_TYPE' })
  })
})
