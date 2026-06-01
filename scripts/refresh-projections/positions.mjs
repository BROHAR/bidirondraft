// Position normalization for the projections scraper. ESPN and Yahoo emit
// multi-position strings for two-way players (e.g. Travis Hunter: "WR,CB").
// We only draft offensive skill players + DST + K, so we pick the first
// listed app-relevant code and drop the rest. Returns '' when no listed
// position applies (CB-only, LB-only, etc.) — caller should drop the row.

export const APP_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'K'])

export function normalizePosition(raw) {
  if (!raw) return ''
  const cleaned = String(raw).trim().toUpperCase()
  // Handle D/ST first since it contains a slash and would otherwise split apart.
  if (cleaned === 'D/ST' || cleaned === 'DST' || cleaned === 'DEF' || cleaned === 'D') return 'DST'
  // Split common multi-position delimiters: comma, slash, whitespace.
  const parts = cleaned.split(/[,/\s]+/).filter(Boolean)
  for (const p of parts) {
    if (p === 'D/ST' || p === 'DST' || p === 'DEF' || p === 'D') return 'DST'
    if (APP_POSITIONS.has(p)) return p
  }
  return ''
}
