import { useEffect, useRef, useState } from 'react'
import { markSubscribed, markDismissed } from '../utils/subscribeStore'

// Same pattern the server enforces in server/app.js — client-side it only
// short-circuits the obvious typos before a network round trip.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Shared signup core used by the title-screen modal ('card') and the quieter
// setup-footer line ('inline'). `source` tags where the signup happened.
function EmailSignupForm({ source, variant = 'card', onSuccess, onDismiss, autoFocus = false }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle') // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState('')
  const honeypotRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (status === 'loading' || status === 'success') return
    const normalized = email.trim().toLowerCase()
    if (!EMAIL_RE.test(normalized)) {
      setStatus('error')
      setErrorMsg('ENTER A VALID EMAIL ADDRESS')
      return
    }
    setStatus('loading')
    setErrorMsg('')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalized,
          source,
          website: honeypotRef.current?.value ?? '',
        }),
        signal: AbortSignal.timeout(8000),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) {
        setStatus('error')
        setErrorMsg((body?.error || "COULDN'T SIGN UP — TRY AGAIN LATER").toUpperCase())
        return
      }
      markSubscribed()
      setStatus('success')
      onSuccess?.()
    } catch {
      setStatus('error')
      setErrorMsg("COULDN'T SIGN UP — TRY AGAIN LATER")
    }
  }

  const handleDismiss = () => {
    markDismissed()
    onDismiss?.()
  }

  if (status === 'success') {
    return (
      <div className={`signup-form signup-form--${variant}`}>
        <span className="signup-success" role="status">SIGNED UP — WE&apos;LL BE IN TOUCH</span>
      </div>
    )
  }

  return (
    // noValidate: our own validation runs on submit, so errors render in the
    // retro style instead of the browser's native bubble.
    <form className={`signup-form signup-form--${variant}`} onSubmit={handleSubmit} noValidate>
      <label className="signup-label" htmlFor={`signup-email-${source}`}>
        NEWS &amp; UPDATES
      </label>
      <div className="signup-row">
        <input
          ref={inputRef}
          id={`signup-email-${source}`}
          className="signup-input"
          type="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); if (status === 'error') setStatus('idle') }}
          placeholder="you@example.com"
          maxLength={254}
          autoComplete="email"
          disabled={status === 'loading'}
        />
        {/* Honeypot: hidden from real users; bots that fill it are dropped server-side */}
        <input
          ref={honeypotRef}
          type="text"
          name="website"
          className="signup-hp"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />
        <button type="submit" className="btn btn-primary signup-submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'SENDING…' : 'SUBSCRIBE'}
        </button>
        {onDismiss && (
          <button
            type="button"
            className="signup-dismiss"
            onClick={handleDismiss}
            aria-label="Dismiss signup"
            title="Dismiss"
          >
            ×
          </button>
        )}
      </div>
      <span className="signup-status" aria-live="polite">
        {status === 'error' ? <span className="signup-error">{errorMsg}</span> : null}
      </span>
    </form>
  )
}

export default EmailSignupForm
