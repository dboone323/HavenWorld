import { authService } from '../services/auth';
import { SceneManager } from '../engine/SceneManager';

type FormMode = 'login' | 'register' | 'forgot' | 'reset';

/**
 * loginUI — mounts on DOMContentLoaded.
 *
 * Handles:
 * - Tab switching between login / register forms
 * - Forgot password and token reset flows
 * - Input validation
 * - API calls via authService
 * - Transition to LobbyScene or RoomScene on success
 */
export function mountLoginUI(): void {
  const panel       = document.getElementById('login-panel')!;
  const tabLogin    = document.getElementById('tab-login')!;
  const tabRegister = document.getElementById('tab-register')!;
  const formLogin   = document.getElementById('form-login')!;
  const formReg     = document.getElementById('form-register')!;
  const formForgot  = document.getElementById('form-forgot');
  const formReset   = document.getElementById('form-reset');
  const btnForgot   = document.getElementById('btn-forgot-password');
  const btnCancelForgot = document.getElementById('forgot-cancel');
  const resetTokenInput = document.getElementById('reset-token') as HTMLInputElement | null;
  const errEl       = document.getElementById('login-error')!;

  let mode: FormMode = 'login';

  const params = new URLSearchParams(window.location.search);
  if (params.get('verified') === 'true') {
    errEl.style.color = '#4ecdc4';
    errEl.textContent = 'Email verified successfully! Please sign in.';
  }

  const resetTokenParam = params.get('token') || params.get('resetToken');
  if (resetTokenParam && resetTokenInput) {
    resetTokenInput.value = resetTokenParam;
    setMode('reset');
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  tabLogin.addEventListener('click', () => setMode('login'));
  tabRegister.addEventListener('click', () => setMode('register'));
  btnForgot?.addEventListener('click', () => setMode('forgot'));
  btnCancelForgot?.addEventListener('click', () => setMode('login'));

  function setMode(m: FormMode): void {
    mode = m;
    tabLogin.classList.toggle('tab--active', m === 'login');
    tabRegister.classList.toggle('tab--active', m === 'register');
    formLogin.classList.toggle('hidden', m !== 'login');
    formReg.classList.toggle('hidden', m !== 'register');
    formForgot?.classList.toggle('hidden', m !== 'forgot');
    formReset?.classList.toggle('hidden', m !== 'reset');

    const tabsContainer = panel.querySelector<HTMLElement>('.login-tabs');
    if (tabsContainer) {
      tabsContainer.style.display = (m === 'forgot' || m === 'reset') ? 'none' : 'flex';
    }

    errEl.textContent = '';
    document.getElementById('btn-resend-verification')?.remove();
  }

  /** Shown when login fails with EMAIL_NOT_VERIFIED: gives users a way out of
   *  the lockout without hunting for a lost email (audit finding #3). */
  function showResendOption(email: string): void {
    if (document.getElementById('btn-resend-verification')) return;
    const btn = document.createElement('button');
    btn.id = 'btn-resend-verification';
    btn.type = 'button';
    btn.textContent = 'Resend verification email';
    btn.style.cssText =
      'display:block; margin-top:8px; background:none; border:none; color:#4ecdc4; cursor:pointer; text-decoration:underline; font-size:0.9rem;';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        await authService.resendVerification(email);
        errEl.style.color = '#4ecdc4';
        showError('If that address has an unverified account, a new email is on its way.');
      } catch {
        errEl.style.color = '#f87171';
        showError('Could not send the email. Please try again later.');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Resend verification email';
      }
    });
    errEl.insertAdjacentElement('afterend', btn);
  }

  // ── Login form ────────────────────────────────────────────────────────────
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email    = (document.getElementById('login-email')    as HTMLInputElement).value.trim();
    const password = (document.getElementById('login-password') as HTMLInputElement).value;

    if (!email || !password) {
      showError('Email and password are required.');
      return;
    }

    setLoading(true);
    try {
      await authService.login(email, password);
      transitionToLobby();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed.';
      showError(msg);
      if (/verify your email/i.test(msg)) {
        showResendOption(email);
      }
    } finally {
      setLoading(false);
    }
  });

  // ── Register form ─────────────────────────────────────────────────────────
  formReg.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = (document.getElementById('reg-username') as HTMLInputElement).value.trim();
    const email    = (document.getElementById('reg-email')    as HTMLInputElement).value.trim();
    const password = (document.getElementById('reg-password') as HTMLInputElement).value;
    const confirm  = (document.getElementById('reg-confirm')  as HTMLInputElement).value;
    const inviteEl = document.getElementById('reg-invite') as HTMLInputElement | null;
    const inviteCode = inviteEl?.value.trim() || undefined;

    if (!username || !email || !password) {
      showError('All fields are required.');
      return;
    }
    if (password !== confirm) {
      showError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      showError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);
    try {
      const result = await authService.register(username, email, password, inviteCode);
      if (result && result.emailVerificationRequired === false) {
        // Server auto-verified the account (no email provider configured) and
        // already established a session — take the player straight into the
        // world instead of leaving them on the register form. (The register
        // response carries no user payload, so fetch it before transitioning.)
        errEl.style.color = '#4ecdc4';
        showError(result.message || 'Account created! Welcome to HavenWorld.');
        await authService.me();
        transitionToLobby();
      } else {
        // Verification is required: the server sends a real email. Show its
        // message verbatim rather than a hardcoded guess about the flow.
        errEl.style.color = '';
        showError(result?.message || 'Account created! Please check your email to verify before logging in.');
      }
    } catch (err) {
      errEl.style.color = '';
      showError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  });

  // ── Forgot password form ──────────────────────────────────────────────────
  formForgot?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (document.getElementById('forgot-email') as HTMLInputElement).value.trim();
    if (!email) {
      errEl.style.color = '#f87171';
      showError('Please enter your email address.');
      return;
    }
    setLoading(true);
    try {
      const res = await authService.forgotPassword(email);
      errEl.style.color = '#4ecdc4';
      showError(res.message || 'If an account exists with that email, a password reset link has been sent.');
    } catch (err) {
      errEl.style.color = '#f87171';
      showError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setLoading(false);
    }
  });

  // ── Reset password form ───────────────────────────────────────────────────
  formReset?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = resetTokenInput?.value || '';
    const password = (document.getElementById('reset-password') as HTMLInputElement).value;
    const confirm = (document.getElementById('reset-confirm') as HTMLInputElement).value;

    if (!token) {
      errEl.style.color = '#f87171';
      showError('Reset token missing. Please use the link provided in your email.');
      return;
    }
    if (password.length < 8) {
      errEl.style.color = '#f87171';
      showError('Password must be at least 8 characters.');
      return;
    }
    if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      errEl.style.color = '#f87171';
      showError('Password must contain at least one uppercase letter and one number.');
      return;
    }
    if (password !== confirm) {
      errEl.style.color = '#f87171';
      showError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await authService.resetPassword(token, password);
      errEl.style.color = '#4ecdc4';
      showError(res.message || 'Password reset successfully. Please sign in.');
      setMode('login');
    } catch (err) {
      errEl.style.color = '#f87171';
      showError(err instanceof Error ? err.message : 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────

  function showError(msg: string): void {
    errEl.textContent = msg;
  }

  function setLoading(loading: boolean): void {
    panel.querySelectorAll<HTMLButtonElement>('button[type="submit"]').forEach(btn => {
      btn.disabled = loading;
      btn.textContent = loading ? 'Please wait…' : btn.dataset.label ?? 'Submit';
    });
  }

  function transitionToLobby(): void {
    // Show player card
    const pc = document.getElementById('player-card');
    const user = authService.user;
    if (pc && user) {
      const usernameEl = pc.querySelector('.player-card__username');
      if (usernameEl) usernameEl.textContent = user.username;
      pc.classList.remove('hidden');
    }

    panel.classList.add('hidden');

    const loftId = user?.personalRoom?.id;
    if (loftId) {
      SceneManager.getInstance().switchTo('room', { roomId: loftId }).catch(console.error);
    } else {
      SceneManager.getInstance().switchTo('lobby').catch(console.error);
    }
  }
}

