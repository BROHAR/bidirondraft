// Scrape ESPN fantasy football projections (Sortable Projections view).
// Scrapes the "All" view across N pages, plus a dedicated D/ST scrape for
// defenses (ESPN's K position filter is broken — doesn't actually filter
// rows — but kickers naturally appear in the top 500 by projected points).
// Writes a CSV with raw passing/rushing/receiving stats + ESPN's fantasy pts.

import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { normalizePosition } from './positions.mjs'

const URL = 'https://fantasy.espn.com/football/players/projections?leagueFormatId=3'
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const CSV_COLUMNS = [
  'name', 'position', 'team', 'injury_status',
  // Offensive
  'pass_comp', 'pass_att', 'pass_yds', 'pass_td', 'int',
  'rush_car', 'rush_yds', 'rush_td',
  'rec', 'rec_yds', 'rec_td', 'tar',
  // Defense
  'tackles', 'sacks', 'forced_fumbles', 'fum_rec', 'def_int', 'int_td', 'fum_td',
  // ESPN's projected fantasy points (PPR scoring; used directly for K/DST)
  'espn_fpts',
]

const NUMBER_RE = /-?\d+(?:\.\d+)?/

function num(s) {
  if (!s) return 0
  const m = String(s).match(NUMBER_RE)
  return m ? parseFloat(m[0]) : 0
}

// "12/25" -> [12, 25]
function fraction(s) {
  if (!s) return [0, 0]
  const parts = String(s).split('/')
  return [num(parts[0]), num(parts[1])]
}

// Extract structured rows from the three side-by-side tables (player / stats /
// fantasy pts). Uses HTML structure (not text suffix matching) for player info.
async function extractCurrentPageRows(page) {
  return page.evaluate(() => {
    const leftTable = document.querySelector('table.Table--fixed-left')
    const rightTable = document.querySelector('table.Table--fixed-right')
    const middleTable = Array.from(document.querySelectorAll('table.Table--align-right'))
      .find(t => !t.classList.contains('Table--fixed-left') && !t.classList.contains('Table--fixed-right'))
    if (!leftTable || !middleTable || !rightTable) return []

    const leftRows = Array.from(leftTable.querySelectorAll('tbody tr'))
    const middleRows = Array.from(middleTable.querySelectorAll('tbody tr'))
    const rightRows = Array.from(rightTable.querySelectorAll('tbody tr'))
    const n = Math.min(leftRows.length, middleRows.length, rightRows.length)

    const out = []
    for (let i = 0; i < n; i++) {
      // Target the <a> inside .player-column__athlete so the sibling
      // injury-status span (e.g. "Q" for Questionable) doesn't bleed into the
      // name. Falls back to the div's title attribute if the anchor is absent
      // (e.g. for D/ST rows that may render slightly differently).
      const nameEl = leftRows[i].querySelector('.player-column__athlete a')
      const teamEl = leftRows[i].querySelector('.playerinfo__playerteam')
      const posEl = leftRows[i].querySelector('.playerinfo__playerpos')
      const injuryEl = leftRows[i].querySelector('.player-column__athlete .playerinfo__injurystatus')
      const name = nameEl?.textContent?.trim()
        || leftRows[i].querySelector('.player-column__athlete')?.getAttribute('title')?.trim()
        || ''
      const team = teamEl?.textContent?.trim() || ''
      const position = posEl?.textContent?.trim() || ''
      const injuryStatus = injuryEl?.textContent?.trim() || ''
      const stats = Array.from(middleRows[i].querySelectorAll('td')).map(td => td.textContent?.trim() || '')
      const fpts = Array.from(rightRows[i].querySelectorAll('td')).map(td => td.textContent?.trim() || '')
      // For D/ST, the team cell holds full name and position is "D/ST". Strip
      // the trailing " D/ST" from the leftRow's title attribute / span text so
      // names look like "Broncos D/ST".
      out.push({ name, team, position, injuryStatus, stats, fpts })
    }
    return out
  })
}

async function setupSortableView(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('table.Table', { timeout: 30000 })
  await page.waitForTimeout(2000)
  // Click "Sortable Projections" via DOM (sticky nav intercepts real clicks)
  const switched = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button.player--filters__projections-button'))
      .find(b => b.textContent?.trim() === 'Sortable Projections')
    if (!btn) return false
    btn.click()
    return true
  })
  if (!switched) throw new Error('Could not switch to Sortable Projections view')
  await page.waitForSelector('table.Table--fixed-left', { timeout: 15000 })
  // Long warmup wait — the page's pagination component doesn't reliably
  // process the first Next click until ~10s after Sortable view loads.
  // Empirically anything shorter causes the first page advance to silently fail.
  await page.waitForTimeout(10000)
}

