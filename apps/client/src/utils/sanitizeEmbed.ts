/**
 * Whitelist and sanitizer for web-embed objects (TVs, whiteboards, music players).
 * Enforces HTTPS and whitelisted domains to prevent XSS and malicious iframe embeds.
 */

const ALLOWED_ORIGINS = new Set([
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://excalidraw.com',
  'https://w.soundcloud.com',
]);

export interface SanitizedEmbedResult {
  isValid: boolean;
  sanitizedUrl: string | null;
  provider: 'youtube' | 'vimeo' | 'excalidraw' | 'soundcloud' | 'unknown';
  error?: string;
}

export function sanitizeEmbedUrl(rawUrl: string): SanitizedEmbedResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isValid: false, sanitizedUrl: null, provider: 'unknown', error: 'Empty URL' };
  }

  const trimmed = rawUrl.trim();

  // Reject dangerous pseudo-protocols explicitly
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:')
  ) {
    return { isValid: false, sanitizedUrl: null, provider: 'unknown', error: 'Forbidden protocol' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { isValid: false, sanitizedUrl: null, provider: 'unknown', error: 'Malformed URL' };
  }

  if (parsed.protocol !== 'https:') {
    return { isValid: false, sanitizedUrl: null, provider: 'unknown', error: 'HTTPS required' };
  }

  const origin = parsed.origin.toLowerCase();
  if (!ALLOWED_ORIGINS.has(origin)) {
    return {
      isValid: false,
      sanitizedUrl: null,
      provider: 'unknown',
      error: `Origin ${origin} is not in the approved embed whitelist`,
    };
  }

  // Detect provider and build safe iframe embed target
  let provider: SanitizedEmbedResult['provider'] = 'unknown';

  if (origin.includes('youtube') || origin.includes('youtube-nocookie')) {
    provider = 'youtube';
    // Ensure path is /embed/<id>
    if (!parsed.pathname.startsWith('/embed/')) {
      const v = parsed.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
        parsed.pathname = `/embed/${v}`;
        parsed.search = '';
      } else {
        return { isValid: false, sanitizedUrl: null, provider, error: 'Invalid YouTube video ID' };
      }
    }
  } else if (origin.includes('vimeo')) {
    provider = 'vimeo';
  } else if (origin.includes('excalidraw')) {
    provider = 'excalidraw';
  } else if (origin.includes('soundcloud')) {
    provider = 'soundcloud';
  }

  return {
    isValid: true,
    sanitizedUrl: parsed.toString(),
    provider,
  };
}
