import { createServer, Server } from 'node:http';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { GalleryPanel } from '../GalleryPanel';
import { setServerUrl } from '../../config';
import { authService } from '../../services/auth';

const maliciousPhotos = [
  {
    id: 'photo-1',
    authorName: '<img src=x onerror=alert(1)>',
    imageUrl: 'x" onerror="alert(document.cookie)',
    caption: '<script>alert("xss")</script>',
    likes: 3,
    roomName: '<b>Room</b>',
    isLikedByMe: false,
  },
];

describe('GalleryPanel stored-XSS regression (Real HTTP Server Validation)', () => {
  let server: Server;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/api/gallery') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify(maliciousPhotos));
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
    GalleryPanel.dismiss();
    document.getElementById('gallery-modal-overlay')?.remove();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('escapes caption, author, roomName and imageUrl when rendering cards', async () => {
    await GalleryPanel.show();

    const grid = document.getElementById('gallery-photo-grid');
    const html = grid?.innerHTML ?? '';
    expect(html).not.toBe('');

    expect(grid?.querySelectorAll('script, [onerror], [onclick]')).toHaveLength(0);

    const img = grid?.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.hasAttribute('onerror')).toBe(false);
    expect(img?.getAttribute('src')).toContain('onerror=');

    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;Room&lt;/b&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');

    const allText = Array.from(grid?.querySelectorAll('div') ?? [])
      .map((d) => d.textContent ?? '')
      .join('\n');
    expect(allText).toContain('<script>alert("xss")</script>');
    expect(allText).toContain('<b>Room</b>');
  });
});