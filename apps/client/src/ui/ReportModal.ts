import { authService } from '../services/auth';
import { SERVER_URL } from '../config';
import { showToast } from './ToastNotification';
import { escapeHtml } from '../utils/escapeHtml';

export interface ReportModalOptions {
  targetUserId: string;
  targetUsername: string;
}

export class ReportModal {
  private static overlay: HTMLElement | null = null;

  static show(options: ReportModalOptions): void {
    ReportModal.dismiss();

    const overlay = document.createElement('div');
    overlay.id = 'report-modal-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      z-index: 10001; font-family: Calibri, sans-serif;
    `;

    overlay.innerHTML = `
      <div style="
        background: #1a1a2e; border: 1px solid #e74c3c; border-radius: 14px;
        color: #fff; width: min(440px, 92vw); padding: 22px;
        box-shadow: 0 12px 48px rgba(0,0,0,0.8);
      ">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
          <h3 style="margin:0; font-size:1.15rem; color:#e74c3c; display:flex; align-items:center; gap:8px;">
            <span>⚠️</span> Report Player
          </h3>
          <button id="report-close-btn" style="background:none; border:none; color:#888; font-size:1.2rem; cursor:pointer;">✕</button>
        </div>

        <p style="margin:0 0 14px; font-size:0.875rem; color:#bbb;">
          Reporting <strong style="color:#fff;">${escapeHtml(options.targetUsername)}</strong> for violating community guidelines.
        </p>

        <div style="display:flex; flex-direction:column; gap:12px;">
          <div>
            <label style="display:block; font-size:0.8rem; color:#aaa; margin-bottom:4px;">Violation Reason</label>
            <select id="report-reason-select" style="
              width:100%; box-sizing:border-box; padding:9px 12px; border-radius:8px;
              background:#161b33; border:1px solid rgba(255,255,255,0.15); color:#fff;
              font-family:inherit; font-size:0.875rem;
            ">
              <option value="HARASSMENT">Harassment or Bullying</option>
              <option value="SPAM">Spam or Unsolicited Promotion</option>
              <option value="INAPPROPRIATE_CONTENT">Inappropriate Language or Content</option>
              <option value="IMPERSONATION">Impersonating Staff or Player</option>
              <option value="CHEATING">Cheating or Exploiting</option>
              <option value="OTHER">Other Community Guidelines Violation</option>
            </select>
          </div>

          <div>
            <label style="display:block; font-size:0.8rem; color:#aaa; margin-bottom:4px;">Details (Optional)</label>
            <textarea id="report-description" maxlength="500" rows="4" placeholder="Describe what happened..." style="
              width:100%; box-sizing:border-box; padding:9px 12px; border-radius:8px;
              background:#161b33; border:1px solid rgba(255,255,255,0.15); color:#fff;
              font-family:inherit; font-size:0.875rem; resize:vertical;
            "></textarea>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:6px;">
            <button id="report-cancel-btn" style="
              background:rgba(255,255,255,0.08); border:none; border-radius:8px;
              color:#bbb; padding:8px 16px; cursor:pointer; font-family:inherit;
            ">Cancel</button>
            <button id="report-submit-btn" style="
              background:#e74c3c; border:none; border-radius:8px;
              color:#fff; font-weight:600; padding:8px 18px; cursor:pointer; font-family:inherit;
            ">Submit Report</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    ReportModal.overlay = overlay;

    overlay.querySelector('#report-close-btn')?.addEventListener('click', () => ReportModal.dismiss());
    overlay.querySelector('#report-cancel-btn')?.addEventListener('click', () => ReportModal.dismiss());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) ReportModal.dismiss();
    });

    overlay.querySelector('#report-submit-btn')?.addEventListener('click', async () => {
      const reasonSelect = overlay.querySelector('#report-reason-select') as HTMLSelectElement;
      const descEl = overlay.querySelector('#report-description') as HTMLTextAreaElement;
      const reason = reasonSelect.value;
      const description = descEl.value.trim();
      const submitBtn = overlay.querySelector('#report-submit-btn') as HTMLButtonElement;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';

      try {
        const token = authService.token || (await authService.getToken()) || '';
        const res = await fetch(`${SERVER_URL}/api/reports`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            reportedUserId: options.targetUserId,
            reason,
            description,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          showToast({
            icon: '🛡️',
            title: 'Report Submitted',
            subtitle: 'Thank you. Our moderation team will review this report.',
          });
          ReportModal.dismiss();
        } else {
          showToast({
            icon: '⚠️',
            title: 'Report Failed',
            subtitle: data.error || 'Could not submit report. Please try again.',
          });
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Report';
        }
      } catch {
        showToast({
          icon: '⚠️',
          title: 'Network Error',
          subtitle: 'Could not connect to report service.',
        });
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Report';
      }
    });
  }

  static dismiss(): void {
    if (ReportModal.overlay) {
      ReportModal.overlay.remove();
      ReportModal.overlay = null;
    }
  }
}
