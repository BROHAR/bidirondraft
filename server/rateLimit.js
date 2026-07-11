// Fixed-window rate limiter, in-memory per instance. The site runs as a single
// Railway replica, so a shared store would be overkill; the map resets on
// deploy, which is acceptable for a signup endpoint. `now` is injectable so
// tests can advance the clock.
export function createRateLimiter({ limit = 5, windowMs = 10 * 60 * 1000, now = Date.now } = {}) {
  const hits = new Map() // ip -> { count, windowStart }
  return {
    allow(ip) {
      const t = now()
      // Opportunistic cleanup so the map can't grow unbounded under abuse.
      if (hits.size > 10000) {
        for (const [key, rec] of hits) {
          if (t - rec.windowStart > windowMs) hits.delete(key)
        }
      }
      const rec = hits.get(ip)
      if (!rec || t - rec.windowStart > windowMs) {
        hits.set(ip, { count: 1, windowStart: t })
        return true
      }
      rec.count += 1
      return rec.count <= limit
    },
  }
}
