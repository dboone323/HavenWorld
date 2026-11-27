import { authService } from '../services/auth';
import { DraggablePanel } from './DraggablePanel';
import { showToast } from './ToastNotification';
import { SceneManager } from '../engine/SceneManager';
import { escapeHtml } from '../utils/escapeHtml';

/**
 * AccountSettingsPanel — account-scoped settings modal (user identity &
 * Danger Zone account deletion), separated from room-scoped LoftSettingsPanel.
 */
export class AccountSettingsPanel {
  private static overlay: HTMLElement | null = null;
  private static onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      AccountSettingsPanel.dismiss();
    }
  };

  static show(): void {
    this.dismiss();
    window.addEventListener('keydown', this.onKeyDown);

    const overlay = document.createElement('div');
    overlay.id = 'account-settings-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center;
      z-index: 9500; font-family: inherit;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: #1a1a2e; border: 1px solid rgba(255,255,255,0.15);
      border-radius: 16px; width: min(380px, calc(100vw - 32px)); max-height: 85vh; overflow-y: auto;
      color: #fff; padding: 24px; box-shadow: 0 8px 40px rgba(0,0,0,0.5);
    `;

    const username = authService.user?.username ?? 'Citizen';

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h2 style="margin:0;font-size:1.1rem;">👤 Account Settings</h2>
        <button id="account-settings-close" aria-label="Close Account Settings" style="background:none;border:none;color:#aaa;font-size:1.3rem;cursor:pointer;">✕</button>
      </div>

      <section style="margin-bottom:20px;">
        <h3 style="margin:0 0 8px;font-size:0.85rem;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.05em;">Account</h3>
        <div style="padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.05);font-size:0.9rem;">
          Signed in as <strong>${escapeHtml(username)}</strong>
        </div>
      </section>

      <section style="padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">
        <h3 style="margin:0 0 10px;font-size:0.85rem;color:#ef4444;text-transform:uppercase;letter-spacing:0.05em;">Danger Zone</h3>
        <p style="margin:0 0 10px;font-size:0.8rem;color:#aaa;line-height:1.4;">
          Permanently delete your account, inventory, loft layouts, and chat history. This action cannot be undone.
        </p>
        <button id="btn-delete-account" style="
          width:100%;background:#ef4444;border:none;border-radius:8px;
          color:#fff;font-weight:600;padding:10px;cursor:pointer;font-size:0.875rem;
        ">Delete My Account</button>
      </section>
    `;

    panel.querySelector('#account-settings-close')?.addEventListener('click', () => this.dismiss());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.dismiss();
    });

    panel.querySelector('#btn-delete-account')?.addEventListener('click', async () => {
      const password = prompt('To confirm permanent deletion of your account and all data, please enter your password:');
      if (!password) return;

      const confirmText = prompt('Type DELETE to permanently erase your account:');
      if (confirmText !== 'DELETE') {
        showToast({ icon: '⚠️', title: 'Cancelled', subtitle: 'Account deletion cancelled.' });
        return;
      }

      try {
        await authService.deleteAccount(password);
        this.dismiss();
        showToast({ icon: '👋', title: 'Account Deleted', subtitle: 'Your account has been permanently removed.' });
        SceneManager.getInstance().switchTo('login').catch(console.error);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : undefined;
        showToast({ icon: '⚠️', title: 'Deletion Failed', subtitle: message || 'Incorrect password or server error.' });
      }
    });

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    DraggablePanel.makeDraggable(panel);
    this.overlay = overlay;
  }

  static dismiss(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.overlay?.remove();
    this.overlay = null;
  }
}
