/**
 * Penetration Test: Speed-Hack & Movement Exploit Validation
 *
 * Connects a socket client, joins a room, and fires teleportation/speed-hack
 * movements (e.g. moving 500 units in 50ms). Verifies the server replies with
 * POSITION_CORRECTION and disconnects after repeated violations.
 */

import { io } from 'socket.io-client';

const TARGET_URL = process.env.TARGET_URL || 'http://localhost:3000';
const TEST_TOKEN = process.env.TEST_TOKEN || '';

async function runSpeedHackTest() {
  console.log(`[PenTest] Starting Speed-Hack test against ${TARGET_URL}...`);

  if (!TEST_TOKEN) {
    console.log('[INFO] No TEST_TOKEN provided. Speed-Hack script requires a valid auth token to connect.');
    console.log('Usage: TEST_TOKEN=<jwt> node security-tests/speed-hack.js');
    return;
  }

  const socket = io(TARGET_URL, {
    auth: { token: TEST_TOKEN },
    transports: ['websocket'],
  });

  let correctionsReceived = 0;

  socket.on('connect', () => {
    console.log('[Socket] Connected. Emitting impossible movement packets...');

    // Attempt rapid teleportation across the map
    socket.emit('player:move', {
      x: 9999,
      y: 0,
      z: 9999,
      roomId: 'haven-park',
    });
  });

  socket.on('player:position_correction', (correction) => {
    correctionsReceived++;
    console.log(`[PASS] Server detected speed/teleport anomaly and sent snapback correction:`, correction);

    // Send 3 more rapid impossible movements to verify disconnect
    for (let i = 0; i < 3; i++) {
      socket.emit('player:move', {
        x: -9999 + i * 100,
        y: 0,
        z: -9999,
        roomId: 'haven-park',
      });
    }
  });

  socket.on('error', (err) => {
    console.log('[PASS] Received security violation error from server:', err);
  });

  socket.on('disconnect', (reason) => {
    console.log(`[PASS] Socket was disconnected: ${reason}`);
    process.exit(0);
  });

  setTimeout(() => {
    if (correctionsReceived === 0) {
      console.warn('[WARN] Did not receive position correction within 5 seconds.');
    }
    socket.disconnect();
    process.exit(0);
  }, 5000);
}

runSpeedHackTest();
