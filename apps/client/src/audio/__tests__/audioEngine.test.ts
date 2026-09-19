import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioEngine } from '../AudioEngine';

class MockAudioParam {
  value = 1;
  setValueAtTime = vi.fn((val: number) => {
    this.value = val;
  });
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
}

class MockGainNode {
  gain = new MockAudioParam();
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockOscillatorNode {
  type = 'sine';
  frequency = new MockAudioParam();
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

let activeMockContext: MockAudioContext | null = null;

class MockAudioContext {
  currentTime = 0;
  destination = {};
  createdOscillators: MockOscillatorNode[] = [];
  createdGains: MockGainNode[] = [];

  constructor() {
    activeMockContext = this;
  }

  createGain() {
    const gain = new MockGainNode();
    this.createdGains.push(gain);
    return gain;
  }

  createOscillator() {
    const osc = new MockOscillatorNode();
    this.createdOscillators.push(osc);
    return osc;
  }
}

describe('AudioEngine', () => {
  let engine: AudioEngine;
  let originalAudioContext: any;

  beforeEach(() => {
    localStorage.clear();
    originalAudioContext = (window as any).AudioContext;
    (window as any).AudioContext = MockAudioContext;
    activeMockContext = null;
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
    expect(engine.masterGain?.connect).toHaveBeenCalledWith(activeMockContext?.destination);
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

    expect(activeMockContext?.createdOscillators.length).toBe(1);
    const osc = activeMockContext!.createdOscillators[0];

    expect(osc.type).toBe('sine');
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(80, 0);
    expect(osc.frequency.exponentialRampToValueAtTime).toHaveBeenCalledWith(40, 0.04);
    expect(osc.start).toHaveBeenCalled();
    expect(osc.stop).toHaveBeenCalledWith(0.04);
  });

  it('(f) playCoinPickup() creates 2 oscillator notes (329.6 Hz → 493.9 Hz), ramps gain', () => {
    engine.init();
    engine.playCoinPickup();

    expect(activeMockContext?.createdOscillators.length).toBe(2);
    const [note1, note2] = activeMockContext!.createdOscillators;

    expect(note1.type).toBe('triangle');
    expect(note2.type).toBe('triangle');

    // First note at ~329.6 Hz (E4)
    expect(note1.frequency.setValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(329.6, 1),
      expect.any(Number)
    );
    // Second note at ~493.9 Hz (B4)
    expect(note2.frequency.setValueAtTime).toHaveBeenCalledWith(
      expect.closeTo(493.9, 1),
      expect.any(Number)
    );
  });

  it('(g) playChatMessage() produces sine burst >800 Hz', () => {
    engine.init();
    engine.playChatMessage();

    expect(activeMockContext?.createdOscillators.length).toBe(1);
    const osc = activeMockContext!.createdOscillators[0];

    expect(osc.type).toBe('sine');
    const freq = (osc.frequency.setValueAtTime as any).mock.calls[0][0];
    expect(freq).toBeGreaterThan(800);
    expect(osc.start).toHaveBeenCalled();
  });

  it('(h) When muted: playFootstep() and playCoinPickup() do not create oscillators', () => {
    engine.init();
    engine.setMuted(true);

    engine.playFootstep();
    engine.playCoinPickup();

    expect(activeMockContext?.createdOscillators.length).toBe(0);
  });

  it('Procedural synthesizers: plays furniture place, doorbell, fishing, pet, and trade sounds', () => {
    engine.init();

    engine.playFurniturePlace();
    expect(activeMockContext?.createdOscillators.length).toBe(1);

    engine.playDoorbell();
    expect(activeMockContext?.createdOscillators.length).toBe(2);

    engine.playFishingBite();
    expect(activeMockContext?.createdOscillators.length).toBe(5);

    engine.playFishingCatch();
    expect(activeMockContext?.createdOscillators.length).toBe(9);

    engine.playPetHappy();
    expect(activeMockContext?.createdOscillators.length).toBe(10);

    engine.playTradeComplete();
    expect(activeMockContext?.createdOscillators.length).toBe(11);
  });
});
