import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

// Content-Security-Policy for every response, built at server start.
//
// The site ships a handful of *static* inline scripts (the gtag bootstrap in
// index.html and the GA snippet + signup handler on every generated blog
// page). Rather than 'unsafe-inline', we allow exactly those scripts by
// SHA-256 hash — and rather than hard-coding hashes that drift the moment a
// template changes, we derive them from the built dist/ at startup: scan
// every .html file, extract executable inline <script> bodies, hash them.
// Railway runs `npm run build` before `npm start`, so dist/ always reflects
// what is actually served. A template edit changes the served bytes and the
// computed hash in the same deploy — they cannot desync.

const SCRIPT_TAG_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi

// Inline <script> bodies that the browser will execute (and CSP will check).
// External scripts (src=) are covered by the script-src host allowlist, and
// data blocks like <script type="application/ld+json"> are inert — script-src
// does not apply to them, so they need no hash.
export function extractInlineScripts(html) {
  const out = []
  for (const match of html.matchAll(SCRIPT_TAG_RE)) {
    const [, attrs, body] = match
    if (/\bsrc\s*=/i.test(attrs)) continue
    const typeMatch = attrs.match(/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
    const type = (typeMatch?.[1] ?? typeMatch?.[2] ?? typeMatch?.[3] ?? '').toLowerCase()
    if (type && type !== 'module' && type !== 'text/javascript' && type !== 'application/javascript') continue
    if (body === '') continue
    out.push(body)
  }
  return out
}

// CSP hash-source for an inline script body: base64 SHA-256 of the exact
// bytes between the <script> tags (no trimming — browsers hash verbatim).
export function scriptHashSource(body) {
  return `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`
}

function htmlFilesUnder(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...htmlFilesUnder(full))
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(full)
  }
  return files
}

// All distinct inline-script hash-sources across the built site. Tolerates a
// missing dist/ (unit tests construct the app around empty fixture dirs).
export function collectScriptHashes(distDir) {
  if (!distDir || !fs.existsSync(distDir)) return []
  const hashes = new Set()
  for (const file of htmlFilesUnder(distDir)) {
    for (const body of extractInlineScripts(fs.readFileSync(file, 'utf8'))) {
      hashes.add(scriptHashSource(body))
    }
  }
  return [...hashes].sort()
}

// Third-party surface, kept deliberately small:
//   - googletagmanager.com serves gtag.js; GA4 beacons go to the
//     google-analytics / analytics.google domains (regional subdomains, hence
//     the wildcards). GA can also fall back to image beacons (img-src).
//   - The stylesheets @import Google Fonts (fonts.googleapis.com CSS,
//     fonts.gstatic.com font files).
//   - 'unsafe-inline' for styles only: React style props render as inline
//     style attributes; the injection risk CSP guards against here is script
//     execution, which stays hash-locked.
export function buildContentSecurityPolicy(scriptHashes) {
  const scriptSrc = ["'self'", ...scriptHashes, 'https://www.googletagmanager.com']
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com",
    "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}
