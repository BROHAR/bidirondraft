import React from 'react'

// Top-level error boundary: without one, any uncaught render error unmounts
// the whole React root and leaves a blank page with no way back. This shows a
// minimal recovery card instead. Class component by necessity —
// getDerivedStateFromError has no hooks equivalent.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // Surface the real stack in the console; the UI stays generic.
    console.error('Unhandled render error:', error, info?.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="error-boundary" role="alert" style={{
        maxWidth: '28rem',
        margin: '15vh auto',
        padding: '2rem',
        textAlign: 'center',
      }}>
        <h2 style={{ marginBottom: '0.75rem' }}>Something went wrong</h2>
        <p style={{ marginBottom: '1.5rem', opacity: 0.8 }}>
          The app hit an unexpected error. Reloading usually fixes it — your
          saved setup is kept.
        </p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}

export default ErrorBoundary
