import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../hooks/useSocket.js';
import { useNotifications } from '../hooks/useNotifications.js';
import { useTTS } from '../hooks/useVoice.js';

export default function NotificationManager() {
  const [toasts, setToasts] = useState([]);
  const { requestPermission, notify } = useNotifications();
  const { speak } = useTTS();

  useEffect(() => { requestPermission(); }, [requestPermission]);

  const addToast = useCallback((notification) => {
    const id = Date.now();
    setToasts(prev => [...prev, { ...notification, id }]);
    // Browser notification
    notify(notification);
    // TTS for speak-flagged notifications
    if (notification.speak) speak(notification.body);
    // Auto-remove after 6s (12s if urgent)
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, notification.urgent ? 12000 : 6000);
  }, [notify, speak]);

  useSocket('notification', addToast);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.urgent ? 'urgent' : ''}`} onClick={() => dismiss(t.id)}>
          <div className="toast-title">{t.icon} {t.title}</div>
          <div className="toast-body">{t.body}</div>
        </div>
      ))}
    </div>
  );
}
