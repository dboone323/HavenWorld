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

class FunctionalAudioBuffer {
  channels: Float32Array[];
  constructor(numberOfChannels: number, length: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(channel: number) {
    return this.channels[channel];
  }
}

class FunctionalConvolverNode {
  buffer: any = null;
  connectedTo: any[] = [];
  connect(dest: any) {
    this.connectedTo.push(dest);
  }
}

class FunctionalAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  destination = { name: 'FunctionalAudioDestination' };
  createdOscillators: FunctionalOscillatorNode[] = [];
  createdGains: FunctionalGainNode[] = [];
  createdConvolvers: FunctionalConvolverNode[] = [];
  state: AudioContextState = 'running';

  static registerInstance(ctx: FunctionalAudioContext) {
    activeFunctionalContext = ctx;
  }

  constructor() {
    FunctionalAudioContext.registerInstance(this);
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

  createBuffer(channels: number, length: number) {
    return new FunctionalAudioBuffer(channels, length) as unknown as AudioBuffer;
  }

  createConvolver() {
    const convolver = new FunctionalConvolverNode();
    this.createdConvolvers.push(convolver);
    return convolver as unknown as ConvolverNode;
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

    engine.playLevelUp();
    expect(activeFunctionalContext?.createdOscillators.length).toBe(15);
    const topNoteOsc = activeFunctionalContext!.createdOscillators[14];
    expect(topNoteOsc.type).toBe('triangle');

    engine.playAmbientFountain();
    expect(activeFunctionalContext?.createdOscillators.length).toBe(17);
    const waterOsc = activeFunctionalContext!.createdOscillators[15];
    expect(waterOsc.type).toBe('sine');
  });

  it('Batch 35: Spatial audio distance attenuation and stereo panning calculation', () => {
    // 1. Same position -> max gain, centered pan
    const center = engine.calculateSpatialParameters({ x: 100, y: 100 }, { x: 100, y: 100 }, 500);
    expect(center.distance).toBe(0);
    expect(center.gain).toBe(1);
    expect(center.pan).toBe(0);

    // 2. Sound to the right at 250 units distance -> reduced gain, pan = 1 (far right)
    const right = engine.calculateSpatialParameters({ x: 350, y: 100 }, { x: 100, y: 100 }, 500);
    expect(right.distance).toBe(250);
    expect(right.gain).toBe(0.5);
    expect(right.pan).toBe(1);

    // 3. Sound beyond maxDistance (600 units) -> gain culled to 0
    const far = engine.calculateSpatialParameters({ x: 700, y: 100 }, { x: 100, y: 100 }, 500);
    expect(far.distance).toBe(600);
    expect(far.gain).toBe(0);
  });

  it('Batch 35: Procedural reverb impulse generation and ambient reverb zones', () => {
    engine.init();

    // Generate procedural impulse buffer
    const buffer = engine.createProceduralImpulseBuffer(1.0, 2.0);
    expect(buffer).not.toBeNull();
    const ch0 = buffer!.getChannelData(0);
    expect(ch0.length).toBe(44100);

    // Switch ambient acoustic reverb zones
    engine.setAmbientReverbZone('cathedral');
    expect(engine.getActiveReverbZone()).toBe('cathedral');
    expect(activeFunctionalContext?.createdConvolvers.length).toBe(1);

    engine.setAmbientReverbZone('small_room');
    expect(engine.getActiveReverbZone()).toBe('small_room');

    engine.setAmbientReverbZone('none');
    expect(engine.getActiveReverbZone()).toBe('none');
  });
});
