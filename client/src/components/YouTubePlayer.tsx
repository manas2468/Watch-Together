// ============================================================================
// YouTube Player — IFrame API integration with sync engine
// ============================================================================
// Loads the YouTube IFrame API ONCE globally (guarded against double-injection).
// Handles onError codes 101/150 (embedding disabled).
// Guarded against unload pause emission and provides smooth seek/rewind/fast-forward.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSyncEngine, PlayerAPI } from '../hooks/useSyncEngine';
import { useRoom } from '../context/RoomContext';
import { useSocket } from '../context/SocketContext';
import { formatTime } from '../lib/formatTime';

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
  const isUnloadingRef = useRef(false);

  const {
    registerPlayer,
    unregisterPlayer,
    isEchoSuppressed,
    getExpectedPosition,
    emitPlay,
    emitPause,
    emitSeek,
    emitSeekRelative,
    reportBuffering,
    reportMediaEnded,
    beginRemoteUpdate,
  } = useSyncEngine();

  const { state, canControl } = useRoom();
  const { socket } = useSocket();

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Volume and time state
  const [volume, setVolume] = useState(100);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  const timeUpdateInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Block pause emission during page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      isUnloadingRef.current = true;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Initialize the YouTube player
  useEffect(() => {
    let destroyed = false;
    isUnloadingRef.current = false;

    const init = async () => {
      try {
        await loadYouTubeApi();
        if (destroyed || !containerRef.current) return;

        containerRef.current.innerHTML = '';
        const playerDiv = document.createElement('div');
        playerDiv.className = 'w-full h-full';
        containerRef.current.appendChild(playerDiv);

        playerRef.current = new (window as any).YT.Player(playerDiv, {
          videoId,
          playerVars: {
            autoplay: 0,
            controls: 0,
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
              if (destroyed || isUnloadingRef.current) return;
              if (isEchoSuppressed()) return;

              const YT = (window as any).YT.PlayerState;
              switch (event.data) {
                case YT.PLAYING:
                  if (canControl && !state.playback.isPlaying) emitPlay();
                  reportBuffering(false);
                  break;
                case YT.PAUSED:
                  // Only emit pause if not caused by page unloading or component teardown
                  if (canControl && !isUnloadingRef.current && !destroyed && state.playback.isPlaying) {
                    emitPause();
                  }
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
                setError(
                  'This video cannot be embedded because the owner has disabled playback on third-party sites. Try another video.'
                );
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
      isUnloadingRef.current = true;
      isReadyRef.current = false;
      unregisterPlayer();
      if (timeUpdateInterval.current) clearInterval(timeUpdateInterval.current);
      try {
        playerRef.current?.destroy();
      } catch {}
      playerRef.current = null;
    };
  }, [videoId]);

  // Periodic time update for progress bar — paused while user is scrubbing
  useEffect(() => {
    timeUpdateInterval.current = setInterval(() => {
      if (playerRef.current && isReadyRef.current && !isScrubbing) {
        try {
          setCurrentTime(playerRef.current.getCurrentTime() || 0);
        } catch {}
      }
    }, 300);

    return () => {
      if (timeUpdateInterval.current) clearInterval(timeUpdateInterval.current);
    };
  }, [isScrubbing]);

  const isScrubbingRef = useRef(false);
  const scrubTimeRef = useRef<number | null>(null);
  const [showControls, setShowControls] = useState(true);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetControlsTimeout = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (state.playback.isPlaying && !isScrubbingRef.current) {
      controlsTimeoutRef.current = setTimeout(() => {
        if (state.playback.isPlaying && !isScrubbingRef.current) {
          setShowControls(false);
        }
      }, 2500);
    }
  }, [state.playback.isPlaying]);

  useEffect(() => {
    if (!state.playback.isPlaying) {
      setShowControls(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    } else {
      resetControlsTimeout();
    }
  }, [state.playback.isPlaying, resetControlsTimeout]);

  // Handle scrubber drag & release
  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setScrubTime(val);
    scrubTimeRef.current = val;
    resetControlsTimeout();
  };

  const startScrub = () => {
    setIsScrubbing(true);
    isScrubbingRef.current = true;
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
  };

  const commitSeek = useCallback(() => {
    if (!isScrubbingRef.current) return;
    const target = scrubTimeRef.current;
    if (target !== null && canControl) {
      emitSeek(target);
      setCurrentTime(target);
    }
    setIsScrubbing(false);
    isScrubbingRef.current = false;
    setScrubTime(null);
    scrubTimeRef.current = null;
    resetControlsTimeout();
  }, [canControl, emitSeek, resetControlsTimeout]);

  // Window-level release so scrubbing NEVER gets stuck if released outside the slider
  useEffect(() => {
    const handleGlobalRelease = () => {
      if (isScrubbingRef.current) {
        commitSeek();
      }
    };
    window.addEventListener('mouseup', handleGlobalRelease);
    window.addEventListener('touchend', handleGlobalRelease);
    return () => {
      window.removeEventListener('mouseup', handleGlobalRelease);
      window.removeEventListener('touchend', handleGlobalRelease);
    };
  }, [commitSeek]);

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

  const handleSkipNext = () => {
    if (!socket || !state.roomId) return;
    socket.emit('media:next', { roomId: state.roomId });
  };

  const activeDisplayTime = isScrubbing && scrubTime !== null ? scrubTime : currentTime;

  if (error) {
    return (
      <div className="w-full aspect-video bg-surface-950 rounded-xl flex items-center justify-center border border-surface-800/60 shadow-inner">
        <div className="text-center p-8 max-w-md">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-surface-200 text-sm font-semibold mb-1">Playback Unavailable</p>
          <p className="text-surface-400 text-xs leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      onMouseMove={resetControlsTimeout}
      onTouchStart={resetControlsTimeout}
      onMouseLeave={() => {
        if (state.playback.isPlaying && !isScrubbingRef.current) {
          setShowControls(false);
        }
      }}
      className={`relative group w-full aspect-video bg-black rounded-xl overflow-hidden select-none shadow-2xl transition-all ${
        showControls ? 'cursor-default' : 'cursor-none'
      }`}
    >
      {/* Dedicated DOM container for YouTube iframe */}
      <div className="youtube-container w-full h-full">
        <div ref={containerRef} className="w-full h-full" />
      </div>

      {/* Loading Spinner */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-950/90 z-20 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-surface-400 font-medium">Loading YouTube Stream…</span>
          </div>
        </div>
      )}

      {/* Center Big Play overlay button when paused */}
      {!isLoading && !state.playback.isPlaying && (
        <div
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center z-10 bg-black/40 backdrop-blur-[2px] transition-all cursor-pointer hover:bg-black/50 group/play"
          title="Click to Play"
        >
          <button
            type="button"
            className="w-16 h-16 rounded-full bg-primary-600/90 hover:bg-primary-500 text-white flex items-center justify-center shadow-2xl shadow-primary-500/40 transform group-hover/play:scale-110 active:scale-95 transition-all"
            aria-label="Play video"
          >
            <svg className="w-8 h-8 fill-current ml-1" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      )}

      {/* Modern cinema controls overlay: smoothly fades out after 2.5s of inactivity */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-4 py-3 z-30 transition-opacity duration-300 ${
          showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Slider with smooth scrub preview */}
        <div className="relative flex items-center mb-2.5">
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={activeDisplayTime}
            onMouseDown={startScrub}
            onTouchStart={startScrub}
            onChange={handleScrubberChange}
            onMouseUp={commitSeek}
            onTouchEnd={commitSeek}
            className="w-full h-1.5 appearance-none bg-surface-700/60 rounded-full cursor-pointer transition-all
                       hover:h-2 focus:outline-none
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 
                       [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full 
                       [&::-webkit-slider-thumb]:bg-primary-500 [&::-webkit-slider-thumb]:shadow-lg
                       [&::-webkit-slider-thumb]:hover:scale-125 transition-transform"
            aria-label="Seek progress"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          {/* Play, Rewind, Fast-Forward, Next Controls */}
          <div className="flex items-center gap-2">
            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white hover:text-primary-400 transition-colors text-base"
              aria-label={state.playback.isPlaying ? 'Pause' : 'Play'}
              title={state.playback.isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {state.playback.isPlaying ? '⏸' : '▶️'}
            </button>

            {/* Rewind -10s */}
            <button
              onClick={() => emitSeekRelative(-10)}
              className="px-2 py-1 rounded-lg hover:bg-white/10 text-surface-300 hover:text-white transition-colors text-xs font-semibold flex items-center gap-1"
              title="Rewind 10 seconds (← 5s)"
            >
              <span>⏪</span>
              <span>-10s</span>
            </button>

            {/* Fast-Forward +10s */}
            <button
              onClick={() => emitSeekRelative(10)}
              className="px-2 py-1 rounded-lg hover:bg-white/10 text-surface-300 hover:text-white transition-colors text-xs font-semibold flex items-center gap-1"
              title="Forward 10 seconds (→ 5s)"
            >
              <span>+10s</span>
              <span>⏩</span>
            </button>

            {/* Next Video button if queue has items */}
            {state.queue.length > 0 && (
              <button
                onClick={handleSkipNext}
                className="p-1.5 rounded-lg hover:bg-white/10 text-surface-300 hover:text-white transition-colors text-xs flex items-center gap-1 font-medium"
                title="Skip to next video in queue"
              >
                <span>⏭ Next</span>
              </button>
            )}

            {/* Current Time / Duration */}
            <span className="text-xs text-surface-300 font-mono ml-2">
              {formatTime(activeDisplayTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Volume Control */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-surface-400">
              {volume === 0 ? '🔇' : volume < 50 ? '🔉' : '🔊'}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={handleVolume}
              className="w-20 sm:w-24 h-1 appearance-none bg-surface-700/60 rounded-full cursor-pointer
                         [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 
                         [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full 
                         [&::-webkit-slider-thumb]:bg-white hover:[&::-webkit-slider-thumb]:scale-110"
              aria-label="Volume"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
