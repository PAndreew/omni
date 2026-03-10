import { useCallback } from 'react';

export function useNotifications() {
  const requestPermission = useCallback(async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }, []);

  const notify = useCallback(({ title, body, icon, urgent = false }) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      const safeIcon = typeof icon === 'string' && /^(\/|https?:\/\/)/.test(icon) ? icon : '/logo.svg';
      new Notification(title, {
        body,
        icon: safeIcon,
        badge: '/logo.svg',
        tag: urgent ? 'urgent' : 'info',
        requireInteraction: urgent,
      });
    }
  }, []);

  return { requestPermission, notify };
}
