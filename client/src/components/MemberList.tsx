import React from 'react';
import { useRoom, Member } from '../context/RoomContext';
import { useSocket } from '../context/SocketContext';
import { getInitials } from '../lib/colors';

export function MemberList() {
  const { state, isHost } = useRoom();
  const { socket } = useSocket();

  // Sort: host first, then by join order
  const sortedMembers = [...state.members].sort((a, b) => {
    if (a.isHost) return -1;
    if (b.isHost) return 1;
    return a.joinedAt - b.joinedAt;
  });

  const handleKick = (memberId: string) => {
    if (!socket || !state.roomId) return;
    socket.emit('member:kick', { roomId: state.roomId, targetId: memberId }, (res: any) => {
      if (res?.error) console.error(res.error);
    });
  };

  const handleTransferHost = (memberId: string) => {
    if (!socket || !state.roomId) return;
    socket.emit('member:transfer-host', { roomId: state.roomId, targetId: memberId }, (res: any) => {
      if (res?.error) console.error(res.error);
    });
  };

  return (
    <div className="p-3 space-y-1" role="list" aria-label="Room members">
      <div className="text-xs text-surface-400 font-medium mb-3 px-1">
        {state.members.length} member{state.members.length !== 1 ? 's' : ''} in room
      </div>

      {sortedMembers.map((member) => (
        <MemberRow
          key={member.id}
          member={member}
          isMe={member.id === state.mySocketId}
          showControls={isHost && member.id !== state.mySocketId}
          onKick={() => handleKick(member.id)}
          onTransferHost={() => handleTransferHost(member.id)}
        />
      ))}
    </div>
  );
}

function MemberRow({
  member,
  isMe,
  showControls,
  onKick,
  onTransferHost,
}: {
  member: Member;
  isMe: boolean;
  showControls: boolean;
  onKick: () => void;
  onTransferHost: () => void;
}) {
  const [showMenu, setShowMenu] = React.useState(false);

  return (
    <div
      className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-surface-800/30 
                 transition-colors group"
      role="listitem"
    >
      {/* Avatar */}
      <div className="relative">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs 
                      font-bold text-white flex-shrink-0"
          style={{ backgroundColor: member.color }}
          aria-hidden="true"
        >
          {getInitials(member.username)}
        </div>
        {/* Camera indicator */}
        {member.inCall && member.cameraOn && (
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-accent-emerald 
                          border-2 border-surface-900" title="Camera on" />
        )}
      </div>

      {/* Name + indicators */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-surface-200 truncate">
            {member.username}
          </span>
          {isMe && (
            <span className="text-[10px] text-surface-500">(you)</span>
          )}
          {member.isHost && (
            <span className="text-xs" title="Host" aria-label="Host">👑</span>
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          {member.inCall && (
            <span className="text-[10px] text-accent-emerald">In call</span>
          )}
          {member.inCall && member.isMuted && (
            <span className="text-[10px] text-accent-rose" title="Muted">🔇</span>
          )}
        </div>
      </div>

      {/* Host actions */}
      {showControls && (
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="opacity-0 group-hover:opacity-100 p-1 rounded text-surface-400 
                       hover:text-white hover:bg-surface-700 transition-all"
            aria-label={`Actions for ${member.username}`}
            aria-expanded={showMenu}
          >
            ⋯
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 z-20 w-36 glass rounded-lg py-1 
                            shadow-xl animate-fade-in">
              <button
                onClick={() => { onTransferHost(); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-surface-300 
                           hover:bg-surface-700/50 hover:text-white transition-colors"
              >
                👑 Make host
              </button>
              <button
                onClick={() => { onKick(); setShowMenu(false); }}
                className="w-full text-left px-3 py-1.5 text-xs text-accent-rose 
                           hover:bg-accent-rose/10 transition-colors"
              >
                🚫 Kick
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
