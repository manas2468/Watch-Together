import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRoom } from '../context/RoomContext';
import { useSocket } from '../context/SocketContext';
import { useWebRTCContext } from '../context/WebRTCContext';
import { RoomHeader } from './RoomHeader';
import { Player } from './Player';
import { ChatPanel } from './ChatPanel';
import { MemberList } from './MemberList';
import { QueuePanel } from './QueuePanel';
import { VideoCallStrip } from './VideoCallStrip';
import { FloatingVideoGrid } from './FloatingVideoGrid';
import { Reactions } from './Reactions';
import { ShareDialog } from './ShareDialog';
import { UsernameModal } from './UsernameModal';

type TabType = 'chat' | 'queue' | 'call' | 'members';

const QUICK_REACTIONS = ['❤️', '🔥', '😂', '👏', '🎉', '🍿'];

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { state, joinRoom, sendReaction, canControl } = useRoom();
  const { socket, isConnected } = useSocket();
  const { inCall, isFloating, setIsFloating, joinCall } = useWebRTCContext();

  const [activeTab, setActiveTab] = useState<TabType>('chat');
  const [showShare, setShowShare] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);
  const [joining, setJoining] = useState(false);
  const videoContainerRef = useRef<HTMLDivElement>(null);

  const storedUsername = localStorage.getItem('wt-username');

  // Handle joining room on page mount / url change
  useEffect(() => {
    if (!roomId) {
      navigate('/', { replace: true });
      return;
    }

    if (state.roomId === roomId.toUpperCase()) {
      return;
    }

    if (!isConnected) return;

    if (storedUsername) {
      setJoining(true);
      joinRoom(roomId.toUpperCase(), storedUsername).then((room) => {
        setJoining(false);
        if (!room) {
          navigate('/', { replace: true });
        }
      });
    } else {
      setShowUsernameModal(true);
    }
  }, [roomId, isConnected, state.roomId, storedUsername, joinRoom, navigate]);

  // Handle user kicked or room closed
  useEffect(() => {
    if (state.roomId && !roomId) {
      navigate('/', { replace: true });
    }
  }, [state.roomId, roomId, navigate]);

  const handleUsernameSubmit = async (username: string) => {
    if (!roomId) return;
    setJoining(true);
    const room = await joinRoom(roomId.toUpperCase(), username);
    setJoining(false);
    setShowUsernameModal(false);
    if (!room) {
      navigate('/', { replace: true });
    }
  };

  // Compute live playback position from synchronized clock
  const getCurrentLivePos = useCallback(() => {
    if (!state.playback.isPlaying) return state.playback.positionSec;
    const elapsed = (Date.now() - state.playback.lastUpdatedAt) / 1000;
    return state.playback.positionSec + elapsed;
  }, [state.playback]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      // Space: Toggle play/pause
      if (e.code === 'Space') {
        e.preventDefault();
        if (canControl && socket && state.roomId && state.currentItem) {
          if (state.playback.isPlaying) {
            socket.emit('playback:pause', { roomId: state.roomId });
          } else {
            socket.emit('playback:play', { roomId: state.roomId });
          }
        }
      }

      // Seek -5s from CURRENT LIVE POSITION
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (canControl && socket && state.roomId && state.currentItem) {
          const currentPos = getCurrentLivePos();
          const newPos = Math.max(0, currentPos - 5);
          socket.emit('playback:seek', {
            roomId: state.roomId,
            positionSec: newPos,
          });
        }
      }

      // Seek +5s from CURRENT LIVE POSITION
      if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (canControl && socket && state.roomId && state.currentItem) {
          const currentPos = getCurrentLivePos();
          const newPos = currentPos + 5;
          socket.emit('playback:seek', {
            roomId: state.roomId,
            positionSec: newPos,
          });
        }
      }

      // 'F' -> Fullscreen
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        if (videoContainerRef.current) {
          if (!document.fullscreenElement) {
            videoContainerRef.current.requestFullscreen().catch(() => {});
          } else {
            document.exitFullscreen().catch(() => {});
          }
        }
      }

      // 'T' -> Theater Mode toggle
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault();
        setTheaterMode((prev) => !prev);
      }

      // Numbers 1-6 -> Quick emoji reactions
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= QUICK_REACTIONS.length) {
        e.preventDefault();
        sendReaction(QUICK_REACTIONS[num - 1]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canControl, socket, state.roomId, state.currentItem, getCurrentLivePos, sendReaction]);

  if (joining) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-surface-950 text-white">
        <div className="w-12 h-12 border-4 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mb-4" />
        <h2 className="text-xl font-semibold">Entering Watch Room...</h2>
        <p className="text-surface-400 text-sm mt-1 font-mono">{roomId?.toUpperCase()}</p>
      </div>
    );
  }

  const callCount = state.members.filter((m) => m.inCall).length;

  return (
    <div className="h-[100dvh] w-screen flex flex-col bg-surface-950 text-white overflow-hidden select-none">
      {/* Top Navigation Header */}
      <RoomHeader />

      {/* Main Content Layout */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Left / Top Area: Video Player & Action Bar */}
        <div className="flex flex-col lg:flex-1 min-w-0 bg-surface-950 flex-shrink-0 lg:flex-shrink lg:overflow-y-auto">
          {/* Video Container */}
          <div
            ref={videoContainerRef}
            className={`relative flex items-center justify-center bg-black overflow-hidden flex-shrink-0 transition-all ${
              theaterMode
                ? 'w-full max-h-[85vh] aspect-video mx-auto shadow-2xl'
                : 'w-full aspect-video max-h-[45vh] lg:max-h-none'
            }`}
          >
            <Player />
            <Reactions />
          </div>

          {/* Quick Reaction & Player Utility Bar */}
          <div className="px-3 py-2 sm:px-4 sm:py-2.5 flex items-center justify-between border-b border-surface-800/60 bg-surface-900/80 backdrop-blur flex-shrink-0">
            {/* Quick emoji reactions */}
            <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar py-0.5">
              <span className="text-xs text-surface-400 font-medium hidden sm:inline mr-1">React:</span>
              {QUICK_REACTIONS.map((emoji, idx) => (
                <button
                  key={emoji}
                  onClick={() => sendReaction(emoji)}
                  className="px-2 py-1 sm:px-2.5 sm:py-1 rounded-xl bg-surface-800/60 hover:bg-surface-700/90 active:scale-90 transition-all text-sm sm:text-base flex-shrink-0 border border-surface-700/40"
                  title={`Send ${emoji} (Key: ${idx + 1})`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Utility buttons */}
            <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              {/* Floating Faces Toggle */}
              {inCall ? (
                <button
                  onClick={() => setIsFloating(!isFloating)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 border ${
                    isFloating
                      ? 'bg-primary-500/20 text-primary-300 border-primary-500/40 shadow-sm'
                      : 'bg-surface-800/80 text-surface-300 hover:text-white border-surface-700/50'
                  }`}
                  title="Toggle floating draggable faces window"
                >
                  <span>🪟</span>
                  <span className="hidden sm:inline font-semibold">Floating Faces</span>
                </button>
              ) : (
                <button
                  onClick={() => joinCall(false)}
                  className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-accent-emerald bg-accent-emerald/15 hover:bg-accent-emerald/25 border border-accent-emerald/30 transition-all flex items-center gap-1"
                  title="Join camera call"
                >
                  <span>📹</span>
                  <span className="hidden sm:inline">Join Call</span>
                </button>
              )}

              <button
                onClick={() => setTheaterMode((prev) => !prev)}
                className={`p-1.5 rounded-xl text-xs transition-colors hidden sm:block border ${
                  theaterMode
                    ? 'bg-primary-600/20 text-primary-400 border-primary-500/40'
                    : 'text-surface-400 hover:text-white hover:bg-surface-800/60 border-surface-700/40'
                }`}
                title="Theater mode (T)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              </button>

              <button
                onClick={() => {
                  if (videoContainerRef.current) {
                    if (!document.fullscreenElement) {
                      videoContainerRef.current.requestFullscreen().catch(() => {});
                    } else {
                      document.exitFullscreen().catch(() => {});
                    }
                  }
                }}
                className="p-1.5 rounded-xl text-surface-400 hover:text-white hover:bg-surface-800/60 border border-surface-700/40 transition-colors text-xs"
                title="Fullscreen (F)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              </button>

              <button
                onClick={() => setShowShare(true)}
                className="p-1.5 rounded-xl text-surface-400 hover:text-white hover:bg-surface-800/60 border border-surface-700/40 transition-colors text-xs"
                title="Share Room"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Under-Player Stream Info Card */}
          <div className="hidden lg:block p-4 space-y-3">
            {state.currentItem && (
              <div className="bg-surface-900/60 rounded-2xl p-4 border border-surface-800/60 flex flex-row items-center justify-between gap-3 shadow-md">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-white truncate">
                    {state.currentItem.title || 'Untitled Stream'}
                  </h2>
                  <p className="text-xs text-surface-400 mt-0.5">
                    Added by <span className="text-primary-400 font-medium">{state.currentItem.addedBy}</span> • Type: {state.currentItem.type.toUpperCase()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-primary-500/20 text-primary-300 border border-primary-500/30">
                    🎮 Everyone Can Control
                  </span>
                </div>
              </div>
            )}

            {/* Keyboard shortcut hints */}
            <div className="rounded-2xl bg-surface-900/40 border border-surface-800/40 p-3 flex flex-wrap items-center justify-between gap-2 text-xs text-surface-400">
              <div className="flex items-center gap-3 flex-wrap">
                <span>⚡ Shortcuts:</span>
                <span className="font-mono bg-surface-800 px-2 py-0.5 rounded text-surface-200">Space</span> Play/Pause
                <span className="font-mono bg-surface-800 px-2 py-0.5 rounded text-surface-200">← / →</span> Seek 5s
                <span className="font-mono bg-surface-800 px-2 py-0.5 rounded text-surface-200">F</span> Fullscreen
                <span className="font-mono bg-surface-800 px-2 py-0.5 rounded text-surface-200">1-6</span> Reactions
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar (Tabs: Chat, Queue, Call, Members) */}
        <div className="flex-1 lg:flex-initial lg:w-80 xl:w-96 flex flex-col border-t lg:border-t-0 lg:border-l border-surface-800/60 bg-surface-900/60 backdrop-blur overflow-hidden min-h-0">
          {/* Integrated WebRTC Video Call Strip at top of sidebar (desktop only) */}
          <div className="hidden lg:block">
            <VideoCallStrip />
          </div>

          {/* Navigation Tabs Header */}
          <div className="flex items-center border-b border-surface-800/60 px-2 pt-1.5 bg-surface-900/90 flex-shrink-0">
            {/* Chat Tab */}
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-all relative flex items-center justify-center gap-1.5 ${
                activeTab === 'chat'
                  ? 'border-primary-500 text-primary-400 font-bold'
                  : 'border-transparent text-surface-400 hover:text-surface-200'
              }`}
            >
              <span>💬</span>
              <span>Chat</span>
              {state.messages.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-surface-800 text-surface-300 font-mono">
                  {state.messages.length}
                </span>
              )}
            </button>

            {/* Queue & Search Tab */}
            <button
              onClick={() => setActiveTab('queue')}
              className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-all relative flex items-center justify-center gap-1.5 ${
                activeTab === 'queue'
                  ? 'border-primary-500 text-primary-400 font-bold'
                  : 'border-transparent text-surface-400 hover:text-surface-200'
              }`}
            >
              <span>🔍</span>
              <span>Queue</span>
              {state.queue.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-primary-500/20 text-primary-300 font-bold font-mono">
                  {state.queue.length}
                </span>
              )}
            </button>

            {/* Mobile Call Tab (Visible on mobile/tablet) */}
            <button
              onClick={() => setActiveTab('call')}
              className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-all relative flex items-center justify-center gap-1.5 lg:hidden ${
                activeTab === 'call'
                  ? 'border-primary-500 text-primary-400 font-bold'
                  : 'border-transparent text-surface-400 hover:text-surface-200'
              }`}
            >
              <span>📹</span>
              <span>Call</span>
              {callCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-accent-emerald animate-pulse" />
              )}
            </button>

            {/* Members Tab */}
            <button
              onClick={() => setActiveTab('members')}
              className={`flex-1 py-2.5 text-xs font-semibold border-b-2 transition-all relative flex items-center justify-center gap-1.5 ${
                activeTab === 'members'
                  ? 'border-primary-500 text-primary-400 font-bold'
                  : 'border-transparent text-surface-400 hover:text-surface-200'
              }`}
            >
              <span>👥</span>
              <span>Members</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-surface-800 text-surface-300 font-mono">
                {state.members.length}
              </span>
            </button>
          </div>

          {/* Tab Content Area (WebRTC does NOT unmount when switching tabs) */}
          <div className="flex-1 overflow-hidden relative flex flex-col min-h-0">
            {activeTab === 'chat' && <ChatPanel />}
            {activeTab === 'queue' && <QueuePanel />}
            {activeTab === 'call' && (
              <div className="p-3 overflow-y-auto h-full space-y-3">
                <VideoCallStrip />
                <div className="p-3.5 rounded-2xl bg-surface-800/40 border border-surface-700/40 text-xs text-surface-300 space-y-2">
                  <h4 className="font-semibold text-white flex items-center gap-1.5">
                    <span>💡</span> Calling Features
                  </h4>
                  <p className="text-surface-400 text-[11px] leading-relaxed">
                    You can switch to <strong>Chat</strong>, <strong>Queue</strong>, or any other tab — your call and camera will <strong>stay connected</strong> without dropping!
                  </p>
                  <p className="text-surface-400 text-[11px] leading-relaxed">
                    Tap <strong>🪟 Floating Faces</strong> anytime to see everyone in a draggable floating window while you chat.
                  </p>
                </div>
              </div>
            )}
            {activeTab === 'members' && <MemberList />}
          </div>
        </div>
      </div>

      {/* Draggable Floating Video Grid for all faces */}
      <FloatingVideoGrid />

      {/* Floating Toast Notification Container */}
      <div className="fixed bottom-4 left-4 right-4 sm:right-auto z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full mx-auto sm:mx-0">
        {state.toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto px-4 py-2.5 rounded-xl shadow-xl text-xs font-medium flex items-center gap-2 border animate-slide-in-up backdrop-blur ${
              toast.type === 'error'
                ? 'bg-accent-rose/20 border-accent-rose/40 text-accent-rose'
                : toast.type === 'success'
                ? 'bg-accent-emerald/20 border-accent-emerald/40 text-accent-emerald'
                : toast.type === 'warning'
                ? 'bg-accent-amber/20 border-accent-amber/40 text-accent-amber'
                : 'bg-surface-900/90 border-surface-700/50 text-surface-200'
            }`}
          >
            <span>
              {toast.type === 'error' ? '❌' : toast.type === 'success' ? '✅' : toast.type === 'warning' ? '⚠️' : 'ℹ️'}
            </span>
            <span className="flex-1">{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Share Dialog */}
      <ShareDialog isOpen={showShare} onClose={() => setShowShare(false)} />

      {/* Username Modal if prompted */}
      <UsernameModal
        isOpen={showUsernameModal}
        onSubmit={handleUsernameSubmit}
      />
    </div>
  );
}
