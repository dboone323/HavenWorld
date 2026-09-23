import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GalleryPanel } from '../GalleryPanel';

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

describe('GalleryPanel stored-XSS regression', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => maliciousPhotos,
      } as unknown as Response)
    );
  });

  afterEach(() => {
    GalleryPanel.dismiss();
    document.getElementById('gallery-modal-overlay')?.remove();
    vi.unstubAllGlobals();
  });

  it('escapes caption, author, roomName and imageUrl when rendering cards', async () => {
    await GalleryPanel.show();

    const grid = document.getElementById('gallery-photo-grid');
    const html = grid?.innerHTML ?? '';
    expect(html).not.toBe('');

    // 1. The payloads must stay inert: no live <script> elements and no
    //    injected event-handler attributes (attribute breakout would create
    //    an [onerror] node).
    expect(grid?.querySelectorAll('script, [onerror], [onclick]')).toHaveLength(0);

    const img = grid?.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.hasAttribute('onerror')).toBe(false);
    // The onerror payload survives only INSIDE the src attribute value
    expect(img?.getAttribute('src')).toContain('onerror=');

    // 2. User text must render escaped, not as markup
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;Room&lt;/b&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');

    // 3. The payloads appear only as TEXT content (never as elements)
    const allText = Array.from(grid?.querySelectorAll('div') ?? [])
      .map((d) => d.textContent ?? '')
      .join('\n');
    expect(allText).toContain('<script>alert("xss")</script>');
    expect(allText).toContain('<b>Room</b>');
  });
});