// load-tests/fishing-concurrent.js
// Scenario: 10 concurrent users fishing simultaneously, verifying transactional idempotency
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const totalCoinsAwarded = new Counter('total_coins_awarded');
const duplicateDetected = new Counter('duplicate_reward_detected');

export const options = {
  vus: 10,
  iterations: 10,
  thresholds: {
    'duplicate_reward_detected': ['count == 0'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'ws://localhost:3000';
const TEST_TOKEN = __ENV.TEST_JWT || 'dummy_token';

export default function () {
  let caughtOnce = false;
  const url = `${BASE_URL}/socket.io/?EIO=4&transport=websocket`;

  ws.connect(url, { headers: { Authorization: `Bearer ${TEST_TOKEN}` } }, function (socket) {
    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          event: 'auth:join',
          data: {
            roomId: 'room-fishing-dock',
            player: {
              id: `fisher_${__VU}`,
              username: `Fisher_${__VU}`,
              x: 50,
              y: 50,
              z: 0,
              rotY: 0,
              direction: 'down',
              isMoving: false,
            },
          },
        })
      );
    });

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.event === 'room:state') {
          // Cast line
          socket.send(
            JSON.stringify({
              event: 'fishing:cast_line',
              data: { roomId: 'room-fishing-dock' },
            })
          );
        }

        if (msg.event === 'fishing:tension_update') {
          // Move reel into sweet spot
          const target = (msg.data.sweetSpotMin + msg.data.sweetSpotMax) / 2;
          socket.send(
            JSON.stringify({
              event: 'fishing:reel_position',
              data: { value: target },
            })
          );
        }

        if (msg.event === 'fishing:caught') {
          if (caughtOnce) {
            duplicateDetected.add(1);
          }
          caughtOnce = true;
          totalCoinsAwarded.add(msg.data.coinsEarned || 0);
          socket.close();
        }
      } catch {
        // Ignore handshake
      }
    });

    sleep(15);
    socket.close();
  });
}
