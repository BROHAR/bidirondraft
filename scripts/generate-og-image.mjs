// One-shot generator for the social share image (public/og-image.png).
//
// Renders a 1200x630 branded card with Playwright (Chromium) and screenshots
// it. Run with: node scripts/generate-og-image.mjs
//
// Re-run this whenever the brand (logo, wordmark colors, tagline) changes.
// The card mirrors the title screen: night-navy field, pixel Lombardi trophy,
// gold "BID" + green "IRON" wordmark in Chakra Petch with a chunky pixel shadow.

import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const out = resolve(repoRoot, 'public/og-image.png')

// Inline the trophy mark so there are no asset-path / network dependencies.
const trophySvg = readFileSync(resolve(repoRoot, 'public/assets/trophy-lombardi.svg'), 'utf8')

// Brand tokens (from src/styles/design-tokens.css)
const NAVY = '#0b0d2a'
const NAVY_HUD = '#14183d'
const GOLD = '#f5c518'
const GREEN = '#5fd96f'
const RED = '#c8102e'
const INK = '#0a0a0a'
const MUTED = '#c8c8c8'

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    font-family: 'Chakra Petch', monospace;
    background: ${NAVY};
    background-image:
      radial-gradient(120% 90% at 78% 18%, ${NAVY_HUD} 0%, ${NAVY} 60%),
      repeating-linear-gradient(0deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 4px);
    color: #fff;
    overflow: hidden;
  }
  .frame {
    position: absolute; inset: 28px;
    border: 6px solid ${INK};
    box-shadow: inset 0 0 0 3px rgba(255,255,255,0.06);
  }
  .accent { position: absolute; left: 28px; right: 28px; top: 28px; height: 12px; background: ${RED}; }
  .accent.bottom { top: auto; bottom: 28px; }
  .stage {
    position: absolute; inset: 28px;
    display: flex; align-items: center; gap: 64px;
    padding: 0 96px;
  }
  .mark { width: 300px; height: 300px; flex: none; filter: drop-shadow(8px 8px 0 ${INK}); }
  .mark svg { width: 100%; height: 100%; image-rendering: pixelated; }
  .copy { display: flex; flex-direction: column; }
  .wordmark {
    font-weight: 700; font-size: 152px; line-height: 0.86;
    letter-spacing: 0.03em; text-shadow: 8px 8px 0 ${INK};
  }
  .wordmark .bid { color: ${GOLD}; }
  .wordmark .iron { color: ${GREEN}; }
  .tagline {
    margin-top: 26px; font-weight: 600; font-size: 32px;
    letter-spacing: 0.18em; text-transform: uppercase; color: #fff;
  }
  .domain {
    margin-top: 22px; font-weight: 700; font-size: 26px;
    letter-spacing: 0.22em; text-transform: uppercase; color: ${MUTED};
  }
  .domain b { color: ${GOLD}; }
</style>
</head>
<body>
  <div class="accent"></div>
  <div class="frame"></div>
  <div class="stage">
    <div class="mark">${trophySvg}</div>
    <div class="copy">
      <div class="wordmark"><span class="bid">BID</span><span class="iron">IRON</span></div>
      <div class="tagline">Fantasy Football · Auction Draft</div>
      <div class="domain">▸ <b>bidirondraft.com</b></div>
    </div>
  </div>
  <div class="accent bottom"></div>
</body>
</html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.setContent(html, { waitUntil: 'networkidle' })
// Make sure the web font is actually rendered before we snapshot.
await page.evaluate(() => document.fonts.ready)
await page.screenshot({ path: out, type: 'png' })
await browser.close()

console.log(`✓ Wrote ${out}`)
