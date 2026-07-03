// Hard-coded 2026 NFL bye weeks by team.
//
// The projection feeds (ESPN / Yahoo) don't expose bye weeks, so we apply them
// here from the team the player is on. This replaces the old behavior of
// preserving whatever byeWeek happened to be in players.json, which went stale
// year over year. Keys use the same abbreviations the scraper emits (see
// ESPN_TEAM in scrape.mjs) — note Washington is WSH, not WAS.
//
// Week 12 has no byes in 2026. Free agents ("FA") and any unmatched team fall
// back to 0 (unknown) in process.mjs.
const BYE_BY_WEEK = {
  5: ['CAR', 'KC'],
  6: ['CIN', 'DET', 'MIA', 'MIN'],
  7: ['BUF', 'JAX', 'LAC', 'WSH'],
  8: ['HOU', 'NO', 'NYG', 'SF'],
  9: ['PIT', 'TEN'],
  10: ['CHI', 'DEN', 'PHI', 'TB'],
  11: ['ATL', 'CLE', 'GB', 'LAR', 'NE', 'SEA'],
  13: ['BAL', 'IND', 'LV', 'NYJ'],
  14: ['ARI', 'DAL'],
}

export const BYE_WEEKS_2026 = Object.fromEntries(
  Object.entries(BYE_BY_WEEK).flatMap(([week, teams]) =>
    teams.map(team => [team, Number(week)]),
  ),
)

// byeWeek for a team, or 0 when unknown (free agents, unmapped abbreviations).
export function byeWeekForTeam(team) {
  return BYE_WEEKS_2026[team] ?? 0
}
