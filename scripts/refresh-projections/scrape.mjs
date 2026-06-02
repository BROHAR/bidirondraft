// Scrape fantasy football projections.
//
// ESPN: fetched from the public kona_player_info JSON API (the same endpoint
// fantasy.espn.com's projections page calls). We moved off DOM scraping because
// ESPN's projections table is *virtualized* — only on-screen rows exist in the
// DOM — so a Playwright/Next-pagination scrape silently dropped a large, fixed
// cohort of players (Mahomes, Herbert, Stafford, ...). The API returns the full
// pool deterministically with projected stats. No auth required.
//
// Yahoo: still scraped via Playwright (its salary-cap page is not virtualized
// and works reliably) for the authoritative auction `estimatedValue`.
//
// Writes the same CSV shape the previous scraper did, so process.mjs is unchanged.

import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { normalizePosition } from './positions.mjs'

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const CSV_COLUMNS = [
  'name', 'position', 'team', 'injury_status',
  // Offensive
  'pass_comp', 'pass_att', 'pass_yds', 'pass_td', 'int',
  'rush_car', 'rush_yds', 'rush_td',
  'rec', 'rec_yds', 'rec_td', 'tar',
  // Defense
  'tackles', 'sacks', 'forced_fumbles', 'fum_rec', 'def_int', 'int_td', 'fum_td',
  // ESPN's projected fantasy points (used directly for K/DST)
  'espn_fpts',
]

const NUMBER_RE = /-?\d+(?:\.\d+)?/
function num(s) {
  if (!s) return 0
  const m = String(s).match(NUMBER_RE)
  return m ? parseFloat(m[0]) : 0
}

// ── ESPN kona_player_info API ───────────────────────────────────────────────

// NFL fantasy season. In-season this is the current year; override with
// ESPN_SEASON if ESPN's projection feed rolls over at a different time.
const SEASON = Number(process.env.ESPN_SEASON) || new Date().getFullYear()

const ESPN_API = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leaguedefaults/3?view=kona_player_info`

// defaultPositionId → our position code. Only app-relevant positions are kept.
const ESPN_POSITION = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST' }

// proTeamId → abbreviation (ESPN's fixed mapping; 0 = free agent).
const ESPN_TEAM = {
  0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
  8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA',
  16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT',
  24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU',
}

// ESPN stat IDs (verified against known 2026 projections). We only need the ones
// process.mjs scores from; pass_comp/pass_att are carried for completeness.
const STAT = {
  pass_comp: 1, pass_att: 0, pass_yds: 3, pass_td: 4, int: 20,
  rush_car: 23, rush_yds: 24, rush_td: 25,
  rec: 53, rec_yds: 42, rec_td: 43, tar: 58,
}

// ESPN injuryStatus → the short superscript codes the app/players.json use.
function mapInjury(status) {
  switch (status) {
    case 'QUESTIONABLE': return 'Q'
    case 'DOUBTFUL': return 'D'
    case 'OUT': return 'O'
    case 'INJURY_RESERVE': return 'IR'
    case 'SUSPENSION': return 'SUSP'
    case 'PHYSICALLY_UNABLE_TO_PERFORM': return 'PUP'
    default: return '' // ACTIVE / NORMAL / undefined
  }
}

const round1 = n => Math.round((n || 0) * 10) / 10

async function fetchEspnProjections() {
  // x-fantasy-filter drives the query. A sort clause is required (the API
  // returns nothing without one). filterStatsForTopScoringPeriodIds with the
  // 00<season>/10<season> ids ensures the season actual + projection stat
  // blocks are included on each player.
  const filter = {
    players: {
      limit: 1500,
      sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'PPR' },
      filterStatsForTopScoringPeriodIds: { value: 2, additionalValue: [`00${SEASON}`, `10${SEASON}`] },
    },
  }

  const res = await fetch(ESPN_API, {
    headers: {
      'x-fantasy-filter': JSON.stringify(filter),
      'x-fantasy-platform': 'kona-PROD',
      'x-fantasy-source': 'kona',
      accept: 'application/json',
      'user-agent': USER_AGENT,
    },
  })
  if (!res.ok) {
    throw new Error(`ESPN API returned HTTP ${res.status} (${ESPN_API})`)
  }
  const data = await res.json()
  const entries = data.players || []
  if (entries.length === 0) {
    throw new Error('ESPN API returned 0 players — the filter or endpoint may have changed.')
  }

  const projId = `10${SEASON}`
  const rows = []
  for (const entry of entries) {
    const pl = entry.player
    if (!pl) continue
    const position = ESPN_POSITION[pl.defaultPositionId]
    if (!position) continue // skip IDP / non-app positions

    const proj = (pl.stats || []).find(s => s.statSourceId === 1 && s.id === projId)
    const st = proj?.stats || {}
    const espn_fpts = round1(proj?.appliedTotal)

    const base = {
      name: pl.fullName,
      position,
      team: ESPN_TEAM[pl.proTeamId] ?? '',
      injury_status: mapInjury(pl.injuryStatus),
      espn_fpts,
    }

    if (position === 'K' || position === 'DST') {
      // K/DST score off ESPN's projected total directly (process.mjs).
      rows.push(base)
      continue
    }

    // Offensive players: carry raw stats so process.mjs computes std/half/ppr.
    // Skip players projected for 0 points — undraftable, and keeps the pool
    // close to its historical size instead of dumping ~1000 entries.
    if (espn_fpts <= 0) continue
    const g = id => round1(st[id])
    rows.push({
      ...base,
      pass_comp: g(STAT.pass_comp),
      pass_att: g(STAT.pass_att),
      pass_yds: g(STAT.pass_yds),
      pass_td: g(STAT.pass_td),
      int: g(STAT.int),
      rush_car: g(STAT.rush_car),
      rush_yds: g(STAT.rush_yds),
      rush_td: g(STAT.rush_td),
      rec: g(STAT.rec),
      rec_yds: g(STAT.rec_yds),
      rec_td: g(STAT.rec_td),
      tar: g(STAT.tar),
    })
  }
  return rows
}

function rowToCsv(row) {
  return CSV_COLUMNS.map(col => {
    const v = row[col]
    if (v === undefined || v === null) return '0'
    if (typeof v === 'string' && v.includes(',')) return `"${v.replace(/"/g, '""')}"`
    return String(v)
  }).join(',')
}

