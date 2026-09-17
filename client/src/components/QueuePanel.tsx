import React, { useState, useRef } from 'react';
import { useRoom, MediaItem } from '../context/RoomContext';
import { useSocket } from '../context/SocketContext';
import { parseMediaUrl } from '../lib/urlParser';
import { formatTime } from '../lib/formatTime';
import { YouTubeSearch } from './YouTubeSearch';

type QueueInputMode = 'search' | 'url';

export function QueuePanel() {
  const { state, canControl, addToast } = useRoom();
  const { socket } = useSocket();

  const [inputMode, setInputMode] = useState<QueueInputMode>('search');
  const [urlInput, setUrlInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const dragItemRef = useRef<number | null>(null);

  const handleAddUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket || !state.roomId || !urlInput.trim()) return;

    const parsed = parseMediaUrl(urlInput.trim());
    if (parsed.type === 'unknown') {
      addToast('Unrecognized URL format. Try a YouTube or direct media link.', 'error');
      return;
    }

    socket.emit('queue:add', {
      roomId: state.roomId,
      item: {
        type: parsed.type,
        url: parsed.url,
        title: parsed.title,
        duration: null,
      },
    });
    setUrlInput('');
  };

  const handleLoadDirect = () => {
    if (!socket || !state.roomId || !urlInput.trim()) return;

    const parsed = parseMediaUrl(urlInput.trim());
    if (parsed.type === 'unknown') {
      addToast('Unrecognized URL format.', 'error');
      return;
    }

    socket.emit('media:load', {
      roomId: state.roomId,
      item: {
        type: parsed.type,
        url: parsed.url,
        title: parsed.title,
        duration: null,
      },
    });
    setUrlInput('');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !socket || !state.roomId) return;

    if (file.size > 500 * 1024 * 1024) {
      addToast('File too large. Maximum size is 500MB.', 'error');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      });

      const response = await new Promise<any>((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status === 200) resolve(JSON.parse(xhr.responseText));
          else reject(new Error(xhr.responseText));
        };
        const baseUrl = import.meta.env.VITE_SERVER_URL || '';
        xhr.open('POST', `${baseUrl}/api/upload`);
        xhr.send(formData);
      });

      socket.emit('queue:add', {
        roomId: state.roomId,
        item: {
          type: 'upload' as const,
          url: response.url,
          title: response.filename || file.name,
          duration: null,
        },
      });

      addToast('File uploaded successfully!', 'success');
    } catch (err: any) {
      const msg = err?.message || 'Upload failed';
      try {
        const parsed = JSON.parse(msg);
        addToast(parsed.error || msg, 'error');
      } catch {
        addToast(msg, 'error');
      }
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemove = (itemId: string) => {
    if (!socket || !state.roomId) return;
    socket.emit('queue:remove', { roomId: state.roomId, itemId });
  };

  const handlePlay = (item: MediaItem) => {
    if (!socket || !state.roomId || !canControl) return;
    socket.emit('media:load', { roomId: state.roomId, item });
  };

  const handleVoteSkip = () => {
    if (!socket || !state.roomId) return;
    socket.emit('queue:vote-skip', { roomId: state.roomId });
  };

  // Drag-and-drop reorder
  const handleDragStart = (idx: number) => {
    dragItemRef.current = idx;
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    setDragOverIdx(null);
    const dragIdx = dragItemRef.current;
    if (dragIdx === null || dragIdx === dropIdx || !socket || !state.roomId) return;

    const newQueue = [...state.queue];
    const [dragged] = newQueue.splice(dragIdx, 1);
    newQueue.splice(dropIdx, 0, dragged);

    socket.emit('queue:reorder', {
      roomId: state.roomId,
      orderedIds: newQueue.map((i) => i.id),
    });
    dragItemRef.current = null;
  };

  const handleDragEnd = () => {
    setDragOverIdx(null);
    dragItemRef.current = null;
  };

  return (
    <div className="flex flex-col h-full p-2.5 sm:p-3 overflow-hidden">
      {/* Mode Switcher Tabs */}
      <div className="flex items-center gap-1 mb-2.5 p-0.5 rounded-xl bg-surface-800/60 border border-surface-700/40">
        <button
          type="button"
          onClick={() => setInputMode('search')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
            inputMode === 'search'
              ? 'bg-primary-600 text-white shadow-sm'
              : 'text-surface-400 hover:text-white hover:bg-surface-700/50'
          }`}
        >
          <span>🔍</span>
          <span>Search YouTube</span>
        </button>
        <button
          type="button"
          onClick={() => setInputMode('url')}
          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
            inputMode === 'url'
              ? 'bg-primary-600 text-white shadow-sm'
              : 'text-surface-400 hover:text-white hover:bg-surface-700/50'
          }`}
        >
          <span>🔗</span>
          <span>Direct Link / Upload</span>
        </button>
      </div>

      {/* Input Area based on Mode */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {inputMode === 'search' ? (
          <YouTubeSearch />
        ) : (
          <div className="flex flex-col h-full">
            {/* Direct URL Form */}
            <form onSubmit={handleAddUrl} className="mb-2">
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="Paste YouTube or direct media URL..."
                  className="flex-1 px-3 py-2 rounded-xl bg-surface-800/60 border border-surface-700/50 
                             text-white placeholder-surface-500 text-xs sm:text-sm focus:outline-none 
                             focus:border-primary-500/50 transition-colors"
                  aria-label="Media URL input"
                />
                <button
                  type="submit"
                  disabled={!urlInput.trim()}
                  className="px-3 py-2 rounded-xl bg-primary-600 hover:bg-primary-500 text-white 
                             text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title="Add to queue"
                >
                  + Add
                </button>
              </div>
              {urlInput.trim() && canControl && (
                <button
                  type="button"
                  onClick={handleLoadDirect}
                  className="mt-1 text-[11px] text-primary-400 hover:text-primary-300 font-medium"
                >
                  ▶ Play now instead →
                </button>
              )}
            </form>

            {/* File Upload Button */}
            <div className="mb-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,audio/*,.mp4,.webm,.ogg,.mp3,.m3u8,.wav"
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="w-full py-2 rounded-xl border border-dashed border-surface-700 hover:border-primary-500/50 
                           text-surface-400 hover:text-primary-300 text-xs disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                aria-label="Upload a file"
              >
                {isUploading ? (
                  <span>Uploading… {uploadProgress}%</span>
                ) : (
                  <span>📁 Upload Video/Audio (up to 500MB)</span>
                )}
              </button>
              {isUploading && (
                <div className="mt-1.5 h-1 bg-surface-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary-500 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
            </div>

            {/* Queue List for Direct mode */}
            <div className="flex-1 flex flex-col min-h-0">
              {state.currentItem && (
                <div className="mb-2 p-2.5 rounded-xl bg-primary-600/10 border border-primary-600/20 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-primary-400 font-semibold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
                      Now Playing
                    </span>
                    <button
                      type="button"
                      onClick={handleVoteSkip}
                      className="ml-auto text-[10px] px-2 py-0.5 rounded bg-surface-800 text-surface-300 hover:text-white transition-colors"
                      aria-label="Vote to skip"
                    >
                      Skip ⏭
                    </button>
                  </div>
                  <p className="text-xs text-surface-200 truncate mt-1 font-medium">{state.currentItem.title}</p>
                </div>
              )}

              <div className="text-[11px] font-semibold text-surface-400 mb-1 px-1 flex items-center justify-between">
                <span>Room Queue ({state.queue.length})</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                {state.queue.length === 0 ? (
                  <p className="text-xs text-surface-500 text-center py-6">Queue is currently empty</p>
                ) : (
                  state.queue.map((item, idx) => (
                    <div
                      key={item.id}
                      draggable={canControl}
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDrop={(e) => handleDrop(e, idx)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-2 p-2 rounded-xl border border-transparent transition-all cursor-grab 
                                 active:cursor-grabbing no-select
                                 ${dragOverIdx === idx ? 'bg-primary-600/20 border-primary-500/30' : 'bg-surface-850/40 hover:bg-surface-800/60'}
                                 ${canControl ? '' : 'cursor-default'}`}
                    >
                      <span className="text-xs text-surface-500 w-4 text-center font-mono">{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-surface-200 truncate font-medium">{item.title}</p>
                        <p className="text-[10px] text-surface-500">
                          {item.type} • by {item.addedBy}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {canControl && (
                          <button
                            type="button"
                            onClick={() => handlePlay(item)}
                            className="p-1 text-xs text-surface-400 hover:text-white transition-colors"
                            aria-label={`Play ${item.title}`}
                          >
                            ▶
                          </button>
                        )}
                        {canControl && (
                          <button
                            type="button"
                            onClick={() => handleRemove(item.id)}
                            className="p-1 text-xs text-surface-400 hover:text-accent-rose transition-colors"
                            aria-label={`Remove ${item.title}`}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Persistent Queue Footer Summary (shows when in Search mode) */}
      {inputMode === 'search' && state.queue.length > 0 && (
        <div className="mt-2 pt-2 border-t border-surface-800/50 flex items-center justify-between text-xs text-surface-400">
          <span>{state.queue.length} video{state.queue.length > 1 ? 's' : ''} in queue</span>
          <button
            type="button"
            onClick={() => setInputMode('url')}
            className="text-primary-400 hover:text-primary-300 font-medium"
          >
            View Queue →
          </button>
        </div>
      )}
    </div>
  );
}
