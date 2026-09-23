export type PlayerPresenceState = 'ACTIVE' | 'IDLE' | 'AFK';

export interface IdleStateListener {
  (state: PlayerPresenceState): void;
}

export class IdleStateManager {
  public currentState: PlayerPresenceState = 'ACTIVE';
  public lastActiveTimestamp: number = Date.now();
  public idleTimeoutMs: number;
  public afkTimeoutMs: number;
  private listeners: Set<IdleStateListener> = new Set();

  constructor(idleTimeoutMs: number = 60_000, afkTimeoutMs: number = 300_000) {
    this.idleTimeoutMs = idleTimeoutMs;
    this.afkTimeoutMs = afkTimeoutMs;
  }

  /**
   * Resets idle timer on user interaction
   */
  public reportActivity(): void {
    this.lastActiveTimestamp = Date.now();
    if (this.currentState !== 'ACTIVE') {
      this.setState('ACTIVE');
    }
  }

  /**
   * Evaluates elapsed inactivity against configured timeouts
   */
  public checkInactivity(now: number = Date.now()): PlayerPresenceState {
    const elapsed = now - this.lastActiveTimestamp;

    if (elapsed >= this.afkTimeoutMs) {
      if (this.currentState !== 'AFK') {
        this.setState('AFK');
      }
    } else if (elapsed >= this.idleTimeoutMs) {
      if (this.currentState !== 'IDLE') {
        this.setState('IDLE');
      }
    } else {
      if (this.currentState !== 'ACTIVE') {
        this.setState('ACTIVE');
      }
    }

    return this.currentState;
  }

  public subscribe(listener: IdleStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(newState: PlayerPresenceState): void {
    this.currentState = newState;
    for (const listener of this.listeners) {
      listener(newState);
    }
  }
}
