// Projection-source selection. players.json carries two projection blocks per
// player: projectedPoints (ESPN-derived, always present) and projectedPointsFP
// (FantasyPros, merged in by `npm run import-fantasypros`; absent for players
// FantasyPros doesn't project). The setup config's projectionSource picks
// which block feeds the draft; the swap happens once here, upstream of
// overrides and the engine, so everything downstream reads projectedPoints
// as usual.

export const PROJECTION_SOURCES = ['espn', 'fantasyPros']

export function applyProjectionSource(playersData, source) {
  if (source !== 'fantasyPros') return playersData
  return {
    ...playersData,
    players: (playersData.players || []).map(p =>
      p.projectedPointsFP ? { ...p, projectedPoints: p.projectedPointsFP } : p
    ),
  }
}
