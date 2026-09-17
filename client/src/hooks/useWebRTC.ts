// ============================================================================
// WebRTC Hook — Peer-to-peer video calling via mesh topology
// ============================================================================
// Key design decisions:
//
// GLARE PREVENTION: The peer with the lexicographically smaller socketId
// always creates the offer. This prevents both sides offering simultaneously,
// which causes WebRTC to enter an unrecoverable state. See initiatorId logic.
//
// ICE CANDIDATE QUEUEING: Candidates that arrive before setRemoteDescription
// completes are buffered in a queue and flushed afterward. Without this,
// random connections fail silently.
//
// CLEANUP: All MediaStreamTracks are stopped, all RTCPeerConnections are
// closed, and all socket listeners are removed on unmount. Leaked camera
// streams (webcam light staying on) are unacceptable.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext';
import { useRoom } from '../context/RoomContext';

const MAX_VIDEO_PEERS = 6;

// ===== STUN/TURN Configuration =====
// Google public STUN servers + clearly marked slot for optional TURN server.
// ~15% of users behind symmetric NATs will need a TURN server (e.g., coturn or Twilio).
const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  // ===== OPTIONAL TURN SERVER =====
  // Uncomment and configure to support users behind symmetric NATs:
  // {
  //   urls: 'turn:your-turn-server.com:3478',
  //   username: 'your-username',
  //   credential: 'your-credential',
  // },
  // {
  //   urls: 'turns:your-turn-server.com:5349',
  //   username: 'your-username',
  //   credential: 'your-credential',
  // },
];

interface PeerConnection {
  pc: RTCPeerConnection;
  peerId: string;
  username: string;
  stream: MediaStream | null;
  // ICE candidates that arrived before setRemoteDescription completed
  pendingCandidates: RTCIceCandidateInit[];
  isRemoteDescriptionSet: boolean;
}

export interface PeerStream {
  peerId: string;
  username: string;
  stream: MediaStream | null;
}

type MediaErrorType = 'permission-denied' | 'no-device' | 'in-use' | 'unknown';

const MEDIA_ERROR_MESSAGES: Record<MediaErrorType, string> = {
  'permission-denied': 'Camera/mic permission was denied. Please allow access in your browser settings.',
  'no-device': 'No camera or microphone found. Please connect a device.',
  'in-use': 'Your camera or microphone is already in use by another application.',
  'unknown': 'Could not access camera/microphone. Please check your device settings.',
};

function classifyMediaError(err: any): MediaErrorType {
  const name = err?.name || '';
  const message = (err?.message || '').toLowerCase();
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'permission-denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'no-device';
  if (name === 'NotReadableError' || name === 'TrackStartError' || message.includes('in use')) return 'in-use';
  return 'unknown';
}

