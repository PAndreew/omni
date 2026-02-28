import { useState, useEffect } from 'react';
import { useSocket } from '../hooks/useSocket.js';
import { setCecKeyboardOpen } from '../hooks/useCecKeyboard.js';

const ROWS = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L','⌫'],
  ['Z','X','C','V','B','N','M','.',' ','↵'],
  ['1','2','3','4','5','6','7','8','9','0'],
];

export default function CecKeyboard({ visible, onSubmit, onClose, placeholder = 'Type…' }) {
  const [text, setText] = useState('');
  const [row, setRow]   = useState(0);
  const [col, setCol]   = useState(0);

  // Tell App.jsx to pause tile navigation while keyboard is open
  useEffect(() => {
    setCecKeyboardOpen(visible);
  }, [visible]);

  // Reset state when keyboard opens
  useEffect(() => {
    if (visible) { setText(''); setRow(0); setCol(0); }
  }, [visible]);

  useSocket('cec:up',    () => { if (!visible) return; setRow(r => Math.max(0, r - 1)); });
  useSocket('cec:down',  () => { if (!visible) return; setRow(r => Math.min(ROWS.length - 1, r + 1)); });
  useSocket('cec:left',  () => { if (!visible) return; setCol(c => Math.max(0, c - 1)); });
  useSocket('cec:right', () => { if (!visible) return; setCol(c => Math.min(ROWS[row].length - 1, c + 1)); });

  useSocket('cec:select', () => {
    if (!visible) return;
    const key = ROWS[row][col];
    if      (key === '⌫') setText(t => t.slice(0, -1));
    else if (key === '↵') { if (text.trim()) { onSubmit(text.trim()); setText(''); } }
    else                  setText(t => t + (key === ' ' ? ' ' : key));
  });

  useSocket('cec:back', () => { if (!visible) return; onClose(); });

  if (!visible) return null;

  return (
    <div className="ceckb-overlay">
      <div className="ceckb-display">
        <span className="ceckb-text">{text || <span className="ceckb-ph">{placeholder}</span>}</span>
        <span className="ceckb-cursor" />
      </div>

      <div className="ceckb-grid">
        {ROWS.map((keys, ri) => (
          <div key={ri} className="ceckb-row">
            {keys.map((key, ci) => (
              <div key={ci} className={`ceckb-key${ri === row && ci === col ? ' active' : ''}`}>
                {key === ' ' ? '⎵' : key}
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="ceckb-hint">D-pad moves · OK types · ↵ confirms · Back cancels</p>

      <style>{`
        .ceckb-overlay {
          position: fixed; inset: 0; z-index: 800;
          background: rgba(0,0,0,0.94);
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 28px;
        }
        .ceckb-display {
          display: flex; align-items: center; gap: 4px;
          border-bottom: 1px solid var(--silver);
          padding: 0 24px 10px; min-width: 480px; justify-content: center;
        }
        .ceckb-text { font-family: 'Satoshi', sans-serif; font-size: 26px;
                      font-weight: 300; color: var(--text); letter-spacing: 0.04em; }
        .ceckb-ph   { color: var(--text-muted); font-style: italic; }
        .ceckb-cursor { width: 2px; height: 28px; background: var(--silver-light);
                        flex-shrink: 0; animation: blink 1s step-start infinite; }
        .ceckb-grid { display: flex; flex-direction: column; gap: 6px; }
        .ceckb-row  { display: flex; gap: 6px; }
        .ceckb-key  {
          width: 72px; height: 58px; display: flex; align-items: center; justify-content: center;
          font-family: 'Satoshi', sans-serif; font-size: 17px; font-weight: 400;
          color: var(--text-dim); background: var(--surface); border: 1px solid var(--border);
          border-radius: 0; transition: all 0.08s; user-select: none;
        }
        .ceckb-key.active {
          color: var(--text); background: rgba(176,176,176,0.12);
          border-color: var(--silver-light);
        }
        .ceckb-hint {
          font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}
