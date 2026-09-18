// ============================================================================
// Floating Video Grid — Draggable Picture-in-Picture faces window
// ============================================================================
// Allows users to see everyone's faces anywhere on screen while chatting,
// browsing the queue, or watching media. Smooth mouse and touch dragging.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useWebRTCContext, PeerStream } from '../context/WebRTCContext';
import { useRoom } from '../context/RoomContext';
import { getInitials } from '../lib/colors';

export function FloatingVideoGrid() {
  const {
    inCall,
    localStream,
    peerStreams,
    isCameraOn,
    isMicOn,
    videoDevices,
    isFloating,
    setIsFloating,
    isMinimized,
    setIsMinimized,
    leaveCall,
    toggleCamera,
    toggleMic,
    switchCamera,
  } = useWebRTCContext();

  const { state } = useRoom();

  // Floating coordinates: default top-right corner under the navbar
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const width = typeof window !== 'undefined' ? window.innerWidth : 1200;
    return { x: Math.max(16, width - 360), y: 72 };
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; posX: number; posY: number }>({
    startX: 0,
    startY: 0,
    posX: 0,
    posY: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep within viewport boundaries on window resize
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => {
        const maxX = Math.max(0, window.innerWidth - 320);
        const maxY = Math.max(0, window.innerHeight - 200);
        return {
          x: Math.min(Math.max(10, prev.x), maxX),
          y: Math.min(Math.max(10, prev.y), maxY),
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
    // Only drag when clicking the header or drag handle, not buttons
    if ((e.target as HTMLElement).closest('button, select')) return;
    e.preventDefault();
    handleDragStart(e.clientX, e.clientY);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as HTMLElement).closest('button, select')) return;
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

      const maxX = Math.max(0, window.innerWidth - 180);
      const maxY = Math.max(0, window.innerHeight - 100);

      setPosition({
        x: Math.min(Math.max(10, newX), maxX),
        y: Math.min(Math.max(10, newY), maxY),
      });
    };

    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      const dx = touch.clientX - dragStartRef.current.startX;
      const dy = touch.clientY - dragStartRef.current.startY;
      const newX = dragStartRef.current.posX + dx;
      const newY = dragStartRef.current.posY + dy;

      const maxX = Math.max(0, window.innerWidth - 180);
      const maxY = Math.max(0, window.innerHeight - 100);

      setPosition({
        x: Math.min(Math.max(10, newX), maxX),
        y: Math.min(Math.max(10, newY), maxY),
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

  // If not in a call or user turned off floating, don't render floating window
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
        <div className="flex items-center gap-2 p-2 pr-3 bg-surface-900/95 backdrop-blur-md border border-primary-500/40 rounded-full shadow-2xl hover:border-primary-400 transition-all">
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center text-white font-bold text-sm shadow-md overflow-hidden">
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
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-accent-emerald border-2 border-surface-900 flex items-center justify-center" />
          </div>

          <div className="flex flex-col">
            <span className="text-xs font-semibold text-white leading-tight">
              Call ({totalFaces})
            </span>
            <span className="text-[10px] text-surface-400 leading-tight">
              {isMicOn ? '🎙️ Mic on' : '🔇 Muted'}
            </span>
          </div>

          <button
            onClick={() => setIsMinimized(false)}
            className="ml-1 p-1 rounded-full hover:bg-surface-800 text-surface-300 hover:text-white transition-colors"
            title="Expand video call window"
            aria-label="Expand video call window"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // Determine grid columns based on number of faces
  const gridColsClass =
    totalFaces <= 1
      ? 'grid-cols-1 w-64'
      : totalFaces <= 2
      ? 'grid-cols-2 w-80 sm:w-96'
      : 'grid-cols-2 sm:grid-cols-3 w-80 sm:w-[460px]';

  return (
    <div
      ref={containerRef}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
      className={`fixed z-50 select-none shadow-2xl rounded-2xl overflow-hidden bg-surface-950/90 border border-surface-700/60 backdrop-blur-xl transition-shadow ${
        isDragging ? 'cursor-grabbing shadow-primary-500/20' : 'cursor-default'
      }`}
    >
      {/* Draggable Title / Header bar */}
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className="flex items-center justify-between px-3.5 py-2.5 bg-surface-900/80 border-b border-surface-800/60 cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-2 pointer-events-none">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent-emerald animate-pulse" />
            <span className="text-xs font-bold text-white tracking-wide">Live Faces</span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-800 text-primary-300 font-mono font-medium">
            {totalFaces} {totalFaces === 1 ? 'person' : 'people'}
          </span>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-1">
          {/* Minimize button */}
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-800 transition-colors"
            title="Minimize to floating pill"
            aria-label="Minimize"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
            </svg>
          </button>

          {/* Close/Dock button */}
          <button
            onClick={() => setIsFloating(false)}
            className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-800 transition-colors"
            title="Dock to sidebar"
            aria-label="Dock"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Video Faces Grid */}
      <div className={`p-2.5 grid gap-2 max-h-[55vh] overflow-y-auto no-scrollbar ${gridColsClass}`}>
        {/* Local user tile */}
        {localStream && (
          <FaceTile
            key="local"
            stream={localStream}
            username={state.username || 'You'}
            isLocal
            isMuted={!isMicOn}
            isCameraOff={!isCameraOn}
            userColor={state.members.find((m) => m.id === state.mySocketId)?.color}
          />
        )}

        {/* Peer tiles */}
        {peerStreams.map((peer) => {
          const member = state.members.find((m) => m.id === peer.peerId);
          return (
            <FaceTile
              key={peer.peerId}
              stream={peer.stream}
              username={peer.username}
              isLocal={false}
              isMuted={member?.isMuted ?? false}
              isCameraOff={!member?.cameraOn}
              userColor={member?.color}
            />
          );
        })}
      </div>

      {/* Floating Control Bar */}
      <div className="px-3 py-2 bg-surface-900/90 border-t border-surface-800/60 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {/* Mic Toggle */}
          <button
            onClick={toggleMic}
            className={`p-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1 ${
              isMicOn
                ? 'bg-surface-800 text-white hover:bg-surface-700'
                : 'bg-accent-rose/20 text-accent-rose hover:bg-accent-rose/30 border border-accent-rose/30'
            }`}
            title={isMicOn ? 'Mute microphone' : 'Unmute microphone'}
            aria-label={isMicOn ? 'Mute microphone' : 'Unmute microphone'}
          >
            <span>{isMicOn ? '🎙️' : '🔇'}</span>
          </button>

          {/* Camera Toggle */}
          <button
            onClick={toggleCamera}
            className={`p-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1 ${
              isCameraOn
                ? 'bg-surface-800 text-white hover:bg-surface-700'
                : 'bg-accent-rose/20 text-accent-rose hover:bg-accent-rose/30 border border-accent-rose/30'
            }`}
            title={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
            aria-label={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
          >
            <span>{isCameraOn ? '📷' : '📷❌'}</span>
          </button>

          {/* Switch Camera if multiple devices */}
          {videoDevices.length > 1 && (
            <select
              onChange={(e) => switchCamera(e.target.value)}
              className="px-2 py-1.5 rounded-xl bg-surface-800 text-xs text-surface-200 border border-surface-700 focus:outline-none"
              title="Switch camera device"
            >
              {videoDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Cam ${d.deviceId.slice(0, 4)}`}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Leave Call */}
        <button
          onClick={leaveCall}
          className="px-2.5 py-1.5 rounded-xl bg-accent-rose/20 hover:bg-accent-rose/30 border border-accent-rose/30 text-accent-rose text-xs font-semibold transition-all flex items-center gap-1"
          title="Leave video call"
        >
          <span>📞</span>
          <span>Leave</span>
        </button>
      </div>
    </div>
  );
}

// Individual Face Tile with robust video stream attachment
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

  // Reliable stream assignment callback
  const attachVideo = useCallback(
    (videoEl: HTMLVideoElement | null) => {
      videoRef.current = videoEl;
      if (videoEl && stream) {
        videoEl.srcObject = stream;
        videoEl.play().catch((err) => {
          // Autoplay policy might pause unmuted media until user gesture
          console.warn('[FaceTile] Play rejected:', err);
        });
      }
    },
    [stream]
  );

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
  }, [stream]);

  const hasVideoTrack = stream && stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].enabled;
  const showVideo = hasVideoTrack && !isCameraOff;

  return (
    <div className="relative rounded-xl overflow-hidden bg-surface-900 border border-surface-800/80 aspect-video shadow-md flex items-center justify-center group">
      {/* Video element */}
      <video
        ref={attachVideo}
        autoPlay
        playsInline
        muted={isLocal} // Local user is muted so no audio feedback echo
        className={`w-full h-full object-cover transition-opacity duration-200 ${
          showVideo ? 'opacity-100' : 'opacity-0 absolute inset-0'
        } ${isLocal ? 'scale-x-[-1]' : ''}`}
      />

      {/* Fallback avatar when camera is off */}
      {!showVideo && (
        <div className="flex flex-col items-center justify-center p-2">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-inner mb-1 ring-2 ring-white/10"
            style={{ backgroundColor: userColor || '#6366f1' }}
          >
            {getInitials(username)}
          </div>
          <span className="text-[10px] text-surface-400 font-medium">
            {isCameraOff ? 'Camera off' : 'Connecting…'}
          </span>
        </div>
      )}

      {/* Bottom overlay with username and audio badge */}
      <div className="absolute bottom-0 inset-x-0 px-2 py-1 bg-gradient-to-t from-black/85 via-black/40 to-transparent flex items-center justify-between text-[11px] text-white pointer-events-none">
        <span className="truncate font-medium drop-shadow-sm max-w-[120px]">
          {username} {isLocal ? '(You)' : ''}
        </span>
        <div className="flex items-center gap-1">
          {isMuted && <span className="text-accent-rose text-[10px]" title="Microphone muted">🔇</span>}
        </div>
      </div>
    </div>
  );
}
