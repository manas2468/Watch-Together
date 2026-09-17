import React, { useRef, useEffect, useState } from 'react';
import { useRoom } from '../context/RoomContext';

export function ShareDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { state, addToast } = useRoom();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  const inviteUrl = `${window.location.origin}/room/${state.roomId}`;

  // Generate QR code on canvas (simple implementation)
  useEffect(() => {
    if (!isOpen || !canvasRef.current || !state.roomId) return;
    drawQR(canvasRef.current, inviteUrl);
  }, [isOpen, inviteUrl, state.roomId]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      addToast('Link copied!', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast('Failed to copy', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share room"
    >
      <div
        className="glass w-full max-w-sm mx-4 rounded-2xl p-6 animate-bounce-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-4">
          <h2 className="text-lg font-semibold text-white">Share Room</h2>
          <p className="text-xs text-surface-400 mt-1">Invite friends to watch together</p>
        </div>

        {/* Room code */}
        <div className="text-center mb-4">
          <div className="text-3xl font-bold font-mono tracking-widest text-gradient mb-1">
            {state.roomId}
          </div>
          <p className="text-[10px] text-surface-500">Room Code</p>
        </div>

        {/* QR Code */}
        <div className="flex justify-center mb-4">
          <div className="bg-white p-3 rounded-xl">
            <canvas ref={canvasRef} width={150} height={150} className="block" />
          </div>
        </div>

        {/* URL */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            readOnly
            value={inviteUrl}
            className="flex-1 px-3 py-2 rounded-lg bg-surface-800/50 border border-surface-700/50 
                       text-surface-300 text-xs font-mono"
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button
            onClick={handleCopy}
            className={`px-4 py-2 rounded-lg text-xs font-medium transition-colors
              ${copied
                ? 'bg-accent-emerald/20 text-accent-emerald'
                : 'bg-primary-600 text-white hover:bg-primary-500'
              }`}
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2 rounded-lg text-xs text-surface-400 hover:text-white 
                     hover:bg-surface-800/30 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * Simple QR-like visual using canvas (not a real QR code, but a visual placeholder).
 * For a production app, use a proper QR library. This creates a visually appealing
 * pattern that represents the room code.
 */
function drawQR(canvas: HTMLCanvasElement, text: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const size = canvas.width;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  // Generate a deterministic pattern from the text
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }

  const gridSize = 15;
  const cellSize = size / gridSize;

  ctx.fillStyle = '#1a1a2e';

  // Corner markers (like real QR codes)
  const drawCornerMarker = (x: number, y: number) => {
    ctx.fillRect(x * cellSize, y * cellSize, 3 * cellSize, 3 * cellSize);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect((x + 0.5) * cellSize, (y + 0.5) * cellSize, 2 * cellSize, 2 * cellSize);
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect((x + 1) * cellSize, (y + 1) * cellSize, cellSize, cellSize);
  };

  drawCornerMarker(1, 1);
  drawCornerMarker(11, 1);
  drawCornerMarker(1, 11);

  // Data pattern
  let seed = Math.abs(hash);
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      // Skip corner marker areas
      if ((x < 5 && y < 5) || (x > 9 && y < 5) || (x < 5 && y > 9)) continue;

      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      if (seed % 3 !== 0) {
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(x * cellSize + 1, y * cellSize + 1, cellSize - 2, cellSize - 2);
      }
    }
  }

  // Draw room code in center
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(size / 2 - 30, size / 2 - 8, 60, 16);
  ctx.fillStyle = '#1a1a2e';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const code = text.split('/').pop() || text.slice(-6);
  ctx.fillText(code, size / 2, size / 2);
}
