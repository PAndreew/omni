import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(window.location.origin.replace('5173', '3001'), {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}

export function useSocket(event, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const s = getSocket();
    const cb = (...args) => handlerRef.current(...args);
    s.on(event, cb);
    return () => s.off(event, cb);
  }, [event]);
}
