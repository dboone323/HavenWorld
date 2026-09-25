import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioEngine } from '../AudioEngine';

class FunctionalAudioParam {
  value = 1;
  history: Array<{ type: string; value: number; time: number }> = [];

  setValueAtTime(val: number, time: number) {
    this.value = val;
    this.history.push({ type: 'setValueAtTime', value: val, time });
  }

  linearRampToValueAtTime(val: number, time: number) {
    this.value = val;
    this.history.push({ type: 'linearRampToValueAtTime', value: val, time });
  }

  exponentialRampToValueAtTime(val: number, time: number) {
    this.value = val;
    this.history.push({ type: 'exponentialRampToValueAtTime', value: val, time });
  }
}

class FunctionalGainNode {
  gain = new FunctionalAudioParam();
  connectedTo: any[] = [];
  disconnected = false;

  connect(destination: any) {
    this.connectedTo.push(destination);
  }

  disconnect() {
    this.disconnected = true;
    this.connectedTo = [];
  }
}

class FunctionalOscillatorNode {
  type = 'sine';
  frequency = new FunctionalAudioParam();
  connectedTo: any[] = [];
  started = false;
  startTime = 0;
  stopped = false;
  stopTime = 0;

  connect(destination: any) {
    this.connectedTo.push(destination);
  }

  disconnect() {
    this.connectedTo = [];
  }

  start(time = 0) {
    this.started = true;
    this.startTime = time;
  }

  stop(time = 0) {
    this.stopped = true;
    this.stopTime = time;
  }
}

let activeFunctionalContext: FunctionalAudioContext | null = null;

class FunctionalAudioContext {
  currentTime = 0;
  destination = { name: 'FunctionalAudioDestination' };
  createdOscillators: FunctionalOscillatorNode[] = [];
  createdGains: FunctionalGainNode[] = [];
  state: AudioContextState = 'running';

  constructor() {
    activeFunctionalContext = this;
  }

  createGain() {
    const gain = new FunctionalGainNode();
    this.createdGains.push(gain);
    return gain as unknown as GainNode;
  }

  createOscillator() {
    const osc = new FunctionalOscillatorNode();
    this.createdOscillators.push(osc);
    return osc as unknown as OscillatorNode;
  }

  async resume() {
    this.state = 'running';
  }
}

describe('AudioEngine', () => {
  let engine: AudioEngine;
  let originalAudioContext: any;

  beforeEach(() => {
    localStorage.clear();
    originalAudioContext = (window as any).AudioContext;
    (window as any).AudioContext = FunctionalAudioContext;
    activeFunctionalContext = null;
    engine = new AudioEngine();
  });

  afterEach(() => {
    (window as any).AudioContext = originalAudioContext;
  });

  it('(a) init() creates AudioContext and sets masterGain node', () => {
    expect(engine.ctx).toBeNull();
    expect(engine.masterGain).toBeNull();

    engine.init();

    expect(engine.ctx).not.toBeNull();
    expect(engine.masterGain).not.toBeNull();
    const functionalMasterGain = engine.masterGain as unknown as FunctionalGainNode;
    expect(functionalMasterGain.connectedTo).toContain(activeFunctionalContext?.destination);
  });

  it('(b) setVolume(0.5) updates masterGain.gain.value = 0.5', () => {
    engine.init();
    engine.setVolume(0.5);

    expect(engine.volume).toBe(0.5);
    expect(engine.masterGain?.gain.value).toBe(0.5);
  });

  it('(c) setVolume(1.5) clamped to 1.0; setVolume(-0.5) clamped to 0.0', () => {
    engine.init();

    engine.setVolume(1.5);
    expect(engine.volume).toBe(1.0);
    expect(engine.masterGain?.gain.value).toBe(1.0);

    engine.setVolume(-0.5);
    expect(engine.volume).toBe(0.0);
    expect(engine.masterGain?.gain.value).toBe(0.0);
  });

  it('(d) setMuted(true) sets gain to 0; setMuted(false) restores previous volume', () => {
    engine.init();
    engine.setVolume(0.8);

    engine.setMuted(true);
    expect(engine.isMuted).toBe(true);
    expect(engine.masterGain?.gain.value).toBe(0);

    engine.setMuted(false);
    expect(engine.isMuted).toBe(false);
    expect(engine.masterGain?.gain.value).toBe(0.8);
  });

  it('(e) playFootstep() creates oscillator, ramps frequency down, stops after duration', () => {
    engine.init();
    engine.playFootstep();

    expect(activeFunctionalContext?.createdOscillators.length).toBe(1);
    const osc = activeFunctionalContext!.createdOscillators[0];

    expect(osc.type).toBe('sine');
    expect(osc.frequency.history).toEqual(
      expect.arrayContaining([
        { type: 'setValueAtTime', value: 80, time: 0 },
        { type: 'exponentialRampToValueAtTime', value: 40, time: 0.04 },
      ])
    );
    expect(osc.started).toBe(true);
    expect(osc.stopped).toBe(true);
    expect(osc.stopTime).toBe(0.04);
  });

  it('(f) playCoinPickup() creates 2 oscillator notes (329.6 Hz → 493.9 Hz), ramps gain', () => {
    engine.init();
    engine.playCoinPickup();

    expect(activeFunctionalContext?.createdOscillators.length).toBe(2);
    const [note1, note2] = activeFunctionalContext!.createdOscillators;

    expect(note1.type).toBe('triangle');
    expect(note2.type).toBe('triangle');

    // First note at ~329.6 Hz (E4)
    const note1Set = note1.frequency.history.find((h) => h.type === 'setValueAtTime');
    expect(note1Set).toBeDefined();
    expect(note1Set!.value).toBeCloseTo(329.6, 1);

    // Second note at ~493.9 Hz (B4)
    const note2Set = note2.frequency.history.find((h) => h.type === 'setValueAtTime');
    expect(note2Set).toBeDefined();
    expect(note2Set!.value).toBeCloseTo(493.9, 1);
  });

  it('(g) playChatMessage() produces sine burst >800 Hz', () => {
    engine.init();
    engine.playChatMessage();

    expect(activeFunctionalContext?.createdOscillators.length).toBe(1);
    const osc = activeFunctionalContext!.createdOscillators[0];

    expect(osc.type).toBe('sine');
    const setEvent = osc.frequency.history.find((h) => h.type === 'setValueAtTime');
    expect(setEvent).toBeDefined();
    expect(setEvent!.value).toBeGreaterThan(800);
    expect(osc.started).toBe(true);
  });

  it('(h) When muted: playFootstep() and playCoinPickup() do not create oscillators', () => {
    engine.init();
    engine.setMuted(true);

    engine.playFootstep();
    engine.playCoinPickup();

    expect(activeFunctionalContext?.createdOscillators.length).toBe(0);
  });

  it('Procedural synthesizers: plays furniture place, doorbell, fishing, pet, and trade sounds', () => {
    engine.init();

    engine.playFurniturePlace();
    expect(activeFunctionalContext?.createdOscillators.length).toBe(1);

    engine.playDoorbell();
    expect(activeFunctionalContext?.createdOscillators.length).toBe(2);

    engine.playFishingBite();
    expect(activeFunctionalContext?.createdOscillators.length).toBe(5);

    engine.playFishingCatch();
    expect(activeFunctionalContext?.createdOscillators.length).toBe(9);

    engine.playPetHappy();
    expect(activeFunctionalContext?.createdOscillators.length).toBe(10);

    engine.playTradeComplete();
    expect(activeFunctionalContext?.createdOscillators.length).toBe(11);
  });
});
