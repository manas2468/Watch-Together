// ============================================================================
// Floating Video Grid — Compact 9:16 Floating Face Cams
// ============================================================================
// Small, compact floating portrait (9:16) face cams with NO surrounding frame.
// Freely draggable anywhere on screen. Minimal hover controls only.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useWebRTCContext } from '../context/WebRTCContext';
import { useRoom } from '../context/RoomContext';
import { getInitials } from '../lib/colors';

type CamSize = 'sm' | 'md' | 'lg';

const SIZE_CONFIGS: Record<CamSize, { widthClass: string; label: string }> = {
  sm: { widthClass: 'w-24 sm:w-28', label: 'Small' },   // ~96px-112px wide, ~170px-200px tall
  md: { widthClass: 'w-28 sm:w-32', label: 'Normal' },  // ~112px-128px wide, ~200px-228px tall
  lg: { widthClass: 'w-32 sm:w-36', label: 'Large' },   // ~128px-144px wide, ~228px-256px tall
};

export function FloatingVideoGrid() {
  const {
    inCall,
    localStream,
    peerStreams,
    isCameraOn,
    isMicOn,
    isFloating,
    setIsFloating,
    isMinimized,
    setIsMinimized,
    leaveCall,
    toggleCamera,
    toggleMic,
  } = useWebRTCContext();

  const { state } = useRoom();

  // Floating coordinates: default top-right corner under the navbar
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const width = typeof window !== 'undefined' ? window.innerWidth : 1200;
    return { x: Math.max(16, width - 180), y: 76 };
  });

  // Adjustable camera size (default md = normal compact 9:16)
  const [camSize, setCamSize] = useState<CamSize>('md');
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0,
    startY: 0,
    posX: 0,
    posY: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep within viewport boundaries on resize
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        const maxX = Math.max(0, window.innerWidth - 120);
        const maxY = Math.max(0, window.innerHeight - 100);
        return {
          x: Math.min(Math.max(8, prev.x), maxX),
          y: Math.min(Math.max(8, prev.y), maxY),
        };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Mouse / Touch drag handlers
  const handleDragStart = useCallback(
    (clientX: number, clientY: number) => {
      setIsDragging(true);
      dragStartRef.current = {
        startX: clientX,
        startY: clientY,
        posX: position.x,
        posY: position.y,
      };
    },
    [position]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    e.preventDefault();
    handleDragStart(e.clientX, e.clientY);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button, select, input')) return;
    const touch = e.touches[0];
    handleDragStart(touch.clientX, touch.clientY);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.startX;
      const dy = e.clientY - dragStartRef.current.startY;
      const newX = dragStartRef.current.posX + dx;
      const newY = dragStartRef.current.posY + dy;

      const maxX = Math.max(0, window.innerWidth - 80);
      const maxY = Math.max(0, window.innerHeight - 80);

      setPosition({
        x: Math.min(Math.max(8, newX), maxX),
        y: Math.min(Math.max(8, newY), maxY),
      });
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const dx = touch.clientX - dragStartRef.current.startX;
      const dy = touch.clientY - dragStartRef.current.startY;
      const newX = dragStartRef.current.posX + dx;
      const newY = dragStartRef.current.posY + dy;

      const maxX = Math.max(0, window.innerWidth - 80);
      const maxY = Math.max(0, window.innerHeight - 80);

      setPosition({
        x: Math.min(Math.max(8, newX), maxX),
        y: Math.min(Math.max(8, newY), maxY),
      });
    };

    const handleEnd = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isDragging]);

  const cycleSize = () => {
    setCamSize((prev) => (prev === 'sm' ? 'md' : prev === 'md' ? 'lg' : 'sm'));
  };

  if (!inCall || !isFloating) return null;

  const totalFaces = (localStream ? 1 : 0) + peerStreams.length;

  // Minimized floating avatar bubble
  if (isMinimized) {
    return (
      <div
        ref={containerRef}
        style={{ left: `${position.x}px`, top: `${position.y}px` }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className="fixed z-50 select-none cursor-grab active:cursor-grabbing group"
      >
        <div className="flex items-center gap-1.5 p-1 pr-2.5 bg-surface-950/90 backdrop-blur-md border border-white/10 rounded-full shadow-2xl hover:border-primary-400/50 transition-all">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white font-bold text-xs shadow-md overflow-hidden">
              {localStream && isCameraOn ? (
                <video
                  ref={(v) => {
                    if (v && localStream) v.srcObject = localStream;
                  }}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover scale-x-[-1]"
                />
              ) : (
                <span>📹</span>
              )}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent-emerald border-2 border-surface-950" />
          </div>

          <span className="text-[11px] font-semibold text-white">
            {totalFaces}
          </span>

          <button
            onClick={() => setIsMinimized(false)}
            className="ml-0.5 p-1 rounded-full hover:bg-white/10 text-surface-400 hover:text-white transition-colors"
            title="Expand floating face cam"
            aria-label="Expand floating face cam"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  const { widthClass } = SIZE_CONFIGS[camSize];

  return (
    <div
      ref={containerRef}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      className={`fixed z-50 select-none group transition-shadow ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
    >
      {/* Sleek, Non-Intrusive Floating Control Pill (Visible on hover or tap) */}
      <div className="absolute -top-8 left-0 right-0 flex items-center justify-between px-1.5 py-0.5 bg-surface-950/90 backdrop-blur-md border border-white/10 rounded-lg shadow-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 pointer-events-auto">
        {/* Drag handle */}
        <div className="flex items-center gap-1 text-surface-400 cursor-grab active:cursor-grabbing text-xs">
          <span className="text-[10px] text-surface-500">⠿</span>
        </div>

        {/* Quick controls */}
        <div className="flex items-center gap-0.5">
          {/* Size toggle */}
          <button
            onClick={cycleSize}
            className="px-1 rounded text-[9px] font-mono bg-white/10 hover:bg-white/20 text-surface-300 hover:text-white transition-colors"
            title={`Size: ${SIZE_CONFIGS[camSize].label} (click to cycle)`}
          >
            {camSize.toUpperCase()}
          </button>

          {/* Mic */}
          <button
            onClick={toggleMic}
            className={`p-1 rounded text-[11px] transition-colors ${
              isMicOn ? 'text-surface-300 hover:text-white' : 'text-accent-rose'
            }`}
            title={isMicOn ? 'Mute Mic' : 'Unmute Mic'}
          >
            {isMicOn ? '🎙️' : '🔇'}
          </button>

          {/* Camera */}
          <button
            onClick={toggleCamera}
            className={`p-1 rounded text-[11px] transition-colors ${
              isCameraOn ? 'text-surface-300 hover:text-white' : 'text-accent-rose'
            }`}
            title={isCameraOn ? 'Turn Off Cam' : 'Turn On Cam'}
          >
            {isCameraOn ? '📷' : '🚫'}
          </button>

          {/* Minimize */}
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1 rounded text-surface-400 hover:text-white transition-colors text-[10px]"
            title="Minimize"
          >
            —
          </button>

          {/* Close floating */}
          <button
            onClick={() => setIsFloating(false)}
            className="p-1 rounded text-surface-400 hover:text-white transition-colors text-[10px]"
            title="Dock to sidebar"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Pure 9:16 Portrait Floating Face Cams */}
      <div className="flex flex-row gap-1.5 items-start">
        {/* Local user camera tile (9:16 portrait) */}
        {localStream && (
          <div className={`${widthClass} aspect-[9/16] flex-shrink-0`}>
            <FaceTile
              key="local"
              stream={localStream}
              username={state.username || 'You'}
              isLocal
              isMuted={!isMicOn}
              isCameraOff={!isCameraOn}
              userColor={state.members.find((m) => m.id === state.mySocketId)?.color}
            />
          </div>
        )}

        {/* Peer camera tiles (9:16 portrait) */}
        {peerStreams.map((peer) => {
          const member = state.members.find((m) => m.id === peer.peerId);
          return (
            <div key={peer.peerId} className={`${widthClass} aspect-[9/16] flex-shrink-0`}>
              <FaceTile
                stream={peer.stream}
                username={peer.username}
                isLocal={false}
                isMuted={member?.isMuted ?? false}
                isCameraOff={member ? member.cameraOn === false : false}
                userColor={member?.color}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Individual 9:16 Portrait Face Cam Tile with robust WebRTC stream playback
function FaceTile({
  stream,
  username,
  isLocal,
  isMuted,
  isCameraOff,
  userColor,
}: {
  stream: MediaStream | null;
  username: string;
  isLocal: boolean;
  isMuted: boolean;
  isCameraOff: boolean;
  userColor?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hasAutoplayBlocked, setHasAutoplayBlocked] = useState(false);
  const [, setTrackTick] = useState(0);

  // Play video with automatic fallback to muted if browser blocks unmuted autoplay
  const playVideo = useCallback(
    (videoEl: HTMLVideoElement) => {
      if (!stream) return;
      videoEl.srcObject = stream;
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn(`[FaceTile] Play rejected for ${username}, falling back to muted:`, err);
          if (!isLocal) {
            setHasAutoplayBlocked(true);
            videoEl.muted = true;
            videoEl.play().catch(() => {});
          }
        });
      }
    },
    [stream, username, isLocal]
  );

  const attachVideo = useCallback(
    (videoEl: HTMLVideoElement | null) => {
      videoRef.current = videoEl;
      if (videoEl && stream) {
        playVideo(videoEl);
      }
    },
    [stream, playVideo]
  );

  // Listen to tracks being added, removed, or unmuted (RTP packets starting)
  useEffect(() => {
    const videoEl = videoRef.current;
    if (videoEl && stream) {
      playVideo(videoEl);
    }

    if (!stream) return;

    const handleTrackChange = () => {
      setTrackTick((t) => t + 1);
      if (videoRef.current && stream) {
        playVideo(videoRef.current);
      }
    };

    stream.addEventListener('addtrack', handleTrackChange);
    stream.addEventListener('removetrack', handleTrackChange);
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener('unmute', handleTrackChange);
    });

    return () => {
      stream.removeEventListener('addtrack', handleTrackChange);
      stream.removeEventListener('removetrack', handleTrackChange);
      stream.getVideoTracks().forEach((track) => {
        track.removeEventListener('unmute', handleTrackChange);
      });
    };
  }, [stream, playVideo, isCameraOff]);

  // Determine if stream has video tracks
  const hasVideoTracks = Boolean(
    stream &&
      stream.getVideoTracks().length > 0 &&
      stream.getVideoTracks().some((t) => t.enabled)
  );

  // For local user: show video if local camera is toggled on and video track exists
  // For remote peer: show video if video track exists and not explicitly turned off
  const showVideo = isLocal
    ? !isCameraOff && hasVideoTracks
    : hasVideoTracks && !isCameraOff;

  // Allow clicking on muted peer video to unmute audio if autoplay blocked
  const handleUnmuteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current && !isLocal) {
      videoRef.current.muted = false;
      videoRef.current.play().then(() => {
        setHasAutoplayBlocked(false);
      }).catch(() => {});
    }
  };

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden bg-surface-900 border border-white/10 shadow-2xl flex items-center justify-center group/tile transition-transform hover:scale-[1.02]">
      {/* 9:16 Portrait Video Element */}
      <video
        ref={attachVideo}
        autoPlay
        playsInline
        muted={isLocal} // Local user is always muted to prevent acoustic feedback
        className={`w-full h-full object-cover transition-opacity duration-200 ${
          showVideo ? 'opacity-100' : 'opacity-0 absolute inset-0'
        } ${isLocal ? 'scale-x-[-1]' : ''}`}
      />

      {/* Fallback avatar when camera is off or starting */}
      {!showVideo && (
        <div className="flex flex-col items-center justify-center p-2 text-center select-none">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-lg mb-1 ring-2 ring-white/15"
            style={{ backgroundColor: userColor || '#6366f1' }}
          >
            {getInitials(username)}
          </div>
          <span className="text-[9px] text-surface-400 font-medium">
            {isLocal
              ? isCameraOff
                ? 'Camera off'
                : 'Starting…'
              : isCameraOff
              ? 'Camera off'
              : 'Connecting…'}
          </span>
        </div>
      )}

      {/* Subtle Unmute Audio Pill if Autoplay was blocked */}
      {!isLocal && hasAutoplayBlocked && (
        <button
          onClick={handleUnmuteClick}
          className="absolute top-1 right-1 px-1.5 py-0.5 rounded-full bg-black/80 hover:bg-black text-[9px] text-accent-amber border border-accent-amber/40 shadow-lg flex items-center gap-0.5 transition-all animate-pulse"
          title="Click to hear peer audio"
        >
          <span>🔇</span>
        </button>
      )}

      {/* Minimal Bottom Username Tag */}
      <div className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 bg-gradient-to-t from-black/85 via-black/40 to-transparent flex items-center justify-between text-[10px] text-white pointer-events-none">
        <span className="truncate font-semibold drop-shadow-sm max-w-[80px]">
          {username} {isLocal ? '(You)' : ''}
        </span>
        {isMuted && <span className="text-accent-rose text-[9px] drop-shadow">🔇</span>}
      </div>
    </div>
  );
}
