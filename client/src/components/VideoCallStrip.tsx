import React, { useRef, useEffect, useCallback } from 'react';
import { useWebRTCContext } from '../context/WebRTCContext';
import { useRoom } from '../context/RoomContext';
import { getInitials } from '../lib/colors';

export function VideoCallStrip({ isMobileCompact = false }: { isMobileCompact?: boolean }) {
  const {
    inCall,
    localStream,
    peerStreams,
    isCameraOn,
    isMicOn,
    videoDevices,
    isFloating,
    setIsFloating,
    joinCall,
    leaveCall,
    toggleCamera,
    toggleMic,
    switchCamera,
  } = useWebRTCContext();
  const { state } = useRoom();
  const [collapsed, setCollapsed] = React.useState(false);

  const callMemberCount = state.members.filter((m) => m.inCall).length;

  if (!inCall && callMemberCount === 0) {
    return (
      <div className="p-3 border-b border-surface-800/40 bg-surface-900/50 backdrop-blur">
        <div className="flex flex-col sm:flex-row items-center gap-2">
          <button
            onClick={() => joinCall(false)}
            className="w-full flex-1 py-2 sm:py-2.5 rounded-xl bg-accent-emerald/20 border border-accent-emerald/30 
                       text-accent-emerald text-xs sm:text-sm font-semibold hover:bg-accent-emerald/30 
                       active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 shadow-sm"
            aria-label="Join video call"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <span>Join with Camera</span>
          </button>
          <button
            onClick={() => joinCall(true)}
            className="w-full sm:w-auto px-3 py-2 sm:py-2.5 rounded-xl bg-surface-800/60 hover:bg-surface-700/80 
                       border border-surface-700/50 text-surface-300 hover:text-white text-xs font-medium 
                       active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
            aria-label="Join voice only"
            title="Join without camera"
          >
            <span>🎙️</span>
            <span>Voice Only</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-surface-800/40 bg-surface-900/50 backdrop-blur">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent-emerald animate-pulse" />
          <span className="text-xs font-semibold text-white">
            📹 Live Call
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-800 text-surface-400 font-mono">
            {callMemberCount} active
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {inCall && (
            <button
              onClick={() => setIsFloating(!isFloating)}
              className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                isFloating
                  ? 'bg-primary-500/20 text-primary-300 border border-primary-500/30'
                  : 'bg-surface-800 text-surface-400 hover:text-white'
              }`}
              title="Toggle floating draggable faces window"
            >
              <span>🪟</span>
              <span className="hidden sm:inline">{isFloating ? 'Floating On' : 'Float Window'}</span>
            </button>
          )}

          {!inCall && (
            <button
              onClick={() => joinCall(false)}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold text-accent-emerald 
                         bg-accent-emerald/10 hover:bg-accent-emerald/20 transition-colors"
            >
              Join
            </button>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded text-surface-400 hover:text-white transition-colors text-xs"
            aria-label={collapsed ? 'Expand call' : 'Collapse call'}
          >
            {collapsed ? '▼ Expand' : '▲ Collapse'}
          </button>
        </div>
      </div>

      {/* Video tiles (docked view) */}
      {!collapsed && (
        <div className="px-3 pb-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {/* Local video tile */}
            {inCall && localStream && (
              <VideoTile
                stream={localStream}
                username={state.username || 'You'}
                isLocal
                isMuted={true}
                isCameraOff={!isCameraOn}
                userColor={state.members.find((m) => m.id === state.mySocketId)?.color}
              />
            )}
            {/* Peer video tiles */}
            {peerStreams.map((peer) => {
              const member = state.members.find((m) => m.id === peer.peerId);
              return (
                <VideoTile
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

          {/* Call controls bar */}
          {inCall && (
            <div className="flex items-center justify-center gap-2 mt-2.5 pt-2 border-t border-surface-800/30">
              <button
                onClick={toggleCamera}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1
                  ${isCameraOn
                    ? 'bg-surface-800/80 text-white hover:bg-surface-700'
                    : 'bg-accent-rose/20 text-accent-rose hover:bg-accent-rose/30 border border-accent-rose/30'
                  }`}
                aria-label={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
                title={isCameraOn ? 'Turn off camera' : 'Turn on camera'}
              >
                <span>{isCameraOn ? '📷' : '📷❌'}</span>
                <span className="hidden sm:inline">{isCameraOn ? 'Cam On' : 'Cam Off'}</span>
              </button>
              <button
                onClick={toggleMic}
                className={`px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1
                  ${isMicOn
                    ? 'bg-surface-800/80 text-white hover:bg-surface-700'
                    : 'bg-accent-rose/20 text-accent-rose hover:bg-accent-rose/30 border border-accent-rose/30'
                  }`}
                aria-label={isMicOn ? 'Mute microphone' : 'Unmute microphone'}
                title={isMicOn ? 'Mute microphone' : 'Unmute microphone'}
              >
                <span>{isMicOn ? '🎙️' : '🔇'}</span>
                <span className="hidden sm:inline">{isMicOn ? 'Mute' : 'Unmuted'}</span>
              </button>
              {videoDevices.length > 1 && (
                <select
                  onChange={(e) => switchCamera(e.target.value)}
                  className="px-2 py-1 rounded-xl bg-surface-800/70 text-xs text-surface-300 
                             border border-surface-700/50 focus:outline-none"
                  aria-label="Select camera"
                >
                  {videoDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Cam ${device.deviceId.slice(0, 4)}`}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={leaveCall}
                className="px-3 py-1.5 rounded-xl bg-accent-rose/20 hover:bg-accent-rose/30 
                           border border-accent-rose/30 text-accent-rose text-xs font-semibold 
                           transition-all flex items-center gap-1"
                aria-label="Leave call"
                title="Leave call"
              >
                <span>📞</span>
                <span>Leave</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VideoTile({
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
  const [hasAutoplayBlocked, setHasAutoplayBlocked] = React.useState(false);
  const [, setTrackTick] = React.useState(0);

  const playVideo = useCallback(
    (videoEl: HTMLVideoElement) => {
      if (!stream) return;
      videoEl.srcObject = stream;
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn(`[VideoTile] Play rejected for ${username}, falling back to muted:`, err);
          setHasAutoplayBlocked(true);
          videoEl.muted = true;
          videoEl.play().catch(() => {});
        });
      }
    },
    [stream, username]
  );

  const attachVideo = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      if (el && stream) {
        playVideo(el);
      }
    },
    [stream, playVideo]
  );

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
  }, [stream, playVideo]);

  const hasLiveVideoTrack = Boolean(
    stream &&
      stream.getVideoTracks().length > 0 &&
      stream.getVideoTracks().some((t) => t.enabled && t.readyState === 'live')
  );

  const showVideo = isLocal ? !isCameraOff && hasLiveVideoTrack : hasLiveVideoTrack && !isCameraOff;

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
    <div className="relative rounded-xl overflow-hidden bg-surface-900 border border-surface-800/60 aspect-video shadow-md flex items-center justify-center">
      <video
        ref={attachVideo}
        autoPlay
        playsInline
        muted={isLocal}
        className={`w-full h-full object-cover transition-opacity ${
          showVideo ? 'opacity-100' : 'opacity-0 absolute inset-0'
        } ${isLocal ? 'scale-x-[-1]' : ''}`}
      />

      {!showVideo && (
        <div className="flex flex-col items-center justify-center p-2">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-inner mb-1"
            style={{ backgroundColor: userColor || '#5c7cfa' }}
          >
            {getInitials(username)}
          </div>
          <span className="text-[10px] text-surface-400 truncate max-w-[80px]">
            {isCameraOff ? 'Camera off' : 'Connecting…'}
          </span>
        </div>
      )}

      {!isLocal && hasAutoplayBlocked && (
        <button
          onClick={handleUnmuteClick}
          className="absolute top-1 right-1 px-1.5 py-0.5 rounded-full bg-black/80 hover:bg-black text-[9px] text-accent-amber border border-accent-amber/40 shadow flex items-center gap-0.5"
          title="Click to unmute"
        >
          <span>🔇</span>
        </button>
      )}

      <div className="absolute bottom-0 inset-x-0 px-2 py-0.5 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between text-[10px] text-white">
        <span className="truncate font-medium">
          {username} {isLocal ? '(you)' : ''}
        </span>
        {isMuted && <span className="text-accent-rose text-[9px]">🔇</span>}
      </div>
    </div>
  );
}
