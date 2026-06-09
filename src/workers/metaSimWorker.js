// Web Worker shell over the pure meta-simulation core. Keeps the main thread
// responsive while N drafts run. players.json is passed IN the message (never
// imported here) so it stays out of the worker chunk.
import { runMetaSimulation } from '../utils/metaSimulation.js'

self.onmessage = (e) => {
  const { type, config, playersData, strategies, draftsPerStrategy, baseSeed } = e.data || {}
  if (type !== 'run') return
  try {
    const result = runMetaSimulation(config, playersData, {
      strategies,
      draftsPerStrategy,
      baseSeed,
      onProgress: (done, total) => self.postMessage({ type: 'progress', done, total }),
    })
    self.postMessage({ type: 'done', result })
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) })
  }
}
