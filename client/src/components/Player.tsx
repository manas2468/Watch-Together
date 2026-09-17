// Player wrapper — renders the appropriate player based on media type

import React from 'react';
import { useRoom } from '../context/RoomContext';
import { YouTubePlayer } from './YouTubePlayer';
import { DirectPlayer } from './DirectPlayer';
import { extractYouTubeId } from '../lib/urlParser';

export function Player() {
  const { state } = useRoom();
  const { currentItem } = state;

  if (!currentItem) {
    return (
      <div className="aspect-video bg-surface-900/50 rounded-lg flex items-center justify-center 
                      border border-surface-800/30">
        <div className="text-center p-8">
          <div className="text-6xl mb-4 opacity-30">🎬</div>
          <h2 className="text-lg font-semibold text-surface-400 mb-2">Nothing playing</h2>
          <p className="text-sm text-surface-500 max-w-sm">
            Add a YouTube URL, paste a direct video link, or upload a file to get started.
          </p>
        </div>
      </div>
    );
  }

  if (currentItem.type === 'youtube') {
    const videoId = extractYouTubeId(currentItem.url);
    if (!videoId) {
      return (
        <div className="aspect-video bg-surface-900/50 rounded-lg flex items-center justify-center">
          <p className="text-surface-400">Invalid YouTube URL</p>
        </div>
      );
    }
    return <YouTubePlayer key={videoId} videoId={videoId} />;
  }

  // Direct URL or uploaded file
  return <DirectPlayer url={currentItem.url} />;
}
