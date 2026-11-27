import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LoftSettingsPanel } from '../LoftSettingsPanel';
import { AccountSettingsPanel } from '../AccountSettingsPanel';

describe('Settings organization (#96)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    AccountSettingsPanel.dismiss();
  });

  afterEach(() => {
    AccountSettingsPanel.dismiss();
  });

  it('LoftSettingsPanel does not contain Delete My Account', () => {
    const loft = new LoftSettingsPanel({
      roomId: 'room-1',
      ownerId: 'user-1',
      currentPrivacy: 'PUBLIC',
      currentMood: 'day',
    });
    loft.show();

    expect(document.getElementById('btn-delete-account')).toBeNull();
    expect(document.getElementById('mood-select')).not.toBeNull();

    loft.dismiss();
  });

  it('AccountSettingsPanel renders Delete My Account and closes on Escape', () => {
    AccountSettingsPanel.show();

    const overlay = document.getElementById('account-settings-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelector('#btn-delete-account')).not.toBeNull();
    expect(overlay?.querySelector('#btn-delete-account')?.textContent).toContain('Delete My Account');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('account-settings-overlay')).toBeNull();
  });
});
