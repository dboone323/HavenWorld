import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ReportModal } from '../ReportModal';
import { authService } from '../../services/auth';

describe('ReportModal (A1 Client Flow)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    ReportModal.dismiss();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reportId: 'report-123', message: 'Report submitted.' }),
    }));
  });

  afterEach(() => {
    ReportModal.dismiss();
    vi.restoreAllMocks();
  });

  it('renders report modal with target player username, reason options, and description textarea', () => {
    ReportModal.show({
      targetUserId: 'user-456',
      targetUsername: 'Troublemaker42',
    });

    const overlay = document.getElementById('report-modal-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain('Troublemaker42');

    const select = overlay?.querySelector('#report-reason-select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.options.length).toBeGreaterThanOrEqual(6);

    const desc = overlay?.querySelector('#report-description') as HTMLTextAreaElement;
    expect(desc).not.toBeNull();
  });

  it('submits report to /api/reports with selected reason and description on button click', async () => {
    vi.spyOn(authService, 'token', 'get').mockReturnValue('mock-jwt-token');

    ReportModal.show({
      targetUserId: 'user-789',
      targetUsername: 'SpammerBob',
    });

    const overlay = document.getElementById('report-modal-overlay')!;
    const select = overlay.querySelector('#report-reason-select') as HTMLSelectElement;
    const desc = overlay.querySelector('#report-description') as HTMLTextAreaElement;
    const submitBtn = overlay.querySelector('#report-submit-btn') as HTMLButtonElement;

    select.value = 'SPAM';
    desc.value = 'Selling gold links repeatedly in plaza';

    submitBtn.click();

    // Allow fetch promise resolution
    await new Promise((r) => setTimeout(r, 10));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/reports'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock-jwt-token',
        }),
        body: JSON.stringify({
          reportedUserId: 'user-789',
          reason: 'SPAM',
          description: 'Selling gold links repeatedly in plaza',
        }),
      })
    );
  });

  it('dismisses modal on close button click', () => {
    ReportModal.show({
      targetUserId: 'user-111',
      targetUsername: 'GhostUser',
    });

    expect(document.getElementById('report-modal-overlay')).not.toBeNull();
    const closeBtn = document.getElementById('report-close-btn') as HTMLButtonElement;
    closeBtn.click();

    expect(document.getElementById('report-modal-overlay')).toBeNull();
  });
});
