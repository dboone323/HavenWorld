import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClubPanel } from '../ClubPanel';

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

describe('ClubPanel stored-XSS regression', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => maliciousClubs,
      } as unknown as Response)
    );
  });

  afterEach(() => {
    ClubPanel.dismiss();
    document.getElementById('club-modal-overlay')?.remove();
    vi.unstubAllGlobals();
  });

  it('escapes club name, tag and motto in the browse list', async () => {
    await ClubPanel.show();

    const html = document.getElementById('club-modal-overlay')?.innerHTML ?? '';
    expect(html).not.toBe('');

    // Raw payloads must never appear as live markup
    expect(html).not.toContain('<b>Elite</b>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('"><img src=1>');

    // Escaped forms must be present instead
    expect(html).toContain('&lt;b&gt;Elite&lt;/b&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});