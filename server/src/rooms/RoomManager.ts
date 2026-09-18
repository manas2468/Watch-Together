// ============================================================================
// Watch Together — Room Manager
// ============================================================================
// Central authority for all room state. Every mutation goes through this class.
// The RoomManager enforces all business rules: permissions, rate limits,
// username uniqueness, host succession, room lifecycle, etc.

import { Room, Member, MediaItem, PlaybackState, ChatMessage, RoomSnapshot, KickEntry } from './types';
import { v4 as uuidv4 } from 'uuid';

// ----- Constants -----
const MAX_MESSAGES = 200;
const KICK_DURATION_MS = 5 * 60 * 1000;       // 5 minutes
const ROOM_CLEANUP_DELAY_MS = 60 * 1000;       // 60 seconds after last member leaves
const CHAT_RATE_LIMIT = { max: 5, windowMs: 3000 };
const REACTION_RATE_LIMIT = { max: 3, windowMs: 3000 };

export class RoomManager {
  private rooms = new Map<string, Room>();
  private kickedUsers = new Map<string, KickEntry[]>();        // roomId -> kick entries
  private deletionTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private chatTimestamps = new Map<string, number[]>();         // socketId -> timestamps
  private reactionTimestamps = new Map<string, number[]>();

  // Callback invoked when a stall timeout fires and room should auto-resume.
  // Set by the socket handler layer so it can broadcast the resume event.
  public onStallTimeout: ((roomId: string) => void) | null = null;

  // ===================== Room Lifecycle =====================

  /**
   * Generate a collision-checked 6-character uppercase room code.
   * Uses a reduced charset to avoid confusable characters (0/O, 1/I/L).
   */
  private generateRoomId(): string {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let id: string;
    let attempts = 0;
    do {
      id = '';
      for (let i = 0; i < 6; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
      }
      attempts++;
      if (attempts > 1000) throw new Error('Failed to generate unique room ID after 1000 attempts');
    } while (this.rooms.has(id));
    return id;
  }

  /** Create a new room. The creator becomes the host. */
  createRoom(name: string, hostSocketId: string, username: string): Room {
    const roomId = this.generateRoomId();
    const color = RoomManager.usernameToColor(username);

    const host: Member = {
      id: hostSocketId,
      username,
      color,
      isHost: true,
      isMuted: true,
      cameraOn: false,
      joinedAt: Date.now(),
      inCall: false,
    };

    const room: Room = {
      id: roomId,
      name: name || `${username}'s Room`,
      hostId: hostSocketId,
      everyoneCanControl: true,
      locked: false,
      ignoreSlowViewers: false,
      members: new Map([[hostSocketId, host]]),
      queue: [],
      currentItem: null,
      playback: { isPlaying: false, positionSec: 0, lastUpdatedAt: Date.now() },
      messages: [],
      createdAt: Date.now(),
      stalledClients: new Set(),
      stallTimeout: null,
      skipVotes: new Set(),
    };

    this.rooms.set(roomId, room);
    this.addSystemMessage(roomId, `${username} created the room`);
    return room;
  }

  /** Join an existing room. Returns the room and new member, or an error. */
  joinRoom(
    roomId: string,
    socketId: string,
    username: string
  ): { room: Room; member: Member } | { error: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found. Check the code and try again.' };
    if (room.locked) return { error: 'This room is locked by the host.' };

    // Check the kick ban list — prevents re-joining for 5 minutes
    const kicks = this.kickedUsers.get(roomId);
    if (kicks) {
      const now = Date.now();
      const kickEntry = kicks.find(
        (k) => k.username === username.toLowerCase() && now < k.expiresAt
      );
      if (kickEntry) {
        const remainingSec = Math.ceil((kickEntry.expiresAt - now) / 1000);
        return { error: `You were kicked from this room. Try again in ${remainingSec}s.` };
      }
    }

    // Cancel any pending room deletion (e.g., a brief disconnect)
    this.cancelDeletionTimer(roomId);

    // Ensure unique username within this room, auto-append suffix if taken
    const finalUsername = this.ensureUniqueUsername(room, username);
    const color = RoomManager.usernameToColor(finalUsername);

    const member: Member = {
      id: socketId,
      username: finalUsername,
      color,
      isHost: false,
      isMuted: true,
      cameraOn: false,
      joinedAt: Date.now(),
      inCall: false,
    };

    room.members.set(socketId, member);
    this.addSystemMessage(roomId, `${finalUsername} joined`);

    return { room, member };
  }

