/**
 * WebGLError — friendly full-screen messaging when the 3D engine cannot run.
 *
 * Two cases:
 *  1. `showWebGLUnsupported` — WebGL is not available at all (old browser,
 *     disabled hardware acceleration, headless). Shown instead of the login
 *     panel so the player gets an explanation rather than a frozen canvas.
 *  2. `showContextLostOverlay` / `hideContextLostOverlay` — the GPU context
 *     is lost mid-session (driver reset, tab eviction). The render loop is
 *     dead until Babylon restores the context, so show a "graphics paused"
 *     overlay instead of a frozen world.
 *
 * Styled to match the rest of the HavenWorld UI (dark glass panels, teal
 * accents) — see InstallPrompt.ts for the reference palette.
 */

const UNSUPPORTED_ID = 'webgl-unsupported-screen';
const OVERLAY_ID = 'webgl-context-overlay';

function panelStyle(el: HTMLElement, fullScreen: boolean): void {
  el.style.position = 'fixed';
  el.style.inset = '0';
  el.style.zIndex = '10000';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.background = fullScreen ? '#0d0d1a' : 'rgba(13, 13, 26, 0.82)';
  el.style.backdropFilter = 'blur(4px)';
  el.style.fontFamily = "'Segoe UI', system-ui, -apple-system, sans-serif";
}

function cardStyle(el: HTMLElement): void {
  el.style.maxWidth = '520px';
  el.style.margin = '24px';
  el.style.padding = '36px 40px';
  el.style.background = 'rgba(26, 26, 46, 0.96)';
  el.style.border = '1px solid rgba(78, 205, 196, 0.35)';
  el.style.borderRadius = '16px';
  el.style.boxShadow = '0 24px 64px rgba(0, 0, 0, 0.55)';
  el.style.textAlign = 'center';
  el.style.color = '#e8e8f0';
}

/**
 * Show the "WebGL unavailable" screen and hide everything else. This is a
 * terminal state — there is nothing the app can render without WebGL.
 */
export function showWebGLUnsupported(reason: string): void {
  if (document.getElementById(UNSUPPORTED_ID)) return;

  // Hide the normal UI chrome so the error is all the player sees.
  document.getElementById('login-panel')?.classList.add('hidden');
  document.getElementById('game-container')?.classList.add('hidden');
  document.getElementById('lobby-panel')?.classList.add('hidden');

  const screen = document.createElement('div');
  screen.id = UNSUPPORTED_ID;
  screen.setAttribute('data-testid', 'webgl-error-screen');
  panelStyle(screen, true);

  const card = document.createElement('div');
  cardStyle(card);

  const icon = document.createElement('div');
  icon.textContent = '🖥️';
  icon.style.fontSize = '52px';
  icon.style.marginBottom = '16px';

  const title = document.createElement('h1');
  title.textContent = '3D Graphics Unavailable';
  title.style.margin = '0 0 12px';
  title.style.fontSize = '26px';
  title.style.fontWeight = '700';
  title.style.color = '#4ecdc4';

  const message = document.createElement('p');
  message.textContent = reason;
  message.style.margin = '0 0 16px';
  message.style.fontSize = '15px';
  message.style.lineHeight = '1.6';
  message.style.color = '#c9c9d6';

  const advice = document.createElement('p');
  advice.innerHTML =
    'HavenWorld needs WebGL to render the 3D world. Try a recent version of ' +
    'Chrome, Edge, Firefox, or Safari, and make sure <strong>hardware acceleration</strong> ' +
    'is enabled in your browser settings.';
  advice.style.margin = '0';
  advice.style.fontSize = '14px';
  advice.style.lineHeight = '1.6';
  advice.style.color = '#9a9ab0';

  card.append(icon, title, message, advice);
  screen.append(card);
  document.body.append(screen);
}

/** Show the transient "graphics paused" overlay while the GPU context is lost. */
export function showContextLostOverlay(): void {
  if (document.getElementById(OVERLAY_ID)) return;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('data-testid', 'webgl-context-overlay');
  panelStyle(overlay, false);

  const card = document.createElement('div');
  cardStyle(card);

  const spinner = document.createElement('div');
  spinner.textContent = '⏳';
  spinner.style.fontSize = '44px';
  spinner.style.marginBottom = '14px';

  const title = document.createElement('h2');
  title.textContent = 'Graphics paused';
  title.style.margin = '0 0 8px';
  title.style.fontSize = '21px';
  title.style.fontWeight = '700';
  title.style.color = '#4ecdc4';

  const message = document.createElement('p');
  message.textContent =
    'The graphics device was reset (this can happen when the GPU is busy or the tab was ' +
    'in the background). HavenWorld is restoring the 3D world — your session is safe.';
  message.style.margin = '0';
  message.style.fontSize = '14px';
  message.style.lineHeight = '1.6';
  message.style.color = '#c9c9d6';

  card.append(spinner, title, message);
  overlay.append(card);
  document.body.append(overlay);
}

/** Hide the context-lost overlay once the GPU context is restored. */
export function hideContextLostOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();
}
