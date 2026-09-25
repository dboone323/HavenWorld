export type SoundCategory = 'movement' | 'ui' | 'social' | 'gameplay';

export interface AudioSettings {
  masterVolume: number;
  isMuted: boolean;
  categories: Record<SoundCategory, boolean>;
}

const STORAGE_KEY = 'havenworld_audio_settings';

export class AudioEngine {
  private static instance: AudioEngine | null = null;
  public ctx: AudioContext | null = null;
  public masterGain: GainNode | null = null;
  private settings: AudioSettings = {
    masterVolume: 0.7,
    isMuted: false,
    categories: {
      movement: true,
      ui: true,
      social: true,
      gameplay: true,
    },
  };

  constructor() {
    this.loadSettings();
    if (typeof window !== 'undefined') {
      // Unlock AudioContext on first user interaction
      const unlock = () => {
        this.initContext();
        window.removeEventListener('click', unlock);
        window.removeEventListener('keydown', unlock);
        window.removeEventListener('touchstart', unlock);
      };
      window.addEventListener('click', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
      window.addEventListener('touchstart', unlock, { once: true });
    }
  }

  static getInstance(): AudioEngine {
    if (!this.instance) {
      this.instance = new AudioEngine();
    }
    return this.instance;
  }

  public init(): void {
    this.initContext();
  }

  private initContext(): void {
    if (this.ctx) return;
    const AudioCtx = (typeof window !== 'undefined' ? (window.AudioContext || (window as any).webkitAudioContext) : null);
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    const targetVolume = this.settings.isMuted ? 0 : this.settings.masterVolume;
    this.masterGain.gain.value = targetVolume;
    if (this.masterGain.gain.setValueAtTime) {
      this.masterGain.gain.setValueAtTime(targetVolume, this.ctx.currentTime);
    }
    this.masterGain.connect(this.ctx.destination);
  }

  private loadSettings(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.settings = { ...this.settings, ...JSON.parse(raw) };
      }
    } catch {
      /* ignore */
    }
  }

  saveSettings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
      if (this.masterGain && this.ctx) {
        const targetGain = this.settings.isMuted ? 0 : this.settings.masterVolume;
        this.masterGain.gain.value = targetGain;
        if (this.masterGain.gain.setValueAtTime) {
          this.masterGain.gain.setValueAtTime(
            targetGain,
            this.ctx.currentTime
          );
        }
      }
    } catch {
      /* ignore */
    }
  }

  setVolume(volume: number): void {
    this.settings.masterVolume = Math.max(0, Math.min(1, volume));
    this.saveSettings();
  }

  setMuted(muted: boolean): void {
    this.settings.isMuted = muted;
    this.saveSettings();
  }

  get isMuted(): boolean {
    return this.settings.isMuted;
  }

  get volume(): number {
    return this.settings.masterVolume;
  }

  // ── Procedural Sound Synthesizers ──────────────────────────────────────────

  /** Footstep: low frequency sine burst (80 Hz, 40ms) */
  playFootstep(): void {
    if (!this.canPlay('movement')) return;
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.04);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(ctx.currentTime + 0.04);
  }

  /** Coin Pickup: harmonic triangle chime (329.6 Hz -> 493.9 Hz, 2 notes) */
  playCoinPickup(): void {
    if (!this.canPlay('gameplay')) return;
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    const notes = [329.63, 493.88];
    notes.forEach((freq, idx) => {
      const now = ctx.currentTime + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc.start(now);
      osc.stop(now + 0.15);
    });
  }

  /** Furniture Place: sine decay pop (200 Hz -> 50 Hz over 80ms) */
  playFurniturePlace(): void {
    if (!this.canPlay('ui')) return;
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.08);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.08);
  }

  /** Chat Message: warm notification chime (880 Hz, 5ms attack, 200ms decay) */
  playChatMessage(): void {
    if (!this.canPlay('social')) return;
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now); // A5

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.2);
  }

  /** Doorbell: classic dual square wave chime (C5 -> G5, 150ms each) */
  playDoorbell(): void {
    if (!this.canPlay('social')) return;
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(523.25, now); // C5
    osc.frequency.setValueAtTime(783.99, now + 0.15); // G5

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.35);
  }

  /** Fishing Bite: ascending arpeggio (E4, G4, B4) */
  playFishingBite(): void {
    if (!this.canPlay('gameplay')) return;
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    const notes = [329.63, 392.0, 493.88]; // E4, G4, B4
    notes.forEach((freq, idx) => {
      const now = ctx.currentTime + idx * 0.06;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc.start(now);
      osc.stop(now + 0.08);
    });
  }

  /** Fishing Catch: victory fanfare (C5, E5, G5, C6) */
  playFishingCatch(): void {
    if (!this.canPlay('gameplay')) return;
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      const now = ctx.currentTime + idx * 0.1;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc.start(now);
      osc.stop(now + 0.15);
    });
  }

  /** Pet Happy: cheerful dual squeak */
  playPetHappy(): void {
    if (!this.canPlay('social')) return;
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046.5, now); // C6
    osc.frequency.linearRampToValueAtTime(1318.51, now + 0.06); // E6

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.08);
  }

  /** Trade Complete: sharp confirmation bell (1047 Hz) */
  playTradeComplete(): void {
    if (!this.canPlay('gameplay')) return;
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046.5, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.3);
  }

  /** Tactile UI / Interaction Click: crisp short sine transient (750 Hz, 30ms) */
  playClick(): void {
    if (!this.canPlay('ui')) return;
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(750, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.03);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.03);
  }

  /** Error / Rejection Tone: descending buzz (180 Hz -> 110 Hz, 180ms) */
  playError(): void {
    if (!this.canPlay('ui')) return;
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.18);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(now);
    osc.stop(now + 0.18);
  }

  /** Success / Achievement Chime: ascending major triad (523 Hz -> 659 Hz -> 784 Hz) */
  playSuccess(): void {
    if (!this.canPlay('gameplay')) return;
    const ctx = this.ctx;
    if (!ctx || !this.masterGain) return;

    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, idx) => {
      const now = ctx.currentTime + idx * 0.07;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc.start(now);
      osc.stop(now + 0.16);
    });
  }

  private canPlay(category: SoundCategory): boolean {
    if (this.settings.isMuted) return false;
    if (!this.settings.categories[category]) return false;
    if (!this.ctx) this.initContext();
    return true;
  }
}

export const audioEngine = AudioEngine.getInstance();