  /**
   * Handle a member leaving. Returns metadata about what happened so the
   * socket handler can broadcast appropriate events.
   */
  leaveRoom(roomId: string, socketId: string): {
    room: Room | null;
    leftMember: Member | null;
    wasHost: boolean;
    newHost: Member | null;
  } {
    const room = this.rooms.get(roomId);
    if (!room) return { room: null, leftMember: null, wasHost: false, newHost: null };

    const member = room.members.get(socketId);
    if (!member) return { room, leftMember: null, wasHost: false, newHost: null };

    const wasHost = member.isHost;
    room.members.delete(socketId);
    room.stalledClients.delete(socketId);
    if (room.stalledClients.size === 0 && room.stallTimeout) {
      clearTimeout(room.stallTimeout);
      room.stallTimeout = null;
    }
    room.skipVotes.delete(socketId);
    this.chatTimestamps.delete(socketId);
    this.reactionTimestamps.delete(socketId);

    this.addSystemMessage(roomId, `${member.username} left`);

    // If the room is now empty, schedule deletion (60s grace period)
    if (room.members.size === 0) {
      this.scheduleDeletion(roomId);
      return { room, leftMember: member, wasHost, newHost: null };
    }

    // If host left, auto-promote the longest-present member
    let newHost: Member | null = null;
    if (wasHost) {
      newHost = this.promoteNewHost(room);
    }

    return { room, leftMember: member, wasHost, newHost };
  }

  /**
   * Rejoin a room after socket reconnection.
   * Removes any stale socket entry for the same username and re-adds the member.
   */
  rejoinRoom(
    roomId: string,
    socketId: string,
    username: string
  ): { room: Room; member: Member } | { error: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room no longer exists.' };

    this.cancelDeletionTimer(roomId);

    // Remove any stale socket with the same username (from before the reconnect)
    for (const [sid, m] of room.members) {
      if (m.username.toLowerCase() === username.toLowerCase() && sid !== socketId) {
        room.members.delete(sid);
        room.stalledClients.delete(sid);
        break;
      }
    }

    // Check if this socket is already in the room
    const existing = room.members.get(socketId);
    if (existing) return { room, member: existing };

    // Determine if this user should be host (if no current host exists)
    const hasHost = Array.from(room.members.values()).some((m) => m.isHost);
    const color = RoomManager.usernameToColor(username);

    const member: Member = {
      id: socketId,
      username,
      color,
      isHost: !hasHost,
      isMuted: true,
      cameraOn: false,
      joinedAt: Date.now(),
      inCall: false,
    };

    if (!hasHost) {
      room.hostId = socketId;
    }

    room.members.set(socketId, member);
    this.addSystemMessage(roomId, `${username} reconnected`);

    return { room, member };
  }

  // ===================== Member Management =====================

  /** Kick a member. Only the host can kick. Adds a 5-minute ban. */
  kickMember(
    roomId: string,
    hostSocketId: string,
    targetSocketId: string
  ): { kicked: Member } | { error: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.hostId !== hostSocketId) return { error: 'Only the host can kick members' };

    const target = room.members.get(targetSocketId);
    if (!target) return { error: 'Member not found' };
    if (target.isHost) return { error: 'Cannot kick yourself' };

    // Add to kick ban list
    if (!this.kickedUsers.has(roomId)) this.kickedUsers.set(roomId, []);
    this.kickedUsers.get(roomId)!.push({
      username: target.username.toLowerCase(),
      expiresAt: Date.now() + KICK_DURATION_MS,
    });

    room.members.delete(targetSocketId);
    room.stalledClients.delete(targetSocketId);
    room.skipVotes.delete(targetSocketId);

