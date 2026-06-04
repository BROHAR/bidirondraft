// One-shot generator for raster app icons derived from the SVG favicon.
//
// Renders public/assets/favicon.svg to a 180x180 apple-touch-icon.png (the
// size iOS/Safari use for home-screen bookmarks; iOS rounds the corners, and
// the favicon's full-bleed navy square fills them cleanly). Run with:
//   node scripts/generate-icons.mjs
// Re-run whenever favicon.svg changes.

import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const faviconSvg = readFileSync(resolve(repoRoot, 'public/assets/favicon.svg'), 'utf8')
const out = resolve(repoRoot, 'public/apple-touch-icon.png')

const SIZE = 180
const html = `<!doctype html><html><head><style>
  * { margin: 0; padding: 0; }
  html, body { width: ${SIZE}px; height: ${SIZE}px; }
  svg { display: block; width: ${SIZE}px; height: ${SIZE}px; }
</style></head><body>${faviconSvg}</body></html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 })
await page.setContent(html, { waitUntil: 'load' })
await page.screenshot({ path: out, type: 'png' })
await browser.close()

console.log(`✓ Wrote ${out}`)
