import { useCallback } from 'react';

export function useNotifications() {
  const requestPermission = useCallback(async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }, []);

  const notify = useCallback(({ title, body, icon = '🖥️', urgent = false }) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: urgent ? 'urgent' : 'info',
        requireInteraction: urgent,
      });
    }
  }, []);

  return { requestPermission, notify };
}
