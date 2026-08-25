import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { DEFAULT_REQUEST_TIMEOUT_MS, decodeResponse, fetchJson, isRecord, optionalString, requiredHttpUrl, resultLimit } from './http.ts'
import type { SearchBackend, SearxngConfig } from './types.ts'

/** SearXNG backend using a configured instance's keyless JSON endpoint. */
export class SearxngBackend implements SearchBackend {
  readonly id = 'lemoncat7-search'
  readonly kind = 'searxng'

  constructor(
    private readonly config: Required<Pick<SearxngConfig, 'baseURL' | 'language' | 'safeSearch'>> & SearxngConfig,
    private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {}

  available(): boolean {
    return endpointFor(this.config.baseURL) !== undefined
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const retryCount = Math.min(3, Math.max(0, this.config.retryCount ?? 0))
    let lastError: unknown
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const result = await this.searchOnce(request, signal)
        if (result.sources.length > 0 || attempt === retryCount) return result
      } catch (error: unknown) {
        lastError = error
        if (attempt === retryCount || signal?.aborted === true) throw error
      }
    }
    throw lastError
  }

  private async searchOnce(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const endpoint = endpointFor(this.config.baseURL)
    if (endpoint === undefined) throw new WebError('SearXNG baseURL must be an absolute HTTP(S) URL', 'WEB_PROVIDER_ERROR')
    const body = new URLSearchParams({
      q: request.query,
      format: 'json',
      language: this.config.language,
      safesearch: String(this.config.safeSearch),
    })
    if (this.config.categories !== undefined) body.set('categories', this.config.categories)
    if (this.config.engines !== undefined && this.config.engines.length > 0) body.set('engines', this.config.engines.join(','))
    const value = await fetchJson('SearXNG', endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }, { ...signal === undefined ? {} : { signal }, timeoutMs: this.requestTimeoutMs })
    const maximum = resultLimit(request.maxResults, 20, 8)
    return decodeResponse('SearXNG', value, input => {
      if (!isRecord(input) || !Array.isArray(input.results)) throw new TypeError('response.results must be an array')
      const sources = input.results.map(mapResult)
      return { sources: sources.slice(0, maximum), truncated: sources.length > maximum }
    })
  }
}

export interface SearxngEngineProbe {
  readonly name: string
  readonly categories: readonly string[]
  readonly enabledByDefault: boolean
  readonly tested: boolean
  readonly available: boolean
  readonly resultCount: number
  readonly truncated: boolean
  readonly durationMs: number
  readonly error?: string
}

/** Read general-purpose engines from one instance and probe them with bounded concurrency. */
export async function discoverSearxngEngines(
  config: Required<Pick<SearxngConfig, 'baseURL' | 'language' | 'safeSearch'>> & SearxngConfig,
  query = 'DeepSeek',
  concurrency = 3,
): Promise<SearxngEngineProbe[]> {
  const configEndpoint = configEndpointFor(config.baseURL)
  if (configEndpoint === undefined) throw new WebError('SearXNG baseURL must be an absolute HTTP(S) URL', 'WEB_PROVIDER_ERROR')
  const raw = await fetchJson('SearXNG', configEndpoint, { method: 'GET' }, { timeoutMs: 8_000 })
  if (!isRecord(raw) || !Array.isArray(raw.engines)) throw new WebError('SearXNG /config did not return an engine list', 'WEB_PROVIDER_ERROR')
  const engines = raw.engines.flatMap((value): Array<{ name: string; categories: string[]; enabledByDefault: boolean }> => {
    if (!isRecord(value) || typeof value.name !== 'string' || !Array.isArray(value.categories)) return []
    const categories = value.categories.filter((item): item is string => typeof item === 'string')
    if (!categories.includes('general')) return []
    return [{ name: value.name, categories, enabledByDefault: value.enabled === true }]
  })
  const selected = new Set(config.engines ?? [])
  const shouldProbe = (engine: { name: string; enabledByDefault: boolean }): boolean => selected.size > 0
    ? selected.has(engine.name)
    : engine.enabledByDefault
  const results = new Array<SearxngEngineProbe>(engines.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < engines.length) {
      const index = cursor++
      const engine = engines[index]
      if (engine === undefined) continue
      if (!shouldProbe(engine)) {
        results[index] = { ...engine, tested: false, available: false, resultCount: 0, truncated: false, durationMs: 0 }
        continue
      }
      const startedAt = Date.now()
      try {
        const endpoint = endpointFor(config.baseURL)
        if (endpoint === undefined) throw new Error('invalid SearXNG endpoint')
        const body = new URLSearchParams({
          q: query,
          format: 'json',
          language: config.language,
          safesearch: String(config.safeSearch),
          engines: engine.name,
        })
        const rawResult = await fetchJson('SearXNG', endpoint, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
        }, { timeoutMs: 4_000 })
        if (!isRecord(rawResult) || !Array.isArray(rawResult.results)) throw new Error('response.results must be an array')
        const resultCount = Math.min(rawResult.results.length, 8)
        const engineFailure = Array.isArray(rawResult.unresponsive_engines)
          ? rawResult.unresponsive_engines.find(item => Array.isArray(item) && item[0] === engine.name)
          : undefined
        const failureReason = Array.isArray(engineFailure) && typeof engineFailure[1] === 'string' ? engineFailure[1] : undefined
        results[index] = {
          ...engine,
          tested: true,
          available: resultCount > 0,
          resultCount,
          truncated: rawResult.results.length > resultCount,
          durationMs: Date.now() - startedAt,
          ...resultCount === 0 ? { error: failureReason ?? '没有返回结果' } : {},
        }
      } catch (error: unknown) {
        results[index] = {
          ...engine,
          tested: true,
          available: false,
          resultCount: 0,
          truncated: false,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), engines.length) }, worker))
  const rank = (value: SearxngEngineProbe): number => value.available ? 0 : value.tested ? 2 : 1
  return results.sort((left, right) => rank(left) - rank(right)
    || (left.available && right.available ? left.durationMs - right.durationMs : 0)
    || left.name.localeCompare(right.name))
}

/** Resolve the configured instance root to its search endpoint. */
export function endpointFor(baseURL: string): string | undefined {
  try {
    const url = new URL(baseURL)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    if (url.username.length > 0 || url.password.length > 0) return undefined
    url.search = ''
    url.hash = ''
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/search`
    return url.href
  } catch {
    return undefined
  }
}

function configEndpointFor(baseURL: string): string | undefined {
  const endpoint = endpointFor(baseURL)
  return endpoint?.replace(/\/search$/, '/config')
}

function mapResult(value: unknown, index: number): WebSearchSource {
  if (!isRecord(value)) throw new TypeError(`SearXNG results[${index}] must be an object`)
  const title = optionalString(value.title, `SearXNG results[${index}].title`)
  const snippet = optionalString(value.content, `SearXNG results[${index}].content`)
  const publishedAt = optionalString(value.publishedDate, `SearXNG results[${index}].publishedDate`)
  return {
    url: requiredHttpUrl(value.url, `SearXNG results[${index}].url`),
    ...title === undefined ? {} : { title },
    ...snippet === undefined ? {} : { snippet },
    ...publishedAt === undefined ? {} : { publishedAt },
  }
}
