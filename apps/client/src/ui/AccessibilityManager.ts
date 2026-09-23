export type ColorblindMode = 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'high_contrast';
export type UiScale = 1.0 | 1.25 | 1.5;

export interface AccessibilitySettings {
  uiScale: UiScale;
  colorblindMode: ColorblindMode;
  dyslexiaFont: boolean;
  reducedMotion: boolean;
}

const STORAGE_KEY = 'havenworld_a11y_settings';

export class AccessibilityManager {
  private static instance: AccessibilityManager | null = null;
  public settings: AccessibilitySettings = {
    uiScale: 1.0,
    colorblindMode: 'none',
    dyslexiaFont: false,
    reducedMotion: false,
  };

  private constructor() {
    this.load();
  }

  static getInstance(): AccessibilityManager {
    if (!this.instance) {
      this.instance = new AccessibilityManager();
    }
    return this.instance;
  }

  load(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.settings = { ...this.settings, ...JSON.parse(raw) };
      }
    } catch {
      /* ignore */
    }
  }

  save(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  setUiScale(scale: UiScale): void {
    this.settings.uiScale = scale;
    this.applyToDOM();
    this.save();
  }

  setColorblindMode(mode: ColorblindMode): void {
    this.settings.colorblindMode = mode;
    this.applyToDOM();
    this.save();
  }

  setDyslexiaFont(enabled: boolean): void {
    this.settings.dyslexiaFont = enabled;
    this.applyToDOM();
    this.save();
  }

  /**
   * Applies active accessibility configuration to document root variables
   */
  applyToDOM(): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    root.style.setProperty('--ui-scale', `${this.settings.uiScale}`);

    // Colorblind filter settings
    switch (this.settings.colorblindMode) {
      case 'protanopia':
        root.style.setProperty('--colorblind-filter', 'url(#protanopia-filter)');
        break;
      case 'deuteranopia':
        root.style.setProperty('--colorblind-filter', 'url(#deuteranopia-filter)');
        break;
      case 'tritanopia':
        root.style.setProperty('--colorblind-filter', 'url(#tritanopia-filter)');
        break;
      case 'high_contrast':
        root.style.setProperty('--chat-contrast', '1.4');
        root.style.setProperty('--colorblind-filter', 'contrast(135%) saturate(120%)');
        break;
      default:
        root.style.removeProperty('--colorblind-filter');
        root.style.removeProperty('--chat-contrast');
        break;
    }

    if (this.settings.dyslexiaFont) {
      root.classList.add('dyslexia-font');
    } else {
      root.classList.remove('dyslexia-font');
    }
  }
}
