import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// content/updates.json feeds the blog's "Recent Updates" page. This guards
// the schema so hand-edits can't silently break that page. See the
// "Recent Updates log" section in CLAUDE.md for the authoring rules.

const raw = readFileSync(resolve(__dirname, '../../content/updates.json'), 'utf8')

describe('content/updates.json', () => {
  it('parses as a non-empty JSON array', () => {
    const updates = JSON.parse(raw)
    expect(Array.isArray(updates)).toBe(true)
    expect(updates.length).toBeGreaterThan(0)
  })

  const updates = JSON.parse(raw)

  it.each(updates.map((entry, i) => [i, entry]))(
    'entry %i has the required shape',
    (i, entry) => {
      expect(entry).toBeTypeOf('object')
      expect(entry.title).toBeTypeOf('string')
      expect(entry.title.length).toBeGreaterThan(0)
      expect(entry.summary).toBeTypeOf('string')
      expect(entry.summary.length).toBeGreaterThan(0)
      expect(Array.isArray(entry.tags)).toBe(true)
      expect(entry.tags.length).toBeGreaterThan(0)
      for (const tag of entry.tags) {
        expect(tag).toBeTypeOf('string')
        expect(tag.length).toBeGreaterThan(0)
      }
    }
  )

  it.each(updates.map((entry, i) => [i, entry]))(
    'entry %i has a valid YYYY-MM-DD date',
    (i, entry) => {
      expect(entry.date).toBeTypeOf('string')
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      // Round-trips through Date, so 2026-02-31 style dates fail too.
      const parsed = new Date(`${entry.date}T00:00:00Z`)
      expect(Number.isNaN(parsed.getTime())).toBe(false)
      expect(parsed.toISOString().slice(0, 10)).toBe(entry.date)
    }
  )

  it('is ordered newest first', () => {
    for (let i = 1; i < updates.length; i++) {
      expect(
        updates[i - 1].date >= updates[i].date,
        `entry ${i - 1} (${updates[i - 1].date}) must not be older than entry ${i} (${updates[i].date})`
      ).toBe(true)
    }
  })
})
