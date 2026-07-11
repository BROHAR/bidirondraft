import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import EmailSignupForm from '../../../src/components/EmailSignupForm.jsx'
import { loadSubscribeState } from '../../../src/utils/subscribeStore'

const okResponse = { ok: true, json: () => Promise.resolve({ ok: true }) }

const setup = (props = {}) => {
  const onSuccess = vi.fn()
  const onDismiss = vi.fn()
  render(<EmailSignupForm source="title" onSuccess={onSuccess} onDismiss={onDismiss} {...props} />)
  return { onSuccess, onDismiss }
}

const submitEmail = (value) => {
  fireEvent.change(screen.getByLabelText(/news & updates/i), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'SUBSCRIBE' }))
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('EmailSignupForm', () => {
  it('posts the email and shows success, marking localStorage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse)
    vi.stubGlobal('fetch', fetchMock)
    const { onSuccess } = setup()

    submitEmail('Fan@Example.com')

    await screen.findByText(/SIGNED UP/)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(loadSubscribeState()).toMatchObject({ status: 'subscribed' })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/subscribe')
    expect(JSON.parse(opts.body)).toMatchObject({ email: 'fan@example.com', source: 'title' })
  })

  it('rejects an invalid email locally without calling fetch', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    setup()

    submitEmail('not-an-email')

    expect(screen.getByText('ENTER A VALID EMAIL ADDRESS')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(loadSubscribeState()).toBeNull()
  })

  it('shows an error on a server failure and does not mark subscribed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ ok: false, error: 'Too many requests. Try again later.' }),
    }))
    setup()

    submitEmail('fan@example.com')

    await screen.findByText('TOO MANY REQUESTS. TRY AGAIN LATER.')
    expect(loadSubscribeState()).toBeNull()
  })

  it('shows a generic error when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))
    setup()

    submitEmail('fan@example.com')

    await screen.findByText(/COULDN'T SIGN UP/)
    expect(loadSubscribeState()).toBeNull()
  })

  it('dismiss marks localStorage and notifies the parent', () => {
    const { onDismiss } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss signup' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(loadSubscribeState()).toMatchObject({ status: 'dismissed' })
  })

  it('hides the dismiss button when no onDismiss is provided', () => {
    render(<EmailSignupForm source="title" />)
    expect(screen.queryByRole('button', { name: 'Dismiss signup' })).toBeNull()
  })

  it('recovers from the error state when the user edits the email', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({ ok: false }) })
      .mockResolvedValueOnce(okResponse)
    vi.stubGlobal('fetch', fetchMock)
    setup()

    submitEmail('fan@example.com')
    await screen.findByText(/COULDN'T SIGN UP/)

    submitEmail('fan2@example.com')
    await screen.findByText(/SIGNED UP/)
  })
})
