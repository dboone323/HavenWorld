// load-tests/ws-concurrent.js
// Scenario: 25 concurrent WebSocket connections joining a room and sending chat messages
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const chatLatency = new Trend('chat_message_latency', true);
const joinLatency = new Trend('room_join_latency', true);
const errorsTotal = new Counter('ws_errors_total');

export const options = {
  vus: 25,
  duration: '30s',
  thresholds: {
    'chat_message_latency': ['p(95) < 300'],
    'room_join_latency': ['p(95) < 500'],
    'ws_errors_total': ['count < 15'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'ws://localhost:3000';
const TEST_TOKEN = __ENV.TEST_JWT || 'dummy_token';

export default function () {
  const joinStart = Date.now();
  const url = `${BASE_URL}/socket.io/?EIO=4&transport=websocket`;

  const res = ws.connect(url, { headers: { Authorization: `Bearer ${TEST_TOKEN}` } }, function (socket) {
    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          event: 'auth:join',
          data: {
            roomId: 'room-park',
            player: {
              id: `vu_${__VU}`,
              username: `Player_${__VU}`,
              x: 100,
              y: 100,
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
          joinLatency.add(Date.now() - joinStart);

          // Send chat messages
          for (let i = 0; i < 5; i++) {
            const chatStart = Date.now();
            socket.send(
              JSON.stringify({
                event: 'chat:send',
                data: { message: `Load test message ${i} from VU ${__VU}` },
              })
            );
            chatLatency.add(Date.now() - chatStart);
            sleep(0.5);
          }
        }
      } catch {
        // Ignore unparseable frames (like Socket.io handshake '0{...}')
      }
    });

    socket.on('error', (e) => {
      errorsTotal.add(1);
    });

    sleep(25);
    socket.close();
  });

  check(res, { 'WebSocket connected': (r) => r && r.status === 101 });
}
