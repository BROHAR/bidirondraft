// Builds the list of rows the Player Pool renders: every available player,
// plus — when the "show drafted" toggle is on — the players already sold in
// this draft, tagged with who bought them and for how much.
//
// Each entry is { player, drafted, soldTo, soldPrice }. Available players come
// first in pool order; drafted players are appended in draft order (the
// component's sort pass interleaves them afterwards). A player that is back in
// the available pool (e.g. after an undone pick) is never duplicated, and
// keepers — which never pass through the auction — are intentionally not
// listed as drafted.
export function buildPoolEntries(availablePlayers, draftHistory, showDrafted) {
  const entries = availablePlayers.map(player => ({
    player,
    drafted: false,
    soldTo: null,
    soldPrice: null,
  }))
  if (!showDrafted) return entries

  const availableIds = new Set(availablePlayers.map(p => p.id))
  for (const pick of draftHistory) {
    if (!pick?.player || availableIds.has(pick.player.id)) continue
    entries.push({
      player: pick.player,
      drafted: true,
      soldTo: pick.team,
      soldPrice: pick.price,
    })
  }
  return entries
}
