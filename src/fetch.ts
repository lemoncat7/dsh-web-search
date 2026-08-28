import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { WebError, type WebFetchResult } from '@deepseek-ai/dsh-web'
import type { Dispatcher } from 'undici'
import { DEFAULT_REQUEST_TIMEOUT_MS, dispatcherFor } from './http.ts'

const MAX_FETCH_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 5
const USER_AGENT = '@lemoncat7/dsh-web-search/0.1 (+https://github.com/lemoncat7/dsh-web-search)'

export interface FetchPageOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

/** Safely retrieve one public text resource through the plugin-scoped proxy when configured. */
export async function fetchPublicPage(input: string, options: FetchPageOptions = {}): Promise<WebFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(new DOMException('web fetch timed out', 'TimeoutError')), timeoutMs)
  const signal = options.signal === undefined ? timeoutController.signal : AbortSignal.any([options.signal, timeoutController.signal])
  try {
    let current = await validatePublicURL(input)
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const response = await request(current, signal)
      if (isRedirect(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location) throw new WebError(`redirect from ${current.href} did not include a location`, 'WEB_FETCH_REDIRECT_INVALID')
        if (redirect === MAX_REDIRECTS) throw new WebError(`web fetch exceeded ${MAX_REDIRECTS} redirects`, 'WEB_FETCH_REDIRECT_LIMIT')
        current = await validatePublicURL(new URL(location, current).href)
        continue
      }
      const kind = contentKind(response.headers.get('content-type'))
      const body = await boundedText(response)
      return { url: current.href, statusCode: response.status, body: { kind, content: body.text }, truncated: body.truncated }
    }
    throw new WebError('web fetch redirect loop did not terminate', 'WEB_FETCH_REDIRECT_LIMIT')
  } catch (error) {
    if (error instanceof WebError) throw error
    if (options.signal?.aborted === true) throw new WebError('web fetch aborted', 'WEB_ABORTED', { cause: error })
    if (timeoutController.signal.aborted) throw new WebError(`web fetch timed out after ${timeoutMs}ms`, 'WEB_FETCH_TIMEOUT', { cause: error })
    throw new WebError(`web fetch failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  } finally { clearTimeout(timeout) }
}

export async function validatePublicURL(input: string): Promise<URL> {
  let url: URL
  try { url = new URL(input) }
  catch (error) { throw new WebError('web fetch requires an absolute HTTP(S) URL', 'WEB_FETCH_INVALID_URL', { cause: error }) }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new WebError('web fetch URL must use HTTP or HTTPS', 'WEB_FETCH_INVALID_URL')
  if (url.username || url.password) throw new WebError('web fetch URL must not contain credentials', 'WEB_FETCH_INVALID_URL')
  const host = url.hostname.toLocaleLowerCase('en-US').replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) {
    throw new WebError('web fetch blocks local and private destinations', 'WEB_FETCH_BLOCKED_URL')
  }
  const literalKind = isIP(host)
  if (literalKind !== 0) {
    if (!publicAddress(host, literalKind)) throw new WebError('web fetch blocks local and private destinations', 'WEB_FETCH_BLOCKED_URL')
    return url
  }
  let addresses: Array<{ address: string; family: number }>
  try { addresses = await lookup(host, { all: true, verbatim: true }) }
  catch (error) { throw new WebError(`web fetch could not resolve ${host}`, 'WEB_FETCH_DNS_ERROR', { cause: error }) }
  if (addresses.length === 0 || addresses.some(item => !publicAddress(item.address, item.family))) {
    throw new WebError('web fetch blocks destinations resolving to local or private addresses', 'WEB_FETCH_BLOCKED_URL')
  }
  return url
}

async function request(url: URL, signal: AbortSignal): Promise<Response> {
  const dispatcher = dispatcherFor(url)
  try {
    return await fetch(url, {
      method: 'GET', redirect: 'manual', signal,
      headers: { accept: 'text/html,application/xhtml+xml,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1', 'user-agent': USER_AGENT },
      ...(dispatcher === undefined ? {} : { dispatcher }),
    } as RequestInit & { dispatcher?: Dispatcher })
  } catch (error) {
    if (signal.aborted) throw error
    throw new WebError(`web fetch request to ${url.href} failed`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

function contentKind(value: string | null): 'html' | 'text' {
  const mediaType = value?.split(';', 1)[0]?.trim().toLocaleLowerCase('en-US') ?? ''
  if (mediaType === 'text/html' || mediaType === 'application/xhtml+xml') return 'html'
  if (mediaType.startsWith('text/') || mediaType === 'application/json' || mediaType.endsWith('+json') || mediaType === 'application/xml' || mediaType.endsWith('+xml') || mediaType === 'application/javascript') return 'text'
  throw new WebError(`web fetch does not support content type ${mediaType || '(missing)'}`, 'WEB_FETCH_UNSUPPORTED_CONTENT_TYPE')
}

async function boundedText(response: Response): Promise<{ text: string; truncated: boolean }> {
  if (response.body === null) return { text: '', truncated: false }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  let truncated = false
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    const remaining = MAX_FETCH_BYTES - bytes
    if (chunk.value.byteLength > remaining) {
      if (remaining > 0) text += decoder.decode(chunk.value.subarray(0, remaining), { stream: true })
      truncated = true
      await reader.cancel()
      break
    }
    bytes += chunk.value.byteLength
    text += decoder.decode(chunk.value, { stream: true })
  }
  text += decoder.decode()
  return { text, truncated }
}

function isRedirect(status: number): boolean { return status === 301 || status === 302 || status === 303 || status === 307 || status === 308 }

function publicAddress(value: string, family: number): boolean {
  if (family === 4) {
    const parts = value.split('.').map(Number)
    const first = parts[0] ?? -1; const second = parts[1] ?? -1; const third = parts[2] ?? -1
    return parts.length === 4 && parts.every(item => Number.isInteger(item) && item >= 0 && item <= 255)
      && first !== 0 && first !== 10 && first !== 127 && first < 224
      && !(first === 100 && second >= 64 && second <= 127)
      && !(first === 169 && second === 254)
      && !(first === 172 && second >= 16 && second <= 31)
      && !(first === 192 && (second === 168 || (second === 0 && (third === 0 || third === 2))))
      && !(first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100)))
      && !(first === 203 && second === 0 && third === 113)
  }
  if (family === 6) {
    const first = Number.parseInt(value.split(':', 1)[0] || '0', 16)
    return Number.isInteger(first) && first >= 0x2000 && first <= 0x3fff
  }
  return false
}
