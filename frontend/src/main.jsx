import React from 'react'
import ReactDOM from 'react-dom/client'
import AppMinimal from './AppMinimal'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught render error:', error, info)
    this.setState({ info })
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ backgroundColor: '#0f1117', color: '#f87171', fontFamily: 'monospace', padding: '24px', minHeight: '100vh' }}>
          <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '12px' }}>⚠ Render Error</div>
          <div style={{ fontSize: '13px', color: '#fbbf24', marginBottom: '8px' }}>{String(this.state.error)}</div>
          {this.state.info && (
            <pre style={{ fontSize: '11px', color: '#9ca3af', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {this.state.info.componentStack}
            </pre>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: null, info: null })}
            style={{ marginTop: '16px', padding: '8px 16px', background: '#1e2330', border: '1px solid #374151', color: '#e5e7eb', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' }}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <AppMinimal />
  </ErrorBoundary>,
)
