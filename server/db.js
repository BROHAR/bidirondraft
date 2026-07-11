import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

// Subscriber storage for the news & updates signup. SQLite via better-sqlite3:
// the whole database is one file under DATA_DIR (a Railway volume in
// production, ./data-local in development), so there is no external database
// service to configure or credential to leak from this public repo.

// Pass ':memory:' as dataDir for an in-memory database (tests).
export function openDb(dataDir) {
  let db
  if (dataDir === ':memory:') {
    db = new Database(':memory:')
  } else {
    fs.mkdirSync(dataDir, { recursive: true })
    db = new Database(path.join(dataDir, 'subscribers.db'))
  }
  db.pragma('journal_mode = WAL')
  db.exec(`CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    source TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`)
  return db
}

// Duplicate emails are silently ignored — the route always reports success so
// responses never reveal whether an address was already subscribed.
export function insertSubscriber(db, email, source) {
  db.prepare('INSERT INTO subscribers (email, source) VALUES (?, ?) ON CONFLICT(email) DO NOTHING')
    .run(email, source)
}

export function listSubscribers(db) {
  return db.prepare('SELECT email, source, created_at FROM subscribers ORDER BY id').all()
}
