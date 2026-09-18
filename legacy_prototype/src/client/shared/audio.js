/**
 * HavenWorld — Procedural Web Audio Synthesizer Engine
 * 100% Free-Tier: Zero audio asset files, zero network downloads, zero latency.
 * Generates cozy, retro chiptune and acoustic sound effects using the native Web Audio API.
 */

/** Musical note frequencies in Hz. */
export const NOTE_FREQUENCIES = {
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  F4: 349.23,
  G4: 392.00,
  A4: 440.00,
  B4: 493.88,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.00,
  B5: 987.77,
  C6: 1046.50
};

/** Compute an exponential decay envelope curve: [time, gain] pairs */
export function computeDecayEnvelope(peakGain, duration) {
  if (duration <= 0) return [{ t: 0, gain: 0 }];
  const steps = 6;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * duration;
    const progress = i / steps;
    const factor = Math.exp(-progress * 5);
    points.push({ t, gain: Math.max(0, peakGain * factor) });
  }
  return points;
}

/** Compute a pitch slide ramp from startFreq to endFreq over duration */
export function computePitchRamp(startFreq, endFreq, duration, steps = 5) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * duration;
    const freq = startFreq + (endFreq - startFreq) * (i / steps);
    points.push({ t, freq: Math.max(20, freq) });
  }
  return points;
}

// Browser AudioContext instance
let audioCtx = null;
let isMuted = false;

if (typeof localStorage !== 'undefined') {
  isMuted = localStorage.getItem('haven_audio_muted') === 'true';
}

/** Ensure AudioContext is active (must be called after a user gesture) */
export function initAudio() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (AudioCtxClass) {
      audioCtx = new AudioCtxClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function setMuted(muted) {
  isMuted = !!muted;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('haven_audio_muted', String(isMuted));
  }
}

export function getMuted() {
  return isMuted;
}

export function toggleMuted() {
  setMuted(!isMuted);
  return isMuted;
}

/** Plays a synthesized tone using an oscillator and gain envelope */
function playTone(freq, duration, type = 'sine', peakGain = 0.15, pitchEndFreq = null) {
  if (isMuted) return;
  const ctx = initAudio();
  if (!ctx || ctx.state !== 'running') return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    const now = ctx.currentTime;

    osc.frequency.setValueAtTime(freq, now);
    if (pitchEndFreq && pitchEndFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, pitchEndFreq), now + duration);
    }

    gain.gain.setValueAtTime(peakGain, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + duration + 0.05);
  } catch (err) {
    // Autoplay policy fallback
  }
}

/** Soft footstep tap on isometric tiles */
export function playFootstep() {
  playTone(90, 0.04, 'triangle', 0.06, 40);
}

/** Pleasant pop when placing or relocating furniture */
export function playFurniPop() {
  playTone(340, 0.07, 'sine', 0.12, 180);
}

/** Ascending two-note coin chime (E5 -> B5) */
export function playCoinChime() {
  if (isMuted) return;
  const ctx = initAudio();
  if (!ctx || ctx.state !== 'running') return;

  const now = ctx.currentTime;
  try {
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(NOTE_FREQUENCIES.E5, now);
    gain1.gain.setValueAtTime(0.12, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.1);

    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(NOTE_FREQUENCIES.B5, now + 0.07);
    gain2.gain.setValueAtTime(0.14, now + 0.07);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.07);
    osc2.stop(now + 0.23);
  } catch {}
}

/** Crystal chime when a public or private message arrives */
export function playChatPing(isWhisper = false) {
  const freq = isWhisper ? NOTE_FREQUENCIES.G5 : NOTE_FREQUENCIES.C6;
  playTone(freq, isWhisper ? 0.25 : 0.18, 'sine', isWhisper ? 0.09 : 0.12, freq * 0.9);
}

/** Cozy low whoosh when walking through a doorway or changing rooms */
export function playDoorwayWhoosh() {
  playTone(160, 0.14, 'sine', 0.10, 60);
}

/** Soft cushion rustle when sitting down */
export function playSitSound() {
  playTone(120, 0.08, 'triangle', 0.08, 70);
}

/** Gentle lamp click when toggling light */
export function playSwitchClick() {
  playTone(800, 0.03, 'sine', 0.08, 400);
}
