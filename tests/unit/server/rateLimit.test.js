// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { createRateLimiter } from '../../../server/rateLimit.js'

describe('createRateLimiter', () => {
  it('allows up to the limit within a window, then blocks', () => {
    let t = 0
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t })
    expect(limiter.allow('1.2.3.4')).toBe(true)
    expect(limiter.allow('1.2.3.4')).toBe(true)
    expect(limiter.allow('1.2.3.4')).toBe(true)
    expect(limiter.allow('1.2.3.4')).toBe(false)
  })

  it('tracks IPs independently', () => {
    let t = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t })
    expect(limiter.allow('1.1.1.1')).toBe(true)
    expect(limiter.allow('1.1.1.1')).toBe(false)
    expect(limiter.allow('2.2.2.2')).toBe(true)
  })

  it('resets after the window elapses', () => {
    let t = 0
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t })
    expect(limiter.allow('1.2.3.4')).toBe(true)
    expect(limiter.allow('1.2.3.4')).toBe(false)
    t = 1001
    expect(limiter.allow('1.2.3.4')).toBe(true)
  })
})
