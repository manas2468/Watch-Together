// ============================================================================
// WebRTC Context — Room-level real-time audio/video calling
// ============================================================================
// Lifted to room context level so tab switching (Chat, Queue, Members)
// never unmounts the call or drops peer connections.

import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { useSocket } from './SocketContext';
import { useRoom } from './RoomContext';

const MAX_VIDEO_PEERS = 8;

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

interface PeerConnection {
  pc: RTCPeerConnection;
  peerId: string;
  username: string;
  stream: MediaStream | null;
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
  'permission-denied': 'Camera/mic permission was denied. Please allow access in browser settings.',
  'no-device': 'No camera or microphone found. Please connect a device.',
  'in-use': 'Your camera or microphone is in use by another application.',
  'unknown': 'Could not access camera/microphone. Please check permissions.',
};

function classifyMediaError(err: any): MediaErrorType {
  const name = err?.name || '';
  const message = (err?.message || '').toLowerCase();
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'permission-denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'no-device';
  if (name === 'NotReadableError' || name === 'TrackStartError' || message.includes('in use')) return 'in-use';
  return 'unknown';
}

interface WebRTCContextValue {
  inCall: boolean;
  localStream: MediaStream | null;
  peerStreams: PeerStream[];
  isCameraOn: boolean;
  isMicOn: boolean;
  videoDevices: MediaDeviceInfo[];
  currentDeviceId: string;
  isFloating: boolean;
  setIsFloating: (floating: boolean) => void;
  isMinimized: boolean;
  setIsMinimized: (minimized: boolean) => void;
  joinCall: (audioOnly?: boolean) => Promise<void>;
  leaveCall: () => void;
  toggleCamera: () => void;
  toggleMic: () => void;
  switchCamera: (deviceId: string) => Promise<void>;
}

const WebRTCContext = createContext<WebRTCContextValue | null>(null);

export function useWebRTCContext() {
  const ctx = useContext(WebRTCContext);
  if (!ctx) {
    throw new Error('useWebRTCContext must be used within a WebRTCProvider');
  }
  return ctx;
}

