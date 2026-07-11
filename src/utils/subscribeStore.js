// Remembers what the user did with the news & updates signup so we never nag:
// subscribing hides every prompt (including the title-screen link); dismissing
// hides the inline prompts but leaves the quiet title-footer link as the one
// remaining entry point. Mirrors setupConfigStore.js: guarded, versioned, and
// tolerant of missing/corrupt data.

const STORAGE_KEY = 'adraft.subscribe.v1'

const STATUSES = ['subscribed', 'dismissed']

export function loadSubscribeState() {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !STATUSES.includes(parsed.status)) return null
    return parsed
  } catch {
    return null
  }
}

function saveStatus(status) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ status, at: new Date().toISOString() }))
  } catch {
    // localStorage can throw (private mode / quota) — persistence is best-effort.
  }
}

export function markSubscribed() {
  saveStatus('subscribed')
}

export function markDismissed() {
  // Subscribing wins over a later dismiss: once subscribed there is nothing
  // left to dismiss, and downgrading would resurface the prompts.
  if (loadSubscribeState()?.status === 'subscribed') return
  saveStatus('dismissed')
}

export function clearSubscribeState() {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.removeItem(STORAGE_KEY)
}

export function isSubscribed() {
  return loadSubscribeState()?.status === 'subscribed'
}

// Gates the inline prompts (post-draft card, setup footer line).
export function shouldShowPrompt() {
  return loadSubscribeState() === null
}
