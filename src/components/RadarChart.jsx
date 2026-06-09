import React from 'react'

export const AXIS_FULL_LABEL = { FLEX: 'FLEX', SUPERFLEX: 'SF', QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', DST: 'DST' }

// Hand-rolled SVG radar. `axes` is the ordered list of position labels;
// `team`/`avg` are arrays of 0..1 normalized radii aligned to `axes`. Styling
// comes from the .radar-* classes in postDraftAnalysis.css (imported by the
// consuming screen).
export default function RadarChart({ axes, team, avg }) {
  const SIZE = 320
  const cx = SIZE / 2
  const cy = SIZE / 2
  const R = 118
  const n = axes.length
  if (n < 3) {
    return <div className="radar-empty">Need at least 3 positions to chart.</div>
  }

  const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2 // start at top, clockwise
  const point = (i, r) => [cx + r * R * Math.cos(angle(i)), cy + r * R * Math.sin(angle(i))]
  const polygon = (radii) => radii.map((r, i) => point(i, r).join(',')).join(' ')

  const rings = [0.25, 0.5, 0.75, 1]

  return (
    <svg className="radar-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Positional strength radar">
      {/* grid rings */}
      {rings.map(r => (
        <polygon
          key={`ring-${r}`}
          className="radar-ring"
          points={polygon(axes.map(() => r))}
        />
      ))}
      {/* spokes + labels */}
      {axes.map((ax, i) => {
        const [x, y] = point(i, 1)
        const [lx, ly] = point(i, 1.16)
        return (
          <g key={`axis-${ax}`}>
            <line className="radar-spoke" x1={cx} y1={cy} x2={x} y2={y} />
            <text
              className="radar-axis-label"
              x={lx}
              y={ly}
              textAnchor={lx > cx + 1 ? 'start' : lx < cx - 1 ? 'end' : 'middle'}
              dominantBaseline={ly > cy + 1 ? 'hanging' : ly < cy - 1 ? 'auto' : 'middle'}
            >
              {AXIS_FULL_LABEL[ax] || ax}
            </text>
          </g>
        )
      })}
      {/* league-average reference polygon */}
      {avg && <polygon className="radar-avg" points={polygon(avg)} />}
      {/* selected team polygon */}
      <polygon className="radar-team" points={polygon(team)} />
      {team.map((r, i) => {
        const [x, y] = point(i, r)
        return <circle key={`dot-${i}`} className="radar-dot" cx={x} cy={y} r={3} />
      })}
    </svg>
  )
}
