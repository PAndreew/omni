/**
 * Tiny global store so App.jsx can pause D-pad tile navigation
 * while the on-screen CEC keyboard is open, without prop-drilling.
 */
import { useState, useEffect } from 'react';

let _open = false;
const _listeners = new Set();

export function setCecKeyboardOpen(value) {
  _open = value;
  _listeners.forEach(fn => fn(value));
}

export function useCecKeyboardOpen() {
  const [open, setOpen] = useState(_open);
  useEffect(() => {
    _listeners.add(setOpen);
    return () => _listeners.delete(setOpen);
  }, []);
  return open;
}
