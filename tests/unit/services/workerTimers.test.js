import { describe, it, expect } from 'vitest'
import { workerTimers } from '../../../src/services/workerTimers.js'

// Under jsdom there is no Worker constructor, so the wrapper falls back to
// native setTimeout/setInterval. These tests exercise the fallback path —
// the worker path can only be observed in a real browser. The key contract
// is that the public API matches the natives: callbacks fire, clears cancel.

describe('workerTimers', () => {
  it('setTimeout fires the callback after the delay', async () => {
    let fired = false
    workerTimers.setTimeout(() => { fired = true }, 10)
    await new Promise(r => setTimeout(r, 40))
    expect(fired).toBe(true)
  })

  it('clearTimeout cancels a pending callback', async () => {
    let fired = false
    const handle = workerTimers.setTimeout(() => { fired = true }, 10)
    workerTimers.clearTimeout(handle)
    await new Promise(r => setTimeout(r, 40))
    expect(fired).toBe(false)
  })

  it('setInterval fires repeatedly until cleared', async () => {
    let count = 0
    const handle = workerTimers.setInterval(() => { count++ }, 10)
    await new Promise(r => setTimeout(r, 55))
    workerTimers.clearInterval(handle)
    const stopped = count
    await new Promise(r => setTimeout(r, 40))
    expect(stopped).toBeGreaterThanOrEqual(3)
    expect(count).toBe(stopped) // no further ticks after clear
  })

  it('clear is a no-op for a null/undefined handle', () => {
    expect(() => workerTimers.clearTimeout(null)).not.toThrow()
    expect(() => workerTimers.clearInterval(undefined)).not.toThrow()
  })
})
