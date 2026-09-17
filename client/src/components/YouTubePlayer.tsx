// ============================================================================
// YouTube Player — IFrame API integration with sync engine
// ============================================================================
// Loads the YouTube IFrame API ONCE globally (guarded against double-injection).
// Handles onError codes 101/150 (embedding disabled).
// All player API calls guarded with null/ready checks.
// Event handlers respect the echo suppression flag.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSyncEngine, PlayerAPI } from '../hooks/useSyncEngine';
import { useRoom } from '../context/RoomContext';
import { formatTime } from '../lib/formatTime';

// Global guard: only inject the IFrame API script once
let ytApiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).YT?.Player) {
    return Promise.resolve();
  }

  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve) => {
    if ((window as any).YT?.Player) {
      resolve();
      return;
    }

    const prevOnReady = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      if (typeof prevOnReady === 'function') {
        try {
          prevOnReady();
        } catch {}
      }
      resolve();
    };

    // If script tag already exists in DOM, wait/poll
    if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const interval = setInterval(() => {
        if ((window as any).YT?.Player) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    document.head.appendChild(script);
  });

  return ytApiPromise;
}

interface YouTubePlayerProps {
  videoId: string;
  onReady?: () => void;
}

export function YouTubePlayer({ videoId, onReady }: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const isReadyRef = useRef(false);
  const {
    registerPlayer,
    unregisterPlayer,
    isEchoSuppressed,
    getExpectedPosition,
    emitPlay,
    emitPause,
    emitSeek,
    reportBuffering,
    reportMediaEnded,
    beginRemoteUpdate,
  } = useSyncEngine();
  const { state, canControl } = useRoom();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Player volume & progress state
  const [volume, setVolume] = useState(100);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const timeUpdateInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize the YouTube player
  useEffect(() => {
    let destroyed = false;

    const init = async () => {
      try {
        await loadYouTubeApi();
        if (destroyed || !containerRef.current) return;

        // Create a separate child div for the player iframe.
        // We DO NOT mutate React-managed DOM children directly.
        containerRef.current.innerHTML = '';
        const playerDiv = document.createElement('div');
        playerDiv.className = 'w-full h-full';
        containerRef.current.appendChild(playerDiv);

        playerRef.current = new (window as any).YT.Player(playerDiv, {
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 0,       // Custom controls provided
            enablejsapi: 1,
            modestbranding: 1,
            rel: 0,
            fs: 0,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event: any) => {
              if (destroyed) return;
              isReadyRef.current = true;
              setIsLoading(false);
              try {
                setDuration(event.target.getDuration() || 0);
              } catch {}

              // Register with the sync engine
              const api: PlayerAPI = {
                play: () => {
                  try {
                    event.target.playVideo();
                  } catch {}
                },
                pause: () => {
                  try {
                    event.target.pauseVideo();
                  } catch {}
                },
                seekTo: (s: number) => {
                  try {
                    event.target.seekTo(s, true);
                  } catch {}
                },
                getCurrentTime: () => {
                  try {
                    return event.target.getCurrentTime() || 0;
                  } catch {
                    return 0;
                  }
                },
                setPlaybackRate: (r: number) => {
                  try {
                    event.target.setPlaybackRate(r);
                  } catch {}
                },
                getPlaybackRate: () => {
                  try {
                    return event.target.getPlaybackRate() || 1;
                  } catch {
                    return 1;
                  }
                },
                isReady: () => isReadyRef.current,
              };
              registerPlayer(api);

              // LATE JOINER: Seek to expected position
              const expectedPos = getExpectedPosition();
              if (expectedPos > 1) {
                beginRemoteUpdate();
                try {
                  event.target.seekTo(expectedPos, true);
                } catch {}
              }
              if (state.playback.isPlaying) {
                beginRemoteUpdate();
                try {
                  event.target.playVideo();
                } catch {}
              }

              onReady?.();
            },
            onStateChange: (event: any) => {
              if (destroyed) return;

              // ECHO SUPPRESSION: Ignore events triggered by remote sync
              if (isEchoSuppressed()) return;

              const YT = (window as any).YT.PlayerState;
              switch (event.data) {
                case YT.PLAYING:
                  if (canControl) emitPlay();
                  reportBuffering(false);
                  break;
                case YT.PAUSED:
                  if (canControl) emitPause();
                  break;
                case YT.BUFFERING:
                  reportBuffering(true);
                  break;
                case YT.ENDED:
                  reportMediaEnded();
                  break;
              }
            },
            onError: (event: any) => {
              const code = event.data;
              if (code === 101 || code === 150) {
                setError("This video cannot be embedded because the owner has disabled playback on other websites. Try another video.");
              } else if (code === 2) {
                setError('Invalid YouTube video link or ID. Please check the URL.');
              } else {
                setError(`YouTube player error (code ${code}). Try another video.`);
              }
              setIsLoading(false);
            },
          },
        });
      } catch (err) {
        console.error('[YouTubePlayer] Error initializing:', err);
        setError('Failed to load YouTube player. Please refresh and try again.');
        setIsLoading(false);
      }
    };

    init();

    return () => {
      destroyed = true;
      isReadyRef.current = false;
      unregisterPlayer();
      if (timeUpdateInterval.current) clearInterval(timeUpdateInterval.current);
      try {
        playerRef.current?.destroy();
      } catch {}
      playerRef.current = null;
    };
  }, [videoId]);

  // Periodic time update for progress bar
  useEffect(() => {
    timeUpdateInterval.current = setInterval(() => {
      if (playerRef.current && isReadyRef.current) {
        try {
          setCurrentTime(playerRef.current.getCurrentTime() || 0);
        } catch {}
      }
    }, 400);

    return () => {
      if (timeUpdateInterval.current) clearInterval(timeUpdateInterval.current);
    };
  }, []);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pos = parseFloat(e.target.value);
    setCurrentTime(pos);
    if (canControl) {
      emitSeek(pos);
    }
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseInt(e.target.value, 10);
    setVolume(vol);
    try {
      playerRef.current?.setVolume(vol);
      if (vol === 0) playerRef.current?.mute();
      else playerRef.current?.unMute();
    } catch {}
  };

  const togglePlay = () => {
    if (!canControl) return;
    if (state.playback.isPlaying) {
      emitPause();
    } else {
      emitPlay();
    }
  };

  if (error) {
    return (
      <div className="w-full aspect-video bg-surface-900 rounded-lg flex items-center justify-center border border-surface-800/40">
        <div className="text-center p-8 max-w-md">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-surface-200 text-sm font-medium mb-1">Playback Unavailable</p>
          <p className="text-surface-400 text-xs">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group w-full aspect-video bg-black rounded-lg overflow-hidden select-none">
      {/* Dedicated DOM container for YouTube iframe - NO React managed children inside */}
      <div className="youtube-container w-full h-full">
        <div ref={containerRef} className="w-full h-full" />
      </div>

      {/* Sibling loading spinner overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-950/90 z-20 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-surface-400 font-medium">Loading YouTube Video…</span>
          </div>
        </div>
      )}

      {/* Center Play button overlay when paused & loaded */}
      {!isLoading && !state.playback.isPlaying && (
        <div
          onClick={togglePlay}
          className={`absolute inset-0 flex items-center justify-center z-10 bg-black/40 backdrop-blur-[1px] transition-all duration-200 ${
            canControl ? 'cursor-pointer hover:bg-black/50' : 'cursor-default'
          }`}
          title={canControl ? 'Click to Play' : 'Waiting for host to play'}
        >
          <button
            type="button"
            disabled={!canControl}
            className="w-16 h-16 rounded-full bg-primary-600/90 hover:bg-primary-500 text-white flex items-center justify-center shadow-2xl shadow-primary-500/40 transform hover:scale-105 active:scale-95 transition-all disabled:opacity-60"
            aria-label="Play video"
          >
            <svg className="w-8 h-8 fill-current ml-1" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      )}

      {/* Custom responsive controls bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 py-3 z-30 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
        {/* Timeline slider */}
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          className="w-full h-1 appearance-none bg-surface-600/50 rounded-full cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 
                     [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full 
                     [&::-webkit-slider-thumb]:bg-primary-500"
          disabled={!canControl}
          aria-label="Video progress"
        />

        <div className="flex items-center justify-between mt-2">
          {/* Play/Pause + Time */}
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              disabled={!canControl}
              className="text-white hover:text-primary-400 disabled:opacity-50 transition-colors text-base"
              aria-label={state.playback.isPlaying ? 'Pause' : 'Play'}
            >
              {state.playback.isPlaying ? '⏸' : '▶️'}
            </button>
            <span className="text-xs text-surface-300 font-mono">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Volume control */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-surface-400">🔊</span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={handleVolume}
              className="w-20 h-1 appearance-none bg-surface-600/50 rounded-full cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 
                         [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full 
                         [&::-webkit-slider-thumb]:bg-white"
              aria-label="Volume"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
