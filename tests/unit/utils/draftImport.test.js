import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseDraftCsv, splitCsvFields, EXAMPLE_HEADER } from '../../../src/utils/draftImport.js'

// Vitest runs from the repo root. The golden fixture is an anonymized copy of
// a real 2025 league draft (team names swapped for Team A..J; players, prices,
// and pick order untouched) — it doubles as the format documentation. The
// original lives untracked at data/2025_draft_results.csv.
const GOLDEN_PATH = resolve(process.cwd(), 'tests/fixtures/2025_draft_results.csv')

const HEADER = 'Pick,Player,NFL Team,Position,Salary,Fantasy Team'

describe('splitCsvFields', () => {
  it('splits plain fields and trims whitespace', () => {
    expect(splitCsvFields('1, Patrick Mahomes ,KC,QB,8,Team A')).toEqual(
      ['1', 'Patrick Mahomes', 'KC', 'QB', '8', 'Team A'])
  })

  it('handles quoted fields with commas and escaped quotes', () => {
    expect(splitCsvFields('1,"Smith, John",KC,QB,8,"The ""Best"" Team"')).toEqual(
      ['1', 'Smith, John', 'KC', 'QB', '8', 'The "Best" Team'])
  })
})

describe('parseDraftCsv — golden fixture (data/2025_draft_results.csv)', () => {
  const result = parseDraftCsv(readFileSync(GOLDEN_PATH, 'utf8'))

  it('parses all 170 rows with no errors or warnings', () => {
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.records.length).toBe(170)
  })

  it('detects the 10 teams with 17 picks each and full-budget spends', () => {
    expect(result.teams.length).toBe(10)
    for (const t of result.teams) expect(t.picks).toBe(17)
    const spends = result.teams.map(t => t.spend).sort((a, b) => b - a)
    expect(spends[0]).toBe(200)
    expect(Math.min(...spends)).toBe(198)
  })

  it('detects pick order and suggests the $200 budget', () => {
    expect(result.hasPickOrder).toBe(true)
    expect(result.suggestedBudget).toBe(200)
  })

  it('maps DEF rows to DST', () => {
    const dsts = result.records.filter(r => r.position === 'DST')
    expect(dsts.length).toBe(12)
    expect(result.records.some(r => r.position === 'DEF')).toBe(false)
  })

  it('uppercases NFL team abbreviations', () => {
    const chase = result.records.find(r => r.name === "Ja'Marr Chase")
    expect(chase).toMatchObject({ nflTeam: 'CIN', position: 'WR', price: 70, pick: 2 })
  })
})

describe('parseDraftCsv — validation', () => {
  it('errors on a missing column, naming it and showing the expected header', () => {
    const r = parseDraftCsv('Pick,Player,Position,Salary,Fantasy Team\n1,A,QB,5,T')
    expect(r.errors.length).toBe(1)
    expect(r.errors[0]).toContain('nfl team')
    expect(r.errors[0]).toContain(EXAMPLE_HEADER)
    expect(r.records).toEqual([])
  })

  it('accepts reordered columns (resolution by name)', () => {
    const r = parseDraftCsv('Fantasy Team,Salary,Position,NFL Team,Player,Pick\nT,8,QB,KC,Patrick Mahomes,1')
    expect(r.errors).toEqual([])
    expect(r.records[0]).toMatchObject({ name: 'Patrick Mahomes', price: 8, position: 'QB', fantasyTeam: 'T', pick: 1 })
  })

  it('is case-insensitive on header names', () => {
    const r = parseDraftCsv('pick,PLAYER,nfl team,POSITION,salary,FANTASY TEAM\n1,A,KC,QB,5,T')
    expect(r.errors).toEqual([])
    expect(r.records.length).toBe(1)
  })

  it('skips bad-salary rows with a warning and keeps parsing', () => {
    const r = parseDraftCsv(`${HEADER}\n1,A,KC,QB,notanumber,T\n2,B,KC,RB,12,T`)
    expect(r.records.length).toBe(1)
    expect(r.records[0].name).toBe('B')
    expect(r.warnings.length).toBe(1)
    expect(r.warnings[0]).toContain('salary')
  })

  it('strips a leading $ from salaries', () => {
    const r = parseDraftCsv(`${HEADER}\n1,A,KC,QB,$25,T`)
    expect(r.records[0].price).toBe(25)
  })

  it('skips unknown positions with a warning', () => {
    const r = parseDraftCsv(`${HEADER}\n1,A,KC,LB,5,T\n2,B,KC,RB,12,T`)
    expect(r.records.length).toBe(1)
    expect(r.warnings[0]).toContain('position')
  })

  it('hasPickOrder is false when more than a third of picks are blank', () => {
    const rows = ['', '', ''].map((_, i) => `,P${i},KC,RB,${i + 2},T`)
    const r = parseDraftCsv(`${HEADER}\n1,A,KC,QB,5,T\n${rows.join('\n')}`)
    expect(r.records.length).toBe(4)
    expect(r.hasPickOrder).toBe(false)
  })

  it('dedupes identical rows with a warning', () => {
    const r = parseDraftCsv(`${HEADER}\n1,A,KC,QB,5,T\n1,A,KC,QB,5,T`)
    expect(r.records.length).toBe(1)
    expect(r.warnings[0]).toContain('duplicate')
  })

  it('errors when only a header is present', () => {
    const r = parseDraftCsv(HEADER)
    expect(r.errors.length).toBe(1)
    expect(r.errors[0]).toContain('No valid draft rows')
  })

  it('returns an empty-file error on blank input and never throws', () => {
    expect(parseDraftCsv('').errors.length).toBe(1)
    expect(parseDraftCsv(null).errors.length).toBe(1)
  })
})
