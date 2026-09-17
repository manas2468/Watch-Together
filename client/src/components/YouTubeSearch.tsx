import React, { useState, useEffect, useRef } from 'react';
import { useRoom, MediaItem } from '../context/RoomContext';
import { useSocket } from '../context/SocketContext';

interface SearchResult {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  timestamp: string;
  seconds: number;
  author: string;
  views: number;
  ago: string;
}

const POPULAR_TAGS = ['Lofi Beats', 'Official Trailer', 'Music 2026', 'Gaming', 'Podcast', 'Chill'];

export function YouTubeSearch({ onPlayImmediate }: { onPlayImmediate?: () => void }) {
  const { state, canControl, addToast } = useRoom();
  const { socket } = useSocket();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performSearch = async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setIsLoading(true);
    setHasSearched(true);

    try {
      const baseUrl = import.meta.env.VITE_SERVER_URL || '';
      const res = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error('Search failed');
      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      console.error('[YouTubeSearch] Search error:', err);
      addToast('Failed to search YouTube. Please try again.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    performSearch(query);
  };

  const handleTagClick = (tag: string) => {
    setQuery(tag);
    performSearch(tag);
  };

  const handlePlayNow = (video: SearchResult) => {
    if (!socket || !state.roomId || !canControl) return;

    socket.emit('media:load', {
      roomId: state.roomId,
      item: {
        type: 'youtube' as const,
        url: video.url,
        title: video.title,
        duration: video.seconds || null,
      },
    });

    addToast(`Now playing: ${video.title}`, 'success');
    onPlayImmediate?.();
  };

  const handleAddToQueue = (video: SearchResult) => {
    if (!socket || !state.roomId) return;

    socket.emit('queue:add', {
      roomId: state.roomId,
      item: {
        type: 'youtube' as const,
        url: video.url,
        title: video.title,
        duration: video.seconds || null,
      },
    });

    addToast(`Added to queue: ${video.title}`, 'info');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Search Input Bar */}
      <form onSubmit={handleSearchSubmit} className="mb-2">
        <div className="relative flex items-center">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search YouTube videos..."
            className="w-full pl-9 pr-16 py-2 rounded-xl bg-surface-800/60 border border-surface-700/60 
                       text-white placeholder-surface-400 text-xs sm:text-sm focus:outline-none 
                       focus:border-primary-500 focus:ring-1 focus:ring-primary-500/40 transition-all"
            aria-label="Search YouTube"
          />
          <div className="absolute left-3 text-surface-400 pointer-events-none text-xs">
            🔍
          </div>
          <button
            type="submit"
            disabled={!query.trim() || isLoading}
            className="absolute right-1.5 px-2.5 py-1 rounded-lg bg-primary-600/90 hover:bg-primary-500 
                       text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? '...' : 'Search'}
          </button>
        </div>
      </form>

      {/* Quick search tags */}
      {!hasSearched && (
        <div className="mb-3">
          <p className="text-[11px] text-surface-400 font-medium mb-1.5">Quick searches:</p>
          <div className="flex flex-wrap gap-1.5">
            {POPULAR_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => handleTagClick(tag)}
                className="px-2 py-1 rounded-lg bg-surface-800/60 hover:bg-surface-700/80 
                           text-surface-300 text-xs border border-surface-700/40 transition-colors"
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mb-2" />
          <span className="text-xs text-surface-400">Searching YouTube…</span>
        </div>
      )}

      {/* No results message */}
      {!isLoading && hasSearched && results.length === 0 && (
        <div className="text-center py-8">
          <p className="text-xs text-surface-400">No videos found for "{query}".</p>
          <p className="text-[11px] text-surface-500 mt-1">Try another search term or paste a direct link.</p>
        </div>
      )}

      {/* Search results list */}
      {!isLoading && results.length > 0 && (
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
          {results.map((video) => (
            <div
              key={video.id}
              className="p-2 rounded-xl bg-surface-800/40 hover:bg-surface-800/70 border border-surface-700/30 
                         transition-all flex gap-2.5 items-start group"
            >
              {/* Thumbnail with duration badge */}
              <div className="relative w-24 sm:w-28 aspect-video rounded-lg overflow-hidden bg-black flex-shrink-0">
                <img
                  src={video.thumbnail}
                  alt={video.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
                {video.timestamp && (
                  <span className="absolute bottom-1 right-1 px-1 py-0.2 rounded bg-black/80 font-mono text-[9px] text-white">
                    {video.timestamp}
                  </span>
                )}
              </div>

              {/* Video metadata & actions */}
              <div className="flex-1 min-w-0">
                <h4
                  className="text-xs font-medium text-white line-clamp-2 leading-tight group-hover:text-primary-300 transition-colors"
                  title={video.title}
                >
                  {video.title}
                </h4>
                <p className="text-[10px] text-surface-400 mt-0.5 truncate">
                  {video.author} {video.views ? `• ${(video.views / 1000).toFixed(0)}k views` : ''}
                </p>

                <div className="flex items-center gap-1.5 mt-2">
                  {canControl && (
                    <button
                      type="button"
                      onClick={() => handlePlayNow(video)}
                      className="px-2 py-0.5 rounded bg-primary-600/90 hover:bg-primary-500 
                                 text-white text-[10px] font-semibold flex items-center gap-1 transition-colors"
                      title="Play immediately"
                    >
                      <span>▶</span> Play Now
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleAddToQueue(video)}
                    className="px-2 py-0.5 rounded bg-surface-700 hover:bg-surface-600 
                               text-surface-200 text-[10px] font-medium transition-colors"
                    title="Add to room queue"
                  >
                    + Queue
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
