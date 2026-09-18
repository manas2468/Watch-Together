// ============================================================================
// Room Context — Central state store for the current room
// ============================================================================
// Holds the full room snapshot, listens for real-time updates from the server,
// and provides actions (join, leave, create, chat, etc.) to components.

import React, { createContext, useContext, useCallback, useEffect, useReducer, useRef } from 'react';
import { useSocket } from './SocketContext';

// ----- Types matching server's types.ts -----
export interface Member {
  id: string;
  username: string;
  color: string;
  isHost: boolean;
  isMuted: boolean;
  cameraOn: boolean;
  joinedAt: number;
  inCall: boolean;
}

export interface MediaItem {
  id: string;
  type: 'youtube' | 'direct' | 'upload';
  url: string;
  title: string;
  addedBy: string;
  duration: number | null;
}

export interface PlaybackState {
  isPlaying: boolean;
  positionSec: number;
  lastUpdatedAt: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  color: string;
  content: string;
  timestamp: number;
  isSystem: boolean;
}

export interface RoomSnapshot {
  id: string;
  name: string;
  hostId: string;
  everyoneCanControl: boolean;
  locked: boolean;
  ignoreSlowViewers: boolean;
  members: Member[];
  queue: MediaItem[];
  currentItem: MediaItem | null;
  playback: PlaybackState;
  messages: ChatMessage[];
  serverTime: number;
}

// ----- Toast -----
export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  timestamp: number;
}

// ----- Reaction -----
export interface Reaction {
  id: string;
  emoji: string;
  username: string;
  x: number; // random horizontal position %
}

// ----- Room State -----
export interface RoomState {
  roomId: string | null;
  name: string;
  hostId: string;
  everyoneCanControl: boolean;
  locked: boolean;
  ignoreSlowViewers: boolean;
  members: Member[];
  queue: MediaItem[];
  currentItem: MediaItem | null;
  playback: PlaybackState;
  messages: ChatMessage[];
  toasts: Toast[];
  reactions: Reaction[];
  mySocketId: string | null;
  username: string | null;
  serverTimeDelta: number; // Offset for rough clock sync from snapshot
}

// ----- Actions -----
type RoomAction =
  | { type: 'SET_ROOM'; snapshot: RoomSnapshot; socketId: string }
  | { type: 'CLEAR_ROOM' }
  | { type: 'UPDATE_ROOM'; updates: Partial<RoomSnapshot> }
  | { type: 'MEMBER_JOINED'; member: Member }
  | { type: 'MEMBER_LEFT'; memberId: string }
  | { type: 'CHAT_MESSAGE'; message: ChatMessage }
  | { type: 'PLAYBACK_UPDATE'; playback: PlaybackState }
  | { type: 'MEDIA_CHANGED'; currentItem: MediaItem | null; playback: PlaybackState }
  | { type: 'QUEUE_UPDATE'; queue: MediaItem[] }
  | { type: 'ADD_TOAST'; toast: Toast }
  | { type: 'REMOVE_TOAST'; id: string }
  | { type: 'ADD_REACTION'; reaction: Reaction }
  | { type: 'REMOVE_REACTION'; id: string }
  | { type: 'SET_USERNAME'; username: string }
  | { type: 'SET_SOCKET_ID'; socketId: string };

const initialState: RoomState = {
  roomId: null,
  name: '',
  hostId: '',
  everyoneCanControl: false,
  locked: false,
  ignoreSlowViewers: false,
  members: [],
  queue: [],
  currentItem: null,
  playback: { isPlaying: false, positionSec: 0, lastUpdatedAt: Date.now() },
  messages: [],
  toasts: [],
  reactions: [],
  mySocketId: null,
  username: null,
  serverTimeDelta: 0,
};

