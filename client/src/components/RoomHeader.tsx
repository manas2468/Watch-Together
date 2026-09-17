import React, { useState } from 'react';
import { useRoom } from '../context/RoomContext';
import { useSocket } from '../context/SocketContext';

export function RoomHeader() {
  const { state, isHost, leaveRoom, addToast } = useRoom();
  const { socket, isReconnecting } = useSocket();
  const [showSettings, setShowSettings] = useState(false);
  const [showShare, setShowShare] = useState(false);

  const copyInviteLink = () => {
    const url = `${window.location.origin}/room/${state.roomId}`;
    navigator.clipboard.writeText(url).then(
      () => addToast('Invite link copied!', 'success'),
      () => addToast('Failed to copy link', 'error')
    );
    setShowShare(false);
  };

  const handleToggleControl = () => {
    if (!socket || !state.roomId) return;
    socket.emit('room:toggle-control', { roomId: state.roomId }, () => {});
  };

  const handleToggleLock = () => {
    if (!socket || !state.roomId) return;
    socket.emit('room:toggle-lock', { roomId: state.roomId }, () => {});
  };

  const handleToggleIgnoreSlow = () => {
    if (!socket || !state.roomId) return;
    socket.emit('room:toggle-ignore-slow', { roomId: state.roomId }, () => {});
  };

  return (
    <>
      {/* Reconnecting banner */}
      {isReconnecting && (
        <div className="bg-accent-amber/20 text-accent-amber text-center py-1.5 text-xs font-medium 
                        animate-pulse-soft" role="alert">
          ⚡ Reconnecting…
        </div>
      )}

      <header className="flex items-center justify-between px-3 py-2 sm:px-4 sm:py-2.5 border-b border-surface-800/50 glass flex-shrink-0 z-30">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <span className="text-base sm:text-lg">🎬</span>
          <div className="min-w-0">
            <h1 className="text-xs sm:text-sm font-semibold text-white truncate max-w-[140px] sm:max-w-xs">{state.name}</h1>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-[11px] sm:text-xs text-primary-400 font-mono font-semibold">{state.roomId}</span>
              <span className="text-[10px] text-surface-500">·</span>
              <span className="text-[11px] sm:text-xs text-surface-400">
                {state.members.length} {state.members.length === 1 ? 'viewer' : 'viewers'}
              </span>
              {state.locked && <span className="text-xs" title="Room locked">🔒</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Share button */}
          <button
            onClick={copyInviteLink}
            className="p-2 rounded-lg text-surface-300 hover:text-white hover:bg-surface-800/50 
                       transition-colors"
            aria-label="Copy invite link"
            title="Copy invite link"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </button>

          {/* Host settings */}
          {isHost && (
            <div className="relative">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 rounded-lg text-surface-300 hover:text-white hover:bg-surface-800/50 
                           transition-colors"
                aria-label="Room settings"
                aria-expanded={showSettings}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              {showSettings && (
                <div className="absolute right-0 top-full mt-2 z-30 w-64 glass rounded-xl py-2 
                                shadow-2xl animate-slide-in-up">
                  <div className="px-3 py-1 text-xs text-surface-400 font-medium">Host Controls</div>
                  <ToggleRow
                    label="Everyone can control"
                    description="Allow all members to play/pause/seek"
                    checked={state.everyoneCanControl}
                    onChange={handleToggleControl}
                  />
                  <ToggleRow
                    label="Lock room"
                    description="Prevent new members from joining"
                    checked={state.locked}
                    onChange={handleToggleLock}
                  />
                  <ToggleRow
                    label="Ignore slow viewers"
                    description="Don't pause when someone buffers"
                    checked={state.ignoreSlowViewers}
                    onChange={handleToggleIgnoreSlow}
                  />
                </div>
              )}
            </div>
          )}

          {/* Leave */}
          <button
            onClick={leaveRoom}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-accent-rose 
                       hover:bg-accent-rose/10 transition-colors"
            aria-label="Leave room"
          >
            Leave
          </button>
        </div>
      </header>
    </>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface-800/30 transition-colors"
    >
      <div className="text-left">
        <div className="text-xs text-surface-200 font-medium">{label}</div>
        <div className="text-[10px] text-surface-500">{description}</div>
      </div>
      <div
        className={`w-8 h-4.5 rounded-full transition-colors flex items-center px-0.5 
                    ${checked ? 'bg-primary-600' : 'bg-surface-700'}`}
      >
        <div
          className={`w-3.5 h-3.5 rounded-full bg-white transition-transform 
                      ${checked ? 'translate-x-3.5' : 'translate-x-0'}`}
        />
      </div>
    </button>
  );
}
