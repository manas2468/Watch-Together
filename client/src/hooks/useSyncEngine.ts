// ============================================================================
// Sync Engine Hook — The heart of Watch Together
// ============================================================================
// Implements the 6-part sync protocol described in the spec:
//
// 1. CLOCK OFFSET: Uses useClockOffset for server-aligned time.
//
// 2. EVENT FLOW (Intent-based): User actions emit intents to the server.
//    The client NEVER directly controls its own player. Server validates,
//    updates state, and broadcasts playback:update to ALL clients (including
//    the sender). Only then do clients apply it.
//
// 3. ECHO SUPPRESSION: isApplyingRemoteUpdate flag prevents player event
//    handlers from re-emitting intents when we programmatically control
//    the player (which triggers onStateChange/onSeek events).
//
// 4. DRIFT CORRECTION: Every 3s, compares actual player position to the
//    expected position computed from server state.
//    - < 0.5s drift: do nothing
//    - 0.5s–2s: nudge playbackRate (smooth, no visible jump)
//    - > 2s: hard seek (throttled to max once per 5s)
//
// 5. BUFFERING: Reports stalls to server; server pauses everyone.
//
// 6. LATE JOINERS: Waits for player ready event before seeking.

import { useCallback, useRef, useEffect } from 'react';
import { useSocket } from '../context/SocketContext';
import { useRoom, PlaybackState } from '../context/RoomContext';
import { useClockOffset } from './useClockOffset';

export interface PlayerAPI {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
  setPlaybackRate: (rate: number) => void;
  getPlaybackRate: () => number;
  isReady: () => boolean;
}

