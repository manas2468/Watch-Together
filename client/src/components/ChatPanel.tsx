import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRoom, ChatMessage } from '../context/RoomContext';
import { useSocket } from '../context/SocketContext';
import { formatMessageTime } from '../lib/formatTime';
import { extractUrls, isPlayableUrl, parseMediaUrl } from '../lib/urlParser';
import { getInitials } from '../lib/colors';

// Common emoji list for the picker
const EMOJI_LIST = [
  '😂', '❤️', '🔥', '👍', '😍', '🎉', '😢', '😮',
  '👏', '💯', '🤣', '😭', '🙏', '✨', '😊', '🥺',
  '💀', '👀', '🤔', '😳', '💪', '🎵', '🤯', '😤',
  '🥳', '😎', '🫡', '💜', '💙', '💚', '⭐', '🤡',
];

export function ChatPanel() {
  const { state, sendMessage, sendReaction } = useRoom();
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isNearBottomRef = useRef(true);

  // Auto-scroll logic: only scroll if user is near the bottom
  const checkNearBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const threshold = 100;
    isNearBottomRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowNewMessage(false);
  }, []);

  // When new messages arrive
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom();
    } else {
      setShowNewMessage(true);
    }
  }, [state.messages.length, scrollToBottom]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    sendMessage(trimmed);
    setInput('');
    setShowEmoji(false);
  };

  const handleEmojiSelect = (emoji: string) => {
    setInput((prev) => prev + emoji);
    inputRef.current?.focus();
  };

  const handleReaction = (emoji: string) => {
    sendReaction(emoji);
    setShowEmoji(false);
  };

  // Focus chat input on Enter key (global shortcut)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={checkNearBottom}
        className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1"
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
      >
        {state.messages.length === 0 && (
          <div className="text-center text-surface-500 text-sm mt-8">
            <p>No messages yet.</p>
            <p className="text-xs mt-1">Say hi! 👋</p>
          </div>
        )}
        {state.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} myId={state.mySocketId} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* New messages pill */}
      {showNewMessage && (
        <button
          onClick={scrollToBottom}
          className="mx-auto mb-2 px-3 py-1 rounded-full bg-primary-600 text-white text-xs 
                     font-medium animate-bounce-in hover:bg-primary-500 transition-colors"
          aria-label="Scroll to new messages"
        >
          New messages ↓
        </button>
      )}

      {/* Emoji picker */}
      {showEmoji && (
        <div className="px-3 pb-2 animate-slide-in-up">
          <div className="glass rounded-xl p-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-surface-400 font-medium">Emoji</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowEmoji(false)}
                  className="text-xs text-surface-400 hover:text-white"
                  aria-label="Close emoji picker"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="grid grid-cols-8 gap-1">
              {EMOJI_LIST.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => handleEmojiSelect(emoji)}
                  onDoubleClick={() => handleReaction(emoji)}
                  className="text-xl p-1 rounded hover:bg-surface-700/50 transition-colors"
                  title={`Click to add, double-click to react`}
                  aria-label={`Emoji ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-surface-500 mt-2">
              Click to add to message · Double-click to send reaction
            </p>
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSend} className="p-3 border-t border-surface-800/50">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowEmoji(!showEmoji)}
            className="p-2 rounded-lg text-surface-400 hover:text-white hover:bg-surface-800/50 transition-colors"
            aria-label="Toggle emoji picker"
            aria-expanded={showEmoji}
          >
            😊
          </button>
          <input
            ref={inputRef}
            id="chat-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-3 py-2 rounded-lg bg-surface-800/50 border border-surface-700/50 
                       text-white placeholder-surface-500 text-sm focus:outline-none 
                       focus:border-primary-500/50 transition-colors"
            maxLength={1000}
            autoComplete="off"
            aria-label="Chat message input"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-3 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium
                       hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed
                       transition-colors"
            aria-label="Send message"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

// ----- Individual message bubble -----
function MessageBubble({ message, myId }: { message: ChatMessage; myId: string | null }) {
  const { state } = useRoom();
  const isMine = message.userId === myId;

  if (message.isSystem) {
    return (
      <div className="text-center py-1 animate-fade-in">
        <span className="text-xs text-surface-500 italic">{message.content}</span>
      </div>
    );
  }

  return (
    <div className={`flex gap-2 py-1 animate-fade-in ${isMine ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] 
                    font-bold text-white flex-shrink-0 mt-0.5"
        style={{ backgroundColor: message.color }}
        title={message.username}
        aria-hidden="true"
      >
        {getInitials(message.username)}
      </div>

      <div className={`max-w-[80%] ${isMine ? 'text-right' : ''}`}>
        {/* Username + time */}
        <div className={`flex items-baseline gap-2 mb-0.5 ${isMine ? 'flex-row-reverse' : ''}`}>
          <span className="text-xs font-semibold" style={{ color: message.color }}>
            {message.username}
          </span>
          <span className="text-[10px] text-surface-500">
            {formatMessageTime(message.timestamp)}
          </span>
        </div>
        {/* Content */}
        <div
          className={`inline-block px-3 py-1.5 rounded-xl text-sm break-words
                      ${isMine
                        ? 'bg-primary-600/30 text-primary-100 rounded-tr-sm'
                        : 'bg-surface-800/60 text-surface-200 rounded-tl-sm'
                      }`}
        >
          <MessageContent content={message.content} />
        </div>
      </div>
    </div>
  );
}

