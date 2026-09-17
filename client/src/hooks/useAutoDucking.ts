// ============================================================================
// Auto-Ducking Hook — Lower movie volume when someone is speaking
// ============================================================================
// Uses AudioContext + AnalyserNode to detect speech on remote peer streams.
// When volume exceeds the threshold, the movie volume is lowered to 30%.
// Volume is restored 1.5s after speech stops. Toggleable by the user.

import { useCallback, useEffect, useRef, useState } from 'react';

const SPEECH_THRESHOLD = 30;      // Volume level (0-255) to consider "speaking"
const DUCK_VOLUME = 0.3;           // Movie volume when someone is speaking
const RESTORE_DELAY_MS = 1500;     // Delay before restoring volume after speech stops
const ANALYSIS_INTERVAL_MS = 100;  // How often to check for speech

interface DuckingOptions {
  peerStreams: { stream: MediaStream | null }[];
  playerVolumeRef: React.MutableRefObject<number>;  // Original volume
  setPlayerVolume: (volume: number) => void;
  enabled: boolean;
}

export function useAutoDucking({
  peerStreams,
  playerVolumeRef,
  setPlayerVolume,
  enabled,
}: DuckingOptions) {
  const [isDucked, setIsDucked] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef<Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode }>>(
    new Map()
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDuckedRef = useRef(false);

  // Set up audio analysis for peer streams
  useEffect(() => {
    if (!enabled) {
      // If disabled, clean up and restore volume
      cleanupAnalysers();
      if (isDuckedRef.current) {
        setPlayerVolume(playerVolumeRef.current);
        isDuckedRef.current = false;
        setIsDucked(false);
      }
      return;
    }

    // Create AudioContext lazily (needs user gesture)
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new AudioContext();
      } catch {
        return;
      }
    }

    const ctx = audioContextRef.current;

    // Create analysers for each peer stream
    const activeStreamIds = new Set<string>();
    for (const peer of peerStreams) {
      if (!peer.stream) continue;
      const streamId = peer.stream.id;
      activeStreamIds.add(streamId);

      if (analysersRef.current.has(streamId)) continue;

      try {
        const source = ctx.createMediaStreamSource(peer.stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        // Don't connect to destination — we don't want to hear the analysis output
        analysersRef.current.set(streamId, { analyser, source });
      } catch (err) {
        console.error('[AutoDuck] Error creating analyser:', err);
      }
    }

    // Remove analysers for streams that are no longer active
    for (const [streamId, { source }] of analysersRef.current) {
      if (!activeStreamIds.has(streamId)) {
        source.disconnect();
        analysersRef.current.delete(streamId);
      }
    }

    // Start periodic analysis
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      let isSpeaking = false;

      for (const [, { analyser }] of analysersRef.current) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);

        // Compute average volume
        const avg = data.reduce((sum, val) => sum + val, 0) / data.length;
        if (avg > SPEECH_THRESHOLD) {
          isSpeaking = true;
          break;
        }
      }

      if (isSpeaking) {
        // Clear any pending restore
        if (restoreTimerRef.current) {
          clearTimeout(restoreTimerRef.current);
          restoreTimerRef.current = null;
        }
        // Duck if not already ducked
        if (!isDuckedRef.current) {
          isDuckedRef.current = true;
          setIsDucked(true);
          setPlayerVolume(DUCK_VOLUME);
        }
      } else if (isDuckedRef.current && !restoreTimerRef.current) {
        // Schedule volume restoration after 1.5s of silence
        restoreTimerRef.current = setTimeout(() => {
          isDuckedRef.current = false;
          setIsDucked(false);
          setPlayerVolume(playerVolumeRef.current);
          restoreTimerRef.current = null;
        }, RESTORE_DELAY_MS);
      }
    }, ANALYSIS_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [peerStreams, enabled, setPlayerVolume, playerVolumeRef]);

  const cleanupAnalysers = useCallback(() => {
    for (const [, { source }] of analysersRef.current) {
      source.disconnect();
    }
    analysersRef.current.clear();
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (restoreTimerRef.current) {
      clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupAnalysers();
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [cleanupAnalysers]);

  return { isDucked };
}
