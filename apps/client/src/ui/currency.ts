import { StreamerModeManager } from './StreamerModeManager';

/**
 * Updates the in-game coin balance display immediately and dispatches
 * a 'haven:coins-updated' window event.
 */
export function setCoinBalance(newBalance: number): void {
  const coinEl = document.getElementById('coin-amount');
  if (coinEl) {
    const val = Math.max(0, Math.floor(newBalance));
    coinEl.dataset.rawCoins = String(val);
    coinEl.textContent = StreamerModeManager.maskSensitiveText(val);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('haven:coins-updated', { detail: { balance: newBalance } })
    );
  }
}

/**
 * Adjusts the current coin balance in the HUD by delta (positive or negative).
 */
export function adjustCoinBalance(delta: number): void {
  if (!delta || !Number.isFinite(delta)) return;
  const coinEl = document.getElementById('coin-amount');
  let current = 0;
  if (coinEl) {
    const raw = coinEl.dataset.rawCoins || coinEl.textContent || '0';
    current = parseInt(raw, 10);
    if (Number.isNaN(current)) current = 0;
  }
  const next = Math.max(0, current + Math.floor(delta));
  setCoinBalance(next);
}
