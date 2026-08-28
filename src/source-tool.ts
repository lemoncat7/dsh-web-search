import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { fetchPublicPage } from './fetch.ts'

const DEFAULT_SOURCE_CHARS = 30_000
const DEFAULT_CONTEXT_CHARS = 8_000
const MAX_SOURCE_CHARS = 120_000
const MAX_CONTEXT_CHARS = 20_000
const MAX_FIND_TERMS = 8
const MAX_MATCHES_PER_TERM = 24

interface SourceInput {
  url: string
  find: string[]
  offset: number
  maxChars: number
  contextChars: number
}

interface SourceWindow { start: number; end: number }

/** A safe raw-source companion to the human-readable standard `web_fetch` tool. */
export function webSourceTool(timeoutMs: () => number): ToolDefinition {
  return {
    name: 'web_source',
    description: 'Inspect the raw source of one exact public HTTP(S) page. Use this instead of web_fetch when an authoritative procedure requires HTML markers, script-embedded JSON, IDs, timestamps, or other source data that readable-page conversion would remove. Pass find terms to locate and return bounded source windows, or use offset/max_chars to read a known range. This is not a search engine and must not replace an explicitly required source URL.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string', description: 'Exact public HTTP(S) source URL required by the investigation.' },
        find: { type: 'array', maxItems: MAX_FIND_TERMS, items: { type: 'string' }, description: 'Optional exact source markers or identifiers. Matching source windows are merged and returned with their offsets.' },
        offset: { type: 'integer', minimum: 0, description: 'Source character offset for range mode. Ignored when find is present; defaults to 0.' },
        max_chars: { type: 'integer', minimum: 1_000, maximum: MAX_SOURCE_CHARS, description: `Maximum returned source characters. Defaults to ${DEFAULT_SOURCE_CHARS}.` },
        context_chars: { type: 'integer', minimum: 500, maximum: MAX_CONTEXT_CHARS, description: `Characters retained before and after each find match. Defaults to ${DEFAULT_CONTEXT_CHARS}.` },
      },
      required: ['url'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    timeoutMs: 60_000,
    isConcurrencySafe: () => true,
    async execute(raw, exec) {
      const input = parseSourceInput(raw)
      const result = await fetchPublicPage(input.url, { timeoutMs: timeoutMs(), signal: exec.signal })
      return renderSourceResult(result, input)
    },
  }
}

export function renderSourceResult(
  result: Awaited<ReturnType<typeof fetchPublicPage>>,
  input: SourceInput,
): string {
  const source = result.body.content
  const found = input.find.map(term => ({ term, offsets: findOffsets(source, term) }))
  if (input.find.length === 0) {
    const start = Math.min(input.offset, source.length)
    const end = Math.min(source.length, start + input.maxChars)
    return JSON.stringify({
      url: result.url,
      statusCode: result.statusCode,
      contentKind: result.body.kind,
      sourceChars: source.length,
      providerTruncated: result.truncated,
      mode: 'range',
      range: { start, end },
      content: source.slice(start, end),
    })
  }

  const half = Math.floor(input.contextChars / 2)
  const windows = mergeWindows(found.flatMap(item => item.offsets.map(offset => ({
    start: Math.max(0, offset - half),
    end: Math.min(source.length, offset + item.term.length + half),
  }))))
  let remaining = input.maxChars
  const retained: SourceWindow[] = []
  let content = ''
  for (const window of windows) {
    if (remaining <= 0) break
    const end = Math.min(window.end, window.start + remaining)
    const chunk = source.slice(window.start, end)
    const header = `--- source ${window.start}..${end} ---\n`
    content += `${content.length === 0 ? '' : '\n'}${header}${chunk}`
    remaining -= chunk.length
    retained.push({ start: window.start, end })
  }
  return JSON.stringify({
    url: result.url,
    statusCode: result.statusCode,
    contentKind: result.body.kind,
    sourceChars: source.length,
    providerTruncated: result.truncated,
    mode: 'matches',
    matches: found,
    windows: retained,
    content,
  })
}

function parseSourceInput(value: unknown): SourceInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('web_source arguments must be an object')
  const raw = value as Record<string, unknown>
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  if (url.length === 0 || url.length > 4_096) throw new TypeError('url must be a non-empty string no longer than 4096 characters')
  const find = raw.find === undefined ? [] : raw.find
  if (!Array.isArray(find) || find.length > MAX_FIND_TERMS || find.some(term => typeof term !== 'string' || term.trim().length === 0 || term.length > 200)) {
    throw new TypeError(`find must contain at most ${MAX_FIND_TERMS} non-empty strings of at most 200 characters`)
  }
  return {
    url,
    find: find.map(term => (term as string).trim()),
    offset: integer(raw.offset, 0, 0, 2 * 1024 * 1024),
    maxChars: integer(raw.max_chars, DEFAULT_SOURCE_CHARS, 1_000, MAX_SOURCE_CHARS),
    contextChars: integer(raw.context_chars, DEFAULT_CONTEXT_CHARS, 500, MAX_CONTEXT_CHARS),
  }
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`expected an integer from ${minimum} through ${maximum}`)
  }
  return value
}

function findOffsets(source: string, term: string): number[] {
  const offsets: number[] = []
  let offset = source.indexOf(term)
  while (offset >= 0 && offsets.length < MAX_MATCHES_PER_TERM) {
    offsets.push(offset)
    offset = source.indexOf(term, offset + Math.max(1, term.length))
  }
  return offsets
}

function mergeWindows(input: SourceWindow[]): SourceWindow[] {
  const sorted = [...input].sort((left, right) => left.start - right.start || left.end - right.end)
  const output: SourceWindow[] = []
  for (const window of sorted) {
    const previous = output.at(-1)
    if (previous === undefined || window.start > previous.end) output.push({ ...window })
    else previous.end = Math.max(previous.end, window.end)
  }
  return output
}
