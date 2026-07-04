import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import ConfirmDialog from '../../../src/components/ConfirmDialog.jsx'

const setup = (props = {}) => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <ConfirmDialog
      open
      title="Restart Draft?"
      message="All progress will be lost."
      confirmLabel="Restart"
      danger
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />
  )
  return { onConfirm, onCancel }
}

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    render(
      <ConfirmDialog open={false} title="T" message="M" onConfirm={() => {}} onCancel={() => {}} />
    )
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('shows title, message, and labeled actions when open', () => {
    setup()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText('Restart Draft?')).toBeTruthy()
    expect(screen.getByText('All progress will be lost.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('fires onConfirm from the confirm button only', () => {
    const { onConfirm, onCancel } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels via the cancel button, overlay click, and Escape', () => {
    const { onConfirm, onCancel } = setup()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(document.querySelector('.modal-overlay'))
    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onCancel).toHaveBeenCalledTimes(3)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('does not cancel when clicking inside the dialog', () => {
    const { onCancel } = setup()
    fireEvent.click(screen.getByText('All progress will be lost.'))
    expect(onCancel).not.toHaveBeenCalled()
  })
})
