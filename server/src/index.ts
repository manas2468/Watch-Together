// ============================================================================
// Watch Together — Server Entry Point
// ============================================================================

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { RoomManager } from './rooms/RoomManager';
import { registerSocketHandlers } from './socket/handlers';
import { uploadRouter, serveUploads } from './upload/router';
import { searchRouter } from './search/router';
import path from 'path';
import fs from 'fs';

const PORT = parseInt(process.env.PORT || '3001', 10);
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';

// Dynamic CORS allowing localhost, LAN IPs (phones on Wi-Fi), and CLIENT_URL
const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true; // allow non-browser requests
  if (origin === CLIENT_URL) return true;
  // Allow any localhost or 127.0.0.1 or local network (192.168.*, 10.*, 172.16-31.*)
  if (/^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$/.test(origin)) {
    return true;
  }
  return false;
};

// ----- Express setup -----
const app = express();
app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(null, true); // Permissive in dev mode for mobile accessibility
      }
    },
    credentials: true,
  })
);
app.use(express.json());

// API routes
app.use('/api', uploadRouter);
app.use('/api', searchRouter);

// Serve uploaded files with Range support
app.get('/uploads/:filename', serveUploads);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Serve frontend static assets if client/dist exists (production mode)
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// ----- HTTP + Socket.IO -----
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, true),
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Reconnection is handled client-side. Server just accepts connections.
  pingTimeout: 20000,
  pingInterval: 10000,
});

// ----- Initialize -----
const roomManager = new RoomManager();
registerSocketHandlers(io, roomManager);

// ----- Start -----
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║       🎬 Watch Together Server          ║
║                                          ║
║  HTTP:   http://localhost:${PORT}           ║
║  Socket: ws://localhost:${PORT}             ║
╚══════════════════════════════════════════╝
  `);
});

// ----- Graceful Shutdown -----
const shutdown = () => {
  console.log('\n[Server] Shutting down gracefully...');
  io.close(() => {
    server.close(() => {
      console.log('[Server] Closed.');
      process.exit(0);
    });
  });
  // Force exit after 5s
  setTimeout(() => process.exit(1), 5000);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
