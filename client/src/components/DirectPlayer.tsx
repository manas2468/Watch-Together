// ============================================================================
// Direct Player — HTML5 <video> element for mp4/webm/mp3/m3u8
// ============================================================================
// Detects CORS failures on load and shows a helpful error.
// Integrates with the sync engine just like the YouTube player.
// Guarded against browser unmount/unload pause event broadcasts.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSyncEngine, PlayerAPI } from '../hooks/useSyncEngine';
import { useRoom } from '../context/RoomContext';
import { useSocket } from '../context/SocketContext';
import { formatTime } from '../lib/formatTime';

interface DirectPlayerProps {
  url: string;
  onReady?: () => void;
}

export function DirectPlayer({ url, onReady }: DirectPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
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
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  // Prevent unload pause emissions
  useEffect(() => {
    const handleBeforeUnload = () => {
      isUnloadingRef.current = true;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Register player API when video element is ready
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let destroyed = false;
    isUnloadingRef.current = false;

    const handleCanPlay = () => {
      if (destroyed) return;
      isReadyRef.current = true;
      setIsLoading(false);
      setDuration(video.duration || 0);

      const api: PlayerAPI = {
        play: () => video.play().catch(() => {}),
        pause: () => video.pause(),
        seekTo: (s: number) => {
          video.currentTime = s;
        },
        getCurrentTime: () => video.currentTime,
        setPlaybackRate: (r: number) => {
          video.playbackRate = r;
        },
        getPlaybackRate: () => video.playbackRate,
        isReady: () => isReadyRef.current && !video.error,
      };
      registerPlayer(api);

      // LATE JOINER: Seek to expected position
      const expectedPos = getExpectedPosition();
      if (expectedPos > 1) {
        beginRemoteUpdate();
        video.currentTime = expectedPos;
      }
      if (state.playback.isPlaying) {
        beginRemoteUpdate();
        video.play().catch(() => {});
      }

      onReady?.();
    };

    const handlePlay = () => {
      if (destroyed || isUnloadingRef.current || isEchoSuppressed()) return;
      if (canControl && !state.playback.isPlaying) emitPlay();
    };

    const handlePause = () => {
      if (destroyed || isUnloadingRef.current || isEchoSuppressed()) return;
      if (canControl && !video.ended && state.playback.isPlaying) emitPause();
    };

    const handleSeeked = () => {
      // User-initiated seeks handled via UI commit
    };

    const handleTimeUpdate = () => {
      if (destroyed || isScrubbing) return;
      setCurrentTime(video.currentTime);
    };

    const handleWaiting = () => {
      if (destroyed) return;
      reportBuffering(true);
    };

    const handlePlaying = () => {
      if (destroyed) return;
      reportBuffering(false);
    };

    const handleEnded = () => {
      if (destroyed) return;
      reportMediaEnded();
    };

    const handleError = () => {
      if (destroyed) return;
      setIsLoading(false);

      if (video.error) {
        const code = video.error.code;
        if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
          setError(
            'Cannot play this media. The server may not support CORS, or the file format is unsupported. ' +
            'Try uploading the file directly instead.'
          );
        } else if (code === MediaError.MEDIA_ERR_NETWORK) {
          setError('Network error loading media. Check your connection and the URL.');
        } else {
          setError('Error loading media. The file may be corrupted or in an unsupported format.');
        }
      }
    };

    const handleDurationChange = () => {
      if (destroyed) return;
      setDuration(video.duration || 0);
    };

    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('waiting', handleWaiting);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('ended', handleEnded);
    video.addEventListener('error', handleError);
    video.addEventListener('durationchange', handleDurationChange);

    return () => {
      destroyed = true;
      isUnloadingRef.current = true;
      isReadyRef.current = false;
      unregisterPlayer();
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('waiting', handleWaiting);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      video.removeEventListener('durationchange', handleDurationChange);
    };
  }, [url, isScrubbing]);

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
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (videoRef.current) videoRef.current.volume = vol;
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
      <div className="aspect-video bg-surface-950 rounded-xl flex items-center justify-center border border-surface-800/60 shadow-inner">
        <div className="text-center p-8 max-w-md">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-surface-200 text-sm font-semibold mb-1">Playback Error</p>
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
      className={`relative group aspect-video bg-black rounded-xl overflow-hidden select-none shadow-2xl transition-all ${
        showControls ? 'cursor-default' : 'cursor-none'
      }`}
    >
      <video
        ref={videoRef}
        src={url}
        className="w-full h-full object-contain"
        playsInline
        crossOrigin="anonymous"
        preload="auto"
      />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-950/90 z-20 pointer-events-none">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-surface-400 font-medium">Loading video…</span>
          </div>
        </div>
      )}

      {/* Big center play button when paused */}
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

      {/* Controls overlay: smoothly fades out after 2.5s of inactivity */}
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
            aria-label="Video progress"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          {/* Controls buttons */}
          <div className="flex items-center gap-2">
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

            <span className="text-xs text-surface-300 font-mono ml-2">
              {formatTime(activeDisplayTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-surface-400">
              {volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
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
