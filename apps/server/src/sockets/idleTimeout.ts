import { Socket } from 'socket.io';
import { SOCKET_EVENTS } from '@havenworld/shared';

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export function attachIdleTimeout(socket: Socket): void {
  let timeoutHandle: NodeJS.Timeout | null = null;

  const resetTimer = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    timeoutHandle = setTimeout(() => {
      socket.emit(SOCKET_EVENTS.ERROR, {
        code: 'IDLE_TIMEOUT',
        message: 'Disconnected due to 10 minutes of inactivity.',
      });
      socket.disconnect(true);
    }, IDLE_TIMEOUT_MS);
  };

  // Start initial timer
  resetTimer();

  // Reset timer on any incoming message / event
  socket.onAny(() => {
    resetTimer();
  });

  socket.on('disconnect', () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  });
}
