// Web Worker timer pump. Lives off the main thread so Chrome's background-tab
// throttling does not delay draft callbacks. Each entry is fired via
// postMessage; the main-thread wrapper invokes the real callback.

const entries = new Map()

function tick() {
  const now = performance.now()
  for (const [id, entry] of entries) {
    if (now >= entry.fireAt) {
      self.postMessage({ id })
      if (entry.intervalMs > 0) {
        entry.fireAt = now + entry.intervalMs
      } else {
        entries.delete(id)
      }
    }
  }
}

setInterval(tick, 50)

self.onmessage = (event) => {
  const { type, id, delayMs, intervalMs } = event.data
  if (type === 'set') {
    entries.set(id, {
      fireAt: performance.now() + delayMs,
      intervalMs: intervalMs || 0
    })
  } else if (type === 'clear') {
    entries.delete(id)
  }
}
