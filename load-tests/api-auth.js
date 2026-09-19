// load-tests/api-auth.js
// Scenario: 50 concurrent login requests verifying bcrypt and JWT pipeline performance
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 50,
  duration: '30s',
  thresholds: {
    'http_req_duration': ['p(95) < 500'],
    'http_req_failed': ['rate < 0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

const CREDENTIALS = [
  { email: 'loadtest01@havenworld.local', password: 'LoadTest123!' },
  { email: 'loadtest02@havenworld.local', password: 'LoadTest123!' },
  { email: 'loadtest03@havenworld.local', password: 'LoadTest123!' },
];

export default function () {
  const cred = CREDENTIALS[(__VU - 1) % CREDENTIALS.length];
  const payload = JSON.stringify(cred);
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
    responseCallback: http.expectedStatuses(200, 401),
  };

  const res = http.post(`${BASE_URL}/api/auth/login`, payload, params);

  check(res, {
    'Status is 200 or 401': (r) => r.status === 200 || r.status === 401,
    'No 5xx server errors': (r) => r.status < 500,
  });

  sleep(0.5);
}
