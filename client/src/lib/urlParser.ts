/**
 * URL parsing utilities for Watch Together.
 * Handles YouTube URLs (watch, youtu.be, shorts) and direct media URLs.
 */

export type MediaType = 'youtube' | 'direct' | 'upload' | 'unknown';

export interface ParsedUrl {
  type: MediaType;
  url: string;
  videoId?: string;   // YouTube video ID
  title: string;
}

/**
 * Robust YouTube video ID extraction.
 * Handles:
 *   - https://www.youtube.com/watch?v=dQw4w9WgXcQ
 *   - https://youtu.be/dQw4w9WgXcQ
 *   - https://youtube.com/shorts/dQw4w9WgXcQ
 *   - https://www.youtube.com/embed/dQw4w9WgXcQ
 *   - With extra params, timestamps, etc.
 */
export function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();

  // Handle raw 11-character video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // Try URL parsing
  try {
    const parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const host = parsed.hostname.toLowerCase();

    // Short URLs: youtu.be/<id>
    if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
      const id = parsed.pathname.slice(1).split('/')[0];
      if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }

    // YouTube domains
    if (
      host === 'youtube.com' ||
      host.endsWith('.youtube.com') ||
      host === 'youtube-nocookie.com' ||
      host.endsWith('.youtube-nocookie.com')
    ) {
      // /watch?v=<id>
      const v = parsed.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

      // /shorts/<id>, /embed/<id>, /live/<id>, /v/<id>
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (['shorts', 'embed', 'live', 'v'].includes(parts[0]) && parts[1]) {
        const id = parts[1].split('?')[0];
        if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
      }
    }
  } catch {
    // URL parsing failed, fall back to regex
  }

  const patterns = [
    // Standard / mobile / music watch URL
    /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?youtube(?:-nocookie)?\.com\/(?:watch\?.*?[?&]v=|shorts\/|embed\/|live\/|v\/)([a-zA-Z0-9_-]{11})/,
    // Short URL
    /(?:https?:\/\/)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) return match[1];
  }
  return null;
}

/**
 * Check if a URL points to a directly playable media file.
 */
export function isDirectMediaUrl(url: string): boolean {
  const mediaExtensions = /\.(mp4|webm|ogg|mp3|m3u8|wav)(\?.*)?$/i;
  return mediaExtensions.test(url);
}

/**
 * Check if a URL looks playable (either YouTube or direct media).
 */
export function isPlayableUrl(url: string): boolean {
  return extractYouTubeId(url) !== null || isDirectMediaUrl(url);
}

/**
 * Parse a URL into a media descriptor.
 */
export function parseMediaUrl(url: string): ParsedUrl {
  const trimmed = url.trim();

  // Try YouTube first
  const youtubeId = extractYouTubeId(trimmed);
  if (youtubeId) {
    return {
      type: 'youtube',
      url: trimmed,
      videoId: youtubeId,
      title: `YouTube: ${youtubeId}`,
    };
  }

  // Try direct media
  if (isDirectMediaUrl(trimmed)) {
    // Extract filename from URL
    try {
      const pathname = new URL(trimmed).pathname;
      const filename = pathname.split('/').pop() || 'media';
      return {
        type: 'direct',
        url: trimmed,
        title: decodeURIComponent(filename),
      };
    } catch {
      return {
        type: 'direct',
        url: trimmed,
        title: 'Direct media',
      };
    }
  }

  return {
    type: 'unknown',
    url: trimmed,
    title: trimmed,
  };
}

/**
 * Extract URLs from a text string (for auto-linking in chat).
 */
export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
  return text.match(urlRegex) || [];
}
