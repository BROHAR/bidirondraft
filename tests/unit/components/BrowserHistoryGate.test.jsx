import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

import BrowserHistoryGate from '../../../src/components/BrowserHistoryGate.jsx'
import { createHistoryService } from '../../../src/services/historyService.js'
import { useDraftStore } from '../../../src/store/draftStore.js'

// Same stub-window approach as the service tests: popstate is fired by hand
// so we drive Back presses without jsdom history traversal.
function makeStub() {
  const listeners = {}
  const win = {
    location: { pathname: '/', search: '' },
    history: { pushState: vi.fn(), replaceState: vi.fn() },
    addEventListener: (type, fn) => { listeners[type] = fn },
    removeEventListener: (type, fn) => { if (listeners[type] === fn) delete listeners[type] },
  }
  return { win, firePopState: (state) => listeners.popstate({ state }) }
}

describe('BrowserHistoryGate', () => {
  beforeEach(() => {
    useDraftStore.setState({
      draftState: 'TITLE',
      metaSim: { running: false, done: 0, total: 0, result: null, error: null },
    })
  })

  const setup = () => {
    const { win, firePopState } = makeStub()
    const service = createHistoryService({ store: useDraftStore, win })
    render(<BrowserHistoryGate service={service} />)
    return { firePopState, service }
  }

  it('renders nothing until a Back navigation needs confirmation', () => {
    setup()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('shows the Leave Draft dialog when Back is pressed mid-draft', () => {
    const { firePopState } = setup()
    act(() => {
      useDraftStore.getState().setDraftState('BIDDING')
      firePopState({ screen: 'setup' })
    })
    expect(screen.getByRole('alertdialog', { name: 'Leave Draft?' })).toBeInTheDocument()
    expect(screen.getByText('All progress will be lost. This cannot be undone.')).toBeInTheDocument()
  })

  it('cancel closes the dialog and keeps the draft', () => {
    const { firePopState } = setup()
    act(() => {
      useDraftStore.getState().setDraftState('BIDDING')
      firePopState({ screen: 'setup' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useDraftStore.getState().draftState).toBe('BIDDING')
  })

  it('confirm leaves the draft and lands on SETUP', () => {
    const { firePopState } = setup()
    act(() => {
      useDraftStore.getState().setDraftState('BIDDING')
      firePopState({ screen: 'setup' })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Leave Draft' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useDraftStore.getState().draftState).toBe('SETUP')
  })

  it('uses the New Draft wording when Back is pressed on the completed report', () => {
    const { firePopState } = setup()
    act(() => {
      useDraftStore.getState().setDraftState('COMPLETE')
      firePopState({ screen: 'draft' })
    })
    expect(screen.getByRole('alertdialog', { name: 'Start a New Draft?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New Draft' }))
    expect(useDraftStore.getState().draftState).toBe('SETUP')
  })
})
