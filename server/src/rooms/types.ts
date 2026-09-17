// ============================================================================
// Watch Together — Shared Type Definitions
// ============================================================================
// These types define the server's authoritative state model.
// The server is the single source of truth for all room state.

/** A member in a room */
export interface Member {
  id: string;            // socket.id
  username: string;
  color: string;         // HSL color string, deterministic from username hash
  isHost: boolean;
  isMuted: boolean;
  cameraOn: boolean;
  joinedAt: number;      // Server timestamp (ms)
  inCall: boolean;       // Whether user has joined the video call
}

/** Supported media types */
export type MediaType = 'youtube' | 'direct' | 'upload';

/** A media item in the queue */
export interface MediaItem {
  id: string;            // UUID
  type: MediaType;
  url: string;
  title: string;
  addedBy: string;       // Username of who added it
  duration: number | null; // Duration in seconds, null if unknown
}

/**
 * Server-authoritative playback state.
 *
 * CRITICAL: positionSec is only meaningful together with lastUpdatedAt.
 * To compute the current live position:
 *
 *   isPlaying
 *     ? positionSec + (serverNow - lastUpdatedAt) / 1000
 *     : positionSec
 *
 * All timestamps use the server's Date.now(). Clients must apply their
 * computed clock offset to align with the server's clock.
 */
export interface PlaybackState {
  isPlaying: boolean;
  positionSec: number;
  lastUpdatedAt: number;  // Server timestamp in ms
}

/** A chat message */
export interface ChatMessage {
  id: string;
  userId: string;          // socket.id, or 'system' for system messages
  username: string;
  color: string;
  content: string;
  timestamp: number;       // Server timestamp in ms
  isSystem: boolean;
}

/**
 * Full room state — server-side representation.
 * Uses Map and Set for efficient lookups. Converted to RoomSnapshot for clients.
 */
export interface Room {
  id: string;              // 6-char uppercase code, collision-checked
  name: string;
  hostId: string;          // socket.id of the current host
  everyoneCanControl: boolean;
  locked: boolean;
  ignoreSlowViewers: boolean;
  members: Map<string, Member>;
  queue: MediaItem[];
  currentItem: MediaItem | null;
  playback: PlaybackState;
  messages: ChatMessage[];   // Capped at 200
  createdAt: number;

  // Buffering coordination state
  stalledClients: Set<string>;       // socket.ids currently buffering
  stallTimeout: ReturnType<typeof setTimeout> | null;

  // Skip voting state
  skipVotes: Set<string>;            // socket.ids who voted to skip
}

/**
 * Serializable room snapshot sent to clients.
 * Maps/Sets are converted to arrays for JSON transport.
 * Includes serverTime so clients can compute clock offset on the first message.
 */
export interface RoomSnapshot {
  id: string;
  name: string;
  hostId: string;
  everyoneCanControl: boolean;
  locked: boolean;
  ignoreSlowViewers: boolean;
  members: Member[];
  queue: MediaItem[];
  currentItem: MediaItem | null;
  playback: PlaybackState;
  messages: ChatMessage[];
  serverTime: number;
}

/** Record of a kicked user, with expiry */
export interface KickEntry {
  username: string;        // Lowercased for comparison
  expiresAt: number;       // Server timestamp when the kick expires
}
