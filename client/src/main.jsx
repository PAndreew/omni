import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/index.css';

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ color: '#f87171', padding: 32, fontFamily: 'monospace', fontSize: 13, background: '#000', minHeight: '100vh' }}>
          <strong>App crashed:</strong>
          <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error?.message}
            {'\n'}
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Catch unhandled errors and rejections — show on screen instead of going dark
const errDiv = document.createElement('div');
errDiv.style.cssText = 'display:none;position:fixed;inset:0;z-index:99999;background:#000;color:#f87171;padding:24px;font-family:monospace;font-size:12px;white-space:pre-wrap;word-break:break-all;overflow:auto';
document.body.appendChild(errDiv);
function showError(msg) { errDiv.style.display = 'block'; errDiv.textContent += msg + '\n\n'; }
window.onerror = (msg, src, line, col, err) => showError(`ERROR: ${msg}\n${src}:${line}:${col}\n${err?.stack || ''}`);
window.onunhandledrejection = (e) => showError(`UNHANDLED REJECTION: ${e.reason?.stack || e.reason}`);

createRoot(document.getElementById('root')).render(
  <ErrorBoundary><App /></ErrorBoundary>
);
