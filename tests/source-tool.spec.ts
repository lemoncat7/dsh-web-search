import { describe, expect, it } from 'vitest'
import { renderSourceResult } from '../src/source-tool.ts'

describe('web_source rendering', () => {
  const result = {
    url: 'https://example.com/profile',
    statusCode: 200,
    body: { kind: 'html' as const, content: `prefix-${'a'.repeat(40)}-TweetResults-${'b'.repeat(40)}-created_at_ms-${'c'.repeat(40)}-suffix` },
    truncated: false,
  }

  it('returns bounded windows around exact raw-source markers', () => {
    const output = JSON.parse(renderSourceResult(result, {
      url: result.url,
      find: ['TweetResults', 'created_at_ms'],
      offset: 0,
      maxChars: 1_000,
      contextChars: 500,
    })) as { mode: string; matches: Array<{ term: string; offsets: number[] }>; content: string }

    expect(output.mode).toBe('matches')
    expect(output.matches.every(item => item.offsets.length === 1)).toBe(true)
    expect(output.content).toContain('TweetResults')
    expect(output.content).toContain('created_at_ms')
  })

  it('supports deterministic range reads after marker discovery', () => {
    const output = JSON.parse(renderSourceResult(result, {
      url: result.url,
      find: [],
      offset: 7,
      maxChars: 1_000,
      contextChars: 500,
    })) as { mode: string; range: { start: number; end: number }; content: string }

    expect(output.mode).toBe('range')
    expect(output.range.start).toBe(7)
    expect(output.content).toBe(result.body.content.slice(7))
  })
})