// Click the TOT (total projected fantasy points) column header so the top-N
// scrape captures the highest-projected players. ESPN's default sort isn't
// always points-descending, which was causing legitimate fantasy starters
// like Mahomes / Herbert to fall outside the top 500 rows. Clicks again if
// the first click landed in ascending order.
async function sortByTotalPoints(page) {
  const readFirstName = () => page.evaluate(() =>
    document.querySelector('table.Table--fixed-left tbody tr .player-column__athlete a')
      ?.textContent?.trim() || ''
  )
  const readFirstTotal = () => page.evaluate(() => {
    // The right-hand table holds the projected-points columns; its first td
    // per row is the TOT total.
    const tables = document.querySelectorAll('table.Table')
    const right = tables[tables.length - 1]
    return parseFloat(right?.querySelector('tbody tr td')?.textContent || '0')
  })
  const clickTotHeader = () => page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('table th'))
    const target = headers.find(h => /^(tot|fpts|proj)$/i.test(h.textContent?.trim() || ''))
    if (!target) return false
    target.click()
    return true
  })

  // If the table already loads sorted by TOT descending (ESPN's default in
  // 2026), skip the sort dance entirely — clicking would only flip to
  // ascending and force a second click to flip back.
  const startingTotal = await readFirstTotal()
  if (startingTotal >= 50) {
    return
  }

  const before = await readFirstName()
  if (!(await clickTotHeader())) throw new Error('TOT sort header not found')
  try {
    await page.waitForFunction(
      prev => {
        const cur = document.querySelector('table.Table--fixed-left tbody tr .player-column__athlete a')
          ?.textContent?.trim() || ''
        return cur && cur !== prev
      },
      before,
      { timeout: 15000 }
    )
  } catch {
    // If the first row didn't change the table may already have been sorted
    // by total points — that's fine, we'll verify direction below.
  }
  await page.waitForTimeout(1500)

  // If the top row's total is suspiciously low we got ascending order — click
  // once more to flip to descending. Threshold of 50 is well below any
  // starter's projected total and well above a deep bench player's.
  const firstTotal = await readFirstTotal()
  if (firstTotal < 50) {
    await clickTotHeader()
    await page.waitForTimeout(2000)
  }
}

async function filterPosition(page, label, expectedPositionChip) {
  const clicked = await page.evaluate(target => {
    const l = Array.from(document.querySelectorAll('label.picker-option'))
      .find(x => x.textContent?.trim() === target)
    if (!l) return false
    l.click()
    return true
  }, label)
  if (!clicked) throw new Error(`Position filter "${label}" not found`)
  // Wait for the filter to actually apply: the first row's position chip
  // should match the expected position. ESPN's filter is async (~3-8s).
  try {
    await page.waitForFunction(
      expected => {
        const chip = document.querySelector('table.Table--fixed-left tbody tr .playerinfo__playerpos')
        return chip && chip.textContent?.trim() === expected
      },
      expectedPositionChip,
      { timeout: 20000 }
    )
  } catch {
    throw new Error(`Position filter "${label}" did not apply (chip never matched "${expectedPositionChip}")`)
  }
  await page.waitForTimeout(1500)
}

// Click "Next" pagination and wait for the table's first row to change.
// ESPN's pagination is async with ~3-6s update latency and is sometimes
// flaky — we retry the click once if the content didn't update.
async function gotoNextPage(page) {
  const prevFirst = await page.evaluate(() => {
    const f = document.querySelector('table.Table--fixed-left tbody tr .player-column__athlete')
    return f?.textContent?.trim() || ''
  })

  for (let attempt = 1; attempt <= 2; attempt++) {
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('button.Pagination__Button--next')
      if (!btn || btn.disabled) return false
      btn.click()
      return true
    })
    if (!clicked) return false

    try {
      await page.waitForFunction(
        previous => {
          const first = document.querySelector('table.Table--fixed-left tbody tr .player-column__athlete')
          return first && first.textContent?.trim() !== previous
        },
        prevFirst,
        { timeout: 15000 }
      )
      await page.waitForTimeout(1500)
      return true
    } catch {
      // Click was swallowed; try one more time
      if (attempt === 1) {
        await page.waitForTimeout(2000)
        continue
      }
      return false
    }
  }
  return false
}

function parseOffensiveRow(row) {
  const position = normalizePosition(row.position)
  // Drop the row entirely when no app-relevant position remains
  // (e.g. CB-only, LB-only). Multi-position players keep the first
  // app-relevant code (e.g. WR,CB → WR).
  if (!position) return null
  // Stats columns when no position filter (or All filter) is active:
  //   C/A, PassYDS, PassTD, INT, CAR, RushYDS, RushTD, REC, RecYDS, RecTD, TAR, %ROST, +/-
  const [pass_comp, pass_att] = fraction(row.stats[0])
  return {
    name: row.name,
    position,
    team: row.team,
    injury_status: row.injuryStatus || '',
    pass_comp,
    pass_att,
    pass_yds: num(row.stats[1]),
    pass_td: num(row.stats[2]),
    int: num(row.stats[3]),
    rush_car: num(row.stats[4]),
    rush_yds: num(row.stats[5]),
    rush_td: num(row.stats[6]),
    rec: num(row.stats[7]),
    rec_yds: num(row.stats[8]),
    rec_td: num(row.stats[9]),
    tar: num(row.stats[10]),
    espn_fpts: num(row.fpts[0]),
  }
}