// ── Yahoo salary-cap "Proj $" (Playwright) ──────────────────────────────────

// Yahoo's draft analysis salary-cap page: each player's "Proj $" auction value.
// Public page, ?count=500 returns 500 rows in one request.
const YAHOO_URL = 'https://football.fantasysports.yahoo.com/f1/draftanalysis?type=salcap&count=500'

async function scrapeYahooSalcap(page) {
  await page.goto(YAHOO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('table tbody tr', { timeout: 30000 })
  await page.waitForTimeout(2000)
  const rows = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('table tbody tr'))
    return trs.map(tr => {
      const tds = Array.from(tr.querySelectorAll('td'))
      const nameEl = tds[0]?.querySelector('[data-tst="player-name"]')
      const posEl = tds[0]?.querySelector('[data-tst="player-position"]')
      const teamText = posEl?.parentElement?.textContent?.trim() || ''
      const teamMatch = teamText.match(/^([A-Za-z]{1,3})\s*-/)
      return {
        name: nameEl?.textContent?.trim() || '',
        team: teamMatch ? teamMatch[1] : '',
        position: posEl?.textContent?.trim() || '',
        projDollars: tds[tds.length - 1]?.textContent?.trim() || '',
      }
    })
  })
  return rows
    .map(r => ({
      name: r.name,
      team: r.team.toUpperCase(),
      position: normalizePosition(r.position),
      projDollars: num(r.projDollars),
    }))
    .filter(r => r.name && r.position)
}

function rowToYahooCsv(row) {
  return [row.name, row.position, row.team, row.projDollars].map(v => {
    const s = String(v ?? '')
    return s.includes(',') ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')
}

// ── Orchestration ───────────────────────────────────────────────────────────

export async function scrapeAll(opts = {}) {
  const { outputDir = 'data/projections' } = opts

  fs.mkdirSync(outputDir, { recursive: true })

  console.log(`→ Fetching ESPN projections (kona_player_info API, season ${SEASON})...`)
  const allRows = await fetchEspnProjections()
  console.log(`  ${allRows.length} players (positions: ${Object.entries(countBy(allRows, 'position')).map(([k, v]) => `${k}=${v}`).join(', ')})`)
  if (allRows.length < 400) {
    throw new Error(`ESPN API returned only ${allRows.length} usable players — expected several hundred.`)
  }

  console.log('→ Scraping Yahoo salary-cap "Proj $" values...')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const yahoo = await scrapeYahooSalcap(page)
  await browser.close()
  console.log(`  ${yahoo.length} players (positions: ${Object.entries(countBy(yahoo, 'position')).map(([k, v]) => `${k}=${v}`).join(', ')})`)

  const date = new Date().toISOString().slice(0, 10)
  const csvPath = path.join(outputDir, `projections-${date}.csv`)
  const csvBody = [CSV_COLUMNS.join(','), ...allRows.map(rowToCsv)].join('\n')
  fs.writeFileSync(csvPath, csvBody + '\n')
  console.log(`✓ Wrote ${allRows.length} rows to ${csvPath}`)

  const yahooCsvPath = path.join(outputDir, `yahoo-salcap-${date}.csv`)
  const yahooBody = ['name,position,team,proj_dollars', ...yahoo.map(rowToYahooCsv)].join('\n')
  fs.writeFileSync(yahooCsvPath, yahooBody + '\n')
  console.log(`✓ Wrote ${yahoo.length} rows to ${yahooCsvPath}`)

  return { csvPath, yahooCsvPath }
}

function countBy(arr, key) {
  const out = {}
  for (const x of arr) out[x[key]] = (out[x[key]] || 0) + 1
  return out
}
