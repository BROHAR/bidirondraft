import { describe, it, expect } from 'vitest'
import { parseFantasyProsCsv } from '../../../scripts/import-fantasypros/index.mjs'

// Real header shapes from the FantasyPros export — column names repeat across
// stat groups (passing YDS vs rushing YDS), so parsing is positional per file.

describe('parseFantasyProsCsv', () => {
  it('parses QB rows (passing + rushing) and skips the junk row', () => {
    const csv = [
      '"Player","Team","ATT","CMP","YDS","TDS","INTS","ATT","YDS","TDS","FL","FPTS"',
      '" ","","",""',
      '"Josh Allen","BUF","491.6","333.4","3815.6","27.4","11.2","118.1","585.2","11.8","4.1","372.2"',
    ].join('\n')
    const [qb] = parseFantasyProsCsv(csv, 'QB')
    expect(qb.key).toBe('joshallenQB')
    // 0.04*3815.6 + 4*27.4 - 2*11.2 + 0.1*585.2 + 6*11.8 = 369.1, no rec bonus
    expect(qb.projectedPoints).toEqual({ standard: 369.1, halfPPR: 369.1, ppr: 369.1 })
  })

  it('parses RB rows (rushing + receiving) with PPR bonuses and comma-grouped numbers', () => {
    const csv = [
      '"Player","Team","ATT","YDS","TDS","REC","YDS","TDS","FL","FPTS"',
      '"Jahmyr Gibbs","DET","274.4","1,381.4","13.8","70.9","580.5","4.1","1.1","337.1"',
    ].join('\n')
    const [rb] = parseFantasyProsCsv(csv, 'RB')
    expect(rb.projectedPoints.standard).toBeCloseTo(303.6, 1)
    expect(rb.projectedPoints.halfPPR).toBeCloseTo(339.0, 1)
    expect(rb.projectedPoints.ppr).toBeCloseTo(374.5, 1)
  })

  it('uses FPTS directly for K and DST, keying DST by nickname', () => {
    const kCsv = [
      '"Player","Team","FG","FGA","XPT","FPTS"',
      '"Brandon Aubrey","DAL","35.2","39.9","47.5","153.0"',
    ].join('\n')
    expect(parseFantasyProsCsv(kCsv, 'K')[0].projectedPoints).toEqual({ standard: 153, halfPPR: 153, ppr: 153 })

    const dstCsv = [
      '"Player","Team","SACK","INT","FR","FF","TD","SAFETY","PA","YDS_AGN","FPTS"',
      '"Houston Texans","","49.6","14.8","11.6","18.3","2.8","1.0","321.7","5048.7","121.2"',
    ].join('\n')
    const [dst] = parseFantasyProsCsv(dstCsv, 'DST')
    // Matches the pool's "Texans D/ST" key (normalizeName strips the suffix).
    expect(dst.key).toBe('texansDST')
    expect(dst.projectedPoints.standard).toBe(121.2)
  })
})
