import { authService } from '../services/auth';

type FormMode = 'login' | 'register';

/**
 * loginUI — mounts on DOMContentLoaded.
 *
 * Handles:
 * - Tab switching between login / register forms
 * - Input validation
 * - API calls via authService
 * - Transition to LobbyScene on success
 */
export function mountLoginUI(game: Phaser.Game): void {
  const panel       = document.getElementById('login-panel')!;
  const tabLogin    = document.getElementById('tab-login')!;
  const tabRegister = document.getElementById('tab-register')!;
  const formLogin   = document.getElementById('form-login')!;
  const formReg     = document.getElementById('form-register')!;
  const errEl       = document.getElementById('login-error')!;

  let mode: FormMode = 'login';

  const params = new URLSearchParams(window.location.search);
  if (params.get('verified') === 'true') {
    errEl.style.color = '#4ecdc4';
    errEl.textContent = 'Email verified successfully! Please sign in.';
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  tabLogin.addEventListener('click', () => setMode('login'));
  tabRegister.addEventListener('click', () => setMode('register'));

  function setMode(m: FormMode): void {
    mode = m;
    tabLogin.classList.toggle('tab--active', m === 'login');
    tabRegister.classList.toggle('tab--active', m === 'register');
    formLogin.classList.toggle('hidden', m !== 'login');
    formReg.classList.toggle('hidden', m !== 'register');
    errEl.textContent = '';
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
      showError(err instanceof Error ? err.message : 'Login failed.');
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
      await authService.register(username, email, password, inviteCode);
      showError('Account created! Please check your email to verify before logging in.');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Registration failed.');
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
      document.getElementById('game-container')?.classList.remove('hidden');
      document.getElementById('room-nav')?.classList.remove('hidden');
      document.getElementById('chat-panel')?.classList.remove('hidden');
      game.scene.start('RoomScene', { roomId: loftId, mapKey: 'personal-room' });
      if (!game.scene.isActive('UIScene')) {
        game.scene.launch('UIScene');
      }
    } else {
      game.scene.start('LobbyScene');
    }
  }
}