function parseDefenseRow(row) {
  // After D/ST filter, middle table columns are:
  //   TT, SCK, FF, FR, INT, ITD, FTD, %ROST, +/-
  return {
    name: row.name,
    position: 'DST',
    team: row.team,
    injury_status: row.injuryStatus || '',
    tackles: num(row.stats[0]),
    sacks: num(row.stats[1]),
    forced_fumbles: num(row.stats[2]),
    fum_rec: num(row.stats[3]),
    def_int: num(row.stats[4]),
    int_td: num(row.stats[5]),
    fum_td: num(row.stats[6]),
    espn_fpts: num(row.fpts[0]),
  }
}

async function scrapePages(page, maxPages, parser, label = '') {
  const rows = []
  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const raw = await extractCurrentPageRows(page)
    if (raw.length === 0) {
      console.log(`    [page ${pageNum}] empty rows, stopping`)
      break
    }
    const firstName = raw[0]?.name || ''
    console.log(`    [page ${pageNum}] ${raw.length} rows starting with ${firstName}`)
    for (const r of raw) {
      const parsed = parser(r)
      if (parsed && parsed.name) rows.push(parsed)
    }
    if (pageNum < maxPages) {
      const advanced = await gotoNextPage(page)
      if (!advanced) {
        console.log(`    [page ${pageNum}->next] failed to advance, stopping`)
        break
      }
    }
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

// Yahoo's draft analysis salary-cap page: gives each player's "Proj $" auction
// valuation. Public page, no login required. ?count=500 returns 500 rows in
// one request (no pagination loop needed).
const YAHOO_URL = 'https://football.fantasysports.yahoo.com/f1/draftanalysis?type=salcap&count=500'

async function scrapeYahooSalcap(page) {
  await page.goto(YAHOO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForSelector('table tbody tr', { timeout: 30000 })
  await page.waitForTimeout(2000)
  // Yahoo's player cell has structured elements:
  //   [data-tst="player-name"]: name
  //   [data-tst="player-position"]: position chip (WR/RB/QB/TE/K/D)
  //   Team is the text-node sibling of the position span ("NE - WR" => team="NE")
  // A trailing "NA" status badge in the same cell would otherwise corrupt the
  // position if we relied on textContent.
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

export async function scrapeAll(opts = {}) {
  const { offensivePages = 10, dstPages = 1, outputDir = 'data/projections' } = opts

  fs.mkdirSync(outputDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ userAgent: USER_AGENT, viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()

  console.log('→ Loading ESPN projections...')
  await setupSortableView(page)
  console.log('→ Sorting by TOT (projected points, descending)...')
  await sortByTotalPoints(page)

  console.log(`→ Scraping ${offensivePages} pages of All players (offensive view captures K naturally)...`)
  const offensive = await scrapePages(page, offensivePages, parseOffensiveRow)
  console.log(`  ${offensive.length} players (positions: ${Object.entries(countBy(offensive, 'position')).map(([k, v]) => `${k}=${v}`).join(', ')})`)

  console.log(`→ Scraping defenses (D/ST filter, ${dstPages} page)...`)
  // ESPN's position filter becomes unresponsive after extensive pagination,
  // so reload the page to get a fresh component state before filtering.
  await setupSortableView(page)
  await sortByTotalPoints(page)
  await filterPosition(page, 'D/ST', 'D/ST')
  const defenses = await scrapePages(page, dstPages, parseDefenseRow)
  console.log(`  ${defenses.length} defenses`)

  console.log(`→ Scraping Yahoo salary-cap "Proj $" values...`)
  const yahoo = await scrapeYahooSalcap(page)
  console.log(`  ${yahoo.length} players (positions: ${Object.entries(countBy(yahoo, 'position')).map(([k, v]) => `${k}=${v}`).join(', ')})`)

  await browser.close()

  // De-dup by name+position (offensive scrape might also pick up some D/ST that
  // appeared in top N by projection — prefer the dedicated D/ST scrape values)
  const byKey = new Map()
  for (const r of offensive) byKey.set(r.name + '|' + r.position, r)
  for (const r of defenses) byKey.set(r.name + '|' + r.position, r)
  const allRows = Array.from(byKey.values())

  if (allRows.length === 0) {
    throw new Error('Scrape produced 0 rows. ESPN selectors may have changed.')
  }

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
