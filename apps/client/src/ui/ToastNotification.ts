/**
 * ToastNotification — singleton utility for short-lived in-game notifications.
 * Usage: showToast({ icon: '🏆', title: 'Achievement Unlocked!', subtitle: 'First Fish', durationMs: 4000 })
 */

export interface ToastOptions {
  icon?: string;
  title: string;
  subtitle?: string;
  durationMs?: number;
}

let container: HTMLElement | null = null;

function getContainer(): HTMLElement {
  if (!container) {
    container = document.createElement('div');
    container.id = 'haven-toast-container';
    container.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    `;
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(
  optionsOrTitle: ToastOptions | string,
  iconArg?: string
): void {
  const options: ToastOptions =
    typeof optionsOrTitle === 'string'
      ? { title: optionsOrTitle, icon: iconArg || '✨' }
      : optionsOrTitle;

  const { icon = '✨', title, subtitle, durationMs = 4000 } = options;
  const c = getContainer();
  const toast = document.createElement('div');
  toast.className = 'haven-toast toast';
  toast.style.cssText = `
    background: rgba(20, 20, 35, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 240px;
    max-width: 320px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    pointer-events: auto;
    opacity: 0;
    transform: translateX(20px);
    transition: opacity 0.25s ease, transform 0.25s ease;
    color: #fff;
    font-family: inherit;
  `;

  const iconEl = document.createElement('span');
  iconEl.style.cssText = 'font-size: 1.8rem; flex-shrink: 0;';
  iconEl.textContent = icon;

  const textEl = document.createElement('div');
  textEl.style.cssText = 'display: flex; flex-direction: column; gap: 2px;';

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-weight: 600; font-size: 0.875rem;';
  titleEl.textContent = title;
  textEl.appendChild(titleEl);

  if (subtitle) {
    const subEl = document.createElement('div');
    subEl.style.cssText = 'font-size: 0.75rem; color: rgba(255,255,255,0.65);';
    subEl.textContent = subtitle;
    textEl.appendChild(subEl);
  }

  toast.appendChild(iconEl);
  toast.appendChild(textEl);
  c.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    });
  });

  // Auto-dismiss
  const timer = setTimeout(() => dismissToast(toast), durationMs);
  toast.addEventListener('click', () => {
    clearTimeout(timer);
    dismissToast(toast);
  });
}

function dismissToast(toast: HTMLElement): void {
  toast.style.opacity = '0';
  toast.style.transform = 'translateX(20px)';
  setTimeout(() => toast.remove(), 300);
}
