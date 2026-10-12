import { EmailService } from '../EmailService';

describe('Batch 3: EmailService & Resend Gateway', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('fails open cleanly with RESEND_UNCONFIGURED when keys are missing', async () => {
    const res = await EmailService.sendVerificationEmail(
      'player@havenworld.game',
      'PlayerOne',
      'token-verify-123'
    );
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('RESEND_UNCONFIGURED');
  });

  it('handles password reset emails with unconfigured credentials safely', async () => {
    const res = await EmailService.sendPasswordResetEmail(
      'player@havenworld.game',
      'PlayerOne',
      'reset-token-abc'
    );
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('RESEND_UNCONFIGURED');
  });

  it('handles security alert emails with unconfigured credentials safely', async () => {
    const res = await EmailService.sendSecurityAlertEmail(
      'player@havenworld.game',
      'PlayerOne',
      'Password Changed',
      '192.168.1.1'
    );
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('RESEND_UNCONFIGURED');
  });
});
