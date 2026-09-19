import { io as ClientIO, Socket } from 'socket.io-client';
import { generateTestToken } from './jwtHelpers';

/**
 * Creates a real socket.io-client connection pre-authenticated with a test JWT.
 * Adds the socket to the provided array so afterEach can close it cleanly.
 */
export async function createAuthenticatedSocket(
  serverUrl: string,
  userId: string,
  sockets: Socket[],
  extraPayload: Record<string, any> = {}
): Promise<Socket> {
  const token = generateTestToken(userId, '15m', extraPayload);
  return new Promise((resolve, reject) => {
    const socket = ClientIO(serverUrl, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });

    socket.on('connect', () => {
      sockets.push(socket);
      resolve(socket);
    });

    socket.on('connect_error', (err) => {
      sockets.push(socket);
      reject(new Error(`Socket connection failed: ${err.message}`));
    });

    setTimeout(() => {
      reject(new Error('Socket connection timeout'));
    }, 6000);
  });
}

/**
 * Returns a Promise that resolves with the first event payload matching eventName.
 * Rejects if the event does not arrive within the timeout (default: 5000ms).
 */
export function waitForEvent(
  socket: Socket,
  eventName: string,
  timeoutMs = 5000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, handler);
      reject(new Error(`Timed out waiting for event "${eventName}" after ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(data: any) {
      clearTimeout(timer);
      socket.off(eventName, handler);
      resolve(data);
    }

    socket.on(eventName, handler);
  });
}

/**
 * Gracefully disconnects all sockets in the array and clears it.
 */
export async function closeAllSockets(sockets: Socket[]): Promise<void> {
  await Promise.all(
    sockets.map(
      (socket) =>
        new Promise<void>((resolve) => {
          if (socket && socket.connected) {
            socket.once('disconnect', () => resolve());
            socket.disconnect();
          } else {
            resolve();
          }
        })
    )
  );
  sockets.length = 0;
}