    this.addSystemMessage(roomId, `${target.username} was kicked by the host`);
    return { kicked: target };
  }

  /** Transfer host role to another member. */
  transferHost(
    roomId: string,
    currentHostSocketId: string,
    newHostSocketId: string
  ): { oldHost: Member; newHost: Member } | { error: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.hostId !== currentHostSocketId) return { error: 'Only the host can transfer host' };

    const oldHost = room.members.get(currentHostSocketId);
    const newHost = room.members.get(newHostSocketId);
    if (!oldHost || !newHost) return { error: 'Member not found' };

    oldHost.isHost = false;
    newHost.isHost = true;
    room.hostId = newHostSocketId;

    this.addSystemMessage(roomId, `${oldHost.username} transferred host to ${newHost.username}`);
    return { oldHost, newHost };
  }

  /** Rename a member. Ensures uniqueness. */
  renameMember(
    roomId: string,
    socketId: string,
    newUsername: string
  ): { oldName: string; newName: string } | { error: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };

    const member = room.members.get(socketId);
    if (!member) return { error: 'Member not found' };

    const oldName = member.username;
    const finalName = this.ensureUniqueUsername(room, newUsername, socketId);
    member.username = finalName;
    member.color = RoomManager.usernameToColor(finalName);

    this.addSystemMessage(roomId, `${oldName} is now ${finalName}`);
    return { oldName, newName: finalName };
  }

  // ===================== Room Settings =====================

  toggleControl(roomId: string, socketId: string): boolean | { error: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.hostId !== socketId) return { error: 'Only the host can change this' };

    room.everyoneCanControl = !room.everyoneCanControl;
    this.addSystemMessage(
      roomId,
      room.everyoneCanControl
        ? 'Everyone can now control playback'
        : 'Only the host can control playback'
    );
    return room.everyoneCanControl;
  }

  toggleLock(roomId: string, socketId: string): boolean | { error: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.hostId !== socketId) return { error: 'Only the host can lock/unlock' };

    room.locked = !room.locked;
    this.addSystemMessage(roomId, room.locked ? 'Room locked' : 'Room unlocked');
    return room.locked;
  }

  toggleIgnoreSlowViewers(roomId: string, socketId: string): boolean | { error: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.hostId !== socketId) return { error: 'Only the host can change this' };

    room.ignoreSlowViewers = !room.ignoreSlowViewers;
    return room.ignoreSlowViewers;
  }

  // ===================== Playback =====================

  /** Check if a socket has permission to control playback */
  hasPlaybackPermission(roomId: string, socketId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    return room.members.has(socketId);
  }

  /**
   * Update the room's playback state. Before transitioning play/pause,
   * we "freeze" the current position so positionSec reflects reality.
   */
  updatePlayback(roomId: string, updates: Partial<PlaybackState>): PlaybackState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    // If transitioning from playing to paused (or vice versa), freeze position first
    if (updates.isPlaying !== undefined && room.playback.isPlaying && !updates.isPlaying) {
      const elapsed = (Date.now() - room.playback.lastUpdatedAt) / 1000;
      room.playback.positionSec += elapsed;
    }

    room.playback = {
      ...room.playback,
      ...updates,
      lastUpdatedAt: Date.now(),
    };

    return { ...room.playback };
  }

  /** Set the current media item. Resets playback state. */
  setCurrentItem(roomId: string, item: MediaItem | null): PlaybackState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.currentItem = item;
    room.playback = { isPlaying: false, positionSec: 0, lastUpdatedAt: Date.now() };
    room.stalledClients.clear();
    room.skipVotes.clear();
    if (room.stallTimeout) {
      clearTimeout(room.stallTimeout);
      room.stallTimeout = null;
    }

    if (item) {
      this.addSystemMessage(roomId, `Now playing: ${item.title}`);
    }
    return { ...room.playback };
  }

  // ===================== Queue =====================

  addToQueue(roomId: string, item: MediaItem): MediaItem[] | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.queue.push(item);
    return [...room.queue];
  }

  removeFromQueue(roomId: string, itemId: string): MediaItem[] | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.queue = room.queue.filter((i) => i.id !== itemId);
    return [...room.queue];
  }

  reorderQueue(roomId: string, orderedIds: string[]): MediaItem[] | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const itemMap = new Map(room.queue.map((i) => [i.id, i]));
    const reordered: MediaItem[] = [];
    for (const id of orderedIds) {
      const item = itemMap.get(id);
      if (item) reordered.push(item);
    }
    room.queue = reordered;
    return [...room.queue];
  }

  /** Advance to next queue item. Returns the new current item or null. */
  advanceQueue(roomId: string): { item: MediaItem | null; playback: PlaybackState } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    if (room.queue.length === 0) {
      room.currentItem = null;
      room.playback = { isPlaying: false, positionSec: 0, lastUpdatedAt: Date.now() };
      return { item: null, playback: { ...room.playback } };
    }

    const next = room.queue.shift()!;
    room.currentItem = next;
    room.playback = { isPlaying: false, positionSec: 0, lastUpdatedAt: Date.now() };
    room.stalledClients.clear();
    room.skipVotes.clear();

    this.addSystemMessage(roomId, `Now playing: ${next.title}`);
    return { item: next, playback: { ...room.playback } };
  }

  /** Vote to skip the current media. Returns whether enough votes to skip. */
  voteSkip(
    roomId: string,
    socketId: string
  ): { shouldSkip: boolean; votes: number; needed: number } | { error: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (!room.members.has(socketId)) return { error: 'Not in room' };

    room.skipVotes.add(socketId);
    const votes = room.skipVotes.size;
    const needed = Math.ceil(room.members.size / 2);
    const shouldSkip = votes > room.members.size / 2;

    return { shouldSkip, votes, needed };
  }

  // ===================== Buffering Coordination =====================

  /**
   * Handle a client reporting a stall (buffering > 2s).
   * Pauses the room for everyone and sets an 8-second auto-resume timeout.
   */
  handleStall(roomId: string, socketId: string): { paused: boolean; stalledUsername: string } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.ignoreSlowViewers) return null;

    const member = room.members.get(socketId);
    if (!member) return null;

    room.stalledClients.add(socketId);

    // Freeze playback position and pause
    if (room.playback.isPlaying) {
      const elapsed = (Date.now() - room.playback.lastUpdatedAt) / 1000;
      room.playback.positionSec += elapsed;
      room.playback.isPlaying = false;
      room.playback.lastUpdatedAt = Date.now();
    }

    // Auto-resume after 8 seconds even if the stalled client isn't ready
    if (room.stallTimeout) clearTimeout(room.stallTimeout);
    room.stallTimeout = setTimeout(() => {
      room.stalledClients.clear();
      room.stallTimeout = null;
      if (this.onStallTimeout) this.onStallTimeout(roomId);
    }, 8000);

    return { paused: true, stalledUsername: member.username };
  }

  /** Handle a client reporting it's ready after buffering. */
  handleReady(roomId: string, socketId: string): { allReady: boolean } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.stalledClients.delete(socketId);
    const allReady = room.stalledClients.size === 0;

    if (allReady && room.stallTimeout) {
      clearTimeout(room.stallTimeout);
      room.stallTimeout = null;
    }

    return { allReady };
  }

  // ===================== Chat =====================

  /** Add a user chat message. Rate-limited. */
  addChatMessage(
    roomId: string,
    socketId: string,
    content: string
  ): ChatMessage | { error: string } {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };

    const member = room.members.get(socketId);
    if (!member) return { error: 'Not in room' };

    if (!this.checkRateLimit(socketId, 'chat')) {
      return { error: "Slow down! You're sending messages too quickly." };
    }

    const sanitized = RoomManager.sanitizeHtml(content).trim();
    if (!sanitized || sanitized.length > 1000) {
      return { error: 'Invalid message' };
    }

    const message: ChatMessage = {
      id: uuidv4(),
      userId: socketId,
      username: member.username,
      color: member.color,
      content: sanitized,
      timestamp: Date.now(),
      isSystem: false,
    };

    room.messages.push(message);
    if (room.messages.length > MAX_MESSAGES) {
      room.messages = room.messages.slice(-MAX_MESSAGES);
    }

    return message;
  }

  /** Add a system message (join/leave/rename etc.) */
  addSystemMessage(roomId: string, content: string): ChatMessage | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const message: ChatMessage = {
      id: uuidv4(),
      userId: 'system',
      username: 'System',
      color: 'hsl(220, 10%, 50%)',
      content,
      timestamp: Date.now(),
      isSystem: true,
    };

    room.messages.push(message);
    if (room.messages.length > MAX_MESSAGES) {
      room.messages = room.messages.slice(-MAX_MESSAGES);
    }

    return message;
  }

  /** Check reaction rate limit */
  checkReactionRateLimit(socketId: string): boolean {
    return this.checkRateLimit(socketId, 'reaction');
  }

  // ===================== Queries =====================

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /** Find which room a socket is currently in */
  findRoomBySocket(socketId: string): string | null {
    for (const [roomId, room] of this.rooms) {
      if (room.members.has(socketId)) return roomId;
    }
    return null;
  }

  /** Get a JSON-serializable snapshot of a room for sending to clients */
  getSnapshot(roomId: string): RoomSnapshot | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    return {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      everyoneCanControl: room.everyoneCanControl,
      locked: room.locked,
      ignoreSlowViewers: room.ignoreSlowViewers,
      members: Array.from(room.members.values()),
      queue: room.queue,
      currentItem: room.currentItem,
      playback: { ...room.playback },
      messages: room.messages,
      serverTime: Date.now(),
    };
  }

  /** Update arbitrary member fields (e.g., muted/camera state) */
  updateMember(roomId: string, socketId: string, updates: Partial<Member>): Member | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const member = room.members.get(socketId);
    if (!member) return null;

    Object.assign(member, updates);
    return member;
  }

  // ===================== Private Helpers =====================

  /** Ensure a username is unique within a room by appending a number suffix if needed */
  private ensureUniqueUsername(room: Room, requested: string, excludeSocketId?: string): string {
    const existing = new Set<string>();
    for (const [sid, member] of room.members) {
      if (sid !== excludeSocketId) {
        existing.add(member.username.toLowerCase());
      }
    }

    let name = requested;
    let suffix = 2;
    while (existing.has(name.toLowerCase())) {
      name = `${requested}${suffix}`;
      suffix++;
    }
    return name;
  }

  /**
   * Promote the longest-present member to host.
   * Called when the current host disconnects.
   * RULE: Never leave a room hostless.
   */
  private promoteNewHost(room: Room): Member | null {
    let earliest: Member | null = null;
    for (const member of room.members.values()) {
      if (!earliest || member.joinedAt < earliest.joinedAt) {
        earliest = member;
      }
    }
    if (earliest) {
      earliest.isHost = true;
      room.hostId = earliest.id;
      this.addSystemMessage(room.id, `${earliest.username} is now the host`);
    }
    return earliest;
  }

  /**
   * Schedule room deletion 60 seconds after last member leaves.
   * Uses a cancellable timer so a quick refresh doesn't destroy the room.
   */
  private scheduleDeletion(roomId: string): void {
    this.cancelDeletionTimer(roomId);
    const timer = setTimeout(() => {
      const room = this.rooms.get(roomId);
      if (room && room.members.size === 0) {
        if (room.stallTimeout) clearTimeout(room.stallTimeout);
        this.rooms.delete(roomId);
        this.kickedUsers.delete(roomId);
        this.deletionTimers.delete(roomId);
        console.log(`[RoomManager] Room ${roomId} deleted (empty for 60s)`);
      }
    }, ROOM_CLEANUP_DELAY_MS);
    this.deletionTimers.set(roomId, timer);
  }

  private cancelDeletionTimer(roomId: string): void {
    const timer = this.deletionTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.deletionTimers.delete(roomId);
    }
  }

  /** Rate limit check for chat or reactions */
  private checkRateLimit(socketId: string, type: 'chat' | 'reaction'): boolean {
    const config = type === 'chat' ? CHAT_RATE_LIMIT : REACTION_RATE_LIMIT;
    const store = type === 'chat' ? this.chatTimestamps : this.reactionTimestamps;

    const now = Date.now();
    let timestamps = store.get(socketId) || [];
    timestamps = timestamps.filter((t) => now - t < config.windowMs);

    if (timestamps.length >= config.max) return false;

    timestamps.push(now);
    store.set(socketId, timestamps);
    return true;
  }

  // ===================== Static Utilities =====================

  /**
   * Deterministic HSL color derived from a hash of the username.
   * Produces vibrant, visually distinct colors for avatar circles.
   */
  static usernameToColor(username: string): string {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
      hash = username.charCodeAt(i) + ((hash << 5) - hash);
      hash = hash & hash; // Convert to 32-bit int
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  }

  /** Escape HTML special characters to prevent XSS in chat messages */
  static sanitizeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
