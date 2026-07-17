import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PlayerCustomizationModal from '../../../src/components/PlayerCustomizationModal.jsx'

const PLAYERS = [
  {
    id: 'wr1', name: 'Puka Nacua', position: 'WR', team: 'LAR',
    estimatedValue: 40, projectedPoints: { standard: 150, halfPPR: 200, ppr: 250 },
  },
  {
    id: 'qb1', name: 'Josh Allen', position: 'QB', team: 'BUF',
    estimatedValue: 30, projectedPoints: { standard: 350, halfPPR: 350, ppr: 350 },
  },
]

function renderModal(overrideProps = {}) {
  return render(
    <PlayerCustomizationModal
      isOpen
      onClose={vi.fn()}
      basePlayers={PLAYERS}
      overrides={{}}
      scoringFormat="halfPPR"
      budgetPerTeam={200}
      formatDeltas={new Map()}
      onChange={vi.fn()}
      onClearAll={vi.fn()}
      {...overrideProps}
    />
  )
}

describe('PlayerCustomizationModal', () => {
  it('shows raw book values with no format deltas', () => {
    renderModal()
    expect(screen.getByText('$40')).toBeTruthy()
    expect(screen.getByText('$30')).toBeTruthy()
  })

  it('applies format deltas to displayed base values', () => {
    renderModal({ scoringFormat: 'ppr', formatDeltas: new Map([['wr1', 12.4]]) })
    expect(screen.getByText('$52')).toBeTruthy() // 40 + 12.4 rounded by budget scaling
    expect(screen.getByText('$30')).toBeTruthy() // QB: no delta
  })

  it('scales format-adjusted values to the league budget', () => {
    // (40 + 10) × 400/200 = $100
    renderModal({ scoringFormat: 'ppr', budgetPerTeam: 400, formatDeltas: new Map([['wr1', 10]]) })
    expect(screen.getByText('$100')).toBeTruthy()
  })

  it('shows format-specific base points', () => {
    renderModal({ scoringFormat: 'ppr' })
    expect(screen.getByText('250.0')).toBeTruthy()
  })
})
