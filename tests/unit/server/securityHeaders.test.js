// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openDb } from '../../../server/db.js'
import { createApp } from '../../../server/app.js'
import { createRateLimiter } from '../../../server/rateLimit.js'
import { scriptHashSource } from '../../../server/csp.js'

// End-to-end over real HTTP: the app built around a fixture dist/ must send
// the full security-header set on every response, with the CSP script-src
// hash-locked to the inline scripts actually present in that dist/.

const INLINE = "console.log('spa')"
const BLOG_INLINE = "console.log('blog')"

let db
let server
let baseUrl
let distDir

beforeAll(async () => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adraft-headers-'))
  fs.mkdirSync(path.join(distDir, 'blog'), { recursive: true })
  fs.writeFileSync(
    path.join(distDir, 'index.html'),
    `<!doctype html><title>fixture</title><script>${INLINE}</script>`,
  )
  fs.writeFileSync(
    path.join(distDir, 'blog', 'index.html'),
    `<!doctype html><title>blog</title><script>${BLOG_INLINE}</script>`,
  )
  db = openDb(':memory:')
  const app = createApp({ db, distDir, adminToken: null, rateLimiter: createRateLimiter() })
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`
      resolve()
    })
  })
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  db.close()
  fs.rmSync(distDir, { recursive: true, force: true })
})

describe('security headers', () => {
  it.each([['/'], ['/api/health'], ['/blog/']])('are present on %s', async (route) => {
    const res = await fetch(`${baseUrl}${route}`)
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('strict-transport-security')).toBe('max-age=63072000; includeSubDomains')
    expect(res.headers.get('permissions-policy')).toContain('camera=()')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })

  it('CSP script-src carries the hash of every inline script in dist/', async () => {
    const res = await fetch(`${baseUrl}/`)
    const csp = res.headers.get('content-security-policy')
    const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '))
    expect(scriptSrc).toContain(scriptHashSource(INLINE))
    expect(scriptSrc).toContain(scriptHashSource(BLOG_INLINE))
    expect(scriptSrc).toContain('https://www.googletagmanager.com')
    expect(scriptSrc).not.toContain('unsafe-inline')
  })
})