export function WebRTCProvider({ children }: { children: React.ReactNode }) {
  const { socket } = useSocket();
  const { state, addToast } = useRoom();

  const [inCall, setInCall] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peerStreams, setPeerStreams] = useState<PeerStream[]>([]);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isMicOn, setIsMicOn] = useState(true);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string>('');
  const [isFloating, setIsFloating] = useState(true); // Default to floating window for faces
  const [isMinimized, setIsMinimized] = useState(false);

  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const earlyCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const inCallRef = useRef(false);

  // Refresh available video devices
  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator?.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((d) => d.kind === 'videoinput');
      setVideoDevices(cameras);
    } catch {
      // Ignored
    }
  }, []);

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

  const removePeer = useCallback((peerId: string) => {
    earlyCandidatesRef.current.delete(peerId);
    const peerConn = peersRef.current.get(peerId);
    if (peerConn) {
      try {
        peerConn.pc.close();
      } catch {}
      peersRef.current.delete(peerId);
      setPeerStreams((prev) => prev.filter((p) => p.peerId !== peerId));
    }
  }, []);

  // Create peer connection
  const createPeerConnection = useCallback(
    (peerId: string, peerUsername: string): PeerConnection => {
      // If one already exists, close it
      const existing = peersRef.current.get(peerId);
      if (existing) {
        try {
          existing.pc.close();
        } catch {}
      }

      const early = earlyCandidatesRef.current.get(peerId) || [];
      earlyCandidatesRef.current.delete(peerId);

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const peerConn: PeerConnection = {
        pc,
        peerId,
        username: peerUsername,
        stream: null,
        pendingCandidates: [...early],
        isRemoteDescriptionSet: false,
      };

      // Add all local tracks
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
      }

      // Track handler: ensure tracks are attached even if event.streams[0] is absent
      pc.ontrack = (event) => {
        let stream = event.streams && event.streams[0];
        if (!stream) {
          if (!peerConn.stream) {
            peerConn.stream = new MediaStream();
          }
          peerConn.stream.addTrack(event.track);
          stream = peerConn.stream;
        } else {
          peerConn.stream = stream;
        }

        // When track un-mutes (RTP video packets start flowing), force state update
        event.track.onunmute = () => {
          setPeerStreams((prev) => [...prev]);
        };

        const currentStream = stream;
        setPeerStreams((prev) => {
          const index = prev.findIndex((p) => p.peerId === peerId);
          if (index >= 0) {
            const copy = [...prev];
            copy[index] = { peerId, username: peerUsername, stream: currentStream };
            return copy;
          }
          return [...prev, { peerId, username: peerUsername, stream: currentStream }];
        });
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('rtc:ice', { toId: peerId, candidate: event.candidate.toJSON() });
        }
      };

      pc.oniceconnectionstatechange = () => {
        const stateStr = pc.iceConnectionState;
        if (stateStr === 'failed') {
          console.warn(`[WebRTC] Connection failed for ${peerUsername}, attempting reconnect...`);
          removePeer(peerId);
          if (inCallRef.current && socket?.id) {
            setTimeout(() => {
              if (inCallRef.current) {
                const newPeer = createPeerConnection(peerId, peerUsername);
                peersRef.current.set(peerId, newPeer);
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
    [socket, removePeer, initiateOffer]
  );

  // Join call
  const joinCall = useCallback(
    async (audioOnly = false) => {
      if (!socket || !state.roomId) return;

      if (!navigator?.mediaDevices?.getUserMedia) {
        addToast('Camera & microphone access is not available in this environment.', 'error');
        return;
      }

      const inCallCount = state.members.filter((m) => m.inCall).length;
      if (inCallCount >= MAX_VIDEO_PEERS) {
        addToast(`Video call is limited to ${MAX_VIDEO_PEERS} active participants.`, 'warning');
        return;
      }

      let stream: MediaStream | null = null;
      let cameraActive = !audioOnly;
      let micActive = true;

      if (!audioOnly) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
            audio: { echoCancellation: true, noiseSuppression: true },
          });
        } catch (err1: any) {
          console.warn('[WebRTC] Full video+audio failed, trying audio-only:', err1);
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: false,
              audio: { echoCancellation: true, noiseSuppression: true },
            });
            cameraActive = false;
            addToast('Camera not detected. Joined with microphone only.', 'info');
          } catch (err2: any) {
            console.warn('[WebRTC] Audio-only failed, trying video-only:', err2);
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' },
                audio: false,
              });
              micActive = false;
              addToast('Microphone not detected. Joined with camera only.', 'info');
            } catch (err3: any) {
              const msg = MEDIA_ERROR_MESSAGES[classifyMediaError(err1)];
              addToast(msg, 'error');
              return;
            }
          }
        }
      } else {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          cameraActive = false;
        } catch (err: any) {
          const msg = MEDIA_ERROR_MESSAGES[classifyMediaError(err)];
          addToast(msg, 'error');
          return;
        }
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsCameraOn(cameraActive);
      setIsMicOn(micActive);
      inCallRef.current = true;
      setInCall(true);
      setIsFloating(true); // Open floating faces window

      await refreshDevices();

      socket.emit('rtc:join-call', {
        roomId: state.roomId,
        cameraOn: cameraActive,
        isMuted: !micActive,
      });
      socket.emit('member:update', {
        roomId: state.roomId,
        updates: { inCall: true, cameraOn: cameraActive, isMuted: !micActive },
      });
    },
    [socket, state.roomId, state.members, addToast, refreshDevices]
  );

  // Leave call
  const leaveCall = useCallback(() => {
    if (!socket || !state.roomId) return;

    inCallRef.current = false;
    setInCall(false);

    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
      setLocalStream(null);
    }

    for (const [peerId] of peersRef.current) {
      removePeer(peerId);
    }
    peersRef.current.clear();
    setPeerStreams([]);

    socket.emit('rtc:leave-call', { roomId: state.roomId });
    socket.emit('member:update', {
      roomId: state.roomId,
      updates: { inCall: false, cameraOn: false, isMuted: true },
    });
  }, [socket, state.roomId, removePeer]);

  // Toggle camera
  const toggleCamera = useCallback(async () => {
    if (!socket || !state.roomId) return;

    if (!localStreamRef.current) return;

    const videoTracks = localStreamRef.current.getVideoTracks();

    // If no video tracks exist yet (e.g. joined with voice only), acquire camera track
    if (videoTracks.length === 0) {
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        const newTrack = newStream.getVideoTracks()[0];
        if (newTrack) {
          localStreamRef.current.addTrack(newTrack);
          setIsCameraOn(true);
          setLocalStream(new MediaStream(localStreamRef.current.getTracks()));

          // Add video track to all active peer connections
          for (const [, peerConn] of peersRef.current) {
            peerConn.pc.addTrack(newTrack, localStreamRef.current);
            if (socket.id! < peerConn.peerId) {
              initiateOffer(peerConn);
            }
          }

          socket.emit('member:update', { roomId: state.roomId, updates: { cameraOn: true } });
        }
      } catch (err) {
        console.error('[WebRTC] Failed to acquire camera on toggle:', err);
        addToast('Could not access camera. Please check camera permissions.', 'error');
      }
      return;
    }

    // Toggle existing track enabled state
    const newState = !isCameraOn;
    for (const track of videoTracks) {
      track.enabled = newState;
    }
    setIsCameraOn(newState);
    setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
    socket.emit('member:update', { roomId: state.roomId, updates: { cameraOn: newState } });
  }, [isCameraOn, socket, state.roomId, addToast, initiateOffer]);

  // Toggle mic
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

  // Switch camera
  const switchCamera = useCallback(
    async (deviceId: string) => {
      if (!localStreamRef.current) return;
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceId } },
          audio: false,
        });

        const newTrack = newStream.getVideoTracks()[0];
        const oldTrack = localStreamRef.current.getVideoTracks()[0];

        if (oldTrack) {
          localStreamRef.current.removeTrack(oldTrack);
          oldTrack.stop();
        }
        localStreamRef.current.addTrack(newTrack);

        for (const [, peerConn] of peersRef.current) {
          const sender = peerConn.pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) {
            await sender.replaceTrack(newTrack);
          }
        }

        setCurrentDeviceId(deviceId);
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      } catch (err) {
        console.error('[WebRTC] switchCamera error:', err);
      }
    },
    []
  );

  // Signaling socket event listeners
  useEffect(() => {
    if (!socket) return;

    const handleCurrentPeers = (data: { peers: { peerId: string; username: string }[] }) => {
      if (!inCallRef.current) return;
      for (const peer of data.peers) {
        if (peersRef.current.has(peer.peerId)) continue;
        const peerConn = createPeerConnection(peer.peerId, peer.username);
        // Deterministic glare prevention
        if (socket.id! < peer.peerId) {
          initiateOffer(peerConn);
        }
      }
    };

    const handlePeerJoined = (data: { peerId: string; username: string }) => {
      if (!inCallRef.current || data.peerId === socket.id) return;
      if (peersRef.current.has(data.peerId)) return;
      const peerConn = createPeerConnection(data.peerId, data.username);
      if (socket.id! < data.peerId) {
        initiateOffer(peerConn);
      }
    };

    const handlePeerLeft = (data: { peerId: string }) => {
      removePeer(data.peerId);
    };

    const handleOffer = async (data: { fromId: string; offer: RTCSessionDescriptionInit }) => {
      if (!inCallRef.current) return;
      try {
        let peerConn = peersRef.current.get(data.fromId);
        if (!peerConn) {
          const member = state.members.find((m) => m.id === data.fromId);
          peerConn = createPeerConnection(data.fromId, member?.username || 'Peer');
        }

        await peerConn.pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        peerConn.isRemoteDescriptionSet = true;
        await flushPendingCandidates(peerConn);

        const answer = await peerConn.pc.createAnswer();
        await peerConn.pc.setLocalDescription(answer);

        socket.emit('rtc:answer', { toId: data.fromId, answer: peerConn.pc.localDescription! });
      } catch (err) {
        console.error('[WebRTC] handleOffer error:', err);
      }
    };

    const handleAnswer = async (data: { fromId: string; answer: RTCSessionDescriptionInit }) => {
      try {
        const peerConn = peersRef.current.get(data.fromId);
        if (!peerConn) return;
        await peerConn.pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        peerConn.isRemoteDescriptionSet = true;
        await flushPendingCandidates(peerConn);
      } catch (err) {
        console.error('[WebRTC] handleAnswer error:', err);
      }
    };

    const handleIce = async (data: { fromId: string; candidate: RTCIceCandidateInit }) => {
      try {
        const peerConn = peersRef.current.get(data.fromId);
        if (!peerConn) {
          // Peer connection not yet created: buffer candidate so it is never dropped
          const queue = earlyCandidatesRef.current.get(data.fromId) || [];
          queue.push(data.candidate);
          earlyCandidatesRef.current.set(data.fromId, queue);
          return;
        }
        if (!peerConn.isRemoteDescriptionSet) {
          peerConn.pendingCandidates.push(data.candidate);
        } else {
          await peerConn.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
      } catch (err) {
        console.error('[WebRTC] handleIce error:', err);
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

  // Clean up when leaving room
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          track.stop();
        }
      }
      for (const [, peerConn] of peersRef.current) {
        try {
          peerConn.pc.close();
        } catch {}
      }
      peersRef.current.clear();
    };
  }, []);

  return (
    <WebRTCContext.Provider
      value={{
        inCall,
        localStream,
        peerStreams,
        isCameraOn,
        isMicOn,
        videoDevices,
        currentDeviceId,
        isFloating,
        setIsFloating,
        isMinimized,
        setIsMinimized,
        joinCall,
        leaveCall,
        toggleCamera,
        toggleMic,
        switchCamera,
      }}
    >
      {children}
    </WebRTCContext.Provider>
  );
}
