// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openDb, listSubscribers } from '../../../server/db.js'
import { createApp } from '../../../server/app.js'
import { createRateLimiter } from '../../../server/rateLimit.js'

// Exercises the real HTTP surface: createApp on an in-memory SQLite database,
// listening on an ephemeral port, driven with Node's global fetch.

let db
let server
let baseUrl
let clock
let distDir

function startServer({ adminToken = null, limit = 5 } = {}) {
  db = openDb(':memory:')
  clock = { t: 0 }
  const app = createApp({
    db,
    distDir,
    adminToken,
    rateLimiter: createRateLimiter({ limit, windowMs: 1000, now: () => clock.t }),
  })
  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`
      resolve()
    })
  })
}

function subscribe(body, opts = {}) {
  return fetch(`${baseUrl}/api/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adraft-dist-'))
  fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>fixture</title>')
})

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
  server = null
  db?.close()
  db = null
  fs.rmSync(distDir, { recursive: true, force: true })
})

describe('POST /api/subscribe', () => {
  it('stores a valid email, trimmed and lowercased', async () => {
    await startServer()
    const res = await subscribe({ email: '  Fan@Example.COM ', source: 'title' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(listSubscribers(db)).toMatchObject([{ email: 'fan@example.com', source: 'title' }])
  })

  it('returns generic success for duplicates and keeps one row', async () => {
    await startServer()
    await subscribe({ email: 'fan@example.com', source: 'title' })
    const res = await subscribe({ email: 'FAN@example.com', source: 'postdraft' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(listSubscribers(db)).toHaveLength(1)
  })

  it.each([
    ['missing email', {}],
    ['non-string email', { email: 42 }],
    ['no @', { email: 'not-an-email' }],
    ['no TLD', { email: 'a@b' }],
    ['whitespace inside', { email: 'a b@c.com' }],
    ['over 254 chars', { email: `${'a'.repeat(250)}@example.com` }],
  ])('rejects %s with 400 and stores nothing', async (_label, body) => {
    await startServer()
    const res = await subscribe(body)
    expect(res.status).toBe(400)
    expect(listSubscribers(db)).toHaveLength(0)
  })

  it('accepts but does not store honeypot submissions', async () => {
    await startServer()
    const res = await subscribe({ email: 'bot@example.com', website: 'http://spam.example' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(listSubscribers(db)).toHaveLength(0)
  })

  it('truncates source to 32 chars and ignores non-string source', async () => {
    await startServer()
    await subscribe({ email: 'a@example.com', source: 'x'.repeat(100) })
    await subscribe({ email: 'b@example.com', source: { evil: true } })
    const rows = listSubscribers(db)
    expect(rows[0].source).toBe('x'.repeat(32))
    expect(rows[1].source).toBeNull()
  })

  it('rate limits per IP and recovers after the window', async () => {
    await startServer({ limit: 2 })
    expect((await subscribe({ email: 'a@example.com' })).status).toBe(200)
    expect((await subscribe({ email: 'b@example.com' })).status).toBe(200)
    const blocked = await subscribe({ email: 'c@example.com' })
    expect(blocked.status).toBe(429)
    expect(listSubscribers(db)).toHaveLength(2)
    clock.t = 1001
    expect((await subscribe({ email: 'c@example.com' })).status).toBe(200)
  })

  it('answers malformed JSON with 400 JSON, not an HTML error page', async () => {
    await startServer()
    const res = await subscribe('{not json')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ ok: false })
  })

  it('rejects oversized bodies with 413 JSON', async () => {
    await startServer()
    const res = await subscribe({ email: 'a@example.com', padding: 'x'.repeat(5000) })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ ok: false })
  })
})

describe('GET /api/admin/subscribers', () => {
  it('404s when no ADMIN_TOKEN is configured, even with a header', async () => {
    await startServer({ adminToken: null })
    const res = await fetch(`${baseUrl}/api/admin/subscribers`, {
      headers: { Authorization: 'Bearer anything' },
    })
    expect(res.status).toBe(404)
  })

  it('404s on a wrong or missing token', async () => {
    await startServer({ adminToken: 'secret-token' })
    expect((await fetch(`${baseUrl}/api/admin/subscribers`)).status).toBe(404)
    const wrong = await fetch(`${baseUrl}/api/admin/subscribers`, {
      headers: { Authorization: 'Bearer nope' },
    })
    expect(wrong.status).toBe(404)
  })

  it('returns subscribers with the correct token', async () => {
    await startServer({ adminToken: 'secret-token' })
    await subscribe({ email: 'fan@example.com', source: 'setup' })
    const res = await fetch(`${baseUrl}/api/admin/subscribers`, {
      headers: { Authorization: 'Bearer secret-token' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.subscribers).toMatchObject([{ email: 'fan@example.com', source: 'setup' }])
  })
})

describe('static serving', () => {
  it('serves the SPA fallback for unknown non-API paths', async () => {
    await startServer()
    const res = await fetch(`${baseUrl}/some/deep/route`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('fixture')
  })

  it('404s unknown /api/ paths as JSON instead of falling back to the SPA', async () => {
    await startServer()
    const res = await fetch(`${baseUrl}/api/nope`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false })
  })
})
