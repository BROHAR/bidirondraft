import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from './db.js'
import { createApp } from './app.js'
import { createRateLimiter } from './rateLimit.js'

// Production entry point (`npm start`). Serves the built dist/ and the
// /api/subscribe endpoint from one process. Configuration comes from the
// environment so nothing sensitive lives in this public repo:
//   DATA_DIR     — where subscribers.db lives (Railway volume: /data);
//                  defaults to ./data-local for local development (gitignored)
//   ADMIN_TOKEN  — enables GET /api/admin/subscribers; unset = endpoint 404s
//   PORT         — listen port (Railway injects this)

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dataDir = process.env.DATA_DIR || path.join(root, 'data-local')
const db = openDb(dataDir)

const app = createApp({
  db,
  distDir: path.join(root, 'dist'),
  adminToken: process.env.ADMIN_TOKEN || null,
  rateLimiter: createRateLimiter(),
})

const port = Number(process.env.PORT) || 8080
app.listen(port, () => {
  console.log(`BIDIRON server listening on :${port} (data dir: ${dataDir})`)
})
