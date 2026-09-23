import { describe, it, expect } from 'vitest';
import { sanitizeEmbedUrl } from '../sanitizeEmbed';

describe('Track 3.11: Web-Embed URL Sanitization', () => {
  it('should accept valid HTTPS YouTube embed URLs', () => {
    const res = sanitizeEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(res.isValid).toBe(true);
    expect(res.provider).toBe('youtube');
    expect(res.sanitizedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
  });

  it('should transform standard YouTube watch URLs to embed format', () => {
    const res = sanitizeEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(res.isValid).toBe(true);
    expect(res.provider).toBe('youtube');
    expect(res.sanitizedUrl).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
  });

  it('should accept youtube-nocookie.com embeds', () => {
    const res = sanitizeEmbedUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(res.isValid).toBe(true);
    expect(res.provider).toBe('youtube');
  });

  it('should accept valid Excalidraw room URLs', () => {
    const res = sanitizeEmbedUrl('https://excalidraw.com/#room=12345,abcdef');
    expect(res.isValid).toBe(true);
    expect(res.provider).toBe('excalidraw');
  });

  it('should reject non-HTTPS URLs', () => {
    const res = sanitizeEmbedUrl('http://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/HTTPS required/);
  });

  it('should reject dangerous pseudo-protocols (javascript:, data:)', () => {
    const xss1 = sanitizeEmbedUrl('javascript:alert(document.cookie)');
    expect(xss1.isValid).toBe(false);
    expect(xss1.error).toMatch(/Forbidden protocol/);

    const xss2 = sanitizeEmbedUrl('data:text/html,<script>alert(1)</script>');
    expect(xss2.isValid).toBe(false);
    expect(xss2.error).toMatch(/Forbidden protocol/);
  });

  it('should reject arbitrary non-whitelisted origins', () => {
    const res = sanitizeEmbedUrl('https://evil-phishing-site.example.com/embed');
    expect(res.isValid).toBe(false);
    expect(res.error).toMatch(/not in the approved embed whitelist/);
  });

  it('should reject empty or malformed inputs', () => {
    expect(sanitizeEmbedUrl('').isValid).toBe(false);
    expect(sanitizeEmbedUrl('not a url').isValid).toBe(false);
  });
});
