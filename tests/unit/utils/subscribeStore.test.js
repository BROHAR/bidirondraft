import { describe, it, expect, beforeEach } from 'vitest'
import {
  loadSubscribeState,
  markSubscribed,
  markDismissed,
  clearSubscribeState,
  isSubscribed,
  shouldShowPrompt,
} from '../../../src/utils/subscribeStore'

const STORAGE_KEY = 'adraft.subscribe.v1'

beforeEach(() => {
  window.localStorage.clear()
})

describe('subscribeStore', () => {
  it('returns null and shows prompts when nothing is stored', () => {
    expect(loadSubscribeState()).toBeNull()
    expect(isSubscribed()).toBe(false)
    expect(shouldShowPrompt()).toBe(true)
  })

  it('round-trips subscribed state and hides everything', () => {
    markSubscribed()
    expect(loadSubscribeState()).toMatchObject({ status: 'subscribed' })
    expect(isSubscribed()).toBe(true)
    expect(shouldShowPrompt()).toBe(false)
  })

  it('round-trips dismissed state: prompts hidden, not subscribed', () => {
    markDismissed()
    expect(loadSubscribeState()).toMatchObject({ status: 'dismissed' })
    expect(isSubscribed()).toBe(false)
    expect(shouldShowPrompt()).toBe(false)
  })

  it('does not downgrade subscribed to dismissed', () => {
    markSubscribed()
    markDismissed()
    expect(isSubscribed()).toBe(true)
  })

  it('treats corrupt or unknown-status data as absent', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadSubscribeState()).toBeNull()
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ status: 'weird' }))
    expect(loadSubscribeState()).toBeNull()
    expect(shouldShowPrompt()).toBe(true)
  })

  it('clearSubscribeState removes the record', () => {
    markSubscribed()
    clearSubscribeState()
    expect(loadSubscribeState()).toBeNull()
  })
})
