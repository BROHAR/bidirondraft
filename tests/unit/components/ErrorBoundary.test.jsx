import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import ErrorBoundary from '../../../src/components/ErrorBoundary.jsx'

function Bomb() {
  throw new Error('kaboom')
}

describe('ErrorBoundary', () => {
  // React logs caught render errors loudly; keep test output clean.
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks() })

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div>app content</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('app content')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the recovery UI instead of a blank page when a child throws', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })

  it('reload button triggers window.location.reload', () => {
    const reload = vi.fn()
    const original = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    })
    try {
      render(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      )
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original })
    }
  })
})
