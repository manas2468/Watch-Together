// ============================================================================
// Socket Context — Manages the Socket.IO connection lifecycle
// ============================================================================
// Provides the socket instance to the component tree. Handles connection,
// reconnection with exponential backoff, and the "Reconnecting…" banner state.

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  isReconnecting: boolean;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
  isReconnecting: false,
});

export function useSocket() {
  return useContext(SocketContext);
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    // Create socket connection — connects to VITE_SERVER_URL if provided, else origin
    const serverUrl = import.meta.env.VITE_SERVER_URL || undefined;
    const socket = io(serverUrl, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      // Exponential backoff factor
      randomizationFactor: 0.5,
      timeout: 10000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
      setIsConnected(true);
      setIsReconnecting(false);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      setIsConnected(false);
      // Only show reconnecting if it wasn't an intentional disconnect
      if (reason !== 'io client disconnect') {
        setIsReconnecting(true);
      }
    });

    socket.on('reconnect_attempt', (attempt) => {
      console.log(`[Socket] Reconnection attempt ${attempt}`);
      setIsReconnecting(true);
    });

    socket.on('reconnect', () => {
      console.log('[Socket] Reconnected');
      setIsReconnecting(false);
    });

    socket.on('reconnect_failed', () => {
      console.log('[Socket] Reconnection failed');
      setIsReconnecting(false);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, isConnected, isReconnecting }}>
      {children}
    </SocketContext.Provider>
  );
}
