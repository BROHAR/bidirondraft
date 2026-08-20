import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  describe('CSV import', () => {
    const openImport = () => fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }))
    const pasteCsv = (text) =>
      fireEvent.change(screen.getByPlaceholderText(/Player,Position,Value,Points/), { target: { value: text } })

    it('previews and applies a pasted CSV as overrides', () => {
      const onChange = vi.fn()
      renderModal({ onChange })
      openImport()
      pasteCsv('Player,Position,Value,Points\nPuka Nacua,WR,52,240.5')

      fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
      expect(screen.getByText(/1 player matched/)).toBeTruthy()

      fireEvent.click(screen.getByRole('button', { name: 'Apply 1 Player' }))
      expect(onChange).toHaveBeenCalledWith({
        wr1: { estimatedValue: 52, projectedPoints: { halfPPR: 240.5 } },
      })
    })

    it('shows a parse error instead of applying an unusable file', () => {
      const onChange = vi.fn()
      renderModal({ onChange })
      openImport()
      pasteCsv('Foo,Bar\n1,2')

      fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
      expect(screen.getByText(/No player-name column found/)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Apply' }).disabled).toBe(true)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('surfaces skipped rows as warnings in the preview', () => {
      renderModal()
      openImport()
      pasteCsv('Player,Position,Value\nPuka Nacua,WR,40\nRetired Guy,RB,10')

      fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
      expect(screen.getByText(/1 player matched/)).toBeTruthy()
      expect(screen.getByText(/1 row skipped or flagged/)).toBeTruthy()
      expect(screen.getByText(/"Retired Guy" \(RB\) not found in the player pool/)).toBeTruthy()
    })
  })
})
