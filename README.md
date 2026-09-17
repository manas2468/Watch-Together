# 🎬 Watch Together

A production-quality full-stack "Watch Together" web application: a synchronized video/audio streaming platform with live chat and peer-to-peer WebRTC video calling. Multiple users join a room, watch content in frame-accurate sync, chat, react with floating emojis, and can turn on their camera/mic to see each other while watching.

---

## 🚀 Features

- **Frame-Accurate Synchronization Engine**:
  - Uses NTP-style ping/pong clock offset estimation to calculate true delta between client and server time.
  - Linear drift compensation:
    - $\Delta < 500\text{ms}$: Silent tolerance (no jitter or abrupt corrections).
    - $500\text{ms} \le \Delta < 2000\text{ms}$: Smooth rate nudging (0.95x - 1.05x playback rate) to catch up without jarring seeks.
    - $\Delta \ge 2000\text{ms}$: Hard seek snapping directly to expected synchronized timestamp.
  - Heartbeat sync broadcasts from server every 5 seconds.
  - Smart play/pause state synchronization across all viewers.
  - Buffer state notifications: if non-slow viewers buffer, the room temporarily pauses until all catch up, unless "Ignore slow viewers" is enabled.

- **Multi-Source Video Support**:
  - **YouTube**: Powered by the YouTube IFrame API with custom responsive controls, duration/timeline scrubbing, and quality selection.
  - **Direct URLs**: MP4, WebM, HLS (`.m3u8`), and audio files (`.mp3`, `.wav`) rendered via custom HTML5 video player.
  - **File Uploads**: Drag-and-drop or file selector for videos up to 500MB, streaming with HTTP `206 Partial Content` Range requests for instant seeking.

- **Interactive Queue Management**:
  - Add YouTube links, direct video URLs, or uploaded files.
  - Drag-and-drop reordering with drag handle indicators.
  - Skip forward, remove items, and auto-advance to next queued item when finished.

- **P2P Mesh WebRTC Video Calling**:
  - Mesh topology supporting up to 6 camera/mic participants.
  - Real-time signaling over Socket.IO (`offer`, `answer`, `ice-candidate`).
  - Camera toggle, microphone mute/unmute, and camera source switching.
  - Active speaker indication with glowing rings.
  - **Auto-Ducking Hook**: Uses `AudioContext` and `AnalyserNode` to dynamically lower stream volume to 30% when peers speak, restoring audio 1.5s after speech stops.

- **Live Chat & Floating Reactions**:
  - Real-time text messaging with timestamp and customizable member color avatars.
  - Auto-scrolling chat with "@mention" tagging and auto-link parsing.
  - Floating emoji reactions animating upward over the video canvas with keyboard shortcuts `1-6`.

- **Host & Room Controls**:
  - Customizable room names and clean 6-character alphanumeric room codes.
  - Host toggle: "Everyone can control" vs. "Host only controls".
  - Room lock toggle to prevent new members from joining.
  - Kick user & host transfer capabilities.
  - Share dialog with instant link copy and auto-generated QR code for mobile joining.
  - Theater mode and full-screen video options (`F` key).

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS, Lucide icons styling
- **Backend**: Node.js, Express, TypeScript, Multer, UUID
- **Realtime**: Socket.IO v4 (client & server)
- **Signaling & Calling**: WebRTC `RTCPeerConnection` with STUN servers
- **Media**: YouTube IFrame API, HTML5 Video with Range requests

---

## 📦 Project Structure

```
multimedia/
├── client/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ChatPanel.tsx       # Real-time chat & reactions
│   │   │   ├── DirectPlayer.tsx    # HTML5 video player with custom controls
│   │   │   ├── HomePage.tsx        # Create / join room landing page
│   │   │   ├── MemberList.tsx      # Room members & host management
│   │   │   ├── Player.tsx          # Dynamic player switcher
│   │   │   ├── QueuePanel.tsx      # Draggable playlist & media uploads
│   │   │   ├── Reactions.tsx       # Floating animated emoji overlay
│   │   │   ├── RoomHeader.tsx      # Header with room info, controls, settings
│   │   │   ├── RoomPage.tsx        # Main room layout with keyboard shortcuts
│   │   │   ├── ShareDialog.tsx     # Invite link & QR code generator
│   │   │   ├── UsernameModal.tsx   # Display name prompt
│   │   │   ├── VideoCallStrip.tsx  # WebRTC peer video call grid
│   │   │   └── YouTubePlayer.tsx   # YouTube IFrame player integration
│   │   ├── context/
│   │   │   ├── RoomContext.tsx     # Centralized room state and actions
│   │   │   └── SocketContext.tsx   # Socket.IO connection lifecycle
│   │   ├── hooks/
│   │   │   ├── useAutoDucking.ts   # Audio ducking during peer speech
│   │   │   ├── useClockOffset.ts   # NTP-style clock offset calculation
│   │   │   ├── useSyncEngine.ts    # Drift detection and rate compensation
│   │   │   └── useWebRTC.ts        # Mesh WebRTC peer connection manager
│   │   ├── lib/
│   │   │   ├── colors.ts           # Consistent user color hashing
│   │   │   ├── formatTime.ts       # Duration formatting helpers
│   │   │   └── urlParser.ts        # URL format parsing & validation
│   │   ├── App.tsx
│   │   ├── index.css
│   │   └── main.tsx
│   └── vite.config.ts
└── server/
    └── src/
        ├── rooms/
        │   ├── RoomManager.ts      # In-memory room CRUD and lifecycle
        │   └── types.ts            # Shared domain types & interfaces
        ├── socket/
        │   ├── handlers.ts         # Socket.IO event registrations
        │   └── rtcSignaling.ts     # WebRTC signaling router
        ├── upload/
        │   └── router.ts           # Multer uploads & HTTP 206 partial streaming
        └── index.ts                # Express server and Socket.IO initialization
```

---

## 🏃 Getting Started

### Prerequisites

- Node.js 18+ and npm installed

### 1. Start the Server

```bash
cd server
npm install
npm run dev
```

The server will start on `http://localhost:3001` (ws://localhost:3001).

### 2. Start the Client

```bash
cd client
npm install
npm run dev
```

The client will start on `http://localhost:5173` with reverse proxy configured to the backend.

---

## ⌨️ Keyboard Shortcuts

| Key       | Action                                                         |
| --------- | -------------------------------------------------------------- |
| `Space`   | Play / Pause video (when host or control enabled)              |
| `←` / `→` | Seek backward / forward 5 seconds                              |
| `F`       | Toggle Fullscreen                                              |
| `T`       | Toggle Theater Mode                                            |
| `1` - `6` | Send quick emoji reaction (`❤️`, `🔥`, `😂`, `👏`, `🎉`, `🍿`) |

---

## 🔒 Production Build

To compile both client and server for production deployment:

```bash
# In client/
npm run build

# In server/
npm run build
npm start
```