export function useWebRTC() {
  const { socket } = useSocket();
  const { state, addToast } = useRoom();

  const [inCall, setInCall] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peerStreams, setPeerStreams] = useState<PeerStream[]>([]);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');

  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const inCallRef = useRef(false);

  // Enumerate available video devices
  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((d) => d.kind === 'videoinput');
      setVideoDevices(cameras);
    } catch {
      // Silently fail — device enumeration isn't critical
    }
  }, []);

  // ===== Create a peer connection for a specific remote peer =====
  const createPeerConnection = useCallback(
    (peerId: string, peerUsername: string): PeerConnection => {
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const peerConn: PeerConnection = {
        pc,
        peerId,
        username: peerUsername,
        stream: null,
        pendingCandidates: [],
        isRemoteDescriptionSet: false,
      };

      // Add local tracks to the connection
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
      }

      // Handle incoming remote tracks
      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (remoteStream) {
          peerConn.stream = remoteStream;
          setPeerStreams((prev) => {
            const existing = prev.find((p) => p.peerId === peerId);
            if (existing) {
              return prev.map((p) => (p.peerId === peerId ? { ...p, stream: remoteStream } : p));
            }
            return [...prev, { peerId, username: peerUsername, stream: remoteStream }];
          });
        }
      };

      // Send ICE candidates to the remote peer
      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('rtc:ice', { toId: peerId, candidate: event.candidate.toJSON() });
        }
      };

      // Monitor connection state for recovery
      pc.oniceconnectionstatechange = () => {
        const iceState = pc.iceConnectionState;
        console.log(`[WebRTC] ICE state for ${peerUsername}: ${iceState}`);

        if (iceState === 'disconnected') {
          // Wait 3s then attempt ICE restart
          setTimeout(() => {
            if (pc.iceConnectionState === 'disconnected' && inCallRef.current) {
              console.log(`[WebRTC] Attempting ICE restart for ${peerUsername}`);
              pc.restartIce();
              // Re-create offer if we're the initiator
              if (socket && socket.id && socket.id < peerId) {
                pc.createOffer({ iceRestart: true })
                  .then((offer) => pc.setLocalDescription(offer))
                  .then(() => {
                    if (pc.localDescription) {
                      socket.emit('rtc:offer', { toId: peerId, offer: pc.localDescription });
                    }
                  })
                  .catch((err) => console.error('[WebRTC] ICE restart offer error:', err));
              }
            }
          }, 3000);
        } else if (iceState === 'failed') {
          // Tear down and rebuild
          console.log(`[WebRTC] Connection failed for ${peerUsername}, rebuilding...`);
          removePeer(peerId);
          if (inCallRef.current && socket?.id) {
            // Rebuild after a short delay
            setTimeout(() => {
              if (inCallRef.current) {
                const newPeer = createPeerConnection(peerId, peerUsername);
                peersRef.current.set(peerId, newPeer);
                // Initiate if we have the smaller ID
                if (socket.id! < peerId) {
                  initiateOffer(newPeer);
                }
              }
            }, 1000);
          }
        }
      };

      peersRef.current.set(peerId, peerConn);
      return peerConn;
    },
    [socket]
  );

  // ===== Initiate offer (only if we're the deterministic initiator) =====
  const initiateOffer = useCallback(
    async (peerConn: PeerConnection) => {
      try {
        const offer = await peerConn.pc.createOffer();
        await peerConn.pc.setLocalDescription(offer);
        if (socket && peerConn.pc.localDescription) {
          socket.emit('rtc:offer', {
            toId: peerConn.peerId,
            offer: peerConn.pc.localDescription,
          });
        }
      } catch (err) {
        console.error('[WebRTC] Offer creation error:', err);
      }
    },
    [socket]
  );

  // ===== Remove a peer =====
  const removePeer = useCallback((peerId: string) => {
    const peerConn = peersRef.current.get(peerId);
    if (peerConn) {
      peerConn.pc.close();
      peersRef.current.delete(peerId);
      setPeerStreams((prev) => prev.filter((p) => p.peerId !== peerId));
    }
  }, []);

  // ===== Flush queued ICE candidates =====
  const flushPendingCandidates = useCallback(async (peerConn: PeerConnection) => {
    for (const candidate of peerConn.pendingCandidates) {
      try {
        await peerConn.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[WebRTC] Error adding queued ICE candidate:', err);
      }
    }
    peerConn.pendingCandidates = [];
  }, []);

  // ===== Join the call =====
  const joinCall = useCallback(async (audioOnly = false) => {
    if (!socket || !state.roomId) return;

    // Secure context / browser support check
    if (!navigator?.mediaDevices?.getUserMedia) {
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        addToast(
          'Webcam/mic requires HTTPS or localhost. If opening on a phone, use localhost or an HTTPS tunnel.',
          'error'
        );
      } else {
        addToast('Camera & microphone access is not supported by this browser.', 'error');
      }
      return;
    }

    // Check how many are already in the call
    const callMembers = state.members.filter((m) => m.inCall);
    if (callMembers.length >= MAX_VIDEO_PEERS) {
      addToast(
        `Video call is limited to ${MAX_VIDEO_PEERS} participants (mesh bandwidth limits).`,
        'warning'
      );
      return;
    }

    let stream: MediaStream | null = null;
    let cameraActive = !audioOnly;
    let micActive = true;

    if (!audioOnly) {
      // 1. Try full video + audio
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: true,
        });
      } catch (fullErr: any) {
        console.warn('[WebRTC] Full video+audio request failed, trying audio-only fallback:', fullErr);
        // 2. Fallback: Try audio-only if camera is missing or in use
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: true,
          });
          cameraActive = false;
          addToast('Camera not detected. Connected with microphone only.', 'info');
        } catch (audioErr: any) {
          console.warn('[WebRTC] Audio-only fallback failed, trying video-only:', audioErr);
          // 3. Fallback: Try video-only if mic is missing
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'user' },
              audio: false,
            });
            micActive = false;
            addToast('Microphone not detected. Connected with camera only.', 'info');
          } catch (videoErr: any) {
            const errorType = classifyMediaError(fullErr);
            addToast(MEDIA_ERROR_MESSAGES[errorType], 'error');
            console.error('[WebRTC] All media capture attempts failed:', fullErr);
            return;
          }
        }
      }
    } else {
      // User explicitly requested audio-only
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: true,
        });
        cameraActive = false;
      } catch (err: any) {
        const errorType = classifyMediaError(err);
        addToast(MEDIA_ERROR_MESSAGES[errorType], 'error');
        return;
      }
    }

    if (!stream) return;

    localStreamRef.current = stream;
    setLocalStream(stream);
    setInCall(true);
    inCallRef.current = true;
    setIsCameraOn(cameraActive);
    setIsMicOn(micActive);

    await refreshDevices();

    // Tell server and room members
    socket.emit('rtc:join-call', { roomId: state.roomId });
    socket.emit('member:update', {
      roomId: state.roomId,
      updates: { cameraOn: cameraActive, isMuted: !micActive },
    });
  }, [socket, state.roomId, state.members, addToast, refreshDevices]);

  // ===== Leave the call =====
  const leaveCall = useCallback(() => {
    if (!socket || !state.roomId) return;

    inCallRef.current = false;
    setInCall(false);

    // Stop all local tracks (turns off webcam light)
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
      setLocalStream(null);
    }

    // Close all peer connections
    for (const [peerId] of peersRef.current) {
      removePeer(peerId);
    }
    setPeerStreams([]);

    socket.emit('rtc:leave-call', { roomId: state.roomId });
  }, [socket, state.roomId, removePeer]);

  // ===== Toggle camera =====
  const toggleCamera = useCallback(() => {
    if (!localStreamRef.current || !socket || !state.roomId) return;
    const videoTracks = localStreamRef.current.getVideoTracks();
    const newState = !isCameraOn;
    for (const track of videoTracks) {
      track.enabled = newState;
    }
    setIsCameraOn(newState);
    socket.emit('member:update', { roomId: state.roomId, updates: { cameraOn: newState } });
  }, [isCameraOn, socket, state.roomId]);

  // ===== Toggle microphone =====
  const toggleMic = useCallback(() => {
    if (!localStreamRef.current || !socket || !state.roomId) return;
    const audioTracks = localStreamRef.current.getAudioTracks();
    const newState = !isMicOn;
    for (const track of audioTracks) {
      track.enabled = newState;
    }
    setIsMicOn(newState);
    socket.emit('member:update', { roomId: state.roomId, updates: { isMuted: !newState } });
  }, [isMicOn, socket, state.roomId]);

  // ===== Switch camera device =====
  const switchCamera = useCallback(
    async (deviceId: string) => {
      if (!localStreamRef.current) return;

      try {
        // Get new video stream from the selected device
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
          audio: false,
        });

        const newVideoTrack = newStream.getVideoTracks()[0];
        const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];

        // Replace track in local stream
        if (oldVideoTrack) {
          localStreamRef.current.removeTrack(oldVideoTrack);
          oldVideoTrack.stop();
        }
        localStreamRef.current.addTrack(newVideoTrack);

        // Replace track in all peer connections
        for (const [, peerConn] of peersRef.current) {
          const sender = peerConn.pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) {
            await sender.replaceTrack(newVideoTrack);
          }
        }

        setCurrentDeviceId(deviceId);
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      } catch (err) {
        console.error('[WebRTC] Switch camera error:', err);
        addToast('Failed to switch camera.', 'error');
      }
    },
    [addToast]
  );

  // ===== Socket event handlers for signaling =====
  useEffect(() => {
    if (!socket) return;

    // When we join, server tells us who's already in the call
    const handleCurrentPeers = (data: { peers: { peerId: string; username: string }[] }) => {
      if (!inCallRef.current) return;

      for (const peer of data.peers) {
        if (peersRef.current.has(peer.peerId)) continue;

        const peerConn = createPeerConnection(peer.peerId, peer.username);

        // GLARE PREVENTION: Deterministic initiator selection.
        // The peer with the lexicographically smaller socketId always creates the offer.
        if (socket.id! < peer.peerId) {
          initiateOffer(peerConn);
        }
        // Otherwise, wait for the other peer to send us an offer
      }
    };

    // A new peer joins the call
    const handlePeerJoined = (data: { peerId: string; username: string }) => {
      if (!inCallRef.current || data.peerId === socket.id) return;
      if (peersRef.current.has(data.peerId)) return;

      const peerConn = createPeerConnection(data.peerId, data.username);

      // GLARE PREVENTION: Same rule
      if (socket.id! < data.peerId) {
        initiateOffer(peerConn);
      }
    };

    // A peer left the call
    const handlePeerLeft = (data: { peerId: string }) => {
      removePeer(data.peerId);
    };

    // Received an offer
    const handleOffer = async (data: { fromId: string; offer: RTCSessionDescriptionInit }) => {
      if (!inCallRef.current) return;

      try {
        let peerConn = peersRef.current.get(data.fromId);
        if (!peerConn) {
          // Create connection if we don't have one yet
          const member = state.members.find((m) => m.id === data.fromId);
          peerConn = createPeerConnection(data.fromId, member?.username || 'Peer');
        }

        await peerConn.pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        peerConn.isRemoteDescriptionSet = true;

        // Flush any ICE candidates that arrived before the remote description
        await flushPendingCandidates(peerConn);

        const answer = await peerConn.pc.createAnswer();
        await peerConn.pc.setLocalDescription(answer);

        socket.emit('rtc:answer', { toId: data.fromId, answer: peerConn.pc.localDescription! });
      } catch (err) {
        console.error('[WebRTC] Handle offer error:', err);
      }
    };

    // Received an answer
    const handleAnswer = async (data: { fromId: string; answer: RTCSessionDescriptionInit }) => {
      try {
        const peerConn = peersRef.current.get(data.fromId);
        if (!peerConn) return;

        await peerConn.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        peerConn.isRemoteDescriptionSet = true;

        // Flush queued ICE candidates
        await flushPendingCandidates(peerConn);
      } catch (err) {
        console.error('[WebRTC] Handle answer error:', err);
      }
    };

    // Received an ICE candidate
    const handleIce = async (data: { fromId: string; candidate: RTCIceCandidateInit }) => {
      try {
        const peerConn = peersRef.current.get(data.fromId);
        if (!peerConn) return;

        // ICE CANDIDATE QUEUEING: If setRemoteDescription hasn't completed yet,
        // queue the candidate. Otherwise, add it immediately.
        if (!peerConn.isRemoteDescriptionSet) {
          peerConn.pendingCandidates.push(data.candidate);
        } else {
          await peerConn.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (err) {
        console.error('[WebRTC] Handle ICE error:', err);
      }
    };

    socket.on('rtc:current-peers', handleCurrentPeers);
    socket.on('rtc:peer-joined', handlePeerJoined);
    socket.on('rtc:peer-left', handlePeerLeft);
    socket.on('rtc:offer', handleOffer);
    socket.on('rtc:answer', handleAnswer);
    socket.on('rtc:ice', handleIce);

    return () => {
      socket.off('rtc:current-peers', handleCurrentPeers);
      socket.off('rtc:peer-joined', handlePeerJoined);
      socket.off('rtc:peer-left', handlePeerLeft);
      socket.off('rtc:offer', handleOffer);
      socket.off('rtc:answer', handleAnswer);
      socket.off('rtc:ice', handleIce);
    };
  }, [socket, state.members, createPeerConnection, initiateOffer, removePeer, flushPendingCandidates]);

  // ===== Cleanup on unmount: stop all tracks and close all connections =====
  useEffect(() => {
    return () => {
      // Stop local stream tracks (turns off webcam light)
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          track.stop();
        }
      }
      // Close all peer connections
      for (const [, peerConn] of peersRef.current) {
        peerConn.pc.close();
      }
      peersRef.current.clear();
    };
  }, []);

  return {
    inCall,
    localStream,
    peerStreams,
    isCameraOn,
    isMicOn,
    videoDevices,
    currentDeviceId,
    joinCall,
    leaveCall,
    toggleCamera,
    toggleMic,
    switchCamera,
  };
}
