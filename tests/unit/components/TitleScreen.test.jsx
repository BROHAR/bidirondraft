import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import TitleScreen from '../../../src/components/TitleScreen.jsx'

// Mock the store so we can observe navigation to SETUP without the engine.
const setDraftState = vi.fn()
vi.mock('../../../src/store/draftStore', () => ({
  useDraftStore: (selector) => selector({ setDraftState }),
}))

beforeEach(() => {
  window.localStorage.clear()
  setDraftState.mockClear()
})

const openSignup = () => fireEvent.click(screen.getByRole('button', { name: 'GET UPDATES' }))

describe('TitleScreen', () => {
  it('starts the game on a screen click, PRESS START, and Enter/Space', () => {
    render(<TitleScreen />)
    fireEvent.click(document.querySelector('.title-screen'))
    fireEvent.click(screen.getByRole('button', { name: 'PRESS START' }))
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: ' ' })
    expect(setDraftState).toHaveBeenCalledTimes(4)
    expect(setDraftState).toHaveBeenCalledWith('SETUP')
  })

  it('opens the signup modal from the footer link without starting the game', () => {
    render(<TitleScreen />)
    openSignup()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(setDraftState).not.toHaveBeenCalled()
  })

  it('does not start the game from keys or screen clicks while the modal is open', () => {
    render(<TitleScreen />)
    openSignup()
    fireEvent.keyDown(window, { key: 'Enter' })
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.click(document.querySelector('.title-screen'))
    expect(setDraftState).not.toHaveBeenCalled()
  })

  it('closing the modal does not start the game, and start works again after', () => {
    render(<TitleScreen />)
    openSignup()
    fireEvent.click(document.querySelector('.modal-overlay'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(setDraftState).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(setDraftState).toHaveBeenCalledWith('SETUP')
  })

  it('hides the GET UPDATES link once subscribed', () => {
    window.localStorage.setItem(
      'adraft.subscribe.v1',
      JSON.stringify({ status: 'subscribed', at: new Date().toISOString() })
    )
    render(<TitleScreen />)
    expect(screen.queryByRole('button', { name: 'GET UPDATES' })).toBeNull()
  })
})
