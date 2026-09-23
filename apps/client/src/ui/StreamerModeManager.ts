export class StreamerModeManager {
  private static isEnabled: boolean = false;

  static setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (typeof document !== 'undefined') {
      if (enabled) {
        document.documentElement.classList.add('streamer-mode');
      } else {
        document.documentElement.classList.remove('streamer-mode');
      }
    }
  }

  static getIsEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Masks sensitive information when streamer mode is active
   */
  static maskSensitiveText(text: string | number, maskChar: string = '•'): string {
    if (!this.isEnabled) return String(text);
    return maskChar.repeat(6);
  }

  /**
   * Sanitizes private whispers or direct chat for streamers
   */
  static sanitizeWhisper(content: string): string {
    if (!this.isEnabled) return content;
    return '[Whisper Hidden - Streamer Mode]';
  }
}
