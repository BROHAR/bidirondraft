import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { createHistoryService, screenForDraftState } from '../../../src/services/historyService.js'
import { useDraftStore } from '../../../src/store/draftStore.js'

// Stub window: lets us assert push/replace calls exactly and fire popstate
// synchronously without depending on jsdom's history-traversal semantics.
function makeWin() {
  const listeners = {}
  const win = {
    location: { pathname: '/', search: '' },
    history: { pushState: vi.fn(), replaceState: vi.fn() },
    addEventListener: (type, fn) => { listeners[type] = fn },
    removeEventListener: (type, fn) => { if (listeners[type] === fn) delete listeners[type] },
  }
  const firePopState = (state) => listeners.popstate({ state })
  return { win, firePopState, listeners }
}

const setDraftState = (state) => useDraftStore.getState().setDraftState(state)

describe('historyService', () => {
  let win, firePopState, stop

  const startService = () => {
    const stub = makeWin()
    win = stub.win
    firePopState = stub.firePopState
    const service = createHistoryService({ store: useDraftStore, win })
    stop = service.start()
    return service
  }

  beforeEach(() => {
    useDraftStore.setState({
      draftState: 'TITLE',
      metaSim: { running: false, done: 0, total: 0, result: null, error: null },
    })
  })

  afterEach(() => {
    stop?.()
    stop = null
  })

  it('maps every draftState to a screen, collapsing the live draft into one', () => {
    expect(screenForDraftState('TITLE')).toBe('title')
    expect(screenForDraftState('SETUP')).toBe('setup')
    expect(screenForDraftState('NOMINATING')).toBe('draft')
    expect(screenForDraftState('BIDDING')).toBe('draft')
    expect(screenForDraftState('PAUSED')).toBe('draft')
    expect(screenForDraftState('COMPLETE')).toBe('complete')
    expect(screenForDraftState('META_RESULTS')).toBe('meta')
    expect(screenForDraftState('SOMETHING_ELSE')).toBe('title')
  })

  it('anchors the current screen with replaceState on start', () => {
    startService()
    expect(win.history.replaceState).toHaveBeenCalledWith({ screen: 'title' }, '', '/')
    expect(win.history.pushState).not.toHaveBeenCalled()
  })

  it('pushes one entry per forward screen transition, with the screen hash', () => {
    startService()
    setDraftState('SETUP')
    setDraftState('NOMINATING')
    setDraftState('COMPLETE')
    expect(win.history.pushState.mock.calls).toEqual([
      [{ screen: 'setup' }, '', '#setup'],
      [{ screen: 'draft' }, '', '#draft'],
      [{ screen: 'complete' }, '', '#complete'],
    ])
  })

  it('pushes an entry for SETUP → META_RESULTS', () => {
    startService()
    setDraftState('SETUP')
    setDraftState('META_RESULTS')
    expect(win.history.pushState).toHaveBeenLastCalledWith({ screen: 'meta' }, '', '#meta')
  })

  it('does not touch history for intra-draft churn (one entry for the whole draft)', () => {
    startService()
    setDraftState('SETUP')
    setDraftState('NOMINATING')
    win.history.pushState.mockClear()
    win.history.replaceState.mockClear()
    setDraftState('BIDDING')
    setDraftState('PAUSED')
    setDraftState('BIDDING')
    setDraftState('NOMINATING')
    expect(win.history.pushState).not.toHaveBeenCalled()
    expect(win.history.replaceState).not.toHaveBeenCalled()
  })

  it('rewrites (not pushes) the entry for in-app backward transitions', () => {
    startService()
    setDraftState('SETUP')
    setDraftState('NOMINATING')
    setDraftState('COMPLETE')
    win.history.pushState.mockClear()
    useDraftStore.getState().restartDraft() // in-app "New Draft" → SETUP
    expect(win.history.pushState).not.toHaveBeenCalled()
    expect(win.history.replaceState).toHaveBeenLastCalledWith({ screen: 'setup' }, '', '#setup')
  })

  it('Back on SETUP returns to TITLE through the store', () => {
    startService()
    setDraftState('SETUP')
    firePopState({ screen: 'title' })
    expect(useDraftStore.getState().draftState).toBe('TITLE')
    expect(win.history.replaceState).toHaveBeenLastCalledWith({ screen: 'title' }, '', '/')
  })

  it('Forward from TITLE into SETUP is allowed (data-free)', () => {
    startService()
    setDraftState('SETUP')
    firePopState({ screen: 'title' })
    firePopState({ screen: 'setup' }) // Forward
    expect(useDraftStore.getState().draftState).toBe('SETUP')
  })

  it('Forward into an unreachable screen is a no-op re-sync', () => {
    startService()
    setDraftState('SETUP')
    win.history.replaceState.mockClear()
    firePopState({ screen: 'complete' })
    expect(useDraftStore.getState().draftState).toBe('SETUP')
    expect(win.history.replaceState).toHaveBeenCalledWith({ screen: 'setup' }, '', '#setup')
    expect(win.history.pushState).toHaveBeenCalledTimes(1) // only the original TITLE→SETUP
  })

  it('an entry with no state (or matching screen) changes nothing', () => {
    startService()
    firePopState(null) // defaults to title, which we are already on
    expect(useDraftStore.getState().draftState).toBe('TITLE')
    expect(win.history.pushState).not.toHaveBeenCalled()
  })

  describe('Back during a live draft', () => {
    it('re-pushes to stay put and requests a leave-draft confirm', () => {
      const service = startService()
      setDraftState('SETUP')
      setDraftState('BIDDING')
      win.history.pushState.mockClear()
      firePopState({ screen: 'setup' })
      expect(win.history.pushState).toHaveBeenCalledWith({ screen: 'draft' }, '', '#draft')
      expect(service.getConfirmRequest()).toBe('leave-draft')
      // Draft untouched until the user answers.
      expect(useDraftStore.getState().draftState).toBe('BIDDING')
    })

    it('cancel keeps the draft running', () => {
      const service = startService()
      setDraftState('BIDDING')
      firePopState({ screen: 'setup' })
      service.resolveConfirm(false)
      expect(service.getConfirmRequest()).toBe(null)
      expect(useDraftStore.getState().draftState).toBe('BIDDING')
    })

    it('confirm exits through restartDraft to SETUP and re-syncs the entry', () => {
      const service = startService()
      setDraftState('BIDDING')
      firePopState({ screen: 'setup' })
      service.resolveConfirm(true)
      expect(service.getConfirmRequest()).toBe(null)
      expect(useDraftStore.getState().draftState).toBe('SETUP')
      expect(win.history.replaceState).toHaveBeenLastCalledWith({ screen: 'setup' }, '', '#setup')
    })

    it('notifies confirm listeners on request and resolution', () => {
      const service = startService()
      const seen = []
      const off = service.onConfirmChange((request) => seen.push(request))
      setDraftState('NOMINATING')
      firePopState({ screen: 'title' })
      service.resolveConfirm(false)
      expect(seen).toEqual(['leave-draft', null])
      off()
    })

    it('an in-app screen change supersedes a pending confirm', () => {
      const service = startService()
      setDraftState('BIDDING')
      firePopState({ screen: 'setup' })
      expect(service.getConfirmRequest()).toBe('leave-draft')
      useDraftStore.getState().restartDraft() // user clicked in-app Restart instead
      expect(service.getConfirmRequest()).toBe(null)
      expect(useDraftStore.getState().draftState).toBe('SETUP')
    })

    it('intra-draft churn does not clear a pending confirm', () => {
      const service = startService()
      setDraftState('BIDDING')
      firePopState({ screen: 'setup' })
      setDraftState('NOMINATING') // engine churn while the dialog is open
      expect(service.getConfirmRequest()).toBe('leave-draft')
    })
  })

  describe('Back on COMPLETE', () => {
    it('guards with a discard-results confirm; confirm restarts to SETUP', () => {
      const service = startService()
      setDraftState('COMPLETE')
      win.history.pushState.mockClear()
      firePopState({ screen: 'draft' })
      expect(win.history.pushState).toHaveBeenCalledWith({ screen: 'complete' }, '', '#complete')
      expect(service.getConfirmRequest()).toBe('discard-results')
      expect(useDraftStore.getState().draftState).toBe('COMPLETE')
      service.resolveConfirm(true)
      expect(useDraftStore.getState().draftState).toBe('SETUP')
    })
  })

  describe('Back on META_RESULTS', () => {
    it('returns to SETUP via closeMetaResults without a confirm', () => {
      const service = startService()
      setDraftState('SETUP')
      setDraftState('META_RESULTS')
      firePopState({ screen: 'setup' })
      expect(service.getConfirmRequest()).toBe(null)
      expect(useDraftStore.getState().draftState).toBe('SETUP')
      expect(useDraftStore.getState().metaSim.result).toBe(null)
    })
  })

  it('stop() detaches from the store and the window', () => {
    startService()
    stop()
    const stopped = stop
    stop = null
    expect(stopped).toBeTypeOf('function')
    win.history.pushState.mockClear()
    setDraftState('SETUP')
    expect(win.history.pushState).not.toHaveBeenCalled()
  })
})