export function useSyncEngine() {
  const { socket } = useSocket();
  const { state, canControl } = useRoom();
  const { getServerTime } = useClockOffset();

  // Refs for mutable state that doesn't trigger re-renders
  const playerRef = useRef<PlayerAPI | null>(null);
  const isApplyingRemoteUpdateRef = useRef(false);
  const echoSuppressionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const driftIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastHardSeekRef = useRef(0);
  const rateNudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isBufferingRef = useRef(false);
  const hasStalledRef = useRef(false);

  // Store latest playback state in a ref so drift correction uses current values
  const playbackRef = useRef<PlaybackState>(state.playback);
  useEffect(() => {
    playbackRef.current = state.playback;
  }, [state.playback]);

  const roomIdRef = useRef(state.roomId);
  useEffect(() => {
    roomIdRef.current = state.roomId;
  }, [state.roomId]);

  /**
   * Register a player instance with the sync engine.
   * Call this once the player is ready.
   */
  const registerPlayer = useCallback((api: PlayerAPI) => {
    playerRef.current = api;
  }, []);

  /**
   * Unregister the player (on unmount).
   */
  const unregisterPlayer = useCallback(() => {
    playerRef.current = null;
  }, []);

  // ===== Echo Suppression =====
  // Set the flag before programmatic player control, clear after 300ms.
  // Player event handlers must check this flag and return immediately if true.

  const beginRemoteUpdate = useCallback(() => {
    isApplyingRemoteUpdateRef.current = true;
    if (echoSuppressionTimerRef.current) clearTimeout(echoSuppressionTimerRef.current);
    echoSuppressionTimerRef.current = setTimeout(() => {
      isApplyingRemoteUpdateRef.current = false;
    }, 300);
  }, []);

  /**
   * Check if a player event should be ignored (because it's an echo
   * from a programmatic update we just applied).
   */
  const isEchoSuppressed = useCallback((): boolean => {
    return isApplyingRemoteUpdateRef.current;
  }, []);

  // ===== Compute Expected Position =====
  // The authoritative formula from the spec:
  //   isPlaying ? positionSec + (serverNow - lastUpdatedAt) / 1000 : positionSec

  const getExpectedPosition = useCallback((): number => {
    const pb = playbackRef.current;
    if (!pb.isPlaying) return pb.positionSec;
    const serverNow = getServerTime();
    return pb.positionSec + (serverNow - pb.lastUpdatedAt) / 1000;
  }, [getServerTime]);

  // ===== Apply Remote Playback Update =====
  // Called when the server broadcasts a new playback state.

  const applyPlaybackUpdate = useCallback(
    (playback: PlaybackState, reason?: string) => {
      const player = playerRef.current;
      if (!player || !player.isReady()) return;

      beginRemoteUpdate();

      // Compute the position we should be at NOW
      const targetPos = playback.isPlaying
        ? playback.positionSec + (getServerTime() - playback.lastUpdatedAt) / 1000
        : playback.positionSec;

      const currentPos = player.getCurrentTime();
      const drift = Math.abs(currentPos - targetPos);

      // Always seek on explicit seek or large drift
      if (reason === 'seek' || drift > 1) {
        player.seekTo(targetPos);
      }

      if (playback.isPlaying) {
        player.play();
      } else {
        player.pause();
      }
    },
    [getServerTime, beginRemoteUpdate]
  );

  // ===== Listen for playback:update events =====
  useEffect(() => {
    if (!socket) return;

    const handlePlaybackUpdate = (data: { playback: PlaybackState; reason?: string }) => {
      applyPlaybackUpdate(data.playback, data.reason);
    };

    socket.on('playback:update', handlePlaybackUpdate);
    return () => {
      socket.off('playback:update', handlePlaybackUpdate);
    };
  }, [socket, applyPlaybackUpdate]);

  // ===== Drift Correction (every 3 seconds) =====
  useEffect(() => {
    if (driftIntervalRef.current) clearInterval(driftIntervalRef.current);

    driftIntervalRef.current = setInterval(() => {
      const player = playerRef.current;
      const pb = playbackRef.current;
      if (!player || !player.isReady() || !pb.isPlaying) return;

      const expected = getExpectedPosition();
      const actual = player.getCurrentTime();
      const drift = actual - expected; // positive = ahead, negative = behind

      const absDrift = Math.abs(drift);

      if (absDrift < 0.5) {
        // Within tolerance — ensure normal rate
        if (player.getPlaybackRate() !== 1.0) {
          player.setPlaybackRate(1.0);
        }
        return;
      }

      if (absDrift <= 2) {
        // Soft correction: nudge playback rate
        const nudgeRate = drift > 0 ? 0.95 : 1.05;
        player.setPlaybackRate(nudgeRate);

        // Reset rate after 2 seconds
        if (rateNudgeTimerRef.current) clearTimeout(rateNudgeTimerRef.current);
        rateNudgeTimerRef.current = setTimeout(() => {
          if (playerRef.current?.isReady()) {
            playerRef.current.setPlaybackRate(1.0);
          }
        }, 2000);

        return;
      }

      // Hard correction (drift > 2s) — throttled to max once per 5s
      const now = Date.now();
      if (now - lastHardSeekRef.current < 5000) return;
      lastHardSeekRef.current = now;

      beginRemoteUpdate();
      player.seekTo(expected);
      player.setPlaybackRate(1.0);

      console.log(`[SyncEngine] Hard seek: drift=${drift.toFixed(2)}s`);
    }, 3000);

    return () => {
      if (driftIntervalRef.current) clearInterval(driftIntervalRef.current);
      if (rateNudgeTimerRef.current) clearTimeout(rateNudgeTimerRef.current);
    };
  }, [getExpectedPosition, beginRemoteUpdate]);

  // ===== User Actions (Intents) =====
  // These emit to the server. The server validates and broadcasts back.

  const emitPlay = useCallback(() => {
    if (!socket || !roomIdRef.current || !canControl) return;
    socket.emit('playback:play', { roomId: roomIdRef.current });
  }, [socket, canControl]);

  const emitPause = useCallback(() => {
    if (!socket || !roomIdRef.current || !canControl) return;
    socket.emit('playback:pause', { roomId: roomIdRef.current });
  }, [socket, canControl]);

  const emitSeek = useCallback(
    (positionSec: number) => {
      if (!socket || !roomIdRef.current || !canControl) return;
      socket.emit('playback:seek', { roomId: roomIdRef.current, positionSec: Math.max(0, positionSec) });
    },
    [socket, canControl]
  );

  const emitSeekRelative = useCallback(
    (deltaSec: number) => {
      if (!socket || !roomIdRef.current || !canControl) return;
      const current = playerRef.current?.isReady()
        ? playerRef.current.getCurrentTime()
        : getExpectedPosition();
      const target = Math.max(0, current + deltaSec);
      socket.emit('playback:seek', { roomId: roomIdRef.current, positionSec: target });
    },
    [socket, canControl, getExpectedPosition]
  );

  // ===== Buffering Coordination =====

  const reportBuffering = useCallback(
    (buffering: boolean) => {
      if (!socket || !roomIdRef.current) return;

      if (buffering && !hasStalledRef.current) {
        isBufferingRef.current = true;
        // Only report if buffering for > 2 seconds
        if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
        stallTimerRef.current = setTimeout(() => {
          if (isBufferingRef.current) {
            hasStalledRef.current = true;
            socket.emit('playback:stall', { roomId: roomIdRef.current });
          }
        }, 2000);
      } else if (!buffering) {
        isBufferingRef.current = false;
        if (stallTimerRef.current) {
          clearTimeout(stallTimerRef.current);
          stallTimerRef.current = null;
        }
        if (hasStalledRef.current) {
          hasStalledRef.current = false;
          socket.emit('playback:ready', { roomId: roomIdRef.current });
        }
      }
    },
    [socket]
  );

  const reportMediaEnded = useCallback(() => {
    if (!socket || !roomIdRef.current) return;
    socket.emit('media:ended', { roomId: roomIdRef.current });
  }, [socket]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (echoSuppressionTimerRef.current) clearTimeout(echoSuppressionTimerRef.current);
      if (driftIntervalRef.current) clearInterval(driftIntervalRef.current);
      if (rateNudgeTimerRef.current) clearTimeout(rateNudgeTimerRef.current);
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    };
  }, []);

  return {
    registerPlayer,
    unregisterPlayer,
    isEchoSuppressed,
    getExpectedPosition,
    applyPlaybackUpdate,
    emitPlay,
    emitPause,
    emitSeek,
    emitSeekRelative,
    reportBuffering,
    reportMediaEnded,
    beginRemoteUpdate,
  };
}
