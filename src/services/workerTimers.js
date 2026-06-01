// Worker-backed setTimeout/setInterval shims. Chrome throttles main-thread
// timers in hidden tabs (~1 Hz, and far worse after ~5 min of "intensive
// throttling"), which stalled auto-pilot drafts mid-pick. A dedicated worker
// ticks at full speed regardless of tab focus.
//
// In environments without Worker (jsdom under Vitest, SSR), we transparently
// fall back to native timers so tests can keep using vi.useFakeTimers().

import TimerWorker from './timerWorker.js?worker'

const callbacks = new Map()
let nextId = 1
let worker = null
let workerFailed = false

function ensureWorker() {
  if (worker || workerFailed) return worker
  if (typeof Worker === 'undefined') {
    workerFailed = true
    return null
  }
  try {
    worker = new TimerWorker()
    worker.onmessage = (event) => {
      const entry = callbacks.get(event.data.id)
      if (!entry) return
      if (!entry.isInterval) callbacks.delete(event.data.id)
      try { entry.fn() } catch (e) { console.error('workerTimer callback threw', e) }
    }
  } catch {
    workerFailed = true
    worker = null
  }
  return worker
}

function schedule(fn, delayMs, isInterval) {
  const w = ensureWorker()
  if (!w) {
    // Native fallback — returned id is the native timer handle so clear* works.
    return isInterval
      ? { native: setInterval(fn, delayMs), isInterval: true }
      : { native: setTimeout(fn, delayMs), isInterval: false }
  }
  const id = nextId++
  callbacks.set(id, { fn, isInterval })
  w.postMessage({
    type: 'set',
    id,
    delayMs,
    intervalMs: isInterval ? delayMs : 0
  })
  return { id, isInterval, worker: true }
}

function cancel(handle) {
  if (!handle) return
  if (handle.worker) {
    callbacks.delete(handle.id)
    if (worker) worker.postMessage({ type: 'clear', id: handle.id })
  } else if (handle.isInterval) {
    clearInterval(handle.native)
  } else {
    clearTimeout(handle.native)
  }
}

export const workerTimers = {
  setTimeout: (fn, delayMs) => schedule(fn, delayMs, false),
  setInterval: (fn, delayMs) => schedule(fn, delayMs, true),
  clearTimeout: cancel,
  clearInterval: cancel
}
