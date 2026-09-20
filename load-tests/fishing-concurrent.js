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

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WS_BASE = BASE_URL.replace(/^http/, 'ws');
const TEST_TOKEN = __ENV.TEST_JWT || 'dummy_token';
const WS_URL = `${WS_BASE}/socket.io/?EIO=4&transport=websocket&token=${TEST_TOKEN}`;

export default function () {
  let caughtOnce = false;

  ws.connect(WS_URL, {}, function (socket) {
    socket.on('open', () => {
      socket.on('message', (raw) => {
        // socket.io v4 protocol: "2" = PING, respond with PONG ("3")
        if (raw === '2' || raw.startsWith('2[')) {
          socket.send('3');
        }

        // "40" = CONNECT ack — server is ready for events
        if (raw.startsWith('40')) {
          socket.send('42' + JSON.stringify(['auth:join', {
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
          }]));

          // Cast line immediately after joining
          socket.send('42' + JSON.stringify(['fishing:cast_line', {
            roomId: 'room-fishing-dock',
          }]));
        }

        // "42" = EVENT from server
        if (raw.startsWith('42')) {
          try {
            const payload = JSON.parse(raw.slice(2));
            const eventName = payload[0];
            const data = payload[1];

            if (eventName === 'fishing:tension_update') {
              const target = (data.sweetSpotMin + data.sweetSpotMax) / 2;
              socket.send('42' + JSON.stringify(['fishing:reel_position', {
                value: target,
              }]));
            }

            if (eventName === 'fishing:caught') {
              if (caughtOnce) {
                duplicateDetected.add(1);
              }
              caughtOnce = true;
              totalCoinsAwarded.add(data.coinsEarned || 0);
              socket.close();
            }
          } catch {
            // Ignore unparseable frames
          }
        }
      });
    });

    socket.on('error', () => {});

    sleep(15);
    socket.close();
  });
}