// ----- Message content with @mentions and URL auto-linking -----
function MessageContent({ content }: { content: string }) {
  const { state } = useRoom();
  const { socket } = useSocket();

  // Parse @mentions
  const mentionRegex = /@(\w+)/g;
  const urls = extractUrls(content);

  // Simple rendering: highlight @mentions, linkify URLs
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  // Find all @mentions
  const mentionMatches: { start: number; end: number; name: string }[] = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    mentionMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      name: match[1],
    });
  }

  // Find all URLs
  const urlMatches: { start: number; end: number; url: string }[] = [];
  for (const url of urls) {
    const idx = content.indexOf(url, lastIndex);
    if (idx !== -1) {
      urlMatches.push({ start: idx, end: idx + url.length, url });
    }
  }

  // Merge and sort all special segments
  const segments = [
    ...mentionMatches.map((m) => ({ ...m, type: 'mention' as const })),
    ...urlMatches.map((m) => ({ ...m, type: 'url' as const })),
  ].sort((a, b) => a.start - b.start);

  lastIndex = 0;
  for (const seg of segments) {
    if (seg.start < lastIndex) continue; // Overlapping

    // Plain text before this segment
    if (seg.start > lastIndex) {
      parts.push(<span key={key++}>{content.slice(lastIndex, seg.start)}</span>);
    }

    if (seg.type === 'mention') {
      const isSelf = state.members.some(
        (m) => m.username.toLowerCase() === seg.name.toLowerCase() && m.id === state.mySocketId
      );
      parts.push(
        <span
          key={key++}
          className={`font-semibold ${isSelf ? 'text-accent-amber bg-accent-amber/10 rounded px-0.5' : 'text-primary-300'}`}
        >
          @{seg.name}
        </span>
      );
    } else {
      const playable = isPlayableUrl(seg.url);
      parts.push(
        <span key={key++}>
          <a
            href={seg.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-400 hover:text-primary-300 underline"
          >
            {seg.url.length > 50 ? seg.url.slice(0, 50) + '…' : seg.url}
          </a>
          {playable && <AddToQueueButton url={seg.url} />}
        </span>
      );
    }
    lastIndex = seg.end;
  }

  // Remaining text
  if (lastIndex < content.length) {
    parts.push(<span key={key++}>{content.slice(lastIndex)}</span>);
  }

  return <>{parts}</>;
}

// ----- "Add to queue" button for playable URLs in chat -----
function AddToQueueButton({ url }: { url: string }) {
  const { state } = useRoom();
  const { socket } = useSocket();

  const handleAdd = () => {
    if (!socket || !state.roomId) return;
    const parsed = parseMediaUrl(url);
    if (parsed.type === 'unknown') return;

    socket.emit('queue:add', {
      roomId: state.roomId,
      item: {
        type: parsed.type,
        url: parsed.url,
        title: parsed.title,
        duration: null,
      },
    });
  };

  return (
    <button
      onClick={handleAdd}
      className="ml-1 px-1.5 py-0.5 text-[10px] rounded bg-primary-600/30 text-primary-300 
                 hover:bg-primary-600/50 transition-colors"
      aria-label="Add to queue"
    >
      + Queue
    </button>
  );
}
