// ============================================================================
// Clock Offset Hook — NTP-style time synchronization
// ============================================================================
// On connect, runs 3 ping-pong rounds with the server. For each round:
//   1. Record clientSendTime
//   2. Server replies with serverTime
//   3. Record clientReceiveTime
//   4. RTT = clientReceiveTime - clientSendTime
//   5. Offset = serverTime - clientSendTime - RTT/2
//
// We keep the sample with the LOWEST RTT (least network jitter) and store
// the resulting clockOffset. All position calculations use getServerTime()
// instead of Date.now() to stay aligned across clients.

import { useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../context/SocketContext';

const NUM_SAMPLES = 3;
const SAMPLE_INTERVAL_MS = 200;

export function useClockOffset() {
  const { socket, isConnected } = useSocket();
  const offsetRef = useRef<number>(0);
  const calibratedRef = useRef(false);

  useEffect(() => {
    if (!socket || !isConnected) return;

    let sampleIndex = 0;
    let bestOffset = 0;
    let bestRtt = Infinity;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const takeSample = () => {
      const clientSendTime = Date.now();

      socket.emit('sync:ping', { clientTime: clientSendTime }, (response: any) => {
        if (!response?.serverTime) return;

        const clientReceiveTime = Date.now();
        const rtt = clientReceiveTime - clientSendTime;

        // Offset = how far ahead the server clock is from ours
        // serverTime ≈ clientSendTime + rtt/2 + offset
        // offset ≈ serverTime - clientSendTime - rtt/2
        const offset = response.serverTime - clientSendTime - rtt / 2;

        // Keep the sample with the lowest RTT (least jitter influence)
        if (rtt < bestRtt) {
          bestRtt = rtt;
          bestOffset = offset;
        }

        sampleIndex++;
        if (sampleIndex < NUM_SAMPLES) {
          timerId = setTimeout(takeSample, SAMPLE_INTERVAL_MS);
        } else {
          offsetRef.current = bestOffset;
          calibratedRef.current = true;
          console.log(
            `[ClockOffset] Calibrated: offset=${bestOffset.toFixed(1)}ms, ` +
            `bestRTT=${bestRtt.toFixed(1)}ms`
          );
        }
      });
    };

    // Start calibration
    takeSample();

    return () => {
      if (timerId) clearTimeout(timerId);
    };
  }, [socket, isConnected]);

  /**
   * Get the current server-aligned time.
   * Use this instead of Date.now() for all playback position calculations.
   */
  const getServerTime = useCallback((): number => {
    return Date.now() + offsetRef.current;
  }, []);

  return { getServerTime, clockOffset: offsetRef.current, isCalibrated: calibratedRef.current };
}
