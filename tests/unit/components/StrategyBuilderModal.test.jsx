import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StrategyBuilderModal from '../../../src/components/StrategyBuilderModal.jsx'

beforeEach(() => {
  window.localStorage.clear()
})

function setup(props = {}) {
  const onChange = vi.fn()
  const onClose = vi.fn()
  render(
    <StrategyBuilderModal
      isOpen
      onClose={onClose}
      customStrategies={props.customStrategies || []}
      onChange={onChange}
    />
  )
  return { onChange, onClose }
}

describe('StrategyBuilderModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <StrategyBuilderModal isOpen={false} onClose={() => {}} customStrategies={[]} onChange={() => {}} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('requires a name before adding', () => {
    const { onChange } = setup()
    fireEvent.click(screen.getByRole('button', { name: /add strategy/i }))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText(/give the strategy a name/i)).toBeInTheDocument()
  })

  it('creates a custom strategy cloning the selected base', () => {
    const { onChange } = setup()
    fireEvent.change(screen.getByPlaceholderText(/aggressive zero rb/i), { target: { value: 'My Strat' } })
    fireEvent.change(screen.getByLabelText(/clone from/i), { target: { value: 'ZeroRB' } })
    fireEvent.click(screen.getByRole('button', { name: /add strategy/i }))

    expect(onChange).toHaveBeenCalledTimes(1)
    const list = onChange.mock.calls[0][0]
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'My Strat', baseKey: 'ZeroRB' })
    expect(list[0].id).toBeTruthy()
    expect(list[0].positionMultipliers).toHaveProperty('RB')
  })

  it('shows a home-team selector only when cloning Taco', () => {
    setup()
    expect(screen.queryByLabelText(/home team/i)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/clone from/i), { target: { value: 'Taco' } })
    expect(screen.getByLabelText(/home team/i)).toBeInTheDocument()
  })

  it('lists existing strategies with edit/delete', () => {
    setup({ customStrategies: [{ id: 'a', name: 'Existing One', baseKey: 'Balanced' }] })
    expect(screen.getByText('Existing One')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
  })
})