function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case 'SET_ROOM': {
      const s = action.snapshot;
      return {
        ...state,
        roomId: s.id,
        name: s.name,
        hostId: s.hostId,
        everyoneCanControl: s.everyoneCanControl,
        locked: s.locked,
        ignoreSlowViewers: s.ignoreSlowViewers,
        members: s.members,
        queue: s.queue,
        currentItem: s.currentItem,
        playback: s.playback,
        messages: s.messages,
        mySocketId: action.socketId,
        serverTimeDelta: s.serverTime ? s.serverTime - Date.now() : 0,
      };
    }
    case 'CLEAR_ROOM':
      return { ...initialState, username: state.username, mySocketId: state.mySocketId };
    case 'UPDATE_ROOM':
      return {
        ...state,
        ...(action.updates.members !== undefined && { members: action.updates.members as Member[] }),
        ...(action.updates.hostId !== undefined && { hostId: action.updates.hostId }),
        ...(action.updates.everyoneCanControl !== undefined && { everyoneCanControl: action.updates.everyoneCanControl }),
        ...(action.updates.locked !== undefined && { locked: action.updates.locked }),
        ...(action.updates.ignoreSlowViewers !== undefined && { ignoreSlowViewers: action.updates.ignoreSlowViewers }),
      };
    case 'MEMBER_JOINED':
      // Avoid duplicates
      if (state.members.find((m) => m.id === action.member.id)) {
        return {
          ...state,
          members: state.members.map((m) => (m.id === action.member.id ? action.member : m)),
        };
      }
      return { ...state, members: [...state.members, action.member] };
    case 'MEMBER_LEFT':
      return { ...state, members: state.members.filter((m) => m.id !== action.memberId) };
    case 'CHAT_MESSAGE':
      // Deduplicate by message ID
      if (state.messages.find((m) => m.id === action.message.id)) return state;
      return { ...state, messages: [...state.messages, action.message].slice(-200) };
    case 'PLAYBACK_UPDATE':
      return { ...state, playback: action.playback };
    case 'MEDIA_CHANGED':
      return { ...state, currentItem: action.currentItem, playback: action.playback };
    case 'QUEUE_UPDATE':
      return { ...state, queue: action.queue };
    case 'ADD_TOAST':
      return { ...state, toasts: [...state.toasts, action.toast].slice(-5) };
    case 'REMOVE_TOAST':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case 'ADD_REACTION':
      return { ...state, reactions: [...state.reactions, action.reaction] };
    case 'REMOVE_REACTION':
      return { ...state, reactions: state.reactions.filter((r) => r.id !== action.id) };
    case 'SET_USERNAME':
      return { ...state, username: action.username };
    case 'SET_SOCKET_ID':
      return { ...state, mySocketId: action.socketId };
    default:
      return state;
  }
}

// ----- Context -----
interface RoomContextValue {
  state: RoomState;
  dispatch: React.Dispatch<RoomAction>;
  createRoom: (name: string, username: string) => Promise<RoomSnapshot | null>;
  joinRoom: (roomId: string, username: string) => Promise<RoomSnapshot | null>;
  leaveRoom: () => void;
  sendMessage: (content: string) => void;
  sendReaction: (emoji: string) => void;
  addToast: (message: string, type?: Toast['type']) => void;
  isHost: boolean;
  canControl: boolean;
}

const RoomContext = createContext<RoomContextValue>(null!);

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used within RoomProvider');
  return ctx;
}

