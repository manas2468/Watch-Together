// ============================================================================
// Direct Player — HTML5 <video> element for mp4/webm/mp3/m3u8
// ============================================================================
// Detects CORS failures on load and shows a helpful error.
// Integrates with the sync engine just like the YouTube player.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSyncEngine, PlayerAPI } from '../hooks/useSyncEngine';
import { useRoom } from '../context/RoomContext';
import { formatTime } from '../lib/formatTime';

interface DirectPlayerProps {
  url: string;
  onReady?: () => void;
}

export function DirectPlayer({ url, onReady }: DirectPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
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
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  // Register player API when video element is ready
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let destroyed = false;

    const handleCanPlay = () => {
      if (destroyed) return;
      isReadyRef.current = true;
      setIsLoading(false);
      setDuration(video.duration || 0);

      const api: PlayerAPI = {
        play: () => video.play().catch(() => {}),
        pause: () => video.pause(),
        seekTo: (s: number) => { video.currentTime = s; },
        getCurrentTime: () => video.currentTime,
        setPlaybackRate: (r: number) => { video.playbackRate = r; },
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
      if (destroyed || isEchoSuppressed()) return;
      if (canControl) emitPlay();
    };

    const handlePause = () => {
      if (destroyed || isEchoSuppressed()) return;
      if (canControl && !video.ended) emitPause();
    };

    const handleSeeked = () => {
      // We don't emit seek here — only from user-initiated seeks via our UI
    };

    const handleTimeUpdate = () => {
      if (destroyed) return;
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

      // Detect CORS failure
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
  }, [url]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (canControl) {
      emitSeek(parseFloat(e.target.value));
    }
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (videoRef.current) videoRef.current.volume = vol;
  };

  if (error) {
    return (
      <div className="aspect-video bg-surface-900 rounded-lg flex items-center justify-center">
        <div className="text-center p-8 max-w-md">
          <div className="text-4xl mb-4">⚠️</div>
          <p className="text-surface-300 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative group">
      <div className="aspect-video bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          src={url}
          className="w-full h-full object-contain"
          playsInline
          crossOrigin="anonymous"
          preload="auto"
        />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-900/80">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent 
                              rounded-full animate-spin" />
              <span className="text-sm text-surface-400">Loading media…</span>
            </div>
          </div>
        )}
      </div>

      {/* Controls overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent 
                      px-4 py-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
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
          <div className="flex items-center gap-3">
            <button
              onClick={() => (state.playback.isPlaying ? emitPause() : emitPlay())}
              disabled={!canControl}
              className="text-white hover:text-primary-400 disabled:opacity-50 transition-colors"
              aria-label={state.playback.isPlaying ? 'Pause' : 'Play'}
            >
              {state.playback.isPlaying ? '⏸' : '▶️'}
            </button>
            <span className="text-xs text-surface-300 font-mono">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-surface-400">🔊</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
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
