// @vitest-environment node
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  extractInlineScripts,
  scriptHashSource,
  collectScriptHashes,
  buildContentSecurityPolicy,
} from '../../../server/csp.js'
import { renderPostPage, renderIndexPage } from '../../../scripts/build-blog/lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const HASH_SOURCE_RE = /^'sha256-[A-Za-z0-9+/]{42,43}={0,2}'$/

describe('extractInlineScripts', () => {
  it('extracts untyped and module inline scripts, skipping src= and data blocks', () => {
    const html = `
      <script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>
      <script>one()</script>
      <script type="module">two()</script>
      <script type="application/ld+json">{"@type":"Blog"}</script>
      <script type="text/javascript">three()</script>
    `
    expect(extractInlineScripts(html)).toEqual(['one()', 'two()', 'three()'])
  })

  it('preserves the exact body — browsers hash verbatim, whitespace included', () => {
    expect(extractInlineScripts('<script>\n  x()\n</script>')).toEqual(['\n  x()\n'])
  })
})

describe('scriptHashSource', () => {
  it('emits a CSP sha256 source for the exact script body', () => {
    const body = "console.log('hi')"
    const expected = createHash('sha256').update(body, 'utf8').digest('base64')
    expect(scriptHashSource(body)).toBe(`'sha256-${expected}'`)
  })
})

describe('collectScriptHashes', () => {
  it('walks a dist tree and returns distinct sorted hash sources', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adraft-csp-'))
    try {
      fs.mkdirSync(path.join(dir, 'blog'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'index.html'), '<script>a()</script>')
      // duplicate script across pages must collapse to one hash
      fs.writeFileSync(path.join(dir, 'blog', 'index.html'), '<script>a()</script><script>b()</script>')
      const hashes = collectScriptHashes(dir)
      expect(hashes).toHaveLength(2)
      expect(hashes).toEqual([...hashes].sort())
      for (const h of hashes) expect(h).toMatch(HASH_SOURCE_RE)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns [] for a missing dist directory', () => {
    expect(collectScriptHashes(path.join(os.tmpdir(), 'adraft-does-not-exist'))).toEqual([])
  })
})

describe('buildContentSecurityPolicy', () => {
  it('locks script-src to self + hashes + gtag host, everything else strict', () => {
    const csp = buildContentSecurityPolicy(["'sha256-abc='"])
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self' 'sha256-abc=' https://www.googletagmanager.com")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).not.toContain('unsafe-eval')
    // inline styles are allowed; inline *scripts* must never be blanket-allowed
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
  })
})

// Drift guard: the CSP hashes are computed from dist/ at server start, so they
// cannot desync from what is served — but the *extractor* must keep
// recognizing the real templates' inline scripts. If someone adds, removes,
// or restructures an inline script in index.html or the blog page shell and
// the extractor misses it, these counts break the build before the CSP does.
describe('template coverage', () => {
  it('finds exactly one inline script (the gtag bootstrap) in index.html', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    const scripts = extractInlineScripts(html)
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toContain("gtag('js'")
    expect(scriptHashSource(scripts[0])).toMatch(HASH_SOURCE_RE)
  })

  it('finds exactly two inline scripts (GA snippet + signup handler) on generated blog pages', () => {
    const post = {
      title: 'T', description: 'D', date: '2026-08-01', slug: 't',
      tags: [], author: 'BIDIRON', html: '<p>Body</p>',
    }
    for (const html of [renderPostPage(post), renderIndexPage([post])]) {
      const scripts = extractInlineScripts(html)
      expect(scripts).toHaveLength(2)
      expect(scripts[0]).toContain("gtag('config'")
      expect(scripts[1]).toContain("fetch('/api/subscribe'")
      // the JSON-LD data block must NOT be hashed (it is inert under CSP)
      expect(scripts.some((s) => s.includes('schema.org'))).toBe(false)
    }
  })
})
