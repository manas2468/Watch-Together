import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SocketProvider } from './context/SocketContext';
import { RoomProvider } from './context/RoomContext';
import { WebRTCProvider } from './context/WebRTCContext';
import { HomePage } from './components/HomePage';
import { RoomPage } from './components/RoomPage';

export function App() {
  return (
    <BrowserRouter>
      <SocketProvider>
        <RoomProvider>
          <WebRTCProvider>
            <div className="min-h-screen bg-surface-950 text-white font-sans antialiased">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/room/:roomId" element={<RoomPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </WebRTCProvider>
        </RoomProvider>
      </SocketProvider>
    </BrowserRouter>
  );
}

export default App;