export function RoomProvider({ children }: { children: React.ReactNode }) {
  const { socket, isConnected } = useSocket();
  const [state, dispatch] = useReducer(roomReducer, {
    ...initialState,
    username: localStorage.getItem('wt-username'),
  });
  const toastTimeoutIds = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ----- Toast helper -----
  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    dispatch({ type: 'ADD_TOAST', toast: { id, message, type, timestamp: Date.now() } });
    const tid = setTimeout(() => {
      dispatch({ type: 'REMOVE_TOAST', id });
      toastTimeoutIds.current.delete(id);
    }, 4000);
    toastTimeoutIds.current.set(id, tid);
  }, []);

  // ----- Socket event listeners -----
  useEffect(() => {
    if (!socket) return;

    const handlers = {
      'room:update': (data: any) => {
        dispatch({ type: 'UPDATE_ROOM', updates: data });
      },
      'member:joined': (data: { member: Member }) => {
        dispatch({ type: 'MEMBER_JOINED', member: data.member });
      },
      'member:left': (data: { memberId: string }) => {
        dispatch({ type: 'MEMBER_LEFT', memberId: data.memberId });
      },
      'chat:message': (msg: ChatMessage) => {
        dispatch({ type: 'CHAT_MESSAGE', message: msg });
      },
      'chat:reaction': (data: { id: string; emoji: string; username: string }) => {
        const reaction: Reaction = {
          id: data.id,
          emoji: data.emoji,
          username: data.username,
          x: 10 + Math.random() * 80,
        };
        dispatch({ type: 'ADD_REACTION', reaction });
        setTimeout(() => dispatch({ type: 'REMOVE_REACTION', id: data.id }), 2200);
      },
      'playback:update': (data: { playback: PlaybackState }) => {
        dispatch({ type: 'PLAYBACK_UPDATE', playback: data.playback });
      },
      'media:changed': (data: { currentItem: MediaItem | null; playback: PlaybackState }) => {
        dispatch({ type: 'MEDIA_CHANGED', currentItem: data.currentItem, playback: data.playback });
      },
      'queue:update': (data: { queue: MediaItem[] }) => {
        dispatch({ type: 'QUEUE_UPDATE', queue: data.queue });
      },
      'toast': (data: { message: string; type: Toast['type'] }) => {
        addToast(data.message, data.type);
      },
      'room:kicked': (data: { message: string }) => {
        addToast(data.message, 'error');
        dispatch({ type: 'CLEAR_ROOM' });
      },
    };

    // Register all listeners
    for (const [event, handler] of Object.entries(handlers)) {
      socket.on(event, handler);
    }

    // Update socket ID when connected
    if (socket.id) {
      dispatch({ type: 'SET_SOCKET_ID', socketId: socket.id });
    }
    socket.on('connect', () => {
      if (socket.id) dispatch({ type: 'SET_SOCKET_ID', socketId: socket.id });
    });

    // Cleanup — remove ALL listeners to prevent duplicates after remount
    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        socket.off(event, handler);
      }
      socket.off('connect');
    };
  }, [socket, addToast]);

  // ----- Reconnection: rejoin room -----
  useEffect(() => {
    if (!socket || !isConnected || !state.roomId || !state.username) return;

    // On reconnect, re-emit room:rejoin to get a fresh snapshot
    const handleReconnect = () => {
      socket.emit(
        'room:rejoin',
        { roomId: state.roomId, username: state.username },
        (response: any) => {
          if (response?.error) {
            addToast(response.error, 'error');
            dispatch({ type: 'CLEAR_ROOM' });
          } else if (response?.room) {
            dispatch({ type: 'SET_ROOM', snapshot: response.room, socketId: socket.id! });
          }
        }
      );
    };

    socket.on('reconnect', handleReconnect);
    return () => {
      socket.off('reconnect', handleReconnect);
    };
  }, [socket, isConnected, state.roomId, state.username, addToast]);

  // ----- Actions -----
  const createRoom = useCallback(
    (name: string, username: string): Promise<RoomSnapshot | null> => {
      return new Promise((resolve) => {
        if (!socket) return resolve(null);
        socket.emit('room:create', { name, username }, (response: any) => {
          if (response?.error) {
            addToast(response.error, 'error');
            resolve(null);
          } else if (response?.room) {
            dispatch({ type: 'SET_ROOM', snapshot: response.room, socketId: socket.id! });
            dispatch({ type: 'SET_USERNAME', username });
            localStorage.setItem('wt-username', username);
            resolve(response.room);
          }
        });
      });
    },
    [socket, addToast]
  );

  const joinRoom = useCallback(
    (roomId: string, username: string): Promise<RoomSnapshot | null> => {
      return new Promise((resolve) => {
        if (!socket) return resolve(null);
        socket.emit('room:join', { roomId, username }, (response: any) => {
          if (response?.error) {
            addToast(response.error, 'error');
            resolve(null);
          } else if (response?.room) {
            dispatch({ type: 'SET_ROOM', snapshot: response.room, socketId: socket.id! });
            // Use the actual username (might have been suffixed for uniqueness)
            const actualUsername = response.member?.username || username;
            dispatch({ type: 'SET_USERNAME', username: actualUsername });
            localStorage.setItem('wt-username', actualUsername);
            resolve(response.room);
          }
        });
      });
    },
    [socket, addToast]
  );

  const leaveRoom = useCallback(() => {
    if (socket && state.roomId) {
      socket.emit('room:leave');
    }
    dispatch({ type: 'CLEAR_ROOM' });
  }, [socket, state.roomId]);

  const sendMessage = useCallback(
    (content: string) => {
      if (!socket || !state.roomId) return;
      socket.emit('chat:message', { roomId: state.roomId, content });
    },
    [socket, state.roomId]
  );

  const sendReaction = useCallback(
    (emoji: string) => {
      if (!socket || !state.roomId) return;
      socket.emit('chat:reaction', { roomId: state.roomId, emoji });
    },
    [socket, state.roomId]
  );

  // Computed values: All members can control playback
  const isHost = state.mySocketId === state.hostId;
  const canControl = true;

  // Cleanup toast timeouts on unmount
  useEffect(() => {
    return () => {
      for (const tid of toastTimeoutIds.current.values()) clearTimeout(tid);
    };
  }, []);

  return (
    <RoomContext.Provider
      value={{
        state,
        dispatch,
        createRoom,
        joinRoom,
        leaveRoom,
        sendMessage,
        sendReaction,
        addToast,
        isHost,
        canControl,
      }}
    >
      {children}
    </RoomContext.Provider>
  );
}
