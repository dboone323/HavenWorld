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

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WS_BASE = BASE_URL.replace(/^http/, 'ws');
const TEST_TOKEN = __ENV.TEST_JWT || 'dummy_token';
const WS_URL = `${WS_BASE}/socket.io/?EIO=4&transport=websocket&token=${TEST_TOKEN}`;

export default function () {
  const joinStart = Date.now();

  const res = ws.connect(WS_URL, {}, function (socket) {
    socket.on('open', () => {
      // socket.io v4 protocol handler
      // "2" = PING → respond with PONG "3"
      // "40" = CONNECT ack → server confirmed connection, safe to send events
      // "42" = EVENT (incoming from server)
      // "42" + JSON array = send event to server
      socket.on('message', (raw) => {
        if (raw === '2' || raw.startsWith('2[')) {
          socket.send('3');
        }

        if (raw.startsWith('40')) {
          joinLatency.add(Date.now() - joinStart);

          // Join room — socket.io v4 event format
          socket.send('42' + JSON.stringify(['auth:join', {
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
          }]));

          // Send chat messages
          for (let i = 0; i < 5; i++) {
            const chatStart = Date.now();
            socket.send('42' + JSON.stringify(['chat:send', {
              message: `Load test message ${i} from VU ${__VU}`,
            }]));
            chatLatency.add(Date.now() - chatStart);
            sleep(0.5);
          }
        }
      });
    });

    socket.on('error', (e) => {
      errorsTotal.add(1);
    });

    sleep(25);
    socket.close();
  });

  check(res, { 'WebSocket connected': (r) => r && r.status === 101 });
}
