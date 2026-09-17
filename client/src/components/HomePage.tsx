import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRoom } from '../context/RoomContext';
import { useSocket } from '../context/SocketContext';
import { UsernameModal } from './UsernameModal';

export function HomePage() {
  const navigate = useNavigate();
  const params = useParams<{ roomId?: string }>();
  const { state, createRoom, joinRoom } = useRoom();
  const { isConnected } = useSocket();
  const [roomCode, setRoomCode] = useState(params.roomId || '');
  const [roomName, setRoomName] = useState('');
  const [showUsername, setShowUsername] = useState(false);
  const [pendingAction, setPendingAction] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState('');

  const storedUsername = localStorage.getItem('wt-username');

  // If we have a room ID in the URL and username, auto-join
  useEffect(() => {
    if (params.roomId && storedUsername && isConnected && !state.roomId) {
      handleJoin(storedUsername, params.roomId);
    } else if (params.roomId && !storedUsername) {
      setRoomCode(params.roomId);
      setPendingAction('join');
      setShowUsername(true);
    }
  }, [params.roomId, isConnected]);

  // Navigate to room when joined
  useEffect(() => {
    if (state.roomId) {
      navigate(`/room/${state.roomId}`, { replace: true });
    }
  }, [state.roomId, navigate]);

  const handleCreate = async (username: string) => {
    setError('');
    const room = await createRoom(roomName, username);
    if (!room) {
      setError('Failed to create room. Please try again.');
    }
    setShowUsername(false);
  };

  const handleJoin = async (username: string, code?: string) => {
    setError('');
    const targetCode = code || roomCode;
    if (!targetCode.trim()) {
      setError('Please enter a room code.');
      return;
    }
    const room = await joinRoom(targetCode.trim().toUpperCase(), username);
    if (!room) {
      setError('Could not join room. Check the code and try again.');
    }
    setShowUsername(false);
  };

  const onUsernameSubmit = (username: string) => {
    if (pendingAction === 'create') {
      handleCreate(username);
    } else if (pendingAction === 'join') {
      handleJoin(username);
    }
  };

  const initiateCreate = () => {
    if (storedUsername) {
      handleCreate(storedUsername);
    } else {
      setPendingAction('create');
      setShowUsername(true);
    }
  };

  const initiateJoin = () => {
    if (!roomCode.trim()) {
      setError('Please enter a room code.');
      return;
    }
    if (storedUsername) {
      handleJoin(storedUsername);
    } else {
      setPendingAction('join');
      setShowUsername(true);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 
                    bg-gradient-to-br from-surface-950 via-surface-900 to-surface-950">
      {/* Ambient background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-primary-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-accent-violet/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] 
                        bg-primary-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="text-7xl mb-4">🎬</div>
          <h1 className="text-4xl font-extrabold text-gradient mb-2">Watch Together</h1>
          <p className="text-surface-400 text-sm">
            Synchronized streaming with friends — watch, chat, and call.
          </p>
        </div>

        {/* Connection status */}
        {!isConnected && (
          <div className="mb-4 p-3 rounded-xl bg-accent-amber/10 border border-accent-amber/20 
                          text-accent-amber text-xs text-center">
            ⚡ Connecting to server…
          </div>
        )}

        {/* Create Room */}
        <div className="glass rounded-2xl p-6 mb-4">
          <h2 className="text-sm font-semibold text-surface-300 mb-3">Create a Room</h2>
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="Room name (optional)"
            className="w-full px-4 py-2.5 rounded-xl bg-surface-900/60 border border-surface-700/50 
                       text-white placeholder-surface-500 text-sm focus:outline-none 
                       focus:border-primary-500/50 transition-colors mb-3"
            maxLength={50}
          />
          <button
            onClick={initiateCreate}
            disabled={!isConnected}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-primary-600 to-primary-700 
                       text-white font-semibold hover:from-primary-500 hover:to-primary-600 
                       disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 
                       transform hover:scale-[1.01] active:scale-[0.99]"
          >
            Create Room
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-surface-800" />
          <span className="text-xs text-surface-500">or</span>
          <div className="flex-1 h-px bg-surface-800" />
        </div>

        {/* Join Room */}
        <div className="glass rounded-2xl p-6">
          <h2 className="text-sm font-semibold text-surface-300 mb-3">Join a Room</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={roomCode}
              onChange={(e) => {
                setRoomCode(e.target.value.toUpperCase());
                if (error) setError('');
              }}
              placeholder="Room code (e.g. ABC123)"
              className="flex-1 px-4 py-2.5 rounded-xl bg-surface-900/60 border border-surface-700/50 
                         text-white placeholder-surface-500 text-sm font-mono tracking-wider 
                         focus:outline-none focus:border-primary-500/50 transition-colors uppercase"
              maxLength={6}
            />
            <button
              onClick={initiateJoin}
              disabled={!isConnected || !roomCode.trim()}
              className="px-6 py-2.5 rounded-xl bg-surface-800 text-white font-semibold 
                         hover:bg-surface-700 disabled:opacity-50 disabled:cursor-not-allowed 
                         transition-colors"
            >
              Join
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 p-3 rounded-xl bg-accent-rose/10 border border-accent-rose/20 
                          text-accent-rose text-xs text-center animate-fade-in">
            {error}
          </div>
        )}

        {/* Stored username indicator */}
        {storedUsername && (
          <div className="text-center mt-6">
            <span className="text-xs text-surface-500">
              Joining as <span className="text-surface-300 font-medium">{storedUsername}</span>
            </span>
            <button
              onClick={() => {
                localStorage.removeItem('wt-username');
                window.location.reload();
              }}
              className="ml-2 text-xs text-primary-400 hover:text-primary-300"
            >
              Change
            </button>
          </div>
        )}
      </div>

      {/* Username modal */}
      <UsernameModal
        isOpen={showUsername}
        onSubmit={onUsernameSubmit}
      />
    </div>
  );
}
