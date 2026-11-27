import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { showToast, clearToasts } from '../ToastNotification';
import { MailboxPanel } from '../MailboxPanel';
import { PizzaScene } from '../../minigame/PizzaScene';

describe('HUD & Modal Polish (#104, #106, #90)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    clearToasts();
    MailboxPanel.dismiss();
  });

  afterEach(() => {
    clearToasts();
    MailboxPanel.dismiss();
    document.getElementById('pizza-scene-overlay')?.remove();
  });

  it('#104: toast container anchors at top-center, not bottom-right over chat input/Send', () => {
    showToast({ icon: '☀️', title: 'Weather: SUNNY' });
    const container = document.getElementById('haven-toast-container');
    expect(container).not.toBeNull();
    expect(container?.style.top).toBe('14px');
    expect(container?.style.bottom).toBe('');
    expect(container?.style.left).toBe('50%');
  });

  it('#106: MailboxPanel closes when Escape is pressed', () => {
    MailboxPanel.show();
    expect(document.getElementById('mailbox-panel-overlay')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('mailbox-panel-overlay')).toBeNull();
  });

  it('#90: PizzaScene modal constrains height for 800x600 and closes on Escape', () => {
    const pizza = new PizzaScene();
    pizza.open();

    const overlay = document.getElementById('pizza-scene-overlay');
    expect(overlay).not.toBeNull();

    const panel = overlay?.firstElementChild as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel?.style.maxHeight).toContain('100vh');
    expect(panel?.style.overflowY).toBe('auto');

    const closeBtn = overlay?.querySelector('#btn-close-pizza');
    expect(closeBtn).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('pizza-scene-overlay')).toBeNull();
  });

  it('#90: PizzaScene shows result banner with explicit Next Order instead of auto-advancing', () => {
    const pizza = new PizzaScene();
    pizza.open();

    const overlay = document.getElementById('pizza-scene-overlay')!;
    const resultBanner = overlay.querySelector('#pizza-result-banner') as HTMLElement;
    const actionRow = overlay.querySelector('#pizza-action-row') as HTMLElement;
    expect(resultBanner.style.display).toBe('none');
    expect(actionRow.style.display).toBe('flex');

    // Simulate serving and receiving a server result via internal handler
    (pizza as unknown as { submitInFlight: boolean }).submitInFlight = true;
    (pizza as unknown as {
      handleResult: (res: { tier: 'PERFECT' | 'GOOD' | 'FAIL'; coinsEarned: number; combo: number }) => void;
    }).handleResult({ tier: 'PERFECT', coinsEarned: 35, combo: 2 });

    expect(resultBanner.style.display).toBe('block');
    expect(resultBanner.textContent).toContain('PERFECT PIZZA');
    expect(resultBanner.textContent).toContain('+35 HavenCoins');
    expect(actionRow.style.display).toBe('none');
    expect(overlay.querySelector('#btn-next-pizza')).not.toBeNull();

    pizza.close();
  });
});
