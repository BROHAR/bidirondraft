import express from 'express'
import path from 'node:path'
import { createHash, timingSafeEqual } from 'node:crypto'
import { insertSubscriber, listSubscribers } from './db.js'

// Deliberately simple validation: enough to reject garbage and typos without
// chasing the full RFC. 254 chars is the SMTP max address length.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Hash both sides before comparing so timingSafeEqual gets equal-length
// buffers — a plain compare would throw (and leak length) on mismatched sizes.
function tokenMatches(provided, expected) {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export function createApp({ db, distDir, adminToken, rateLimiter }) {
  const app = express()
  // Trust exactly one proxy hop (Railway's edge), so req.ip is the rightmost
  // X-Forwarded-For entry — the one Railway appended. Leftmost entries are
  // client-supplied and trivially spoofed; never rate-limit on those.
  app.set('trust proxy', 1)
  app.disable('x-powered-by')

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('X-Frame-Options', 'DENY')
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store')
    next()
  })
  app.use(express.json({ limit: '2kb' }))

  app.get('/api/health', (req, res) => res.json({ ok: true }))

  app.post('/api/subscribe', (req, res) => {
    if (!rateLimiter.allow(req.ip)) {
      return res.status(429).json({ ok: false, error: 'Too many requests. Try again later.' })
    }
    const { email, source, website } = req.body ?? {}
    // Honeypot: humans never see the `website` field. Report success so bots
    // don't learn they were filtered.
    if (typeof website === 'string' && website.trim() !== '') {
      return res.json({ ok: true })
    }
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : ''
    if (!normalized || normalized.length > 254 || !EMAIL_RE.test(normalized)) {
      return res.status(400).json({ ok: false, error: 'Enter a valid email address.' })
    }
    insertSubscriber(db, normalized, typeof source === 'string' ? source.slice(0, 32) : null)
    // Duplicates also land here: always generic success, no enumeration.
    return res.json({ ok: true })
  })

  // Export endpoint for the site owner. Without ADMIN_TOKEN configured in the
  // environment it 404s unconditionally — indistinguishable from not existing,
  // which is the safe default for a public codebase.
  app.get('/api/admin/subscribers', (req, res) => {
    const provided = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!adminToken || !provided || !tokenMatches(provided, adminToken)) {
      return res.status(404).json({ ok: false })
    }
    return res.json({ ok: true, subscribers: listSubscribers(db) })
  })

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false })
    next()
  })
  app.use(express.static(distDir))
  // SPA fallback (Express 5 dropped the '*' route syntax; plain middleware
  // after express.static covers every remaining path).
  app.use((req, res) => res.sendFile(path.join(distDir, 'index.html')))

  // Body-parser failures (malformed JSON, oversized payload) end up here;
  // answer with clean JSON instead of an HTML error page. Express only treats
  // a middleware as an error handler when it declares all four parameters.
  app.use((err, req, res, next) => {
    res.status(err?.type === 'entity.too.large' ? 413 : 400).json({ ok: false })
  })

  return app
}
