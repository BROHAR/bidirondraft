import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import SignupModal from '../../../src/components/SignupModal.jsx'

const setup = (props = {}) => {
  const onClose = vi.fn()
  // The wrapper's onClick stands in for TitleScreen's root click-to-start
  // handler: nothing that happens inside the modal may reach it.
  const onOutsideClick = vi.fn()
  render(
    <div onClick={onOutsideClick}>
      <SignupModal open onClose={onClose} source="title" {...props} />
    </div>
  )
  return { onClose, onOutsideClick }
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('SignupModal', () => {
  it('renders nothing when closed', () => {
    render(<SignupModal open={false} onClose={() => {}} source="title" />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the dialog with the email form when open', () => {
    setup()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/news & updates/i)).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    const { onClose } = setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on overlay click without propagating to the screen behind', () => {
    const { onClose, onOutsideClick } = setup()
    fireEvent.click(document.querySelector('.modal-overlay'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOutsideClick).not.toHaveBeenCalled()
  })

  it('closes via the CLOSE button', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'CLOSE' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not close or propagate when clicking inside the dialog', () => {
    const { onClose, onOutsideClick } = setup()
    fireEvent.click(screen.getByLabelText(/news & updates/i))
    expect(onClose).not.toHaveBeenCalled()
    expect(onOutsideClick).not.toHaveBeenCalled()
  })
})
