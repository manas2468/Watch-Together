// ============================================================================
// Watch Together — Socket.IO Event Handlers
// ============================================================================
// Every socket event handler is wrapped in try/catch. One bad event must never
// crash the server. All handlers validate: room exists, sender is a member,
// sender has permission, and payload shape is correct.

import { Server, Socket } from 'socket.io';
import { RoomManager } from '../rooms/RoomManager';
import { MediaItem } from '../rooms/types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Register all Socket.IO event handlers.
 * Called once when the server starts.
 */
export function registerSocketHandlers(io: Server, roomManager: RoomManager): void {

  // ----- Stall timeout callback -----
  // When the 8-second stall timeout fires, resume playback for the room.
  roomManager.onStallTimeout = (roomId: string) => {
    const room = roomManager.getRoom(roomId);
    if (!room) return;

    const playback = roomManager.updatePlayback(roomId, { isPlaying: true });
    if (playback) {
      io.to(roomId).emit('playback:update', { playback, reason: 'stall-timeout' });
      io.to(roomId).emit('toast', { message: 'Resuming playback (timeout)', type: 'info' });
    }
  };

  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ========================= Clock Sync =========================
    // NTP-style clock offset handshake. Client sends 3 pings, takes the
    // sample with the lowest RTT to compute offset. Critical for sync.
    socket.on('sync:ping', (data: { clientTime: number }, callback) => {
      try {
        if (typeof callback === 'function') {
          callback({ clientTime: data?.clientTime, serverTime: Date.now() });
        }
      } catch (err) {
        console.error('[Socket] sync:ping error:', err);
      }
    });

    // ========================= Room CRUD =========================

    socket.on('room:create', (data: { name?: string; username: string }, callback) => {
      try {
        if (typeof callback !== 'function') return;
        const username = data?.username?.trim();
        if (!username || username.length < 2 || username.length > 20) {
          return callback({ error: 'Username must be 2–20 characters.' });
        }
        const name = data?.name?.trim() || '';

        const room = roomManager.createRoom(name, socket.id, username);
        socket.join(room.id);

        const snapshot = roomManager.getSnapshot(room.id);
        callback({ room: snapshot });
        console.log(`[Room] Created ${room.id} by ${username}`);
      } catch (err) {
        console.error('[Socket] room:create error:', err);
        if (typeof callback === 'function') callback({ error: 'Failed to create room.' });
      }
    });

    socket.on('room:join', (data: { roomId: string; username: string }, callback) => {
      try {
        if (typeof callback !== 'function') return;
        const roomId = data?.roomId?.toUpperCase()?.trim();
        const username = data?.username?.trim();

        if (!roomId || typeof roomId !== 'string') {
          return callback({ error: 'Invalid room code.' });
        }
        if (!username || username.length < 2 || username.length > 20) {
          return callback({ error: 'Username must be 2–20 characters.' });
        }

        const result = roomManager.joinRoom(roomId, socket.id, username);
        if ('error' in result) return callback({ error: result.error });

        socket.join(result.room.id);
        const snapshot = roomManager.getSnapshot(result.room.id);
        callback({ room: snapshot, member: result.member });

        // Broadcast the join to other members
        socket.to(result.room.id).emit('member:joined', { member: result.member });
        const lastMsg = result.room.messages[result.room.messages.length - 1];
        if (lastMsg?.isSystem) {
          socket.to(result.room.id).emit('chat:message', lastMsg);
        }

        console.log(`[Room] ${result.member.username} joined ${roomId}`);
      } catch (err) {
        console.error('[Socket] room:join error:', err);
        if (typeof callback === 'function') callback({ error: 'Failed to join room.' });
      }
    });

    socket.on('room:rejoin', (data: { roomId: string; username: string }, callback) => {
      try {
        if (typeof callback !== 'function') return;
        const roomId = data?.roomId?.toUpperCase()?.trim();
        const username = data?.username?.trim();

        if (!roomId || !username) return callback({ error: 'Invalid rejoin data.' });

        const result = roomManager.rejoinRoom(roomId, socket.id, username);
        if ('error' in result) return callback({ error: result.error });

        socket.join(result.room.id);
        const snapshot = roomManager.getSnapshot(result.room.id);
        callback({ room: snapshot });

        socket.to(result.room.id).emit('member:joined', { member: result.member });
        const lastMsg = result.room.messages[result.room.messages.length - 1];
        if (lastMsg?.isSystem) {
          socket.to(result.room.id).emit('chat:message', lastMsg);
        }

        console.log(`[Room] ${username} rejoined ${roomId}`);
      } catch (err) {
        console.error('[Socket] room:rejoin error:', err);
        if (typeof callback === 'function') callback({ error: 'Failed to rejoin room.' });
      }
    });

    socket.on('room:leave', () => {
      try {
        handleDisconnect(socket, io, roomManager);
      } catch (err) {
        console.error('[Socket] room:leave error:', err);
      }
    });

    // ========================= Chat =========================

    socket.on('chat:message', (data: { roomId: string; content: string }) => {
      try {
        const { roomId, content } = data || {};
        if (!roomId || !content || typeof content !== 'string') return;

        const result = roomManager.addChatMessage(roomId, socket.id, content);
        if ('error' in result) {
          socket.emit('toast', { message: result.error, type: 'error' });
          return;
        }

        io.to(roomId).emit('chat:message', result);
      } catch (err) {
        console.error('[Socket] chat:message error:', err);
      }
    });

    socket.on('chat:reaction', (data: { roomId: string; emoji: string }) => {
      try {
        const { roomId, emoji } = data || {};
        if (!roomId || !emoji || typeof emoji !== 'string') return;

        const room = roomManager.getRoom(roomId);
        if (!room || !room.members.has(socket.id)) return;

        if (!roomManager.checkReactionRateLimit(socket.id)) {
          socket.emit('toast', { message: 'Slow down on reactions!', type: 'error' });
          return;
        }

        const member = room.members.get(socket.id)!;
        io.to(roomId).emit('chat:reaction', {
          id: uuidv4(),
          emoji,
          username: member.username,
        });
      } catch (err) {
        console.error('[Socket] chat:reaction error:', err);
      }
    });

    // ========================= Member Management =========================

    socket.on('member:rename', (data: { roomId: string; newUsername: string }, callback) => {
      try {
        if (typeof callback !== 'function') return;
        const { roomId, newUsername } = data || {};
        if (!roomId || !newUsername || newUsername.trim().length < 2 || newUsername.trim().length > 20) {
          return callback({ error: 'Username must be 2–20 characters.' });
        }

        const result = roomManager.renameMember(roomId, socket.id, newUsername.trim());
        if ('error' in result) return callback({ error: result.error });

        callback({ newName: result.newName });

        const snapshot = roomManager.getSnapshot(roomId);
        io.to(roomId).emit('room:update', { members: snapshot?.members });
        const lastMsg = roomManager.getRoom(roomId)?.messages.slice(-1)[0];
        if (lastMsg?.isSystem) io.to(roomId).emit('chat:message', lastMsg);
      } catch (err) {
        console.error('[Socket] member:rename error:', err);
        if (typeof callback === 'function') callback({ error: 'Failed to rename.' });
      }
    });

    socket.on('member:kick', (data: { roomId: string; targetId: string }, callback) => {
      try {
        if (typeof callback !== 'function') return;
        const { roomId, targetId } = data || {};
        if (!roomId || !targetId) return callback({ error: 'Invalid data.' });

        const result = roomManager.kickMember(roomId, socket.id, targetId);
        if ('error' in result) return callback({ error: result.error });

        callback({ success: true });

        // Notify the kicked user
        io.to(targetId).emit('room:kicked', { message: 'You were kicked by the host.' });
        // Force the kicked socket to leave the room
        const kickedSocket = io.sockets.sockets.get(targetId);
        if (kickedSocket) kickedSocket.leave(roomId);

        // Update everyone
        const snapshot = roomManager.getSnapshot(roomId);
        io.to(roomId).emit('room:update', { members: snapshot?.members });
        const lastMsg = roomManager.getRoom(roomId)?.messages.slice(-1)[0];
        if (lastMsg?.isSystem) io.to(roomId).emit('chat:message', lastMsg);
      } catch (err) {
        console.error('[Socket] member:kick error:', err);
        if (typeof callback === 'function') callback({ error: 'Failed to kick.' });
      }
    });

    socket.on('member:transfer-host', (data: { roomId: string; targetId: string }, callback) => {
      try {
        if (typeof callback !== 'function') return;
        const { roomId, targetId } = data || {};
        if (!roomId || !targetId) return callback({ error: 'Invalid data.' });

        const result = roomManager.transferHost(roomId, socket.id, targetId);
        if ('error' in result) return callback({ error: result.error });

        callback({ success: true });

        const snapshot = roomManager.getSnapshot(roomId);
        io.to(roomId).emit('room:update', {
          members: snapshot?.members,
          hostId: snapshot?.hostId,
        });
        const lastMsg = roomManager.getRoom(roomId)?.messages.slice(-1)[0];
        if (lastMsg?.isSystem) io.to(roomId).emit('chat:message', lastMsg);
      } catch (err) {
        console.error('[Socket] member:transfer-host error:', err);
        if (typeof callback === 'function') callback({ error: 'Failed to transfer host.' });
      }
    });

    // ========================= Room Settings =========================

    socket.on('room:toggle-control', (data: { roomId: string }, callback) => {
      try {
        if (typeof callback !== 'function') return;
        const { roomId } = data || {};
        if (!roomId) return callback({ error: 'Invalid data.' });

        const result = roomManager.toggleControl(roomId, socket.id);
        if (typeof result === 'object' && 'error' in result) return callback({ error: result.error });

        callback({ everyoneCanControl: result });
        io.to(roomId).emit('room:update', { everyoneCanControl: result });
        const lastMsg = roomManager.getRoom(roomId)?.messages.slice(-1)[0];
        if (lastMsg?.isSystem) io.to(roomId).emit('chat:message', lastMsg);
      } catch (err) {
        console.error('[Socket] room:toggle-control error:', err);
        if (typeof callback === 'function') callback({ error: 'Failed.' });
      }
    });

    socket.on('room:toggle-lock', (data: { roomId: string }, callback) => {
      try {
        if (typeof callback !== 'function') return;
        const { roomId } = data || {};
        if (!roomId) return callback({ error: 'Invalid data.' });

        const result = roomManager.toggleLock(roomId, socket.id);
        if (typeof result === 'object' && 'error' in result) return callback({ error: result.error });

        callback({ locked: result });
        io.to(roomId).emit('room:update', { locked: result });
        const lastMsg = roomManager.getRoom(roomId)?.messages.slice(-1)[0];
        if (lastMsg?.isSystem) io.to(roomId).emit('chat:message', lastMsg);
      } catch (err) {
        console.error('[Socket] room:toggle-lock error:', err);
        if (typeof callback === 'function') callback({ error: 'Failed.' });
      }
    });

    socket.on('room:toggle-ignore-slow', (data: { roomId: string }, callback) => {
      try {
        if (typeof callback !== 'function') return;
        const { roomId } = data || {};
        if (!roomId) return callback({ error: 'Invalid data.' });

        const result = roomManager.toggleIgnoreSlowViewers(roomId, socket.id);
        if (typeof result === 'object' && 'error' in result) return callback({ error: result.error });

        callback({ ignoreSlowViewers: result });
        io.to(roomId).emit('room:update', { ignoreSlowViewers: result });
      } catch (err) {
        console.error('[Socket] room:toggle-ignore-slow error:', err);
        if (typeof callback === 'function') callback({ error: 'Failed.' });
      }
    });

    // ========================= Playback Sync =========================
    // CRITICAL: The server is the single source of truth. Clients emit
    // INTENTS (play, pause, seek). The server validates, updates state,
    // then broadcasts `playback:update` to ALL clients INCLUDING the sender.

    socket.on('playback:play', (data: { roomId: string }) => {
      try {
        const { roomId } = data || {};
        if (!roomId) return;
        if (!roomManager.hasPlaybackPermission(roomId, socket.id)) {
          socket.emit('toast', { message: 'Only the host can control playback.', type: 'error' });
          return;
        }

        const room = roomManager.getRoom(roomId);
        if (room && room.playback.isPlaying) {
          // Already playing, avoid redundant echo
          return;
        }

        const playback = roomManager.updatePlayback(roomId, { isPlaying: true });
        if (playback) {
          io.to(roomId).emit('playback:update', { playback, reason: 'play' });
        }
      } catch (err) {
        console.error('[Socket] playback:play error:', err);
      }
    });

    socket.on('playback:pause', (data: { roomId: string }) => {
      try {
        const { roomId } = data || {};
        if (!roomId) return;
        if (!roomManager.hasPlaybackPermission(roomId, socket.id)) {
          socket.emit('toast', { message: 'Only the host can control playback.', type: 'error' });
          return;
        }

        const room = roomManager.getRoom(roomId);
        if (room && !room.playback.isPlaying) {
          // Already paused, avoid redundant echo
          return;
        }

        const playback = roomManager.updatePlayback(roomId, { isPlaying: false });
        if (playback) {
          io.to(roomId).emit('playback:update', { playback, reason: 'pause' });
        }
      } catch (err) {
        console.error('[Socket] playback:pause error:', err);
      }
    });

    socket.on('playback:seek', (data: { roomId: string; positionSec: number }) => {
      try {
        const { roomId, positionSec } = data || {};
        if (!roomId || typeof positionSec !== 'number' || positionSec < 0) return;
        if (!roomManager.hasPlaybackPermission(roomId, socket.id)) {
          socket.emit('toast', { message: 'Only the host can control playback.', type: 'error' });
          return;
        }

        const playback = roomManager.updatePlayback(roomId, { positionSec });
        if (playback) {
          io.to(roomId).emit('playback:update', { playback, reason: 'seek' });
        }
      } catch (err) {
        console.error('[Socket] playback:seek error:', err);
      }
    });

    // Buffering coordination
    socket.on('playback:stall', (data: { roomId: string }) => {
      try {
        const { roomId } = data || {};
        if (!roomId) return;

        const result = roomManager.handleStall(roomId, socket.id);
        if (result) {
          const room = roomManager.getRoom(roomId);
          if (room) {
            io.to(roomId).emit('playback:update', { playback: { ...room.playback }, reason: 'stall' });
            io.to(roomId).emit('toast', {
              message: `Waiting for ${result.stalledUsername}…`,
              type: 'info',
            });
          }
        }
      } catch (err) {
        console.error('[Socket] playback:stall error:', err);
      }
    });

    socket.on('playback:ready', (data: { roomId: string }) => {
      try {
        const { roomId } = data || {};
        if (!roomId) return;

        const result = roomManager.handleReady(roomId, socket.id);
        if (result?.allReady) {
          const playback = roomManager.updatePlayback(roomId, { isPlaying: true });
          if (playback) {
            io.to(roomId).emit('playback:update', { playback, reason: 'ready' });
            io.to(roomId).emit('toast', { message: 'All viewers ready. Resuming!', type: 'success' });
          }
        }
      } catch (err) {
        console.error('[Socket] playback:ready error:', err);
      }
    });

    // ========================= Media / Queue =========================

    socket.on('media:load', (data: { roomId: string; item: MediaItem }) => {
      try {
        const { roomId, item } = data || {};
        if (!roomId || !item) return;
        if (!roomManager.hasPlaybackPermission(roomId, socket.id)) {
          socket.emit('toast', { message: 'Only the host can change media.', type: 'error' });
          return;
        }

        const room = roomManager.getRoom(roomId);
        if (!room) return;

        const member = room.members.get(socket.id);
        const mediaItem: MediaItem = {
          id: item.id || uuidv4(),
          type: item.type,
          url: item.url,
          title: item.title || 'Untitled',
          addedBy: member?.username || 'Unknown',
          duration: item.duration ?? null,
        };

        const playback = roomManager.setCurrentItem(roomId, mediaItem);
        io.to(roomId).emit('media:changed', {
          currentItem: mediaItem,
          playback,
        });
        const lastMsg = room.messages.slice(-1)[0];
        if (lastMsg?.isSystem) io.to(roomId).emit('chat:message', lastMsg);
      } catch (err) {
        console.error('[Socket] media:load error:', err);
      }
    });

    socket.on('media:ended', (data: { roomId: string }) => {
      try {
        const { roomId } = data || {};
        if (!roomId) return;

        const result = roomManager.advanceQueue(roomId);
        if (result) {
          io.to(roomId).emit('media:changed', {
            currentItem: result.item,
            playback: result.playback,
          });
          io.to(roomId).emit('queue:update', {
            queue: roomManager.getRoom(roomId)?.queue || [],
          });
          if (result.item) {
            const room = roomManager.getRoom(roomId);
            const lastMsg = room?.messages.slice(-1)[0];
            if (lastMsg?.isSystem) io.to(roomId).emit('chat:message', lastMsg);
          }
        }
      } catch (err) {
        console.error('[Socket] media:ended error:', err);
      }
    });

    socket.on('media:next', (data: { roomId: string }) => {
      try {
        const { roomId } = data || {};
        if (!roomId || !roomManager.hasPlaybackPermission(roomId, socket.id)) return;

        const result = roomManager.advanceQueue(roomId);
        if (result) {
          io.to(roomId).emit('media:changed', {
            currentItem: result.item,
            playback: result.playback,
          });
          io.to(roomId).emit('queue:update', {
            queue: roomManager.getRoom(roomId)?.queue || [],
          });
          if (result.item) {
            const room = roomManager.getRoom(roomId);
            const lastMsg = room?.messages.slice(-1)[0];
            if (lastMsg?.isSystem) io.to(roomId).emit('chat:message', lastMsg);
          }
        }
      } catch (err) {
        console.error('[Socket] media:next error:', err);
      }
    });

    socket.on('queue:add', (data: { roomId: string; item: MediaItem }) => {
      try {
        const { roomId, item } = data || {};
        if (!roomId || !item) return;

        const room = roomManager.getRoom(roomId);
        if (!room || !room.members.has(socket.id)) return;

        const member = room.members.get(socket.id)!;
        const mediaItem: MediaItem = {
          id: uuidv4(),
          type: item.type,
          url: item.url,
          title: item.title || 'Untitled',
          addedBy: member.username,
          duration: item.duration ?? null,
        };

        const queue = roomManager.addToQueue(roomId, mediaItem);
        io.to(roomId).emit('queue:update', { queue });

        // If nothing is playing, auto-load the first item
        if (!room.currentItem && queue && queue.length === 1) {
          const result = roomManager.advanceQueue(roomId);
          if (result) {
            io.to(roomId).emit('media:changed', {
              currentItem: result.item,
              playback: result.playback,
            });
            io.to(roomId).emit('queue:update', { queue: room.queue });
          }
        }
      } catch (err) {
        console.error('[Socket] queue:add error:', err);
      }
    });

    socket.on('queue:remove', (data: { roomId: string; itemId: string }) => {
      try {
        const { roomId, itemId } = data || {};
        if (!roomId || !itemId) return;
        if (!roomManager.hasPlaybackPermission(roomId, socket.id)) return;

        const queue = roomManager.removeFromQueue(roomId, itemId);
        io.to(roomId).emit('queue:update', { queue });
      } catch (err) {
        console.error('[Socket] queue:remove error:', err);
      }
    });

    socket.on('queue:reorder', (data: { roomId: string; orderedIds: string[] }) => {
      try {
        const { roomId, orderedIds } = data || {};
        if (!roomId || !Array.isArray(orderedIds)) return;
        if (!roomManager.hasPlaybackPermission(roomId, socket.id)) return;

        const queue = roomManager.reorderQueue(roomId, orderedIds);
        io.to(roomId).emit('queue:update', { queue });
      } catch (err) {
        console.error('[Socket] queue:reorder error:', err);
      }
    });

    socket.on('queue:vote-skip', (data: { roomId: string }) => {
      try {
        const { roomId } = data || {};
        if (!roomId) return;

        const result = roomManager.voteSkip(roomId, socket.id);
        if ('error' in result) return;

        io.to(roomId).emit('queue:skip-vote', { votes: result.votes, needed: result.needed });

        if (result.shouldSkip) {
          const advance = roomManager.advanceQueue(roomId);
          if (advance) {
            io.to(roomId).emit('media:changed', {
              currentItem: advance.item,
              playback: advance.playback,
            });
            io.to(roomId).emit('queue:update', {
              queue: roomManager.getRoom(roomId)?.queue || [],
            });
            io.to(roomId).emit('toast', { message: 'Skipped by vote!', type: 'info' });
          }
        }
      } catch (err) {
        console.error('[Socket] queue:vote-skip error:', err);
      }
    });

    // ========================= WebRTC Signaling =========================
    // Pure relay — the server just forwards offer/answer/ICE between peers.
    // All payloads carry {fromId, toId} for targeted delivery.

    socket.on('rtc:join-call', (data: { roomId: string; cameraOn?: boolean; isMuted?: boolean }) => {
      try {
        const { roomId, cameraOn, isMuted } = data || {};
        if (!roomId) return;

        const member = roomManager.updateMember(roomId, socket.id, {
          inCall: true,
          cameraOn: cameraOn !== undefined ? cameraOn : true,
          isMuted: isMuted !== undefined ? isMuted : false,
        });
        if (!member) return;

        // Notify all other call participants
        socket.to(roomId).emit('rtc:peer-joined', {
          peerId: socket.id,
          username: member.username,
        });

        // Send the joiner a list of current call participants
        const room = roomManager.getRoom(roomId);
        if (room) {
          const callPeers = Array.from(room.members.values())
            .filter((m) => m.inCall && m.id !== socket.id)
            .map((m) => ({ peerId: m.id, username: m.username }));
          socket.emit('rtc:current-peers', { peers: callPeers });
        }

        io.to(roomId).emit('room:update', {
          members: roomManager.getSnapshot(roomId)?.members,
        });
      } catch (err) {
        console.error('[Socket] rtc:join-call error:', err);
      }
    });

    socket.on('rtc:leave-call', (data: { roomId: string }) => {
      try {
        const { roomId } = data || {};
        if (!roomId) return;

        const member = roomManager.updateMember(roomId, socket.id, {
          inCall: false,
          cameraOn: false,
          isMuted: true,
        });
        if (!member) return;

        socket.to(roomId).emit('rtc:peer-left', { peerId: socket.id });
        io.to(roomId).emit('room:update', {
          members: roomManager.getSnapshot(roomId)?.members,
        });
      } catch (err) {
        console.error('[Socket] rtc:leave-call error:', err);
      }
    });

    socket.on('rtc:offer', (data: { toId: string; offer: RTCSessionDescriptionInit }) => {
      try {
        const { toId, offer } = data || {};
        if (!toId || !offer) return;
        io.to(toId).emit('rtc:offer', { fromId: socket.id, offer });
      } catch (err) {
        console.error('[Socket] rtc:offer error:', err);
      }
    });

    socket.on('rtc:answer', (data: { toId: string; answer: RTCSessionDescriptionInit }) => {
      try {
        const { toId, answer } = data || {};
        if (!toId || !answer) return;
        io.to(toId).emit('rtc:answer', { fromId: socket.id, answer });
      } catch (err) {
        console.error('[Socket] rtc:answer error:', err);
      }
    });

    socket.on('rtc:ice', (data: { toId: string; candidate: RTCIceCandidateInit }) => {
      try {
        const { toId, candidate } = data || {};
        if (!toId || !candidate) return;
        io.to(toId).emit('rtc:ice', { fromId: socket.id, candidate });
      } catch (err) {
        console.error('[Socket] rtc:ice error:', err);
      }
    });

    // Member state updates (camera/mic toggles)
    socket.on('member:update', (data: { roomId: string; updates: { isMuted?: boolean; cameraOn?: boolean } }) => {
      try {
        const { roomId, updates } = data || {};
        if (!roomId || !updates) return;

        // Only allow updating own state
        const member = roomManager.updateMember(roomId, socket.id, {
          ...(typeof updates.isMuted === 'boolean' ? { isMuted: updates.isMuted } : {}),
          ...(typeof updates.cameraOn === 'boolean' ? { cameraOn: updates.cameraOn } : {}),
        });
        if (!member) return;

        io.to(roomId).emit('room:update', {
          members: roomManager.getSnapshot(roomId)?.members,
        });
      } catch (err) {
        console.error('[Socket] member:update error:', err);
      }
    });

    // ========================= Disconnect =========================

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] Disconnected: ${socket.id} (${reason})`);
      try {
        handleDisconnect(socket, io, roomManager);
      } catch (err) {
        console.error('[Socket] disconnect error:', err);
      }
    });
  });
}

/**
 * Handle a socket disconnecting. Finds the room, removes the member,
 * handles host succession, and broadcasts updates.
 */
function handleDisconnect(socket: Socket, io: Server, roomManager: RoomManager): void {
  const roomId = roomManager.findRoomBySocket(socket.id);
  if (!roomId) return;

  // If the user was in a call, notify peers
  const room = roomManager.getRoom(roomId);
  const memberBeforeLeave = room?.members.get(socket.id);
  if (memberBeforeLeave?.inCall) {
    socket.to(roomId).emit('rtc:peer-left', { peerId: socket.id });
  }

  const result = roomManager.leaveRoom(roomId, socket.id);
  if (!result.leftMember) return;

  socket.leave(roomId);

  // Broadcast member departure
  socket.to(roomId).emit('member:left', { memberId: socket.id });

  // Broadcast the system message
  const lastMsg = roomManager.getRoom(roomId)?.messages.slice(-1)[0];
  if (lastMsg?.isSystem) {
    io.to(roomId).emit('chat:message', lastMsg);
  }

  // If host changed, broadcast the new host info
  if (result.wasHost && result.newHost) {
    const snapshot = roomManager.getSnapshot(roomId);
    io.to(roomId).emit('room:update', {
      members: snapshot?.members,
      hostId: snapshot?.hostId,
    });
    const hostMsg = roomManager.getRoom(roomId)?.messages.slice(-1)[0];
    if (hostMsg?.isSystem) {
      io.to(roomId).emit('chat:message', hostMsg);
    }
  }
}
