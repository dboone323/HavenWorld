export interface TypingStateListener {
  (isTyping: boolean): void;
}

export class TypingIndicatorManager {
  private isTyping: boolean = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private listeners: Set<TypingStateListener> = new Set();

  constructor(debounceMs: number = 1500) {
    this.debounceMs = debounceMs;
  }

  /**
   * Called on every keydown / input event in the chat text field
   */
  public handleKeystroke(): void {
    if (!this.isTyping) {
      this.isTyping = true;
      this.notify(true);
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.stopTyping();
    }, this.debounceMs);
  }

  /**
   * Manually stops typing state (e.g., when message sent or input blurred)
   */
  public stopTyping(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.isTyping) {
      this.isTyping = false;
      this.notify(false);
    }
  }

  public getIsTyping(): boolean {
    return this.isTyping;
  }

  public subscribe(listener: TypingStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(isTyping: boolean): void {
    for (const listener of this.listeners) {
      listener(isTyping);
    }
  }
}
