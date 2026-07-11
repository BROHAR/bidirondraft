import { useEffect } from 'react'
import EmailSignupForm from './EmailSignupForm'

// News & updates signup modal, opened from the title-screen footer link.
// Mirrors ConfirmDialog's overlay/Escape/focus behavior, with one critical
// difference: it renders inside .title-screen, whose root onClick starts the
// game — so every click that closes the modal must stopPropagation, or
// dismissing the signup would also navigate to SETUP.
function SignupModal({ open, onClose, source }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { e.stopPropagation(); onClose() }}
    >
      <div
        className="modal-content modal-content--signup"
        role="dialog"
        aria-modal="true"
        aria-label="Sign up for news and updates"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="signup-modal-title">STAY IN THE LOOP</h3>
        <p className="signup-modal-blurb">
          Occasional emails about new features and updated player projections. No spam.
        </p>
        <EmailSignupForm source={source} variant="card" autoFocus />
        <button
          type="button"
          className="btn btn-secondary signup-modal-close"
          onClick={onClose}
        >
          CLOSE
        </button>
      </div>
    </div>
  )
}

export default SignupModal
