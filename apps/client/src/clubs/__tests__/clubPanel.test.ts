import { createServer, Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ClubPanel } from '../ClubPanel';
import { setServerUrl } from '../../config';
import { authService } from '../../services/auth';

const maliciousClubs = [
  {
    id: 'club-1',
    name: '<b>Elite</b>',
    motto: '<script>alert(1)</script>',
    tag: '"><img src=1>',
    ownerName: 'owner',
    memberCount: 1,
  },
];

describe('ClubPanel stored-XSS regression (Real HTTP Server Validation)', () => {
  let server: Server;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/api/clubs') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(maliciousClubs));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    setServerUrl(`http://127.0.0.1:${addr.port}`);
    (authService as unknown as { _accessToken: string })._accessToken = 'test-jwt-token';
  });

  afterEach(() => {
    ClubPanel.dismiss();
    document.getElementById('club-modal-overlay')?.remove();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('escapes club name, tag and motto in the browse list', async () => {
    await ClubPanel.show();

    const html = document.getElementById('club-modal-overlay')?.innerHTML ?? '';
    expect(html).not.toBe('');

    expect(html).not.toContain('<b>Elite</b>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('"><img src=1>');

    expect(html).toContain('&lt;b&gt;Elite&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});