import { WebError } from '@deepseek-ai/dsh-web'
import { ProxyAgent, type Dispatcher } from 'undici'

/** Default deadline kept below the Harness web-search tool deadline. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 25_000
/** Maximum bytes accepted from any external JSON response. */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

const USER_AGENT = '@lemoncat7/dsh-web-search/0.1.0-alpha.3 (+https://github.com/lemoncat7/dsh-web-search)'
let proxyAgent: ProxyAgent | undefined
let proxyAgentURL: string | undefined

/** Per-request transport controls shared by every backend. */
export interface FetchJsonOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

/** Fetch and parse an untrusted JSON response with shared web error codes. */
export async function fetchJson(
  provider: string,
  url: string | URL,
  init: RequestInit,
  options: FetchJsonOptions = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => {
    timeoutController.abort(new DOMException(`${provider} request timed out`, 'TimeoutError'))
  }, timeoutMs)
  const requestSignal = options.signal === undefined
    ? timeoutController.signal
    : AbortSignal.any([options.signal, timeoutController.signal])

  let response: Response
  try {
    const dispatcher = dispatcherFor(url)
    response = await fetch(url, {
      ...init,
      redirect: 'error',
      headers: {
        accept: 'application/json',
        'user-agent': USER_AGENT,
        ...init.headers,
      },
      signal: requestSignal,
      ...(dispatcher === undefined ? {} : { dispatcher }),
    } as RequestInit & { dispatcher?: Dispatcher })
  } catch (error: unknown) {
    clearTimeout(timeout)
    if (options.signal?.aborted === true || (isAbortError(error) && !timeoutController.signal.aborted)) {
      throw new WebError(`${provider} search aborted`, 'WEB_ABORTED', { cause: error })
    }
    if (timeoutController.signal.aborted) {
      throw new WebError(`${provider} request timed out after ${String(timeoutMs)}ms`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    throw new WebError(`${provider} request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }

  if (!response.ok) {
    clearTimeout(timeout)
    throw new WebError(`${provider} API error (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
  }

  try {
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      await response.body?.cancel()
      throw responseTooLarge(provider)
    }
    if (response.body === null) return JSON.parse('') as unknown

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let size = 0
    let text = ''
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw responseTooLarge(provider)
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text) as unknown
  } catch (error: unknown) {
    if (error instanceof WebError) throw error
    if (options.signal?.aborted === true) throw new WebError(`${provider} search aborted`, 'WEB_ABORTED', { cause: error })
    if (timeoutController.signal.aborted) {
      throw new WebError(`${provider} request timed out after ${String(timeoutMs)}ms`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    throw new WebError(`${provider} returned invalid JSON: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Resolve the plugin-only outbound proxy. This deliberately does not install a
 * global dispatcher, so model providers and other DSH plugins keep their own
 * network policy. Private and explicitly excluded hosts stay direct for local
 * SearXNG deployments.
 */
export function dispatcherFor(input: string | URL): Dispatcher | undefined {
  const proxyURL = process.env.DSH_WEB_SEARCH_PROXY?.trim()
  if (proxyURL === undefined || proxyURL.length === 0) return undefined
  const destination = new URL(input)
  if (bypassProxy(destination.hostname)) return undefined
  validateProxyURL(proxyURL)
  if (proxyAgent === undefined || proxyAgentURL !== proxyURL) {
    void proxyAgent?.close()
    proxyAgent = new ProxyAgent(proxyURL)
    proxyAgentURL = proxyURL
  }
  return proxyAgent
}

function validateProxyURL(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch (error: unknown) {
    throw new TypeError('DSH_WEB_SEARCH_PROXY must be an absolute HTTP(S) URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('DSH_WEB_SEARCH_PROXY must use HTTP or HTTPS')
  }
}

function bypassProxy(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase('en-US').replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true
  if (privateIPv4(host)) return true
  const rules = (process.env.DSH_WEB_SEARCH_NO_PROXY ?? '')
    .split(',')
    .map(rule => rule.trim().toLocaleLowerCase('en-US'))
    .filter(Boolean)
  return rules.some(rule => {
    const normalized = rule.startsWith('.') ? rule.slice(1) : rule
    return host === normalized || host.endsWith(`.${normalized}`)
  })
}

function privateIPv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const first = parts[0] ?? -1
  const second = parts[1] ?? -1
  return first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
}

function responseTooLarge(provider: string): WebError {
  return new WebError(`${provider} response exceeded ${String(MAX_RESPONSE_BYTES)} bytes`, 'WEB_PROVIDER_ERROR')
}

/** Resolve a non-empty credential for one API request without caching it. */
export async function resolveCredential(
  provider: string,
  reference: string,
  resolve: () => Promise<string | undefined>,
  signal?: AbortSignal,
): Promise<string> {
  if (isSignalAborted(signal)) throw new WebError(`${provider} search aborted`, 'WEB_ABORTED')
  let value: string | undefined
  try {
    value = await resolve()
  } catch (error: unknown) {
    if (isSignalAborted(signal) || isAbortError(error)) {
      throw new WebError(`${provider} search aborted`, 'WEB_ABORTED', { cause: error })
    }
    throw new WebError(`${provider} credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (isSignalAborted(signal)) throw new WebError(`${provider} search aborted`, 'WEB_ABORTED')
  const trimmed = value?.trim()
  if (trimmed === undefined || trimmed.length === 0 || trimmed === reference) {
    throw new WebError(`${provider} credential ${reference} is not configured`, 'WEB_PROVIDER_ERROR')
  }
  return trimmed
}

/** True when a parsed JSON value is a plain record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate one absolute HTTP(S) URL returned by an external provider. */
export function requiredHttpUrl(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string`)
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError()
    return value
  } catch {
    throw new TypeError(`${path} must be an absolute HTTP(S) URL`)
  }
}

/** Return a trimmed optional string or omit blank values. */
export function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string or null`)
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/** Cap a provider request to its supported result-count range. */
export function resultLimit(value: number | undefined, maximum: number, fallback: number): number {
  if (value === undefined) return fallback
  return Math.max(1, Math.min(maximum, Math.floor(value)))
}

/** Convert a validated provider response and normalize all field errors. */
export function decodeResponse<T>(provider: string, value: unknown, decode: (input: unknown) => T): T {
  try {
    return decode(value)
  } catch (error: unknown) {
    throw new WebError(`${provider} returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/** Remove MediaWiki result markup and decode its common entities. */
export function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .trim()
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}
