import { Resend } from 'resend';
import { AnalyticsService } from './AnalyticsService';

export interface EmailResult {
  sent: boolean;
  reason?: string;
  id?: string;
}

export class EmailService {
  private static resendClient: Resend | null = null;

  private static getClient(): Resend | null {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      return null;
    }
    if (!this.resendClient) {
      this.resendClient = new Resend(process.env.RESEND_API_KEY);
    }
    return this.resendClient;
  }

  /**
   * Dispatches email with strict timeout guard (5000ms) to prevent hanging
   * requests during Resend API latency or outages.
   */
  static async sendWithTimeout(
    payload: { to: string; subject: string; html: string; category: string }
  ): Promise<EmailResult> {
    const client = this.getClient();
    if (!client) {
      return { sent: false, reason: 'RESEND_UNCONFIGURED' };
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      const promise = client.emails.send({
        from: process.env.EMAIL_FROM!,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      });

      const response = await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new Error('Resend email dispatch timed out after 5000ms'))
          );
        }),
      ]);

      clearTimeout(timer);

      void AnalyticsService.trackEvent('EMAIL_SENT', {
        payload: {
          category: payload.category,
          toMasked: payload.to.replace(/(?<=^.).*(?=@)/, '***'),
        },
      });

      return { sent: true, id: (response as any)?.data?.id ?? 'sent' };
    } catch (err: any) {
      console.error(`[EmailService] Failed to send ${payload.category} email:`, err?.message ?? err);
      return { sent: false, reason: err?.message || 'UNKNOWN_ERROR' };
    }
  }

  static async sendVerificationEmail(
    email: string,
    username: string,
    token: string
  ): Promise<EmailResult> {
    const serverUrl = process.env.SERVER_URL || 'https://147-224-184-148.nip.io';
    const verifyUrl = `${serverUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;

    return this.sendWithTimeout({
      to: email,
      subject: 'Verify your HavenWorld account',
      category: 'VERIFICATION',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0d0d1a;color:#fff;border-radius:16px;">
          <h1 style="color:#4ecdc4;">Welcome to HavenWorld, ${username}!</h1>
          <p>Click the button below to verify your email and enter the world.</p>
          <a href="${verifyUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#4ecdc4;color:#0d0d1a;text-decoration:none;border-radius:8px;font-weight:bold;">
            Verify My Account
          </a>
          <p style="color:#aaa;font-size:0.85rem;">
            Link expires in 48 hours. If you didn't create this account, ignore this email.
          </p>
        </div>
      `,
    });
  }

  static async sendPasswordResetEmail(
    email: string,
    username: string,
    resetToken: string
  ): Promise<EmailResult> {
    const clientUrl = process.env.CLIENT_URL || 'https://havenworld-game.pages.dev';
    const resetUrl = `${clientUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;

    return this.sendWithTimeout({
      to: email,
      subject: 'Reset your HavenWorld password',
      category: 'PASSWORD_RESET',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0d0d1a;color:#fff;border-radius:16px;">
          <h1 style="color:#ff6b6b;">Password Reset Request</h1>
          <p>Hello ${username}, we received a request to reset your HavenWorld account password.</p>
          <a href="${resetUrl}" style="display:inline-block;margin:24px 0;padding:14px 28px;background:#ff6b6b;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">
            Reset Password
          </a>
          <p style="color:#aaa;font-size:0.85rem;">
            If you did not request this, please secure your account immediately. This link expires in 1 hour.
          </p>
        </div>
      `,
    });
  }

  static async sendSecurityAlertEmail(
    email: string,
    username: string,
    action: string,
    ipAddress: string
  ): Promise<EmailResult> {
    return this.sendWithTimeout({
      to: email,
      subject: `HavenWorld Security Alert: ${action}`,
      category: 'SECURITY_ALERT',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#0d0d1a;color:#fff;border-radius:16px;">
          <h1 style="color:#feca57;">Security Notification</h1>
          <p>Hello ${username}, an account activity occurred: <strong>${action}</strong>.</p>
          <p style="color:#ccc;">IP Address: ${ipAddress}</p>
          <p style="color:#aaa;font-size:0.85rem;">
            If you do not recognize this activity, change your password immediately.
          </p>
        </div>
      `,
    });
  }
}
